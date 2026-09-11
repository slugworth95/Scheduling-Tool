// Recurring-series expansion helpers, shared by the appointments route
// (virtual occurrences) and the reminder engine (top-up of upcoming reminders).

// days_of_week is stored as "1,3,5" with Mon=1 .. Sun=7 (weekly only).
function parseDays(str) {
  if (!str) return [];
  return String(str)
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
}

function toISO(d) {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

// Expand a recurrence row into concrete date strings within [from, to].
// `rec` needs: start_date, end_date?, frequency, interval_count, days_of_week?
// Returns a sorted, de-duplicated array of "YYYY-MM-DD" strings.
function expandDates(rec, from, to) {
  const out = [];
  const start = rec.start_date;
  const end = rec.end_date || to;
  const freq = rec.frequency;
  const interval = Math.max(1, Number(rec.interval_count) || 1);
  const days = parseDays(rec.days_of_week);

  const cursor = new Date(start + "T00:00:00");
  const fromD = new Date(from + "T00:00:00");
  const toD = new Date(to + "T00:00:00");
  const endD = new Date(end + "T00:00:00");

  let guard = 0;
  const MAX_ITER = 4000; // safety cap (e.g. 10+ years of daily)
  while (cursor <= toD && guard++ < MAX_ITER) {
    if (freq === "weekly" && days.length) {
      // Emit the requested weekdays within this week (respecting start/end).
      for (const day of days) {
        const dow = ((cursor.getDay() + 6) % 7) + 1; // Mon=1..Sun=7
        const occ = new Date(cursor);
        occ.setDate(occ.getDate() + (day - dow));
        const occStr = toISO(occ);
        if (occStr >= from && occStr <= to && occStr >= start && occStr <= end) out.push(occStr);
      }
    } else {
      const occStr = toISO(cursor);
      if (occStr >= from && occStr <= to && occStr >= start && occStr <= end) out.push(occStr);
    }

    if (freq === "daily") cursor.setDate(cursor.getDate() + interval);
    else if (freq === "weekly") cursor.setDate(cursor.getDate() + 7 * interval);
    else if (freq === "monthly") cursor.setMonth(cursor.getMonth() + interval);
    else break;
  }

  return [...new Set(out)].sort();
}

// Local-time "YYYY-MM-DD HH:MM:SS" for a Date.
function fmtLocal(d) {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0") +
    " " +
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0") +
    ":" +
    String(d.getSeconds()).padStart(2, "0")
  );
}

// Appointment start (date + time) as a local Date.
function startOfAppointment(date, time) {
  return new Date(date + "T" + (time || "09:00") + ":00");
}

module.exports = { expandDates, parseDays, toISO, fmtLocal, startOfAppointment };