// Reminder engine: sends due email reminders and tops up recurring-series
// reminders for the next 14 days.
//
// Transport: if SMTP_HOST (+ optional SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM/
// SMTP_SECURE) is configured and nodemailer is installed, real emails are sent.
// Otherwise it runs in log-only mode: due reminders are printed to the server
// console and marked sent, so the feature works end-to-end with zero config.
const db = require("./db");
const { expandDates, fmtLocal, startOfAppointment, toISO } = require("./recurrence");

const TICK_MS = 60 * 1000; // check every minute
const TOPUP_DAYS = 14;

let timer = null;
let transport = null;

function getTransport() {
  if (transport) return transport;
  if (!process.env.SMTP_HOST) return null;
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    return null; // nodemailer not installed → log-only
  }
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transport;
}

function mark(reminderId, status) {
  db.prepare("UPDATE reminders SET status = ?, sent_at = datetime('now') WHERE id = ?").run(status, reminderId);
}

async function sendReminder(reminder) {
  const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(reminder.appointment_id);
  if (!appt) return mark(reminder.id, "skipped");

  let date = appt.date;
  let time = appt.time;
  if (reminder.occurrence_date) {
    date = reminder.occurrence_date;
    const override = db
      .prepare("SELECT status FROM appointments WHERE recurrence_id = ? AND date = ?")
      .get(appt.recurrence_id, date);
    if (override && override.status === "cancelled") return mark(reminder.id, "skipped");
  }

  if (appt.status === "cancelled") return mark(reminder.id, "skipped");
  if (!appt.client_email) return mark(reminder.id, "skipped"); // nothing to send to

  const subject = `Reminder: ${appt.client_name} — ${date} at ${time}`;
  const text =
    `Hi ${appt.client_name},\n\n` +
    `This is a reminder about your appointment on ${date} at ${time} ` +
    `(${appt.duration_min} minutes).\n\n` +
    (appt.notes ? `Notes: ${appt.notes}\n\n` : "") +
    `See you then!`;

  const smtp = getTransport();
  if (!smtp) {
    console.log(`[reminder] ${appt.client_email} — ${subject}`);
    return mark(reminder.id, "sent");
  }

  try {
    await smtp.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: appt.client_email,
      subject,
      text,
    });
    console.log(`[reminder] sent to ${appt.client_email} — ${subject}`);
    mark(reminder.id, "sent");
  } catch (err) {
    console.error("[reminder] send failed:", err.message);
    mark(reminder.id, "failed");
  }
}

// Ensure pending reminders exist for upcoming occurrences of every series whose
// template has a reminder configured. Overridden dates are owned by their
// override row's own reminder, so they're skipped here.
function topUpSeriesReminders() {
  const recs = db
    .prepare(
      `SELECT r.*, a.reminder_minutes, a.time
       FROM recurrences r JOIN appointments a ON a.id = r.appointment_id
       WHERE a.reminder_minutes IS NOT NULL AND a.reminder_minutes > 0`
    )
    .all();
  if (!recs.length) return;

  const from = toISO(new Date());
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + TOPUP_DAYS);
  const to = toISO(horizon);

  const insert = db.prepare(
    "INSERT INTO reminders (appointment_id, user_id, occurrence_date, remind_at, status) VALUES (?, ?, ?, ?, 'pending')"
  );
  for (const rec of recs) {
    for (const date of expandDates(rec, from, to)) {
      if (date === rec.start_date) continue; // template's own reminder handled on save
      const override = db
        .prepare("SELECT id FROM appointments WHERE recurrence_id = ? AND date = ?")
        .get(rec.id, date);
      if (override) continue; // override owns this date
      const exists = db
        .prepare("SELECT id FROM reminders WHERE appointment_id = ? AND occurrence_date = ?")
        .get(rec.appointment_id, date);
      if (exists) continue; // already has a reminder (pending or sent) — never duplicate
      const remindAt = new Date(startOfAppointment(date, rec.time).getTime() - rec.reminder_minutes * 60000);
      insert.run(rec.appointment_id, rec.user_id, date, fmtLocal(remindAt));
    }
  }
}

function tick() {
  // 1. Send due reminders.
  const due = db
    .prepare("SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= datetime('now','localtime')")
    .all();
  for (const r of due) sendReminder(r);

  // 2. Top up upcoming series reminders.
  topUpSeriesReminders();
}

function start() {
  if (timer) return;
  tick();
  timer = setInterval(tick, TICK_MS);
  console.log("Reminder engine started (checks every 60s; SMTP " + (process.env.SMTP_HOST ? "configured" : "not configured — log-only mode") + ")");
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, tick, sendReminder, getTransport };