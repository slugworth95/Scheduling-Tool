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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id);
  CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
`);

// Migration: add proposal link columns if the table predates them.
const apptCols = db.prepare("PRAGMA table_info(appointments)").all().map((c) => c.name);
if (!apptCols.includes("proposal_id")) {
  db.exec("ALTER TABLE appointments ADD COLUMN proposal_id INTEGER");
  db.exec("ALTER TABLE appointments ADD COLUMN proposal_url TEXT");
}

module.exports = db;