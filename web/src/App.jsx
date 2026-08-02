import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend, LineChart, Line } from "recharts";
import {
  Plus, X, Search, Camera, Upload, Sparkles, Loader2, MapPin, Clock, ClipboardList,
  FileSignature, CheckCircle2, AlertTriangle, Download, Trash2, Play, Square,
  ChevronLeft, ChevronRight, Wrench, DollarSign, Building2, Filter, LayoutGrid,
  BarChart3, Users, UserPlus, Calendar, Flag, Folder, LogOut, Briefcase, KeyRound, FileText, Pencil,
  Bell, Home, MessageSquare, Copy, Link2, TrendingUp, TrendingDown,
} from "lucide-react";
import { api, setToken, getToken } from "./api";
import { LOGO, LOGO_LIGHT } from "./logo";
import { orderReceiptPDF, monthlyReportPDF } from "./pdf";

/* ===================================== CONFIG ===================================== */
const CUR = "$";
const DEFAULT_RATE = 850;
const ROLES = { admin: "Administrador", gerente: "Gerencia / Gerente", tecnico: "Técnico de campo", tecnico_oficina: "Técnico de oficina" };
const PALETTE = ["#0ea5e9", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#6366f1"];
const money = (n) => `${CUR}${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const O_STATUS = ["Borrador", "En progreso", "Completada", "Aprobada", "Facturada"];
const O_STYLE = {
  "Borrador": "bg-slate-100 text-slate-600 ring-slate-500/20", "En progreso": "bg-brand-50 text-brand-700 ring-brand-600/20",
  "Completada": "bg-amber-50 text-amber-700 ring-amber-600/20", "Aprobada": "bg-violet-50 text-violet-700 ring-violet-600/20",
  "Facturada": "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
};
const SERVICE_TYPES = ["Instalación", "Mantenimiento preventivo", "Mantenimiento correctivo", "Garantía", "Emergencia"];
const T_STATUS = ["Por hacer", "En progreso", "En revisión", "Hecho"];
const PRIORITIES = ["Baja", "Media", "Alta", "Urgente"];
const TYPES = ["Tarea", "Bug", "Mejora", "Historia"];
const T_STYLE = {
  "Por hacer": { chip: "bg-slate-100 text-slate-600 ring-slate-500/20", bar: "#94a3b8", col: "border-slate-300" },
  "En progreso": { chip: "bg-brand-50 text-brand-700 ring-brand-600/20", bar: "#F18700", col: "border-brand-300" },
  "En revisión": { chip: "bg-violet-50 text-violet-700 ring-violet-600/20", bar: "#8b5cf6", col: "border-violet-300" },
  "Hecho": { chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", bar: "#10b981", col: "border-emerald-300" },
};
const prioMeta = { Baja: "bg-slate-100 text-slate-500", Media: "bg-brand-50 text-brand-700", Alta: "bg-amber-50 text-amber-700", Urgente: "bg-rose-50 text-rose-700" };
const typeMeta = { Tarea: "bg-brand-100 text-brand-700", Bug: "bg-rose-100 text-rose-700", Mejora: "bg-emerald-100 text-emerald-700", Historia: "bg-violet-100 text-violet-700" };

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
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function orderCosts(o) {
  const labor = (Number(o.laborHours) || 0) * (Number(o.laborCost) || 0);
  const mats = (o.materials || []).reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.cost) || 0), 0);
  return { labor, mats, costTotal: labor + mats };
}
function orderMargin(o) {
  const rev = orderTotals(o).total, cost = orderCosts(o).costTotal;
  return { rev, cost, margin: rev - cost, pct: rev ? (rev - cost) / rev : 0 };
}
function downloadFile(name, text) {
  try { const blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch { alert("La descarga no está disponible en este navegador."); }
}
const initials = (n) => (n || "?").split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
const todayStr = () => new Date().toISOString().slice(0, 10);
const isOverdue = (t) => t.due && t.due < todayStr() && t.status !== "Hecho";
const daysSince = (iso) => { if (!iso) return 0; return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); };
const STALE_DAYS = 4; // días sin cambios para marcar "estancada"
const WIP_LIMITS = { "En progreso": 5, "En revisión": 3 }; // límites de trabajo en curso por columna
const isStale = (t) => t.status !== "Hecho" && daysSince(t._updatedAt) >= STALE_DAYS;

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
  const [parts, setParts] = useState([]);
  const [module, setModule] = useState("orders");
  const [oView, setOView] = useState("list");
  const [oDetail, setODetail] = useState(null);
  const [oQ, setOQ] = useState(""); const [oStatus, setOStatus] = useState("Todas"); const [oBillable, setOBillable] = useState(false);
  const [oTab, setOTab] = useState("list");
  const [pTab, setPTab] = useState("board");
  const [pProj, setPProj] = useState("all"); const [pQ, setPQ] = useState(""); const [pMine, setPMine] = useState(false);
  const [editing, setEditing] = useState(undefined);
  const [pwOpen, setPwOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [pStale, setPStale] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [accessProj, setAccessProj] = useState(null); // proyecto cuyo acceso se está gestionando
  const [dupProj, setDupProj] = useState(null); // proyecto a duplicar
  const [toasts, setToasts] = useState([]);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const toast = (msg, type = "info") => { const id = Date.now() + Math.random(); setToasts((t) => [...t, { id, msg, type }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500); };
  useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener("online", on); window.addEventListener("offline", off); return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); }; }, []);

  const boot = async () => {
    const d = await api.bootstrap();
    setMe(d.me); setUsers(d.users); setClients(d.clients); setProjects(d.projects); setOrders(d.orders); setTasks(d.tasks);
    setNotifs(d.notifications || []); setParts(d.parts || []);
  };
  useEffect(() => { (async () => {
    if (getToken()) { try { await boot(); } catch { setToken(null); } }
    setBooting(false);
  })(); }, []);

  const logout = () => { setToken(null); setMe(null); setModule("orders"); setOView("list"); };
  const err = (e) => toast(e?.message || "Ocurrió un error", "error");

  if (booting) return <div className="grid min-h-screen place-items-center bg-ink-900 text-slate-300"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!me) return <Login onLogin={async (email, password) => { const r = await api.login(email, password); setToken(r.token); await boot(); }} />;

  const isMgr = me.role === "admin" || me.role === "gerente";
  const isAdmin = me.role === "admin";
  const isOffice = me.role === "tecnico_oficina"; // solo Mi día + Proyectos
  const userById = (id) => users.find((u) => u.id === id);

  /* Órdenes */
  const onSaveOrder = async (o) => {
    try {
      if (o._newClient) { const c = await api.addClient(o._newClient); setClients((p) => (p.some((x) => x.id === c.id) ? p : [...p, c])); o.client = c.name; o.site = o.site || c.site; }
      delete o._newClient; delete o.id; // el servidor asigna el folio con el código del cliente
      const saved = await api.createOrder(o);
      setOrders((p) => [saved, ...p]); setOView("list"); toast(`Orden ${saved.id} creada`, "success");
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
  const saveAccess = async (id, allowedUsers) => {
    try { const p = await api.updateProject(id, { allowedUsers }); setProjects((x) => x.map((y) => (y.id === id ? p : y))); setAccessProj(null); toast("Accesos actualizados", "success"); } catch (e) { err(e); }
  };
  const doDuplicate = async (id, opts) => {
    try { const { project, tasks: newTasks } = await api.duplicateProject(id, opts); setProjects((x) => [...x, project]); setTasks((x) => [...newTasks, ...x]); setDupProj(null); setPProj(project.id); toast(`Proyecto duplicado (${newTasks.length} tareas)`, "success"); } catch (e) { err(e); }
  };

  /* Equipo */
  const addUser = async (nf) => { const u = await api.createUser(nf); setUsers((p) => [...p, u]); };
  const patchUser = async (id, patch) => { const u = await api.updateUser(id, patch); setUsers((p) => p.map((x) => (x.id === id ? u : x))); };
  const removeUser = async (id) => { await api.deleteUser(id); setUsers((p) => p.filter((x) => x.id !== id)); };

  /* Notificaciones */
  const unread = notifs.filter((n) => !n.read).length;
  const markRead = async (id) => { setNotifs((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n))); try { await api.readNotification(id); } catch {} };
  const markAllRead = async () => { setNotifs((p) => p.map((n) => ({ ...n, read: true }))); try { await api.readAllNotifications(); } catch {} };
  const openNotif = (n) => {
    markRead(n.id); setNotifOpen(false);
    if (n.link && n.link.startsWith("task:")) { const t = tasks.find((x) => x.id === n.link.slice(5)); if (t) { setModule("projects"); setPTab("board"); setEditing(t); } }
  };

  /* Comentarios */
  const commentOrder = async (id, text) => { const u = await api.commentOrder(id, text); setOrders((p) => p.map((o) => (o.id === id ? u : o))); return u; };
  const commentTask = async (id, text) => { const u = await api.commentTask(id, text); setTasks((p) => p.map((t) => (t.id === id ? u : t))); return u; };

  /* Duplicar orden / crear tarea desde orden */
  const duplicateOrder = async (o) => {
    const copy = { ...o, status: "Borrador", signatureUrl: null, signedBy: "", noSignReason: "", photos: [], activity: [], createdAt: new Date().toISOString(), date: todayStr() };
    delete copy.id; delete copy._updatedAt;
    try { const saved = await api.createOrder(copy); setOrders((p) => [saved, ...p]); setODetail(null); toast(`Duplicada como ${saved.id} (borrador)`, "success"); } catch (e) { err(e); }
  };
  const taskFromOrder = (o) => {
    setODetail(null); setModule("projects"); setPTab("board");
    setPrefill({ title: `Seguimiento OT ${o.id} — ${o.client}`, desc: `${o.equipo || ""}${o.sintoma ? " · " + o.sintoma : ""}`.trim(), order: o.id, project: projects[0]?.id || "" });
    setEditing(null);
  };

  /* Clientes */
  const addClientMgr = async (c) => { const saved = await api.addClient(c); setClients((p) => (p.some((x) => x.id === saved.id) ? p.map((x) => (x.id === saved.id ? saved : x)) : [...p, saved])); };
  const updateClient = async (id, patch) => { const saved = await api.updateClient(id, patch); setClients((p) => p.map((x) => (x.id === id ? saved : x))); };
  const removeClient = async (id) => { await api.deleteClient(id); setClients((p) => p.filter((x) => x.id !== id)); };

  /* Repuestos */
  const addPart = async (pt) => { const s = await api.addPart(pt); setParts((p) => (p.some((x) => x.id === s.id) ? p.map((x) => (x.id === s.id ? s : x)) : [...p, s])); };
  const updatePart = async (id, patch) => { const s = await api.updatePart(id, patch); setParts((p) => p.map((x) => (x.id === id ? s : x))); };
  const removePart = async (id) => { await api.deletePart(id); setParts((p) => p.filter((x) => x.id !== id)); };
  const lowStock = parts.filter((p) => typeof p.stock === "number" && typeof p.minStock === "number" && p.stock <= p.minStock).length;

  if (module === "orders" && oView === "new")
    return <NewOrder ger={isMgr} me={me} clients={clients} parts={parts} onCancel={() => setOView("list")} onSave={onSaveOrder} />;

  const modTabs = [
    { id: "inicio", label: "Mi día", icon: Home },
    ...(isMgr ? [{ id: "panel", label: "Panel", icon: TrendingUp }] : []),
    ...(isOffice ? [] : [{ id: "orders", label: "Órdenes", icon: ClipboardList }]),
    { id: "projects", label: "Proyectos", icon: LayoutGrid },
    ...(isMgr ? [{ id: "clients", label: "Clientes", icon: Building2 }] : []),
    ...(isMgr ? [{ id: "inventory", label: "Inventario", icon: Wrench, badge: lowStock }] : []),
    ...(isAdmin ? [{ id: "team", label: "Equipo", icon: Users }] : []),
  ];
  // Si el módulo activo no está permitido para el rol, caer en "Mi día"
  const allowedIds = modTabs.map((t) => t.id);
  const activeModule = allowedIds.includes(module) ? module : "inicio";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-ink-900 text-slate-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src={LOGO_LIGHT} alt="AUTOMATICA ARG" className="h-7 w-auto" />
            <div className="leading-tight border-l border-ink-800 pl-2.5"><div className="text-sm font-semibold">Orden<span className="text-brand-400">GO</span></div><div className="text-[11px] text-slate-400">Campo + Proyectos</div></div>
          </div>
          <div className="flex items-center gap-2">
            {activeModule === "orders" && <button onClick={() => setOView("new")} className="hidden items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 sm:inline-flex"><Plus className="h-4 w-4" /> Orden</button>}
            {activeModule === "projects" && <button onClick={() => setEditing(null)} className="hidden items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 sm:inline-flex"><Plus className="h-4 w-4" /> Tarea</button>}
            <div className="hidden items-center gap-2 sm:flex"><Avatar user={me} size={26} /><div className="leading-tight"><div className="text-xs font-medium text-slate-200">{me.name.split(" ")[0]}</div><div className="text-[10px] text-slate-400">{ROLES[me.role]}</div></div></div>
            <div className="relative">
              <button onClick={() => setNotifOpen((v) => !v)} title="Novedades" className="relative rounded-lg p-2 text-slate-300 hover:bg-ink-800">
                <Bell className="h-4 w-4" />
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{unread}</span>}
              </button>
              {notifOpen && (
                <div className="fixed left-4 right-4 top-16 z-30 mt-2 w-auto overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-lg sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:w-80">
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2"><span className="text-sm font-semibold">Novedades</span>{unread > 0 && <button onClick={markAllRead} className="text-[11px] font-medium text-brand-600 hover:underline">Marcar todo leído</button>}</div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifs.length === 0 && <div className="px-3 py-6 text-center text-xs text-slate-400">Sin novedades</div>}
                    {notifs.map((n) => (
                      <button key={n.id} onClick={() => openNotif(n)} className={`block w-full border-b border-slate-50 px-3 py-2 text-left text-xs hover:bg-slate-50 ${n.read ? "text-slate-500" : "font-medium text-slate-800"}`}>
                        <div className="flex items-start gap-2">{!n.read && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}<span className="flex-1">{n.text}</span></div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button onClick={() => setPwOpen(true)} title="Cambiar contraseña" className="rounded-lg p-2 text-slate-300 hover:bg-ink-800"><KeyRound className="h-4 w-4" /></button>
            <button onClick={logout} title="Cerrar sesión" className="rounded-lg p-2 text-slate-300 hover:bg-ink-800"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="mx-auto hidden max-w-6xl overflow-x-auto px-2 sm:block">
          <nav className="flex gap-1 pb-1">
            {modTabs.map(({ id, label, icon: Icon, badge }) => (
              <button key={id} onClick={() => setModule(id)} className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-medium transition ${activeModule === id ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}><Icon className="h-4 w-4" /> {label}{badge > 0 && <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{badge}</span>}</button>
            ))}
          </nav>
        </div>
      </header>

      {!online && <div className="sticky top-0 z-30 bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white">Sin conexión — revisá tu internet. Los cambios podrían no guardarse.</div>}
      <main className="mx-auto max-w-6xl px-3 py-4 pb-28 sm:px-4 sm:py-5 sm:pb-5">
        {activeModule === "inicio" && <MiDia me={me} tasks={tasks} orders={orders} userById={userById} onOpenTask={(t) => { setModule("projects"); setPTab("board"); setEditing(t); }} onOpenOrder={setODetail} ger={isMgr} />}
        {activeModule === "panel" && isMgr && <Dashboard orders={orders} users={users} onOpen={setODetail} />}
        {activeModule === "inventory" && isMgr && <Inventory parts={parts} onAdd={addPart} onPatch={updatePart} onRemove={removePart} onErr={err} />}
        {activeModule === "orders" && (
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
        {activeModule === "projects" && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="mr-1 flex rounded-lg bg-slate-200 p-0.5">
                {[["board", "Tablero", LayoutGrid], ...(isMgr ? [["reports", "Reportes", BarChart3]] : [])].map(([id, lb, Ic]) => (
                  <button key={id} onClick={() => setPTab(id)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium ${pTab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}><Ic className="h-4 w-4" /> {lb}</button>
                ))}
              </div>
              <select value={pProj} onChange={(e) => setPProj(e.target.value)} className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium sm:w-auto">
                <option value="all">Todos los proyectos</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
              </select>
              {pTab === "board" && (<>
                <div className="relative w-full min-w-0 sm:flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={pQ} onChange={(e) => setPQ(e.target.value)} placeholder="Buscar tarea…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" /></div>
                <button onClick={() => setPMine((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium ${pMine ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600"}`}><Avatar user={me} size={18} /> Mis tareas</button>
                <button onClick={() => setPStale((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium ${pStale ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-600"}`}><Clock className="h-4 w-4" /> Estancadas</button>
                {isMgr && <button onClick={createProject} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:border-brand-400 hover:text-brand-600"><Folder className="h-4 w-4" /> Proyecto</button>}
                {isMgr && pProj !== "all" && <button onClick={() => setDupProj(projects.find((p) => p.id === pProj))} title="Duplicar proyecto con sus tareas" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Copy className="h-4 w-4" /> Duplicar</button>}
                {isMgr && pProj !== "all" && <button onClick={() => setAccessProj(projects.find((p) => p.id === pProj))} title="Gestionar accesos" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Users className="h-4 w-4" /> Accesos</button>}
                {isMgr && pProj !== "all" && <button onClick={() => editProject(pProj)} title="Renombrar proyecto" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>}
                {isMgr && pProj !== "all" && <button onClick={() => deleteProject(pProj)} title="Eliminar proyecto" className="rounded-lg border border-rose-200 bg-white p-2 text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>}
              </>)}
            </div>
            {(() => {
              const vis = tasks.filter((t) => (pProj === "all" || t.project === pProj) && (!pMine || t.assignee === me.id) && (!pStale || isStale(t)) && (!pQ || `${t.id} ${t.title} ${t.desc}`.toLowerCase().includes(pQ.toLowerCase())));
              return (pTab === "reports" && isMgr) ? <Reports tasks={vis} users={users} projects={projects} proj={pProj} /> : <Board tasks={vis} userById={userById} onOpen={setEditing} onMove={moveTask} />;
            })()}
          </>
        )}
        {activeModule === "clients" && isMgr && <Clients clients={clients} orders={orders} onAdd={addClientMgr} onPatch={updateClient} onRemove={removeClient} onErr={err} />}
        {activeModule === "team" && isAdmin && <Team users={users} tasks={tasks} orders={orders} me={me} onAdd={addUser} onPatch={patchUser} onRemove={removeUser} onErr={err} />}

        <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-400">Conectado al servidor · {me.name} ({ROLES[me.role]})</footer>
      </main>

      {oDetail && <OrderDetail ger={isMgr} order={orders.find((o) => o.id === oDetail.id) || oDetail} onClose={() => setODetail(null)} onUpdate={updateOrder} onAdvance={(id, st) => updateOrder(id, { status: st })} onExport={(o) => exportCSV([o], `${o.id}.csv`)} onDelete={deleteOrder} onComment={commentOrder} onDuplicate={duplicateOrder} onCreateTask={taskFromOrder} me={me} />}
      {editing !== undefined && <TaskModal task={editing} me={me} users={users.filter((u) => u.active)} projects={projects} canAssign={isMgr} canDelete={isMgr} nextId={nextTaskId} onClose={() => { setEditing(undefined); setPrefill(null); }} onSave={onSaveTask} onDelete={onDeleteTask} onComment={commentTask} prefill={prefill} />}
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
      {accessProj && <ProjectAccess project={accessProj} users={users} onClose={() => setAccessProj(null)} onSave={saveAccess} />}
      {dupProj && <DuplicateProject project={dupProj} users={users} tasksCount={tasks.filter((t) => t.project === dupProj.id).length} onClose={() => setDupProj(null)} onDuplicate={doDuplicate} />}
      {me.mustChangePassword && <ChangePassword forced onDone={() => setMe((m) => ({ ...m, mustChangePassword: false }))} />}

      {/* Barra de navegación inferior (móvil) */}
      <nav className="mobile-bottom-bar fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden" aria-label="Navegación principal">
        {modTabs.map(({ id, label, icon: Icon, badge }) => (
          <button key={id} onClick={() => setModule(id)} title={label} aria-label={label} className={`mobile-nav-item relative flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium ${activeModule === id ? "text-brand-600" : "text-slate-400"}`}>
            {badge > 0 && <span className="absolute right-1/4 top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-rose-500 px-1 text-[8px] font-bold text-white">{badge}</span>}
            <Icon className="h-5 w-5" /><span className="mobile-nav-label">{label}</span>
          </button>
        ))}
      </nav>

      {/* Botón de acción flotante (móvil) */}
      {(activeModule === "orders" || activeModule === "projects") && (
        <button onClick={() => (activeModule === "orders" ? setOView("new") : setEditing(null))} className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-brand-500 text-white shadow-lg shadow-brand-500/30 hover:bg-brand-400 sm:hidden" aria-label={activeModule === "orders" ? "Nueva orden" : "Nueva tarea"}>
          <Plus className="h-7 w-7" />
        </button>
      )}

      {/* Toasts */}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-lg ${t.type === "error" ? "bg-rose-600" : t.type === "success" ? "bg-emerald-600" : "bg-ink-900"}`}>
            {t.type === "error" ? <AlertTriangle className="h-4 w-4" /> : t.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            {t.msg}
          </div>
        ))}
      </div>

    </div>
  );
}

/* ===================================== LOGIN ===================================== */
function Login({ onLogin }) {
  const [email, setEmail] = useState(""); const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async () => { if (!email || !pass) return; setBusy(true); setErr(""); try { await onLogin(email.trim(), pass); } catch (e) { setErr(e?.message || "No se pudo iniciar sesión"); setBusy(false); } };
  const bullets = ["Permisos por proyecto y por rol", "Trazabilidad de cada operación", "Información centralizada en tiempo real"];
  return (
    <div className="grid min-h-screen grid-cols-1 bg-slate-100 lg:grid-cols-2" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {/* Panel de marca */}
      <div className="relative hidden overflow-hidden bg-ink-900 lg:block">
        <div className="pointer-events-none absolute -right-24 top-1/2 h-[42rem] w-[42rem] -translate-y-1/2 rounded-full border border-white/5" />
        <div className="pointer-events-none absolute -right-10 top-1/2 h-[30rem] w-[30rem] -translate-y-1/2 rounded-full border border-white/5" />
        <div className="pointer-events-none absolute left-0 top-0 h-64 w-64 bg-brand-500/10 blur-3xl" />
        <div className="relative flex h-full flex-col justify-center px-14 xl:px-20">
          <div className="mb-8 grid h-14 w-14 place-items-center rounded-2xl bg-white/5 ring-1 ring-white/10"><img src={LOGO_LIGHT} alt="" className="h-6 w-auto" /></div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-400">AUTOMATICA ARG</div>
          <h1 className="max-w-md text-4xl font-bold leading-tight text-white xl:text-5xl">Control operativo para decisiones confiables</h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">Órdenes de campo, proyectos y gestión conectados en un entorno seguro para toda la organización.</p>
          <ul className="mt-8 space-y-3">
            {bullets.map((b) => (<li key={b} className="flex items-center gap-3 text-sm text-slate-200"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-brand-500/20 text-brand-400"><CheckCircle2 className="h-3.5 w-3.5" /></span>{b}</li>))}
          </ul>
        </div>
      </div>

      {/* Tarjeta de acceso */}
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-3 lg:hidden"><img src={LOGO} alt="AUTOMATICA ARG" className="h-8 w-auto" /></div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
            <div className="h-1 bg-brand-500" />
            <div className="p-6 sm:p-7">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-brand-600">Acceso seguro</div>
              <h2 className="text-2xl font-bold text-slate-900">Iniciar sesión</h2>
              <p className="mt-1 text-sm text-slate-500">Ingresá con tu cuenta empresarial.</p>
              <div className="mt-5 space-y-4">
                <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">Correo electrónico</span>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} type="email" autoFocus placeholder="correo@empresa.com" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" /></label>
                <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">Contraseña</span>
                  <div className="relative">
                    <input value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} type={show ? "text" : "password"} placeholder="••••••••••" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-16 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
                    <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50">{show ? "Ocultar" : "Mostrar"}</button>
                  </div>
                </label>
                {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{err}</div>}
                <button onClick={submit} disabled={busy || !email || !pass} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-400 disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Ingresar</button>
              </div>
              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400"><KeyRound className="mt-0.5 h-3 w-3 shrink-0" /> La sesión se protege con un token seguro. ¿Olvidaste tu contraseña? Contactá al administrador.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================================== CAMBIAR CONTRASEÑA ===================================== */
function ChangePassword({ onClose, forced, onDone }) {
  const [cur, setCur] = useState(""); const [n1, setN1] = useState(""); const [n2, setN2] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [done, setDone] = useState(false);
  const close = forced ? () => {} : onClose;
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={close}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-semibold text-slate-900">Cambiar contraseña</h3>{!forced && <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>}</div>
        {forced && !done && <div className="mb-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700">Por seguridad, define una contraseña nueva antes de continuar.</div>}
        {done ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-5 w-5" /> Contraseña actualizada correctamente.</div>
            <button onClick={forced ? onDone : onClose} className="w-full rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400">Continuar</button>
          </div>
        ) : (
          <div className="space-y-3">
            <L label="Contraseña actual"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} className="u-input" /></L>
            <L label="Nueva contraseña"><input type="password" value={n1} onChange={(e) => setN1(e.target.value)} className="u-input" /></L>
            <L label="Repetir nueva contraseña"><input type="password" value={n2} onChange={(e) => setN2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="u-input" /></L>
            {msg && <div className="text-xs text-rose-600">{msg}</div>}
            <button onClick={submit} disabled={busy || !cur || !n1} className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===================================== PANEL DE DIRECCIÓN ===================================== */
const PIE_COLORS = ["#F18700", "#0ea5e9", "#10b981", "#8b5cf6", "#ef4444", "#f59e0b", "#14b8a6"];
const monthKey = (d) => (d || "").slice(0, 7);
const monthLabelShort = (ym) => { const [y, m] = ym.split("-"); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("es-MX", { month: "short" }).replace(".", ""); };

function Dashboard({ orders, users, onOpen }) {
  const [period, setPeriod] = useState("mes"); // mes | trim | anio
  const now = new Date();
  const startOf = { mes: new Date(now.getFullYear(), now.getMonth(), 1), trim: new Date(now.getFullYear(), now.getMonth() - 2, 1), anio: new Date(now.getFullYear(), 0, 1) }[period];
  const inPeriod = (o) => o.date && new Date(o.date + "T00:00:00") >= startOf;
  const real = orders.filter((o) => o.status !== "Borrador");
  const tot = (o) => orderTotals(o).total;

  // KPIs: facturado del período vs período anterior
  const facturadas = real.filter((o) => o.status === "Facturada");
  const periodBilled = facturadas.filter(inPeriod).reduce((s, o) => s + tot(o), 0);
  const prevStart = { mes: new Date(now.getFullYear(), now.getMonth() - 1, 1), trim: new Date(now.getFullYear(), now.getMonth() - 5, 1), anio: new Date(now.getFullYear() - 1, 0, 1) }[period];
  const prevEnd = startOf;
  const prevBilled = facturadas.filter((o) => { const d = new Date(o.date + "T00:00:00"); return d >= prevStart && d < prevEnd; }).reduce((s, o) => s + tot(o), 0);
  const variation = prevBilled ? Math.round(((periodBilled - prevBilled) / prevBilled) * 100) : null;
  const pending = real.filter((o) => o.status === "Completada" || o.status === "Aprobada");
  const pendingTotal = pending.reduce((s, o) => s + tot(o), 0);
  const oldestPending = pending.reduce((max, o) => Math.max(max, daysSince((o.date || "") + "T00:00:00")), 0);
  const periodOrders = real.filter(inPeriod);
  const ticket = facturadas.filter(inPeriod).length ? periodBilled / facturadas.filter(inPeriod).length : 0;
  // Margen del período (sobre facturadas)
  const marginAgg = facturadas.filter(inPeriod).reduce((a, o) => { const m = orderMargin(o); return { rev: a.rev + m.rev, cost: a.cost + m.cost }; }, { rev: 0, cost: 0 });
  const marginPct = marginAgg.rev ? Math.round(((marginAgg.rev - marginAgg.cost) / marginAgg.rev) * 100) : null;
  const marginAmount = round2(marginAgg.rev - marginAgg.cost);

  // 1) Tendencia 12 meses
  const trend = (() => {
    const arr = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); const ym = d.toISOString().slice(0, 7); arr.push({ ym, name: monthLabelShort(ym), value: 0 }); }
    const idx = Object.fromEntries(arr.map((a, i) => [a.ym, i]));
    real.forEach((o) => { const k = monthKey(o.date); if (k in idx) arr[idx[k]].value += tot(o); });
    return arr.map((a) => ({ ...a, value: Math.round(a.value) }));
  })();

  // 2) Aging de cobranzas
  const aging = [
    { name: "0–30 días", value: 0, fill: "#10b981" },
    { name: "31–60 días", value: 0, fill: "#f59e0b" },
    { name: "60+ días", value: 0, fill: "#ef4444" },
  ];
  pending.forEach((o) => { const d = daysSince((o.date || "") + "T00:00:00"); const b = d <= 30 ? 0 : d <= 60 ? 1 : 2; aging[b].value += tot(o); });
  aging.forEach((a) => (a.value = Math.round(a.value)));

  // 3) Embudo del ciclo + días promedio para facturar
  const funnel = O_STATUS.map((st) => ({ name: st, value: real.filter((o) => o.status === st).length, fill: (O_STYLE[st].bar) || "#94a3b8" }));
  const facturaTimes = facturadas.map((o) => { const created = o.createdAt || (o.date + "T00:00:00"); const done = (o.activity || []).filter((a) => a.type === "status" && /Facturada/.test(a.text)).map((a) => a.at).pop(); return done ? (new Date(done) - new Date(created)) / 86400000 : null; }).filter((x) => x != null && x >= 0);
  const avgToBill = facturaTimes.length ? Math.round(facturaTimes.reduce((s, x) => s + x, 0) / facturaTimes.length) : null;

  // 4) Top clientes (período)
  const byClient = {};
  periodOrders.forEach((o) => { byClient[o.client] = (byClient[o.client] || 0) + tot(o); });
  const topClients = Object.entries(byClient).map(([name, value]) => ({ name: name.length > 16 ? name.slice(0, 15) + "…" : name, value: Math.round(value) })).sort((a, b) => b.value - a.value).slice(0, 6);

  // 4b) Rentabilidad por cliente (ingreso vs costo) — sobre facturadas del período
  const byClientRent = {};
  facturadas.filter(inPeriod).forEach((o) => { const m = orderMargin(o); const k = o.client; if (!byClientRent[k]) byClientRent[k] = { name: k.length > 14 ? k.slice(0, 13) + "…" : k, ingreso: 0, costo: 0 }; byClientRent[k].ingreso += m.rev; byClientRent[k].costo += m.cost; });
  const rentClients = Object.values(byClientRent).map((r) => ({ ...r, ingreso: Math.round(r.ingreso), costo: Math.round(r.costo) })).sort((a, b) => (b.ingreso - b.costo) - (a.ingreso - a.costo)).slice(0, 6);

  // 5) Mix de servicios (período, por monto)
  const byService = {};
  periodOrders.forEach((o) => { const k = o.service || "Otro"; byService[k] = (byService[k] || 0) + tot(o); });
  const mix = Object.entries(byService).map(([name, value], i) => ({ name, value: Math.round(value), fill: PIE_COLORS[i % PIE_COLORS.length] }));

  // 6) Productividad por técnico (período)
  const byTech = {};
  periodOrders.forEach((o) => { const k = o.tech || "—"; if (!byTech[k]) byTech[k] = { name: k.split(" ")[0], horas: 0, ordenes: 0 }; byTech[k].horas += Number(o.laborHours) || 0; byTech[k].ordenes += 1; });
  const tech = Object.values(byTech).sort((a, b) => b.horas - a.horas);

  const periodLabel = { mes: "este mes", trim: "último trimestre", anio: "este año" }[period];
  const fmtK = (n) => (Math.abs(n) >= 1000 ? "$" + (n / 1000).toFixed(0) + "k" : "$" + n);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Panel de dirección</h2>
        <div className="ml-auto flex rounded-lg bg-slate-200 p-0.5">
          {[["mes", "Mes"], ["trim", "Trimestre"], ["anio", "Año"]].map(([id, lb]) => (
            <button key={id} onClick={() => setPeriod(id)} className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${period === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{lb}</button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between"><span className="text-[11px] font-medium text-slate-500">Facturado ({periodLabel})</span><DollarSign className="h-4 w-4 text-emerald-600" /></div>
          <div className="mt-0.5 text-lg font-semibold text-slate-900">{money(periodBilled)}</div>
          {marginPct != null && <div className="mt-0.5 text-[11px] font-medium text-emerald-600">Margen {marginPct}% · {money(marginAmount)}</div>}
          {variation != null && <div className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium ${variation >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{variation >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{variation >= 0 ? "+" : ""}{variation}% vs período anterior</div>}
        </div>
        <Metric label="Ticket promedio" value={money(ticket)} icon={ClipboardList} tint="text-brand-600" />
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between"><span className="text-[11px] font-medium text-slate-500">Por facturar (total)</span><AlertTriangle className="h-4 w-4 text-amber-600" /></div>
          <div className="mt-0.5 text-lg font-semibold text-slate-900">{money(pendingTotal)}</div>
          {oldestPending > 0 && <div className="mt-0.5 text-[11px] text-slate-400">la más vieja: hace {oldestPending} días</div>}
        </div>
        <Metric label={`Órdenes (${periodLabel})`} value={periodOrders.length} icon={LayoutGrid} tint="text-slate-600" />
      </div>

      {/* Tendencia */}
      <Panel title="Facturación — últimos 12 meses">
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={trend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
              <Bar dataKey="value" fill="#F18700" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Aging */}
        <Panel title="Cobranzas por antigüedad (por facturar)">
          {pendingTotal === 0 ? <Empty text="Nada pendiente de facturar." /> : (
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={aging} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Bar dataKey="value" radius={[5, 5, 0, 0]}>{aging.map((a, i) => <Cell key={i} fill={a.fill} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        {/* Embudo */}
        <Panel title="Ciclo de la orden">
          {avgToBill != null && <div className="mb-3 rounded-lg bg-slate-50 p-2.5 text-sm text-slate-600">Tiempo promedio hasta facturar: <span className="font-semibold text-slate-900">{avgToBill} días</span></div>}
          <div className="space-y-2">
            {funnel.map((f) => { const max = Math.max(1, ...funnel.map((x) => x.value)); return (
              <div key={f.name}>
                <div className="mb-1 flex items-center justify-between text-xs"><span className="font-medium text-slate-600">{f.name}</span><span className="text-slate-500">{f.value}</span></div>
                <div className="h-3 w-full rounded-full bg-slate-100"><div className="h-3 rounded-full" style={{ width: `${(f.value / max) * 100}%`, background: f.fill }} /></div>
              </div>
            ); })}
          </div>
        </Panel>

        {/* Top clientes */}
        <Panel title={`Top clientes (${periodLabel})`}>
          {topClients.length === 0 ? <Empty text="Sin datos en el período." /> : (
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <BarChart layout="vertical" data={topClients} margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                  <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Bar dataKey="value" fill="#0ea5e9" radius={[0, 5, 5, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        {/* Mix de servicios */}
        <Panel title={`Mix de servicios (${periodLabel})`}>
          {mix.length === 0 ? <Empty text="Sin datos en el período." /> : (
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={mix} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>{mix.map((m, i) => <Cell key={i} fill={m.fill} />)}</Pie>
                  <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      {/* Productividad por técnico */}
      <Panel title={`Productividad por técnico (${periodLabel})`}>
        {tech.length === 0 ? <Empty text="Sin datos en el período." /> : (
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={tech} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="horas" name="Horas" fill="#F18700" radius={[5, 5, 0, 0]} />
                <Bar dataKey="ordenes" name="Órdenes" fill="#0ea5e9" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel title={`Rentabilidad por cliente — ingreso vs. costo (${periodLabel})`}>
        {rentClients.length === 0 ? <Empty text="Sin facturación en el período (o sin costos cargados)." /> : (
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={rentClients} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="ingreso" name="Ingreso" fill="#10b981" radius={[5, 5, 0, 0]} />
                <Bar dataKey="costo" name="Costo" fill="#ef4444" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <p className="text-[11px] text-slate-400">Los importes surgen de las órdenes cargadas. El "tiempo hasta facturar" es exacto en las órdenes con historial de estados; en las anteriores es una estimación. El margen requiere costos cargados (en el detalle de la orden y en el inventario).</p>
    </div>
  );
}
const Empty = ({ text }) => <div className="grid h-[200px] place-items-center text-center text-xs text-slate-400">{text}</div>;

/* ===================================== INICIO: MI DÍA ===================================== */
function MiDia({ me, tasks, orders, userById, onOpenTask, onOpenOrder, ger }) {
  const myTasks = tasks.filter((t) => t.assignee === me.id && t.status !== "Hecho")
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority));
  const myOrders = orders.filter((o) => o.tech === me.name && o.status !== "Facturada");
  const overdue = myTasks.filter(isOverdue).length;
  const pend = ger ? orders.filter((o) => o.status === "Completada" || o.status === "Aprobada") : [];
  return (
    <div className="space-y-5">
      <div><h2 className="text-lg font-semibold text-slate-900">Hola, {me.name.split(" ")[0]}</h2><p className="text-sm text-slate-500">Esto es lo que tienes pendiente hoy.</p></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Mis tareas abiertas" value={myTasks.length} icon={LayoutGrid} tint="text-brand-600" />
        <Metric label="Tareas vencidas" value={overdue} icon={AlertTriangle} tint="text-rose-600" />
        <Metric label="Mis órdenes activas" value={myOrders.length} icon={ClipboardList} tint="text-emerald-600" />
        {ger && <Metric label="Por facturar" value={pend.length} icon={DollarSign} tint="text-amber-600" />}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Mis tareas">
          <div className="space-y-2">
            {myTasks.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">Sin tareas pendientes</div>}
            {myTasks.slice(0, 8).map((t) => (
              <button key={t.id} onClick={() => onOpenTask(t)} className="block w-full rounded-lg border border-slate-200 p-2.5 text-left hover:border-slate-300">
                <div className="flex items-center gap-2">
                  <Chip className={`${prioMeta[t.priority]} ring-1 ring-inset ring-black/5`}><Flag className="h-3 w-3" />{t.priority}</Chip>
                  <span className="truncate text-sm font-medium text-slate-800">{t.title}</span>
                  {isOverdue(t) && <Chip className="ml-auto bg-rose-50 text-rose-700 ring-rose-600/20">Vencida</Chip>}
                  {!isOverdue(t) && isStale(t) && <Chip className="ml-auto bg-amber-50 text-amber-700 ring-amber-600/20">Estancada</Chip>}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400"><span className="font-mono">{t.id}</span>{t.due && <span className="inline-flex items-center gap-0.5"><Calendar className="h-3 w-3" />{t.due}</span>}<span>· {t.status}</span></div>
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Mis órdenes activas">
          <div className="space-y-2">
            {myOrders.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">Sin órdenes activas</div>}
            {myOrders.slice(0, 8).map((o) => (
              <button key={o.id} onClick={() => onOpenOrder(o)} className="block w-full rounded-lg border border-slate-200 p-2.5 text-left hover:border-slate-300">
                <div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold text-slate-700">{o.id}</span><Chip className={O_STYLE[o.status]}>{o.status}</Chip><span className="truncate text-sm text-slate-700">{o.client}</span></div>
                <div className="mt-0.5 text-[11px] text-slate-400">{o.site} · {o.service} · {o.date}</div>
              </button>
            ))}
          </div>
        </Panel>
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
  const monthPending = monthOrders.filter((o) => o.status === "Completada" || o.status === "Aprobada").reduce((s, o) => s + orderTotals(o).total, 0);
  const filtered = orders.filter((o) => (oStatus === "Todas" || o.status === oStatus) && (!oBillable || o.status === "Completada" || o.status === "Aprobada") && `${o.id} ${o.client} ${o.site} ${o.service} ${o.equipo}`.toLowerCase().includes(oQ.toLowerCase()));
  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Órdenes del mes" value={monthOrders.length} icon={ClipboardList} tint="text-brand-600" />
        {ger ? (<>
          <Metric label="Total del mes" value={money(monthTotal)} icon={DollarSign} tint="text-emerald-600" />
          <Metric label="Por facturar" value={money(monthPending)} icon={AlertTriangle} tint="text-amber-600" />
        </>) : (<>
          <Metric label="Completadas" value={monthOrders.filter((o) => o.status === "Completada" || o.status === "Aprobada").length} icon={CheckCircle2} tint="text-emerald-600" />
          <Metric label="En progreso" value={monthOrders.filter((o) => o.status === "En progreso").length} icon={Clock} tint="text-brand-600" />
        </>)}
        <Metric label="Sin firma" value={unsigned.length} icon={FileSignature} tint="text-rose-600" />
      </div>
      <div className="mb-5 space-y-2">
        {ger && pendingBill.length > 0 && (<div className="flex flex-col items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between"><span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{pendingBill.length} orden(es) completadas pendientes de facturar.</span><button onClick={() => { setOBillable(true); setOStatus("Todas"); }} className="shrink-0 rounded-md bg-white/70 px-2 py-1.5 text-xs font-medium hover:bg-white">Ver facturables</button></div>)}
        {unsigned.length > 0 && (<div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><FileSignature className="mt-0.5 h-4 w-4 shrink-0" />{unsigned.length} orden(es) completadas sin firma del cliente.</div>)}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-0 sm:flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={oQ} onChange={(e) => setOQ(e.target.value)} placeholder="Buscar folio, cliente, equipo…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" /></div>
        <select value={oStatus} onChange={(e) => setOStatus(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm sm:flex-none"><option>Todas</option>{O_STATUS.filter((s) => ger || s !== "Facturada").map((s) => <option key={s}>{s}</option>)}</select>
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
                {o.category && <Chip className="bg-brand-50 text-brand-700 ring-brand-600/20"><Sparkles className="h-3 w-3" />{o.category}</Chip>}
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
  const chart = rows.slice(0, 8).map((r) => ({ name: r.client.length > 14 ? r.client.slice(0, 13) + "…" : r.client, value: Math.round(r.total), fill: "#F18700" }));
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
        <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          <button onClick={exportCSV} disabled={!rows.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"><Download className="h-4 w-4" /> CSV</button>
          <button onClick={() => monthlyReportPDF(month, monthLabel, rows, sum)} disabled={!rows.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"><FileText className="h-4 w-4" /> PDF</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Clientes" value={rows.length} icon={Building2} tint="text-brand-600" />
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
function OrderDetail({ ger, order, onClose, onUpdate, onAdvance, onExport, onDelete, onComment, onDuplicate, onCreateTask, me }) {
  const idx = O_STATUS.indexOf(order.status);
  const next = idx >= 0 && idx < O_STATUS.length - 1 ? O_STATUS[idx + 1] : null;
  const needSign = next === "Aprobada" && !order.signatureUrl;
  const canAdvance = next && (next !== "Facturada" || ger);
  const [rate, setRate] = useState(order.rate || DEFAULT_RATE);
  const [mats, setMats] = useState(order.materials || []);
  const [laborBillable, setLaborBillable] = useState(order.laborBillable);
  const [laborCost, setLaborCost] = useState(order.laborCost || 0);
  const [sig, setSig] = useState(null); const [sigBy, setSigBy] = useState("");
  useEffect(() => { setRate(order.rate || DEFAULT_RATE); setMats(order.materials || []); setLaborBillable(order.laborBillable); setLaborCost(order.laborCost || 0); setSig(null); setSigBy(""); }, [order.id]);
  const t = orderTotals({ ...order, rate, materials: mats, laborBillable });
  const mg = orderMargin({ ...order, rate, materials: mats, laborBillable, laborCost });
  const dirty = ger && (rate !== order.rate || laborBillable !== order.laborBillable || (order.laborCost || 0) !== Number(laborCost) || JSON.stringify(mats) !== JSON.stringify(order.materials));
  const savePrices = () => onUpdate(order.id, { rate: Number(rate) || 0, laborCost: Number(laborCost) || 0, materials: mats.map((m) => ({ ...m, price: Number(m.price) || 0, cost: Number(m.cost) || 0, qty: Number(m.qty) || 0 })), laborBillable });
  const approveNoSign = () => { const r = prompt("Motivo para aprobar sin firma del cliente (ej. cliente ausente):"); if (r && r.trim()) onUpdate(order.id, { status: "Aprobada", noSignReason: r.trim() }); };
  const [zoom, setZoom] = useState(null);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="mobile-dialog w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3"><div className="flex items-center gap-2"><span className="font-mono text-sm font-semibold text-slate-800">{order.id}</span><Chip className={O_STYLE[order.status]}>{order.status}</Chip></div><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="mobile-sheet-content space-y-4 p-4 sm:p-5">
          <section><div className="text-base font-semibold text-slate-900">{order.client}</div><div className="text-sm text-slate-500">{order.site}{order.contact ? ` · ${order.contact}` : ""}</div><div className="mt-1 text-xs text-slate-500">{order.service} · {order.date}{order.tech ? ` · Técnico: ${order.tech}` : ""}</div>{order.location && <div className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" />{order.location.lat.toFixed(4)}, {order.location.lng.toFixed(4)}</div>}</section>
          {(order.equipo || order.sintoma || order.solucion) && (<section className="rounded-lg bg-slate-50 p-3 text-sm">{order.equipo && <p><span className="font-medium text-slate-700">Equipo:</span> {order.equipo}</p>}{order.sintoma && <p className="mt-1"><span className="font-medium text-slate-700">Síntoma:</span> {order.sintoma}</p>}{order.solucion && <p className="mt-1"><span className="font-medium text-slate-700">Trabajo:</span> {order.solucion}</p>}</section>)}
          {order.noSignReason && <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700">Cerrada sin firma. Motivo: {order.noSignReason}</div>}
          {order.photos && order.photos.length > 0 && (<section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Evidencia</h4><div className="flex flex-wrap gap-2">{order.photos.map((p, i) => (<button key={i} onClick={() => setZoom(p)} className="relative" aria-label={`Ampliar foto ${p.cat || ""}`}><img src={p.url} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-200" /><span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 text-center text-[9px] text-white">{p.cat}</span></button>))}</div></section>)}
          <section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Mano de obra y materiales</h4><div className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex items-center justify-between text-slate-600"><span>Horas de trabajo</span><span className="font-medium text-slate-800">{order.laborHours || 0} h{order.technicians ? ` · ${order.technicians} téc.` : ""}</span></div>
            {ger && <div className="mt-2 flex items-center gap-2"><span className="text-slate-600">Tarifa/h:</span><input type="number" value={rate} onChange={(e) => setRate(e.target.value)} className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm" /><label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={laborBillable} onChange={(e) => setLaborBillable(e.target.checked)} /> Facturable</label></div>}
            {ger && <div className="mt-1 flex items-center gap-2"><span className="text-slate-500 text-xs">Costo/h (interno):</span><input type="number" value={laborCost} onChange={(e) => setLaborCost(e.target.value)} className="w-24 rounded-md border border-slate-200 px-2 py-1 text-xs" /></div>}
            {mats.length > 0 && <ul className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">{mats.map((m, i) => (<li key={i} className="text-sm"><div className="flex min-w-0 items-start justify-between gap-2"><span className="min-w-0 break-words text-slate-700">{m.qty}× {m.name || "—"}</span>{ger && <span className="shrink-0 text-xs text-slate-500">{money((m.qty || 0) * (m.price || 0))}</span>}</div>{ger && <div className="mt-1 grid grid-cols-2 gap-2 sm:flex sm:items-center"><label className="text-xs text-slate-500">P. unit:<input type="number" value={m.price} onChange={(e) => setMats((x) => x.map((y, j) => j === i ? { ...y, price: e.target.value } : y))} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-xs sm:ml-1 sm:mt-0 sm:w-24" /></label><label className="text-xs text-slate-500">Costo:<input type="number" value={m.cost ?? ""} onChange={(e) => setMats((x) => x.map((y, j) => j === i ? { ...y, cost: e.target.value } : y))} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-xs sm:ml-1 sm:mt-0 sm:w-20" /></label><label className="col-span-2 flex items-center gap-1 text-[11px] text-slate-500 sm:ml-auto"><input type="checkbox" checked={m.billable} onChange={(e) => setMats((x) => x.map((y, j) => j === i ? { ...y, billable: e.target.checked } : y))} /> Facturable</label></div>}</li>))}</ul>}
          </div></section>
          {ger && (<section className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm"><div className="flex items-center justify-between text-slate-600"><span>Mano de obra</span><span className="font-medium text-slate-800">{money(t.labor)}</span></div><div className="flex items-center justify-between text-slate-600"><span>Materiales facturables</span><span className="font-medium text-slate-800">{money(t.mats)}</span></div><div className="mt-2 flex items-center justify-between border-t border-emerald-200 pt-2 font-semibold text-slate-900"><span>Total</span><span>{money(t.total)}</span></div>{(mg.cost > 0) && <><div className="mt-2 flex items-center justify-between border-t border-emerald-200 pt-2 text-slate-500"><span>Costo estimado</span><span>{money(mg.cost)}</span></div><div className="flex items-center justify-between font-semibold text-emerald-700"><span>Margen</span><span>{money(mg.margin)} · {Math.round(mg.pct * 100)}%</span></div></>}{dirty && <button onClick={savePrices} className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500">Guardar precios y costos</button>}</section>)}
          {order.signatureUrl && (<section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Conformidad del cliente</h4>{order.signatureUrl !== "signed" ? <img src={order.signatureUrl} alt="firma" className="h-20 rounded-lg border border-slate-200 bg-white" /> : <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">Firmada</div>}{order.signedBy && <div className="mt-1 text-xs text-slate-500">Firmó: {order.signedBy}</div>}</section>)}
          {!order.signatureUrl && order.status !== "Borrador" && (<section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Firma del cliente</h4><SignaturePad key={order.id} onChange={setSig} /><input value={sigBy} onChange={(e) => setSigBy(e.target.value)} placeholder="Nombre de quien firma" className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" /><button disabled={!sig} onClick={() => onUpdate(order.id, { signatureUrl: sig, signedBy: sigBy })} className="mt-2 w-full rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50">Guardar firma</button></section>)}
          <section className="flex flex-wrap gap-2 pt-1">
            {canAdvance && <button disabled={needSign} onClick={() => onAdvance(order.id, next)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Marcar {next}</button>}
            {needSign && <button onClick={approveNoSign} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"><AlertTriangle className="h-4 w-4" /> Aprobar sin firma</button>}
            {next === "Facturada" && !ger && <span className="self-center text-xs text-slate-400">La facturación la realiza Gerencia.</span>}
            <button onClick={() => orderReceiptPDF(order, ger)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><FileText className="h-4 w-4" /> Comprobante PDF</button>
            {ger && onExport && <button onClick={() => onExport(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Download className="h-4 w-4" /> Exportar</button>}
            {ger && onDuplicate && <button onClick={() => onDuplicate(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Copy className="h-4 w-4" /> Duplicar</button>}
            {ger && onCreateTask && <button onClick={() => onCreateTask(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Link2 className="h-4 w-4" /> Crear tarea</button>}
            {ger && onDelete && <button onClick={() => onDelete(order.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /> Eliminar</button>}
          </section>
          {onComment && <section className="border-t border-slate-100 pt-4"><ActivitySection entity={order} onSend={(text) => onComment(order.id, text)} /></section>}
        </div>
      </div>
      {zoom && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4" onClick={(e) => { e.stopPropagation(); setZoom(null); }}><img src={zoom.url} alt={zoom.cat} className="max-h-[90vh] max-w-full rounded-lg" /><button className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white"><X className="h-5 w-5" /></button></div>}
    </div>
  );
}

/* ===================================== ÓRDENES: NUEVA ===================================== */
function NewOrder({ ger, me, clients, parts = [], onSave, onCancel }) {
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
  const [noSignReason, setNoSignReason] = useState("");
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
  const clientCode = clientMode === "existing" ? (client?.code || "—") : "auto";
  const folioPreview = `OT-${clientCode}-${new Date().getFullYear()}-###`;
  const preview = orderTotals({ laborHours, rate, laborBillable, materials });
  const canSave = client && client.name && (laborHours || materials.length || solucion);
  const canComplete = canSave && (!!signatureUrl || !!noSignReason.trim());
  const save = async (status) => {
    setSaving(true);
    const o = { client: client.name, site: client.site || "", contact, tech, service, date: todayStr(), createdAt: new Date().toISOString(), equipo, sintoma, solucion, category, location, photos, signatureUrl, signedBy, noSignReason: signatureUrl ? "" : noSignReason.trim(), laborHours: Number(laborHours) || 0, technicians: Number(technicians) || 1, rate: Number(rate) || DEFAULT_RATE, laborBillable, materials: materials.map((m) => ({ ...m, qty: Number(m.qty) || 0, price: Number(m.price) || 0 })), status };
    if (clientMode === "new" && newClient.name) o._newClient = { id: "c" + Date.now(), name: newClient.name, site: newClient.site };
    await onSave(o); setSaving(false);
  };
  return (
    <div className="min-h-screen bg-slate-100" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-ink-900 text-slate-100"><div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3"><button onClick={onCancel} className="rounded-md p-1 text-slate-300 hover:bg-ink-800"><ChevronLeft className="h-5 w-5" /></button><div className="leading-tight"><div className="text-sm font-semibold">Nueva orden</div><div className="font-mono text-[11px] text-brand-400">{folioPreview}</div></div></div></header>
      <main className="mx-auto max-w-lg space-y-4 px-3 py-4 pb-40 sm:px-4 sm:py-5 sm:pb-32">
        <Section title="Cliente y sitio">
          <div className="mb-2 flex gap-2"><Toggle active={clientMode === "existing"} onClick={() => setClientMode("existing")}>Directorio</Toggle><Toggle active={clientMode === "new"} onClick={() => setClientMode("new")}>Cliente nuevo</Toggle></div>
          {clientMode === "existing" ? (<select value={clientId} onChange={(e) => setClientId(e.target.value)} className="u-input">{clients.map((c) => <option key={c.id} value={c.id}>{c.code ? `[${c.code}] ` : ""}{c.name} — {c.site}</option>)}</select>) : (<div className="space-y-2"><input value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} placeholder="Nombre del cliente" className="u-input" /><input value={newClient.site} onChange={(e) => setNewClient({ ...newClient, site: e.target.value })} placeholder="Sitio / ubicación" className="u-input" /></div>)}
          <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Persona de contacto (opcional)" className="u-input mt-2" />
          <input value={tech} onChange={(e) => setTech(e.target.value)} placeholder="Técnico responsable" className="u-input mt-2" />
          <div className="mt-2 flex items-center gap-2"><button onClick={captureLocation} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><MapPin className="h-3.5 w-3.5" /> Capturar ubicación</button>{location && <span className="text-xs text-emerald-600">{location.lat.toFixed(4)}, {location.lng.toFixed(4)}</span>}{geoMsg && <span className="text-xs text-slate-500">{geoMsg}</span>}</div>
        </Section>
        <Section title="Tipo de servicio"><div className="flex flex-wrap gap-2">{SERVICE_TYPES.map((s) => (<button key={s} onClick={() => setService(s)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${service === s ? "border-brand-400 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600"}`}>{s}</button>))}</div></Section>
        <Section title="Documentación del trabajo">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500"><Sparkles className="h-3.5 w-3.5 text-brand-500" /> Las fotos autocompletan equipo y descripción con IA</div>
          <div className="grid grid-cols-3 gap-2"><PhotoBtn icon={Camera} label="Antes" cat="antes" capture onPick={addPhoto} /><PhotoBtn icon={Camera} label="Durante" cat="durante" capture onPick={addPhoto} /><PhotoBtn icon={Upload} label="Después" cat="después" onPick={addPhoto} /></div>
          {analyzing && <div className="mt-2 flex items-center gap-2 text-xs text-brand-700"><Loader2 className="h-4 w-4 animate-spin" /> Analizando imagen…</div>}
          {photos.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{photos.map((p, i) => (<div key={i} className="relative"><img src={p.url} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-slate-200" /><span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 text-center text-[9px] text-white">{p.cat}</span><button onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 shadow ring-1 ring-slate-200"><X className="h-3 w-3 text-slate-500" /></button></div>))}</div>}
          {category && <div className="mt-2"><Chip className="bg-brand-50 text-brand-700 ring-brand-600/20"><Sparkles className="h-3 w-3" />{category}</Chip></div>}
          <input value={equipo} onChange={(e) => setEquipo(e.target.value)} placeholder="Equipo / sistema intervenido" className="u-input mt-2" />
          <input value={sintoma} onChange={(e) => setSintoma(e.target.value)} placeholder="Síntoma o falla reportada" className="u-input mt-2" />
          <textarea value={solucion} onChange={(e) => setSolucion(e.target.value)} rows={3} placeholder="Trabajo realizado / solución aplicada" className="u-input mt-2 resize-none" />
        </Section>
        <Section title="Mano de obra">
          <div className="flex items-center gap-2"><button onClick={toggleTimer} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white ${running ? "bg-rose-500 hover:bg-rose-400" : "bg-emerald-600 hover:bg-emerald-500"}`}>{running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />} {running ? "Detener" : "Cronómetro"}</button>{(running || elapsed > 0) && <span className="font-mono text-sm text-slate-600"><Clock className="mr-1 inline h-3.5 w-3.5" />{fmt}</span>}</div>
          <div className={`mt-2 grid gap-2 ${ger ? "grid-cols-2 min-[430px]:grid-cols-3" : "grid-cols-2"}`}><L label="Horas"><input type="number" value={laborHours} onChange={(e) => setLaborHours(e.target.value)} placeholder="0" className="u-input" /></L><L label="Técnicos"><input type="number" value={technicians} onChange={(e) => setTechnicians(e.target.value)} className="u-input" /></L>{ger && <L label="Tarifa/h"><input type="number" value={rate} onChange={(e) => setRate(e.target.value)} className="u-input" /></L>}</div>
          {ger && <label className="mt-2 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={laborBillable} onChange={(e) => setLaborBillable(e.target.checked)} /> Facturable</label>}
        </Section>
        <Section title="Materiales y repuestos usados">
          <div className="space-y-2">{materials.map((m, i) => (<div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_6rem_auto_auto]"><input list="parts-list" value={m.name} onChange={(e) => { const v = e.target.value; const hit = parts.find((p) => p.name === v); setMat(i, hit ? { name: v, ...(hit.price !== undefined ? { price: hit.price } : {}), ...(hit.cost !== undefined ? { cost: hit.cost } : {}) } : { name: v }); }} placeholder="Descripción del material" className={`u-input min-w-0 ${ger ? "col-span-4 sm:col-span-1" : "col-span-4 sm:col-span-1"}`} /><input type="number" value={m.qty} onChange={(e) => setMat(i, { qty: e.target.value })} className="u-input min-w-0" title="Cantidad" aria-label="Cantidad" placeholder="Cant." />{ger && <input type="number" value={m.price} onChange={(e) => setMat(i, { price: e.target.value })} placeholder="Precio" className="u-input min-w-0" />}{ger && <button onClick={() => setMat(i, { billable: !m.billable })} title={m.billable ? "Material facturable" : "Material no facturable"} aria-label={m.billable ? "Material facturable" : "Material no facturable"} className={`grid h-10 w-10 place-items-center rounded-md ${m.billable ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-300"}`}><DollarSign className="h-4 w-4" /></button>}<button onClick={() => delMat(i)} title="Eliminar material" aria-label="Eliminar material" className="grid h-10 w-10 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button></div>))}</div>
          <datalist id="parts-list">{parts.map((p) => <option key={p.id} value={p.name} />)}</datalist>
          <button onClick={addMaterial} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-brand-400 hover:text-brand-600"><Plus className="h-3.5 w-3.5" /> Agregar material</button>
          {!ger && <p className="mt-2 text-[11px] text-slate-400">Registra qué materiales usaste y en qué cantidad. Los precios los asigna Gerencia.</p>}
        </Section>
        <Section title="Conformidad del cliente"><SignaturePad onChange={setSignatureUrl} /><input value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Nombre de quien firma" className="u-input mt-2" />{!signatureUrl && (<div className="mt-2"><p className="mb-1 text-[11px] text-amber-600">Se recomienda la firma del cliente. Si no es posible, indica el motivo para poder completar igual:</p><input value={noSignReason} onChange={(e) => setNoSignReason(e.target.value)} placeholder="Motivo (ej. cliente ausente)" className="u-input" /></div>)}</Section>
        {ger && (<Box className="p-4"><div className="flex items-center justify-between text-sm text-slate-600"><span>Mano de obra</span><span>{money(preview.labor)}</span></div><div className="flex items-center justify-between text-sm text-slate-600"><span>Materiales</span><span>{money(preview.mats)}</span></div><div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-1 text-base font-semibold text-slate-900"><span>Total</span><span>{money(preview.total)}</span></div></Box>)}
      </main>
      <div className="mobile-bottom-bar fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur sm:px-4"><div className="mx-auto max-w-lg">{canSave && !signatureUrl && !noSignReason.trim() && <div className="mb-2 flex items-start gap-1.5 text-[11px] text-amber-600"><FileSignature className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Para completar, capta la firma o indica un motivo. También puedes guardar como borrador.</div>}<div className="grid grid-cols-2 gap-2"><button disabled={saving} onClick={() => save("Borrador")} className="min-w-0 rounded-lg border border-slate-200 px-2 py-2.5 text-sm font-medium leading-tight text-slate-600 hover:bg-slate-50 disabled:opacity-50">Guardar borrador</button><button onClick={() => save("Completada")} disabled={!canComplete || saving} className="inline-flex min-w-0 items-center justify-center gap-2 rounded-lg bg-brand-500 px-2 py-2.5 text-sm font-semibold leading-tight text-white hover:bg-brand-400 disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />} Guardar y completar</button></div></div></div>
    </div>
  );
}
const Section = ({ title, children }) => <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>{children}</div>;
const Toggle = ({ active, onClick, children }) => <button onClick={onClick} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${active ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600"}`}>{children}</button>;
function PhotoBtn({ icon: Icon, label, cat, capture, onPick }) {
  return (<label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white py-3 text-[11px] font-medium text-slate-600 transition hover:border-brand-400 hover:text-brand-600"><Icon className="h-4 w-4" /> {label}<input type="file" accept="image/*" {...(capture ? { capture: "environment" } : {})} className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; onPick(f, cat); }} /></label>);
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
      {T_STATUS.map((st) => { const col = tasks.filter((t) => t.status === st); const m = T_STYLE[st]; const limit = WIP_LIMITS[st]; const over = limit && col.length > limit; return (
        <div key={st} className={`rounded-xl border-t-4 ${m.col} bg-slate-50/60`}>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm font-semibold text-slate-700">{st}</span>
            <span className={`rounded-full px-2 text-xs font-medium ring-1 ${over ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-white text-slate-500 ring-slate-200"}`}>{col.length}{limit ? `/${limit}` : ""}</span>
          </div>
          {over && <div className="mx-2 mb-1 rounded-md bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-700">Límite de trabajo en curso superado</div>}
          <div className="space-y-2 px-2 pb-3">
            {col.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">Sin tareas</div>}
            {col.map((t) => { const idx = T_STATUS.indexOf(t.status); const age = daysSince(t._updatedAt); return (
              <div key={t.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <button onClick={() => onOpen(t)} className="block w-full text-left">
                  <div className="flex flex-wrap items-center gap-1.5"><Chip className={`${typeMeta[t.type]} ring-1 ring-inset ring-black/5`}>{t.type}</Chip>{isOverdue(t) && <Chip className="bg-rose-50 text-rose-700 ring-rose-600/20"><AlertTriangle className="h-3 w-3" />Vencida</Chip>}{isStale(t) && <Chip className="bg-amber-50 text-amber-700 ring-amber-600/20"><Clock className="h-3 w-3" />Estancada</Chip>}</div>
                  <div className="mt-1.5 text-sm font-medium leading-snug text-slate-800">{t.title}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400"><span className="font-mono">{t.id}</span>{t.due && <span className="inline-flex items-center gap-0.5"><Calendar className="h-3 w-3" />{t.due.slice(5)}</span>}{t.status !== "Hecho" && t._updatedAt && <span className="inline-flex items-center gap-0.5"><Clock className="h-3 w-3" />{age === 0 ? "hoy" : `hace ${age}d`}</span>}</div>
                </button>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5"><Avatar user={userById(t.assignee)} size={22} /><Chip className={`${prioMeta[t.priority]} ring-1 ring-inset ring-black/5`}><Flag className="h-3 w-3" />{t.priority}</Chip></div>
                  <div className="flex gap-1"><button onClick={() => onMove(t.id, -1)} disabled={idx === 0} className="rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button><button onClick={() => onMove(t.id, 1)} disabled={idx === T_STATUS.length - 1} className="rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button></div>
                </div>
              </div>
            ); })}
          </div>
        </div>
      ); })}
    </div>
  );
}

/* Sección reutilizable de actividad y comentarios */
function ActivitySection({ entity, onSend, userById }) {
  const [act, setAct] = useState(entity.activity || []);
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false);
  const send = async () => { const t = text.trim(); if (!t) return; setBusy(true); try { const upd = await onSend(t); setAct(upd.activity || []); setText(""); } catch {} finally { setBusy(false); } };
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Actividad y comentarios</h4>
      <div className="mb-2 max-h-44 space-y-1.5 overflow-y-auto">
        {act.length === 0 && <p className="text-xs text-slate-400">Sin actividad todavía.</p>}
        {act.slice().reverse().map((a, i) => (
          <div key={i} className={`rounded-lg px-2.5 py-1.5 text-xs ${a.type === "comment" ? "bg-brand-50 text-slate-700" : "bg-slate-50 text-slate-500"}`}>
            <div className="flex items-center gap-1">{a.type === "comment" ? <MessageSquare className="h-3 w-3 text-brand-500" /> : <Clock className="h-3 w-3 text-slate-400" />}<span className="font-medium text-slate-700">{a.byName || "—"}</span><span className="ml-auto text-[10px] text-slate-400">{a.at ? new Date(a.at).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</span></div>
            <div className="mt-0.5">{a.text}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Escribe un comentario…" className="u-input flex-1" />
        <button onClick={send} disabled={busy || !text.trim()} className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50">Enviar</button>
      </div>
    </div>
  );
}

/* ===================================== PROYECTOS: MODAL TAREA ===================================== */
function TaskModal({ task, me, users, projects, canAssign, canDelete, nextId, onClose, onSave, onDelete, onComment, prefill }) {
  const editingExisting = !!task;
  const [f, setF] = useState(() => task || { id: null, project: projects[0]?.id || "", title: "", desc: "", assignee: me.id, status: "Por hacer", priority: "Media", type: "Tarea", due: "", ...(prefill || {}) });
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const save = () => { if (!f.title.trim()) return; onSave({ ...f, id: f.id || nextId(f.project), createdAt: f.createdAt || todayStr() }); };
  const assignable = canAssign ? users : users.filter((u) => u.id === me.id);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-semibold text-slate-900">{editingExisting ? f.id : "Nueva tarea"}</h3><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="space-y-3">
          <input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="Título de la tarea" className="u-input text-sm font-medium" />
          <textarea value={f.desc} onChange={(e) => set({ desc: e.target.value })} rows={3} placeholder="Descripción / criterios" className="u-input resize-none" />
          <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2"><L label="Proyecto"><select value={f.project} onChange={(e) => set({ project: e.target.value })} disabled={editingExisting} className="u-input">{projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}</select></L><L label="Responsable"><select value={f.assignee} onChange={(e) => set({ assignee: e.target.value })} className="u-input">{assignable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></L></div>
          <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-3"><L label="Estado"><select value={f.status} onChange={(e) => set({ status: e.target.value })} className="u-input">{T_STATUS.map((s) => <option key={s}>{s}</option>)}</select></L><L label="Prioridad"><select value={f.priority} onChange={(e) => set({ priority: e.target.value })} className="u-input">{PRIORITIES.map((s) => <option key={s}>{s}</option>)}</select></L><L label="Tipo"><select value={f.type} onChange={(e) => set({ type: e.target.value })} className="u-input">{TYPES.map((s) => <option key={s}>{s}</option>)}</select></L></div>
          <L label="Fecha límite"><input type="date" value={f.due} onChange={(e) => set({ due: e.target.value })} className="u-input" /></L>
        </div>
        {editingExisting && onComment && <div className="mt-4 border-t border-slate-100 pt-4"><ActivitySection entity={f} onSend={(text) => onComment(f.id, text)} /></div>}
        <div className="mt-5 flex gap-2">{editingExisting && canDelete && <button onClick={() => onDelete(f.id)} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>}<button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button><button onClick={save} disabled={!f.title.trim()} className="flex-1 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50">{editingExisting ? "Guardar" : "Crear"}</button></div>
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Tareas" value={tasks.length} icon={LayoutGrid} tint="text-brand-600" /><Metric label="Completadas" value={done} icon={CheckCircle2} tint="text-emerald-600" /><Metric label="En curso" value={wip} icon={Clock} tint="text-violet-600" /><Metric label="Vencidas" value={overdue} icon={AlertTriangle} tint="text-rose-600" /></div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><Panel title="Tareas por estado"><ChartBox data={byStatus} /></Panel><Panel title="Carga por responsable"><ChartBox data={byAssignee} /></Panel></div>
      <Panel title="Progreso por proyecto"><div className="space-y-3">{projList.map((p) => { const ts = tasks.filter((t) => t.project === p.id); const d = ts.filter((t) => t.status === "Hecho").length; const pct = ts.length ? Math.round((d / ts.length) * 100) : 0; return (<div key={p.id}><div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium text-slate-700"><span className="font-mono text-xs" style={{ color: p.color }}>{p.key}</span> {p.name}</span><span className="text-slate-500">{d}/{ts.length} · {pct}%</span></div><HealthBar v={pct} color={p.color} /></div>); })}</div></Panel>
    </div>
  );
}
function ChartBox({ data }) {
  return (<div style={{ width: "100%", height: 220 }}><ResponsiveContainer><BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: "#f1f5f9" }} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} /><Bar dataKey="value" radius={[5, 5, 0, 0]}>{data.map((d, i) => <Cell key={i} fill={d.fill} />)}</Bar></BarChart></ResponsiveContainer></div>);
}

/* ===================================== EQUIPO (ADMIN) ===================================== */
/* ===================================== ACCESO POR PROYECTO ===================================== */
function ProjectAccess({ project, users, onClose, onSave }) {
  const techs = users.filter((u) => u.active && (u.role === "tecnico" || u.role === "tecnico_oficina"));
  const [sel, setSel] = useState(new Set(project.allowedUsers || []));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between"><h3 className="text-base font-semibold text-slate-900">Accesos del proyecto</h3><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <p className="mb-3 text-sm text-slate-500">{project.key} · {project.name}. Marcá qué técnicos pueden ver este proyecto y sus tareas. La gerencia siempre lo ve.</p>
        <div className="space-y-1.5">
          {techs.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">No hay técnicos cargados.</div>}
          {techs.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50">
              <input type="checkbox" checked={sel.has(u.id)} onChange={() => toggle(u.id)} className="h-4 w-4" />
              <Avatar user={u} size={26} />
              <div className="min-w-0 flex-1"><div className="text-sm font-medium text-slate-800">{u.name}</div><div className="text-[11px] text-slate-400">{ROLES[u.role]}</div></div>
            </label>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={() => onSave(project.id, [...sel])} className="flex-1 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400">Guardar accesos</button>
        </div>
      </div>
    </div>
  );
}

/* ===================================== DUPLICAR PROYECTO ===================================== */
function DuplicateProject({ project, users, tasksCount, onClose, onDuplicate }) {
  const people = users.filter((u) => u.active);
  const suggestKey = (project.key || "PRJ");
  const [name, setName] = useState(`${project.name} (copia)`);
  const [key, setKey] = useState(suggestKey);
  const [assignee, setAssignee] = useState("");
  const [resetStatus, setResetStatus] = useState(true);
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); await onDuplicate(project.id, { name: name.trim() || `${project.name} (copia)`, key: key.trim() || suggestKey, assignee: assignee || null, resetStatus }); setBusy(false); };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between"><h3 className="text-base font-semibold text-slate-900">Duplicar proyecto</h3><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <p className="mb-4 text-sm text-slate-500">Se creará una copia de <span className="font-medium text-slate-700">{project.name}</span> con sus {tasksCount} tarea(s). Podés reasignarlas todas a una persona.</p>
        <div className="space-y-3">
          <L label="Nombre del nuevo proyecto"><input value={name} onChange={(e) => setName(e.target.value)} className="u-input" /></L>
          <L label="Clave (aparece en el ID de las tareas)"><input value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} className="u-input font-mono" /></L>
          <L label="Asignar todas las tareas a">
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="u-input">
              <option value="">— Mantener responsables actuales —</option>
              {people.map((u) => <option key={u.id} value={u.id}>{u.name} · {ROLES[u.role]}</option>)}
            </select>
          </L>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={resetStatus} onChange={(e) => setResetStatus(e.target.checked)} className="h-4 w-4" /> Reiniciar todas las tareas en "Por hacer"</label>
          {assignee && <p className="rounded-lg bg-brand-50 p-2.5 text-[11px] text-brand-700">La persona asignada tendrá acceso automático al nuevo proyecto.</p>}
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={go} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Duplicar</button>
        </div>
      </div>
    </div>
  );
}

/* ===================================== INVENTARIO / REPUESTOS ===================================== */
function Inventory({ parts, onAdd, onPatch, onRemove, onErr }) {
  const [nf, setNf] = useState({ name: "", unit: "u", price: "", cost: "", stock: "", minStock: "" });
  const [editId, setEditId] = useState(null);
  const [ef, setEf] = useState({});
  const wrap = (fn) => async (...a) => { try { await fn(...a); } catch (e) { onErr(e); } };
  const add = async () => { if (!nf.name.trim()) return; try { await onAdd({ name: nf.name.trim(), unit: nf.unit.trim() || "u", price: Number(nf.price) || 0, cost: Number(nf.cost) || 0, stock: Number(nf.stock) || 0, minStock: Number(nf.minStock) || 0 }); setNf({ name: "", unit: "u", price: "", cost: "", stock: "", minStock: "" }); } catch (e) { onErr(e); } };
  const startEdit = (p) => { setEditId(p.id); setEf({ name: p.name || "", unit: p.unit || "u", price: p.price ?? 0, cost: p.cost ?? 0, stock: p.stock ?? 0, minStock: p.minStock ?? 0 }); };
  const saveEdit = async () => { if (!ef.name.trim()) return; try { await onPatch(editId, { name: ef.name.trim(), unit: ef.unit.trim() || "u", price: Number(ef.price) || 0, cost: Number(ef.cost) || 0, stock: Number(ef.stock) || 0, minStock: Number(ef.minStock) || 0 }); setEditId(null); } catch (e) { onErr(e); } };
  const del = (p) => { if (window.confirm(`¿Eliminar el repuesto "${p.name}"?`)) wrap(onRemove)(p.id); };
  const low = parts.filter((p) => typeof p.stock === "number" && typeof p.minStock === "number" && p.stock <= p.minStock);
  const sorted = [...parts].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2">
        {low.length > 0 && <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{low.length} repuesto(s) en o por debajo del stock mínimo: {low.map((p) => p.name).join(", ")}.</div>}
        <Panel title={`Repuestos (${parts.length})`}>
          <div className="space-y-2">
            {sorted.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">Sin repuestos cargados</div>}
            {sorted.map((p) => {
              const isLow = p.stock <= p.minStock;
              const margin = p.price ? Math.round((1 - (p.cost || 0) / p.price) * 100) : null;
              if (editId === p.id) return (
                <div key={p.id} className="rounded-lg border border-brand-300 bg-brand-50/40 p-3">
                  <L label="Nombre"><input value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} className="u-input" /></L>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <L label="Unidad"><input value={ef.unit} onChange={(e) => setEf({ ...ef, unit: e.target.value })} className="u-input" /></L>
                    <L label="Stock"><input type="number" value={ef.stock} onChange={(e) => setEf({ ...ef, stock: e.target.value })} className="u-input" /></L>
                    <L label="Stock mínimo"><input type="number" value={ef.minStock} onChange={(e) => setEf({ ...ef, minStock: e.target.value })} className="u-input" /></L>
                    <L label="Precio venta"><input type="number" value={ef.price} onChange={(e) => setEf({ ...ef, price: e.target.value })} className="u-input" /></L>
                    <L label="Costo"><input type="number" value={ef.cost} onChange={(e) => setEf({ ...ef, cost: e.target.value })} className="u-input" /></L>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => setEditId(null)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
                    <button onClick={saveEdit} disabled={!ef.name.trim()} className="flex-1 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50">Guardar</button>
                  </div>
                </div>
              );
              return (
                <div key={p.id} className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${isLow ? "border-rose-200 bg-rose-50/40" : "border-slate-200"}`}>
                  <div className="min-w-0 basis-full flex-1 sm:basis-auto"><div className="break-words text-sm font-semibold text-slate-800">{p.name}</div><div className="break-words text-xs text-slate-500">Venta {money(p.price)} · Costo {money(p.cost)}{margin != null && <span className="text-emerald-600"> · margen {margin}%</span>}</div></div>
                  <span className={`rounded-md px-2 py-1 text-xs font-medium ${isLow ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"}`}>Stock: {p.stock} {p.unit}</span>
                  <span className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500">Mín: {p.minStock}</span>
                  <button onClick={() => startEdit(p)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Editar</button>
                  <button onClick={() => del(p)} title="Eliminar" className="rounded-md p-1.5 text-slate-400 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
      <div><Panel title="Nuevo repuesto">
        <div className="space-y-2">
          <L label="Nombre"><input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="Descripción del repuesto" className="u-input" /></L>
          <div className="grid grid-cols-2 gap-2">
            <L label="Unidad"><input value={nf.unit} onChange={(e) => setNf({ ...nf, unit: e.target.value })} placeholder="u / m / kg" className="u-input" /></L>
            <L label="Stock"><input type="number" value={nf.stock} onChange={(e) => setNf({ ...nf, stock: e.target.value })} className="u-input" /></L>
            <L label="Precio venta"><input type="number" value={nf.price} onChange={(e) => setNf({ ...nf, price: e.target.value })} className="u-input" /></L>
            <L label="Costo"><input type="number" value={nf.cost} onChange={(e) => setNf({ ...nf, cost: e.target.value })} className="u-input" /></L>
            <L label="Stock mínimo"><input type="number" value={nf.minStock} onChange={(e) => setNf({ ...nf, minStock: e.target.value })} className="u-input" /></L>
          </div>
          <button onClick={add} disabled={!nf.name.trim()} className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"><Plus className="h-4 w-4" /> Agregar repuesto</button>
          <p className="text-[11px] text-slate-400">El catálogo autocompleta los materiales al crear una orden. Cuando el stock llega al mínimo, aparece un aviso en esta pestaña.</p>
        </div>
      </Panel></div>
    </div>
  );
}

/* ===================================== CLIENTES ===================================== */
function Clients({ clients, orders, onAdd, onPatch, onRemove, onErr }) {
  const [nf, setNf] = useState({ name: "", site: "", code: "" });
  const suggest = (name) => (name || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  const add = async () => {
    if (!nf.name.trim()) return;
    try { await onAdd({ name: nf.name.trim(), site: nf.site.trim(), code: nf.code.trim().toUpperCase() || undefined }); setNf({ name: "", site: "", code: "" }); }
    catch (e) { onErr(e); }
  };
  const wrap = (fn) => async (...a) => { try { await fn(...a); } catch (e) { onErr(e); } };
  const editName = (c) => { const v = prompt("Nombre del cliente:", c.name); if (v && v.trim()) wrap(onPatch)(c.id, { name: v.trim() }); };
  const editSite = (c) => { const v = prompt("Sitio / ubicación:", c.site || ""); if (v !== null) wrap(onPatch)(c.id, { site: v.trim() }); };
  const editCode = (c) => { const v = prompt("Código del cliente (aparece en el N° de OT):", c.code || ""); if (v && v.trim()) wrap(onPatch)(c.id, { code: v.trim().toUpperCase() }); };
  const del = (c) => { const n = orders.filter((o) => (o.client || "").trim().toLowerCase() === (c.name || "").trim().toLowerCase()).length; if (window.confirm(`¿Eliminar el cliente "${c.name}"?${n ? ` Tiene ${n} orden(es) asociadas (no se borran).` : ""}`)) wrap(onRemove)(c.id); };
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2"><Panel title={`Clientes (${clients.length})`}>
        <div className="space-y-2">
          {clients.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">Sin clientes</div>}
          {clients.map((c) => { const ords = orders.filter((o) => (o.client || "").trim().toLowerCase() === (c.name || "").trim().toLowerCase()).length; return (
            <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3">
              <span className="grid h-9 min-w-[3rem] place-items-center rounded-md bg-slate-800 px-2 font-mono text-xs font-bold text-white" title="Código del cliente">{c.code || "—"}</span>
              <div className="min-w-0 flex-1"><div className="break-words text-sm font-semibold text-slate-800">{c.name}</div><div className="break-words text-xs text-slate-500">{c.site || "—"} · {ords} orden(es)</div></div>
              <div className="flex w-full items-center justify-end gap-1 border-t border-slate-100 pt-2 sm:w-auto sm:border-0 sm:pt-0">
                <button onClick={() => editCode(c)} title="Editar código" className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Código</button>
                <button onClick={() => editName(c)} title="Editar nombre" aria-label="Editar nombre" className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-slate-50 hover:text-brand-600"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => editSite(c)} title="Editar sitio" aria-label="Editar sitio" className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-slate-50 hover:text-brand-600"><MapPin className="h-4 w-4" /></button>
                <button onClick={() => del(c)} title="Eliminar" aria-label="Eliminar cliente" className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ); })}
        </div>
      </Panel></div>
      <div><Panel title="Nuevo cliente">
        <div className="space-y-2">
          <L label="Nombre"><input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value, code: nf.code || suggest(e.target.value) })} placeholder="Razón social" className="u-input" /></L>
          <L label="Sitio / ubicación"><input value={nf.site} onChange={(e) => setNf({ ...nf, site: e.target.value })} placeholder="Planta, línea, sala…" className="u-input" /></L>
          <L label="Código (para el N° de OT)"><input value={nf.code} onChange={(e) => setNf({ ...nf, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })} placeholder="Ej. LDV" className="u-input font-mono" /></L>
          <button onClick={add} disabled={!nf.name.trim()} className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"><Plus className="h-4 w-4" /> Agregar cliente</button>
          <p className="text-[11px] text-slate-400">El código identifica al cliente en el número de orden (ej. <span className="font-mono">OT-LDV-2026-001</span>). Si lo dejas vacío, se genera automáticamente. Los nombres duplicados se unifican.</p>
        </div>
      </Panel></div>
    </div>
  );
}

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
            <div className="min-w-0 flex-1"><div className="break-words text-sm font-semibold text-slate-800">{u.name}{u.id === me.id && <span className="ml-1 text-[11px] text-slate-400">(tú)</span>}</div><div className="break-all text-xs text-slate-500">{u.email} · {load} tarea(s) · {ords} orden(es)</div></div>
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-slate-100 pt-2 sm:w-auto sm:border-0 sm:pt-0">
              <select value={u.role} onChange={(e) => wrap(onPatch)(u.id, { role: e.target.value })} disabled={u.id === me.id} className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs disabled:opacity-60 sm:flex-none">{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button onClick={() => wrap(onPatch)(u.id, { active: !u.active })} disabled={u.id === me.id} className={`min-h-9 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40 ${u.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{u.active ? "Activo" : "Inactivo"}</button>
              <button onClick={() => wrap(onRemove)(u.id)} disabled={u.id === me.id} title="Eliminar empleado" aria-label="Eliminar empleado" className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ); })}</div>
      </Panel></div>
      <div><Panel title="Nuevo empleado">
        <div className="space-y-2"><L label="Nombre"><input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="Nombre y apellido" className="u-input" /></L><L label="Correo"><input value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} placeholder="correo@empresa.com" className="u-input" /></L><L label="Contraseña inicial"><input value={nf.password} onChange={(e) => setNf({ ...nf, password: e.target.value })} placeholder="(opcional; usa la de por defecto)" className="u-input" /></L><L label="Rol"><select value={nf.role} onChange={(e) => setNf({ ...nf, role: e.target.value })} className="u-input">{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></L><button onClick={add} disabled={!nf.name.trim() || !nf.email.trim()} className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"><UserPlus className="h-4 w-4" /> Crear perfil</button><p className="text-[11px] text-slate-400">Este directorio se usa en Órdenes y en Proyectos. El técnico luego cambia su contraseña con el administrador.</p></div>
      </Panel></div>
    </div>
  );
}
