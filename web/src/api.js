const BASE = "/api";
// La credencial real vive en una cookie HttpOnly; JavaScript solo recuerda que debe intentar
// restaurar la sesión. Esto evita que un XSS pueda extraer el JWT desde localStorage.
let token = localStorage.getItem("og_session_active") === "1";
localStorage.removeItem("og_token");

export function setToken(t) {
  token = Boolean(t);
  if (token) localStorage.setItem("og_session_active", "1");
  else localStorage.removeItem("og_session_active");
}
export function getToken() { return token; }

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401 && path !== "/auth/login") { setToken(null); throw new Error("Sesión expirada"); }
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(msg.error || "Error de servidor");
    error.status = res.status;
    // El cuerpo completo queda disponible: algunos errores traen datos que la UI necesita para
    // ofrecer una salida (ej. cuál es el gasto duplicado), no solo el mensaje.
    error.payload = msg;
    throw error;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  login: (email, password) => req("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => req("/auth/logout", { method: "POST" }),
  getBranding: () => { const organization = new URLSearchParams(window.location.search).get("organization") || new URLSearchParams(window.location.search).get("empresa"); return req("/branding" + (organization ? `?organization=${encodeURIComponent(organization)}` : "")); },
  bootstrap: () => req("/bootstrap"),
  changePassword: (current, next) => req("/me/password", { method: "POST", body: JSON.stringify({ current, next }) }),
  // Ficha propia (foto y datos de contacto para la credencial). Ruta separada de /users/:id: esa
  // exige rol admin porque además cambia rol, estado y contraseña.
  updateMyProfile: (profile) => req("/me/profile", { method: "PATCH", body: JSON.stringify(profile) }),

  addClient: (c) => req("/clients", { method: "POST", body: JSON.stringify(c) }),
  updateClient: (id, patch) => req("/clients/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteClient: (id) => req("/clients/" + id, { method: "DELETE" }),

  stockMovements: (partId) => req(`/parts/${partId}/movements`),
  auditLog: () => req("/audit-log"),

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

  // Remitos de trabajo: acreditan la entrega ante el cliente, sin importes.
  createDeliveryNote: (note) => req("/delivery-notes", { method: "POST", body: JSON.stringify(note) }),
  updateDeliveryNote: (id, patch) => req("/delivery-notes/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteDeliveryNote: (id) => req("/delivery-notes/" + id, { method: "DELETE" }),
  updateMaterialList: (id, patch) => req("/material-lists/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteMaterialList: (id) => req("/material-lists/" + id, { method: "DELETE" }),

  createWhiteboardNote: (note) => req("/whiteboard-notes", { method: "POST", body: JSON.stringify(note) }),
  updateWhiteboardNote: (id, patch) => req("/whiteboard-notes/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteWhiteboardNote: (id) => req("/whiteboard-notes/" + id, { method: "DELETE" }),

  orders: (updatedSince = "") => req("/orders" + (updatedSince ? `?updated_since=${encodeURIComponent(updatedSince)}` : "")),
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
  financePeriodLocks: () => req("/finance-period-locks"),
  setFinancePeriodLock: (period, locked) => req("/finance-period-locks/" + period, { method: "PUT", body: JSON.stringify({ locked }) }),
  // force omite la caché del servidor: lo usa el botón de refrescar manual.
  wholesaleExchangeRate: (force = false) => req("/exchange-rates/wholesale" + (force ? "?force=1" : "")),

  tasks: (updatedSince = "") => req("/tasks" + (updatedSince ? `?updated_since=${encodeURIComponent(updatedSince)}` : "")),
  saveTask: (t) => req("/tasks", { method: "POST", body: JSON.stringify(t) }),
  updateTask: (id, patch) => req("/tasks/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTask: (id) => req("/tasks/" + id, { method: "DELETE" }),

  createUser: (u) => req("/users", { method: "POST", body: JSON.stringify(u) }),
  updateUser: (id, patch) => req("/users/" + id, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteUser: (id) => req("/users/" + id, { method: "DELETE" }),
  updateBranding: (branding) => req("/settings/branding", { method: "PUT", body: JSON.stringify(branding) }),
  companyProfile: () => req("/settings/company-profile"),
  updateCompanyProfile: (profile) => req("/settings/company-profile", { method: "PUT", body: JSON.stringify(profile) }),

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
      credentials: "same-origin",
      body: form,
    });
    if (!res.ok) { const msg = await res.json().catch(() => ({ error: res.statusText })); throw new Error(msg.error || "Error de servidor"); }
    return res.json();
  },
};
