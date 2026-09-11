// Availability windows per day of week (0=Mon .. 6=Sun).
// Absence of any windows = fully open (legacy behavior). Once windows exist,
// days without a window are closed.
const express = require("express");
const db = require("../db");

const router = express.Router();

const TIME_RE = /^\d{2}:\d{2}$/;

function serialize(row) {
  return { dayOfWeek: row.day_of_week, startTime: row.start_time, endTime: row.end_time };
}

// GET /api/availability — list the user's windows (sorted Mon..Sun).
router.get("/", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM availability WHERE user_id = ? ORDER BY day_of_week")
    .all(req.user.id);
  res.json(rows.map(serialize));
});

// PUT /api/availability — replace all windows.
// Body: [{ dayOfWeek, startTime, endTime }, ...] (empty array = fully open).
router.put("/", (req, res) => {
  const body = Array.isArray(req.body) ? req.body : [];
  const seen = new Set();
  const windows = [];
  for (const w of body) {
    const dayOfWeek = Number(w.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return res.status(400).json({ error: "dayOfWeek must be an integer 0 (Mon) .. 6 (Sun)" });
    }
    if (seen.has(dayOfWeek)) {
      return res.status(400).json({ error: "Duplicate dayOfWeek: " + dayOfWeek });
    }
    seen.add(dayOfWeek);
    const startTime = String(w.startTime || "");
    const endTime = String(w.endTime || "");
    if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
      return res.status(400).json({ error: "startTime and endTime must be HH:MM" });
    }
    const start = startTime.split(":").map(Number);
    const end = endTime.split(":").map(Number);
    if (start[0] * 60 + start[1] >= end[0] * 60 + end[1]) {
      return res.status(400).json({ error: "endTime must be after startTime for day " + dayOfWeek });
    }
    windows.push({ dayOfWeek, startTime, endTime });
  }

  db.prepare("DELETE FROM availability WHERE user_id = ?").run(req.user.id);
  const insert = db.prepare(
    "INSERT INTO availability (user_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)"
  );
  for (const w of windows) insert.run(req.user.id, w.dayOfWeek, w.startTime, w.endTime);

  res.json(windows);
});

module.exports = router;