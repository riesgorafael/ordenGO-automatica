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
  if (res.status === 401 && path !== "/auth/login") { setToken(null); throw new Error("Sesión expirada"); }
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(msg.error || "Error de servidor");
    error.status = res.status;
    throw error;
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

  addSupplier: (s) => req("/suppliers", { method: "POST", body: JSON.stringify(s) }),
  updateSupplier: (id, patch) => req("/suppliers/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteSupplier: (id) => req("/suppliers/" + id, { method: "DELETE" }),

  createPurchaseOrder: (po) => req("/purchase-orders", { method: "POST", body: JSON.stringify(po) }),
  updatePurchaseOrder: (id, patch) => req("/purchase-orders/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deletePurchaseOrder: (id) => req("/purchase-orders/" + id, { method: "DELETE" }),

  createMaterialList: (ml) => req("/material-lists", { method: "POST", body: JSON.stringify(ml) }),
  updateMaterialList: (id, patch) => req("/material-lists/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteMaterialList: (id) => req("/material-lists/" + id, { method: "DELETE" }),

  createWhiteboardNote: (note) => req("/whiteboard-notes", { method: "POST", body: JSON.stringify(note) }),
  updateWhiteboardNote: (id, patch) => req("/whiteboard-notes/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteWhiteboardNote: (id) => req("/whiteboard-notes/" + id, { method: "DELETE" }),

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
  // force omite la caché del servidor: lo usa el botón de refrescar manual.
  wholesaleExchangeRate: (force = false) => req("/exchange-rates/wholesale" + (force ? "?force=1" : "")),

  tasks: () => req("/tasks"),
  saveTask: (t) => req("/tasks", { method: "POST", body: JSON.stringify(t) }),
  updateTask: (id, patch) => req("/tasks/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTask: (id) => req("/tasks/" + id, { method: "DELETE" }),

  createUser: (u) => req("/users", { method: "POST", body: JSON.stringify(u) }),
  updateUser: (id, patch) => req("/users/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteUser: (id) => req("/users/" + id, { method: "DELETE" }),
  updateBranding: (branding) => req("/settings/branding", { method: "PUT", body: JSON.stringify(branding) }),

  notifications: () => req("/notifications"),
  readNotification: (id) => req("/notifications/" + id + "/read", { method: "POST" }),
  readAllNotifications: () => req("/notifications/read-all", { method: "POST" }),
  commentOrder: (id, text) => req("/orders/" + id + "/comment", { method: "POST", body: JSON.stringify({ text }) }),
  commentTask: (id, text) => req("/tasks/" + id + "/comment", { method: "POST", body: JSON.stringify({ text }) }),

  ganttTasks: (projectId) => req(`/projects/${projectId}/gantt-tasks`),
  createGanttTask: (projectId, task) => req(`/projects/${projectId}/gantt-tasks`, { method: "POST", body: JSON.stringify(task) }),
  updateGanttTask: (id, patch) => req(`/gantt-tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteGanttTask: (id) => req(`/gantt-tasks/${id}`, { method: "DELETE" }),
  // Multipart: no pasa por req() porque el archivo va como FormData, no JSON.
  importMpp: async (projectId, file) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/projects/${projectId}/import-mpp`, {
      method: "POST",
      headers: token ? { Authorization: "Bearer " + token } : {},
      body: form,
    });
    if (!res.ok) { const msg = await res.json().catch(() => ({ error: res.statusText })); throw new Error(msg.error || "Error de servidor"); }
    return res.json();
  },
};
