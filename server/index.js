// Scheduling Tool — Express server.
// Serves the frontend from /public and exposes the JSON API under /api.
const path = require("node:path");
const express = require("express");
const { register, login, requireAuth } = require("./auth");
const appointmentsRouter = require("./routes/appointments");

const app = express();
const PORT = process.env.PORT || 3003;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// CORS — allow other local tools to call this API from their own origins.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ service: "scheduling-tool", status: "ok", version: "2.0.0" });
});

// Auth
app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email, and password are required" });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  try {
    const { user, token } = register({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      password: String(password),
    });
    res.status(201).json({ user, token });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    throw err;
  }
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  const result = login({
    email: String(email).trim().toLowerCase(),
    password: String(password),
  });
  if (!result) return res.status(401).json({ error: "Invalid email or password" });
  res.json(result);
});

// Protected API
app.use("/api/appointments", requireAuth, appointmentsRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Scheduling Tool running at http://localhost:${PORT}`);
});