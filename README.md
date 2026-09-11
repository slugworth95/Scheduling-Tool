# Scheduling-Tool

Manage appointments, bookings, and availability. A full-stack app: vanilla JS frontend with a weekly calendar grid, Express API, SQLite database, and token-based auth — with built-in integration with [Client-Tracker](https://github.com/slugworth95/Client-Tracker).

## Features

- **Weekly calendar grid** — Mon–Sun columns with hourly time slots (8:00–18:00)
- **Click to book** — click any time slot to open the booking form pre-filled with that day/time
- **Click to edit** — click an appointment to reschedule, update details, or change status
- **Conflict detection** — overlapping appointments are rejected server-side (409)
- **Status tracking** — scheduled / completed / cancelled with color-coded blocks
- **Durations** — 30 / 60 / 90 / 120 minutes
- **Week navigation** — prev / today / next
- **Export / Import** — JSON export/import (full week backup/restore, conflict-safe) + CSV export
- **Client Tracker integration** — fetch clients and auto-fill the booking form
- **Workflow: Create Invoice** — open any appointment and click **Create Invoice**; a draft invoice is created in the Invoice Generator (port 3002) with the appointment's client and a line item for the appointment date/time — powered by the shared SSO session

## Shared sign-on (SSO)

All four tools share one login. Users and sessions live in a shared database (`~/.slugworth/auth.db`, override with `SLUGWORTH_DB_PATH`), and the session token is stored in a shared `slugworth_token` cookie on `localhost` — cookies are shared across ports, so signing in on any tool signs you into all of them. Each server accepts the token from the `Authorization` header or the cookie.

## Run locally

Requires Node.js 22.5+ (uses the built-in `node:sqlite` — no native dependencies).

```bash
npm install
npm start
```

Open http://localhost:3003. The SQLite database is created automatically in `data/` (gitignored).

> Note: runs on port **3003** so it can run alongside Client Tracker (3000), Proposal Builder (3001), and Invoice Generator (3002).

## Project structure

```
Scheduling-Tool/
├── server/
│   ├── index.js          # Express app: static frontend + /api routes
│   ├── db.js             # SQLite schema (users, sessions, appointments)
│   ├── auth.js           # register/login + bearer-token middleware
│   └── routes/appointments.js # CRUD + conflict detection
├── public/               # Frontend (served by Express)
│   ├── index.html
│   ├── css/styles.css
│   └── js/{api.js,app.js}
├── data/                 # SQLite file (created at runtime, gitignored)
└── package.json
```

## API reference

Base URL: `http://localhost:3003` (override with `PORT` env var).

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Service discovery |

### Auth

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password }` | Create account. Returns `{ user, token }` |
| POST | `/api/auth/login` | `{ email, password }` | Returns `{ user, token }` |

All endpoints below require `Authorization: Bearer <token>`.

### Appointments

| Method | Path | Description |
|---|---|---|
| GET | `/api/appointments?from=&to=&search=` | List appointments in a date range |
| GET | `/api/appointments/:id` | Get one appointment |
| POST | `/api/appointments` | Create. Body: `{ clientName, clientEmail?, clientPhone?, date, time, durationMin?, notes?, status?, clientId? }` |
| PUT | `/api/appointments/:id` | Update (partial updates allowed) |
| DELETE | `/api/appointments/:id` | Delete |

Creating or updating an appointment that overlaps an existing one (same date, same user, non-cancelled) returns **409** with the conflicting appointment id.

Appointment shape:

```json
{
  "id": 1,
  "clientName": "The Hendersons",
  "clientEmail": "hendersons@example.com",
  "clientPhone": "555-0100",
  "date": "2026-09-15",
  "time": "09:00",
  "durationMin": 60,
  "notes": "Site walkthrough",
  "status": "scheduled",
  "clientId": 3,
  "createdAt": "2026-09-11 12:00:00",
  "updatedAt": "2026-09-11 12:00:00"
}
```

## Integrating with Client Tracker

1. Run Client Tracker (`npm start` in `Client-Tracker`, port 3000) and create an account.
2. In Scheduling Tool, use the **Client Tracker** bar at the top.
3. Enter `http://localhost:3000` and paste your Client Tracker API token.
4. Click **Fetch Clients**, pick a client, then book an appointment — the form auto-fills.

## Roadmap

- [x] Weekly calendar grid with click-to-book
- [x] Conflict detection
- [x] Status tracking (scheduled / completed / cancelled)
- [x] Server-side persistence with auth
- [x] Client Tracker integration
- [x] JSON export/import + CSV export
- [ ] Recurring appointments
- [ ] Availability windows per day
- [ ] Email reminders