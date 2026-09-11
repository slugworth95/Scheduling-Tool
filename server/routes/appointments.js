// Appointment CRUD API with conflict detection, recurring series,
// availability-window enforcement, and reminder scheduling.
const express = require("express");
const db = require("../db");
const { expandDates, fmtLocal, startOfAppointment } = require("../recurrence");

const router = express.Router();

const VALID_STATUSES = ["scheduled", "completed", "cancelled"];
const VALID_FREQUENCIES = ["daily", "weekly", "monthly"];

function serializeAppointment(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    date: row.date,
    time: row.time,
    durationMin: row.duration_min,
    notes: row.notes,
    status: row.status,
    clientId: row.client_id,
    proposalId: row.proposal_id,
    proposalUrl: row.proposal_url,
    invoiceId: row.invoice_id,
    invoiceUrl: row.invoice_url,
    recurrenceId: row.recurrence_id,
    reminderMinutes: row.reminder_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Attach recurrence metadata (rule + template flag) to a serialized appointment.
function enrichRecurrence(appt) {
  if (!appt || !appt.recurrenceId) return appt;
  const rec = db.prepare("SELECT * FROM recurrences WHERE id = ?").get(appt.recurrenceId);
  if (!rec) return appt;
  appt.isRecurring = true;
  appt.isTemplate = rec.start_date === appt.date;
  appt.templateId = rec.appointment_id;
  appt.recurrence = {
    frequency: rec.frequency,
    interval: rec.interval_count,
    daysOfWeek: rec.days_of_week ? rec.days_of_week.split(",").map(Number) : [],
    endDate: rec.end_date,
  };
  return appt;
}

// Convert "HH:MM" to minutes since midnight.
function toMinutes(time) {
  const [h, m] = String(time).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// Check for an overlapping appointment for the same user + date.
// excludeId: skip one appointment id. excludeRecurrenceId: skip a whole series
// (so overrides don't conflict with their own series' occurrences).
function findConflict(userId, date, time, durationMin, excludeId, excludeRecurrenceId) {
  const start = toMinutes(time);
  if (start === null) return null;
  const end = start + (Number(durationMin) || 60);
  const rows = db
    .prepare("SELECT id, time, duration_min, recurrence_id FROM appointments WHERE user_id = ? AND date = ? AND status != 'cancelled'")
    .all(userId, date);
  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue;
    if (excludeRecurrenceId && row.recurrence_id === excludeRecurrenceId) continue;
    const otherStart = toMinutes(row.time);
    if (otherStart === null) continue;
    const otherEnd = otherStart + row.duration_min;
    if (start < otherEnd && end > otherStart) return row.id;
  }
  return null;
}

// ─── Availability windows ───
// No windows configured at all → fully open. Windows configured but none for
// this day → closed. Otherwise the appointment must fit inside the window.
function isWithinAvailability(userId, date, time, durationMin) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM availability WHERE user_id = ?").get(userId).c;
  if (count === 0) return true;
  const dow = (new Date(date + "T00:00:00").getDay() + 6) % 7; // Mon=0
  const win = db
    .prepare("SELECT * FROM availability WHERE user_id = ? AND day_of_week = ?")
    .get(userId, dow);
  if (!win) return false;
  const start = toMinutes(time);
  const end = start + (Number(durationMin) || 60);
  const wStart = toMinutes(win.start_time);
  const wEnd = toMinutes(win.end_time);
  return start >= wStart && end <= wEnd;
}

// ─── Reminders ───
// Replace pending reminders for one appointment row with a single reminder
// `reminderMinutes` before the start (NULL/0 disables).
function syncReminders(userId, appointmentId, date, time, reminderMinutes) {
  db.prepare("DELETE FROM reminders WHERE appointment_id = ? AND status = 'pending'").run(appointmentId);
  const minutes = Number(reminderMinutes);
  if (!minutes || minutes <= 0) return;
  const remindAt = new Date(startOfAppointment(date, time).getTime() - minutes * 60000);
  db.prepare(
    "INSERT INTO reminders (appointment_id, user_id, occurrence_date, remind_at, status) VALUES (?, ?, NULL, ?, 'pending')"
  ).run(appointmentId, userId, fmtLocal(remindAt));
}

// ─── Recurrence helpers ───
function normalizeRecurrence(recurrence, fallback) {
  const frequency = VALID_FREQUENCIES.includes(recurrence.frequency) ? recurrence.frequency : fallback.frequency;
  const interval = Math.max(1, Number(recurrence.interval) || fallback.interval || 1);
  let daysOfWeek = fallback.daysOfWeek || null;
  if (Array.isArray(recurrence.daysOfWeek)) {
    daysOfWeek = [...new Set(recurrence.daysOfWeek.map(Number).filter((n) => n >= 1 && n <= 7))]
      .sort((a, b) => a - b)
      .join(",");
  }
  const endDate = recurrence.endDate !== undefined ? recurrence.endDate || null : fallback.endDate || null;
  return { frequency, interval, daysOfWeek, endDate };
}

// GET /api/appointments?from=&to=&search= — list in a date range.
// Recurring series are expanded into virtual occurrences; per-date overrides
// (real appointment rows with recurrence_id) take precedence.
router.get("/", (req, res) => {
  const { from, to, search = "" } = req.query;
  let sql = "SELECT * FROM appointments WHERE user_id = ?";
  const params = [req.user.id];
  if (from) {
    sql += " AND date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND date <= ?";
    params.push(to);
  }
  if (search) {
    sql += " AND (client_name LIKE ? OR client_email LIKE ? OR client_phone LIKE ?)";
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  sql += " ORDER BY date, time";
  const rows = db.prepare(sql).all(...params);

  const result = rows.map((r) => enrichRecurrence(serializeAppointment(r)));

  // Expand recurring series into the requested range (only on unfiltered range queries).
  if (!search && from && to) {
    const recs = db
      .prepare(
        `SELECT r.*, a.client_name, a.client_email, a.client_phone, a.time, a.duration_min,
                a.notes, a.status, a.client_id, a.created_at, a.updated_at
         FROM recurrences r JOIN appointments a ON a.id = r.appointment_id
         WHERE r.user_id = ?`
      )
      .all(req.user.id);

    // Map recurrence_id → date → stored row (templates + overrides already in `rows`).
    const storedByDate = {};
    for (const row of rows) {
      if (!row.recurrence_id) continue;
      (storedByDate[row.recurrence_id] = storedByDate[row.recurrence_id] || {})[row.date] = row;
    }

    for (const rec of recs) {
      const dates = expandDates(rec, from, to);
      for (const date of dates) {
        if (storedByDate[rec.id] && storedByDate[rec.id][date]) continue; // template/override covers it
        result.push({
          id: `r${rec.id}:${date}`,
          clientName: rec.client_name,
          clientEmail: rec.client_email,
          clientPhone: rec.client_phone,
          date,
          time: rec.time,
          durationMin: rec.duration_min,
          notes: rec.notes,
          status: rec.status,
          clientId: rec.client_id,
          recurrenceId: rec.id,
          isRecurring: true,
          isTemplate: false,
          templateId: rec.appointment_id,
          recurrence: {
            frequency: rec.frequency,
            interval: rec.interval_count,
            daysOfWeek: rec.days_of_week ? rec.days_of_week.split(",").map(Number) : [],
            endDate: rec.end_date,
          },
          createdAt: rec.created_at,
          updatedAt: rec.updated_at,
        });
      }
    }
    result.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  }

  res.json(result);
});

// GET /api/appointments/:id
router.get("/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM appointments WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Appointment not found" });
  res.json(enrichRecurrence(serializeAppointment(row)));
});

// POST /api/appointments — create (with conflict + availability checks).
// Body may include `recurrence: { frequency, interval, daysOfWeek, endDate }`
// and `reminderMinutes`.
router.post("/", (req, res) => {
  const body = req.body || {};
  const clientName = body.clientName ? String(body.clientName).trim() : "";
  const date = body.date || "";
  const time = body.time || "";
  const durationMin = Number(body.durationMin) || 60;
  const status = VALID_STATUSES.includes(body.status) ? body.status : "scheduled";
  const reminderMinutes = Number(body.reminderMinutes) || null;

  if (!clientName) return res.status(400).json({ error: "clientName is required" });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
  }
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: "time is required (HH:MM)" });
  }
  if (durationMin < 15 || durationMin > 480) {
    return res.status(400).json({ error: "durationMin must be between 15 and 480 minutes" });
  }

  const conflict = findConflict(req.user.id, date, time, durationMin);
  if (conflict) {
    return res.status(409).json({ error: "Time slot conflicts with appointment #" + conflict });
  }
  if (status === "scheduled" && !isWithinAvailability(req.user.id, date, time, durationMin)) {
    return res.status(400).json({ error: "Time is outside your availability window for that day" });
  }

  const result = db
    .prepare(
      `INSERT INTO appointments (user_id, client_name, client_email, client_phone, date, time, duration_min, notes, status, client_id, proposal_id, proposal_url, invoice_id, invoice_url, reminder_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      clientName,
      body.clientEmail || null,
      body.clientPhone || null,
      date,
      time,
      durationMin,
      body.notes || null,
      status,
      body.clientId || null,
      body.proposalId || null,
      body.proposalUrl || null,
      body.invoiceId || null,
      body.invoiceUrl || null,
      reminderMinutes
    );
  const apptId = Number(result.lastInsertRowid);

  // Recurring series?
  let recurrenceId = null;
  const recurrence = body.recurrence;
  if (recurrence && VALID_FREQUENCIES.includes(recurrence.frequency)) {
    const endDate = recurrence.endDate || null;
    if (endDate && endDate < date) {
      return res.status(400).json({ error: "endDate must be on or after the start date" });
    }
    const norm = normalizeRecurrence(recurrence, { frequency: recurrence.frequency, interval: 1, daysOfWeek: null, endDate });
    const recResult = db
      .prepare(
        "INSERT INTO recurrences (user_id, appointment_id, frequency, interval_count, days_of_week, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(req.user.id, apptId, norm.frequency, norm.interval, norm.daysOfWeek, date, norm.endDate);
    recurrenceId = Number(recResult.lastInsertRowid);
    db.prepare("UPDATE appointments SET recurrence_id = ? WHERE id = ?").run(recurrenceId, apptId);
  }

  syncReminders(req.user.id, apptId, date, time, reminderMinutes);

  const created = enrichRecurrence(
    serializeAppointment(db.prepare("SELECT * FROM appointments WHERE id = ?").get(apptId))
  );
  res.status(201).json(created);
});

// POST /api/appointments/:id/occurrences — create or update a one-off override
// for a specific date of a recurring series (edit/skip one occurrence).
router.post("/:id/occurrences", (req, res) => {
  const rec = db
    .prepare("SELECT * FROM recurrences WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: "Recurrence not found" });
  const template = db
    .prepare("SELECT * FROM appointments WHERE id = ? AND user_id = ?")
    .get(rec.appointment_id, req.user.id);
  if (!template) return res.status(404).json({ error: "Series template not found" });

  const body = req.body || {};
  const date = body.date || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
  }
  if (date === rec.start_date) {
    return res.status(400).json({ error: "Cannot override the first occurrence; edit the series instead" });
  }

  const clientName = body.clientName !== undefined ? String(body.clientName).trim() : template.client_name;
  const time = body.time || template.time;
  const durationMin = Number(body.durationMin) || template.duration_min;
  const status = VALID_STATUSES.includes(body.status) ? body.status : template.status;
  if (!clientName) return res.status(400).json({ error: "clientName cannot be empty" });
  if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: "time must be HH:MM" });

  const conflict = findConflict(req.user.id, date, time, durationMin, null, rec.id);
  if (conflict) {
    return res.status(409).json({ error: "Time slot conflicts with appointment #" + conflict });
  }
  if (status === "scheduled" && !isWithinAvailability(req.user.id, date, time, durationMin)) {
    return res.status(400).json({ error: "Time is outside your availability window for that day" });
  }

  const existing = db
    .prepare("SELECT * FROM appointments WHERE recurrence_id = ? AND date = ? AND user_id = ?")
    .get(rec.id, date, req.user.id);
  let id;
  if (existing) {
    db.prepare(
      `UPDATE appointments
       SET client_name = ?, client_email = ?, client_phone = ?, time = ?, duration_min = ?, notes = ?, status = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      clientName,
      body.clientEmail !== undefined ? body.clientEmail : existing.client_email,
      body.clientPhone !== undefined ? body.clientPhone : existing.client_phone,
      time,
      durationMin,
      body.notes !== undefined ? body.notes : existing.notes,
      status,
      existing.id
    );
    id = existing.id;
  } else {
    const result = db
      .prepare(
        `INSERT INTO appointments (user_id, client_name, client_email, client_phone, date, time, duration_min, notes, status, client_id, recurrence_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        clientName,
        body.clientEmail !== undefined ? body.clientEmail : template.client_email,
        body.clientPhone !== undefined ? body.clientPhone : template.client_phone,
        date,
        time,
        durationMin,
        body.notes !== undefined ? body.notes : template.notes,
        status,
        body.clientId !== undefined ? body.clientId : template.client_id,
        rec.id
      );
    id = Number(result.lastInsertRowid);
  }

  const reminderMinutes =
    body.reminderMinutes !== undefined ? Number(body.reminderMinutes) || null : template.reminder_minutes;
  syncReminders(req.user.id, id, date, time, reminderMinutes);

  res.status(201).json(enrichRecurrence(serializeAppointment(db.prepare("SELECT * FROM appointments WHERE id = ?").get(id))));
});

// PUT /api/appointments/:id — update (with conflict + availability checks).
// Pass `recurrence: {...}` to update the series rule on a template.
router.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM appointments WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: "Appointment not found" });

  const body = req.body || {};
  const next = {
    clientName: body.clientName !== undefined ? String(body.clientName).trim() : existing.client_name,
    clientEmail: body.clientEmail !== undefined ? body.clientEmail : existing.client_email,
    clientPhone: body.clientPhone !== undefined ? body.clientPhone : existing.client_phone,
    date: body.date !== undefined ? body.date : existing.date,
    time: body.time !== undefined ? body.time : existing.time,
    durationMin: body.durationMin !== undefined ? Number(body.durationMin) || 60 : existing.duration_min,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    status: body.status !== undefined ? (VALID_STATUSES.includes(body.status) ? body.status : existing.status) : existing.status,
    clientId: body.clientId !== undefined ? body.clientId : existing.client_id,
    proposalId: body.proposalId !== undefined ? body.proposalId : existing.proposal_id,
    proposalUrl: body.proposalUrl !== undefined ? body.proposalUrl : existing.proposal_url,
    invoiceId: body.invoiceId !== undefined ? body.invoiceId : existing.invoice_id,
    invoiceUrl: body.invoiceUrl !== undefined ? body.invoiceUrl : existing.invoice_url,
    reminderMinutes: body.reminderMinutes !== undefined ? Number(body.reminderMinutes) || null : existing.reminder_minutes,
  };

  if (!next.clientName) return res.status(400).json({ error: "clientName cannot be empty" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  if (!/^\d{2}:\d{2}$/.test(next.time)) {
    return res.status(400).json({ error: "time must be HH:MM" });
  }
  if (next.durationMin < 15 || next.durationMin > 480) {
    return res.status(400).json({ error: "durationMin must be between 15 and 480 minutes" });
  }

  const conflict = findConflict(req.user.id, next.date, next.time, next.durationMin, existing.id, existing.recurrence_id);
  if (conflict) {
    return res.status(409).json({ error: "Time slot conflicts with appointment #" + conflict });
  }
  if (next.status === "scheduled" && !isWithinAvailability(req.user.id, next.date, next.time, next.durationMin)) {
    return res.status(400).json({ error: "Time is outside your availability window for that day" });
  }

  // Moving a series template moves the series start date.
  if (existing.recurrence_id && next.date !== existing.date) {
    db.prepare("UPDATE recurrences SET start_date = ? WHERE id = ?").run(next.date, existing.recurrence_id);
  }

  // Series rule update (template only).
  if (body.recurrence && existing.recurrence_id) {
    const rec = db
      .prepare("SELECT * FROM recurrences WHERE id = ? AND user_id = ?")
      .get(existing.recurrence_id, req.user.id);
    if (rec) {
      const norm = normalizeRecurrence(body.recurrence, {
        frequency: rec.frequency,
        interval: rec.interval_count,
        daysOfWeek: rec.days_of_week ? rec.days_of_week.split(",").map(Number) : [],
        endDate: rec.end_date,
      });
      db.prepare(
        "UPDATE recurrences SET frequency = ?, interval_count = ?, days_of_week = ?, end_date = ? WHERE id = ?"
      ).run(norm.frequency, norm.interval, norm.daysOfWeek, norm.endDate, rec.id);
    }
  }

  db.prepare(
    `UPDATE appointments
     SET client_name = ?, client_email = ?, client_phone = ?, date = ?, time = ?, duration_min = ?, notes = ?, status = ?, client_id = ?, proposal_id = ?, proposal_url = ?, invoice_id = ?, invoice_url = ?, reminder_minutes = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    next.clientName,
    next.clientEmail,
    next.clientPhone,
    next.date,
    next.time,
    next.durationMin,
    next.notes,
    next.status,
    next.clientId,
    next.proposalId,
    next.proposalUrl,
    next.invoiceId,
    next.invoiceUrl,
    next.reminderMinutes,
    existing.id
  );

  syncReminders(req.user.id, existing.id, next.date, next.time, next.reminderMinutes);

  res.json(enrichRecurrence(serializeAppointment(db.prepare("SELECT * FROM appointments WHERE id = ?").get(existing.id))));
});

// DELETE /api/appointments/:id/occurrences/:date — remove a one-off override
// (the date reverts to the series' normal occurrence).
router.delete("/:id/occurrences/:date", (req, res) => {
  const rec = db
    .prepare("SELECT * FROM recurrences WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: "Recurrence not found" });
  const result = db
    .prepare("DELETE FROM appointments WHERE recurrence_id = ? AND date = ? AND user_id = ?")
    .run(rec.id, req.params.date, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: "Occurrence override not found" });
  res.status(204).end();
});

// DELETE /api/appointments/:id — delete one appointment. Deleting a series
// template removes the whole series (rule + template + overrides + reminders).
router.delete("/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM appointments WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Appointment not found" });

  if (row.recurrence_id) {
    const rec = db.prepare("SELECT * FROM recurrences WHERE id = ?").get(row.recurrence_id);
    if (rec && rec.start_date === row.date) {
      // Template → delete the whole series.
      db.prepare(
        "DELETE FROM reminders WHERE appointment_id IN (SELECT id FROM appointments WHERE recurrence_id = ?)"
      ).run(row.recurrence_id);
      db.prepare("DELETE FROM appointments WHERE recurrence_id = ?").run(row.recurrence_id);
      db.prepare("DELETE FROM recurrences WHERE id = ?").run(row.recurrence_id);
      return res.status(204).end();
    }
  }

  db.prepare("DELETE FROM reminders WHERE appointment_id = ?").run(row.id);
  const result = db.prepare("DELETE FROM appointments WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: "Appointment not found" });
  res.status(204).end();
});

module.exports = router;