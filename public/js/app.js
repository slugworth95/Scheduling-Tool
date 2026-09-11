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
let fetchedClients = [];

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
    appointments = await API.listAppointments({ from, to });
  } catch (err) {
    appointments = [];
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

    html += `<div class="day-column">
      <div class="day-header${isToday ? " today" : ""}">
        ${DAY_NAMES[i]} <span class="day-date">${day.getMonth() + 1}/${day.getDate()}</span>
      </div>
      <div class="day-body" data-date="${dateStr}">`;

    // Clickable hour slots
    for (let h = SLOT_START_HOUR; h < SLOT_END_HOUR; h++) {
      const timeStr = String(h).padStart(2, "0") + ":00";
      html += `<div class="slot" data-date="${dateStr}" data-time="${timeStr}"></div>`;
    }

    // Appointment blocks
    dayAppts.forEach((a) => {
      const startMin = toMinutes(a.time);
      const top = ((startMin - SLOT_START_HOUR * 60) / 60) * SLOT_HEIGHT;
      const height = Math.max((a.durationMin / 60) * SLOT_HEIGHT, 24);
      const timeLabel = a.time.slice(0, 5);
      html += `<div class="appt-block ${a.status}" data-id="${a.id}" style="top:${top}px;height:${height}px;">
        <div class="appt-time">${timeLabel} · ${a.durationMin}m</div>
        <div class="appt-name">${escHtml(a.clientName)}</div>
      </div>`;
    });

    html += "</div></div>";
  }

  grid.innerHTML = html;

  // Wire up clicks
  grid.querySelectorAll(".slot").forEach((slot) => {
    slot.addEventListener("click", () => openBooking(slot.dataset.date, slot.dataset.time));
  });
  grid.querySelectorAll(".appt-block").forEach((block) => {
    block.addEventListener("click", () => openEdit(Number(block.dataset.id)));
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

function openBooking(date, time) {
  editingId = null;
  $("appt-form-title").textContent = "Book Appointment";
  apptForm.reset();
  $("appt-date").value = date || toISODate(new Date());
  $("appt-time").value = time || "09:00";
  $("appt-status").value = "scheduled";
  $("appt-delete").hidden = true;
  dialog.showModal();
}

async function openEdit(id) {
  try {
    const a = await API.getAppointment(id);
    editingId = id;
    $("appt-form-title").textContent = "Edit Appointment";
    $("appt-client").value = a.clientName || "";
    $("appt-email").value = a.clientEmail || "";
    $("appt-phone").value = a.clientPhone || "";
    $("appt-date").value = a.date || "";
    $("appt-time").value = a.time || "";
    $("appt-duration").value = String(a.durationMin || 60);
    $("appt-status").value = a.status || "scheduled";
    $("appt-notes").value = a.notes || "";
    $("appt-delete").hidden = false;
    dialog.showModal();
  } catch (err) {
    alert(err.message);
  }
}

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
  };
  try {
    if (editingId) await API.updateAppointment(editingId, payload);
    else await API.createAppointment(payload);
    dialog.close();
    loadWeek();
  } catch (err) {
    alert(err.message);
  }
});

$("appt-cancel").addEventListener("click", () => dialog.close());

$("appt-delete").addEventListener("click", async () => {
  if (!editingId) return;
  if (!confirm("Delete this appointment?")) return;
  try {
    await API.deleteAppointment(editingId);
    dialog.close();
    loadWeek();
  } catch (err) {
    alert(err.message);
  }
});

// ═══════════════════════════════════════════════
// CLIENT TRACKER INTEGRATION
// ═══════════════════════════════════════════════
function loadTrackerSettings() {
  $("ctUrl").value = localStorage.getItem("scheduling-tool.ctUrl") || "http://localhost:3000";
  $("ctToken").value = localStorage.getItem("scheduling-tool.ctToken") || "";
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
// EXPORT / IMPORT
// ═══════════════════════════════════════════════
function exportJSON() {
  const payload = {
    exportedAt: new Date().toISOString(),
    appointments: appointments.map((a) => ({
      clientName: a.clientName,
      clientEmail: a.clientEmail,
      clientPhone: a.clientPhone,
      date: a.date,
      time: a.time,
      durationMin: a.durationMin,
      notes: a.notes,
      status: a.status,
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