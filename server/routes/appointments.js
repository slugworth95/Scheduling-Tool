// Appointment CRUD API with conflict detection.
const express = require("express");
const db = require("../db");

const router = express.Router();

const VALID_STATUSES = ["scheduled", "completed", "cancelled"];

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Convert "HH:MM" to minutes since midnight.
function toMinutes(time) {
  const [h, m] = String(time).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// Check for an overlapping appointment for the same user + date.
// Returns the conflicting appointment id, or null.
function findConflict(userId, date, time, durationMin, excludeId) {
  const start = toMinutes(time);
  if (start === null) return null;
  const end = start + (Number(durationMin) || 60);
  const rows = db
    .prepare("SELECT id, time, duration_min FROM appointments WHERE user_id = ? AND date = ? AND status != 'cancelled'")
    .all(userId, date);
  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue;
    const otherStart = toMinutes(row.time);
    if (otherStart === null) continue;
    const otherEnd = otherStart + row.duration_min;
    if (start < otherEnd && end > otherStart) return row.id;
  }
  return null;
}

// GET /api/appointments?from=&to=&search= — list in a date range
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
  res.json(db.prepare(sql).all(...params).map(serializeAppointment));
});

// GET /api/appointments/:id
router.get("/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM appointments WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Appointment not found" });
  res.json(serializeAppointment(row));
});

// POST /api/appointments — create (with conflict check)
router.post("/", (req, res) => {
  const body = req.body || {};
  const clientName = body.clientName ? String(body.clientName).trim() : "";
  const date = body.date || "";
  const time = body.time || "";
  const durationMin = Number(body.durationMin) || 60;
  const status = VALID_STATUSES.includes(body.status) ? body.status : "scheduled";

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

  const result = db
    .prepare(
      `INSERT INTO appointments (user_id, client_name, client_email, client_phone, date, time, duration_min, notes, status, client_id, proposal_id, proposal_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      body.proposalUrl || null
    );
  res
    .status(201)
    .json(serializeAppointment(db.prepare("SELECT * FROM appointments WHERE id = ?").get(Number(result.lastInsertRowid))));
});

// PUT /api/appointments/:id — update (with conflict check)
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

  const conflict = findConflict(req.user.id, next.date, next.time, next.durationMin, existing.id);
  if (conflict) {
    return res.status(409).json({ error: "Time slot conflicts with appointment #" + conflict });
  }

  db.prepare(
    `UPDATE appointments
     SET client_name = ?, client_email = ?, client_phone = ?, date = ?, time = ?, duration_min = ?, notes = ?, status = ?, client_id = ?, proposal_id = ?, proposal_url = ?, updated_at = datetime('now')
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
    existing.id
  );
  res.json(serializeAppointment(db.prepare("SELECT * FROM appointments WHERE id = ?").get(existing.id)));
});

// DELETE /api/appointments/:id
router.delete("/:id", (req, res) => {
  const result = db
    .prepare("DELETE FROM appointments WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: "Appointment not found" });
  res.status(204).end();
});

module.exports = router;