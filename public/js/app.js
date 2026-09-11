// Scheduling Tool — UI logic.
const $ = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════
const authView = $("auth-view");
const appView = $("app-view");
const authForm = $("auth-form");
const authTitle = $("auth-title");
const authSubmit = $("auth-submit");
const authToggle = $("auth-toggle");
const authStatus = $("auth-status");
const nameField = $("auth-name");
const nameLabel = $("name-label");

let authMode = "login";

function showAuth() {
  authView.hidden = false;
  appView.hidden = true;
}

function showApp() {
  authView.hidden = true;
  appView.hidden = false;
}

function setAuthStatus(message, isError = false) {
  authStatus.textContent = message;
  authStatus.hidden = false;
  authStatus.style.color = isError ? "#b91c1c" : "";
}

authToggle.addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  authTitle.textContent = authMode === "login" ? "Sign In" : "Create Account";
  authSubmit.textContent = authMode === "login" ? "Sign In" : "Create Account";
  nameField.hidden = nameLabel.hidden = authMode !== "register";
  authStatus.hidden = true;
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  try {
    if (authMode === "register") {
      const name = nameField.value.trim();
      if (!name) return setAuthStatus("Please enter your name.", true);
      const { token } = await API.register(name, email, password);
      API.setToken(token);
    } else {
      const { token } = await API.login(email, password);
      API.setToken(token);
    }
    authForm.reset();
    showApp();
    init();
  } catch (err) {
    setAuthStatus(err.message, true);
  }
});

$("logout-button").addEventListener("click", async () => {
  await API.logout();
  API.setToken(null);
  showAuth();
});

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOT_START_HOUR = 8;
const SLOT_END_HOUR = 18; // exclusive
const SLOT_HEIGHT = 60; // px per hour

let weekStart = null; // Date (Monday)
let appointments = [];
let editingId = null;
let editingVirtual = null; // { recurrenceId, date, templateId } when editing a virtual occurrence
let currentAppt = null; // the appointment object currently open in the dialog
let fetchedClients = [];
let currentApptProposal = null; // { id, url } when the appointment links to a proposal
let currentApptInvoice = null; // { id, url } when the appointment links to an invoice
let availability = []; // [{ dayOfWeek, startTime, endTime }]
let virtualAppts = {}; // virtual occurrence id -> full appointment object

function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - day);
  return d;
}

function toISODate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function toMinutes(time) {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + m;
}

// ═══════════════════════════════════════════════
// WEEK GRID
// ═══════════════════════════════════════════════
async function loadWeek() {
  const from = toISODate(weekStart);
  const toDate = new Date(weekStart);
  toDate.setDate(toDate.getDate() + 6);
  const to = toISODate(toDate);
  try {
    const [appts, avail] = await Promise.all([
      API.listAppointments({ from, to }),
      API.listAvailability(),
    ]);
    appointments = appts;
    availability = avail;
  } catch (err) {
    appointments = [];
    availability = [];
    alert(err.message);
  }
  renderWeek();
}

function renderWeek() {
  const grid = $("weekGrid");
  const todayStr = toISODate(new Date());
  const weekLabel = $("weekLabel");
  const endDate = new Date(weekStart);
  endDate.setDate(endDate.getDate() + 6);
  weekLabel.textContent =
    weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " – " +
    endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Availability lookup: dayOfWeek (Mon=0) -> window. No windows at all = fully open.
  const availByDay = {};
  for (const w of availability) availByDay[w.dayOfWeek] = w;
  const hasWindows = availability.length > 0;

  virtualAppts = {};

  // Time gutter
  let html = '<div class="time-gutter">';
  for (let h = SLOT_START_HOUR; h < SLOT_END_HOUR; h++) {
    html += `<div class="time-label">${h}:00</div>`;
  }
  html += "</div>";

  // Day columns
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + i);
    const dateStr = toISODate(day);
    const isToday = dateStr === todayStr;
    const dayAppts = appointments
      .filter((a) => a.date === dateStr)
      .sort((a, b) => a.time.localeCompare(b.time));

    const dow = (day.getDay() + 6) % 7; // Mon=0
    const win = availByDay[dow];
    const dayOpen = !hasWindows || !!win;

    html += `<div class="day-column">
      <div class="day-header${isToday ? " today" : ""}">
        ${DAY_NAMES[i]} <span class="day-date">${day.getMonth() + 1}/${day.getDate()}</span>
      </div>
      <div class="day-body" data-date="${dateStr}">`;

    // Clickable hour slots (unavailable ones are greyed out)
    for (let h = SLOT_START_HOUR; h < SLOT_END_HOUR; h++) {
      const timeStr = String(h).padStart(2, "0") + ":00";
      const slotStart = h * 60;
      const slotEnd = slotStart + 60;
      const available =
        dayOpen && (!win || (slotStart >= toMinutes(win.startTime) && slotEnd <= toMinutes(win.endTime)));
      html += `<div class="slot${available ? "" : " unavailable"}" data-date="${dateStr}" data-time="${timeStr}"${available ? "" : ' title="Outside availability"'}></div>`;
    }

    // Appointment blocks
    dayAppts.forEach((a) => {
      const startMin = toMinutes(a.time);
      const top = ((startMin - SLOT_START_HOUR * 60) / 60) * SLOT_HEIGHT;
      const height = Math.max((a.durationMin / 60) * SLOT_HEIGHT, 24);
      const timeLabel = a.time.slice(0, 5);
      const isVirtual = String(a.id).startsWith("r");
      if (isVirtual) virtualAppts[a.id] = a;
      const badge = a.isRecurring ? " 🔁" : "";
      html += `<div class="appt-block ${a.status}${a.isRecurring ? " recurring" : ""}" data-id="${a.id}" style="top:${top}px;height:${height}px;">
        <div class="appt-time">${timeLabel} · ${a.durationMin}m${badge}</div>
        <div class="appt-name">${escHtml(a.clientName)}</div>
      </div>`;
    });

    html += "</div></div>";
  }

  grid.innerHTML = html;

  // Wire up clicks
  grid.querySelectorAll(".slot").forEach((slot) => {
    if (slot.classList.contains("unavailable")) return;
    slot.addEventListener("click", () => openBooking(slot.dataset.date, slot.dataset.time));
  });
  grid.querySelectorAll(".appt-block").forEach((block) => {
    block.addEventListener("click", () => {
      const id = block.dataset.id;
      if (String(id).startsWith("r")) openEditVirtual(id);
      else openEdit(Number(id));
    });
  });
}

function shiftWeek(delta) {
  weekStart.setDate(weekStart.getDate() + delta * 7);
  loadWeek();
}

function goToToday() {
  weekStart = mondayOf(new Date());
  loadWeek();
}

// ═══════════════════════════════════════════════
// BOOKING / EDIT DIALOG
// ═══════════════════════════════════════════════
const dialog = $("appt-dialog");
const apptForm = $("appt-form");

function resetRepeatFields() {
  $("appt-repeat").value = "";
  $("appt-repeat-interval").value = "1";
  $("appt-repeat-days").hidden = true;
  document.querySelectorAll("#appt-repeat-days-box input").forEach((cb) => (cb.checked = false));
  $("appt-repeat-end").value = "";
  updateRepeatUnit();
}

function setRepeatFields(rec) {
  if (!rec) return resetRepeatFields();
  $("appt-repeat").value = rec.frequency || "";
  $("appt-repeat-interval").value = String(rec.interval || 1);
  const days = rec.daysOfWeek || [];
  document.querySelectorAll("#appt-repeat-days-box input").forEach((cb) => {
    cb.checked = days.includes(Number(cb.value));
  });
  $("appt-repeat-days").hidden = (rec.frequency || "") !== "weekly";
  $("appt-repeat-end").value = rec.endDate || "";
  updateRepeatUnit();
}

function updateRepeatUnit() {
  const freq = $("appt-repeat").value;
  $("appt-repeat-unit").textContent =
    freq === "daily" ? "day(s)" : freq === "weekly" ? "week(s)" : freq === "monthly" ? "month(s)" : "week(s)";
}

$("appt-repeat").addEventListener("change", () => {
  $("appt-repeat-days").hidden = $("appt-repeat").value !== "weekly";
  updateRepeatUnit();
});

function buildRecurrencePayload() {
  const frequency = $("appt-repeat").value;
  if (!frequency) return null;
  let daysOfWeek;
  if (frequency === "weekly") {
    daysOfWeek = [...document.querySelectorAll("#appt-repeat-days-box input:checked")].map((cb) => Number(cb.value));
    if (!daysOfWeek.length) {
      // Default to the day of the start date.
      const d = new Date($("appt-date").value + "T00:00:00");
      daysOfWeek = [(d.getDay() + 6) % 7 + 1];
    }
  }
  return {
    frequency,
    interval: Number($("appt-repeat-interval").value) || 1,
    daysOfWeek,
    endDate: $("appt-repeat-end").value || null,
  };
}

function openBooking(date, time) {
  editingId = null;
  editingVirtual = null;
  currentAppt = null;
  $("appt-form-title").textContent = "Book Appointment";
  apptForm.reset();
  $("appt-date").value = date || toISODate(new Date());
  $("appt-time").value = time || "09:00";
  $("appt-status").value = "scheduled";
  $("appt-reminder").value = "";
  $("appt-repeat-section").hidden = false;
  resetRepeatFields();
  $("appt-series-note").hidden = true;
  $("appt-edit-series").hidden = true;
  $("appt-delete").hidden = true;
  $("appt-delete").textContent = "Delete";
  dialog.showModal();
}

// Fill the dialog from an appointment object (real row or virtual occurrence).
function fillForm(a, opts = {}) {
  const isVirtual = !!opts.virtual;
  $("appt-client").value = a.clientName || "";
  $("appt-email").value = a.clientEmail || "";
  $("appt-phone").value = a.clientPhone || "";
  $("appt-date").value = a.date || "";
  $("appt-time").value = a.time || "";
  $("appt-duration").value = String(a.durationMin || 60);
  $("appt-status").value = a.status || "scheduled";
  $("appt-notes").value = a.notes || "";
  $("appt-reminder").value = a.reminderMinutes ? String(a.reminderMinutes) : "";
  currentApptProposal = a.proposalId && a.proposalUrl ? { id: a.proposalId, url: a.proposalUrl } : null;
  $("appt-proposal").hidden = !currentApptProposal;
  currentApptInvoice = a.invoiceId && a.invoiceUrl ? { id: a.invoiceId, url: a.invoiceUrl } : null;
  $("appt-view-invoice").hidden = !currentApptInvoice;
  $("appt-invoice").hidden = !!currentApptInvoice;

  const isSeries = !!a.recurrenceId;
  const isTemplate = isSeries && a.isTemplate;

  // Repeat fields: editable when creating or editing the series template.
  $("appt-repeat-section").hidden = isVirtual || (isSeries && !isTemplate);
  if (isSeries && isTemplate) setRepeatFields(a.recurrence);
  else if (!isSeries) resetRepeatFields();

  $("appt-edit-series").hidden = true;
  $("appt-delete").hidden = false;
  if (isVirtual) {
    $("appt-series-note").textContent =
      "This is one occurrence of a repeating series — changes apply to this date only.";
    $("appt-series-note").hidden = false;
    $("appt-edit-series").hidden = false;
    $("appt-delete").textContent = "Skip this occurrence";
  } else if (isTemplate) {
    $("appt-series-note").textContent =
      "This is the first occurrence of a repeating series — changes apply to the whole series.";
    $("appt-series-note").hidden = false;
    $("appt-delete").textContent = "Delete series";
  } else if (isSeries) {
    $("appt-series-note").textContent = "This is a one-off change to a repeating series.";
    $("appt-series-note").hidden = false;
    $("appt-edit-series").hidden = false;
    $("appt-delete").textContent = "Delete this occurrence";
  } else {
    $("appt-series-note").hidden = true;
    $("appt-delete").textContent = "Delete";
  }
}

async function openEdit(id) {
  try {
    const a = await API.getAppointment(id);
    editingId = id;
    editingVirtual = null;
    currentAppt = a;
    $("appt-form-title").textContent = "Edit Appointment";
    fillForm(a);
    dialog.showModal();
  } catch (err) {
    alert(err.message);
  }
}

function openEditVirtual(id) {
  const v = virtualAppts[id];
  if (!v) return;
  editingId = null;
  editingVirtual = { recurrenceId: v.recurrenceId, date: v.date, templateId: v.templateId };
  currentAppt = v;
  $("appt-form-title").textContent = "Edit Occurrence";
  fillForm(v, { virtual: true });
  dialog.showModal();
}

// Switch from a single occurrence to editing the whole series.
$("appt-edit-series").addEventListener("click", async () => {
  const templateId = editingVirtual ? editingVirtual.templateId : currentAppt && currentAppt.templateId;
  if (!templateId) return;
  try {
    const t = await API.getAppointment(templateId);
    editingId = templateId;
    editingVirtual = null;
    currentAppt = t;
    $("appt-form-title").textContent = "Edit Series";
    fillForm(t);
  } catch (err) {
    alert(err.message);
  }
});

apptForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    clientName: $("appt-client").value.trim(),
    clientEmail: $("appt-email").value.trim() || null,
    clientPhone: $("appt-phone").value.trim() || null,
    date: $("appt-date").value,
    time: $("appt-time").value,
    durationMin: Number($("appt-duration").value) || 60,
    status: $("appt-status").value,
    notes: $("appt-notes").value.trim() || null,
    reminderMinutes: Number($("appt-reminder").value) || null,
  };
  try {
    if (editingVirtual) {
      // One-off override for this date of the series.
      await API.createOccurrence(editingVirtual.recurrenceId, payload);
    } else {
      const recurrence = buildRecurrencePayload();
      if (recurrence) payload.recurrence = recurrence;
      if (editingId) await API.updateAppointment(editingId, payload);
      else await API.createAppointment(payload);
    }
    dialog.close();
    loadWeek();
  } catch (err) {
    alert(err.message);
  }
});

$("appt-cancel").addEventListener("click", () => dialog.close());

$("appt-proposal").addEventListener("click", () => {
  if (currentApptProposal) {
    window.open(currentApptProposal.url + "/?proposal=" + currentApptProposal.id, "_blank");
  }
});

$("appt-view-invoice").addEventListener("click", () => {
  if (currentApptInvoice) {
    window.open(currentApptInvoice.url + "/?invoice=" + currentApptInvoice.id, "_blank");
  }
});

$("appt-delete").addEventListener("click", async () => {
  try {
    if (editingVirtual) {
      if (!confirm("Skip this occurrence? It will be marked cancelled for this date only.")) return;
      await API.createOccurrence(editingVirtual.recurrenceId, { date: editingVirtual.date, status: "cancelled" });
    } else if (editingId) {
      const a = currentAppt;
      if (a && a.recurrenceId && a.isTemplate) {
        if (!confirm("Delete the entire recurring series (all occurrences)?")) return;
        await API.deleteAppointment(editingId);
      } else if (a && a.recurrenceId) {
        if (!confirm("Delete this one-off change? The date will revert to the series.")) return;
        await API.deleteAppointment(editingId);
      } else {
        if (!confirm("Delete this appointment?")) return;
        await API.deleteAppointment(editingId);
      }
    } else {
      return;
    }
    dialog.close();
    loadWeek();
  } catch (err) {
    alert(err.message);
  }
});

// ═══════════════════════════════════════════════
// WORKFLOW: CREATE INVOICE (completed appointment)
// ═══════════════════════════════════════════════
$("appt-invoice").addEventListener("click", async () => {
  const url = $("invoiceUrl").value.trim().replace(/\/+$/, "");
  const token = API.token;
  if (!url || !token) {
    alert("Enter the Invoice URL and make sure you're signed in.");
    return;
  }
  localStorage.setItem("scheduling-tool.invoiceUrl", url);
  const date = $("appt-date").value;
  const time = $("appt-time").value;
  const durationMin = Number($("appt-duration").value) || 60;
  const payload = {
    clientName: $("appt-client").value.trim() || "Client",
    clientEmail: $("appt-email").value.trim() || null,
    status: "draft",
    issueDate: new Date().toISOString().slice(0, 10),
    lineItems: [
      {
        description: "Appointment " + date + " " + time + " (" + durationMin + " min)",
        qty: 1,
        price: 0,
      },
    ],
    notes: $("appt-notes").value.trim() || null,
  };
  try {
    const res = await fetch(url + "/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
    let message = "Invoice " + data.number + " created for " + payload.clientName + ".";
    // Link the invoice back to this appointment.
    if (editingId) {
      try {
        await API.updateAppointment(editingId, { invoiceId: data.id, invoiceUrl: url });
        currentApptInvoice = { id: data.id, url: url };
        $("appt-view-invoice").hidden = false;
        $("appt-invoice").hidden = true;
      } catch {
        // Non-fatal: the invoice was still created.
      }
    }
    // Workflow: mark the linked proposal as invoiced.
    if (currentApptProposal && currentApptProposal.url && currentApptProposal.id) {
      try {
        const pRes = await fetch(currentApptProposal.url + "/api/proposals/" + currentApptProposal.id + "/status", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ status: "invoiced" }),
        });
        if (pRes.ok) message += " Proposal marked as invoiced.";
      } catch {
        // Non-fatal: the invoice was still created.
      }
    }
    alert(message);
    if (confirm("Open the Invoice Generator?")) window.open(url, "_blank");
  } catch (err) {
    alert("Could not create invoice: " + err.message);
  }
});

// ═══════════════════════════════════════════════
// CLIENT TRACKER INTEGRATION
// ═══════════════════════════════════════════════
function loadTrackerSettings() {
  $("ctUrl").value = localStorage.getItem("scheduling-tool.ctUrl") || "http://localhost:3000";
  // Auto-fill the token from the shared SSO cookie (current session first).
  $("ctToken").value = getCookie("slugworth_token") || localStorage.getItem("scheduling-tool.ctToken") || "";
  $("invoiceUrl").value = localStorage.getItem("scheduling-tool.invoiceUrl") || "http://localhost:3002";
}

async function fetchClientsFromTracker() {
  const url = $("ctUrl").value.trim().replace(/\/+$/, "");
  const token = $("ctToken").value.trim();
  if (!url || !token) {
    alert("Enter the Client Tracker URL and API token.");
    return;
  }
  localStorage.setItem("scheduling-tool.ctUrl", url);
  localStorage.setItem("scheduling-tool.ctToken", token);
  try {
    const res = await fetch(url + "/api/clients", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) throw new Error("Client Tracker returned HTTP " + res.status);
    fetchedClients = await res.json();
    const select = $("ctClientSelect");
    select.innerHTML =
      '<option value="">— Select a client —</option>' +
      fetchedClients
        .map(
          (c) =>
            '<option value="' + escAttr(c.id) + '">' +
            escHtml(c.name) +
            (c.company ? " (" + escHtml(c.company) + ")" : "") +
            "</option>"
        )
        .join("");
    alert(fetchedClients.length + " clients loaded from Client Tracker");
  } catch (err) {
    alert("Could not reach Client Tracker: " + err.message);
  }
}

function applyTrackerClient() {
  const select = $("ctClientSelect");
  const id = select.value;
  if (!id) return;
  const client = fetchedClients.find((c) => String(c.id) === String(id));
  if (!client) return;
  // Prefill the booking dialog if it's open, otherwise just remember the selection.
  if (dialog.open) {
    $("appt-client").value = client.name || "";
    $("appt-email").value = client.email || "";
    $("appt-phone").value = client.phone || "";
  }
}

// ═══════════════════════════════════════════════
// AVAILABILITY WINDOWS
// ═══════════════════════════════════════════════
const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

async function openAvailability() {
  try {
    availability = await API.listAvailability();
  } catch (err) {
    alert(err.message);
    return;
  }
  const byDay = {};
  for (const w of availability) byDay[w.dayOfWeek] = w;
  $("avail-rows").innerHTML = DAY_LABELS.map((label, i) => {
    const w = byDay[i];
    return `<div class="avail-row">
      <label class="avail-day"><input type="checkbox" class="avail-enabled" data-day="${i}" ${w ? "checked" : ""} /> ${label}</label>
      <input type="time" class="avail-start" data-day="${i}" value="${w ? w.startTime : "09:00"}" />
      <span class="avail-to">to</span>
      <input type="time" class="avail-end" data-day="${i}" value="${w ? w.endTime : "17:00"}" />
    </div>`;
  }).join("");
  $("avail-dialog").showModal();
}

$("avail-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const windows = [];
  document.querySelectorAll(".avail-row").forEach((row) => {
    const enabled = row.querySelector(".avail-enabled");
    if (!enabled.checked) return;
    const startTime = row.querySelector(".avail-start").value;
    const endTime = row.querySelector(".avail-end").value;
    if (!startTime || !endTime) return;
    windows.push({ dayOfWeek: Number(enabled.dataset.day), startTime, endTime });
  });
  try {
    availability = await API.saveAvailability(windows);
    $("avail-dialog").close();
    loadWeek();
  } catch (err) {
    alert(err.message);
  }
});

$("avail-cancel").addEventListener("click", () => $("avail-dialog").close());

// ═══════════════════════════════════════════════
// EMAIL REMINDERS
// ═══════════════════════════════════════════════
async function openReminders() {
  const from = toISODate(new Date());
  const toDate = new Date();
  toDate.setDate(toDate.getDate() + 30);
  const to = toISODate(toDate);
  let reminders = [];
  try {
    const [list, health] = await Promise.all([API.listReminders({ from, to }), API.health()]);
    reminders = list;
    const smtp = !!(health.reminders && health.reminders.smtpConfigured);
    $("reminders-mode").textContent = smtp
      ? "SMTP is configured — reminders are sent as real emails."
      : "SMTP is not configured — reminders are logged to the server console. Set SMTP_HOST (and SMTP_USER/SMTP_PASS) to send real email.";
  } catch (err) {
    alert(err.message);
    return;
  }
  if (!reminders.length) {
    $("reminders-list").innerHTML = '<p class="empty">No reminders in the next 30 days.</p>';
  } else {
    $("reminders-list").innerHTML = reminders
      .map(
        (r) => `<div class="reminder-item ${r.status}">
          <div class="reminder-main">
            <strong>${escHtml(r.clientName)}</strong>
            <span class="reminder-when">${escHtml(r.date)} ${escHtml(r.time)}</span>
          </div>
          <div class="reminder-meta">
            <span>Remind: ${escHtml(r.remindAt)}</span>
            <span class="reminder-status">${r.status}</span>
            ${r.clientEmail ? `<span>→ ${escHtml(r.clientEmail)}</span>` : '<span class="muted">no email</span>'}
          </div>
        </div>`
      )
      .join("");
  }
  $("reminders-dialog").showModal();
}

$("reminders-close").addEventListener("click", () => $("reminders-dialog").close());

$("reminders-test").addEventListener("click", async () => {
  if (!confirm("Send a test reminder to your account email?")) return;
  try {
    const r = await API.testReminder();
    alert("Test email sent to " + r.to);
  } catch (err) {
    alert(err.message);
  }
});

// ═══════════════════════════════════════════════
// EXPORT / IMPORT
// ═══════════════════════════════════════════════
function exportJSON() {
  const payload = {
    exportedAt: new Date().toISOString(),
    appointments: appointments
      .filter((a) => !String(a.id).startsWith("r")) // skip derived occurrences
      .map((a) => ({
        clientName: a.clientName,
        clientEmail: a.clientEmail,
        clientPhone: a.clientPhone,
        date: a.date,
        time: a.time,
        durationMin: a.durationMin,
        notes: a.notes,
        status: a.status,
        reminderMinutes: a.reminderMinutes || null,
        recurrence: a.isTemplate ? a.recurrence : undefined,
      })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "appointments-week-" + toISODate(weekStart) + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const payload = JSON.parse(e.target.result);
      const list = Array.isArray(payload) ? payload : payload.appointments;
      if (!Array.isArray(list)) {
        alert("This doesn't appear to be a valid appointments file.");
        return;
      }
      if (!confirm("Import " + list.length + " appointment(s)? Existing appointments are kept.")) return;
      let created = 0;
      let conflicts = 0;
      for (const a of list) {
        try {
          await API.createAppointment({
            clientName: a.clientName || "Imported client",
            clientEmail: a.clientEmail || null,
            clientPhone: a.clientPhone || null,
            date: a.date,
            time: a.time,
            durationMin: a.durationMin || 60,
            notes: a.notes || null,
            status: a.status || "scheduled",
            reminderMinutes: a.reminderMinutes || null,
            recurrence: a.recurrence || undefined,
          });
          created++;
        } catch (err) {
          if (err.status === 409) conflicts++;
          else alert("Import error: " + err.message);
        }
      }
      alert("Imported " + created + " appointment(s)" + (conflicts ? ", skipped " + conflicts + " conflict(s)" : "") + ".");
      loadWeek();
    } catch {
      alert("Failed to parse JSON file.");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function exportCSV() {
  const rows = [
    ["Date", "Time", "Duration (min)", "Client", "Email", "Phone", "Status", "Notes"],
    ...appointments.map((a) => [
      a.date,
      a.time,
      a.durationMin,
      a.clientName,
      a.clientEmail || "",
      a.clientPhone || "",
      a.status,
      a.notes || "",
    ]),
  ];
  const csv = rows
    .map((r) => r.map((c) => '"' + String(c === undefined || c === null ? "" : c).replace(/"/g, '""') + '"').join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "appointments-week-" + toISODate(weekStart) + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════
function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function escAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
function init() {
  loadTrackerSettings();
  weekStart = mondayOf(new Date());
  loadWeek();
}

// ─── Boot ───
async function boot() {
  if (API.token) {
    try {
      await API.me();
      showApp();
      init();
    } catch {
      API.setToken(null);
      showAuth();
    }
  } else {
    showAuth();
  }
}
boot();