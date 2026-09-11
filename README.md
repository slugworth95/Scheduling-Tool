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
- **Recurring appointments** — daily / weekly / monthly series with interval, weekly day-of-week selection, and optional end date. Series expand into the calendar automatically; edit one occurrence (creates a one-off override), skip an occurrence, or edit/delete the whole series
- **Availability windows per day** — define open hours for each day of the week (Mon–Sun). Slots outside your windows are greyed out and unclickable, and the server rejects new bookings outside them
- **Email reminders** — per-appointment reminders (1 hour / 1 day / 2 days / 1 week before). Recurring series get reminders for every upcoming occurrence automatically. Sends real email via SMTP when configured, otherwise logs to the server console (see below)
- **Export / Import** — JSON export/import (full week backup/restore, conflict-safe, preserves recurrence + reminder settings) + CSV export
- **Client Tracker integration** — fetch clients and auto-fill the booking form
- **Workflow: Create Invoice** — open any appointment and click **Create Invoice**; a draft invoice is created in the Invoice Generator (port 3002) with the appointment's client and a line item for the appointment date/time — powered by the shared SSO session

## Shared sign-on (SSO)

All four tools share one login. Users and sessions live in a shared database (`~/.slugworth/auth.db`, override with `SLUGWORTH_DB_PATH`), and the session token is stored in a shared `slugworth_token` cookie on `localhost` — cookies are shared across ports, so signing in on any tool signs you into all of them. Each server accepts the token from the `Authorization` header or the cookie.

## Email reminders

Reminders are stored per appointment and checked by a background engine every 60 seconds. Each appointment can have one reminder (1 hour / 1 day / 2 days / 1 week before, or none). Recurring series automatically get reminders for every upcoming occurrence (next 14 days, topped up continuously).

Two transport modes:

- **Log-only (default, zero config)** — due reminders are printed to the server console and marked sent. Great for local development.
- **SMTP (real email)** — set these environment variables and restart:

  ```
  SMTP_HOST=smtp.example.com
  SMTP_PORT=587            # optional, default 587
  SMTP_SECURE=true         # optional, use for 465/TLS
  SMTP_USER=you@example.com
  SMTP_PASS=your-password
  SMTP_FROM=you@example.com # optional, defaults to SMTP_USER
  ```

  Requires `nodemailer` (installed by default via `npm install`). Use the **Reminders → Send test email** button to verify your setup.

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
│   ├── db.js             # SQLite schema (users, sessions, appointments, recurrences, availability, reminders)
│   ├── auth.js           # register/login + bearer-token middleware
│   ├── recurrence.js     # recurring-series expansion helpers
│   ├── reminders.js      # reminder engine (60s tick, SMTP or log-only transport)
│   └── routes/
│       ├── appointments.js # CRUD + conflict detection + series/overrides
│       ├── availability.js # availability windows per day
│       └── reminders.js    # reminder list + test-send
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
| GET | `/api/appointments?from=&to=&search=` | List appointments in a date range (recurring series expanded into occurrences) |
| GET | `/api/appointments/:id` | Get one appointment |
| POST | `/api/appointments` | Create. Body: `{ clientName, clientEmail?, clientPhone?, date, time, durationMin?, notes?, status?, clientId?, reminderMinutes?, recurrence? }` |
| POST | `/api/appointments/:recurrenceId/occurrences` | Create/update a one-off override for one date of a series. Body: `{ date, ...fields }` (use `status: "cancelled"` to skip a date) |
| PUT | `/api/appointments/:id` | Update (partial updates allowed; pass `recurrence: {...}` to change the series rule) |
| DELETE | `/api/appointments/:id` | Delete. Deleting a series template removes the whole series |
| DELETE | `/api/appointments/:recurrenceId/occurrences/:date` | Remove a one-off override (date reverts to the series) |

Creating or updating an appointment that overlaps an existing one (same date, same user, non-cancelled) returns **409** with the conflicting appointment id. New `scheduled` bookings that fall outside your availability windows return **400**.

`recurrence` (create or update): `{ frequency: "daily"|"weekly"|"monthly", interval?: number, daysOfWeek?: number[] (1=Mon..7=Sun, weekly), endDate?: "YYYY-MM-DD" }`.

`reminderMinutes`: minutes before the appointment to send the reminder (e.g. `1440` = 1 day). `null`/omitted = no reminder.

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
  "recurrenceId": null,
  "reminderMinutes": 1440,
  "isRecurring": false,
  "createdAt": "2026-09-11 12:00:00",
  "updatedAt": "2026-09-11 12:00:00"
}
```

Recurring series occurrences that aren't stored as rows are returned with an id like `r3:2026-09-16` plus `isRecurring: true`, `templateId`, and the series `recurrence` rule.

### Availability

| Method | Path | Description |
|---|---|---|
| GET | `/api/availability` | List windows: `[{ dayOfWeek, startTime, endTime }]` (0=Mon..6=Sun) |
| PUT | `/api/availability` | Replace all windows. Body: array of `{ dayOfWeek, startTime, endTime }` (empty array = fully open) |

### Reminders

| Method | Path | Description |
|---|---|---|
| GET | `/api/reminders?from=&to=&status=` | List reminders joined with appointment info |
| POST | `/api/reminders/test` | Send a test email (body `{ to? }`, defaults to your account email) |

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
- [x] Recurring appointments
- [x] Availability windows per day
- [x] Email reminders