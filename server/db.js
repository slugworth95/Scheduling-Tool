// SQLite setup and schema. Uses Node's built-in node:sqlite — no native deps.
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "scheduling-tool.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = OFF;

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_name TEXT NOT NULL,
    client_email TEXT,
    client_phone TEXT,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 60,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
    client_id INTEGER,
    proposal_id INTEGER,
    proposal_url TEXT,
    invoice_id INTEGER,
    invoice_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id);
  CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);

  -- Recurring appointment series. The template appointment (first occurrence)
  -- lives in the appointments table; this row describes how it repeats.
  CREATE TABLE IF NOT EXISTS recurrences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
    interval_count INTEGER NOT NULL DEFAULT 1,
    days_of_week TEXT,          -- "1,3,5" (Mon=1..Sun=7), weekly only
    start_date TEXT NOT NULL,   -- template appointment date
    end_date TEXT,              -- optional series end (YYYY-MM-DD)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_recurrences_user ON recurrences(user_id);

  -- Availability windows per day of week (0=Mon .. 6=Sun). Absence = closed.
  CREATE TABLE IF NOT EXISTS availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    UNIQUE(user_id, day_of_week)
  );

  -- Email reminders. occurrence_date is NULL for one-off appointments and
  -- holds the specific date for recurring-series occurrences.
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    occurrence_date TEXT,
    remind_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, remind_at);
  CREATE INDEX IF NOT EXISTS idx_reminders_appt ON reminders(appointment_id);
`);

// Migration: add proposal/invoice link columns if the table predates them.
const apptCols = db.prepare("PRAGMA table_info(appointments)").all().map((c) => c.name);
if (!apptCols.includes("proposal_id")) {
  db.exec("ALTER TABLE appointments ADD COLUMN proposal_id INTEGER");
  db.exec("ALTER TABLE appointments ADD COLUMN proposal_url TEXT");
}
if (!apptCols.includes("invoice_id")) {
  db.exec("ALTER TABLE appointments ADD COLUMN invoice_id INTEGER");
  db.exec("ALTER TABLE appointments ADD COLUMN invoice_url TEXT");
}
if (!apptCols.includes("recurrence_id")) {
  db.exec("ALTER TABLE appointments ADD COLUMN recurrence_id INTEGER");
}
if (!apptCols.includes("reminder_minutes")) {
  db.exec("ALTER TABLE appointments ADD COLUMN reminder_minutes INTEGER");
}

module.exports = db;