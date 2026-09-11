// Auth: register, login, and bearer-token middleware.
// Passwords are hashed with Node's built-in crypto.scrypt (no bcrypt dependency).
const crypto = require("node:crypto");
const db = require("./db");

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const session = db
    .prepare(
      `SELECT s.user_id, s.expires_at, u.name, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);

  if (!session || Date.parse(session.expires_at) <= Date.now()) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = { id: session.user_id, name: session.name, email: session.email };
  next();
}

module.exports = { register, login, requireAuth };