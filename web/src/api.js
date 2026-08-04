const BASE = "/api";
let token = localStorage.getItem("og_token") || null;

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem("og_token", t);
  else localStorage.removeItem("og_token");
}
export function getToken() { return token; }

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) { setToken(null); throw new Error("Sesión expirada"); }
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(msg.error || "Error de servidor");
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  login: (email, password) => req("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  getBranding: () => req("/branding"),
  bootstrap: () => req("/bootstrap"),
  changePassword: (current, next) => req("/me/password", { method: "POST", body: JSON.stringify({ current, next }) }),

  addClient: (c) => req("/clients", { method: "POST", body: JSON.stringify(c) }),
  updateClient: (id, patch) => req("/clients/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteClient: (id) => req("/clients/" + id, { method: "DELETE" }),

  addPart: (p) => req("/parts", { method: "POST", body: JSON.stringify(p) }),
  updatePart: (id, patch) => req("/parts/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deletePart: (id) => req("/parts/" + id, { method: "DELETE" }),

  orders: () => req("/orders"),
  createOrder: (o) => req("/orders", { method: "POST", body: JSON.stringify(o) }),
  updateOrder: (id, patch) => req("/orders/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteOrder: (id) => req("/orders/" + id, { method: "DELETE" }),

  createProject: (p) => req("/projects", { method: "POST", body: JSON.stringify(p) }),
  updateProject: (id, patch) => req("/projects/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteProject: (id) => req("/projects/" + id, { method: "DELETE" }),
  duplicateProject: (id, opts) => req("/projects/" + id + "/duplicate", { method: "POST", body: JSON.stringify(opts || {}) }),

  createBudget: (budget) => req("/budgets", { method: "POST", body: JSON.stringify(budget) }),
  updateBudget: (id, patch) => req("/budgets/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteBudget: (id) => req("/budgets/" + id, { method: "DELETE" }),
  convertBudget: (id, options) => req("/budgets/" + id + "/convert", { method: "POST", body: JSON.stringify(options || {}) }),

  createFinance: (movement) => req("/finances", { method: "POST", body: JSON.stringify(movement) }),
  getFinance: (id) => req("/finances/" + id),
  updateFinance: (id, patch) => req("/finances/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteFinance: (id) => req("/finances/" + id, { method: "DELETE" }),
  bnaExchangeRate: () => req("/exchange-rates/bna"),

  saveTask: (t) => req("/tasks", { method: "POST", body: JSON.stringify(t) }),
  updateTask: (id, patch) => req("/tasks/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTask: (id) => req("/tasks/" + id, { method: "DELETE" }),

  createUser: (u) => req("/users", { method: "POST", body: JSON.stringify(u) }),
  updateUser: (id, patch) => req("/users/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteUser: (id) => req("/users/" + id, { method: "DELETE" }),
  updateBranding: (branding) => req("/settings/branding", { method: "PUT", body: JSON.stringify(branding) }),

  analyze: (image) => req("/ai/analyze", { method: "POST", body: JSON.stringify({ image }) }),

  notifications: () => req("/notifications"),
  readNotification: (id) => req("/notifications/" + id + "/read", { method: "POST" }),
  readAllNotifications: () => req("/notifications/read-all", { method: "POST" }),
  commentOrder: (id, text) => req("/orders/" + id + "/comment", { method: "POST", body: JSON.stringify({ text }) }),
  commentTask: (id, text) => req("/tasks/" + id + "/comment", { method: "POST", body: JSON.stringify({ text }) }),
};
