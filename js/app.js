// Scheduling Tool — starter app logic.
// Appointments are stored in localStorage so they survive page reloads.

const STORAGE_KEY = "scheduling-tool.appointments";

function loadAppointments() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveAppointments(appointments) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
}

function formatDateTime(date, time) {
  const [year, month, day] = date.split("-");
  const [hour, minute] = time.split(":");
  const d = new Date(year, month - 1, day, hour, minute);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderAppointments() {
  const list = document.getElementById("appointment-list");
  const appointments = loadAppointments().sort((a, b) =>
    a.dateTime.localeCompare(b.dateTime)
  );

  if (appointments.length === 0) {
    list.innerHTML = '<li class="empty">No appointments yet.</li>';
    return;
  }

  list.innerHTML = appointments
    .map(
      (appt) =>
        `<li><strong>${escapeHtml(appt.client)}</strong> — ${escapeHtml(
          appt.dateTime
        )}</li>`
    )
    .join("");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

document.getElementById("booking-form").addEventListener("submit", (event) => {
  event.preventDefault();

  const date = document.getElementById("appt-date").value;
  const time = document.getElementById("appt-time").value;

  const appointment = {
    client: document.getElementById("client-name").value.trim(),
    date,
    time,
    dateTime: formatDateTime(date, time),
    createdAt: new Date().toISOString(),
  };

  const appointments = loadAppointments();
  appointments.push(appointment);
  saveAppointments(appointments);

  const status = document.getElementById("status");
  status.textContent = `Booked ${appointment.client} for ${appointment.dateTime}.`;
  status.hidden = false;

  event.target.reset();
  renderAppointments();
});

renderAppointments();