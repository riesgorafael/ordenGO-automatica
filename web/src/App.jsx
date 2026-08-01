import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  Plus, X, Search, Camera, Upload, Sparkles, Loader2, MapPin, Clock, ClipboardList,
  FileSignature, CheckCircle2, AlertTriangle, Download, Trash2, Play, Square,
  ChevronLeft, ChevronRight, Wrench, DollarSign, Building2, Filter, LayoutGrid,
  BarChart3, Users, UserPlus, Calendar, Flag, Folder, LogOut, Briefcase, KeyRound, FileText, Pencil,
} from "lucide-react";
import { api, setToken, getToken } from "./api";
import { orderReceiptPDF, monthlyReportPDF } from "./pdf";

/* ===================================== CONFIG ===================================== */
const CUR = "$";
const DEFAULT_RATE = 850;
const ROLES = { admin: "Administrador", gerente: "Gerencia / Gerente", tecnico: "Técnico de campo" };
const PALETTE = ["#0ea5e9", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#6366f1"];
const money = (n) => `${CUR}${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const O_STATUS = ["Borrador", "En progreso", "Completada", "Aprobada", "Facturada"];
const O_STYLE = {
  "Borrador": "bg-slate-100 text-slate-600 ring-slate-500/20", "En progreso": "bg-sky-50 text-sky-700 ring-sky-600/20",
  "Completada": "bg-amber-50 text-amber-700 ring-amber-600/20", "Aprobada": "bg-violet-50 text-violet-700 ring-violet-600/20",
  "Facturada": "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
};
const SERVICE_TYPES = ["Instalación", "Mantenimiento preventivo", "Mantenimiento correctivo", "Garantía", "Emergencia"];
const T_STATUS = ["Por hacer", "En progreso", "En revisión", "Hecho"];
const PRIORITIES = ["Baja", "Media", "Alta", "Urgente"];
const TYPES = ["Tarea", "Bug", "Mejora", "Historia"];
const T_STYLE = {
  "Por hacer": { chip: "bg-slate-100 text-slate-600 ring-slate-500/20", bar: "#94a3b8", col: "border-slate-300" },
  "En progreso": { chip: "bg-sky-50 text-sky-700 ring-sky-600/20", bar: "#0ea5e9", col: "border-sky-300" },
  "En revisión": { chip: "bg-violet-50 text-violet-700 ring-violet-600/20", bar: "#8b5cf6", col: "border-violet-300" },
  "Hecho": { chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", bar: "#10b981", col: "border-emerald-300" },
};
const prioMeta = { Baja: "bg-slate-100 text-slate-500", Media: "bg-sky-50 text-sky-700", Alta: "bg-amber-50 text-amber-700", Urgente: "bg-rose-50 text-rose-700" };
const typeMeta = { Tarea: "bg-sky-100 text-sky-700", Bug: "bg-rose-100 text-rose-700", Mejora: "bg-emerald-100 text-emerald-700", Historia: "bg-violet-100 text-violet-700" };

/* ===================================== Utils / IA ===================================== */
function fileToImages(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => { const img = new Image(); img.onload = () => {
      const mk = (max, q) => { const s = Math.min(1, max / Math.max(img.width, img.height)); const w = Math.round(img.width * s), h = Math.round(img.height * s);
        const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h); return c.toDataURL("image/jpeg", q); };
      resolve({ analysis: mk(1024, 0.8), thumb: mk(200, 0.55) }); };
      img.onerror = reject; img.src = rd.result; };
    rd.onerror = reject; rd.readAsDataURL(file);
  });
}
async function analyzeImage(dataUrl) { return api.analyze(dataUrl.split(",")[1]); }

function orderTotals(o) {
  const labor = o.laborBillable ? (Number(o.laborHours) || 0) * (Number(o.rate) || 0) : 0;
  const mats = (o.materials || []).filter((m) => m.billable).reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.price) || 0), 0);
  return { labor, mats, total: labor + mats };
}
function downloadFile(name, text) {
  try { const blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch { alert("La descarga no está disponible en este navegador."); }
}
const initials = (n) => (n || "?").split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
const todayStr = () => new Date().toISOString().slice(0, 10);
const isOverdue = (t) => t.due && t.due < todayStr() && t.status !== "Hecho";

const Chip = ({ children, className = "" }) => (<span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>{children}</span>);
const Box = ({ children, className = "" }) => (<div className={`rounded-xl border border-slate-200 bg-white ${className}`}>{children}</div>);
const Panel = ({ title, children }) => (<div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>{children}</div>);
const L = ({ label, children }) => <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>{children}</label>;
const Avatar = ({ user, size = 28 }) => (<div className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: user?.color || "#94a3b8", fontSize: size * 0.4 }} title={user?.name}>{initials(user?.name)}</div>);
const Metric = ({ label, value, icon: Icon, tint }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3">
    <div className="flex items-center justify-between"><span className="text-[11px] font-medium text-slate-500">{label}</span><Icon className={`h-4 w-4 ${tint}`} /></div>
    <div className="mt-0.5 text-lg font-semibold text-slate-900" style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
  </div>
);
const HealthBar = ({ v, color }) => (<div className="h-2 w-full rounded-full bg-slate-200"><div className="h-2 rounded-full" style={{ width: `${v}%`, background: color || "#0ea5e9" }} /></div>);

/* ===================================== APP ===================================== */
export default function App() {
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [orders, setOrders] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [module, setModule] = useState("orders");
  const [oView, setOView] = useState("list");
  const [oDetail, setODetail] = useState(null);
  const [oQ, setOQ] = useState(""); const [oStatus, setOStatus] = useState("Todas"); const [oBillable, setOBillable] = useState(false);
  const [oTab, setOTab] = useState("list");
  const [pTab, setPTab] = useState("board");
  const [pProj, setPProj] = useState("all"); const [pQ, setPQ] = useState(""); const [pMine, setPMine] = useState(false);
  const [editing, setEditing] = useState(undefined);
  const [pwOpen, setPwOpen] = useState(false);

  const boot = async () => {
    const d = await api.bootstrap();
    setMe(d.me); setUsers(d.users); setClients(d.clients); setProjects(d.projects); setOrders(d.orders); setTasks(d.tasks);
  };
  useEffect(() => { (async () => {
    if (getToken()) { try { await boot(); } catch { setToken(null); } }
    setBooting(false);
  })(); }, []);

  const logout = () => { setToken(null); setMe(null); setModule("orders"); setOView("list"); };
  const err = (e) => alert(e?.message || "Ocurrió un error");

  if (booting) return <div className="grid min-h-screen place-items-center bg-slate-900 text-slate-300"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!me) return <Login onLogin={async (email, password) => { const r = await api.login(email, password); setToken(r.token); await boot(); }} />;

  const isMgr = me.role === "admin" || me.role === "gerente";
  const isAdmin = me.role === "admin";
  const userById = (id) => users.find((u) => u.id === id);

  /* Órdenes */
  const nextFolio = () => { const y = new Date().getFullYear(); const n = orders.filter((o) => o.id.includes(`-${y}-`)).length + 1; return `OT-${y}-${String(n).padStart(3, "0")}`; };
  const onSaveOrder = async (o) => {
    try {
      if (o._newClient) { const c = await api.addClient(o._newClient); setClients((p) => [...p, c]); }
      delete o._newClient;
      const saved = await api.createOrder(o);
      setOrders((p) => [saved, ...p]); setOView("list");
    } catch (e) { err(e); }
  };
  const updateOrder = async (id, patch) => { try { const u = await api.updateOrder(id, patch); setOrders((p) => p.map((o) => (o.id === id ? u : o))); } catch (e) { err(e); } };
  const deleteOrder = async (id) => { if (!window.confirm(`¿Eliminar la orden ${id}? Esta acción no se puede deshacer.`)) return; try { await api.deleteOrder(id); setOrders((p) => p.filter((o) => o.id !== id)); setODetail(null); } catch (e) { err(e); } };
  const exportCSV = (rows, name) => {
    const head = ["Folio", "Fecha", "Cliente", "Sitio", "Tipo", "Estado", "Horas", "Mano de obra", "Materiales", "Total"];
    const lines = rows.map((o) => { const t = orderTotals(o); return [o.id, o.date, o.client, o.site, o.service, o.status, o.laborHours, t.labor.toFixed(2), t.mats.toFixed(2), t.total.toFixed(2)].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","); });
    downloadFile(name, [head.join(","), ...lines].join("\n"));
  };

  /* Proyectos */
  const onSaveTask = async (t) => { try { const s = await api.saveTask(t); setTasks((p) => (p.some((x) => x.id === s.id) ? p.map((x) => (x.id === s.id ? s : x)) : [s, ...p])); setEditing(undefined); } catch (e) { err(e); } };
  const onDeleteTask = async (id) => { try { await api.deleteTask(id); setTasks((p) => p.filter((x) => x.id !== id)); setEditing(undefined); } catch (e) { err(e); } };
  const moveTask = async (id, dir) => {
    const t = tasks.find((x) => x.id === id); if (!t) return;
    const i = T_STATUS.indexOf(t.status); const status = T_STATUS[Math.min(T_STATUS.length - 1, Math.max(0, i + dir))];
    try { const u = await api.updateTask(id, { status }); setTasks((p) => p.map((x) => (x.id === id ? u : x))); } catch (e) { err(e); }
  };
  const nextTaskId = (projectId) => { const key = projects.find((p) => p.id === projectId)?.key || "TASK"; const n = Math.max(0, ...tasks.filter((t) => t.id.startsWith(key + "-")).map((t) => parseInt(t.id.split("-")[1], 10) || 0)) + 1; return `${key}-${n}`; };
  const createProject = async () => {
    const name = prompt("Nombre del proyecto:"); if (!name) return;
    const key = (prompt("Clave (ej. AUT):") || "PRJ").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "PRJ";
    try { const p = await api.createProject({ key, name, color: PALETTE[projects.length % PALETTE.length] }); setProjects((x) => [...x, p]); } catch (e) { err(e); }
  };
  const editProject = async (id) => {
    const cur = projects.find((p) => p.id === id); if (!cur) return;
    const name = prompt("Nuevo nombre del proyecto:", cur.name); if (!name) return;
    try { const p = await api.updateProject(id, { name }); setProjects((x) => x.map((y) => (y.id === id ? p : y))); } catch (e) { err(e); }
  };
  const deleteProject = async (id) => {
    const cur = projects.find((p) => p.id === id); if (!cur) return;
    const n = tasks.filter((t) => t.project === id).length;
    if (!window.confirm(`¿Eliminar el proyecto "${cur.name}"${n ? ` y sus ${n} tarea(s)` : ""}? Esta acción no se puede deshacer.`)) return;
    try { await api.deleteProject(id); setProjects((x) => x.filter((y) => y.id !== id)); setTasks((x) => x.filter((t) => t.project !== id)); setPProj("all"); } catch (e) { err(e); }
  };

  /* Equipo */
  const addUser = async (nf) => { const u = await api.createUser(nf); setUsers((p) => [...p, u]); };
  const patchUser = async (id, patch) => { const u = await api.updateUser(id, patch); setUsers((p) => p.map((x) => (x.id === id ? u : x))); };
  const removeUser = async (id) => { await api.deleteUser(id); setUsers((p) => p.filter((x) => x.id !== id)); };

  if (module === "orders" && oView === "new")
    return <NewOrder ger={isMgr} me={me} folio={nextFolio()} clients={clients} onCancel={() => setOView("list")} onSave={onSaveOrder} />;

  const modTabs = [
    { id: "orders", label: "Órdenes", icon: ClipboardList },
    { id: "projects", label: "Proyectos", icon: LayoutGrid },
    ...(isAdmin ? [{ id: "team", label: "Equipo", icon: Users }] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900 text-slate-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-sky-500"><Briefcase className="h-5 w-5 text-white" /></div>
            <div className="leading-tight"><div className="text-sm font-semibold">Orden<span className="text-sky-400">GO</span> Suite</div><div className="text-[11px] text-slate-400">Órdenes de campo + Proyectos</div></div>
          </div>
          <div className="flex items-center gap-2">
            {module === "orders" && <button onClick={() => setOView("new")} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400"><Plus className="h-4 w-4" /> Orden</button>}
            {module === "projects" && <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400"><Plus className="h-4 w-4" /> Tarea</button>}
            <div className="hidden items-center gap-2 sm:flex"><Avatar user={me} size={26} /><div className="leading-tight"><div className="text-xs font-medium text-slate-200">{me.name.split(" ")[0]}</div><div className="text-[10px] text-slate-400">{ROLES[me.role]}</div></div></div>
            <button onClick={() => setPwOpen(true)} title="Cambiar contraseña" className="rounded-lg p-2 text-slate-300 hover:bg-slate-800"><KeyRound className="h-4 w-4" /></button>
            <button onClick={logout} title="Cerrar sesión" className="rounded-lg p-2 text-slate-300 hover:bg-slate-800"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="mx-auto max-w-6xl overflow-x-auto px-2">
          <nav className="flex gap-1 pb-1">
            {modTabs.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setModule(id)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-medium transition ${module === id ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}><Icon className="h-4 w-4" /> {label}</button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        {module === "orders" && (
          <>
            {isMgr && (
              <div className="mb-4 flex w-fit rounded-lg bg-slate-200 p-0.5">
                {[["list", "Órdenes", ClipboardList], ["report", "Reporte mensual", BarChart3]].map(([id, lb, Ic]) => (
                  <button key={id} onClick={() => setOTab(id)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium ${oTab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}><Ic className="h-4 w-4" /> {lb}</button>
                ))}
              </div>
            )}
            {(!isMgr || oTab === "list")
              ? <OrdersHome {...{ orders, ger: isMgr, oQ, setOQ, oStatus, setOStatus, oBillable, setOBillable, exportCSV, onOpen: setODetail }} />
              : <MonthlyReport orders={orders} />}
          </>
        )}
        {module === "projects" && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="mr-1 flex rounded-lg bg-slate-200 p-0.5">
                {[["board", "Tablero", LayoutGrid], ["reports", "Reportes", BarChart3]].map(([id, lb, Ic]) => (
                  <button key={id} onClick={() => setPTab(id)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium ${pTab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}><Ic className="h-4 w-4" /> {lb}</button>
                ))}
              </div>
              <select value={pProj} onChange={(e) => setPProj(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium">
                <option value="all">Todos los proyectos</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
              </select>
              {pTab === "board" && (<>
                <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={pQ} onChange={(e) => setPQ(e.target.value)} placeholder="Buscar tarea…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20" /></div>
                <button onClick={() => setPMine((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium ${pMine ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600"}`}><Avatar user={me} size={18} /> Mis tareas</button>
                {isMgr && <button onClick={createProject} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:border-sky-400 hover:text-sky-600"><Folder className="h-4 w-4" /> Proyecto</button>}
                {isMgr && pProj !== "all" && <button onClick={() => editProject(pProj)} title="Renombrar proyecto" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>}
                {isMgr && pProj !== "all" && <button onClick={() => deleteProject(pProj)} title="Eliminar proyecto" className="rounded-lg border border-rose-200 bg-white p-2 text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>}
              </>)}
            </div>
            {(() => {
              const vis = tasks.filter((t) => (pProj === "all" || t.project === pProj) && (!pMine || t.assignee === me.id) && (!pQ || `${t.id} ${t.title} ${t.desc}`.toLowerCase().includes(pQ.toLowerCase())));
              return pTab === "board" ? <Board tasks={vis} userById={userById} onOpen={setEditing} onMove={moveTask} /> : <Reports tasks={vis} users={users} projects={projects} proj={pProj} />;
            })()}
          </>
        )}
        {module === "team" && isAdmin && <Team users={users} tasks={tasks} orders={orders} me={me} onAdd={addUser} onPatch={patchUser} onRemove={removeUser} onErr={err} />}

        <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-400">Conectado al servidor · {me.name} ({ROLES[me.role]})</footer>
      </main>

      {oDetail && <OrderDetail ger={isMgr} order={orders.find((o) => o.id === oDetail.id) || oDetail} onClose={() => setODetail(null)} onUpdate={updateOrder} onAdvance={(id, st) => updateOrder(id, { status: st })} onExport={(o) => exportCSV([o], `${o.id}.csv`)} onDelete={deleteOrder} />}
      {editing !== undefined && <TaskModal task={editing} me={me} users={users.filter((u) => u.active)} projects={projects} canAssign={isMgr} nextId={nextTaskId} onClose={() => setEditing(undefined)} onSave={onSaveTask} onDelete={onDeleteTask} />}
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}

      <style>{`.u-input{width:100%;border-radius:0.5rem;border:1px solid rgb(226 232 240);background:#fff;padding:0.5rem 0.625rem;font-size:0.875rem;color:#1e293b;outline:none}.u-input:focus{border-color:rgb(14 165 233);box-shadow:0 0 0 3px rgb(14 165 233/.15)}`}</style>
    </div>
  );
}

/* ===================================== LOGIN ===================================== */
function Login({ onLogin }) {
  const [email, setEmail] = useState(""); const [pass, setPass] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); setErr(""); try { await onLogin(email.trim(), pass); } catch (e) { setErr(e?.message || "No se pudo iniciar sesión"); setBusy(false); } };
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-sky-500"><Briefcase className="h-6 w-6 text-white" /></div>
          <div className="text-lg font-semibold text-white">Orden<span className="text-sky-400">GO</span> Suite</div>
          <div className="text-xs text-slate-400">Inicia sesión con tu cuenta</div>
        </div>
        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-800 p-4">
          <L2 label="Correo"><input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} type="email" placeholder="correo@empresa.com" className="in" /></L2>
          <L2 label="Contraseña"><input value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} type="password" placeholder="••••••••" className="in" /></L2>
          {err && <div className="text-xs text-rose-400">{err}</div>}
          <button onClick={submit} disabled={busy || !email || !pass} className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Entrar</button>
        </div>
        <p className="mt-3 text-center text-[11px] text-slate-500">¿Olvidaste tu contraseña? Contacta al administrador.</p>
      </div>
      <style>{`.in{width:100%;border-radius:0.5rem;border:1px solid rgb(71 85 105);background:rgb(15 23 42);padding:0.5rem 0.625rem;font-size:0.9rem;color:#fff;outline:none}.in:focus{border-color:rgb(14 165 233)}`}</style>
    </div>
  );
}
const L2 = ({ label, children }) => <label className="block"><span className="mb-1 block text-xs font-medium text-slate-300">{label}</span>{children}</label>;

/* ===================================== CAMBIAR CONTRASEÑA ===================================== */
function ChangePassword({ onClose }) {
  const [cur, setCur] = useState(""); const [n1, setN1] = useState(""); const [n2, setN2] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [done, setDone] = useState(false);
  const submit = async () => {
    setMsg("");
    if (n1.length < 6) { setMsg("La nueva contraseña debe tener al menos 6 caracteres."); return; }
    if (n1 !== n2) { setMsg("Las contraseñas nuevas no coinciden."); return; }
    setBusy(true);
    try { await api.changePassword(cur, n1); setDone(true); }
    catch (e) { setMsg(e?.message || "No se pudo cambiar la contraseña."); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-semibold text-slate-900">Cambiar contraseña</h3><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        {done ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-5 w-5" /> Contraseña actualizada correctamente.</div>
            <button onClick={onClose} className="w-full rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400">Listo</button>
          </div>
        ) : (
          <div className="space-y-3">
            <L label="Contraseña actual"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} className="u-input" /></L>
            <L label="Nueva contraseña"><input type="password" value={n1} onChange={(e) => setN1(e.target.value)} className="u-input" /></L>
            <L label="Repetir nueva contraseña"><input type="password" value={n2} onChange={(e) => setN2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="u-input" /></L>
            {msg && <div className="text-xs text-rose-600">{msg}</div>}
            <button onClick={submit} disabled={busy || !cur || !n1} className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===================================== ÓRDENES: HOME ===================================== */
function OrdersHome({ orders, ger, oQ, setOQ, oStatus, setOStatus, oBillable, setOBillable, exportCSV, onOpen }) {
  const pendingBill = orders.filter((o) => o.status === "Completada" || o.status === "Aprobada");
  const unsigned = orders.filter((o) => o.status === "Completada" && !o.signatureUrl);
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthOrders = orders.filter((o) => (o.date || "").startsWith(monthKey));
  const monthTotal = monthOrders.reduce((s, o) => s + orderTotals(o).total, 0);
  const monthPending = monthOrders.filter((o) => o.status !== "Facturada" && o.status !== "Borrador").reduce((s, o) => s + orderTotals(o).total, 0);
  const filtered = orders.filter((o) => (oStatus === "Todas" || o.status === oStatus) && (!oBillable || o.status === "Completada" || o.status === "Aprobada") && `${o.id} ${o.client} ${o.site} ${o.service} ${o.equipo}`.toLowerCase().includes(oQ.toLowerCase()));
  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Órdenes del mes" value={monthOrders.length} icon={ClipboardList} tint="text-sky-600" />
        {ger ? (<>
          <Metric label="Total del mes" value={money(monthTotal)} icon={DollarSign} tint="text-emerald-600" />
          <Metric label="Por facturar" value={money(monthPending)} icon={AlertTriangle} tint="text-amber-600" />
        </>) : (<>
          <Metric label="Completadas" value={monthOrders.filter((o) => o.status === "Completada" || o.status === "Aprobada").length} icon={CheckCircle2} tint="text-emerald-600" />
          <Metric label="En progreso" value={monthOrders.filter((o) => o.status === "En progreso").length} icon={Clock} tint="text-sky-600" />
        </>)}
        <Metric label="Sin firma" value={unsigned.length} icon={FileSignature} tint="text-rose-600" />
      </div>
      <div className="mb-5 space-y-2">
        {ger && pendingBill.length > 0 && (<div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{pendingBill.length} orden(es) completadas pendientes de facturar.</span><button onClick={() => { setOBillable(true); setOStatus("Todas"); }} className="shrink-0 rounded-md bg-white/70 px-2 py-1 text-xs font-medium hover:bg-white">Ver facturables</button></div>)}
        {unsigned.length > 0 && (<div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><FileSignature className="mt-0.5 h-4 w-4 shrink-0" />{unsigned.length} orden(es) completadas sin firma del cliente.</div>)}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={oQ} onChange={(e) => setOQ(e.target.value)} placeholder="Buscar folio, cliente, equipo…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20" /></div>
        <select value={oStatus} onChange={(e) => setOStatus(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"><option>Todas</option>{O_STATUS.map((s) => <option key={s}>{s}</option>)}</select>
        {ger && (<>
          <button onClick={() => setOBillable((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium ${oBillable ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-600"}`}><Filter className="h-4 w-4" /> Facturables</button>
          <button onClick={() => exportCSV(filtered, `ordenes_${monthKey}.csv`)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Download className="h-4 w-4" /> CSV</button>
        </>)}
      </div>
      <div className="space-y-3">
        {filtered.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No hay órdenes que coincidan.</div>}
        {filtered.map((o) => { const t = orderTotals(o); return (
          <button key={o.id} onClick={() => onOpen(o)} className="block w-full text-left">
            <Box className="p-4 transition hover:border-slate-300 hover:shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-slate-800">{o.id}</span>
                <Chip className={O_STYLE[o.status]}>{o.status}</Chip>
                {o.category && <Chip className="bg-sky-50 text-sky-700 ring-sky-600/20"><Sparkles className="h-3 w-3" />{o.category}</Chip>}
                <span className="ml-auto text-sm font-semibold text-slate-900">{ger ? money(t.total) : <span className="text-slate-400">{o.laborHours || 0} h</span>}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-800"><Building2 className="h-3.5 w-3.5 text-slate-400" />{o.client}</div>
              <div className="text-xs text-slate-500">{o.site} · {o.service} · {o.date}</div>
              {o.equipo && <div className="mt-1 truncate text-xs text-slate-500">Equipo: {o.equipo}</div>}
            </Box>
          </button>
        ); })}
      </div>
    </div>
  );
}

/* ===================================== ÓRDENES: REPORTE MENSUAL ===================================== */
function MonthlyReport({ orders }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const monthOrders = orders.filter((o) => (o.date || "").startsWith(month) && o.status !== "Borrador");
  const groups = {};
  monthOrders.forEach((o) => {
    const t = orderTotals(o);
    const g = groups[o.client] || (groups[o.client] = { client: o.client, count: 0, hours: 0, labor: 0, mats: 0, total: 0, facturado: 0, pendiente: 0 });
    g.count++; g.hours += Number(o.laborHours) || 0; g.labor += t.labor; g.mats += t.mats; g.total += t.total;
    if (o.status === "Facturada") g.facturado += t.total; else g.pendiente += t.total;
  });
  const rows = Object.values(groups).sort((a, b) => b.total - a.total);
  const sum = rows.reduce((s, r) => ({ count: s.count + r.count, total: s.total + r.total, facturado: s.facturado + r.facturado, pendiente: s.pendiente + r.pendiente }), { count: 0, total: 0, facturado: 0, pendiente: 0 });
  const monthLabel = new Date(month + "-01T00:00:00").toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  const chart = rows.slice(0, 8).map((r) => ({ name: r.client.length > 14 ? r.client.slice(0, 13) + "…" : r.client, value: Math.round(r.total), fill: "#0ea5e9" }));
  const exportCSV = () => {
    const head = ["Cliente", "Órdenes", "Horas", "Mano de obra", "Materiales", "Total", "Facturado", "Por facturar"];
    const lines = rows.map((r) => [r.client, r.count, r.hours, r.labor.toFixed(2), r.mats.toFixed(2), r.total.toFixed(2), r.facturado.toFixed(2), r.pendiente.toFixed(2)].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    downloadFile(`reporte_${month}.csv`, [head.join(","), ...lines].join("\n"));
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm" />
        <span className="text-sm font-medium capitalize text-slate-600">{monthLabel}</span>
        <div className="ml-auto flex gap-2">
          <button onClick={exportCSV} disabled={!rows.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"><Download className="h-4 w-4" /> CSV</button>
          <button onClick={() => monthlyReportPDF(month, monthLabel, rows, sum)} disabled={!rows.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"><FileText className="h-4 w-4" /> PDF</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Clientes" value={rows.length} icon={Building2} tint="text-sky-600" />
        <Metric label="Órdenes" value={sum.count} icon={ClipboardList} tint="text-slate-600" />
        <Metric label="Facturado" value={money(sum.facturado)} icon={CheckCircle2} tint="text-emerald-600" />
        <Metric label="Por facturar" value={money(sum.pendiente)} icon={AlertTriangle} tint="text-amber-600" />
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No hay órdenes en {monthLabel}.</div>
      ) : (
        <>
          <Panel title="Facturación por cliente"><ChartBox data={chart} /></Panel>
          <div className="space-y-2">
            {rows.map((r) => (
              <Box key={r.client} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Building2 className="h-4 w-4 text-slate-400" />
                  <span className="text-sm font-semibold text-slate-800">{r.client}</span>
                  <span className="text-xs text-slate-400">{r.count} orden(es) · {r.hours} h</span>
                  <span className="ml-auto text-sm font-semibold text-slate-900">{money(r.total)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Mano de obra: <b className="font-medium text-slate-700">{money(r.labor)}</b></span>
                  <span>Materiales: <b className="font-medium text-slate-700">{money(r.mats)}</b></span>
                  <span className="text-emerald-600">Facturado: {money(r.facturado)}</span>
                  {r.pendiente > 0 && <span className="text-amber-600">Por facturar: {money(r.pendiente)}</span>}
                </div>
              </Box>
            ))}
            <Box className="p-4"><div className="flex items-center justify-between text-sm font-semibold text-slate-900"><span className="capitalize">Total {monthLabel}</span><span>{money(sum.total)}</span></div></Box>
          </div>
        </>
      )}
    </div>
  );
}

/* ===================================== ÓRDENES: DETALLE ===================================== */
function OrderDetail({ ger, order, onClose, onUpdate, onAdvance, onExport, onDelete }) {
  const idx = O_STATUS.indexOf(order.status);
  const next = idx >= 0 && idx < O_STATUS.length - 1 ? O_STATUS[idx + 1] : null;
  const needSign = next === "Aprobada" && !order.signatureUrl;
  const canAdvance = next && (next !== "Facturada" || ger);
  const [rate, setRate] = useState(order.rate || DEFAULT_RATE);
  const [mats, setMats] = useState(order.materials || []);
  const [laborBillable, setLaborBillable] = useState(order.laborBillable);
  const [sig, setSig] = useState(null); const [sigBy, setSigBy] = useState("");
  useEffect(() => { setRate(order.rate || DEFAULT_RATE); setMats(order.materials || []); setLaborBillable(order.laborBillable); setSig(null); setSigBy(""); }, [order.id]);
  const t = orderTotals({ ...order, rate, materials: mats, laborBillable });
  const dirty = ger && (rate !== order.rate || laborBillable !== order.laborBillable || JSON.stringify(mats) !== JSON.stringify(order.materials));
  const savePrices = () => onUpdate(order.id, { rate: Number(rate) || 0, materials: mats.map((m) => ({ ...m, price: Number(m.price) || 0, qty: Number(m.qty) || 0 })), laborBillable });
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3"><div className="flex items-center gap-2"><span className="font-mono text-sm font-semibold text-slate-800">{order.id}</span><Chip className={O_STYLE[order.status]}>{order.status}</Chip></div><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="space-y-4 p-5">
          <section><div className="text-base font-semibold text-slate-900">{order.client}</div><div className="text-sm text-slate-500">{order.site}{order.contact ? ` · ${order.contact}` : ""}</div><div className="mt-1 text-xs text-slate-500">{order.service} · {order.date}{order.tech ? ` · Técnico: ${order.tech}` : ""}</div>{order.location && <div className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" />{order.location.lat.toFixed(4)}, {order.location.lng.toFixed(4)}</div>}</section>
          {(order.equipo || order.sintoma || order.solucion) && (<section className="rounded-lg bg-slate-50 p-3 text-sm">{order.equipo && <p><span className="font-medium text-slate-700">Equipo:</span> {order.equipo}</p>}{order.sintoma && <p className="mt-1"><span className="font-medium text-slate-700">Síntoma:</span> {order.sintoma}</p>}{order.solucion && <p className="mt-1"><span className="font-medium text-slate-700">Trabajo:</span> {order.solucion}</p>}</section>)}
          {order.photos && order.photos.length > 0 && (<section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Evidencia</h4><div className="flex flex-wrap gap-2">{order.photos.map((p, i) => (<div key={i} className="relative"><img src={p.url} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-200" /><span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 text-center text-[9px] text-white">{p.cat}</span></div>))}</div></section>)}
          <section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Mano de obra y materiales</h4><div className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex items-center justify-between text-slate-600"><span>Horas de trabajo</span><span className="font-medium text-slate-800">{order.laborHours || 0} h{order.technicians ? ` · ${order.technicians} téc.` : ""}</span></div>
            {ger && <div className="mt-2 flex items-center gap-2"><span className="text-slate-600">Tarifa/h:</span><input type="number" value={rate} onChange={(e) => setRate(e.target.value)} className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm" /><label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={laborBillable} onChange={(e) => setLaborBillable(e.target.checked)} /> Facturable</label></div>}
            {mats.length > 0 && <ul className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">{mats.map((m, i) => (<li key={i} className="text-sm"><div className="flex items-center justify-between"><span className="text-slate-700">{m.qty}× {m.name || "—"}</span>{ger && <span className="text-xs text-slate-500">{money((m.qty || 0) * (m.price || 0))}</span>}</div>{ger && <div className="mt-1 flex items-center gap-2"><span className="text-xs text-slate-500">P. unit:</span><input type="number" value={m.price} onChange={(e) => setMats((x) => x.map((y, j) => j === i ? { ...y, price: e.target.value } : y))} className="w-24 rounded-md border border-slate-200 px-2 py-1 text-xs" /><label className="ml-auto flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" checked={m.billable} onChange={(e) => setMats((x) => x.map((y, j) => j === i ? { ...y, billable: e.target.checked } : y))} /> Facturable</label></div>}</li>))}</ul>}
          </div></section>
          {ger && (<section className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm"><div className="flex items-center justify-between text-slate-600"><span>Mano de obra</span><span className="font-medium text-slate-800">{money(t.labor)}</span></div><div className="flex items-center justify-between text-slate-600"><span>Materiales facturables</span><span className="font-medium text-slate-800">{money(t.mats)}</span></div><div className="mt-2 flex items-center justify-between border-t border-emerald-200 pt-2 font-semibold text-slate-900"><span>Total</span><span>{money(t.total)}</span></div>{dirty && <button onClick={savePrices} className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500">Guardar precios</button>}</section>)}
          {order.signatureUrl && (<section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Conformidad del cliente</h4>{order.signatureUrl !== "signed" ? <img src={order.signatureUrl} alt="firma" className="h-20 rounded-lg border border-slate-200 bg-white" /> : <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">Firmada</div>}{order.signedBy && <div className="mt-1 text-xs text-slate-500">Firmó: {order.signedBy}</div>}</section>)}
          {!order.signatureUrl && order.status !== "Borrador" && (<section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Firma del cliente</h4><SignaturePad key={order.id} onChange={setSig} /><input value={sigBy} onChange={(e) => setSigBy(e.target.value)} placeholder="Nombre de quien firma" className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20" /><button disabled={!sig} onClick={() => onUpdate(order.id, { signatureUrl: sig, signedBy: sigBy })} className="mt-2 w-full rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50">Guardar firma</button></section>)}
          <section className="flex flex-wrap gap-2 pt-1">
            {canAdvance && <button disabled={needSign} onClick={() => onAdvance(order.id, next)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Marcar {next}</button>}
            {needSign && <span className="self-center text-xs text-rose-600">Requiere firma del cliente para aprobar.</span>}
            {next === "Facturada" && !ger && <span className="self-center text-xs text-slate-400">La facturación la realiza Gerencia.</span>}
            <button onClick={() => orderReceiptPDF(order, ger)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><FileText className="h-4 w-4" /> Comprobante PDF</button>
            {ger && <button onClick={() => onExport(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Download className="h-4 w-4" /> Exportar</button>}
            {ger && onDelete && <button onClick={() => onDelete(order.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /> Eliminar</button>}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ===================================== ÓRDENES: NUEVA ===================================== */
function NewOrder({ ger, me, folio, clients, onSave, onCancel }) {
  const [clientMode, setClientMode] = useState("existing");
  const [clientId, setClientId] = useState(clients[0]?.id || "");
  const [newClient, setNewClient] = useState({ name: "", site: "" });
  const [contact, setContact] = useState(""); const [tech, setTech] = useState(me.name);
  const [service, setService] = useState(SERVICE_TYPES[1]);
  const [equipo, setEquipo] = useState(""); const [sintoma, setSintoma] = useState(""); const [solucion, setSolucion] = useState(""); const [category, setCategory] = useState("");
  const [photos, setPhotos] = useState([]); const [analyzing, setAnalyzing] = useState(false);
  const [rate, setRate] = useState(DEFAULT_RATE); const [laborHours, setLaborHours] = useState(""); const [technicians, setTechnicians] = useState(1); const [laborBillable, setLaborBillable] = useState(true);
  const [materials, setMaterials] = useState([]); const [location, setLocation] = useState(null); const [geoMsg, setGeoMsg] = useState("");
  const [signatureUrl, setSignatureUrl] = useState(null); const [signedBy, setSignedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false); const startRef = useRef(0); const [elapsed, setElapsed] = useState(0);
  useEffect(() => { if (!running) return; const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000); return () => clearInterval(t); }, [running]);
  const toggleTimer = () => { if (!running) { startRef.current = Date.now() - elapsed * 1000; setRunning(true); } else { setRunning(false); setLaborHours((elapsed / 3600 + (Number(laborHours) || 0)).toFixed(2)); setElapsed(0); } };
  const fmt = `${String(Math.floor(elapsed / 3600)).padStart(2, "0")}:${String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const addPhoto = async (file, cat) => { if (!file) return; setAnalyzing(true); try { const { analysis, thumb } = await fileToImages(file); setPhotos((p) => [...p, { url: thumb, cat, ts: new Date().toISOString() }]); try { const r = await analyzeImage(analysis); if (!equipo && r.equipo) setEquipo(r.equipo); if (!category && r.category) setCategory(r.category); if (!solucion && r.description) setSolucion(r.description); } catch {} } finally { setAnalyzing(false); } };
  const captureLocation = () => { if (!navigator.geolocation) { setGeoMsg("No disponible."); return; } setGeoMsg("Obteniendo…"); navigator.geolocation.getCurrentPosition((pos) => { setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoMsg(""); }, () => setGeoMsg("Permiso denegado."), { timeout: 8000 }); };
  const addMaterial = () => setMaterials((m) => [...m, { name: "", qty: 1, price: 0, billable: true }]);
  const setMat = (i, patch) => setMaterials((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const delMat = (i) => setMaterials((m) => m.filter((_, j) => j !== i));
  const client = clientMode === "existing" ? clients.find((c) => c.id === clientId) : { name: newClient.name, site: newClient.site };
  const preview = orderTotals({ laborHours, rate, laborBillable, materials });
  const canSave = client && client.name && (laborHours || materials.length || solucion);
  const canComplete = canSave && !!signatureUrl;
  const save = async (status) => {
    setSaving(true);
    const o = { id: folio, client: client.name, site: client.site || "", contact, tech, service, date: todayStr(), createdAt: new Date().toISOString(), equipo, sintoma, solucion, category, location, photos, signatureUrl, signedBy, laborHours: Number(laborHours) || 0, technicians: Number(technicians) || 1, rate: Number(rate) || DEFAULT_RATE, laborBillable, materials: materials.map((m) => ({ ...m, qty: Number(m.qty) || 0, price: Number(m.price) || 0 })), status };
    if (clientMode === "new" && newClient.name) o._newClient = { id: "c" + Date.now(), name: newClient.name, site: newClient.site };
    await onSave(o); setSaving(false);
  };
  return (
    <div className="min-h-screen bg-slate-100" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900 text-slate-100"><div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3"><button onClick={onCancel} className="rounded-md p-1 text-slate-300 hover:bg-slate-800"><ChevronLeft className="h-5 w-5" /></button><div className="leading-tight"><div className="text-sm font-semibold">Nueva orden</div><div className="font-mono text-[11px] text-sky-400">{folio}</div></div></div></header>
      <main className="mx-auto max-w-lg space-y-4 px-4 py-5 pb-28">
        <Section title="Cliente y sitio">
          <div className="mb-2 flex gap-2"><Toggle active={clientMode === "existing"} onClick={() => setClientMode("existing")}>Directorio</Toggle><Toggle active={clientMode === "new"} onClick={() => setClientMode("new")}>Cliente nuevo</Toggle></div>
          {clientMode === "existing" ? (<select value={clientId} onChange={(e) => setClientId(e.target.value)} className="u-input">{clients.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.site}</option>)}</select>) : (<div className="space-y-2"><input value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} placeholder="Nombre del cliente" className="u-input" /><input value={newClient.site} onChange={(e) => setNewClient({ ...newClient, site: e.target.value })} placeholder="Sitio / ubicación" className="u-input" /></div>)}
          <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Persona de contacto (opcional)" className="u-input mt-2" />
          <input value={tech} onChange={(e) => setTech(e.target.value)} placeholder="Técnico responsable" className="u-input mt-2" />
          <div className="mt-2 flex items-center gap-2"><button onClick={captureLocation} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><MapPin className="h-3.5 w-3.5" /> Capturar ubicación</button>{location && <span className="text-xs text-emerald-600">{location.lat.toFixed(4)}, {location.lng.toFixed(4)}</span>}{geoMsg && <span className="text-xs text-slate-500">{geoMsg}</span>}</div>
        </Section>
        <Section title="Tipo de servicio"><div className="flex flex-wrap gap-2">{SERVICE_TYPES.map((s) => (<button key={s} onClick={() => setService(s)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${service === s ? "border-sky-400 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600"}`}>{s}</button>))}</div></Section>
        <Section title="Documentación del trabajo">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500"><Sparkles className="h-3.5 w-3.5 text-sky-500" /> Las fotos autocompletan equipo y descripción con IA</div>
          <div className="grid grid-cols-3 gap-2"><PhotoBtn icon={Camera} label="Antes" cat="antes" capture onPick={addPhoto} /><PhotoBtn icon={Camera} label="Durante" cat="durante" capture onPick={addPhoto} /><PhotoBtn icon={Upload} label="Después" cat="después" onPick={addPhoto} /></div>
          {analyzing && <div className="mt-2 flex items-center gap-2 text-xs text-sky-700"><Loader2 className="h-4 w-4 animate-spin" /> Analizando imagen…</div>}
          {photos.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{photos.map((p, i) => (<div key={i} className="relative"><img src={p.url} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-slate-200" /><span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 text-center text-[9px] text-white">{p.cat}</span><button onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 shadow ring-1 ring-slate-200"><X className="h-3 w-3 text-slate-500" /></button></div>))}</div>}
          {category && <div className="mt-2"><Chip className="bg-sky-50 text-sky-700 ring-sky-600/20"><Sparkles className="h-3 w-3" />{category}</Chip></div>}
          <input value={equipo} onChange={(e) => setEquipo(e.target.value)} placeholder="Equipo / sistema intervenido" className="u-input mt-2" />
          <input value={sintoma} onChange={(e) => setSintoma(e.target.value)} placeholder="Síntoma o falla reportada" className="u-input mt-2" />
          <textarea value={solucion} onChange={(e) => setSolucion(e.target.value)} rows={3} placeholder="Trabajo realizado / solución aplicada" className="u-input mt-2 resize-none" />
        </Section>
        <Section title="Mano de obra">
          <div className="flex items-center gap-2"><button onClick={toggleTimer} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white ${running ? "bg-rose-500 hover:bg-rose-400" : "bg-emerald-600 hover:bg-emerald-500"}`}>{running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />} {running ? "Detener" : "Cronómetro"}</button>{(running || elapsed > 0) && <span className="font-mono text-sm text-slate-600"><Clock className="mr-1 inline h-3.5 w-3.5" />{fmt}</span>}</div>
          <div className={`mt-2 grid gap-2 ${ger ? "grid-cols-3" : "grid-cols-2"}`}><L label="Horas"><input type="number" value={laborHours} onChange={(e) => setLaborHours(e.target.value)} placeholder="0" className="u-input" /></L><L label="Técnicos"><input type="number" value={technicians} onChange={(e) => setTechnicians(e.target.value)} className="u-input" /></L>{ger && <L label="Tarifa/h"><input type="number" value={rate} onChange={(e) => setRate(e.target.value)} className="u-input" /></L>}</div>
          {ger && <label className="mt-2 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={laborBillable} onChange={(e) => setLaborBillable(e.target.checked)} /> Facturable</label>}
        </Section>
        <Section title="Materiales y repuestos usados">
          <div className="space-y-2">{materials.map((m, i) => (<div key={i} className="flex items-center gap-2"><input value={m.name} onChange={(e) => setMat(i, { name: e.target.value })} placeholder="Descripción del material" className="u-input flex-1" /><input type="number" value={m.qty} onChange={(e) => setMat(i, { qty: e.target.value })} className="u-input w-14" title="Cantidad" />{ger && <input type="number" value={m.price} onChange={(e) => setMat(i, { price: e.target.value })} placeholder="Precio" className="u-input w-20" />}{ger && <button onClick={() => setMat(i, { billable: !m.billable })} className={`rounded-md p-1.5 ${m.billable ? "text-emerald-600" : "text-slate-300"}`}><DollarSign className="h-4 w-4" /></button>}<button onClick={() => delMat(i)} className="rounded-md p-1.5 text-slate-400 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button></div>))}</div>
          <button onClick={addMaterial} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-sky-400 hover:text-sky-600"><Plus className="h-3.5 w-3.5" /> Agregar material</button>
          {!ger && <p className="mt-2 text-[11px] text-slate-400">Registra qué materiales usaste y en qué cantidad. Los precios los asigna Gerencia.</p>}
        </Section>
        <Section title="Conformidad del cliente · obligatoria"><SignaturePad onChange={setSignatureUrl} /><input value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Nombre de quien firma" className="u-input mt-2" />{!signatureUrl && <p className="mt-1 text-[11px] text-amber-600">La firma del cliente es obligatoria para completar la orden.</p>}</Section>
        {ger && (<Box className="p-4"><div className="flex items-center justify-between text-sm text-slate-600"><span>Mano de obra</span><span>{money(preview.labor)}</span></div><div className="flex items-center justify-between text-sm text-slate-600"><span>Materiales</span><span>{money(preview.mats)}</span></div><div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-1 text-base font-semibold text-slate-900"><span>Total</span><span>{money(preview.total)}</span></div></Box>)}
      </main>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur"><div className="mx-auto max-w-lg">{canSave && !signatureUrl && <div className="mb-2 flex items-center gap-1.5 text-[11px] text-amber-600"><FileSignature className="h-3.5 w-3.5" /> Falta la firma del cliente para completar. Puedes guardar como borrador.</div>}<div className="flex gap-2"><button disabled={saving} onClick={() => save("Borrador")} className="flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Guardar borrador</button><button onClick={() => save("Completada")} disabled={!canComplete || saving} className="flex-[2] inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar y completar</button></div></div></div>
      <style>{`.u-input{width:100%;border-radius:0.5rem;border:1px solid rgb(226 232 240);background:#fff;padding:0.5rem 0.625rem;font-size:0.875rem;color:#1e293b;outline:none}.u-input:focus{border-color:rgb(14 165 233);box-shadow:0 0 0 3px rgb(14 165 233/.15)}`}</style>
    </div>
  );
}
const Section = ({ title, children }) => <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>{children}</div>;
const Toggle = ({ active, onClick, children }) => <button onClick={onClick} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${active ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-600"}`}>{children}</button>;
function PhotoBtn({ icon: Icon, label, cat, capture, onPick }) {
  return (<label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white py-3 text-[11px] font-medium text-slate-600 transition hover:border-sky-400 hover:text-sky-600"><Icon className="h-4 w-4" /> {label}<input type="file" accept="image/*" {...(capture ? { capture: "environment" } : {})} className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; onPick(f, cat); }} /></label>);
}
function SignaturePad({ onChange }) {
  const ref = useRef(null); const drawing = useRef(false); const last = useRef(null);
  const point = (e) => { const c = ref.current, r = c.getBoundingClientRect(); const s = e.touches ? e.touches[0] : e; return { x: (s.clientX - r.left) * (c.width / r.width), y: (s.clientY - r.top) * (c.height / r.height) }; };
  const start = (e) => { e.preventDefault(); drawing.current = true; last.current = point(e); };
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const c = ref.current, ctx = c.getContext("2d"), p = point(e); ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last.current = p; };
  const end = () => { if (drawing.current) { drawing.current = false; onChange(ref.current.toDataURL("image/png")); } };
  const clear = () => { const c = ref.current; c.getContext("2d").clearRect(0, 0, c.width, c.height); onChange(null); };
  return (<div><canvas ref={ref} width={320} height={140} className="w-full touch-none rounded-lg border border-slate-300 bg-slate-50" onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end} onTouchStart={start} onTouchMove={move} onTouchEnd={end} /><div className="mt-1 flex items-center justify-between"><span className="text-[11px] text-slate-400">Firme con el dedo o el mouse</span><button onClick={clear} className="text-xs font-medium text-slate-500 hover:text-slate-700">Borrar</button></div></div>);
}

/* ===================================== PROYECTOS: TABLERO ===================================== */
function Board({ tasks, userById, onOpen, onMove }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {T_STATUS.map((st) => { const col = tasks.filter((t) => t.status === st); const m = T_STYLE[st]; return (
        <div key={st} className={`rounded-xl border-t-4 ${m.col} bg-slate-50/60`}>
          <div className="flex items-center justify-between px-3 py-2"><span className="text-sm font-semibold text-slate-700">{st}</span><span className="rounded-full bg-white px-2 text-xs font-medium text-slate-500 ring-1 ring-slate-200">{col.length}</span></div>
          <div className="space-y-2 px-2 pb-3">
            {col.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">Sin tareas</div>}
            {col.map((t) => { const idx = T_STATUS.indexOf(t.status); return (
              <div key={t.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <button onClick={() => onOpen(t)} className="block w-full text-left">
                  <div className="flex items-center gap-1.5"><Chip className={`${typeMeta[t.type]} ring-1 ring-inset ring-black/5`}>{t.type}</Chip>{isOverdue(t) && <Chip className="bg-rose-50 text-rose-700 ring-rose-600/20"><AlertTriangle className="h-3 w-3" />Vencida</Chip>}</div>
                  <div className="mt-1.5 text-sm font-medium leading-snug text-slate-800">{t.title}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400"><span className="font-mono">{t.id}</span>{t.due && <span className="inline-flex items-center gap-0.5"><Calendar className="h-3 w-3" />{t.due.slice(5)}</span>}</div>
                </button>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5"><Avatar user={userById(t.assignee)} size={22} /><Chip className={`${prioMeta[t.priority]} ring-1 ring-inset ring-black/5`}><Flag className="h-3 w-3" />{t.priority}</Chip></div>
                  <div className="flex gap-1"><button onClick={() => onMove(t.id, -1)} disabled={idx === 0} className="rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button><button onClick={() => onMove(t.id, 1)} disabled={idx === T_STATUS.length - 1} className="rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button></div>
                </div>
              </div>
            ); })}
          </div>
        </div>
      ); })}
    </div>
  );
}

/* ===================================== PROYECTOS: MODAL TAREA ===================================== */
function TaskModal({ task, me, users, projects, canAssign, nextId, onClose, onSave, onDelete }) {
  const editingExisting = !!task;
  const [f, setF] = useState(() => task || { id: null, project: projects[0]?.id || "", title: "", desc: "", assignee: me.id, status: "Por hacer", priority: "Media", type: "Tarea", due: "" });
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const save = () => { if (!f.title.trim()) return; onSave({ ...f, id: f.id || nextId(f.project), createdAt: f.createdAt || todayStr() }); };
  const assignable = canAssign ? users : users.filter((u) => u.id === me.id);
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-semibold text-slate-900">{editingExisting ? f.id : "Nueva tarea"}</h3><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="space-y-3">
          <input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="Título de la tarea" className="u-input text-sm font-medium" />
          <textarea value={f.desc} onChange={(e) => set({ desc: e.target.value })} rows={3} placeholder="Descripción / criterios" className="u-input resize-none" />
          <div className="grid grid-cols-2 gap-3"><L label="Proyecto"><select value={f.project} onChange={(e) => set({ project: e.target.value })} disabled={editingExisting} className="u-input">{projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}</select></L><L label="Responsable"><select value={f.assignee} onChange={(e) => set({ assignee: e.target.value })} className="u-input">{assignable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></L></div>
          <div className="grid grid-cols-3 gap-3"><L label="Estado"><select value={f.status} onChange={(e) => set({ status: e.target.value })} className="u-input">{T_STATUS.map((s) => <option key={s}>{s}</option>)}</select></L><L label="Prioridad"><select value={f.priority} onChange={(e) => set({ priority: e.target.value })} className="u-input">{PRIORITIES.map((s) => <option key={s}>{s}</option>)}</select></L><L label="Tipo"><select value={f.type} onChange={(e) => set({ type: e.target.value })} className="u-input">{TYPES.map((s) => <option key={s}>{s}</option>)}</select></L></div>
          <L label="Fecha límite"><input type="date" value={f.due} onChange={(e) => set({ due: e.target.value })} className="u-input" /></L>
        </div>
        <div className="mt-5 flex gap-2">{editingExisting && <button onClick={() => onDelete(f.id)} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>}<button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button><button onClick={save} disabled={!f.title.trim()} className="flex-1 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50">{editingExisting ? "Guardar" : "Crear"}</button></div>
      </div>
    </div>
  );
}

/* ===================================== PROYECTOS: REPORTES ===================================== */
function Reports({ tasks, users, projects, proj }) {
  const done = tasks.filter((t) => t.status === "Hecho").length;
  const wip = tasks.filter((t) => t.status === "En progreso" || t.status === "En revisión").length;
  const overdue = tasks.filter(isOverdue).length;
  const byStatus = T_STATUS.map((s) => ({ name: s, value: tasks.filter((t) => t.status === s).length, fill: T_STYLE[s].bar }));
  const byAssignee = users.filter((u) => u.active).map((u) => ({ name: u.name.split(" ")[0], value: tasks.filter((t) => t.assignee === u.id).length, fill: u.color }));
  const projList = proj === "all" ? projects : projects.filter((p) => p.id === proj);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Tareas" value={tasks.length} icon={LayoutGrid} tint="text-sky-600" /><Metric label="Completadas" value={done} icon={CheckCircle2} tint="text-emerald-600" /><Metric label="En curso" value={wip} icon={Clock} tint="text-violet-600" /><Metric label="Vencidas" value={overdue} icon={AlertTriangle} tint="text-rose-600" /></div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><Panel title="Tareas por estado"><ChartBox data={byStatus} /></Panel><Panel title="Carga por responsable"><ChartBox data={byAssignee} /></Panel></div>
      <Panel title="Progreso por proyecto"><div className="space-y-3">{projList.map((p) => { const ts = tasks.filter((t) => t.project === p.id); const d = ts.filter((t) => t.status === "Hecho").length; const pct = ts.length ? Math.round((d / ts.length) * 100) : 0; return (<div key={p.id}><div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium text-slate-700"><span className="font-mono text-xs" style={{ color: p.color }}>{p.key}</span> {p.name}</span><span className="text-slate-500">{d}/{ts.length} · {pct}%</span></div><HealthBar v={pct} color={p.color} /></div>); })}</div></Panel>
    </div>
  );
}
function ChartBox({ data }) {
  return (<div style={{ width: "100%", height: 220 }}><ResponsiveContainer><BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: "#f1f5f9" }} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} /><Bar dataKey="value" radius={[5, 5, 0, 0]}>{data.map((d, i) => <Cell key={i} fill={d.fill} />)}</Bar></BarChart></ResponsiveContainer></div>);
}

/* ===================================== EQUIPO (ADMIN) ===================================== */
function Team({ users, tasks, orders, me, onAdd, onPatch, onRemove, onErr }) {
  const [nf, setNf] = useState({ name: "", role: "tecnico", email: "", password: "" });
  const add = async () => { if (!nf.name.trim() || !nf.email.trim()) return; try { await onAdd({ ...nf }); setNf({ name: "", role: "tecnico", email: "", password: "" }); } catch (e) { onErr(e); } };
  const wrap = (fn) => async (...a) => { try { await fn(...a); } catch (e) { onErr(e); } };
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2"><Panel title={`Empleados (${users.length}) · directorio compartido`}>
        <div className="space-y-2">{users.map((u) => { const load = tasks.filter((t) => t.assignee === u.id && t.status !== "Hecho").length; const ords = orders.filter((o) => o.tech === u.name).length; return (
          <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3">
            <Avatar user={u} size={38} />
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-800">{u.name}{u.id === me.id && <span className="ml-1 text-[11px] text-slate-400">(tú)</span>}</div><div className="truncate text-xs text-slate-500">{u.email} · {load} tarea(s) · {ords} orden(es)</div></div>
            <select value={u.role} onChange={(e) => wrap(onPatch)(u.id, { role: e.target.value })} disabled={u.id === me.id} className="rounded-md border border-slate-200 px-2 py-1 text-xs disabled:opacity-60">{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <button onClick={() => wrap(onPatch)(u.id, { active: !u.active })} disabled={u.id === me.id} className={`rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40 ${u.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{u.active ? "Activo" : "Inactivo"}</button>
            <button onClick={() => wrap(onRemove)(u.id)} disabled={u.id === me.id} className="rounded-md p-1.5 text-slate-400 hover:text-rose-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
          </div>
        ); })}</div>
      </Panel></div>
      <div><Panel title="Nuevo empleado">
        <div className="space-y-2"><L label="Nombre"><input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="Nombre y apellido" className="u-input" /></L><L label="Correo"><input value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} placeholder="correo@empresa.com" className="u-input" /></L><L label="Contraseña inicial"><input value={nf.password} onChange={(e) => setNf({ ...nf, password: e.target.value })} placeholder="(opcional; usa la de por defecto)" className="u-input" /></L><L label="Rol"><select value={nf.role} onChange={(e) => setNf({ ...nf, role: e.target.value })} className="u-input">{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></L><button onClick={add} disabled={!nf.name.trim() || !nf.email.trim()} className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"><UserPlus className="h-4 w-4" /> Crear perfil</button><p className="text-[11px] text-slate-400">Este directorio se usa en Órdenes y en Proyectos. El técnico luego cambia su contraseña con el administrador.</p></div>
      </Panel></div>
    </div>
  );
}
