// Shared SSO auth module.
//
// users + sessions live in ONE shared database (default ~/.slugworth/auth.db)
// so a single login works across Client-Tracker, Proposal-Builder,
// Invoice-Generator, and Scheduling-Tool. The session token is also stored in a
// shared `slugworth_token` cookie on localhost — cookies are shared across ports
// on the same host, so logging in on any tool authenticates all of them.
//
// Override the shared DB path with the SLUGWORTH_DB_PATH env var.
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const SHARED_DB_PATH = process.env.SLUGWORTH_DB_PATH || path.join(os.homedir(), ".slugworth", "auth.db");
fs.mkdirSync(path.dirname(SHARED_DB_PATH), { recursive: true });

const db = new DatabaseSync(SHARED_DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
`);

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_COOKIE = "slugworth_token";
const COOKIE_ATTRS = `Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(candidate, "hex")
  );
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    "INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)"
  ).run(userId, token, expiresAt);
  return token;
}

function setTokenCookie(res, token) {
  res.setHeader("Set-Cookie", `${TOKEN_COOKIE}=${token}; ${COOKIE_ATTRS}`);
}

function clearTokenCookie(res) {
  res.setHeader("Set-Cookie", `${TOKEN_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`);
}

function register({ name, email, password }) {
  const passwordHash = hashPassword(password);
  const result = db
    .prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
    .run(name, email, passwordHash);
  const user = { id: Number(result.lastInsertRowid), name, email };
  return { user, token: createSession(user.id) };
}

function login({ email, password }) {
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return { user: { id: user.id, name: user.name, email: user.email }, token: createSession(user.id) };
}

// Extract the token from the Authorization header or the shared cookie.
function getToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key === TOKEN_COOKIE) return rest.join("=");
    }
  }
  return null;
}

function getUserFromToken(token) {
  const session = db
    .prepare(
      `SELECT s.user_id, s.expires_at, u.name, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);
  if (!session || Date.parse(session.expires_at) <= Date.now()) return null;
  return { id: session.user_id, name: session.name, email: session.email };
}

function requireAuth(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: "Missing auth token" });
  const user = getUserFromToken(token);
  if (!user) return res.status(401).json({ error: "Invalid or expired token" });
  req.user = user;
  next();
}

module.exports = { register, login, requireAuth, setTokenCookie, clearTokenCookie };