// Thin fetch wrapper around the Scheduling Tool API.
// Stores the bearer token in localStorage.

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const API = {
  token: localStorage.getItem("scheduling-tool.token") || null,

  async request(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await fetch(path, { ...options, headers });

    if (res.status === 401) {
      this.setToken(null);
      throw new ApiError(401, "Session expired. Please sign in again.");
    }
    if (res.status === 204) return null;

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
    }
    return data;
  },

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem("scheduling-tool.token", token);
    else localStorage.removeItem("scheduling-tool.token");
  },

  register(name, email, password) {
    return this.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
  },

  login(email, password) {
    return this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  listAppointments(params = {}) {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.search) qs.set("search", params.search);
    const q = qs.toString();
    return this.request(`/api/appointments${q ? `?${q}` : ""}`);
  },

  getAppointment(id) {
    return this.request(`/api/appointments/${id}`);
  },

  createAppointment(appt) {
    return this.request("/api/appointments", { method: "POST", body: JSON.stringify(appt) });
  },

  updateAppointment(id, appt) {
    return this.request(`/api/appointments/${id}`, { method: "PUT", body: JSON.stringify(appt) });
  },

  deleteAppointment(id) {
    return this.request(`/api/appointments/${id}`, { method: "DELETE" });
  },
};