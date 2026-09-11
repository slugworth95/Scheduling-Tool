// Reminder list + test-send API.
const express = require("express");
const db = require("../db");
const { getTransport } = require("../reminders");

const router = express.Router();

function serialize(row) {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    occurrenceDate: row.occurrence_date,
    remindAt: row.remind_at,
    status: row.status,
    sentAt: row.sent_at,
    clientName: row.client_name,
    clientEmail: row.client_email,
    date: row.occurrence_date || row.date,
    time: row.time,
  };
}

// GET /api/reminders?from=&to=&status= — list reminders (joined with appointment info).
router.get("/", (req, res) => {
  const { from, to, status } = req.query;
  let sql =
    `SELECT r.*, a.client_name, a.client_email, a.date, a.time
     FROM reminders r JOIN appointments a ON a.id = r.appointment_id
     WHERE r.user_id = ?`;
  const params = [req.user.id];
  if (from) {
    sql += " AND r.remind_at >= ?";
    params.push(from + " 00:00:00");
  }
  if (to) {
    sql += " AND r.remind_at <= ?";
    params.push(to + " 23:59:59");
  }
  if (status) {
    sql += " AND r.status = ?";
    params.push(status);
  }
  sql += " ORDER BY r.remind_at";
  res.json(db.prepare(sql).all(...params).map(serialize));
});

// POST /api/reminders/test — send a test reminder to verify SMTP config.
// Body: { to? } — defaults to the signed-in user's email.
router.post("/test", async (req, res) => {
  const to = (req.body && req.body.to) || req.user.email;
  const transport = getTransport();
  if (!transport) {
    return res.status(400).json({
      error: "SMTP is not configured. Set SMTP_HOST (and SMTP_USER/SMTP_PASS) to send real email.",
    });
  }
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: "Scheduling Tool — test reminder",
      text: "This is a test email from the Scheduling Tool. Your reminder setup works.",
    });
    res.json({ ok: true, to });
  } catch (err) {
    res.status(500).json({ error: "Test email failed: " + err.message });
  }
});

module.exports = router;