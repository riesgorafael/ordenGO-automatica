import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarChart, Bar as RechartsBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie as RechartsPie, Legend } from "recharts";
import {
  Plus, X, Search, Camera, Upload, Sparkles, Loader2, MapPin, Clock, ClipboardList,
  FileSignature, CheckCircle2, AlertTriangle, Download, Trash2, Play, Square,
  ChevronLeft, ChevronRight, Wrench, DollarSign, Building2, Filter, LayoutGrid,
  BarChart3, Users, UserPlus, Calendar, Flag, Folder, LogOut, Briefcase, KeyRound, FileText, Pencil,
  Bell, Home, MessageSquare, Copy, Link2, TrendingUp, TrendingDown, Menu, Settings2, Palette,
  WifiOff, RefreshCw, ListTodo, Phone, Navigation, ExternalLink, CircleHelp, Maximize2,
} from "lucide-react";
import { api, setToken, getToken } from "./api";
import { LOGO, LOGO_LIGHT } from "./logo";
import { clientOrderReportPDF, internalOrderReportPDF, monthlyReportPDF, valuedClientReportPDF } from "./pdf";
import { clearOrderDraft, flushOfflineQueue, loadOrderDraft, offlineQueueSize, queueOfflineOperation, rememberSyncedOrderId, resolveSyncedOrderId, saveOrderDraft, updateQueuedOrder } from "./offline";

/* ===================================== CONFIG ===================================== */
const CUR = "USD ";
const DEFAULT_RATE = 50;
const ROLES = { admin: "Administrador", gerente: "Gerencia / Gerente", tecnico: "Técnico de campo", tecnico_oficina: "Técnico de oficina", monitor_oficina: "Monitor de oficina" };
const allowedModulesForRole = (role) => role === "monitor_oficina" ? ["projects"] : ["inicio", ...(["admin", "gerente"].includes(role) ? ["panel", "budgets", "finances"] : []), ...(["tecnico_oficina", "monitor_oficina"].includes(role) ? [] : ["orders"]), "projects", ...(["admin", "gerente"].includes(role) ? ["clients", "inventory"] : []), ...(role === "admin" ? ["team", "settings"] : [])];
const DEFAULT_BRANDING = { appName: "OrdenGO", subtitle: "Campo + Proyectos", companyName: "AUTOMATICA ARG", theme: "automatica", primaryColor: "#F18700", headerColor: "#2E2E2D", logoDataUrl: "", tvModeEnabled: false, tvCycleEnabled: false, tvCycleSeconds: 30 };
const BRAND_THEMES = [
  { id: "automatica", name: "Automática", primaryColor: "#F18700", headerColor: "#2E2E2D" },
  { id: "industrial", name: "Industrial", primaryColor: "#2563EB", headerColor: "#172033" },
  { id: "energia", name: "Energía", primaryColor: "#059669", headerColor: "#16312A" },
  { id: "control", name: "Control", primaryColor: "#7C3AED", headerColor: "#261B36" },
  { id: "grafito", name: "Grafito", primaryColor: "#475569", headerColor: "#1E293B" },
];
const mixHex = (from, to, weight) => {
  const parse = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const [fr, fg, fb] = parse(from); const [tr, tg, tb] = parse(to);
  return `#${[fr, fg, fb].map((value, index) => Math.round(value + ([tr, tg, tb][index] - value) * weight).toString(16).padStart(2, "0")).join("")}`;
};
const applyBrandingTheme = (branding) => {
  const root = document.documentElement; const primary = branding.primaryColor || DEFAULT_BRANDING.primaryColor; const header = branding.headerColor || DEFAULT_BRANDING.headerColor;
  [[50, mixHex(primary, "#FFFFFF", 0.94)], [100, mixHex(primary, "#FFFFFF", 0.86)], [200, mixHex(primary, "#FFFFFF", 0.7)], [300, mixHex(primary, "#FFFFFF", 0.5)], [400, mixHex(primary, "#FFFFFF", 0.24)], [500, primary], [600, mixHex(primary, "#000000", 0.12)], [700, mixHex(primary, "#000000", 0.3)]].forEach(([shade, color]) => root.style.setProperty(`--color-brand-${shade}`, color));
  root.style.setProperty("--color-ink-900", header); root.style.setProperty("--color-ink-800", mixHex(header, "#FFFFFF", 0.08));
  document.title = `${branding.appName || DEFAULT_BRANDING.appName} · ${branding.subtitle || DEFAULT_BRANDING.subtitle}`;
};
const PALETTE = ["#0ea5e9", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#6366f1"];
const money = (n) => `${CUR}${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const wholeMoney = (value) => Math.max(0, Math.round(Number(value) || 0));
const normalizedRate = (value) => { const rate = wholeMoney(value); return !rate || rate === 850 ? DEFAULT_RATE : rate; };

const O_STATUS = ["Borrador", "En proceso de ejecución", "Completada", "Aprobada", "Facturada"];
const O_STYLE = {
  "Borrador": "bg-slate-100 text-slate-600 ring-slate-500/20", "En progreso": "bg-brand-50 text-brand-700 ring-brand-600/20", "En proceso de ejecución": "bg-brand-50 text-brand-700 ring-brand-600/20",
  "Completada": "bg-amber-50 text-amber-700 ring-amber-600/20", "Aprobada": "bg-violet-50 text-violet-700 ring-violet-600/20",
  "Facturada": "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
};
const SERVICE_TYPES = ["Instalación", "Automatización", "Mantenimiento preventivo", "Mantenimiento correctivo", "Garantía", "Emergencia"];
const BUDGET_STAGES = ["Borrador", "En preparación", "Enviado", "En seguimiento", "Aprobado", "Facturado", "Rechazado"];
const BUDGET_STAGE_PROBABILITY = { "Borrador": 10, "En preparación": 25, "Enviado": 50, "En seguimiento": 70, "Aprobado": 100, "Facturado": 100, "Rechazado": 0 };
const LABOR_ROLES = [
  { name: "Programador", cost: 50 }, { name: "Ingeniero", cost: 25 }, { name: "Asesor", cost: 20 },
  { name: "Programador AUX", cost: 45 }, { name: "Tablerista", cost: 17 }, { name: "Dibujante", cost: 17 },
  { name: "Administrativo", cost: 6 }, { name: "Ayudante", cost: 5 }, { name: "Programador Aprendiz", cost: 7 },
];
const LABOR_TYPES = ["Mano de obra", "Ingeniería", "Programación", "Montaje", "Puesta en marcha"];
const ADDITIONAL_COST_CATEGORIES = ["Retrabajo", "Ingeniería adicional", "Programación adicional", "Materiales", "Viáticos", "Terceros", "Otro"];
const DEFAULT_ROLE_BY_TYPE = { "Mano de obra": "Ingeniero", "Ingeniería": "Ingeniero", "Programación": "Programador", "Montaje": "Tablerista", "Puesta en marcha": "Ingeniero" };
const BUDGET_STYLE = {
  "Borrador": "bg-slate-100 text-slate-600 ring-slate-200", "En preparación": "bg-sky-50 text-sky-700 ring-sky-200",
  "Enviado": "bg-brand-50 text-brand-700 ring-brand-200", "En seguimiento": "bg-violet-50 text-violet-700 ring-violet-200",
  "Aprobado": "bg-emerald-50 text-emerald-700 ring-emerald-200", "Facturado": "bg-sky-50 text-sky-700 ring-sky-200", "Rechazado": "bg-rose-50 text-rose-700 ring-rose-200",
  "Vencido": "bg-amber-50 text-amber-700 ring-amber-200",
};
const BUDGET_GROUPS = [
  { id: "preparation", label: "Preparación", statuses: ["Borrador", "En preparación"], color: "slate", detail: ["Borrador", "En preparación"] },
  { id: "commercial", label: "Gestión comercial", statuses: ["Enviado", "En seguimiento"], color: "violet", detail: ["Enviado", "En seguimiento"] },
  { id: "won", label: "Ganados", statuses: ["Aprobado", "Facturado"], color: "emerald", detail: ["Aprobado", "Facturado"] },
  { id: "lost", label: "Perdidos", statuses: ["Rechazado"], color: "rose", detail: ["Rechazado"] },
];
const BUDGET_STAGE_GROUPS = [
  { label: "Preparación", stages: ["Borrador", "En preparación"] },
  { label: "Gestión comercial", stages: ["Enviado", "En seguimiento"] },
  { label: "Cierre comercial", stages: ["Aprobado", "Rechazado"] },
  { label: "Condición financiera", stages: ["Facturado"] },
];
const SIGNER_ROLES = ["Responsable de planta", "Mantenimiento", "Jefe o supervisor de mantenimiento", "Producción / Operaciones", "Ingeniería / Automatización", "Seguridad e Higiene", "Calidad", "Administración / Compras", "Contratista / Integrador"];
const SERVICE_PROFILES = {
  "Instalación": { assess: "Preparación", work: "Ejecución", symptom: "Alcance de la instalación y condición inicial", diagnosis: "Condiciones previas y requisitos técnicos", automation: true, installation: true },
  "Automatización": { assess: "Relevamiento", work: "Programación", symptom: "Necesidad funcional o comportamiento reportado", diagnosis: "Relevamiento técnico del sistema", rootCause: true, automation: true },
  "Mantenimiento preventivo": { assess: "Inspección", work: "Mantenimiento", symptom: "Condición inicial u observación del cliente", diagnosis: "Hallazgos de la inspección", preventive: true },
  "Mantenimiento correctivo": { assess: "Diagnóstico", work: "Reparación", symptom: "Síntoma o falla reportada", diagnosis: "Diagnóstico técnico / condición encontrada", rootCause: true },
  "Garantía": { assess: "Validación", work: "Resolución", symptom: "Falla reclamada por el cliente", diagnosis: "Validación técnica de la garantía", rootCause: true, warranty: true },
  "Emergencia": { assess: "Incidente", work: "Restablecimiento", symptom: "Incidente y efecto sobre la producción", diagnosis: "Diagnóstico inicial de emergencia", rootCause: true, emergency: true },
};
const EMPTY_TECHNICAL = {
  assetTag: "", manufacturer: "", model: "", serial: "", reportedAt: "", arrivalAt: "", startedAt: "", completedAt: "", downtimeMinutes: "", billableWaitMinutes: "", billableWaitReason: "",
  workSessions: [], diagnosis: "", rootCause: "", measurementsBefore: "", measurementsAfter: "", testsPerformed: "", testResult: "", finalCondition: "Operativo",
  recommendations: "", pendingActions: "", followUpDate: "", signerRole: "", signerCompany: "", deviceType: "", firmware: "", programVersion: "", backupRef: "",
  ioVerified: "", alarmsVerified: "", setpointChanges: "", internalNotes: "", warranty: "", recurrence: "", internalDisposition: "", internalOwner: "",
  installationScope: "", requiredDocuments: "", mountingWiring: "", commissioning: "", trainingProvided: "", preventiveChecklist: "", cleaningAdjustments: "", wearFindings: "",
  warrantyReference: "", warrantyDecision: "", emergencyPriority: "", productionImpact: "", temporaryRestoration: "", timelineAdjustmentReason: "",
};
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
      resolve({ analysis: mk(1280, 0.82), report: mk(1600, 0.86), thumb: mk(320, 0.7) }); };
      img.onerror = reject; img.src = rd.result; };
    rd.onerror = reject; rd.readAsDataURL(file);
  });
}
async function analyzeImage(dataUrl) { return api.analyze(dataUrl.split(",")[1]); }

function orderTotals(o) {
  const billedHours = billableLaborHours(o);
  const labor = o.laborBillable ? billedHours * (Number(o.technicians) || 1) * (Number(o.rate) || 0) : 0;
  const mats = (o.materials || []).filter((m) => m.billable).reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.price) || 0), 0);
  return { labor, mats, total: labor + mats, billedHours };
}
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function orderCosts(o) {
  const actualHours = (Number(o.laborHours) || 0) + (Math.max(0, Number(o.technical?.billableWaitMinutes) || 0) / 60);
  const labor = actualHours * (Number(o.technicians) || 1) * (Number(o.laborCost) || 0);
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
const localDateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const localMonthKey = (date = new Date()) => localDateKey(date).slice(0, 7);
const todayStr = () => localDateKey();
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addCalendarDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const startOfCalendarWeek = (date) => addCalendarDays(date, -((date.getDay() + 6) % 7));
const isOverdue = (t) => t.due && t.due < todayStr() && t.status !== "Hecho";
const dueLabel = (due) => {
  if (!due) return "Sin fecha";
  const today = new Date(`${todayStr()}T12:00:00`);
  const target = new Date(`${due}T12:00:00`);
  const days = Math.round((target - today) / 86400000);
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  if (days === -1) return "Venció ayer";
  if (days < 0) return `Venció hace ${Math.abs(days)} días`;
  return target.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
};
const daysSince = (iso) => { if (!iso) return 0; return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); };
const STALE_DAYS = 4; // días sin cambios para marcar "estancada"
const WIP_LIMITS = { "En progreso": 5, "En revisión": 3 }; // límites de trabajo en curso por columna
const isStale = (t) => t.status !== "Hecho" && daysSince(t._updatedAt) >= STALE_DAYS;
const readPreference = (key, fallback) => { try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") }; } catch { return fallback; } };
const deviceLabel = () => {
  if (typeof navigator === "undefined") return "esta computadora";
  if (typeof navigator.userAgentData?.mobile === "boolean") return navigator.userAgentData.mobile ? "este teléfono" : "esta computadora";
  return /Android.+Mobile|iPhone|iPod|Windows Phone|IEMobile|Opera Mini|webOS|BlackBerry/i.test(navigator.userAgent || "") ? "este teléfono" : "esta computadora";
};
const dateTimeLocalValue = (value) => {
  if (!value) return "";
  const date = new Date(value); if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const isoFromLocal = (value) => value ? new Date(value).toISOString() : "";
const timelineWorkMs = (technical, now = Date.now()) => {
  const sessions = Array.isArray(technical?.workSessions) ? technical.workSessions : [];
  if (sessions.length) return sessions.reduce((total, session) => {
    const start = new Date(session.start).getTime(); const end = session.end ? new Date(session.end).getTime() : now;
    return total + (Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0);
  }, 0);
  const start = technical?.startedAt ? new Date(technical.startedAt).getTime() : NaN;
  const end = technical?.completedAt ? new Date(technical.completedAt).getTime() : now;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
};
const timelineErrors = (technical, now = Date.now()) => {
  const errors = [];
  const points = [["aviso", technical?.reportedAt], ["llegada", technical?.arrivalAt], ["inicio", technical?.startedAt], ["finalización", technical?.completedAt]]
    .filter(([, value]) => value)
    .map(([label, value]) => [label, new Date(value).getTime()]);
  for (let index = 1; index < points.length; index += 1) {
    if (!Number.isFinite(points[index - 1][1]) || !Number.isFinite(points[index][1]) || points[index][1] < points[index - 1][1]) {
      errors.push(`La ${points[index][0]} no puede ser anterior al ${points[index - 1][0]}.`);
    }
  }
  const arrival = technical?.arrivalAt ? new Date(technical.arrivalAt).getTime() : NaN;
  const end = technical?.completedAt ? new Date(technical.completedAt).getTime() : now;
  if (Number.isFinite(arrival) && Number.isFinite(end) && end >= arrival) {
    const onSiteMinutes = Math.max(1, Math.ceil((end - arrival) / 60000));
    const effectiveMinutes = Math.ceil(timelineWorkMs(technical, end) / 60000);
    if (effectiveMinutes > onSiteMinutes) errors.push(`El tiempo efectivo (${effectiveMinutes} min) supera el tiempo total en planta (${onSiteMinutes} min). Revisa los horarios.`);
    const waitMinutes = Number(technical?.billableWaitMinutes) || 0;
    if (waitMinutes > onSiteMinutes) errors.push(`La espera registrada (${waitMinutes} min) supera el tiempo total en planta (${onSiteMinutes} min). Revisa la llegada, la finalización o la espera.`);
  }
  if ((Number(technical?.billableWaitMinutes) || 0) > 0 && !technical?.billableWaitReason?.trim()) errors.push("Indica el motivo de la espera por condiciones del sitio.");
  return errors;
};
const billableLaborHours = (order, now = Date.now()) => {
  if (order?.billableHours !== undefined && order?.billableHours !== null && order?.billableHours !== "") return Math.max(0, Number(order.billableHours) || 0);
  const effective = Math.max(0, Number(order?.laborHours) || 0);
  const waiting = Math.max(0, Number(order?.technical?.billableWaitMinutes) || 0) / 60;
  const arrival = order?.technical?.arrivalAt ? new Date(order.technical.arrivalAt).getTime() : NaN;
  const end = order?.technical?.completedAt ? new Date(order.technical.completedAt).getTime() : now;
  const onSiteMs = Number.isFinite(arrival) && Number.isFinite(end) ? Math.max(0, end - arrival) : 0;
  return onSiteMs > 0 && onSiteMs < 3600000 ? 2 : round2(effective + waiting);
};
const compactDuration = (milliseconds) => {
  const minutes = Math.max(0, Math.round((Number(milliseconds) || 0) / 60000));
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
};

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
};
const Bar = (props) => <RechartsBar {...props} isAnimationActive={!useReducedMotion()} animationDuration={550} animationEasing="ease-out" />;
const Pie = (props) => <RechartsPie {...props} isAnimationActive={!useReducedMotion()} animationDuration={550} animationEasing="ease-out" />;

const Chip = ({ children, className = "" }) => (<span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>{children}</span>);
const Box = ({ children, className = "" }) => (<div className={`motion-card rounded-xl border border-slate-200 bg-white ${className}`}>{children}</div>);
const Panel = ({ title, children }) => (<div className="motion-card h-full rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-3 text-sm font-semibold leading-5 text-slate-900 sm:min-h-10">{title}</h3>{children}</div>);
const HelpHint = ({ text }) => <span tabIndex={0} aria-label={text} className="group/hint relative inline-flex cursor-help align-middle outline-none"><CircleHelp className="h-3.5 w-3.5 text-slate-400 transition-colors group-hover/hint:text-brand-600 group-focus-visible/hint:text-brand-600" /><span role="tooltip" className="pointer-events-none invisible absolute bottom-[calc(100%+0.4rem)] right-0 z-[80] w-64 rounded-lg bg-slate-900 px-3 py-2 text-left text-[11px] font-normal leading-relaxed text-white opacity-0 shadow-xl transition-opacity group-hover/hint:visible group-hover/hint:opacity-100 group-focus-visible/hint:visible group-focus-visible/hint:opacity-100">{text}</span></span>;
const L = ({ label, children, help = "" }) => <label className="block"><span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-500">{label}{help && <HelpHint text={help} />}</span>{children}</label>;
const Avatar = ({ user, size = 28 }) => (<div className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: user?.color || "#94a3b8", fontSize: size * 0.4 }} title={user?.name}>{initials(user?.name)}</div>);
const Metric = ({ label, value, icon: Icon, tint, description = "" }) => (
  <div tabIndex={description ? 0 : undefined} aria-label={description ? `${label}: ${value}. ${description}` : undefined} className={`motion-card group relative rounded-xl border border-slate-200 bg-white p-3 ${description ? "cursor-help outline-none hover:z-40 focus-visible:z-40 focus-visible:ring-2 focus-visible:ring-brand-500/40" : ""}`}>
    <div className="flex items-center justify-between"><span className="text-[11px] font-medium text-slate-500">{label}</span><Icon className={`h-4 w-4 ${tint}`} /></div>
    <div className="mt-0.5 text-lg font-semibold text-slate-900" style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
    {description && <div role="tooltip" className="pointer-events-none invisible absolute left-2 right-2 top-[calc(100%+0.45rem)] z-50 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-normal leading-relaxed text-white opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"><span className="absolute -top-1.5 right-4 h-3 w-3 rotate-45 bg-slate-900" />{description}</div>}
  </div>
);
const HealthBar = ({ v, color }) => (<div className="motion-progress h-2 w-full rounded-full bg-slate-200"><div className="h-2 rounded-full" style={{ width: `${v}%`, background: color || "#0ea5e9" }} /></div>);

/* ===================================== APP ===================================== */
export default function App() {
  const savedOrderFilters = useMemo(() => readPreference("ordengo_order_filters", { q: "", status: "Todas", billable: false }), []);
  const savedProjectFilters = useMemo(() => readPreference("ordengo_project_filters", { project: "all", q: "", mine: false, stale: false }), []);
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [orders, setOrders] = useState([]);
  const [projects, setProjects] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [finances, setFinances] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [parts, setParts] = useState([]);
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [module, setModule] = useState("orders");
  const [oView, setOView] = useState("list");
  const [oDetail, setODetail] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [oQ, setOQ] = useState(savedOrderFilters.q); const [oStatus, setOStatus] = useState(savedOrderFilters.status); const [oBillable, setOBillable] = useState(savedOrderFilters.billable);
  const [oTab, setOTab] = useState("list");
  const [pTab, setPTab] = useState("board");
  const [techTaskView, setTechTaskView] = useState(() => { try { return localStorage.getItem("ordengo_tech_task_view") || "work"; } catch { return "work"; } });
  const [pProj, setPProj] = useState(savedProjectFilters.project); const [pQ, setPQ] = useState(savedProjectFilters.q); const [pMine, setPMine] = useState(savedProjectFilters.mine);
  const [editing, setEditing] = useState(undefined);
  const [pwOpen, setPwOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [projectEditor, setProjectEditor] = useState(null);
  const [pStale, setPStale] = useState(savedProjectFilters.stale);
  const [prefill, setPrefill] = useState(null);
  const [orderPrefill, setOrderPrefill] = useState(null);
  const [accessProj, setAccessProj] = useState(null); // proyecto cuyo acceso se está gestionando
  const [dupProj, setDupProj] = useState(null); // proyecto a duplicar
  const [budgetCreateSignal, setBudgetCreateSignal] = useState(0);
  const [financeCreateSignal, setFinanceCreateSignal] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [offlineCount, setOfflineCount] = useState(() => offlineQueueSize());
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [offlineSyncFailed, setOfflineSyncFailed] = useState(false);
  const [offlineRetry, setOfflineRetry] = useState(0);
  const toast = (msg, type = "info") => { const id = Date.now() + Math.random(); setToasts((t) => [...t, { id, msg, type, leaving: false }]); setTimeout(() => setToasts((t) => t.map((x) => x.id === id ? { ...x, leaving: true } : x)), 3200); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3450); };
  const navigateModule = (nextModule) => {
    if (nextModule !== module) {
      setBudgetCreateSignal(0); setFinanceCreateSignal(0);
      setODetail(null); setEditingOrder(null); setEditing(undefined); setPrefill(null); setOrderPrefill(null);
      setProjectEditor(null); setAccessProj(null); setDupProj(null);
      setConfirmDialog(null); setGlobalSearchOpen(false); setNotifOpen(false); setMobileMoreOpen(false);
    }
    setModule(nextModule);
  };
  useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener("online", on); window.addEventListener("offline", off); return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); }; }, []);
  useEffect(() => { const openSearch = (e) => { if ((e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) { e.preventDefault(); setGlobalSearchOpen(true); } }; window.addEventListener("keydown", openSearch); return () => window.removeEventListener("keydown", openSearch); }, []);
  useEffect(() => {
    if (!notifOpen) return;
    const closeOutside = (event) => { if (notifRef.current && !notifRef.current.contains(event.target)) setNotifOpen(false); };
    const closeWithKeyboard = (event) => { if (event.key === "Escape") setNotifOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithKeyboard);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeWithKeyboard); };
  }, [notifOpen]);
  useEffect(() => { setNotifOpen(false); }, [module]);

  const boot = async () => {
    const d = await api.bootstrap();
    setMe(d.me); setUsers(d.users); setClients(d.clients); setProjects(d.projects); setBudgets(d.budgets || []); setFinances(d.finances || []); setOrders((d.orders || []).map((order) => order.status === "En progreso" ? { ...order, status: "En proceso de ejecución" } : order)); setTasks(d.tasks); setBranding(d.branding || DEFAULT_BRANDING);
    setNotifs(d.notifications || []); setParts(d.parts || []);
    try {
      const savedNavigation = JSON.parse(localStorage.getItem(`ordengo_navigation_${d.me.id}`) || "{}");
      const allowed = allowedModulesForRole(d.me.role);
      if (allowed.includes(savedNavigation.module)) setModule(savedNavigation.module);
      if (["list", "report"].includes(savedNavigation.orderTab)) setOTab(savedNavigation.orderTab);
      if (["board", "calendar", "reports"].includes(savedNavigation.projectTab)) setPTab(savedNavigation.projectTab);
    } catch {}
  };
  useEffect(() => { (async () => {
    try { setBranding(await api.getBranding()); } catch {}
    if (getToken()) { try { await boot(); } catch { setToken(null); } }
    setBooting(false);
  })(); }, []);
  useEffect(() => { applyBrandingTheme(branding); }, [branding]);
  useEffect(() => { try { localStorage.setItem("ordengo_order_filters", JSON.stringify({ q: oQ, status: oStatus, billable: oBillable })); } catch {} }, [oQ, oStatus, oBillable]);
  useEffect(() => { try { localStorage.setItem("ordengo_project_filters", JSON.stringify({ project: pProj, q: pQ, mine: pMine, stale: pStale })); } catch {} }, [pProj, pQ, pMine, pStale]);
  useEffect(() => { try { localStorage.setItem("ordengo_tech_task_view", techTaskView); } catch {} }, [techTaskView]);
  useEffect(() => {
    if (!me) return;
    const allowed = allowedModulesForRole(me.role);
    const safeModule = allowed.includes(module) ? module : (me.role === "monitor_oficina" ? "projects" : "inicio");
    try { localStorage.setItem(`ordengo_navigation_${me.id}`, JSON.stringify({ module: safeModule, orderTab: oTab, projectTab: pTab })); } catch {}
  }, [me, module, oTab, pTab]);

  useEffect(() => {
    if (!me || !online || module !== "orders") return;
    let cancelled = false;
    const refreshOrders = async () => {
      try {
        const fresh = await api.orders();
        if (!cancelled) setOrders((fresh || []).map((order) => order.status === "En progreso" ? { ...order, status: "En proceso de ejecución" } : order));
      } catch {}
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void refreshOrders(); };
    const timer = window.setInterval(refreshOrders, 8000);
    window.addEventListener("focus", refreshOrders);
    document.addEventListener("visibilitychange", onVisibility);
    void refreshOrders();
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", refreshOrders); document.removeEventListener("visibilitychange", onVisibility); };
  }, [me?.id, online, module]);

  useEffect(() => {
    if (me?.role !== "monitor_oficina" || !online) return;
    let cancelled = false;
    const refreshMonitor = async () => { try { if (!cancelled) await boot(); } catch {} };
    const timer = window.setInterval(refreshMonitor, 15000);
    const onVisible = () => { if (document.visibilityState === "visible") void refreshMonitor(); };
    window.addEventListener("focus", refreshMonitor);
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", refreshMonitor); document.removeEventListener("visibilitychange", onVisible); };
  }, [me?.id, me?.role, online]);

  useEffect(() => {
    if (!online || !me || !offlineCount) return;
    (async () => {
      setSyncingOffline(true); setOfflineSyncFailed(false);
      const result = await flushOfflineQueue(async ({ type, payload }) => {
        if (type === "order:create") {
          const order = { ...payload };
          const localId = order._localId;
          delete order._localId;
          if (order._newClient) { const client = await api.addClient(order._newClient); order.client = client.name; order.site = order.site || client.site; delete order._newClient; }
          delete order.id; const saved = await api.createOrder(order); rememberSyncedOrderId(localId, saved.id); return saved;
        }
        if (type === "order:update") return api.updateOrder(payload.id, payload.patch);
        if (type === "task:save") return api.saveTask(payload);
        if (type === "task:update") return api.updateTask(payload.id, payload.patch);
      });
      setOfflineCount(result.remaining);
      if (result.sent) { await boot(); toast(`${result.sent} cambio(s) sincronizado(s)`, "success"); }
      if (result.remaining) { setOfflineSyncFailed(true); toast(`${result.remaining} cambio(s) no pudieron sincronizarse. Revisá los datos e intentá nuevamente.`, "error"); }
      setSyncingOffline(false);
    })();
  }, [online, me?.id, offlineCount, offlineRetry]);

  useEffect(() => {
    if (me?.role !== "monitor_oficina" || !branding.tvModeEnabled) return;
    const projectIds = projects.map((project) => project.id);
    setModule("projects"); setPTab("board"); setPQ(""); setPMine(false); setPStale(false);
    setPProj((current) => projectIds.includes(current) ? current : (projectIds[0] || "all"));
    if (!branding.tvCycleEnabled || projectIds.length < 2) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setPProj((current) => {
        const currentIndex = projectIds.indexOf(current);
        return projectIds[(currentIndex + 1 + projectIds.length) % projectIds.length];
      });
    }, Math.max(10, Number(branding.tvCycleSeconds) || 30) * 1000);
    return () => window.clearInterval(interval);
  }, [me?.role, branding.tvModeEnabled, branding.tvCycleEnabled, branding.tvCycleSeconds, projects.map((project) => project.id).join("|")]);

  const logout = () => { setToken(null); setMe(null); setModule("orders"); setOView("list"); };
  const err = (e) => toast(e?.message || "Ocurrió un error", "error");

  if (booting) return <div className="grid min-h-screen place-items-center bg-ink-900 text-slate-300"><div className="motion-page flex flex-col items-center gap-3" role="status" aria-label="Cargando OrdenGO"><div className="skeleton h-9 w-36 rounded-lg" /><Loader2 className="h-5 w-5 animate-spin" /></div></div>;
  if (!me) return <Login branding={branding} onLogin={async (email, password) => { const r = await api.login(email, password); setToken(r.token); await boot(); }} />;

  const isMgr = me.role === "admin" || me.role === "gerente";
  const isAdmin = me.role === "admin";
  const isMonitor = me.role === "monitor_oficina";
  const tvMode = isMonitor && branding.tvModeEnabled;
  const isOffice = me.role === "tecnico_oficina" || isMonitor;
  const activeProjectView = isMgr || isMonitor ? pTab : techTaskView;
  const userById = (id) => users.find((u) => u.id === id);

  /* Órdenes */
  const onSaveOrder = async (o, { stayOpen = false } = {}) => {
    if (!online) {
      const localId = `PEND-${Date.now().toString(36).slice(-5).toUpperCase()}`;
      queueOfflineOperation("order:create", { ...o, _localId: localId });
      const local = { ...o, id: localId, _offline: true };
      setOrders((p) => [local, ...p]); setOfflineCount(offlineQueueSize()); if (!stayOpen) setOView("list"); toast("Orden guardada en el teléfono. Se enviará al recuperar conexión.", "success"); return local;
    }
    try {
      if (o._newClient) { const c = await api.addClient(o._newClient); setClients((p) => (p.some((x) => x.id === c.id) ? p : [...p, c])); o.client = c.name; o.site = o.site || c.site; }
      delete o._newClient; delete o.id; // el servidor asigna el folio con el código del cliente
      const saved = await api.createOrder(o);
      setOrders((p) => [saved, ...p]); if (!stayOpen) setOView("list"); toast(`Orden ${saved.id} ${stayOpen ? "iniciada" : "creada"}`, "success"); return saved;
    } catch (e) { err(e); return false; }
  };
  const updateOrder = async (id, patch) => {
    if (id.startsWith("PEND-")) {
      const syncedId = online ? resolveSyncedOrderId(id) : "";
      if (syncedId) return updateOrder(syncedId, patch);
      updateQueuedOrder(id, patch); const updated = { id, ...patch, _offline: true }; setOrders((p) => p.map((o) => (o.id === id ? { ...o, ...updated } : o))); toast("Cambio actualizado en la orden pendiente", "success"); return updated;
    }
    if (!online) { queueOfflineOperation("order:update", { id, patch }); setOfflineCount(offlineQueueSize()); const updated = { id, ...patch, _offline: true }; setOrders((p) => p.map((o) => (o.id === id ? { ...o, ...updated } : o))); toast("Cambio guardado para sincronizar", "success"); return updated; }
    try { const u = await api.updateOrder(id, patch); setOrders((p) => p.map((o) => (o.id === id ? u : o))); return u; } catch (e) { err(e); return false; }
  };
  const deleteOrder = (id) => setConfirmDialog({ title: `Eliminar ${id}`, message: "La orden y su historial se eliminarán de forma permanente.", confirmLabel: "Eliminar orden", danger: true, action: async () => { try { await api.deleteOrder(id); setOrders((p) => p.filter((o) => o.id !== id)); setODetail(null); } catch (e) { err(e); } } });
  const exportCSV = (rows, name) => {
    const head = ["Folio", "Fecha", "Cliente", "Sitio", "Tipo", "Estado", "Horas efectivas", "Horas facturables", "Técnicos", "Horas-técnico facturables", "Mano de obra (USD)", "Materiales (USD)", "Total (USD)"];
    const lines = rows.map((o) => { const t = orderTotals(o); const technicianHours = t.billedHours * (Number(o.technicians) || 1); return [o.id, o.date, o.client, o.site, o.service, o.status, o.laborHours, t.billedHours, o.technicians || 1, technicianHours, t.labor.toFixed(2), t.mats.toFixed(2), t.total.toFixed(2)].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","); });
    downloadFile(name, [head.join(","), ...lines].join("\n"));
  };

  /* Proyectos */
  const onSaveTask = async (t) => {
    const exists = tasks.some((task) => task.id === t.id);
    if (!online) { queueOfflineOperation(exists ? "task:update" : "task:save", exists ? { id: t.id, patch: t } : t); setOfflineCount(offlineQueueSize()); setTasks((p) => (exists ? p.map((x) => x.id === t.id ? { ...x, ...t, _offline: true } : x) : [{ ...t, _offline: true }, ...p])); setEditing(undefined); toast("Tarea guardada para sincronizar", "success"); return; }
    try { const s = exists ? await api.updateTask(t.id, t) : await api.saveTask(t); setTasks((p) => (p.some((x) => x.id === s.id) ? p.map((x) => (x.id === s.id ? s : x)) : [s, ...p])); setEditing(undefined); } catch (e) { err(e); }
  };
  const onDeleteTask = async (id) => { try { await api.deleteTask(id); setTasks((p) => p.filter((x) => x.id !== id)); setEditing(undefined); } catch (e) { err(e); } };
  const moveTask = async (id, dir) => {
    const t = tasks.find((x) => x.id === id); if (!t) return;
    const i = T_STATUS.indexOf(t.status); const status = T_STATUS[Math.min(T_STATUS.length - 1, Math.max(0, i + dir))];
    if (!online) { queueOfflineOperation("task:update", { id, patch: { status } }); setOfflineCount(offlineQueueSize()); setTasks((p) => p.map((x) => x.id === id ? { ...x, status, _offline: true } : x)); return; }
    try { const u = await api.updateTask(id, { status }); setTasks((p) => p.map((x) => (x.id === id ? u : x))); } catch (e) { err(e); }
  };
  const nextTaskId = (projectId) => { const key = projects.find((p) => p.id === projectId)?.key || "TASK"; const n = Math.max(0, ...tasks.filter((t) => t.id.startsWith(key + "-")).map((t) => parseInt(t.id.split("-")[1], 10) || 0)) + 1; return `${key}-${n}`; };
  const createProject = () => setProjectEditor({ mode: "create", name: "", key: "PRJ", color: PALETTE[projects.length % PALETTE.length] });
  const editProject = (id) => { const current = projects.find((p) => p.id === id); if (current) setProjectEditor({ mode: "edit", ...current }); };
  const saveProjectEditor = async (form) => { try { if (form.mode === "create") { const project = await api.createProject({ name: form.name, key: form.key, color: form.color }); setProjects((items) => [...items, project]); } else { const project = await api.updateProject(form.id, { name: form.name, color: form.color }); setProjects((items) => items.map((item) => item.id === form.id ? project : item)); setTasks((items) => items.map((task) => task.project === project.id ? { ...task, color: project.color } : task)); } setProjectEditor(null); toast("Proyecto guardado", "success"); } catch (e) { err(e); } };
  const deleteProject = async (id) => {
    const cur = projects.find((p) => p.id === id); if (!cur) return;
    const n = tasks.filter((t) => t.project === id).length;
    const linkedBudget = budgets.find((budget) => budget.projectId === id);
    setConfirmDialog({ title: `Eliminar ${cur.name}`, message: `Se eliminará el proyecto${n ? ` junto con ${n} tarea(s)` : ""}.${linkedBudget ? ` El presupuesto ${linkedBudget.number || linkedBudget.id} se conservará y volverá a habilitarse para crear otro proyecto.` : ""} Esta acción no se puede deshacer.`, confirmLabel: "Eliminar proyecto", danger: true, action: async () => { try { const result = await api.deleteProject(id); setProjects((x) => x.filter((y) => y.id !== id)); setTasks((x) => x.filter((t) => t.project !== id)); if (result?.budgets?.length) setBudgets((items) => items.map((item) => result.budgets.find((budget) => budget.id === item.id) || item)); setPProj("all"); toast("Proyecto eliminado y presupuesto desvinculado", "success"); } catch (e) { err(e); } } });
  };
  const saveAccess = async (id, allowedUsers) => {
    try { const p = await api.updateProject(id, { allowedUsers }); setProjects((x) => x.map((y) => (y.id === id ? p : y))); setAccessProj(null); toast("Accesos actualizados", "success"); } catch (e) { err(e); }
  };
  const doDuplicate = async (id, opts) => {
    try { const { project, tasks: newTasks } = await api.duplicateProject(id, opts); setProjects((x) => [...x, project]); setTasks((x) => [...newTasks, ...x]); setDupProj(null); setPProj(project.id); toast(`Proyecto duplicado (${newTasks.length} tareas)`, "success"); } catch (e) { err(e); }
  };

  /* Presupuestos */
  const saveBudget = async (budget) => {
    try {
      const response = budget.id ? await api.updateBudget(budget.id, budget) : await api.createBudget(budget);
      const generatedInvoice = response._generatedInvoice;
      const { _generatedInvoice, ...saved } = response;
      setBudgets((items) => items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items]);
      if (generatedInvoice) { const { attachmentUrl, ...invoiceSummary } = generatedInvoice; invoiceSummary.hasAttachment = Boolean(attachmentUrl); setFinances((items) => items.some((item) => item.id === invoiceSummary.id) ? items.map((item) => item.id === invoiceSummary.id ? invoiceSummary : item) : [invoiceSummary, ...items]); }
      else if (saved.stage !== "Facturado") setFinances((items) => items.filter((item) => item.sourceBudgetId !== saved.id));
      toast(`Presupuesto ${saved.number || saved.id} guardado`, "success"); return saved;
    } catch (e) { err(e); return null; }
  };
  const deleteBudget = (budget) => setConfirmDialog({ title: `Eliminar ${budget.number || budget.id}`, message: budget.stage === "Facturado" ? "Se eliminarán el presupuesto, su historial comercial y la factura automática asociada en Finanzas. Los proyectos ya creados no se eliminarán." : "Se eliminará el presupuesto y su historial comercial. Esta acción no afecta proyectos ya creados.", confirmLabel: "Eliminar presupuesto", danger: true, action: async () => { try { await api.deleteBudget(budget.id); setBudgets((items) => items.filter((item) => item.id !== budget.id)); setFinances((items) => items.filter((item) => item.sourceBudgetId !== budget.id)); toast(budget.stage === "Facturado" ? "Presupuesto y factura asociada eliminados" : "Presupuesto eliminado", "success"); } catch (e) { err(e); } } });
  const convertBudget = async (budget) => {
    try { const result = await api.convertBudget(budget.id); setBudgets((items) => items.map((item) => item.id === budget.id ? result.budget : item)); if (result.project && !projects.some((project) => project.id === result.project.id)) setProjects((items) => [...items, result.project]); toast(`Proyecto ${result.project?.key || "creado"} generado`, "success"); return result; } catch (e) { err(e); return null; }
  };
  const createOrderFromBudget = (budget) => {
    const linkedClient = clients.find((client) => client.id === budget.clientId) || clients.find((client) => client.name === budget.client);
    navigateModule("orders");
    setOTab("list");
    setOrderPrefill({
      budgetId: budget.id,
      budgetNumber: budget.number || budget.id,
      projectId: budget.projectId || "",
      clientMode: linkedClient ? "existing" : "new",
      clientId: linkedClient?.id || "",
      newClient: linkedClient ? undefined : { name: budget.client || "", site: budget.site || "" },
      siteLabel: budget.site || linkedClient?.site || "",
      contact: budget.contact || "",
      quoteNumber: budget.number || budget.id,
      customerPO: budget.purchaseOrderNumber || "",
      service: SERVICE_TYPES.includes(budget.service) ? budget.service : "Automatización",
      sintoma: budget.scope || "",
      category: budget.title || "",
    });
    setOView("new");
  };

  /* Finanzas */
  const saveFinance = async (movement) => {
    try { const saved = movement.id ? await api.updateFinance(movement.id, movement) : await api.createFinance(movement); const { attachmentUrl, ...summary } = saved; summary.hasAttachment = Boolean(attachmentUrl); setFinances((items) => items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? summary : item) : [summary, ...items]); toast(`${saved.kind === "invoice" ? "Factura" : saved.kind === "expense" ? "Gasto" : "Cobro"} guardado`, "success"); return saved; } catch (e) { err(e); return null; }
  };
  const loadFinance = async (id) => { try { return await api.getFinance(id); } catch (e) { err(e); return null; } };
  const deleteFinance = (movement) => setConfirmDialog({ title: `Eliminar ${movement.id}`, message: "Se eliminará el movimiento y su comprobante asociado.", confirmLabel: "Eliminar movimiento", danger: true, action: async () => { try { await api.deleteFinance(movement.id); setFinances((items) => items.filter((item) => item.id !== movement.id)); toast("Movimiento eliminado", "success"); } catch (e) { err(e); } } });

  /* Equipo */
  const addUser = async (nf) => { const u = await api.createUser(nf); setUsers((p) => [...p, u]); };
  const patchUser = async (id, patch) => { const u = await api.updateUser(id, patch); setUsers((p) => p.map((x) => (x.id === id ? u : x))); };
  const removeUser = async (id) => { await api.deleteUser(id); setUsers((p) => p.filter((x) => x.id !== id)); };
  const saveBranding = async (value) => { try { const saved = await api.updateBranding(value); setBranding(saved); toast("Identidad visual actualizada", "success"); return saved; } catch (e) { err(e); return null; } };

  /* Notificaciones */
  const unread = notifs.filter((n) => !n.read).length;
  const markRead = async (id) => { setNotifs((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n))); try { await api.readNotification(id); } catch {} };
  const markAllRead = async () => { setNotifs((p) => p.map((n) => ({ ...n, read: true }))); try { await api.readAllNotifications(); } catch {} };
  const openNotif = (n) => {
    markRead(n.id); setNotifOpen(false);
    if (n.link && n.link.startsWith("task:")) { const t = tasks.find((x) => x.id === n.link.slice(5)); if (t) { navigateModule("projects"); setPTab("board"); setEditing(t); } }
  };

  /* Comentarios */
  const commentOrder = async (id, text) => { const u = await api.commentOrder(id, text); setOrders((p) => p.map((o) => (o.id === id ? u : o))); return u; };
  const commentTask = async (id, text) => { const u = await api.commentTask(id, text); setTasks((p) => p.map((t) => (t.id === id ? u : t))); return u; };

  /* Duplicar orden / crear tarea desde orden */
  const duplicateOrder = async (o) => {
    const copy = { ...o, status: "Borrador", signatureUrl: null, signedBy: "", noSignReason: "", technicianSignatureUrl: null, technicianSignedAt: null, technicianSignedBy: "", photos: [], activity: [], createdAt: new Date().toISOString(), date: todayStr() };
    delete copy.id; delete copy._updatedAt;
    try { const saved = await api.createOrder(copy); setOrders((p) => [saved, ...p]); setODetail(null); toast(`Duplicada como ${saved.id} (borrador)`, "success"); } catch (e) { err(e); }
  };
  const continueOrder = (order) => {
    const linkedClient = clients.find((client) => client.name === order.client);
    const resumeStep = order.technical?.completedAt ? 3 : (!(order.photos || []).length || !(order.sintoma || order.technical?.diagnosis) ? 1 : order.technical?.startedAt ? 2 : 0);
    setODetail(null);
    setOrderPrefill({ ...order, existingOrderId: order.id, clientMode: linkedClient ? "existing" : "new", clientId: linkedClient?.id || "", newClient: linkedClient ? undefined : { name: order.client || "", site: order.site || "" }, siteLabel: order.site || "", step: resumeStep });
    setOView("new");
  };
  const taskFromOrder = (o) => {
    setODetail(null); navigateModule("projects"); setPTab("board");
    setPrefill({ title: `Seguimiento OT ${o.id} — ${o.client}`, desc: `${o.equipo || ""}${o.sintoma ? " · " + o.sintoma : ""}`.trim(), order: o.id, project: o.projectId || projects[0]?.id || "", budgetId: o.budgetId || "", budgetNumber: o.budgetNumber || o.quoteNumber || "" });
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

  if (!isOffice && module === "orders" && oView === "new")
    return <NewOrder ger={isMgr} me={me} clients={clients} parts={parts} knownOrders={orders} online={online} prefill={orderPrefill} onDeleted={(id) => { clearOrderDraft(me.id); setOrderPrefill(null); setOView("list"); toast(`La orden ${id} fue eliminada por un administrador. Debes abrir una OT nueva.`, "error"); }} onCancel={() => { setOrderPrefill(null); setOView("list"); }} onSave={async (order, currentOrderId, { stayOpen = false } = {}) => { const existingId = currentOrderId || orderPrefill?.existingOrderId; const saved = existingId ? await updateOrder(existingId, order) : await onSaveOrder(order, { stayOpen }); if (saved && !stayOpen) { setOrderPrefill(null); setOView("list"); } return saved; }} />;

  const modTabs = isMonitor ? [
    { id: "projects", label: "Proyectos", icon: LayoutGrid },
  ] : [
    { id: "inicio", label: "Mi día", icon: Home },
    ...(isMgr ? [{ id: "panel", label: "Panel", icon: TrendingUp }] : []),
    ...(isMgr ? [{ id: "budgets", label: "Presupuestos", icon: FileText }] : []),
    ...(isMgr ? [{ id: "finances", label: "Finanzas", icon: DollarSign }] : []),
    ...(isOffice ? [] : [{ id: "orders", label: "Órdenes", icon: ClipboardList }]),
    { id: "projects", label: "Proyectos", icon: LayoutGrid },
    ...(isMgr ? [{ id: "clients", label: "Clientes", icon: Building2 }] : []),
    ...(isMgr ? [{ id: "inventory", label: "Inventario", icon: Wrench, badge: lowStock }] : []),
    ...(isAdmin ? [{ id: "team", label: "Equipo", icon: Users }] : []),
    ...(isAdmin ? [{ id: "settings", label: "Configuración", icon: Settings2 }] : []),
  ];
  // Si el módulo activo no está permitido para el rol, caer en "Mi día"
  const allowedIds = modTabs.map((t) => t.id);
  const activeModule = allowedIds.includes(module) ? module : (isMonitor ? "projects" : "inicio");
  // En teléfono priorizamos las áreas operativas de uso diario. Presupuestos,
  // Finanzas y administración quedan agrupados en “Más”; además de evitar
  // etiquetas superpuestas, reduce cambios de contexto accidentales.
  const mobilePrimaryIds = isMgr ? ["inicio", "panel", "orders", "projects"] : modTabs.map((tab) => tab.id).slice(0, 4);
  const mobilePrimaryTabs = mobilePrimaryIds.map((id) => modTabs.find((tab) => tab.id === id)).filter(Boolean);
  const mobileExtraTabs = modTabs.filter((tab) => !mobilePrimaryIds.includes(tab.id));
  const mobileMoreActive = mobileExtraTabs.some((t) => t.id === activeModule);
  const mobileMoreBadge = mobileExtraTabs.reduce((sum, t) => sum + (t.badge || 0), 0);

  return (
    <div className={`min-h-screen bg-slate-100 text-slate-800 ${tvMode ? "tv-display" : ""}`} style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-ink-900 text-slate-100">
        <div className={`mx-auto flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3 ${tvMode ? "max-w-none lg:px-7" : "max-w-6xl"}`}>
          <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
            <img src={branding.logoDataUrl || LOGO_LIGHT} alt={branding.companyName || branding.appName} className="h-7 max-w-28 shrink object-contain sm:max-w-36" />
            <div className="min-w-0 max-w-24 leading-tight border-l border-ink-800 pl-2 sm:max-w-none sm:pl-2.5"><div className="truncate text-sm font-semibold">{branding.appName || "OrdenGO"}</div><div className="hidden truncate text-[11px] text-slate-400 min-[400px]:block">{branding.subtitle || "Campo + Proyectos"}</div></div>
          </div>
          <div className="flex shrink-0 items-center gap-0 sm:gap-2">
            {activeModule === "orders" && <button onClick={() => { clearOrderDraft(me.id); setOrderPrefill(null); setOView("new"); }} className="hidden items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 sm:inline-flex"><Plus className="h-4 w-4" /> Orden</button>}
            {activeModule === "budgets" && <button onClick={() => setBudgetCreateSignal((value) => value + 1)} className="hidden items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 sm:inline-flex"><Plus className="h-4 w-4" /> Presupuesto</button>}
            {activeModule === "finances" && <button onClick={() => setFinanceCreateSignal((value) => value + 1)} className="hidden items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 sm:inline-flex"><Plus className="h-4 w-4" /> Movimiento</button>}
            {activeModule === "projects" && !isMonitor && <button onClick={() => setEditing(null)} className="hidden items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 sm:inline-flex"><Plus className="h-4 w-4" /> Tarea</button>}
            <div className="hidden items-center gap-2 sm:flex"><Avatar user={me} size={26} /><div className="leading-tight"><div className="text-xs font-medium text-slate-200">{me.name.split(" ")[0]}</div><div className="text-[10px] text-slate-400">{ROLES[me.role]}</div></div></div>
            <button onClick={() => setGlobalSearchOpen(true)} title="Buscar en OrdenGO" aria-label="Buscar en OrdenGO" className="rounded-lg p-1.5 text-slate-300 hover:bg-ink-800 sm:p-2"><Search className="h-4 w-4" /></button>
            <div ref={notifRef} className="relative">
              <button onClick={() => setNotifOpen((v) => !v)} title="Novedades" aria-label="Novedades" aria-expanded={notifOpen} aria-controls="notifications-panel" className="relative rounded-lg p-1.5 text-slate-300 hover:bg-ink-800 sm:p-2">
                <Bell className="h-4 w-4" />
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{unread}</span>}
              </button>
              {notifOpen && (
                <div id="notifications-panel" role="region" aria-label="Novedades" className="motion-popover fixed left-4 right-4 top-16 z-30 mt-2 w-auto overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-lg sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:w-80">
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
            <button onClick={() => setPwOpen(true)} title="Cambiar contraseña" aria-label="Cambiar contraseña" className="rounded-lg p-1.5 text-slate-300 hover:bg-ink-800 sm:p-2"><KeyRound className="h-4 w-4" /></button>
            <button onClick={logout} title="Cerrar sesión" aria-label="Cerrar sesión" className="rounded-lg p-1.5 text-slate-300 hover:bg-ink-800 sm:p-2"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
        <div className={`mx-auto max-w-6xl overflow-x-auto px-2 ${tvMode ? "hidden" : "hidden sm:block"}`}>
          <nav className="flex gap-1 pb-1">
            {modTabs.map(({ id, label, icon: Icon, badge }) => (
              <button key={id} onClick={() => navigateModule(id)} className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-medium transition ${activeModule === id ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}><Icon className="h-4 w-4" /> {label}{badge > 0 && <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{badge}</span>}</button>
            ))}
          </nav>
        </div>
      </header>

      {(!online || offlineCount > 0) && <div className={`motion-banner sticky top-0 z-30 flex items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium text-white ${online && offlineSyncFailed ? "bg-rose-600" : online ? "bg-brand-600" : "bg-amber-600"}`} role="status">{!online ? <WifiOff className="h-4 w-4" /> : syncingOffline ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}{!online ? `${offlineCount ? `${offlineCount} cambio(s) guardado(s). ` : ""}Podés seguir trabajando sin conexión.` : offlineSyncFailed ? <><span>{offlineCount} cambio(s) pendientes por un error.</span><button type="button" onClick={() => setOfflineRetry((value) => value + 1)} className="inline-flex items-center gap-1 rounded border border-white/40 px-2 py-1 hover:bg-white/10"><RefreshCw className="h-3.5 w-3.5" /> Reintentar</button></> : `Sincronizando ${offlineCount} cambio(s)…`}</div>}
      <main className={`mx-auto px-3 py-4 pb-28 sm:px-4 sm:py-5 sm:pb-5 ${tvMode ? "max-w-none lg:px-7 lg:py-4" : "max-w-6xl"}`}>
        <div key={activeModule} className="motion-page">
        {activeModule === "inicio" && <MiDia me={me} tasks={tasks} orders={orders} userById={userById} onOpenTask={(t) => { navigateModule("projects"); setPTab("board"); setEditing(t); }} onOpenOrder={setODetail} ger={isMgr} />}
        {activeModule === "panel" && isMgr && <Dashboard orders={orders} users={users} tasks={tasks} parts={parts} budgets={budgets} onOpen={setODetail} onGo={(destination) => { if (destination === "billing") { navigateModule("orders"); setOTab("list"); setOBillable(true); } else if (destination === "budgets") navigateModule("budgets"); else if (destination === "inventory") navigateModule("inventory"); else if (destination === "projects") { navigateModule("projects"); setPTab("board"); setPStale(true); } }} />}
        {activeModule === "budgets" && isMgr && <BudgetsModule budgets={budgets} finances={finances} clients={clients} parts={parts} projects={projects} users={users} me={me} createSignal={budgetCreateSignal} onConsumeCreate={() => setBudgetCreateSignal(0)} onSave={saveBudget} onDelete={deleteBudget} onConvert={convertBudget} onCreateOrder={createOrderFromBudget} onInvoice={saveFinance} />}
        {activeModule === "finances" && isMgr && <FinanceModule movements={finances} projects={projects} budgets={budgets} clients={clients} createSignal={financeCreateSignal} onConsumeCreate={() => setFinanceCreateSignal(0)} onSave={saveFinance} onLoad={loadFinance} onDelete={deleteFinance} />}
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
            {tvMode && <div className="tv-project-banner relative mb-4 flex items-center gap-4 overflow-hidden rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
              <span className="h-10 w-2 shrink-0 rounded-full" style={{ background: projects.find((project) => project.id === pProj)?.color || branding.primaryColor }} />
              <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Proyecto en pantalla</p><h1 className="truncate text-2xl font-bold text-slate-900">{projects.find((project) => project.id === pProj)?.key || "—"} · {projects.find((project) => project.id === pProj)?.name || "Sin proyectos disponibles"}</h1></div>
              <div className="hidden items-center gap-3 text-right lg:flex"><div><p className="text-xs font-semibold text-slate-600">{branding.tvCycleEnabled && projects.length > 1 ? `Rotación cada ${branding.tvCycleSeconds} s` : "Vista fija"}</p><p className="text-[11px] text-slate-400">{Math.max(0, projects.findIndex((project) => project.id === pProj) + 1)} de {projects.length}</p></div><button type="button" onClick={() => document.documentElement.requestFullscreen?.()} title="Abrir pantalla completa" aria-label="Abrir pantalla completa" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Maximize2 className="h-5 w-5" /></button></div>
              {branding.tvCycleEnabled && projects.length > 1 && <span key={pProj} className="tv-cycle-progress absolute bottom-0 left-0 h-1 bg-brand-500" style={{ animationDuration: `${branding.tvCycleSeconds}s` }} />}
            </div>}
            {!tvMode && <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="mr-1 flex rounded-lg bg-slate-200 p-0.5">
                {(isMgr || isMonitor ? [["board", "Tablero", LayoutGrid], ["calendar", "Calendario", Calendar], ["reports", "Reportes", BarChart3]] : [["work", "Mi trabajo", ListTodo], ["board", "Tablero", LayoutGrid], ["calendar", "Calendario", Calendar]]).map(([id, lb, Ic]) => {
                  const active = isMgr || isMonitor ? pTab === id : techTaskView === id;
                  return <button key={id} onClick={() => isMgr || isMonitor ? setPTab(id) : setTechTaskView(id)} className={`inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}><Ic className="h-4 w-4" /> {lb}</button>;
                })}
              </div>
              <select value={pProj} onChange={(e) => setPProj(e.target.value)} className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium sm:w-auto">
                <option value="all">Todos los proyectos</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
              </select>
              {activeProjectView !== "reports" && (<>
                <div className="relative w-full min-w-0 sm:flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={pQ} onChange={(e) => setPQ(e.target.value)} placeholder="Buscar tarea…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" /></div>
                {!isMonitor && (isMgr || activeProjectView === "board") && <button onClick={() => setPMine((v) => !v)} className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium ${pMine ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600"}`}><Avatar user={me} size={18} /> Mis tareas</button>}
                {activeProjectView === "board" && <button onClick={() => setPStale((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium ${pStale ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-600"}`}><Clock className="h-4 w-4" /> Estancadas</button>}
                {isMgr && activeProjectView === "board" && <button onClick={createProject} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:border-brand-400 hover:text-brand-600"><Folder className="h-4 w-4" /> Proyecto</button>}
                {isMgr && activeProjectView === "board" && pProj !== "all" && <button onClick={() => setDupProj(projects.find((p) => p.id === pProj))} title="Duplicar proyecto con sus tareas" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Copy className="h-4 w-4" /> Duplicar</button>}
                {isMgr && activeProjectView === "board" && pProj !== "all" && <button onClick={() => setAccessProj(projects.find((p) => p.id === pProj))} title="Gestionar accesos" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Users className="h-4 w-4" /> Accesos</button>}
                {isMgr && activeProjectView === "board" && pProj !== "all" && <button onClick={() => editProject(pProj)} title="Renombrar proyecto" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>}
                {isMgr && activeProjectView === "board" && pProj !== "all" && <button onClick={() => deleteProject(pProj)} title="Eliminar proyecto" className="rounded-lg border border-rose-200 bg-white p-2 text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>}
              </>)}
            </div>}
            {(() => {
              const vis = tasks.filter((t) => (pProj === "all" || t.project === pProj) && (!pMine || isMonitor || t.assignee === me.id) && (activeProjectView !== "board" || !pStale || isStale(t)) && (!pQ || `${t.id} ${t.title} ${t.desc}`.toLowerCase().includes(pQ.toLowerCase())));
              if (pTab === "reports" && (isMgr || isMonitor)) return <Reports tasks={vis} users={users} projects={projects} proj={pProj} />;
              if (activeProjectView === "calendar") return <WorkCalendar tasks={isMgr || isMonitor ? vis : vis.filter((task) => task.assignee === me.id)} orders={isOffice ? [] : orders.filter((order) => isMgr || order.tech === me.name)} projects={projects} userById={userById} onOpenTask={setEditing} onOpenOrder={setODetail} showOrders={pProj === "all"} />;
              if (isMonitor) return <Board tasks={vis} projects={projects} userById={userById} onOpen={setEditing} onMove={moveTask} readOnly tvMode={tvMode} />;
              if (isMgr) return <Board tasks={vis} projects={projects} userById={userById} onOpen={setEditing} onMove={moveTask} />;
              const technicianTasks = techTaskView === "work" ? vis.filter((task) => task.assignee === me.id) : vis;
              return techTaskView === "work" ? <FieldTaskList tasks={technicianTasks} projects={projects} onOpen={setEditing} onMove={moveTask} /> : <TechnicianBoard tasks={technicianTasks} projects={projects} userById={userById} onOpen={setEditing} onMove={moveTask} />;
            })()}
          </>
        )}
        {activeModule === "clients" && isMgr && <Clients clients={clients} orders={orders} onAdd={addClientMgr} onPatch={updateClient} onRemove={removeClient} onErr={err} />}
        {activeModule === "team" && isAdmin && <Team users={users} tasks={tasks} orders={orders} me={me} onAdd={addUser} onPatch={patchUser} onRemove={removeUser} onErr={err} />}
        {activeModule === "settings" && isAdmin && <SettingsModule branding={branding} onSaveBranding={saveBranding} />}

        {!tvMode && <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-400">Conectado al servidor · {me.name} ({ROLES[me.role]})</footer>}
        </div>
      </main>

      {oDetail && <OrderDetail ger={isMgr} order={orders.find((o) => o.id === oDetail.id) || oDetail} onClose={() => setODetail(null)} onUpdate={updateOrder} onAdvance={(id, st) => updateOrder(id, { status: st })} onExport={(o) => exportCSV([o], `${o.id}.csv`)} onDelete={deleteOrder} onComment={commentOrder} onDuplicate={duplicateOrder} onCreateTask={taskFromOrder} onContinue={["Borrador", "En progreso", "En proceso de ejecución"].includes((orders.find((o) => o.id === oDetail.id) || oDetail).status) ? continueOrder : null} onEdit={isAdmin ? setEditingOrder : null} me={me} />}
      {editingOrder && <OrderEditDialog order={orders.find((o) => o.id === editingOrder.id) || editingOrder} clients={clients} users={users} parts={parts} budgets={budgets} projects={projects} onClose={() => setEditingOrder(null)} onSave={async (patch) => { const saved = await updateOrder(editingOrder.id, patch); if (saved) { setEditingOrder(null); toast(`Orden ${editingOrder.id} actualizada`, "success"); } return saved; }} />}
      {editing !== undefined && <TaskModal task={editing} me={me} users={users.filter((u) => u.active && u.role !== "monitor_oficina")} projects={projects} canAssign={isMgr} canDelete={isMgr} readOnly={isMonitor} nextId={nextTaskId} onClose={() => { setEditing(undefined); setPrefill(null); }} onSave={onSaveTask} onDelete={onDeleteTask} onComment={commentTask} prefill={prefill} />}
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
      {accessProj && <ProjectAccess project={accessProj} users={users} onClose={() => setAccessProj(null)} onSave={saveAccess} />}
      {dupProj && <DuplicateProject project={dupProj} users={users} tasksCount={tasks.filter((t) => t.project === dupProj.id).length} onClose={() => setDupProj(null)} onDuplicate={doDuplicate} />}
      {me.mustChangePassword && <ChangePassword forced onDone={() => setMe((m) => ({ ...m, mustChangePassword: false }))} />}
      {globalSearchOpen && <GlobalSearch orders={orders} tasks={tasks} clients={clients} parts={parts} projects={projects} budgets={budgets} finances={finances} isMgr={isMgr} onClose={() => setGlobalSearchOpen(false)} onSelect={(result) => { setGlobalSearchOpen(false); if (result.kind === "order") { navigateModule("orders"); setODetail(result.item); } else if (result.kind === "task") { navigateModule("projects"); setPTab("board"); setEditing(result.item); } else if (result.kind === "budget") navigateModule("budgets"); else if (result.kind === "finance") navigateModule("finances"); else if (result.kind === "client") navigateModule("clients"); else if (result.kind === "part") navigateModule("inventory"); }} />}
      {confirmDialog && <ConfirmDialog {...confirmDialog} onClose={() => setConfirmDialog(null)} onConfirm={async () => { const action = confirmDialog.action; setConfirmDialog(null); await action(); }} />}
      {projectEditor && <ProjectEditor value={projectEditor} onClose={() => setProjectEditor(null)} onSave={saveProjectEditor} />}

      {/* Menú secundario móvil */}
      {mobileMoreOpen && mobileExtraTabs.length > 0 && (
        <div className="motion-backdrop fixed inset-0 z-40 flex items-end bg-slate-900/40 sm:hidden" onClick={() => setMobileMoreOpen(false)}>
          <div className="mobile-sheet-content max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div><h2 className="text-base font-semibold text-slate-900">Más opciones</h2><p className="text-xs text-slate-500">Gestión y administración</p></div>
              <button onClick={() => setMobileMoreOpen(false)} aria-label="Cerrar más opciones" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <nav className="grid grid-cols-1 gap-2" aria-label="Más opciones de navegación">
              {mobileExtraTabs.map(({ id, label, icon: Icon, badge }) => (
                <button key={id} onClick={() => { navigateModule(id); setMobileMoreOpen(false); }} className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${activeModule === id ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${activeModule === id ? "bg-brand-100" : "bg-slate-100"}`}><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
                  {badge > 0 && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-rose-500 px-1.5 text-xs font-bold text-white">{badge}</span>}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      {/* Barra de navegación inferior (móvil) */}
      <nav className="mobile-bottom-bar fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden" aria-label="Navegación principal">
        {mobilePrimaryTabs.map(({ id, label, icon: Icon, badge }) => (
          <button key={id} onClick={() => { navigateModule(id); setMobileMoreOpen(false); }} title={label} aria-label={label} className={`mobile-nav-item relative flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium ${activeModule === id ? "text-brand-600" : "text-slate-400"}`}>
            {badge > 0 && <span className="absolute right-1/4 top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-rose-500 px-1 text-[8px] font-bold text-white">{badge}</span>}
            <Icon className="h-5 w-5" /><span className="mobile-nav-label">{label}</span>
          </button>
        ))}
        {mobileExtraTabs.length > 0 && (
          <button onClick={() => setMobileMoreOpen((open) => !open)} title="Más" aria-label="Más opciones" aria-expanded={mobileMoreOpen} className={`mobile-nav-item relative flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium ${mobileMoreActive || mobileMoreOpen ? "text-brand-600" : "text-slate-400"}`}>
            {mobileMoreBadge > 0 && <span className="absolute right-1/4 top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-rose-500 px-1 text-[8px] font-bold text-white">{mobileMoreBadge}</span>}
            <Menu className="h-5 w-5" /><span className="mobile-nav-label">Más</span>
          </button>
        )}
      </nav>

      {/* Botón de acción flotante (móvil) */}
      {!isMonitor && (activeModule === "orders" || activeModule === "projects" || activeModule === "budgets" || activeModule === "finances") && (
        <button onClick={() => { if (activeModule === "orders") { clearOrderDraft(me.id); setOrderPrefill(null); setOView("new"); } else if (activeModule === "budgets") setBudgetCreateSignal((value) => value + 1); else if (activeModule === "finances") setFinanceCreateSignal((value) => value + 1); else setEditing(null); }} className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-brand-500 text-white shadow-lg shadow-brand-500/30 hover:bg-brand-400 sm:hidden" aria-label={activeModule === "orders" ? "Nueva orden" : activeModule === "budgets" ? "Nuevo presupuesto" : activeModule === "finances" ? "Nuevo movimiento" : "Nueva tarea"}>
          <Plus className="h-7 w-7" />
        </button>
      )}

      {/* Toasts */}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`motion-toast ${t.leaving ? "is-leaving" : ""} pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-lg ${t.type === "error" ? "bg-rose-600" : t.type === "success" ? "bg-emerald-600" : "bg-ink-900"}`}>
            {t.type === "error" ? <AlertTriangle className="h-4 w-4" /> : t.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            {t.msg}
          </div>
        ))}
      </div>

    </div>
  );
}

/* ===================================== LOGIN ===================================== */
function Login({ branding = DEFAULT_BRANDING, onLogin }) {
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
          <div className="mb-8 flex min-h-14 w-fit min-w-14 items-center justify-center rounded-2xl bg-white/5 px-3 ring-1 ring-white/10"><img src={branding.logoDataUrl || LOGO_LIGHT} alt={branding.companyName || branding.appName} className="h-8 max-w-52 object-contain" /></div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-400">{branding.companyName || "AUTOMATICA ARG"}</div>
          <h1 className="max-w-md text-4xl font-bold leading-tight text-white xl:text-5xl">{branding.appName || "OrdenGO"}</h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">{branding.subtitle || "Campo + Proyectos"} · Órdenes, proyectos y gestión conectados en un entorno seguro.</p>
          <ul className="mt-8 space-y-3">
            {bullets.map((b) => (<li key={b} className="flex items-center gap-3 text-sm text-slate-200"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-brand-500/20 text-brand-400"><CheckCircle2 className="h-3.5 w-3.5" /></span>{b}</li>))}
          </ul>
        </div>
      </div>

      {/* Tarjeta de acceso */}
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-3 lg:hidden"><img src={branding.logoDataUrl || LOGO} alt={branding.companyName || branding.appName} className="h-10 max-w-52 object-contain" /><div><b className="block text-sm text-slate-800">{branding.appName}</b><span className="text-xs text-slate-500">{branding.subtitle}</span></div></div>
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
    if (n1.length < 8) { setMsg("La nueva contraseña debe tener al menos 8 caracteres."); return; }
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

function ConfirmDialog({ title, message, confirmLabel = "Confirmar", danger, onClose, onConfirm }) {
  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onClick={onClose}><div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="mobile-sheet-content w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}><div className={`mb-4 grid h-11 w-11 place-items-center rounded-xl ${danger ? "bg-rose-50 text-rose-600" : "bg-brand-50 text-brand-600"}`}>{danger ? <Trash2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}</div><h2 id="confirm-title" className="text-lg font-semibold text-slate-900">{title}</h2><p className="mt-2 text-sm leading-relaxed text-slate-500">{message}</p><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button onClick={onConfirm} className={`rounded-lg px-3 py-2.5 text-sm font-semibold text-white ${danger ? "bg-rose-600 hover:bg-rose-500" : "bg-brand-500 hover:bg-brand-400"}`}>{confirmLabel}</button></div></div></div>;
}

function ProjectEditor({ value, onClose, onSave }) {
  const [form, setForm] = useState(value);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onClick={onClose}><div className="mobile-dialog mobile-sheet-content w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold text-slate-900">{form.mode === "create" ? "Nuevo proyecto" : "Editar proyecto"}</h2><p className="text-xs text-slate-500">Definí una identidad clara para las tareas.</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="space-y-3"><L label="Nombre"><input autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} className="u-input" placeholder="Nombre del proyecto" /></L><L label="Clave"><input disabled={form.mode === "edit"} value={form.key} onChange={(e) => set({ key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })} className="u-input font-mono" placeholder="AUT" /></L><L label="Color"><div className="flex flex-wrap gap-2">{PALETTE.map((color) => <button key={color} onClick={() => set({ color })} aria-label={`Color ${color}`} className={`h-9 w-9 rounded-full ring-2 ring-offset-2 ${form.color === color ? "ring-slate-700" : "ring-transparent"}`} style={{ background: color }} />)}</div></L></div><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={!form.name.trim() || !form.key.trim()} onClick={() => onSave(form)} className="rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Guardar proyecto</button></div></div></div>;
}

function GlobalSearch({ orders, tasks, clients, parts, projects, budgets = [], finances = [], isMgr, onClose, onSelect }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const projectById = (id) => projects.find((p) => p.id === id);
  const results = useMemo(() => {
    if (!q) return [];
    const found = [
      ...orders.filter((o) => `${o.id} ${o.client} ${o.site} ${o.equipo || ""}`.toLowerCase().includes(q)).map((item) => ({ kind: "order", item, title: `${item.id} · ${item.client}`, meta: `${item.site || "Sin sitio"} · ${item.status}`, icon: ClipboardList })),
      ...tasks.filter((t) => `${t.id} ${t.title} ${t.desc || ""}`.toLowerCase().includes(q)).map((item) => ({ kind: "task", item, title: `${item.id} · ${item.title}`, meta: `${projectById(item.project)?.name || "Proyecto"} · ${item.status}`, icon: ListTodo })),
      ...(isMgr ? budgets.filter((budget) => `${budget.number || budget.id} ${budget.title} ${budget.client} ${budget.site || ""}`.toLowerCase().includes(q)).map((item) => ({ kind: "budget", item, title: `${item.number || item.id} · ${item.title}`, meta: `Presupuesto · ${item.client} · ${budgetDisplayStage(item)}`, icon: FileText })) : []),
      ...(isMgr ? finances.filter((movement) => `${movement.id} ${movement.concept} ${movement.supplier || ""} ${movement.receiptNumber || ""}`.toLowerCase().includes(q)).map((item) => ({ kind: "finance", item, title: `${item.id} · ${item.concept}`, meta: `${item.kind === "invoice" ? "Factura" : item.kind === "income" ? "Cobro" : "Gasto"} · ${currencyAmount(item.amount, item.currency)}`, icon: DollarSign })) : []),
      ...(isMgr ? clients.filter((c) => `${c.name} ${c.site || ""} ${c.code || ""}`.toLowerCase().includes(q)).map((item) => ({ kind: "client", item, title: item.name, meta: `Cliente · ${item.site || "Sin ubicación"}`, icon: Building2 })) : []),
      ...(isMgr ? parts.filter((p) => `${p.name} ${p.unit || ""}`.toLowerCase().includes(q)).map((item) => ({ kind: "part", item, title: item.name, meta: `Inventario · Stock ${item.stock ?? "—"}`, icon: Wrench })) : []),
    ];
    return found.slice(0, 12);
  }, [q, orders, tasks, clients, parts, projects, budgets, finances, isMgr]);
  return (
    <div className="motion-backdrop fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-3 pt-[8vh] sm:p-6 sm:pt-[12vh]" onClick={onClose}>
      <div className="motion-popover w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3"><Search className="h-5 w-5 shrink-0 text-slate-400" /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()} placeholder="Buscar órdenes, presupuestos, tareas o clientes…" className="min-w-0 flex-1 border-0 bg-transparent text-base text-slate-900 outline-none" /><button onClick={onClose} aria-label="Cerrar búsqueda" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="max-h-[65vh] overflow-y-auto p-2">
          {!q && <div className="px-3 py-8 text-center text-sm text-slate-400">Escribí para buscar en toda la aplicación.</div>}
          {q && !results.length && <div className="px-3 py-8 text-center text-sm text-slate-400">No encontramos resultados para “{query}”.</div>}
          {results.map((result, index) => { const Icon = result.icon; return <button key={`${result.kind}-${result.item.id || index}`} onClick={() => onSelect(result)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><Icon className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{result.title}</span><span className="block truncate text-xs text-slate-500">{result.meta}</span></span><ChevronRight className="h-4 w-4 text-slate-300" /></button>; })}
        </div>
        <div className="hidden border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 sm:block">Atajo: Ctrl/⌘ + K</div>
      </div>
    </div>
  );
}

/* ===================================== FINANZAS ===================================== */
const EXPENSE_CATEGORIES = ["Materiales y repuestos", "Viáticos", "Combustible", "Herramientas", "Servicios contratados", "Logística", "Software y licencias", "Impuestos", "Administración", "Otro"];
const PAYMENT_METHODS = ["Transferencia", "Efectivo", "Tarjeta", "Cuenta corriente", "Cheque", "Otro"];
const currencyAmount = (amount, currency = "USD") => `${currency} ${(Number(amount) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const currentMonth = () => todayStr().slice(0, 7);

function FinanceEntryModal({ movement, initialKind = "expense", projects, budgets, clients, onClose, onSave }) {
  const [form, setForm] = useState({ kind: initialKind, concept: "", amount: "", currency: "USD", exchangeRate: 1, date: todayStr(), category: EXPENSE_CATEGORIES[0], paymentMethod: PAYMENT_METHODS[0], projectId: "", budgetId: "", clientId: "", supplier: "", receiptNumber: "", detail: "", attachmentUrl: "", attachmentName: "", ...(movement || {}) });
  const [pickMode, setPickMode] = useState(!movement); const [saving, setSaving] = useState(false); const [processing, setProcessing] = useState(false);
  const [rateInfo, setRateInfo] = useState(null); const [rateLoading, setRateLoading] = useState(false); const [rateError, setRateError] = useState("");
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const projectLink = (projectId) => {
    const project = projects.find((item) => item.id === projectId);
    const budget = budgets.find((item) => item.stage === "Aprobado" && (item.id === project?.budgetId || item.projectId === projectId));
    return { project, budget, clientId: project?.clientId || budget?.clientId || "", clientName: project?.client || budget?.client || "" };
  };
  const selectProject = (projectId) => setForm((current) => { const linked = projectLink(projectId); return { ...current, projectId, clientId: linked.clientId, clientName: linked.clientName, budgetId: linked.budget?.id || "" }; });
  const selectKind = (kind) => setForm((current) => { const linked = projectLink(current.projectId); return { ...current, kind, category: kind === "expense" ? current.category || EXPENSE_CATEGORIES[0] : "", clientId: linked.clientId || current.clientId, clientName: linked.clientName || current.clientName, budgetId: linked.budget?.id || current.budgetId }; });
  const selectedLink = projectLink(form.projectId);
  const selectFile = async (file) => { if (!file) return; setProcessing(true); try { const image = await fileToImages(file); setForm((current) => ({ ...current, attachmentUrl: image.report, attachmentName: file.name })); setPickMode(false); } finally { setProcessing(false); } };
  const loadBnaRate = async () => { setRateLoading(true); setRateError(""); try { const quote = await api.bnaExchangeRate(); setRateInfo(quote); setForm((current) => ({ ...current, exchangeRate: quote.arsPerUsd, exchangeRateSource: "BNA dólar billete vendedor", exchangeRateUpdatedAt: quote.updatedAt })); } catch (error) { setRateError(error.message || "No se pudo consultar BNA"); } finally { setRateLoading(false); } };
  useEffect(() => { if (form.currency === "ARS" && (!movement || !form.exchangeRate)) loadBnaRate(); }, [form.currency]);
  const usd = form.currency === "USD" ? Number(form.amount) || 0 : Number(form.exchangeRate) > 0 ? (Number(form.amount) || 0) / Number(form.exchangeRate) : 0;
  const usdLabel = usd > 0 && usd < 0.01 ? `USD ${usd.toLocaleString("es-AR", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}` : money(usd);
  const submit = async () => { setSaving(true); const saved = await onSave(form); setSaving(false); if (saved) onClose(); };
  return <div className="motion-backdrop fixed inset-0 z-[70] flex items-end justify-center overflow-hidden bg-slate-900/60 sm:items-center sm:p-4" onClick={onClose}><div role="dialog" aria-modal="true" aria-labelledby="finance-dialog-title" className="modal-frame mobile-dialog mobile-sheet-content flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
    <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4 py-3 sm:px-5 sm:py-4"><div><h2 id="finance-dialog-title" className="text-lg font-semibold text-slate-900">{movement ? "Editar movimiento" : `Registrar ${form.kind === "expense" ? "gasto" : "ingreso"}`}</h2><p className="text-xs text-slate-500">Ingresos, gastos y comprobantes de la operación</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"><div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1"><button onClick={() => selectKind("expense")} className={`rounded-lg py-2.5 text-sm font-medium ${form.kind === "expense" ? "bg-white text-brand-600 shadow-sm" : "text-slate-500"}`}>Gasto</button><button onClick={() => selectKind("income")} className={`rounded-lg py-2.5 text-sm font-medium ${form.kind === "income" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500"}`}>Ingreso</button></div>
      {pickMode ? <div className="mt-4"><h3 className="text-sm font-semibold text-slate-800">¿Cómo querés cargar el comprobante?</h3><div className="mt-3 space-y-2"><button onClick={() => setPickMode(false)} className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-slate-200 px-3 text-left hover:border-brand-300"><span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600"><ClipboardList className="h-5 w-5" /></span><span className="flex-1"><b className="block text-sm">Carga manual</b><span className="text-xs text-slate-500">Completá los datos del movimiento.</span></span><ChevronRight className="h-4 w-4 text-slate-400" /></button><label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 hover:border-brand-300"><span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600"><Camera className="h-5 w-5" /></span><span className="flex-1"><b className="block text-sm">Tomar una foto</b><span className="text-xs text-slate-500">Usala como evidencia durante la carga.</span></span><ChevronRight className="h-4 w-4 text-slate-400" /><input type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => selectFile(event.target.files?.[0])} /></label><label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 hover:border-brand-300"><span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600"><Upload className="h-5 w-5" /></span><span className="flex-1"><b className="block text-sm">Elegir imagen</b><span className="text-xs text-slate-500">Seleccioná una imagen existente.</span></span><ChevronRight className="h-4 w-4 text-slate-400" /><input type="file" accept="image/*" className="hidden" onChange={(event) => selectFile(event.target.files?.[0])} /></label></div>{processing && <div className="mt-3 flex items-center gap-2 rounded-lg bg-brand-50 p-3 text-xs text-brand-700"><Loader2 className="h-4 w-4 animate-spin" /> Procesando imagen…</div>}<div className="mt-3 rounded-xl bg-gradient-to-r from-brand-50 to-violet-50 p-3 text-xs text-amber-700"><b className="block">Lectura automática no configurada</b>La imagen se guarda como evidencia; completá manualmente los datos.</div></div> : <div className="mt-4 space-y-3"><L label="Concepto *"><input autoFocus value={form.concept} onChange={(event) => set("concept", event.target.value)} placeholder={form.kind === "expense" ? "Ej. Compra de sensor inductivo" : "Ej. Cobro de factura"} className="u-input" /></L><div className="grid grid-cols-2 gap-2"><L label="Importe *"><input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => set("amount", event.target.value)} placeholder="0,00" className="u-input" /></L><L label="Moneda"><select value={form.currency} onChange={(event) => { const currency = event.target.value; setForm((current) => ({ ...current, currency, exchangeRate: currency === "USD" ? 1 : "", exchangeRateSource: "", exchangeRateUpdatedAt: "" })); }} className="u-input"><option value="ARS">ARS · Peso argentino</option><option value="USD">USD · Dólar estadounidense</option><option value="EUR">EUR · Euro</option></select></L></div>{form.currency !== "USD" && <><div className="grid grid-cols-2 gap-2"><L label={form.currency === "ARS" ? "Dólar BNA vendedor (ARS/USD)" : `Cambio (${form.currency} por USD)`}><input type="number" min="0" step="0.0001" readOnly={form.currency === "ARS" && !rateError} value={form.exchangeRate || ""} onChange={(event) => set("exchangeRate", event.target.value)} placeholder={rateLoading ? "Consultando BNA…" : form.currency === "ARS" ? "Cotización BNA" : "Ej. 0,92"} className={`u-input ${form.currency === "ARS" && !rateError ? "bg-slate-50" : ""}`} /></L><div className="rounded-lg bg-slate-50 px-3 py-2"><span className="block text-[11px] text-slate-400">Equivalente</span><b>{usdLabel}</b></div></div>{form.currency === "ARS" && <div className="flex items-center justify-between gap-2 text-[11px]"><span className={rateError ? "text-rose-600" : "text-slate-500"}>{rateError ? `${rateError} Puedes ingresar la cotización manualmente.` : (form.exchangeRate ? `BNA billete vendedor · ${rateInfo?.updatedAt || form.exchangeRateUpdatedAt ? new Date(rateInfo?.updatedAt || form.exchangeRateUpdatedAt).toLocaleString("es-AR") : "cotización registrada"}` : "Consultando cotización…")}</span><button type="button" onClick={loadBnaRate} disabled={rateLoading} className="font-medium text-brand-600">{rateLoading ? "Actualizando…" : "Actualizar"}</button></div>}</>}<div className="grid grid-cols-2 gap-2"><L label="Fecha *"><input type="date" value={form.date} onChange={(event) => set("date", event.target.value)} className="u-input" /></L>{form.kind === "expense" ? <L label="Categoría"><select value={form.category} onChange={(event) => set("category", event.target.value)} className="u-input">{EXPENSE_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></L> : <L label="Cliente"><select value={form.clientId || ""} onChange={(event) => set("clientId", event.target.value)} className="u-input"><option value="">Sin asociar</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></L>}</div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><L label="Proyecto"><select value={form.projectId || ""} onChange={(event) => selectProject(event.target.value)} className="u-input"><option value="">General / sin proyecto</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}</select></L><L label="Presupuesto">{form.kind === "expense" ? <div className={`min-h-10 rounded-lg border px-3 py-2 text-xs ${selectedLink.budget ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{selectedLink.budget ? <><b className="block">{selectedLink.budget.number || selectedLink.budget.id} · {selectedLink.budget.title}</b><span>Vinculado automáticamente</span></> : form.projectId ? "El proyecto no tiene un presupuesto aprobado." : "Se vinculará al seleccionar un proyecto."}</div> : <select value={form.budgetId || ""} onChange={(event) => set("budgetId", event.target.value)} className="u-input"><option value="">Sin asociar</option>{budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.number || budget.id} · {budget.title}</option>)}</select>}</L></div>{form.kind === "expense" && form.projectId && <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"><Link2 className="h-4 w-4 shrink-0 text-brand-600" /><div><b className="block text-slate-700">Trazabilidad del gasto</b><span className="text-slate-500">{selectedLink.clientName || "Cliente sin identificar"}{selectedLink.budget ? ` · ${selectedLink.budget.number || selectedLink.budget.id}` : " · pendiente de presupuesto aprobado"}</span></div></div>}<div className="grid grid-cols-2 gap-2"><L label={form.kind === "expense" ? "Proveedor" : "Pagador / referencia"}><input value={form.supplier || ""} onChange={(event) => set("supplier", event.target.value)} className="u-input" /></L><L label="Factura / comprobante"><input value={form.receiptNumber || ""} onChange={(event) => set("receiptNumber", event.target.value)} className="u-input" /></L></div><L label="Medio de pago"><select value={form.paymentMethod || ""} onChange={(event) => set("paymentMethod", event.target.value)} className="u-input">{PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}</select></L><L label="Detalle"><textarea value={form.detail || ""} onChange={(event) => set("detail", event.target.value)} rows={3} className="u-input resize-none" /></L>{form.attachmentUrl ? <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-2"><img src={form.attachmentUrl} alt="Comprobante" className="h-16 w-16 rounded-lg object-cover" /><div className="min-w-0 flex-1"><b className="block truncate text-xs">{form.attachmentName || "Comprobante adjunto"}</b><span className="text-[11px] text-emerald-600">Imagen vinculada</span></div><button onClick={() => setForm((current) => ({ ...current, attachmentUrl: "", attachmentName: "" }))} className="grid h-9 w-9 place-items-center rounded-lg text-rose-500"><Trash2 className="h-4 w-4" /></button></div> : <button onClick={() => setPickMode(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium"><Camera className="h-4 w-4" /> Adjuntar comprobante</button>}</div>}
    </div>{!pickMode && <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium">Cancelar</button><button disabled={saving || !form.concept.trim() || !(Number(form.amount) > 0) || !form.date || (form.currency !== "USD" && !(Number(form.exchangeRate) > 0))} onClick={submit} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40 ${form.kind === "expense" ? "bg-brand-500" : "bg-emerald-600"}`}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar {form.kind === "expense" ? "gasto" : "ingreso"}</button></div>}
  </div></div>;
}

function FinanceModule({ movements, projects, budgets, clients, createSignal, onConsumeCreate, onSave, onLoad, onDelete }) {
  const [period, setPeriod] = useState(currentMonth());
  const [projectFilter, setProjectFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState(null);
  const [newKind, setNewKind] = useState("expense");
  const [loadingEdit, setLoadingEdit] = useState("");
  const [bnaQuote, setBnaQuote] = useState(null);
  const [bnaLoading, setBnaLoading] = useState(true);
  const [bnaError, setBnaError] = useState("");
  useEffect(() => { if (createSignal > 0) { setNewKind("expense"); setEditor({ mode: "new" }); onConsumeCreate(); } }, [createSignal, onConsumeCreate]);
  const loadBnaQuote = async () => {
    setBnaLoading(true);
    setBnaError("");
    try { setBnaQuote(await api.bnaExchangeRate()); }
    catch (error) { setBnaError(error.message || "No se pudo consultar la cotización del BNA."); }
    finally { setBnaLoading(false); }
  };
  useEffect(() => { loadBnaQuote(); }, []);

  const projectRows = projectFilter === "all" ? movements : movements.filter((movement) => movement.projectId === projectFilter);
  const monthRows = (key) => projectRows.filter((movement) => String(movement.date || "").slice(0, 7) === key);
  const sumKind = (rows, kind) => rows.filter((movement) => movement.kind === kind).reduce((sum, movement) => sum + (Number(movement.amountUsd) || 0), 0);
  const periodDate = new Date(`${period}-01T12:00:00`);
  const previousDate = new Date(periodDate); previousDate.setMonth(previousDate.getMonth() - 1);
  const previousPeriod = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, "0")}`;
  const inMonth = monthRows(period); const previousRows = monthRows(previousPeriod);
  const income = sumKind(inMonth, "income"); const billed = sumKind(inMonth, "invoice"); const expense = sumKind(inMonth, "expense"); const result = billed - expense; const cashFlow = income - expense;
  const vatPayable = inMonth.filter((movement) => movement.kind === "invoice").reduce((sum, movement) => sum + (Number(movement.vatAmountUsd) || 0), 0); const grossBilled = billed + vatPayable;
  const cumulativeBilled = sumKind(projectRows, "invoice"); const cumulativeCollected = projectRows.filter((movement) => movement.kind === "income" && (movement.projectId || movement.budgetId)).reduce((sum, movement) => sum + (Number(movement.amountUsd) || 0), 0); const receivable = Math.max(0, cumulativeBilled - cumulativeCollected);
  const previousIncome = sumKind(previousRows, "income"); const previousBilled = sumKind(previousRows, "invoice"); const previousExpense = sumKind(previousRows, "expense"); const previousResult = previousBilled - previousExpense;
  const margin = billed > 0 ? (result / billed) * 100 : 0;
  const expenseRows = inMonth.filter((movement) => movement.kind === "expense");
  const documented = expenseRows.filter((movement) => movement.hasAttachment || movement.attachmentUrl || movement.receiptNumber).length;
  const receiptCompliance = expenseRows.length ? (documented / expenseRows.length) * 100 : 100;
  const delta = (value, previous) => previous ? ((value - previous) / Math.abs(previous)) * 100 : null;
  const fmtDelta = (value) => value == null ? "Sin base anterior" : `${value >= 0 ? "+" : ""}${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })}% vs. mes anterior`;

  const trend = Array.from({ length: 12 }, (_, index) => { const date = new Date(periodDate); date.setMonth(date.getMonth() - (11 - index)); const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; const rows = monthRows(key); const inc = sumKind(rows, "income"); const inv = sumKind(rows, "invoice"); const exp = sumKind(rows, "expense"); const vat = rows.filter((movement) => movement.kind === "invoice").reduce((sum, movement) => sum + (Number(movement.vatAmountUsd) || 0), 0); return { key, name: date.toLocaleDateString("es-AR", { month: "short", year: "2-digit" }).replace(".", ""), Cobrado: inc, Facturado: inv, IVA: vat, Egresos: exp, Resultado: inv - exp }; });
  const grouped = (rows, field, fallback) => Object.entries(rows.reduce((map, movement) => { const key = movement[field] || fallback; map[key] = (map[key] || 0) + (Number(movement.amountUsd) || 0); return map; }, {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const categoryRows = categoryFilter === "all" ? expenseRows : expenseRows.filter((movement) => movement.category === categoryFilter);
  const fullCostDistribution = grouped(expenseRows, "category", "Sin categoría");
  const costDistribution = grouped(categoryRows, "category", "Sin categoría").slice(0, 8);
  const suppliers = grouped(categoryRows, "supplier", "Sin proveedor").slice(0, 6);
  const projectProfitability = projects.map((project) => { const rows = inMonth.filter((movement) => movement.projectId === project.id); const inv = sumKind(rows, "invoice"); const exp = sumKind(rows, "expense"); return { name: project.key || project.name, Facturado: inv, Egresos: exp, Resultado: inv - exp }; }).filter((row) => row.Facturado || row.Egresos).sort((a, b) => b.Resultado - a.Resultado).slice(0, 8);
  const billedByClient = Object.values(inMonth.filter((movement) => movement.kind === "invoice").reduce((map, movement) => { const key = movement.clientName || "Sin cliente"; if (!map[key]) map[key] = { name: key, net: 0, vat: 0, gross: 0, value: 0 }; const net = Number(movement.netAmountUsd ?? movement.amountUsd) || 0; const vat = Number(movement.vatAmountUsd) || 0; map[key].net += net; map[key].vat += vat; map[key].gross += Number(movement.grossAmountUsd) || net + vat; map[key].value = map[key].gross; return map; }, {})).sort((a, b) => b.gross - a.gross);
  const budgetExecution = projectFilter === "all" ? [] : budgets.filter((budget) => ["Aprobado", "Facturado"].includes(budget.stage) && budget.projectId === projectFilter).map((budget) => { const actual = movements.filter((movement) => movement.kind === "expense" && (movement.budgetId === budget.id || movement.projectId === budget.projectId)).reduce((sum, movement) => sum + (Number(movement.amountUsd) || 0), 0); const baseline = Number(budget.estimatedCost) || 0; return { ...budget, actual, baseline, deviation: baseline ? actual - baseline : 0, progress: baseline ? (actual / baseline) * 100 : 0 }; }).sort((a, b) => b.progress - a.progress).slice(0, 6);
  const currencyExposure = grouped(inMonth, "currency", "USD");
  const currencyExposureTotal = currencyExposure.reduce((sum, row) => sum + row.value, 0);
  const topCategoryShare = expense && fullCostDistribution.length ? (fullCostDistribution[0].value / expense) * 100 : 0;
  const negativeProjects = projectProfitability.filter((row) => row.Resultado < 0).length;
  const insights = [];
  if (!inMonth.length) insights.push({ tone: "slate", title: "Período sin movimientos", text: "Registrá ingresos y gastos para habilitar comparativas y alertas." });
  if (result < 0) insights.push({ tone: "rose", title: "Resultado operativo negativo", text: `Los egresos superan la facturación en ${money(Math.abs(result))}.` });
  if (delta(expense, previousExpense) > 10) insights.push({ tone: "amber", title: "Aceleración de costos", text: `Los egresos aumentaron ${delta(expense, previousExpense).toFixed(1)}% respecto del mes anterior.` });
  if (receiptCompliance < 90) insights.push({ tone: "amber", title: "Brecha documental", text: `${expenseRows.length - documented} gasto(s) no tienen comprobante ni número de factura.` });
  if (topCategoryShare > 40) insights.push({ tone: "violet", title: "Concentración de costos", text: `${fullCostDistribution[0]?.name} representa ${topCategoryShare.toFixed(0)}% del gasto mensual.` });
  if (negativeProjects) insights.push({ tone: "rose", title: "Rentabilidad por revisar", text: `${negativeProjects} proyecto(s) presentan resultado negativo en el período.` });
  if (vatPayable > 0) insights.push({ tone: "amber", title: "Posición de IVA estimada", text: `${money(vatPayable)} de débito fiscal por facturas del mes. No descuenta el crédito fiscal de compras.` });
  if (inMonth.length && !insights.length) insights.push({ tone: "emerald", title: "Indicadores bajo control", text: "No se detectaron desvíos relevantes con los umbrales actuales." });

  const visible = movements.filter((movement) => (projectFilter === "all" || movement.projectId === projectFilter) && (kindFilter === "all" || movement.kind === kindFilter) && (!query || `${movement.id} ${movement.concept} ${movement.supplier || ""} ${movement.receiptNumber || ""}`.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const openEdit = async (movement) => { setLoadingEdit(movement.id); const full = onLoad ? await onLoad(movement.id) : movement; setLoadingEdit(""); if (full) setEditor(full); };
  const Kpi = ({ label, value, comparison, icon: Icon, tint, detail, description }) => <div tabIndex={0} aria-label={`${label}: ${value}. ${description}`} className="motion-card group relative grid min-h-28 cursor-help grid-rows-[auto_auto_1fr] rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/40 outline-none hover:z-40 focus-visible:z-40 focus-visible:ring-2 focus-visible:ring-brand-500/40">
    <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium leading-4 text-slate-500">{label}</span><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-50"><Icon className={`h-4 w-4 ${tint}`} /></span></div>
    <b className="mt-2 block whitespace-nowrap text-lg leading-6 text-slate-900 sm:text-xl">{value}</b>
    <div className={`mt-1 self-end text-[10px] leading-4 ${comparison != null && comparison < 0 ? "text-rose-600" : "text-slate-400"}`}>{detail || fmtDelta(comparison)}</div>
    <div role="tooltip" className="pointer-events-none invisible absolute left-2 right-2 top-[calc(100%+0.45rem)] z-50 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-normal leading-relaxed text-white opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100">{description}</div>
  </div>;
  const EmptyChart = ({ children = "Sin datos para este período." }) => <div className="grid h-full place-items-center text-center text-xs leading-5 text-slate-400">{projectFilter === "all" && children === "No hay presupuestos aprobados vinculados." ? "Seleccioná un proyecto para analizar su ejecución." : children}</div>;
  const chartTooltip = (value) => money(value);
  const ars = (value) => `ARS ${(Number(value) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const bnaUpdatedAt = bnaQuote?.updatedAt ? new Date(bnaQuote.updatedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "";

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end"><div><h2 className="text-lg font-semibold text-slate-900">Finanzas</h2><p className="text-xs text-slate-500">Desempeño, eficiencia y control financiero · valores comparables en USD</p></div><div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:ml-auto lg:w-auto"><L label="Proyecto"><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="u-input w-full lg:min-w-52"><option value="all">Toda la operación</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}</select></L><L label="Período de análisis"><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className="u-input w-full" /></L></div></div>

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="Facturado neto" value={money(billed)} comparison={delta(billed, previousBilled)} icon={FileText} tint="text-sky-600" description="Facturas emitidas en el período sin IVA. No implica que el importe ya haya sido cobrado." /><Kpi label="IVA ventas estimado" value={money(vatPayable)} icon={AlertTriangle} tint="text-amber-600" detail={`Total c/IVA ${money(grossBilled)}`} description="Débito fiscal del 21% calculado sobre las facturas del período. No descuenta el crédito fiscal de compras." /><Kpi label="Cobrado" value={money(income)} comparison={delta(income, previousIncome)} icon={TrendingUp} tint="text-emerald-600" description="Ingresos efectivamente registrados durante el período, independientemente de cuándo se emitió la factura." /><Kpi label="Por cobrar" value={money(receivable)} icon={Clock} tint={receivable > 0 ? "text-amber-600" : "text-emerald-600"} detail="Saldo acumulado vinculado" description="Diferencia acumulada entre facturación neta y cobros vinculados a proyectos o presupuestos." /><Kpi label="Egresos" value={money(expense)} comparison={delta(expense, previousExpense) == null ? null : -delta(expense, previousExpense)} icon={TrendingDown} tint="text-rose-600" detail={fmtDelta(delta(expense, previousExpense))} description="Total de gastos registrados en el período seleccionado, normalizados a USD." /><Kpi label="Resultado operativo" value={money(result)} comparison={delta(result, previousResult)} icon={BarChart3} tint={result >= 0 ? "text-emerald-600" : "text-rose-600"} detail="Neto facturado − egresos" description="Resultado contable simplificado del período: facturación neta menos egresos. No representa caja disponible." /><Kpi label="Flujo de caja" value={money(cashFlow)} icon={DollarSign} tint={cashFlow >= 0 ? "text-emerald-600" : "text-rose-600"} detail="Cobrado − egresos" description="Movimiento real de efectivo del período: ingresos cobrados menos egresos pagados." />
      <div className="grid min-h-28 grid-rows-[auto_auto_1fr] rounded-xl border border-sky-200 bg-white p-4 shadow-sm shadow-sky-100/60" aria-label="Cotización vendedor del dólar Banco Nación Argentina">
        <div className="flex items-center justify-between gap-3"><div><span className="block text-xs font-medium leading-4 text-slate-500">Cotización dólar BNA</span><span className="text-[9px] text-slate-400">Billete · vendedor</span></div><button type="button" onClick={loadBnaQuote} disabled={bnaLoading} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-600 hover:bg-sky-100 disabled:opacity-50" title="Actualizar cotización del BNA" aria-label="Actualizar cotización del BNA"><RefreshCw className={`h-4 w-4 ${bnaLoading ? "animate-spin" : ""}`} /></button></div>
        {bnaQuote ? <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5"><span className="text-xs font-semibold text-slate-500">USD 1 =</span><b className="whitespace-nowrap text-lg leading-6 text-sky-700 sm:text-xl">{ars(bnaQuote.arsPerUsd)}</b></div> : bnaLoading ? <div className="mt-2 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Consultando…</div> : <div className="mt-2 text-xs font-medium text-rose-600">Cotización no disponible</div>}
        <div className="mt-1 self-end text-[9px] leading-4 text-slate-400">{bnaError || (bnaQuote?.stale ? "Última cotización disponible" : bnaUpdatedAt ? `Actualizada ${bnaUpdatedAt}` : "Fuente: Banco Nación Argentina")}</div>
      </div>
    </div>

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,0.85fr)]"><Panel title="Evolución financiera · 12 meses"><div className="mb-2 text-[11px] text-slate-400">Comparación mensual de facturación neta, IVA, cobros y egresos en USD.</div><div className="h-72">{trend.some((row) => row.Facturado || row.Cobrado || row.Egresos) ? <ResponsiveContainer><BarChart data={trend} margin={{ top: 8, right: 12, left: 6, bottom: 0 }} barCategoryGap="28%"><CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} /><YAxis tickFormatter={(value) => `USD ${value.toLocaleString("es-AR")}`} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={72} /><Tooltip formatter={chartTooltip} cursor={{ fill: "#f8fafc" }} /><Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} /><Bar dataKey="Facturado" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={24} /><Bar dataKey="IVA" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={24} /><Bar dataKey="Cobrado" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={24} /><Bar dataKey="Egresos" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={24} /></BarChart></ResponsiveContainer> : <EmptyChart />}</div></Panel><Panel title="Alertas e interpretación"><div className="space-y-2">{insights.map((item, index) => <div key={`${item.title}-${index}`} className={`rounded-xl border p-3 ${item.tone === "rose" ? "border-rose-200 bg-rose-50" : item.tone === "amber" ? "border-amber-200 bg-amber-50" : item.tone === "violet" ? "border-violet-200 bg-violet-50" : item.tone === "emerald" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}><b className="block text-xs text-slate-800">{item.title}</b><span className="mt-1 block text-[11px] leading-relaxed text-slate-600">{item.text}</span></div>)}</div></Panel></div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><Panel title="Distribución de costos"><div className="mb-2 flex items-center justify-between gap-2"><span className="text-[11px] text-slate-400">Comparación por categoría · USD</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs"><option value="all">Todas las categorías</option>{EXPENSE_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></div><div className="h-64">{costDistribution.length ? <ResponsiveContainer><BarChart data={costDistribution} layout="vertical" margin={{ top: 4, right: 18, left: 10, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} /><XAxis type="number" tickFormatter={(value) => `USD ${value.toLocaleString("es-AR")}`} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="name" width={125} tick={{ fontSize: 10, fill: "#475569" }} axisLine={false} tickLine={false} /><Tooltip formatter={chartTooltip} /><Bar dataKey="value" name="Costo" fill="#F18700" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer> : <EmptyChart />}</div></Panel><Panel title="Rentabilidad por proyecto"><div className="mb-2 text-[11px] text-slate-400">Ingresos menos egresos imputados en el período · USD</div><div className="h-64">{projectProfitability.length ? <ResponsiveContainer><BarChart data={projectProfitability} layout="vertical" margin={{ top: 4, right: 18, left: 8, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} /><XAxis type="number" tickFormatter={(value) => `USD ${value.toLocaleString("es-AR")}`} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="name" width={85} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip formatter={chartTooltip} /><Bar dataKey="Resultado" name="Resultado" radius={[0, 5, 5, 0]}>{projectProfitability.map((row) => <Cell key={row.name} fill={row.Resultado >= 0 ? "#10b981" : "#ef4444"} />)}</Bar></BarChart></ResponsiveContainer> : <EmptyChart>Asociá ingresos y egresos a proyectos para medir rentabilidad.</EmptyChart>}</div></Panel></div>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Panel title="Facturación por cliente">
        <div className="space-y-2">{billedByClient.length ? billedByClient.map((row) => <div key={row.name} className="rounded-xl border border-sky-100 bg-sky-50/70 p-3">
          <div className="flex items-start justify-between gap-3"><span className="min-w-0 truncate text-xs font-semibold text-slate-700" title={row.name}>{row.name}</span><div className="shrink-0 text-right"><span className="block text-[9px] uppercase tracking-wide text-sky-600">Total c/IVA</span><b className="text-sm text-sky-700">{money(row.gross)}</b></div></div>
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-sky-100 pt-2 text-[10px]"><span className="text-slate-500">Neto <b className="block text-slate-700">{money(row.net)}</b></span><span className="text-slate-500">IVA 21% <b className="block text-amber-700">{money(row.vat)}</b></span></div>
        </div>) : <EmptyChart>Sin facturas en el período.</EmptyChart>}</div>
      </Panel>
      <Panel title="Ejecución del presupuesto">
        <div className="space-y-2">{budgetExecution.length ? budgetExecution.map((budget) => <div key={budget.id} className="rounded-xl border border-slate-100 p-3"><div className="flex justify-between gap-2 text-[11px]"><span className="truncate font-semibold">{budget.number || budget.id} · {budget.title}</span><b className={budget.progress > 100 ? "text-rose-600" : "text-slate-700"}>{budget.baseline ? `${budget.progress.toFixed(0)}%` : "Sin costo estimado"}</b></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${budget.progress > 100 ? "bg-rose-500" : budget.progress > 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, budget.progress)}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-slate-400"><span>Real <b className="text-slate-600">{money(budget.actual)}</b></span><span>{budget.baseline ? <>Plan <b className="text-slate-600">{money(budget.baseline)}</b></> : "Completar costo estimado"}</span></div></div>) : <EmptyChart>No hay presupuestos aprobados vinculados.</EmptyChart>}</div>
      </Panel>
      <Panel title="Concentración por proveedor">
        <div className="space-y-3">{suppliers.length ? suppliers.map((row, index) => <div key={row.name}><div className="flex justify-between gap-3 text-[11px]"><span className="min-w-0 truncate font-medium text-slate-600">{index + 1}. {row.name}</span><b className="shrink-0">{money(row.value)}</b></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{ width: `${expense ? Math.min(100, (row.value / expense) * 100) : 0}%` }} /></div><span className="mt-1 block text-right text-[9px] text-slate-400">{expense ? ((row.value / expense) * 100).toFixed(0) : 0}% de los egresos</span></div>) : <EmptyChart>Sin gastos asociados a proveedores.</EmptyChart>}</div>
      </Panel>
      <Panel title="Exposición por moneda">
        <div className="space-y-3">{currencyExposure.length ? currencyExposure.map((row) => { const share = currencyExposureTotal ? (row.value / currencyExposureTotal) * 100 : 0; return <div key={row.name} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><div className="flex items-center justify-between gap-3"><span className="rounded-md bg-white px-2 py-1 text-xs font-bold text-slate-600 shadow-sm">{row.name}</span><div className="text-right"><b className="block text-sm text-slate-800">{money(row.value)}</b><span className="text-[9px] text-slate-400">{share.toFixed(0)}% del período</span></div></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-sky-500" style={{ width: `${share}%` }} /></div></div>; }) : <EmptyChart>Sin movimientos en el período.</EmptyChart>}</div>
      </Panel>
    </div>

    <div><Box className="p-4"><div className="flex flex-col gap-2 sm:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar concepto, proveedor o comprobante…" className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-500" /></div><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"><option value="all">Todos los movimientos</option><option value="expense">Gastos</option><option value="income">Cobros</option><option value="invoice">Facturas</option></select></div><div className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto">{visible.length === 0 ? <div className="py-10 text-center text-sm text-slate-400">No hay movimientos registrados.</div> : visible.map((movement) => { const project = projects.find((item) => item.id === movement.projectId); const invoice = movement.kind === "invoice"; return <div key={movement.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${invoice ? "bg-sky-50 text-sky-600" : movement.kind === "income" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>{invoice ? <FileText className="h-5 w-5" /> : movement.kind === "income" ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b className="text-sm">{movement.concept}</b><span className="font-mono text-[10px] text-slate-400">{movement.id}</span>{movement.budgetId && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">{movement.budgetNumber || budgets.find((item) => item.id === movement.budgetId)?.number || movement.budgetId}</span>}</div><div className="mt-0.5 text-xs text-slate-500">{budgetDate(movement.date)}{project ? ` · ${project.key}` : ""}{movement.category ? ` · ${movement.category}` : ""}{movement.receiptNumber ? ` · ${movement.receiptNumber}` : ""}{movement.purchaseOrderNumber ? ` · OC ${movement.purchaseOrderNumber}` : ""}</div></div><div className="text-right"><b className={invoice ? "text-sky-700" : movement.kind === "income" ? "text-emerald-600" : "text-rose-600"}>{invoice ? "" : movement.kind === "income" ? "+" : "−"}{currencyAmount(movement.amount, movement.currency)}</b>{movement.currency !== "USD" && <span className="block text-[10px] text-slate-400">{money(movement.amountUsd)}</span>}</div>{(movement.hasAttachment || movement.attachmentUrl) && <span title="Comprobante adjunto" className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><FileText className="h-4 w-4" /></span>}{!invoice && <button disabled={loadingEdit === movement.id} onClick={() => openEdit(movement)} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-50">{loadingEdit === movement.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}</button>}<button onClick={() => onDelete(movement)} className="grid h-10 w-10 place-items-center rounded-lg border border-rose-200 text-rose-500"><Trash2 className="h-4 w-4" /></button></div>; })}</div></Box></div>
    {editor && <FinanceEntryModal movement={editor.mode === "new" ? null : editor} initialKind={newKind} projects={projects} budgets={budgets} clients={clients} onClose={() => setEditor(null)} onSave={onSave} />}
  </div>;
}

/* ===================================== PRESUPUESTOS ===================================== */
const budgetDisplayStage = (budget) => {
  return budget.stage || "Borrador";
};
const budgetDate = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR") : "—";
const emptyBudget = (me, clients) => ({ number: "", clientId: clients[0]?.id || "", client: clients[0]?.name || "", site: clients[0]?.site || "", title: "", service: "Automatización", stage: "Borrador", probability: BUDGET_STAGE_PROBABILITY.Borrador, targetMargin: 35, validUntil: "", expectedDecisionDate: "", plannedStart: "", plannedEnd: "", durationDays: 0, teamSize: 1, owner: me.name, contact: "", scope: "", assumptions: "", exclusions: "", risks: "", nextAction: "", nextFollowUp: "", items: [{ type: "Ingeniería", description: "Ingeniero", qty: 1, unit: "h", unitPrice: 38.46, unitCost: 25 }] });

function BudgetEditor({ budget, clients, parts, me, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ ...emptyBudget(me, clients), ...(budget || {}), number: budget?.number || budget?.id || "", probability: BUDGET_STAGE_PROBABILITY[budget?.stage || "Borrador"], items: (budget?.items || emptyBudget(me, clients).items).map((item) => ({ ...item })), additionalCosts: (budget?.additionalCosts || []).map((item) => ({ ...item })) }));
  const [saving, setSaving] = useState(false);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const setItem = (index, patch) => setForm((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  const saleRate = (costValue, marginValue = form.targetMargin) => { const costRate = Number(costValue) || 0; const target = Math.min(90, Math.max(0, Number(marginValue) || 0)); return Math.round((target >= 100 ? costRate : costRate / (1 - target / 100)) * 100) / 100; };
  const changeLaborRole = (index, roleName) => { const role = LABOR_ROLES.find((item) => item.name === roleName); if (role) setItem(index, { description: role.name, unit: "h", unitCost: role.cost, unitPrice: saleRate(role.cost) }); };
  const changeItemType = (index, type) => { if (LABOR_TYPES.includes(type)) { const role = LABOR_ROLES.find((item) => item.name === DEFAULT_ROLE_BY_TYPE[type]) || LABOR_ROLES[0]; setItem(index, { type, description: role.name, unit: "h", unitCost: role.cost, unitPrice: saleRate(role.cost) }); } else setItem(index, { type }); };
  const changeTargetMargin = (value) => { const targetMargin = Math.min(90, Math.max(0, Number(value) || 0)); setForm((current) => ({ ...current, targetMargin, items: current.items.map((item) => LABOR_TYPES.includes(item.type) ? { ...item, unitPrice: saleRate(item.unitCost, targetMargin) } : item) })); };
  const amount = form.items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.unitPrice) || 0), 0);
  const cost = form.items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.unitCost) || 0), 0);
  const margin = amount - cost;
  const commerciallyLocked = Boolean(budget?.commercialLockedAt || ["Aprobado", "Facturado"].includes(budget?.stage));
  const additionalCostTotal = (form.additionalCosts || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const totalCost = cost + additionalCostTotal;
  const currentMargin = amount - totalCost;
  const invalidAdditionalCost = (form.additionalCosts || []).some((item) => !item.createdAt && (!String(item.description || "").trim() || !(Number(item.amount) > 0)));
  const addAdditionalCost = () => set("additionalCosts", [...(form.additionalCosts || []), { id: `tmp-${Date.now()}`, category: "Retrabajo", description: "", amount: "", date: todayStr(), notes: "" }]);
  const submit = async () => { setSaving(true); const saved = await onSave(form); setSaving(false); if (saved) onClose(); };
  return <div className="motion-backdrop fixed inset-0 z-[60] flex items-end justify-center overflow-hidden bg-slate-900/60 sm:items-center sm:p-4" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-labelledby="budget-dialog-title" className="modal-frame mobile-dialog mobile-sheet-content flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4 py-3 sm:px-5"><div><h2 id="budget-dialog-title" className="text-lg font-semibold text-slate-900">{form.id ? `Editar ${form.number || form.id}` : "Nuevo presupuesto"}</h2><p className="text-xs text-slate-500">Estimación técnica, comercial y planificación preliminar</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        <Section title="Oportunidad y cliente"><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><L label="N.º de presupuesto"><input value={form.number || ""} onChange={(event) => set("number", event.target.value)} placeholder="Automático al guardar" className="u-input" /></L><L label="Cliente *"><select value={form.clientId} onChange={(event) => { const client = clients.find((item) => item.id === event.target.value); setForm((current) => ({ ...current, clientId: event.target.value, client: client?.name || "", site: client?.site || "" })); }} className="u-input"><option value="">Seleccionar cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></L><L label="Sitio / planta"><input value={form.site || ""} onChange={(event) => set("site", event.target.value)} className="u-input" /></L><L label="Nombre del presupuesto *"><input value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="Ej. Automatización celda de secado 2" className="u-input" /></L><L label="Tipo de servicio"><select value={form.service} onChange={(event) => set("service", event.target.value)} className="u-input">{SERVICE_TYPES.map((service) => <option key={service}>{service}</option>)}</select></L><L label="Contacto"><input value={form.contact || ""} onChange={(event) => set("contact", event.target.value)} placeholder="Nombre, correo o teléfono" className="u-input" /></L><L label="Responsable comercial"><input value={form.owner || ""} onChange={(event) => set("owner", event.target.value)} className="u-input" /></L></div></Section>

        <Section title="Estado y seguimiento"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><L label="Etapa"><select value={form.stage} onChange={(event) => { const stage = event.target.value; setForm((current) => ({ ...current, stage, probability: BUDGET_STAGE_PROBABILITY[stage], invoicedAt: stage === "Facturado" ? current.invoicedAt || todayStr() : current.invoicedAt })); }} className="u-input">{BUDGET_STAGE_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.stages.map((stage) => <option key={stage}>{stage}</option>)}</optgroup>)}</select></L><L label="Probabilidad automática"><div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">{form.probability}%</div></L><L label="Válido hasta"><input type="date" value={form.validUntil || ""} onChange={(event) => set("validUntil", event.target.value)} className="u-input" /></L><L label="Decisión estimada"><input type="date" value={form.expectedDecisionDate || ""} onChange={(event) => set("expectedDecisionDate", event.target.value)} className="u-input" /></L></div><p className="mt-1 text-[10px] text-slate-400">La probabilidad se actualiza automáticamente según la etapa comercial.</p><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"><L label="Próxima acción"><input value={form.nextAction || ""} onChange={(event) => set("nextAction", event.target.value)} placeholder="Llamar, enviar revisión, visita técnica…" className="u-input" /></L><L label="Próximo seguimiento"><input type="date" value={form.nextFollowUp || ""} onChange={(event) => set("nextFollowUp", event.target.value)} className="u-input" /></L></div></Section>
        {["Aprobado", "Facturado"].includes(form.stage) && <Section title="Orden de compra del cliente">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <L label="N.º de OC del cliente *"><input value={form.purchaseOrderNumber || ""} onChange={(event) => set("purchaseOrderNumber", event.target.value)} placeholder="Ej. OC 4500123456" className="u-input" /></L>
            <L label="Fecha de la OC"><input type="date" value={form.purchaseOrderDate || ""} onChange={(event) => set("purchaseOrderDate", event.target.value)} className="u-input" /></L>
          </div>
          <L label="Observaciones de la OC"><textarea rows={2} value={form.purchaseOrderNotes || ""} onChange={(event) => set("purchaseOrderNotes", event.target.value)} placeholder="Condiciones, posición, liberación, contacto o referencia interna del cliente" className="u-input resize-none" /></L>
          <p className="mt-2 text-[11px] text-slate-500">La OC quedará vinculada al presupuesto, al proyecto y a la factura para conservar la trazabilidad comercial.</p>
        </Section>}

        {form.stage === "Facturado" && <Section title="Datos de facturación · IVA 21%"><div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><L label="N.º de factura *"><input value={form.invoiceNumber || ""} onChange={(event) => set("invoiceNumber", event.target.value)} placeholder="Ej. FC A 0001-00000123" className="u-input" /></L><L label="Fecha de facturación *"><input type="date" value={form.invoicedAt || ""} onChange={(event) => set("invoicedAt", event.target.value)} className="u-input" /></L><L label="Vencimiento"><input type="date" value={form.invoiceDueDate || ""} onChange={(event) => set("invoiceDueDate", event.target.value)} className="u-input" /></L></div><div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><span className="block text-[10px] uppercase text-slate-400">Neto sin IVA</span><b>{money(amount)}</b></div><div className="rounded-xl bg-amber-50 p-3"><span className="block text-[10px] uppercase text-amber-600">IVA 21%</span><b className="text-amber-700">{money(Math.round(amount * 21) / 100)}</b></div><div className="rounded-xl bg-sky-50 p-3"><span className="block text-[10px] uppercase text-sky-600">Total con IVA</span><b className="text-sky-700">{money(Math.round(amount * 121) / 100)}</b></div></div><L label="Detalle de factura"><input value={form.invoiceDetail || ""} onChange={(event) => set("invoiceDetail", event.target.value)} placeholder="Anticipo, hito, avance o saldo final" className="u-input" /></L><p className="mt-2 text-[11px] text-slate-500">Al guardar se generará o actualizará automáticamente la factura en Finanzas usando la fecha indicada.</p></Section>}

        <Section title="Alcance técnico"><textarea value={form.scope || ""} onChange={(event) => set("scope", event.target.value)} rows={4} placeholder="Equipos, señales, software, tableros, documentación, puesta en marcha y entregables" className="u-input resize-none" /><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3"><textarea value={form.assumptions || ""} onChange={(event) => set("assumptions", event.target.value)} rows={3} placeholder="Supuestos y condiciones" className="u-input resize-none" /><textarea value={form.exclusions || ""} onChange={(event) => set("exclusions", event.target.value)} rows={3} placeholder="Exclusiones" className="u-input resize-none" /><textarea value={form.risks || ""} onChange={(event) => set("risks", event.target.value)} rows={3} placeholder="Riesgos técnicos y dependencias" className="u-input resize-none" /></div></Section>

        <Section title="Planificación estimada"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><L label="Inicio previsto"><input type="date" value={form.plannedStart || ""} onChange={(event) => set("plannedStart", event.target.value)} className="u-input" /></L><L label="Fin previsto"><input type="date" value={form.plannedEnd || ""} onChange={(event) => set("plannedEnd", event.target.value)} className="u-input" /></L><L label="Duración (días)"><input type="number" min="0" step="1" value={form.durationDays || ""} onChange={(event) => set("durationDays", event.target.value)} className="u-input" /></L><L label="Equipo estimado"><input type="number" min="1" step="1" value={form.teamSize || 1} onChange={(event) => set("teamSize", event.target.value)} className="u-input" /></L></div></Section>

        <Section title="Estimación económica · USD">
          {commerciallyLocked && <div className="mb-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><div><b className="block">Estimación comercial cerrada</b><span>La venta, cantidades, tarifas, costos base y margen objetivo quedaron fijados al aprobar el presupuesto.</span></div></div>}
          <fieldset disabled={commerciallyLocked} className={commerciallyLocked ? "opacity-75" : ""}>
          <p className="text-[11px] leading-relaxed text-slate-500">Las horas de cada perfil toman automáticamente su costo interno. La tarifa de venta se calcula con el margen objetivo; materiales y repuestos toman venta y costo desde Inventario.</p>
          <div className="my-3 grid grid-cols-1 gap-2 rounded-xl border border-brand-100 bg-brand-50 p-3 sm:grid-cols-[12rem_minmax(0,1fr)]"><L label="Margen objetivo (%)"><input type="number" min="0" max="90" step="1" value={form.targetMargin ?? 35} onChange={(event) => changeTargetMargin(event.target.value)} className="u-input bg-white" /></L><div className="self-center text-xs text-brand-800"><b className="block">Tarifa sugerida = costo ÷ (1 − margen)</b><span className="text-[11px] text-brand-700">Puedes ajustar la tarifa de venta de una línea sin modificar su costo interno.</span></div></div>
          <datalist id="budget-parts">{parts.map((part) => <option key={part.id} value={part.name} />)}</datalist>
          <div className="mb-1 hidden grid-cols-[9rem_minmax(0,1fr)_4rem_4rem_7rem_7rem_auto] gap-2 px-2 text-[9px] font-semibold uppercase tracking-wide text-slate-400 sm:grid"><span>Tipo</span><span>Perfil / concepto</span><span>Cant.</span><span>Unidad</span><span>Venta/u</span><span>Costo/u</span><span /></div>
          <div className="space-y-2">{form.items.map((item, index) => { const labor = LABOR_TYPES.includes(item.type); const lineSale = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0); const lineCost = (Number(item.qty) || 0) * (Number(item.unitCost) || 0); return <div key={index} className="rounded-lg border border-slate-200 p-2.5"><div className="grid grid-cols-2 gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_4rem_4rem_7rem_7rem_auto]"><select value={item.type || "Otro"} onChange={(event) => changeItemType(index, event.target.value)} aria-label="Tipo de concepto" className="u-input"><option>Mano de obra</option><option>Ingeniería</option><option>Programación</option><option>Materiales</option><option>Montaje</option><option>Puesta en marcha</option><option>Viáticos</option><option>Otro</option></select>{labor ? <select value={item.description || DEFAULT_ROLE_BY_TYPE[item.type]} onChange={(event) => changeLaborRole(index, event.target.value)} aria-label="Perfil de mano de obra" className="u-input col-span-2 sm:col-span-1">{LABOR_ROLES.map((role) => <option key={role.name} value={role.name}>{role.name}</option>)}</select> : <input list={item.type === "Materiales" ? "budget-parts" : undefined} value={item.description || ""} onChange={(event) => { const value = event.target.value; const part = parts.find((candidate) => candidate.name === value); setItem(index, part ? { description: value, partId: part.id, unit: part.unit || "u", unitPrice: part.price || 0, unitCost: part.cost || 0 } : { description: value, partId: null }); }} placeholder="Descripción" className="u-input col-span-2 sm:col-span-1" />}<input type="number" min="0" step="0.1" value={item.qty} onChange={(event) => setItem(index, { qty: event.target.value })} aria-label={labor ? "Horas estimadas" : "Cantidad"} className="u-input" /><input value={item.unit || (labor ? "h" : "u")} readOnly={labor} onChange={(event) => setItem(index, { unit: event.target.value })} aria-label="Unidad" className={`u-input ${labor ? "bg-slate-50" : ""}`} /><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => setItem(index, { unitPrice: event.target.value })} placeholder="Venta" aria-label="Precio de venta unitario USD" className="u-input" /><input type="number" min="0" step="0.01" value={item.unitCost} readOnly={labor} onChange={(event) => setItem(index, { unitCost: event.target.value })} placeholder="Costo" aria-label="Costo unitario USD" className={`u-input ${labor ? "bg-slate-50" : ""}`} /><button onClick={() => set("items", form.items.filter((_, itemIndex) => itemIndex !== index))} className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div><div className="mt-2 flex flex-wrap justify-end gap-x-4 gap-y-1 text-[11px] text-slate-500"><span>Venta: <b>{money(lineSale)}</b></span><span>Costo: <b>{money(lineCost)}</b></span><span>Margen: <b className={lineSale - lineCost >= 0 ? "text-emerald-600" : "text-rose-600"}>{money(lineSale - lineCost)}</b></span></div></div>; })}</div>
          <button onClick={() => set("items", [...form.items, { type: "Ingeniería", description: "Ingeniero", qty: 1, unit: "h", unitPrice: saleRate(25), unitCost: 25 }])} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600"><Plus className="h-4 w-4" /> Agregar concepto</button>
          <div className="mt-4 grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-3"><div><span className="block text-[10px] uppercase text-slate-400">Venta presupuestada</span><b>{money(amount)}</b></div><div><span className="block text-[10px] uppercase text-slate-400">Costo interno estimado</span><b>{money(cost)}</b></div><div><span className="block text-[10px] uppercase text-slate-400">Margen bruto estimado</span><b className={margin >= 0 ? "text-emerald-600" : "text-rose-600"}>{money(margin)}{amount > 0 ? ` · ${Math.round((margin / amount) * 100)}%` : ""}</b></div></div>
          </fieldset>
        </Section>

        {commerciallyLocked && <Section title="Costos adicionales posteriores a la aprobación">
          <p className="text-[11px] leading-relaxed text-slate-500">Registra desvíos reales sin alterar la oferta aprobada ni el importe facturado. Los costos guardados quedan registrados en el historial y no pueden modificarse.</p>
          <div className="my-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-4"><div><span className="block text-[9px] uppercase text-slate-400">Venta cerrada</span><b>{money(amount)}</b></div><div><span className="block text-[9px] uppercase text-slate-400">Costo base</span><b>{money(cost)}</b></div><div><span className="block text-[9px] uppercase text-amber-600">Adicionales</span><b className="text-amber-700">{money(additionalCostTotal)}</b></div><div><span className="block text-[9px] uppercase text-slate-400">Margen actualizado</span><b className={currentMargin >= 0 ? "text-emerald-600" : "text-rose-600"}>{money(currentMargin)}{amount > 0 ? ` · ${Math.round((currentMargin / amount) * 100)}%` : ""}</b></div></div>
          <div className="space-y-2">{(form.additionalCosts || []).map((item, index) => item.createdAt ? <div key={item.id || index} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><b className="block text-xs text-slate-700">{item.description}</b><span className="text-[10px] text-slate-400">{item.category} · {budgetDate(item.date)} · {item.createdByName || "Administración"}</span></div><b className="text-sm text-amber-700">{money(item.amount)}</b></div>{item.notes && <p className="mt-2 text-[10px] text-slate-500">{item.notes}</p>}</div> : <div key={item.id || index} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3"><div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_8rem_9rem_auto]"><select value={item.category || "Retrabajo"} onChange={(event) => set("additionalCosts", form.additionalCosts.map((costItem, costIndex) => costIndex === index ? { ...costItem, category: event.target.value } : costItem))} className="u-input bg-white">{ADDITIONAL_COST_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select><input value={item.description || ""} onChange={(event) => set("additionalCosts", form.additionalCosts.map((costItem, costIndex) => costIndex === index ? { ...costItem, description: event.target.value } : costItem))} placeholder="Motivo o concepto *" className="u-input bg-white" /><input type="number" min="0" step="0.01" value={item.amount || ""} onChange={(event) => set("additionalCosts", form.additionalCosts.map((costItem, costIndex) => costIndex === index ? { ...costItem, amount: event.target.value } : costItem))} placeholder="USD *" className="u-input bg-white" /><input type="date" value={item.date || ""} onChange={(event) => set("additionalCosts", form.additionalCosts.map((costItem, costIndex) => costIndex === index ? { ...costItem, date: event.target.value } : costItem))} className="u-input bg-white" /><button onClick={() => set("additionalCosts", form.additionalCosts.filter((_, costIndex) => costIndex !== index))} className="grid h-10 w-10 place-items-center rounded-lg text-rose-500 hover:bg-rose-100"><Trash2 className="h-4 w-4" /></button></div><input value={item.notes || ""} onChange={(event) => set("additionalCosts", form.additionalCosts.map((costItem, costIndex) => costIndex === index ? { ...costItem, notes: event.target.value } : costItem))} placeholder="Detalle, autorización o referencia (opcional)" className="u-input mt-2 bg-white" /></div>)}</div>
          <button onClick={addAdditionalCost} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-amber-300 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"><Plus className="h-4 w-4" /> Agregar costo adicional</button>
          <p className="mt-2 text-[10px] text-slate-400">Costo total actualizado: {money(totalCost)}. Este registro no incrementa automáticamente el valor de venta ni la factura del cliente.</p>
        </Section>}

        {form.activity?.length > 0 && <Section title="Historial comercial"><div className="space-y-2">{[...form.activity].reverse().slice(0, 8).map((entry, index) => <div key={index} className="flex gap-2 text-xs"><Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><div><b className="text-slate-700">{entry.text}</b><div className="text-slate-400">{entry.byName || "Sistema"} · {entry.at ? new Date(entry.at).toLocaleString("es-AR") : ""}</div></div></div>)}</div></Section>}
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={saving || invalidAdditionalCost || !form.client || !form.title.trim() || (["Aprobado", "Facturado"].includes(form.stage) && !form.purchaseOrderNumber?.trim()) || (form.stage === "Facturado" && (!form.invoicedAt || !form.invoiceNumber?.trim()))} onClick={submit} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar presupuesto</button></div>
    </div>
  </div>;
}

function ProjectInvoiceModal({ budget, project, onClose, onSave }) {
  const [form, setForm] = useState({ invoiceNumber: "", date: todayStr(), dueDate: "", amount: Number(budget.amount) || 0, detail: "" });
  const [saving, setSaving] = useState(false);
  const net = Number(form.amount) || 0;
  const vat = Math.round(net * 21) / 100;
  const gross = Math.round((net + vat) * 100) / 100;
  const submit = async () => {
    setSaving(true);
    const saved = await onSave({ kind: "invoice", concept: `Factura ${budget.number || budget.id} · ${budget.title}`, amount: net, amountUsd: net, netAmountUsd: net, vatRate: 21, vatAmountUsd: vat, grossAmountUsd: gross, currency: "USD", exchangeRate: 1, date: form.date, dueDate: form.dueDate, invoiceNumber: form.invoiceNumber.trim(), receiptNumber: form.invoiceNumber.trim(), detail: form.detail, projectId: project?.id || budget.projectId, budgetId: budget.id, budgetNumber: budget.number || budget.id, purchaseOrderNumber: budget.purchaseOrderNumber || "", purchaseOrderDate: budget.purchaseOrderDate || "", clientId: budget.clientId || project?.clientId || "", clientName: budget.client || project?.client || "", paymentStatus: "pending" });
    setSaving(false);
    if (saved) onClose();
  };
  return <div className="motion-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/60 sm:items-center sm:p-4" onClick={onClose}>
    <div className="mobile-dialog mobile-sheet-content w-full max-w-lg rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-lg font-semibold">Registrar factura del proyecto</h2><p className="text-xs text-slate-500">{budget.number || budget.id} · {budget.client}</p></div><button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-lg text-slate-400"><X className="h-5 w-5" /></button></div>
      <div className="space-y-3 p-5">
        <div className="rounded-xl bg-emerald-50 p-3 text-sm"><span className="block text-[10px] uppercase text-emerald-700">Valor aprobado neto</span><b className="text-emerald-800">{money(budget.amount)}</b></div>
        <div className="grid grid-cols-2 gap-2"><L label="N.º de factura *"><input autoFocus value={form.invoiceNumber} onChange={(event) => setForm((current) => ({ ...current, invoiceNumber: event.target.value }))} placeholder="Ej. FC A 0001-00000123" className="u-input" /></L><L label="Neto facturado (USD) *"><input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} className="u-input" /></L><L label="Fecha de emisión"><input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} className="u-input" /></L><L label="Vencimiento"><input type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} className="u-input" /></L></div>
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs"><div><span className="block text-[10px] text-amber-700">Neto</span><b>{money(net)}</b></div><div><span className="block text-[10px] text-amber-700">IVA 21%</span><b>{money(vat)}</b></div><div><span className="block text-[10px] text-amber-700">Total c/IVA</span><b>{money(gross)}</b></div></div>
        <L label="Detalle"><textarea rows={3} value={form.detail} onChange={(event) => setForm((current) => ({ ...current, detail: event.target.value }))} placeholder="Hito, anticipo, avance o saldo final" className="u-input resize-none" /></L>
        <p className="text-[11px] text-slate-500">La factura aparecerá en Finanzas como facturación pendiente. No se considerará cobrada hasta registrar el ingreso correspondiente.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-4"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm">Cancelar</button><button disabled={saving || !form.invoiceNumber.trim() || !(net > 0)} onClick={submit} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Registrar factura</button></div>
    </div>
  </div>;
}

function BudgetsModule({ budgets, finances, clients, parts, projects, me, createSignal, onConsumeCreate, onSave, onDelete, onConvert, onCreateOrder, onInvoice }) {
  const [editingBudget, setEditingBudget] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [billingBudget, setBillingBudget] = useState(null);
  const [executionBudget, setExecutionBudget] = useState(null);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("Todos");
  useEffect(() => { if (createSignal > 0) { setEditingBudget(null); setEditorOpen(true); onConsumeCreate(); } }, [createSignal, onConsumeCreate]);
  const open = budgets.filter((budget) => !["Aprobado", "Facturado", "Rechazado"].includes(budget.stage));
  const pipeline = open.reduce((sum, budget) => sum + (Number(budget.amount) || 0), 0);
  const weighted = open.reduce((sum, budget) => sum + (Number(budget.amount) || 0) * (Number(budget.probability) || 0) / 100, 0);
  const due = open.filter((budget) => budget.nextFollowUp && budget.nextFollowUp <= todayStr()).length;
  const decided = budgets.filter((budget) => ["Aprobado", "Facturado", "Rechazado"].includes(budget.stage));
  const winRate = decided.length ? Math.round(decided.filter((budget) => ["Aprobado", "Facturado"].includes(budget.stage)).length / decided.length * 100) : 0;
  const approved = budgets.filter((budget) => ["Aprobado", "Facturado"].includes(budget.stage));
  const approvedTotal = approved.reduce((sum, budget) => sum + (Number(budget.amount) || 0), 0);
  const approvedByClient = Object.values(approved.reduce((map, budget) => { const key = budget.client || "Sin cliente"; if (!map[key]) map[key] = { name: key, total: 0, count: 0 }; map[key].total += Number(budget.amount) || 0; map[key].count += 1; return map; }, {})).sort((a, b) => b.total - a.total);
  const projectRecommended = (budget) => (Number(budget.durationDays) || 0) > 2 || (Number(budget.teamSize) || 1) > 1 || (budget.items || []).length > 3 || (["Automatización", "Instalación"].includes(budget.service) && (Number(budget.durationDays) || 0) > 1);
  const groupSummary = BUDGET_GROUPS.map((group) => { const rows = budgets.filter((budget) => group.statuses.includes(budget.stage)); return { ...group, count: rows.length, total: rows.reduce((sum, budget) => sum + (Number(budget.amount) || 0), 0), breakdown: group.detail.map((name) => ({ name, count: rows.filter((budget) => budget.stage === name).length })) }; });
  const visible = budgets.filter((budget) => { const selectedGroup = stage.startsWith("group:") ? BUDGET_GROUPS.find((group) => group.id === stage.slice(6)) : null; const overdueFollowUp = !["Aprobado", "Facturado", "Rechazado"].includes(budget.stage) && budget.nextFollowUp && budget.nextFollowUp <= todayStr(); const stageMatches = stage === "Todos" || (selectedGroup ? selectedGroup.statuses.includes(budget.stage) : stage === "Vencido" ? overdueFollowUp : budget.stage === stage); return stageMatches && (!query || `${budget.number || budget.id} ${budget.title} ${budget.client} ${budget.site || ""}`.toLowerCase().includes(query.toLowerCase())); });
  return <div className="space-y-4">
    <div><h2 className="text-lg font-semibold text-slate-900">Gestión de presupuestos</h2><p className="text-xs text-slate-500">Pipeline comercial y planificación preliminar de automatización industrial</p></div>
    <div className="motion-list grid grid-cols-2 gap-3 lg:grid-cols-5"><Metric label="Pipeline abierto" value={money(pipeline)} icon={Briefcase} tint="text-brand-600" description="Suma del valor neto de todos los presupuestos que todavía están en gestión comercial. No incluye aprobados, facturados ni rechazados." /><Metric label="Pipeline ponderado" value={money(weighted)} icon={TrendingUp} tint="text-violet-600" description="Valor esperado del pipeline: cada presupuesto abierto se multiplica por la probabilidad automática de su etapa comercial." /><Metric label="Valor aprobado" value={money(approvedTotal)} icon={CheckCircle2} tint="text-emerald-600" description="Suma neta, sin IVA, de los presupuestos aprobados o ya facturados. Representa negocio ganado, no necesariamente cobrado." /><Metric label="Seguimientos vencidos" value={due} icon={AlertTriangle} tint={due ? "text-rose-600" : "text-emerald-600"} description="Cantidad de presupuestos abiertos cuyo próximo seguimiento estaba previsto para hoy o una fecha anterior." /><Metric label="Conversión histórica" value={`${winRate}%`} icon={CheckCircle2} tint="text-emerald-600" description="Porcentaje de oportunidades ganadas: presupuestos aprobados o facturados dividido por el total de decisiones cerradas, incluyendo rechazados." /></div>
    <Box className="p-3 sm:p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-900">Estado del pipeline</h3><p className="text-[11px] text-slate-500">Avance comercial agrupado; facturación y vencimientos se muestran como condiciones.</p></div>{stage !== "Todos" && <button onClick={() => setStage("Todos")} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">Ver todo</button>}</div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">{groupSummary.map((item, index) => { const selected = stage === `group:${item.id}`; const tones = { slate: selected ? "border-slate-500 bg-slate-50" : "border-slate-200 bg-white", violet: selected ? "border-violet-500 bg-violet-50" : "border-violet-200 bg-white", emerald: selected ? "border-emerald-500 bg-emerald-50" : "border-emerald-200 bg-white", rose: selected ? "border-rose-500 bg-rose-50" : "border-rose-200 bg-white" }; const dots = { slate: "bg-slate-500", violet: "bg-violet-500", emerald: "bg-emerald-500", rose: "bg-rose-500" }; return <div key={item.id} className="relative flex items-center"><button onClick={() => setStage(selected ? "Todos" : `group:${item.id}`)} className={`w-full rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${tones[item.color]}`}><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${dots[item.color]}`} /><span className="text-xs font-semibold text-slate-700">{item.label}</span><b className="ml-auto text-xl text-slate-900">{item.count}</b></div><div className="mt-2 flex items-end justify-between gap-2"><span className="text-[10px] text-slate-400">{item.breakdown.map((row) => `${row.name}: ${row.count}`).join(" · ")}</span><span className="shrink-0 text-[10px] font-semibold text-slate-600">{money(item.total)}</span></div></button>{index < groupSummary.length - 1 && <ChevronRight className="absolute -right-3 z-10 hidden h-4 w-4 text-slate-300 xl:block" />}</div>; })}</div><div className="mt-3 flex flex-wrap gap-2 text-[10px]"><button onClick={() => setStage(stage === "Vencido" ? "Todos" : "Vencido")} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-medium ${stage === "Vencido" ? "bg-rose-100 text-rose-700" : due ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-500"}`}><AlertTriangle className="h-3.5 w-3.5" /> Seguimientos vencidos: {due}</button><span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1.5 font-medium text-sky-700"><FileText className="h-3.5 w-3.5" /> Facturados: {budgets.filter((budget) => budget.stage === "Facturado").length}</span></div></Box>
    {approvedByClient.length > 0 && <Box className="p-4"><div className="mb-3"><h3 className="text-sm font-semibold text-slate-900">Presupuestos aprobados por cliente</h3><p className="text-[11px] text-slate-500">Valor comercial contratado; todavía no representa facturación ni cobro.</p></div><div className="motion-list grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{approvedByClient.map((row) => <div key={row.name} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><span className="block truncate text-xs text-slate-500">{row.name}</span><b className="mt-1 block text-base text-slate-900">{money(row.total)}</b><span className="text-[10px] text-slate-400">{row.count} presupuesto(s) aprobado(s)</span></div>)}</div></Box>}
    <div className="flex flex-col gap-2 sm:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar presupuesto, cliente o planta…" className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-500" /></div><select value={stage} onChange={(event) => setStage(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="Todos">Todos los presupuestos</option><optgroup label="Grupos del pipeline">{BUDGET_GROUPS.map((group) => <option key={group.id} value={`group:${group.id}`}>{group.label}</option>)}</optgroup><optgroup label="Estado detallado">{BUDGET_STAGE_GROUPS.flatMap((group) => group.stages).map((item) => <option key={item} value={item}>{item}</option>)}<option value="Vencido">Seguimiento vencido</option></optgroup></select></div>
    {visible.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><FileText className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-2 text-sm font-semibold text-slate-700">Sin presupuestos para mostrar</h3><p className="mt-1 text-xs text-slate-400">Crea una oportunidad y registra su estimación técnica.</p></div> : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{visible.map((budget) => { const displayStage = budgetDisplayStage(budget); const margin = (Number(budget.amount) || 0) - (Number(budget.totalEstimatedCost ?? budget.estimatedCost) || 0); const followDue = budget.nextFollowUp && budget.nextFollowUp <= todayStr() && !["Aprobado", "Facturado", "Rechazado"].includes(budget.stage); const offerExpired = budget.validUntil && budget.validUntil < todayStr() && !["Aprobado", "Facturado", "Rechazado"].includes(budget.stage); const billed = finances.filter((movement) => movement.kind === "invoice" && movement.budgetId === budget.id).reduce((sum, movement) => sum + (Number(movement.amountUsd) || 0), 0); const project = projects.find((item) => item.id === budget.projectId); return <Box key={budget.id} className="p-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold text-slate-500">{budget.number || budget.id}</span><Chip className={`${BUDGET_STYLE[displayStage]} ring-1`}>{displayStage}</Chip>{budget.purchaseOrderNumber && <Chip className="bg-sky-50 text-sky-700 ring-sky-200">OC {budget.purchaseOrderNumber}</Chip>}{Number(budget.additionalCostTotal) > 0 && <Chip className="bg-amber-50 text-amber-700 ring-amber-200">Costos extra {money(budget.additionalCostTotal)}</Chip>}{followDue && <Chip className="bg-rose-50 text-rose-700 ring-rose-200"><AlertTriangle className="h-3 w-3" /> Seguimiento vencido</Chip>}{offerExpired && <Chip className="bg-amber-50 text-amber-700 ring-amber-200"><Clock className="h-3 w-3" /> Oferta vencida</Chip>}</div><h3 className="mt-2 text-base font-semibold text-slate-900">{budget.title}</h3><p className="mt-0.5 text-xs text-slate-500">{budget.client}{budget.site ? ` · ${budget.site}` : ""}</p></div><button onClick={() => { setEditingBudget(budget); setEditorOpen(true); }} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5 text-xs"><div><span className="block text-[10px] text-slate-400">Valor</span><b>{money(budget.amount)}</b></div><div><span className="block text-[10px] text-slate-400">Probabilidad</span><b>{budget.probability || 0}%</b></div><div><span className="block text-[10px] text-slate-400">Margen actual</span><b className={margin >= 0 ? "text-emerald-600" : "text-rose-600"}>{money(margin)}</b></div></div><div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-600"><div><span className="block text-[10px] text-slate-400">Próxima acción</span><b>{budget.nextAction || "Sin definir"}</b></div><div><span className="block text-[10px] text-slate-400">Seguimiento</span><b className={followDue ? "text-rose-600" : ""}>{budgetDate(budget.nextFollowUp)}</b></div><div><span className="block text-[10px] text-slate-400">Plan previsto</span><b>{budgetDate(budget.plannedStart)}{budget.plannedEnd ? ` → ${budgetDate(budget.plannedEnd)}` : ""}</b></div><div><span className="block text-[10px] text-slate-400">Recursos</span><b>{budget.teamSize || 1} persona(s) · {budget.durationDays || 0} días</b></div></div><div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">{budget.projectId ? <><span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700"><Folder className="h-4 w-4" /> Proyecto {project?.key || "creado"}</span>{billed > 0 && <span className="inline-flex items-center rounded-lg bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700">Facturado: {money(billed)}</span>}{billed < Number(budget.amount) && <button onClick={() => setBillingBudget(budget)} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white"><FileText className="h-4 w-4" /> Registrar factura</button>}</> : null}{["Aprobado", "Facturado"].includes(budget.stage) && <button onClick={() => setExecutionBudget(budget)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-400" title="Elegir cómo iniciar la ejecución del presupuesto"><ChevronRight className="h-4 w-4" /> Iniciar ejecución</button>}<button onClick={() => onDelete(budget)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600"><Trash2 className="h-4 w-4" /> Eliminar</button></div></Box>; })}</div>}
    {editorOpen && <BudgetEditor budget={editingBudget} clients={clients} parts={parts} me={me} onClose={() => setEditorOpen(false)} onSave={onSave} />}
    {billingBudget && <ProjectInvoiceModal budget={billingBudget} project={projects.find((project) => project.id === billingBudget.projectId)} onClose={() => setBillingBudget(null)} onSave={onInvoice} />}
    {executionBudget && <ExecutionChoiceModal budget={executionBudget} project={projects.find((project) => project.id === executionBudget.projectId)} recommendProject={projectRecommended(executionBudget)} onClose={() => setExecutionBudget(null)} onOrder={() => { setExecutionBudget(null); onCreateOrder(executionBudget); }} onProject={async () => { const result = await onConvert(executionBudget); if (result) setExecutionBudget(null); return result; }} />}
  </div>;
}

function ExecutionChoiceModal({ budget, project, recommendProject, onClose, onOrder, onProject }) {
  const [creatingProject, setCreatingProject] = useState(false);
  const orderIsRecommended = !recommendProject || Boolean(project);
  const createProject = async () => { setCreatingProject(true); await onProject(); setCreatingProject(false); };
  return <div className="motion-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/60 sm:items-center sm:p-4" onClick={onClose}>
    <div className="mobile-sheet-content w-full max-w-xl rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="execution-choice-title" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-3"><div><h2 id="execution-choice-title" className="text-lg font-semibold text-slate-900">Iniciar ejecución</h2><p className="mt-1 text-xs text-slate-500"><b>{budget.number || budget.id}</b> · {budget.title}</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
      {project && <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4 shrink-0" /> Este presupuesto ya tiene el proyecto <b>{project.key} · {project.name}</b>.</div>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button onClick={onOrder} className={`group rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${orderIsRecommended ? "border-brand-300 bg-brand-50/70 ring-1 ring-brand-200" : "border-slate-200 bg-white"}`}>
          <div className="flex items-start justify-between gap-2"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-100 text-brand-700"><ClipboardList className="h-5 w-5" /></span>{orderIsRecommended && <span className="rounded-full bg-brand-500 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-white">Recomendado</span>}</div>
          <b className="mt-3 block text-sm text-slate-900">Crear orden de trabajo</b><span className="mt-1 block text-xs leading-relaxed text-slate-500">Para una intervención puntual, diagnóstico, mantenimiento, emergencia o trabajo de pocos días.</span>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">Continuar a la orden <ChevronRight className="h-3.5 w-3.5" /></span>
        </button>
        <button onClick={project ? undefined : createProject} disabled={Boolean(project) || creatingProject} className={`group rounded-xl border p-4 text-left transition enabled:hover:-translate-y-0.5 enabled:hover:shadow-md disabled:cursor-default ${recommendProject && !project ? "border-emerald-300 bg-emerald-50/70 ring-1 ring-emerald-200" : project ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200 bg-white"}`}>
          <div className="flex items-start justify-between gap-2"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700">{creatingProject ? <Loader2 className="h-5 w-5 animate-spin" /> : <Folder className="h-5 w-5" />}</span>{recommendProject && !project && <span className="rounded-full bg-emerald-600 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-white">Recomendado</span>}</div>
          <b className="mt-3 block text-sm text-slate-900">{project ? "Proyecto ya creado" : "Convertir en proyecto"}</b><span className="mt-1 block text-xs leading-relaxed text-slate-500">Para automatizaciones con etapas, varios técnicos, ingeniería, programación, montaje y puesta en marcha.</span>
          <span className={`mt-3 inline-flex items-center gap-1 text-xs font-semibold ${project ? "text-slate-400" : "text-emerald-700"}`}>{project ? `Proyecto ${project.key}` : "Crear y planificar"}{!project && <ChevronRight className="h-3.5 w-3.5" />}</span>
        </button>
      </div>
      <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500">Ambas opciones conservarán el vínculo con el presupuesto y la orden de compra. Un proyecto puede contener varias órdenes de trabajo.</p>
    </div>
  </div>;
}

function ActionCenter({ orders, tasks, parts, budgets = [], onGo }) {
  const pendingBilling = orders.filter((o) => o.status === "Completada" || o.status === "Aprobada").length;
  const overdue = tasks.filter(isOverdue).length;
  const stale = tasks.filter(isStale).length;
  const low = parts.filter((p) => Number(p.stock) <= Number(p.minStock)).length;
  const budgetFollowUps = budgets.filter((budget) => !["Aprobado", "Facturado", "Rechazado"].includes(budget.stage) && budget.nextFollowUp && budget.nextFollowUp <= todayStr()).length;
  const actions = [
    { id: "billing", label: "Listas para facturar", value: pendingBilling, icon: FileText, tone: "text-amber-700 bg-amber-50 border-amber-200" },
    { id: "projects", label: "Tareas vencidas", value: overdue, icon: AlertTriangle, tone: "text-rose-700 bg-rose-50 border-rose-200" },
    { id: "projects", label: "Tareas estancadas", value: stale, icon: Clock, tone: "text-violet-700 bg-violet-50 border-violet-200" },
    { id: "inventory", label: "Stock crítico", value: low, icon: Wrench, tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
    { id: "budgets", label: "Presupuestos a seguir", value: budgetFollowUps, icon: Briefcase, tone: "text-sky-700 bg-sky-50 border-sky-200" },
  ];
  return <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="mb-3"><h3 className="text-sm font-semibold text-slate-900">Prioridades de hoy</h3><p className="text-xs text-slate-500">Acciones que requieren atención.</p></div><div className="grid grid-cols-2 gap-2 lg:grid-cols-5">{actions.map(({ id, label, value, icon: Icon, tone }, index) => <button key={`${id}-${index}`} onClick={() => onGo(id)} className={`flex min-w-0 items-center gap-2 rounded-lg border p-2.5 text-left ${tone}`}><Icon className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block text-lg font-semibold leading-none">{value}</span><span className="mt-1 block text-[11px] leading-tight">{label}</span></span><ChevronRight className="h-4 w-4 shrink-0 opacity-50" /></button>)}</div></section>;
}

/* ===================================== PANEL DE DIRECCIÓN ===================================== */
const PIE_COLORS = ["#F18700", "#0ea5e9", "#10b981", "#8b5cf6", "#ef4444", "#f59e0b", "#14b8a6"];
const monthKey = (d) => (d || "").slice(0, 7);
const monthLabelShort = (ym) => { const [y, m] = ym.split("-"); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("es-MX", { month: "short" }).replace(".", ""); };

function Dashboard({ orders, users, tasks, parts, budgets = [], onOpen, onGo }) {
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
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); const ym = localMonthKey(d); arr.push({ ym, name: monthLabelShort(ym), value: 0 }); }
    const idx = Object.fromEntries(arr.map((a, i) => [a.ym, i]));
    facturadas.forEach((o) => { const k = monthKey(o.date); if (k in idx) arr[idx[k]].value += tot(o); });
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
  periodOrders.forEach((o) => { const k = o.tech || "—"; if (!byTech[k]) byTech[k] = { name: k.split(" ")[0], horas: 0, ordenes: 0 }; byTech[k].horas += (Number(o.laborHours) || 0) * (Number(o.technicians) || 1); byTech[k].ordenes += 1; });
  const tech = Object.values(byTech).sort((a, b) => b.horas - a.horas);

  const periodLabel = { mes: "este mes", trim: "último trimestre", anio: "este año" }[period];
  const fmtK = (value) => {
    const amount = Number(value) || 0;
    return `USD ${Math.abs(amount) >= 1000 ? `${(amount / 1000).toFixed(0)}k` : Math.round(amount)}`;
  };

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

      <ActionCenter orders={orders} tasks={tasks} parts={parts} budgets={budgets} onGo={onGo} />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between"><span className="text-[11px] font-medium text-slate-500">Facturado ({periodLabel})</span><DollarSign className="h-4 w-4 text-emerald-600" /></div>
          <div className="mt-0.5 text-lg font-semibold text-slate-900">{money(periodBilled)}</div>
          {marginPct != null && <div className="mt-0.5 text-[11px] font-medium text-emerald-600">Margen {marginPct}% · {money(marginAmount)}</div>}
          {variation != null && <div className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium ${variation >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{variation >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{variation >= 0 ? "+" : ""}{variation}% vs período anterior</div>}
        </div>
        <Metric label="Ticket promedio" value={money(ticket)} icon={ClipboardList} tint="text-brand-600" description="Valor promedio facturado por orden en el período seleccionado: facturación total dividida por cantidad de órdenes facturadas." />
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between"><span className="text-[11px] font-medium text-slate-500">Por facturar (total)</span><AlertTriangle className="h-4 w-4 text-amber-600" /></div>
          <div className="mt-0.5 text-lg font-semibold text-slate-900">{money(pendingTotal)}</div>
          {oldestPending > 0 && <div className="mt-0.5 text-[11px] text-slate-400">la más vieja: hace {oldestPending} días</div>}
        </div>
        <Metric label={`Órdenes (${periodLabel})`} value={periodOrders.length} icon={LayoutGrid} tint="text-slate-600" description="Cantidad total de órdenes registradas dentro del período de análisis, cualquiera sea su estado." />
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
        <Panel title="Pendientes de facturación por antigüedad">
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
        <Panel title={`Valor de órdenes por cliente (${periodLabel})`}>
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
                <Bar dataKey="horas" name="Horas-técnico" fill="#F18700" radius={[5, 5, 0, 0]} />
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
  const myOrders = orders.filter((o) => o.tech === me.name && ["Borrador", "En progreso", "En proceso de ejecución"].includes(o.status));
  const overdue = myTasks.filter(isOverdue).length;
  const pend = ger ? orders.filter((o) => o.status === "Completada" || o.status === "Aprobada") : [];
  return (
    <div className="space-y-5">
      <div><h2 className="text-lg font-semibold text-slate-900">Hola, {me.name.split(" ")[0]}</h2><p className="text-sm text-slate-500">Esto es lo que tienes pendiente hoy.</p></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Mis tareas abiertas" value={myTasks.length} icon={LayoutGrid} tint="text-brand-600" />
        <Metric label="Tareas vencidas" value={overdue} icon={AlertTriangle} tint="text-rose-600" />
        <Metric label="Mis órdenes activas" value={myOrders.length} icon={ClipboardList} tint="text-emerald-600" />
        {ger && <Metric label="Por facturar" value={pend.length} icon={FileText} tint="text-amber-600" />}
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
  const unsigned = orders.filter((o) => o.status === "Completada" && !o.signatureUrl && !o.noSignReason);
  const monthKey = localMonthKey();
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
          <Metric label="Por facturar" value={money(monthPending)} icon={AlertTriangle} tint="text-amber-600" description="Valor de órdenes completadas o aprobadas del mes que todavía no fueron marcadas como facturadas." />
        </>) : (<>
          <Metric label="Completadas" value={monthOrders.filter((o) => o.status === "Completada" || o.status === "Aprobada").length} icon={CheckCircle2} tint="text-emerald-600" />
          <Metric label="En proceso de ejecución" value={monthOrders.filter((o) => ["En progreso", "En proceso de ejecución"].includes(o.status)).length} icon={Clock} tint="text-brand-600" />
        </>)}
        <Metric label="Sin firma" value={unsigned.length} icon={FileSignature} tint="text-rose-600" description="Órdenes completadas que aún no tienen conformidad del cliente registrada." />
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
                {o._offline && <Chip className="bg-amber-50 text-amber-700 ring-amber-200"><WifiOff className="h-3 w-3" />Pendiente de sincronizar</Chip>}
                {o.category && <Chip className="bg-brand-50 text-brand-700 ring-brand-600/20"><Sparkles className="h-3 w-3" />{o.category}</Chip>}
                <span className="ml-auto text-sm font-semibold text-slate-900">{ger ? money(t.total) : <span className="text-slate-400">{compactDuration((Number(o.laborHours) || 0) * 3600000)}</span>}</span>
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
  const [month, setMonth] = useState(localMonthKey());
  const monthOrders = orders.filter((o) => (o.date || "").startsWith(month) && ["Completada", "Aprobada", "Facturada"].includes(o.status));
  const groups = {};
  monthOrders.forEach((o) => {
    const t = orderTotals(o);
    const g = groups[o.client] || (groups[o.client] = { client: o.client, count: 0, hours: 0, labor: 0, mats: 0, total: 0, facturado: 0, pendiente: 0 });
    g.count++; g.hours += (Number(o.laborHours) || 0) * (Number(o.technicians) || 1); g.labor += t.labor; g.mats += t.mats; g.total += t.total;
    if (o.status === "Facturada") g.facturado += t.total; else g.pendiente += t.total;
  });
  const rows = Object.values(groups).sort((a, b) => b.total - a.total);
  const sum = rows.reduce((s, r) => ({ count: s.count + r.count, total: s.total + r.total, facturado: s.facturado + r.facturado, pendiente: s.pendiente + r.pendiente }), { count: 0, total: 0, facturado: 0, pendiente: 0 });
  const monthLabel = new Date(month + "-01T00:00:00").toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  const chart = rows.slice(0, 8).map((r) => ({ name: r.client.length > 14 ? r.client.slice(0, 13) + "…" : r.client, value: Math.round(r.total), fill: "#F18700" }));
  const exportCSV = () => {
    const head = ["Cliente", "Órdenes", "Horas-técnico", "Mano de obra (USD)", "Materiales (USD)", "Total (USD)", "Facturado (USD)", "Por facturar (USD)"];
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
                  <span className="text-xs text-slate-400">{r.count} orden(es) · {r.hours} h-técnico</span>
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
function OrderDetail({ ger, order, onClose, onUpdate, onAdvance, onExport, onDelete, onComment, onDuplicate, onCreateTask, onContinue, onEdit, me }) {
  const idx = O_STATUS.indexOf(order.status);
  const next = idx >= 0 && idx < O_STATUS.length - 1 ? O_STATUS[idx + 1] : null;
  const reportReady = ["Completada", "Aprobada", "Facturada"].includes(order.status);
  const closureReady = ["Completada", "Aprobada", "Facturada"].includes(order.status);
  const needSign = next === "Aprobada" && !order.signatureUrl && !order.noSignReason;
  const needTechnicianSign = !!next && ["Completada", "Aprobada", "Facturada"].includes(next) && !order.technicianSignatureUrl;
  const canAdvance = next && (next !== "Aprobada" || ger) && (next !== "Facturada" || ger);
  const [rate, setRate] = useState(normalizedRate(order.rate));
  const [mats, setMats] = useState((order.materials || []).map((material) => ({ ...material, price: wholeMoney(material.price), cost: wholeMoney(material.cost) })));
  const [laborBillable, setLaborBillable] = useState(order.laborBillable);
  const [laborCost, setLaborCost] = useState(wholeMoney(order.laborCost));
  const [sig, setSig] = useState(null); const [sigBy, setSigBy] = useState(""); const [sigRoleChoice, setSigRoleChoice] = useState(""); const [sigRole, setSigRole] = useState("");
  const [technicianSig, setTechnicianSig] = useState(null);
  const [noSignOpen, setNoSignOpen] = useState(false);
  useEffect(() => { setRate(normalizedRate(order.rate)); setMats((order.materials || []).map((material) => ({ ...material, price: wholeMoney(material.price), cost: wholeMoney(material.cost) }))); setLaborBillable(order.laborBillable); setLaborCost(wholeMoney(order.laborCost)); setSig(null); setSigBy(""); setSigRoleChoice(""); setSigRole(""); setTechnicianSig(null); }, [order.id]);
  const t = orderTotals({ ...order, rate, materials: mats, laborBillable });
  const mg = orderMargin({ ...order, rate, materials: mats, laborBillable, laborCost });
  const dirty = ger && (rate !== order.rate || laborBillable !== order.laborBillable || (order.laborCost || 0) !== Number(laborCost) || JSON.stringify(mats) !== JSON.stringify(order.materials));
  const savePrices = () => onUpdate(order.id, { rate: normalizedRate(rate), laborCost: wholeMoney(laborCost), materials: mats.map((m) => ({ ...m, price: wholeMoney(m.price), cost: wholeMoney(m.cost), qty: Number(m.qty) || 0 })), laborBillable });
  const shareOrder = async () => { const text = `${order.id} · ${order.client}\n${order.site || ""}\n${order.service} · ${order.status}`; if (navigator.share) { try { await navigator.share({ title: `Orden ${order.id}`, text }); } catch {} } else { try { await navigator.clipboard.writeText(text); } catch {} } };
  const downloadReport = (audience) => {
    const errors = timelineErrors(order.technical, order.technical?.completedAt ? new Date(order.technical.completedAt).getTime() : Date.now());
    if (errors.length) { alert(`No se puede generar un reporte con una cronología inconsistente:\n\n${errors.join("\n")}`); return; }
    if (audience === "internal") internalOrderReportPDF(order);
    else if (audience === "valued") valuedClientReportPDF(order);
    else clientOrderReportPDF(order);
  };
  const [zoom, setZoom] = useState(null);
  return (
    <div className="motion-backdrop fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3"><div className="flex items-center gap-2"><span className="font-mono text-sm font-semibold text-slate-800">{order.id}</span><Chip className={O_STYLE[order.status]}>{order.status}</Chip></div><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="space-y-4 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-5">
          <section><div className="text-base font-semibold text-slate-900">{order.client}</div><div className="text-sm text-slate-500">{order.site}{order.contact ? ` · ${order.contact}` : ""}</div><div className="mt-1 text-xs text-slate-500">{order.service} · {order.date}{order.tech ? ` · Técnico: ${order.tech}` : ""}</div>{(order.quoteNumber || order.customerPO) && <div className="mt-1 text-xs text-slate-400">{order.quoteNumber ? `Presupuesto: ${order.quoteNumber}` : ""}{order.quoteNumber && order.customerPO ? " · " : ""}{order.customerPO ? `OC: ${order.customerPO}` : ""}</div>}<div className="mt-3 flex flex-wrap gap-2">{order.contactPhone && <a href={`tel:${order.contactPhone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600"><Phone className="h-4 w-4" /> Llamar</a>}{order.location && <a href={`https://www.google.com/maps/search/?api=1&query=${order.location.lat},${order.location.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600"><Navigation className="h-4 w-4" /> Abrir mapa</a>}<button onClick={shareOrder} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600"><ExternalLink className="h-4 w-4" /> Compartir</button></div></section>
          {onContinue && <button onClick={() => onContinue(order)} className="flex w-full items-center justify-between gap-3 rounded-xl bg-brand-500 px-4 py-3 text-left text-white shadow-sm hover:bg-brand-400"><span><b className="block text-sm">Retomar y finalizar trabajo</b><span className="mt-0.5 block text-[11px] text-white/80">Completar imágenes, diagnóstico, intervención, verificaciones y firmas.</span></span><ChevronRight className="h-5 w-5 shrink-0" /></button>}
          {(order.equipo || order.sintoma || order.solucion) && (<section className="rounded-lg bg-slate-50 p-3 text-sm">{order.equipo && <p><span className="font-medium text-slate-700">Equipo:</span> {order.equipo}</p>}{order.sintoma && <p className="mt-1"><span className="font-medium text-slate-700">Síntoma:</span> {order.sintoma}</p>}{order.solucion && <p className="mt-1"><span className="font-medium text-slate-700">Trabajo:</span> {order.solucion}</p>}</section>)}
          {order.technical?.reportedAt && <section className="rounded-lg border border-slate-200 p-3"><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Cronología del servicio</h4><div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{[["Aviso", order.technical.reportedAt], ["Llegada", order.technical.arrivalAt], ["Inicio", order.technical.startedAt], ["Fin", order.technical.completedAt]].map(([label, value]) => <div key={label}><span className="block text-[10px] text-slate-400">{label}</span><b className="text-slate-700">{value ? new Date(value).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Pendiente"}</b></div>)}</div><div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600"><span className="rounded-md bg-slate-100 px-2 py-1">Intervención: {compactDuration(timelineWorkMs(order.technical, order.technical.completedAt ? new Date(order.technical.completedAt).getTime() : Date.now()))}</span>{order.technical.downtimeMinutes > 0 && <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-700">Parada productiva: {order.technical.downtimeMinutes} min</span>}</div></section>}
          {order.technical && Object.values(order.technical).some(Boolean) && <section className="rounded-lg border border-slate-200 p-3 text-sm"><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Ficha técnica</h4><div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">{order.technical.assetTag && <p><b>TAG:</b> {order.technical.assetTag}</p>}{order.technical.manufacturer && <p><b>Fabricante:</b> {order.technical.manufacturer}</p>}{order.technical.model && <p><b>Modelo:</b> {order.technical.model}</p>}{order.technical.serial && <p><b>Serie:</b> {order.technical.serial}</p>}{order.technical.finalCondition && <p><b>Estado final:</b> {order.technical.finalCondition}</p>}{order.technical.downtimeMinutes > 0 && <p><b>Parada:</b> {order.technical.downtimeMinutes} min</p>}</div>{order.technical.diagnosis && <p className="mt-2 text-xs text-slate-600"><b>Diagnóstico:</b> {order.technical.diagnosis}</p>}{order.technical.rootCause && <p className="mt-1 text-xs text-slate-600"><b>Causa raíz:</b> {order.technical.rootCause}</p>}{order.technical.testsPerformed && <p className="mt-1 text-xs text-slate-600"><b>Pruebas:</b> {order.technical.testsPerformed}</p>}{order.technical.testResult && <p className="mt-1 text-xs text-slate-600"><b>Resultado:</b> {order.technical.testResult}</p>}{order.technical.recommendations && <p className="mt-1 text-xs text-slate-600"><b>Recomendaciones:</b> {order.technical.recommendations}</p>}{ger && order.technical.internalNotes && <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800"><b>Nota interna:</b> {order.technical.internalNotes}</p>}</section>}
          {ger && (order.technical?.recurrence || order.technical?.internalDisposition || order.technical?.internalOwner || (order.service === "Garantía" && order.technical?.warranty)) && <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 text-xs text-slate-600"><h4 className="mb-2 font-semibold uppercase tracking-wide text-violet-500">Gestión interna</h4>{order.service === "Garantía" && order.technical?.warranty && <p><b>Garantía:</b> {order.technical.warranty}</p>}{order.technical?.recurrence && <p><b>Recurrencia:</b> {order.technical.recurrence}</p>}{order.technical?.internalDisposition && <p><b>Próxima acción:</b> {order.technical.internalDisposition}</p>}{order.technical?.internalOwner && <p><b>Responsable:</b> {order.technical.internalOwner}</p>}</section>}
          {order.noSignReason && <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700">Cerrada sin firma. Motivo: {order.noSignReason}</div>}
          {order.photos && order.photos.length > 0 && (<section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Evidencia</h4><div className="flex flex-wrap gap-2">{order.photos.map((p, i) => (<button key={i} onClick={() => setZoom(p)} className="relative" aria-label={`Ampliar foto ${p.cat || ""}`}><img src={p.preview || p.url} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-200" /><span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 text-center text-[9px] text-white">{p.cat}</span></button>))}</div></section>)}
          <section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Mano de obra y materiales</h4><div className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex items-center justify-between text-slate-600"><span>Tiempo efectivo</span><span className="font-medium text-slate-800">{compactDuration((Number(order.laborHours) || 0) * 3600000)}</span></div>{ger && <div className="mt-1 flex items-center justify-between text-slate-600"><span>Horas facturables</span><span className="font-medium text-slate-800">{t.billedHours} h · {order.technicians || 1} téc. · {round2(t.billedHours * (Number(order.technicians) || 1))} h-técnico</span></div>}{Number(order.technical?.billableWaitMinutes) > 0 && <div className="mt-1 flex items-center justify-between text-xs text-slate-500"><span>{ger ? "Espera facturable" : "Espera registrada"}</span><span>{order.technical.billableWaitMinutes} min</span></div>}
            {ger && <div className="mt-2 flex items-center gap-2"><span className="text-slate-600">Tarifa/h por técnico (USD):</span><input type="number" min="0" step="1" value={rate} onChange={(e) => setRate(e.target.value)} onBlur={(e) => setRate(normalizedRate(e.target.value))} className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm" /><label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={laborBillable} onChange={(e) => setLaborBillable(e.target.checked)} /> Facturable</label></div>}
            {ger && laborBillable && <p className="mt-1 text-[11px] text-slate-500">{t.billedHours} h facturables × {order.technicians || 1} técnico(s) × {money(rate)} = <b className="text-slate-700">{money(t.labor)}</b></p>}
            {ger && <div className="mt-1 flex items-center gap-2"><span className="text-slate-500 text-xs">Costo/h interno (USD):</span><input type="number" min="0" step="1" value={laborCost} onChange={(e) => setLaborCost(e.target.value)} onBlur={(e) => setLaborCost(wholeMoney(e.target.value))} className="w-24 rounded-md border border-slate-200 px-2 py-1 text-xs" /></div>}
            {mats.length > 0 && <ul className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">{mats.map((m, i) => (<li key={i} className="text-sm"><div className="flex min-w-0 items-start justify-between gap-2"><span className="min-w-0 break-words text-slate-700">{m.qty}× {m.name || "—"}</span>{ger && <span className="shrink-0 text-xs text-slate-500">{money((m.qty || 0) * (m.price || 0))}</span>}</div>{ger && <div className="mt-1 grid grid-cols-2 gap-2 sm:flex sm:items-center"><label className="text-xs text-slate-500">P. unit. USD:<input type="number" min="0" step="1" value={m.price} onChange={(e) => setMats((x) => x.map((y, j) => j === i ? { ...y, price: e.target.value } : y))} onBlur={(e) => setMats((x) => x.map((y, j) => j === i ? { ...y, price: wholeMoney(e.target.value) } : y))} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-xs sm:ml-1 sm:mt-0 sm:w-24" /></label><label className="text-xs text-slate-500">Costo USD:<input type="number" min="0" step="1" value={m.cost ?? ""} onChange={(e) => setMats((x) => x.map((y, j) => j === i ? { ...y, cost: e.target.value } : y))} onBlur={(e) => setMats((x) => x.map((y, j) => j === i ? { ...y, cost: wholeMoney(e.target.value) } : y))} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-xs sm:ml-1 sm:mt-0 sm:w-20" /></label><label className="col-span-2 flex items-center gap-1 text-[11px] text-slate-500 sm:ml-auto"><input type="checkbox" checked={m.billable} onChange={(e) => setMats((x) => x.map((y, j) => j === i ? { ...y, billable: e.target.checked } : y))} /> Facturable</label></div>}</li>))}</ul>}
          </div></section>
          {ger && (<section className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm"><div className="flex items-center justify-between text-slate-600"><span>Mano de obra</span><span className="font-medium text-slate-800">{money(t.labor)}</span></div><div className="flex items-center justify-between text-slate-600"><span>Materiales facturables</span><span className="font-medium text-slate-800">{money(t.mats)}</span></div><div className="mt-2 flex items-center justify-between border-t border-emerald-200 pt-2 font-semibold text-slate-900"><span>Total</span><span>{money(t.total)}</span></div>{(mg.cost > 0) && <><div className="mt-2 flex items-center justify-between border-t border-emerald-200 pt-2 text-slate-500"><span>Costo estimado</span><span>{money(mg.cost)}</span></div><div className="flex items-center justify-between font-semibold text-emerald-700"><span>Margen</span><span>{money(mg.margin)} · {Math.round(mg.pct * 100)}%</span></div></>}{dirty && <button onClick={savePrices} className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500">Guardar precios y costos</button>}</section>)}
          {order.technicianSignatureUrl ? (<section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Firma del técnico responsable</h4><img src={order.technicianSignatureUrl} alt="Firma del técnico" className="h-20 rounded-lg border border-slate-200 bg-white" /><div className="mt-1 text-xs text-slate-500">Firmó: {order.technicianSignedBy || order.tech}{order.technicianSignedAt ? ` · ${new Date(order.technicianSignedAt).toLocaleString("es-AR")}` : ""}</div></section>) : closureReady && (<section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Firma del técnico responsable</h4><SignaturePad key={`technician-${order.id}`} onChange={setTechnicianSig} /><div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Técnico: <b>{order.tech || me?.name || "—"}</b></div><button disabled={!technicianSig} onClick={() => onUpdate(order.id, { technicianSignatureUrl: technicianSig, technicianSignedAt: new Date().toISOString(), technicianSignedBy: order.tech || me?.name || "Técnico responsable" })} className="mt-2 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">Guardar firma técnica</button></section>)}
          {order.signatureUrl && (<section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Conformidad del cliente</h4>{order.signatureUrl !== "signed" ? <img src={order.signatureUrl} alt="firma" className="h-20 rounded-lg border border-slate-200 bg-white" /> : <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">Firmada</div>}{order.signedBy && <div className="mt-1 text-xs text-slate-500">Firmó: {order.signedBy} · {order.technical?.signerCompany || order.client}</div>}</section>)}
          {!order.signatureUrl && closureReady && (<section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Firma del cliente</h4><SignaturePad key={order.id} onChange={setSig} /><input value={sigBy} onChange={(e) => setSigBy(e.target.value)} placeholder="Nombre de quien firma" className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" /><select value={sigRoleChoice} onChange={(e) => { setSigRoleChoice(e.target.value); setSigRole(e.target.value === "Otro" ? "" : e.target.value); }} className="u-input mt-2"><option value="">Cargo / área</option>{SIGNER_ROLES.map((role) => <option key={role}>{role}</option>)}<option>Otro</option></select>{sigRoleChoice === "Otro" && <input value={sigRole} onChange={(e) => setSigRole(e.target.value)} placeholder="Especificar cargo / área" className="u-input mt-2" />}<div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Empresa: <b>{order.client}</b></div><button disabled={!sig} onClick={() => onUpdate(order.id, { signatureUrl: sig, signedAt: new Date().toISOString(), signedBy: sigBy, technical: { ...(order.technical || {}), signerRole: sigRole, signerCompany: order.client } })} className="mt-2 w-full rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50">Guardar firma</button></section>)}
          <section className="flex flex-wrap gap-2 pt-1">
            {onEdit && <button onClick={() => onEdit(order)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400"><Pencil className="h-4 w-4" /> Editar orden</button>}
            {canAdvance && <button disabled={needSign || needTechnicianSign} onClick={() => onAdvance(order.id, next)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Marcar {next}</button>}
            {needTechnicianSign && <span className="self-center text-xs font-medium text-amber-600">Guarda la firma técnica para completar.</span>}
            {needSign && <button onClick={() => setNoSignOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"><AlertTriangle className="h-4 w-4" /> Aprobar sin firma</button>}
            {next === "Aprobada" && !ger && <span className="self-center text-xs text-slate-400">La aprobación corresponde a Gerencia.</span>}
            {next === "Facturada" && !ger && <span className="self-center text-xs text-slate-400">La facturación la realiza Gerencia.</span>}
            {reportReady && <button title="Documento técnico para entregar al cliente, sin costos internos ni cronología administrativa." onClick={() => downloadReport("client")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><FileText className="h-4 w-4" /> Reporte para cliente</button>}
            {ger && reportReady && <button title="Constancia para el cliente que incorpora los importes facturables, sin revelar costos internos ni margen." onClick={() => downloadReport("valued")} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"><DollarSign className="h-4 w-4" /> Constancia valorizada</button>}
            {ger && reportReady && <button title="Informe administrativo completo con cronología, costos internos, márgenes y datos de gestión." onClick={() => downloadReport("internal")} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"><FileText className="h-4 w-4" /> Informe interno</button>}
            {ger && onExport && <button onClick={() => onExport(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Download className="h-4 w-4" /> Exportar</button>}
            {ger && onDuplicate && <button onClick={() => onDuplicate(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Copy className="h-4 w-4" /> Duplicar</button>}
            {ger && onCreateTask && <button onClick={() => onCreateTask(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Link2 className="h-4 w-4" /> Crear tarea</button>}
            {ger && onDelete && <button onClick={() => onDelete(order.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /> Eliminar</button>}
          </section>
          {onComment && <section className="border-t border-slate-100 pt-4"><ActivitySection entity={order} onSend={(text) => onComment(order.id, text)} /></section>}
        </div>
      </div>
      {zoom && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4" onClick={(e) => { e.stopPropagation(); setZoom(null); }}><img src={zoom.url} alt={zoom.cat} className="max-h-[90vh] max-w-full rounded-lg" /><button className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white"><X className="h-5 w-5" /></button></div>}
      {noSignOpen && <ReasonDialog onClose={() => setNoSignOpen(false)} onConfirm={(reason) => { onUpdate(order.id, { status: "Aprobada", noSignReason: reason }); setNoSignOpen(false); }} />}
    </div>
  );
}

function OrderEditDialog({ order, clients, users, parts, budgets = [], projects = [], onClose, onSave }) {
  const hydrateMaterial = (material) => {
    const part = parts.find((item) => (material.partId && item.id === material.partId) || item.name === material.name);
    if (!part) return { ...material };
    const quantity = part.unit === "u" ? Math.max(1, Math.round(Number(material.qty) || 1)) : material.qty;
    return { ...material, partId: part.id, name: part.name, unit: part.unit || material.unit, qty: quantity, price: wholeMoney(part.price), cost: wholeMoney(part.cost), partNumber: material.partNumber || part.partNumber || "", brand: material.brand || part.brand || "", model: material.model || part.model || "", supplier: material.supplier || part.supplier || "" };
  };
  const [form, setForm] = useState(() => ({ ...order, rate: normalizedRate(order.rate), laborCost: wholeMoney(order.laborCost), technical: { ...(order.technical || {}) }, materials: (order.materials || []).map(hydrateMaterial) }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const availableBudgets = budgets.filter((budget) => ["Aprobado", "Facturado"].includes(budget.stage) && (!form.client || budget.client === form.client || budget.clientId === clients.find((client) => client.name === form.client)?.id));
  const selectBudget = (budgetId) => {
    const budget = budgets.find((item) => item.id === budgetId);
    if (!budget) { set({ budgetId: "", budgetNumber: "", projectId: "", quoteNumber: "", customerPO: "" }); return; }
    set({ budgetId: budget.id, budgetNumber: budget.number || budget.id, projectId: budget.projectId || "", quoteNumber: budget.number || budget.id, customerPO: budget.purchaseOrderNumber || "", client: budget.client || form.client, site: budget.site || form.site, contact: budget.contact || form.contact, service: budget.service || form.service });
  };
  const setTechnical = (field, value) => { setSaveError(""); setForm((current) => ({ ...current, technical: { ...current.technical, [field]: value } })); };
  const setMaterial = (index, patch) => setForm((current) => ({ ...current, materials: current.materials.map((material, materialIndex) => materialIndex === index ? { ...material, ...patch } : material) }));
  const selectInventoryMaterial = (index, name) => {
    const part = parts.find((item) => item.name === name);
    if (!part) { setMaterial(index, { name, partId: null }); return; }
    setMaterial(index, { name: part.name, partId: part.id, unit: part.unit, qty: part.unit === "u" ? Math.max(1, Math.round(Number(form.materials[index]?.qty) || 1)) : (form.materials[index]?.qty || 1), price: wholeMoney(part.price), cost: wholeMoney(part.cost), partNumber: part.partNumber || "", brand: part.brand || "", model: part.model || "", supplier: part.supplier || "" });
  };
  const removeMaterial = (index) => setForm((current) => ({ ...current, materials: current.materials.filter((_, materialIndex) => materialIndex !== index) }));
  const addMaterial = () => setForm((current) => ({ ...current, materials: [...current.materials, { name: "", qty: 1, price: 0, cost: 0, billable: true }] }));
  const save = async () => {
    setSaveError("");
    if (!form.client?.trim() || !form.site?.trim()) return;
    const timeFieldsChanged = ["reportedAt", "arrivalAt", "startedAt", "completedAt"].some((field) => (form.technical[field] || "") !== (order.technical?.[field] || ""));
    const timelineChanged = timeFieldsChanged || ["billableWaitMinutes", "billableWaitReason", "downtimeMinutes"].some((field) => (form.technical[field] || "") !== (order.technical?.[field] || ""));
    const timelineReasonUpdated = !!form.technical.timelineAdjustmentReason?.trim() && form.technical.timelineAdjustmentReason.trim() !== (order.technical?.timelineAdjustmentReason || "").trim();
    if (timelineChanged && !timelineReasonUpdated) { setSaveError("Escribe un nuevo motivo para conservar la trazabilidad de la corrección."); return; }
    const chronologyErrors = timelineErrors(form.technical);
    if (chronologyErrors.length) { setSaveError(chronologyErrors.join(" ")); return; }
    setSaving(true);
    const technical = { ...form.technical, signerCompany: form.client.trim() };
    if (timeFieldsChanged && technical.startedAt) technical.workSessions = [{ start: technical.startedAt, end: technical.completedAt || null }];
    const adjustedLaborHours = timeFieldsChanged ? round2(timelineWorkMs(technical, technical.completedAt ? new Date(technical.completedAt).getTime() : Date.now()) / 3600000) : (Number(form.laborHours) || 0);
    const patch = {
      client: form.client.trim(), site: form.site.trim(), contact: form.contact?.trim() || "", tech: form.tech?.trim() || "", budgetId: form.budgetId || "", budgetNumber: form.budgetNumber || form.quoteNumber?.trim() || "", projectId: form.projectId || "", quoteNumber: form.quoteNumber?.trim() || "", customerPO: form.customerPO?.trim() || "",
      service: form.service, date: form.date, status: form.status, equipo: form.equipo?.trim() || "", sintoma: form.sintoma?.trim() || "",
      solucion: form.solucion?.trim() || "", category: form.category?.trim() || "", technical, currency: "USD",
      laborHours: adjustedLaborHours, technicians: Number(form.technicians) || 1, rate: normalizedRate(form.rate),
      laborCost: wholeMoney(form.laborCost), laborBillable: form.laborBillable !== false,
      materials: form.materials.map((material) => ({ ...material, name: material.name?.trim() || "", qty: material.unit === "u" ? Math.max(1, Math.round(Number(material.qty) || 1)) : (Number(material.qty) || 0), price: wholeMoney(material.price), cost: wholeMoney(material.cost), billable: material.billable !== false })),
    };
    await onSave(patch); setSaving(false);
  };
  const fieldTechs = users.filter((user) => user.active && user.role === "tecnico");
  const timelineChanged = ["reportedAt", "arrivalAt", "startedAt", "completedAt", "billableWaitMinutes", "billableWaitReason", "downtimeMinutes"].some((field) => (form.technical[field] || "") !== (order.technical?.[field] || ""));
  const timelineReasonUpdated = !!form.technical.timelineAdjustmentReason?.trim() && form.technical.timelineAdjustmentReason.trim() !== (order.technical?.timelineAdjustmentReason || "").trim();
  return (
    <div className="motion-backdrop fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/60 sm:items-center sm:p-4" onClick={onClose}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl sm:p-5" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Editar {order.id}</h2><p className="mt-0.5 text-xs text-slate-500">Edición administrativa completa · importes expresados en USD.</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="space-y-5">
          <section className="rounded-xl border border-sky-200 bg-sky-50/60 p-4"><div className="mb-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-sky-700">Vinculación comercial</h3><p className="mt-1 text-[11px] text-slate-500">Selecciona el presupuesto para incorporar automáticamente su número, OC, cliente y proyecto.</p></div><L label="Presupuesto aprobado / facturado"><select value={form.budgetId || ""} onChange={(event) => selectBudget(event.target.value)} className="u-input bg-white"><option value="">Sin presupuesto asociado</option>{availableBudgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.number || budget.id} · {budget.client} · {budget.title}</option>)}</select></L><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"><div className="rounded-lg border border-sky-100 bg-white p-3"><span className="block text-[10px] text-slate-400">N° de presupuesto</span><b className="mt-1 block text-xs text-slate-700">{form.quoteNumber || "Sin asignar"}</b></div><div className="rounded-lg border border-sky-100 bg-white p-3"><span className="block text-[10px] text-slate-400">OC del cliente</span><b className="mt-1 block text-xs text-slate-700">{form.customerPO || "Sin asignar"}</b></div><div className="rounded-lg border border-sky-100 bg-white p-3"><span className="block text-[10px] text-slate-400">Proyecto vinculado</span><b className="mt-1 block truncate text-xs text-slate-700">{projects.find((project) => project.id === form.projectId)?.key || "Sin proyecto"}</b></div></div></section>
          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Cliente y servicio</h3><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><L label="Cliente *"><input list="edit-order-clients" value={form.client || ""} onChange={(event) => { const client = clients.find((item) => item.name === event.target.value); set({ client: event.target.value, ...(client ? { site: client.site || form.site } : {}) }); }} className="u-input" /><datalist id="edit-order-clients">{clients.map((client) => <option key={client.id} value={client.name} />)}</datalist></L><L label="Sitio *"><input value={form.site || ""} onChange={(event) => set({ site: event.target.value })} className="u-input" /></L><L label="Contacto"><input value={form.contact || ""} onChange={(event) => set({ contact: event.target.value })} className="u-input" /></L><L label="Técnico de campo"><input list="edit-order-techs" value={form.tech || ""} onChange={(event) => set({ tech: event.target.value })} className="u-input" /><datalist id="edit-order-techs">{fieldTechs.map((user) => <option key={user.id} value={user.name} />)}</datalist></L><L label="Tipo de servicio"><select value={form.service || SERVICE_TYPES[0]} onChange={(event) => set({ service: event.target.value })} className="u-input">{SERVICE_TYPES.map((service) => <option key={service}>{service}</option>)}</select></L><L label="Fecha"><input type="date" value={form.date || ""} onChange={(event) => set({ date: event.target.value })} className="u-input" /></L><L label="Estado"><select value={form.status || O_STATUS[0]} onChange={(event) => set({ status: event.target.value })} className="u-input">{O_STATUS.map((status) => <option key={status}>{status}</option>)}</select></L><L label="Clasificación"><input value={form.category || ""} onChange={(event) => set({ category: event.target.value })} className="u-input" /></L></div></section>

          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Trabajo realizado</h3><div className="space-y-2"><input value={form.equipo || ""} onChange={(event) => set({ equipo: event.target.value })} placeholder="Equipo o sistema intervenido" className="u-input" /><textarea value={form.sintoma || ""} onChange={(event) => set({ sintoma: event.target.value })} rows={2} placeholder="Síntoma o falla reportada" className="u-input resize-none" /><textarea value={form.solucion || ""} onChange={(event) => set({ solucion: event.target.value })} rows={3} placeholder="Intervención y solución" className="u-input resize-none" /></div></section>

          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Ficha técnica</h3><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><L label="TAG"><input value={form.technical.assetTag || ""} onChange={(event) => setTechnical("assetTag", event.target.value)} className="u-input" /></L><L label="Fabricante"><input value={form.technical.manufacturer || ""} onChange={(event) => setTechnical("manufacturer", event.target.value)} className="u-input" /></L><L label="Modelo"><input value={form.technical.model || ""} onChange={(event) => setTechnical("model", event.target.value)} className="u-input" /></L><L label="N° de serie"><input value={form.technical.serial || ""} onChange={(event) => setTechnical("serial", event.target.value)} className="u-input" /></L></div><div className="mt-2 space-y-2"><textarea value={form.technical.diagnosis || ""} onChange={(event) => setTechnical("diagnosis", event.target.value)} rows={2} placeholder="Diagnóstico" className="u-input resize-none" /><textarea value={form.technical.rootCause || ""} onChange={(event) => setTechnical("rootCause", event.target.value)} rows={2} placeholder="Causa raíz" className="u-input resize-none" /><textarea value={form.technical.testsPerformed || ""} onChange={(event) => setTechnical("testsPerformed", event.target.value)} rows={2} placeholder="Pruebas realizadas" className="u-input resize-none" /><textarea value={form.technical.testResult || ""} onChange={(event) => setTechnical("testResult", event.target.value)} rows={2} placeholder="Resultado de pruebas" className="u-input resize-none" /><textarea value={form.technical.recommendations || ""} onChange={(event) => setTechnical("recommendations", event.target.value)} rows={2} placeholder="Recomendaciones" className="u-input resize-none" /><textarea value={form.technical.pendingActions || ""} onChange={(event) => setTechnical("pendingActions", event.target.value)} rows={2} placeholder="Acciones pendientes" className="u-input resize-none" /><textarea value={form.technical.internalNotes || ""} onChange={(event) => setTechnical("internalNotes", event.target.value)} rows={2} placeholder="Notas internas" className="u-input resize-none" /></div></section>

          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Cronología · corrección administrativa</h3><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><L label="Aviso recibido"><input type="datetime-local" value={dateTimeLocalValue(form.technical.reportedAt)} onChange={(event) => setTechnical("reportedAt", isoFromLocal(event.target.value))} className="u-input" /></L><L label="Llegada al sitio"><input type="datetime-local" value={dateTimeLocalValue(form.technical.arrivalAt)} onChange={(event) => setTechnical("arrivalAt", isoFromLocal(event.target.value))} className="u-input" /></L><L label="Inicio de intervención"><input type="datetime-local" value={dateTimeLocalValue(form.technical.startedAt)} onChange={(event) => setTechnical("startedAt", isoFromLocal(event.target.value))} className="u-input" /></L><L label="Finalización"><input type="datetime-local" value={dateTimeLocalValue(form.technical.completedAt)} onChange={(event) => setTechnical("completedAt", isoFromLocal(event.target.value))} className="u-input" /></L><L label="Espera por condiciones del sitio (minutos)"><input type="number" min="0" step="1" value={form.technical.billableWaitMinutes || ""} onChange={(event) => setTechnical("billableWaitMinutes", Math.max(0, Math.round(Number(event.target.value) || 0)))} className="u-input" /></L><L label="Parada productiva informada (minutos, independiente de la visita)"><input type="number" min="0" step="1" value={form.technical.downtimeMinutes || ""} onChange={(event) => setTechnical("downtimeMinutes", Math.max(0, Math.round(Number(event.target.value) || 0)))} className="u-input" /></L></div>{(Number(form.technical.billableWaitMinutes) || 0) > 0 && <L label="Motivo de la espera"><input value={form.technical.billableWaitReason || ""} onChange={(event) => setTechnical("billableWaitReason", event.target.value)} placeholder="Autorización, acceso o disponibilidad del equipo" className="u-input mt-2" /></L>}<L label="Motivo de la corrección"><input value={form.technical.timelineAdjustmentReason || ""} onChange={(event) => setTechnical("timelineAdjustmentReason", event.target.value)} placeholder="Obligatorio y diferente al motivo anterior" className={`u-input mt-2 ${timelineChanged && !timelineReasonUpdated ? "border-amber-400" : ""}`} /></L>{timelineChanged && !timelineReasonUpdated && <p className="mt-1 text-[11px] text-amber-600">Escribe un nuevo motivo para conservar la trazabilidad de esta corrección.</p>}{saveError && <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{saveError}</div>}</section>

          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Gestión interna</h3>{form.service === "Garantía" && <L label="Cobertura y vigencia de garantía"><input value={form.technical.warranty || ""} onChange={(event) => setTechnical("warranty", event.target.value)} className="u-input" /></L>}<div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"><L label="Recurrencia"><select value={form.technical.recurrence || ""} onChange={(event) => setTechnical("recurrence", event.target.value)} className="u-input"><option value="">Seleccionar</option><option>Primera intervención</option><option>Recurrente</option><option>Seguimiento programado</option></select></L><L label="Próxima acción"><select value={form.technical.internalDisposition || ""} onChange={(event) => setTechnical("internalDisposition", event.target.value)} className="u-input"><option value="">Sin acción definida</option><option>Seguimiento técnico</option><option>Cotizar mejora o repuesto</option><option>Esperar repuesto</option><option>Escalar a ingeniería</option><option>Cerrar sin seguimiento</option></select></L><L label="Responsable interno"><input value={form.technical.internalOwner || ""} onChange={(event) => setTechnical("internalOwner", event.target.value)} className="u-input" /></L></div></section>

          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Mano de obra · USD</h3><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><L label="Horas en planta"><input type="number" min="0" step="0.5" value={form.laborHours ?? ""} onChange={(event) => set({ laborHours: event.target.value })} className="u-input" /></L><L label="Técnicos en planta"><input type="number" min="1" step="1" value={form.technicians ?? 1} onChange={(event) => set({ technicians: event.target.value })} onBlur={(event) => set({ technicians: Math.max(1, Math.round(Number(event.target.value) || 1)) })} className="u-input" /></L><L label="Tarifa/h por técnico (USD)"><input type="number" min="0" step="1" value={form.rate ?? DEFAULT_RATE} onChange={(event) => set({ rate: event.target.value })} onBlur={(event) => set({ rate: normalizedRate(event.target.value) })} className="u-input" /></L><L label="Costo interno/h por técnico (USD)"><input type="number" min="0" step="1" value={form.laborCost ?? 0} onChange={(event) => set({ laborCost: event.target.value })} onBlur={(event) => set({ laborCost: wholeMoney(event.target.value) })} className="u-input" /></L></div><p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">Cálculo: {form.laborHours || 0} h × {form.technicians || 1} técnico(s) × {money(form.rate)} = <b>{money((Number(form.laborHours) || 0) * (Number(form.technicians) || 1) * (Number(form.rate) || 0))}</b></p><label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={form.laborBillable !== false} onChange={(event) => set({ laborBillable: event.target.checked })} /> Mano de obra facturable</label></section>

          <section><div className="mb-2 flex items-center justify-between"><div><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Materiales · USD</h3><p className="mt-0.5 text-[11px] text-slate-500">Venta y costo interno se cargan automáticamente desde Inventario.</p></div><button onClick={addMaterial} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600"><Plus className="h-3.5 w-3.5" /> Material</button></div><datalist id="edit-order-parts">{parts.map((part) => <option key={part.id} value={part.name} />)}</datalist><div className="hidden grid-cols-[minmax(0,1fr)_5rem_7rem_7rem_auto] gap-2 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:grid"><span>Inventario</span><span>Cant.</span><span>Venta USD<br />con adicional</span><span>Costo interno<br />USD</span><span /></div><div className="space-y-2">{form.materials.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-5 text-center text-xs text-slate-400">Sin materiales.</div>}{form.materials.map((material, index) => <div key={index} className="rounded-lg border border-slate-200 p-2.5"><div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_7rem_7rem_auto]"><input list="edit-order-parts" value={material.name || ""} onChange={(event) => selectInventoryMaterial(index, event.target.value)} placeholder="Buscar en inventario" className="u-input col-span-2 sm:col-span-1" /><input type="number" min={material.unit === "u" ? 1 : 0} step={material.unit === "u" ? 1 : 0.1} value={material.qty ?? 1} onChange={(event) => setMaterial(index, { qty: event.target.value })} onBlur={(event) => material.unit === "u" && setMaterial(index, { qty: Math.max(1, Math.round(Number(event.target.value) || 1)) })} placeholder="Cant." aria-label="Cantidad" className="u-input" /><input type="number" min="0" step="1" value={material.price ?? 0} onChange={(event) => setMaterial(index, { price: event.target.value })} onBlur={(event) => setMaterial(index, { price: wholeMoney(event.target.value) })} placeholder="Venta USD" aria-label="Venta unitaria en USD con adicional" className="u-input" /><input type="number" min="0" step="1" value={material.cost ?? 0} onChange={(event) => setMaterial(index, { cost: event.target.value })} onBlur={(event) => setMaterial(index, { cost: wholeMoney(event.target.value) })} placeholder="Costo USD" aria-label="Costo interno unitario en USD" className="u-input" /><button onClick={() => removeMaterial(index)} aria-label="Quitar material" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button></div><div className="mt-2 flex flex-wrap items-center gap-3"><label className="inline-flex items-center gap-2 text-[11px] text-slate-500"><input type="checkbox" checked={material.billable !== false} onChange={(event) => setMaterial(index, { billable: event.target.checked })} /> Facturable</label>{material.partId && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Vinculado al inventario</span>}</div></div>)}</div></section>
        </div>
        <div className="sticky bottom-0 -mx-4 mt-5 flex gap-2 border-t border-slate-100 bg-white px-4 pt-4 sm:-mx-5 sm:px-5"><button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button onClick={save} disabled={saving || !form.client?.trim() || !form.site?.trim() || (timelineChanged && !timelineReasonUpdated)} className="flex-1 rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? "Guardando…" : "Guardar cambios"}</button></div>
      </div>
    </div>
  );
}

function ReasonDialog({ onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/60 sm:items-center sm:p-4" onClick={(e) => { e.stopPropagation(); onClose(); }}><div className="mobile-sheet-content w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}><div className="mb-4 flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600"><AlertTriangle className="h-5 w-5" /></span><div><h2 className="text-lg font-semibold text-slate-900">Aprobar sin firma</h2><p className="mt-1 text-xs text-slate-500">Registrá el motivo para mantener la trazabilidad de la orden.</p></div></div><L label="Motivo"><textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. Cliente ausente; conformidad recibida por teléfono" className="u-input resize-none" /></L><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())} className="rounded-lg bg-amber-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Aprobar</button></div></div></div>;
}

/* ===================================== ÓRDENES: NUEVA ===================================== */
function NewOrder({ ger, me, clients, parts = [], knownOrders = [], online = true, prefill = null, onSave, onCancel, onDeleted }) {
  const draft = useMemo(() => loadOrderDraft(me.id), [me.id]);
  const initial = prefill || draft || {};
  const [currentOrderId, setCurrentOrderId] = useState(initial.existingOrderId || "");
  useEffect(() => {
    if (!online || !currentOrderId.startsWith("PEND-")) return;
    const serverId = resolveSyncedOrderId(currentOrderId, true);
    if (serverId) setCurrentOrderId(serverId);
  }, [online, currentOrderId, knownOrders]);
  useEffect(() => {
    if (!online || !currentOrderId || currentOrderId.startsWith("PEND-") || knownOrders.some((order) => order.id === currentOrderId)) return;
    clearOrderDraft(me.id);
    onDeleted?.(currentOrderId);
  }, [online, currentOrderId, knownOrders, me.id, onDeleted]);
  const [step, setStep] = useState(initial.step || 0);
  const [clientMode, setClientMode] = useState(initial.clientMode || "existing");
  const [clientId, setClientId] = useState(initial.clientId || clients[0]?.id || "");
  const [newClient, setNewClient] = useState(initial.newClient || { name: "", site: "" });
  const [contact, setContact] = useState(initial.contact || ""); const [tech, setTech] = useState(initial.tech || me.name);
  const [quoteNumber, setQuoteNumber] = useState(initial.quoteNumber || ""); const [customerPO, setCustomerPO] = useState(initial.customerPO || "");
  const [service, setService] = useState(initial.service || "Mantenimiento preventivo");
  const [equipo, setEquipo] = useState(initial.equipo || ""); const [sintoma, setSintoma] = useState(initial.sintoma || ""); const [solucion, setSolucion] = useState(initial.solucion || ""); const [category, setCategory] = useState(initial.category || "");
  const [linkedBudgetId] = useState(initial.budgetId || ""); const [linkedBudgetNumber] = useState(initial.budgetNumber || initial.quoteNumber || ""); const [linkedProjectId] = useState(initial.projectId || "");
  const [technical, setTechnical] = useState(() => ({ ...EMPTY_TECHNICAL, ...(initial.technical || {}), reportedAt: initial.technical?.reportedAt || new Date().toISOString() }));
  const setTechnicalField = (field, value) => setTechnical((current) => ({ ...current, [field]: value }));
  const [signerRoleChoice, setSignerRoleChoice] = useState(() => SIGNER_ROLES.includes(initial.technical?.signerRole) ? initial.technical.signerRole : (initial.technical?.signerRole ? "Otro" : ""));
  const [photos, setPhotos] = useState(initial.photos || []); const [analyzing, setAnalyzing] = useState(false);
  const [rate, setRate] = useState(normalizedRate(initial.rate)); const [laborHours, setLaborHours] = useState(initial.laborHours || ""); const [technicians, setTechnicians] = useState(initial.technicians || 1); const [laborBillable, setLaborBillable] = useState(initial.laborBillable ?? true);
  const [materials, setMaterials] = useState(initial.materials || []); const [location, setLocation] = useState(initial.location || null); const [geoMsg, setGeoMsg] = useState("");
  const [siteLabel, setSiteLabel] = useState(initial.siteLabel || initial.location?.label || clients.find((c) => c.id === (initial.clientId || clients[0]?.id))?.site || "");
  const [signatureUrl, setSignatureUrl] = useState(initial.signatureUrl || null); const [signedBy, setSignedBy] = useState(initial.signedBy || "");
  const [technicianSignatureUrl, setTechnicianSignatureUrl] = useState(initial.technicianSignatureUrl || null);
  const [noSignReason, setNoSignReason] = useState(initial.noSignReason || "");
  const [saving, setSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState(!!(draft || prefill));
  const activeWork = (technical.workSessions || []).some((session) => !session.end);
  const [timelineNow, setTimelineNow] = useState(Date.now());
  useEffect(() => { if (!activeWork) return; const timer = setInterval(() => setTimelineNow(Date.now()), 30000); return () => clearInterval(timer); }, [activeWork]);
  const elapsedWorkMs = timelineWorkMs(technical, timelineNow);
  const automaticLaborHours = technical.startedAt ? round2(elapsedWorkMs / 3600000) : (Number(laborHours) || 0);
  const projectedBillableHours = billableLaborHours({ laborHours: automaticLaborHours, technical }, timelineNow);
  const onSiteElapsedMs = technical.arrivalAt ? Math.max(0, (technical.completedAt ? new Date(technical.completedAt).getTime() : timelineNow) - new Date(technical.arrivalAt).getTime()) : 0;
  const minimumBillingApplied = onSiteElapsedMs > 0 && onSiteElapsedMs < 3600000;
  useEffect(() => { if (technical.startedAt) setLaborHours(round2(elapsedWorkMs / 3600000)); }, [technical.startedAt, technical.completedAt, technical.workSessions, timelineNow]);
  const profile = SERVICE_PROFILES[service] || SERVICE_PROFILES["Mantenimiento correctivo"];
  const timelineAction = (action) => {
    const now = new Date().toISOString();
    const next = { ...technical, workSessions: [...(technical.workSessions || [])] };
    if (action === "arrival") next.arrivalAt = next.arrivalAt || now;
    if (action === "start" || action === "resume" || action === "reopen") {
      next.arrivalAt = next.arrivalAt || now; next.startedAt = next.startedAt || now; next.completedAt = "";
      if (!next.workSessions.some((session) => !session.end)) next.workSessions.push({ start: now, end: null });
    }
    if (action === "pause" || action === "finish") next.workSessions = next.workSessions.map((session) => !session.end ? { ...session, end: now } : session);
    if (action === "finish") next.completedAt = now;
    setTechnical(next);
    if (action === "reopen") setStep(2);
    if (action === "finish") setStep(3);
    setTimelineNow(Date.now());
    if (["start", "resume", "reopen", "pause", "finish"].includes(action)) void save("En proceso de ejecución", { stayOpen: true, technicalOverride: next });
  };
  const addPhoto = async (file, cat) => { if (!file) return; setAnalyzing(true); try { const { analysis, report, thumb } = await fileToImages(file); setPhotos((p) => [...p, { url: report, preview: thumb, cat, ts: new Date().toISOString() }]); try { const r = await analyzeImage(analysis); if (!equipo && r.equipo) setEquipo(r.equipo); if (!category && r.category) setCategory(r.category); if (!solucion && r.description) setSolucion(r.description); } catch {} } finally { setAnalyzing(false); } };
  const addMaterial = () => setMaterials((m) => [...m, { name: "", qty: 1, price: 0, cost: 0, billable: true, partNumber: "", brand: "", model: "", serial: "", supplier: "" }]);
  const setMat = (i, patch) => setMaterials((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const delMat = (i) => setMaterials((m) => m.filter((_, j) => j !== i));
  const client = clientMode === "existing" ? clients.find((c) => c.id === clientId) : { name: newClient.name, site: newClient.site };
  const captureLocation = () => {
    if (!navigator.geolocation) { setGeoMsg("La ubicación no está disponible en este dispositivo."); return; }
    setGeoMsg("Obteniendo ubicación…");
    navigator.geolocation.getCurrentPosition((pos) => {
      const label = siteLabel.trim() || client?.site?.trim() || `Sitio de ${client?.name || "servicio"}`;
      setSiteLabel(label);
      setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, label });
      setGeoMsg("");
    }, () => setGeoMsg("No se pudo acceder a la ubicación. Revisá el permiso del navegador."), { timeout: 8000 });
  };
  const clientCode = clientMode === "existing" ? (client?.code || "—") : "auto";
  const folioPreview = `OT-${clientCode}-${new Date().getFullYear()}-###`;
  const preview = orderTotals({ laborHours: automaticLaborHours, billableHours: projectedBillableHours, technicians, rate, laborBillable, materials, technical });
  const chronologyErrors = timelineErrors(technical, timelineNow);
  const canStartOrder = !!client?.name && !!siteLabel.trim() && !!(equipo || technical.assetTag);
  const canSave = client && client.name && (laborHours || materials.length || solucion);
  const canComplete = canSave && chronologyErrors.length === 0 && !!technicianSignatureUrl && (!!signatureUrl || !!noSignReason.trim());
  const steps = ["Activo", profile.assess, profile.work, "Cierre"];
  const stepReady = step === 0 ? !!client?.name && !!siteLabel.trim() && !!(equipo || technical.assetTag) : step === 1 ? !!(sintoma || technical.diagnosis || photos.length) : step === 2 ? !!solucion && !!technical.completedAt : canComplete;
  useEffect(() => {
    const timer = setTimeout(() => { saveOrderDraft(me.id, { existingOrderId: currentOrderId, step, clientMode, clientId, newClient, siteLabel, contact, tech, quoteNumber, customerPO, service, equipo, sintoma, solucion, category, technical, rate, laborHours, technicians, laborBillable, materials, location, budgetId: linkedBudgetId, budgetNumber: linkedBudgetNumber, projectId: linkedProjectId }); setDraftSaved(true); }, 500);
    setDraftSaved(false); return () => clearTimeout(timer);
  }, [me.id, currentOrderId, step, clientMode, clientId, newClient, siteLabel, contact, tech, quoteNumber, customerPO, service, equipo, sintoma, solucion, category, technical, rate, laborHours, technicians, laborBillable, materials, location]);
  const save = async (status, { stayOpen = false, technicalOverride = technical } = {}) => {
    setSaving(true);
    const resolvedSite = siteLabel.trim() || client.site || "";
    const savedLocation = location ? { ...location, label: resolvedSite } : null;
    const completionStamp = new Date().toISOString();
    const timelineHours = technicalOverride.startedAt ? round2(timelineWorkMs(technicalOverride, Date.now()) / 3600000) : automaticLaborHours;
    const o = { client: client.name, site: resolvedSite, contact, tech, quoteNumber: quoteNumber.trim(), customerPO: customerPO.trim(), budgetId: linkedBudgetId, budgetNumber: linkedBudgetNumber, projectId: linkedProjectId, service, date: todayStr(), createdAt: completionStamp, equipo, sintoma, solucion, category, technical: { ...technicalOverride, signerCompany: client.name, downtimeMinutes: Number(technicalOverride.downtimeMinutes) || 0, billableWaitMinutes: Number(technicalOverride.billableWaitMinutes) || 0 }, location: savedLocation, photos, signatureUrl, signedAt: signatureUrl ? completionStamp : null, signedBy, noSignReason: signatureUrl ? "" : noSignReason.trim(), technicianSignatureUrl, technicianSignedAt: technicianSignatureUrl ? completionStamp : null, technicianSignedBy: tech || me.name, laborHours: timelineHours, billableHours: projectedBillableHours, technicians: Math.max(1, Math.round(Number(technicians) || 1)), rate: normalizedRate(rate), currency: "USD", laborBillable, materials: materials.map((m) => ({ ...m, qty: m.unit === "u" ? Math.max(1, Math.round(Number(m.qty) || 1)) : (Number(m.qty) || 0), price: wholeMoney(m.price), cost: wholeMoney(m.cost) })), status };
    if (clientMode === "new" && newClient.name) o._newClient = { id: "c" + Date.now(), name: newClient.name, site: resolvedSite };
    const saved = await onSave(o, currentOrderId, { stayOpen });
    if (saved?.id && !currentOrderId) setCurrentOrderId(saved.id);
    if (saved && !stayOpen) clearOrderDraft(me.id);
    setSaving(false);
    return saved;
  };
  return (
    <div className="min-h-screen bg-slate-100" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-ink-900 text-slate-100"><div className="mx-auto max-w-lg px-3 py-3 sm:px-4"><div className="flex items-center gap-3"><button onClick={onCancel} aria-label="Volver" className="grid h-10 w-10 place-items-center rounded-lg text-slate-300 hover:bg-ink-800"><ChevronLeft className="h-5 w-5" /></button><div className="min-w-0 flex-1 leading-tight"><div className="text-sm font-semibold">{currentOrderId ? `Continuar ${currentOrderId}` : "Nueva orden"} · {steps[step]}</div><div className="font-mono text-[11px] text-brand-400">{currentOrderId || folioPreview}</div></div><span className={`text-[11px] ${draftSaved ? "text-emerald-400" : "text-slate-400"}`}>{draftSaved ? "Guardado" : "Guardando…"}</span></div><div className="mt-3 grid grid-cols-4 gap-1">{steps.map((label, index) => <button key={label} onClick={() => index <= step && setStep(index)} className="text-left" aria-label={`Paso ${index + 1}: ${label}`}><span className={`block h-1.5 rounded-full ${index <= step ? "bg-brand-500" : "bg-slate-700"}`} /><span className={`mt-1 block truncate text-[9px] ${index === step ? "text-white" : "text-slate-500"}`}>{label}</span></button>)}</div></div></header>
      <main className="mx-auto max-w-lg space-y-4 px-3 py-4 pb-40 sm:px-4 sm:py-5 sm:pb-32">
        {currentOrderId && <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-700"><ClipboardList className="mt-0.5 h-4 w-4 shrink-0" /><span>Continuando la orden <b>{currentOrderId}</b>. Los cambios actualizarán el mismo registro.</span></div>}
        {prefill && !prefill.existingOrderId && <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700"><FileText className="mt-0.5 h-4 w-4 shrink-0" /><span>Orden vinculada al presupuesto <b>{linkedBudgetNumber}</b>. Cliente, sitio, servicio y OC fueron precargados.</span></div>}
        {!prefill && draft && <div className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-xs text-brand-700"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />Recuperamos el borrador guardado en {deviceLabel()}.</div>}
        <ServiceTimeline technical={technical} active={activeWork} elapsedMs={elapsedWorkMs} billableHours={projectedBillableHours} minimumApplied={minimumBillingApplied} showBilling={ger} technicians={technicians} errors={chronologyErrors} disabled={saving} onAction={timelineAction} onDowntime={(value) => setTechnicalField("downtimeMinutes", value)} onBillableWait={(value) => setTechnicalField("billableWaitMinutes", value)} onBillableWaitReason={(value) => setTechnicalField("billableWaitReason", value)} />
        <div key={step} className="motion-step space-y-4">
        {step === 0 && (<>
        <Section title="Cliente y sitio">
          <div className="mb-2 flex gap-2"><Toggle active={clientMode === "existing"} onClick={() => { setClientMode("existing"); const selected = clients.find((c) => c.id === clientId); setSiteLabel(selected?.site || ""); setLocation(null); }}>Directorio</Toggle><Toggle active={clientMode === "new"} onClick={() => { setClientMode("new"); setSiteLabel(newClient.site || ""); setLocation(null); }}>Cliente nuevo</Toggle></div>
          {clientMode === "existing" ? (<select value={clientId} onChange={(e) => { const nextId = e.target.value; const selected = clients.find((c) => c.id === nextId); setClientId(nextId); setSiteLabel(selected?.site || ""); setLocation(null); }} className="u-input">{clients.map((c) => <option key={c.id} value={c.id}>{c.code ? `[${c.code}] ` : ""}{c.name} — {c.site}</option>)}</select>) : (<input value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} placeholder="Nombre del cliente" className="u-input" />)}
          <label className="mt-2 block text-xs font-medium text-slate-600">Sitio de intervención *</label>
          <input list="known-client-sites" value={siteLabel} onChange={(e) => { const value = e.target.value; setSiteLabel(value); if (clientMode === "new") setNewClient((current) => ({ ...current, site: value })); setLocation((current) => current ? { ...current, label: value } : current); }} placeholder="Buscar un sitio o escribir una etiqueta" className="u-input mt-1" />
          <datalist id="known-client-sites">{clients.filter((c) => c.site).map((c) => <option key={c.id} value={c.site} label={c.name} />)}</datalist>
          <p className="mt-1 text-[11px] text-slate-400">Ej.: Planta Venado Tuerto · Línea 2 · Tablero principal</p>
          <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Persona de contacto (opcional)" className="u-input mt-2" />
          <input value={tech} onChange={(e) => setTech(e.target.value)} placeholder="Técnico responsable" className="u-input mt-2" />
          {ger && <div className="mt-2 grid grid-cols-2 gap-2"><L label="N° de presupuesto"><input value={quoteNumber} onChange={(e) => setQuoteNumber(e.target.value)} placeholder="Opcional" className="u-input" /></L><L label="Orden de compra del cliente"><input value={customerPO} onChange={(e) => setCustomerPO(e.target.value)} placeholder="Opcional" className="u-input" /></L></div>}
          <div className="mt-2 flex flex-wrap items-center gap-2"><button onClick={captureLocation} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><MapPin className="h-3.5 w-3.5" /> Vincular GPS</button>{location && <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">GPS vinculado a “{siteLabel || location.label || "Sitio de intervención"}”</span>}{geoMsg && <span className="text-xs text-slate-500">{geoMsg}</span>}</div>
        </Section>
        <Section title="Tipo de servicio"><div className="flex flex-wrap gap-2">{SERVICE_TYPES.map((s) => (<button key={s} onClick={() => setService(s)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${service === s ? "border-brand-400 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600"}`}>{s}</button>))}</div></Section>
        <Section title="Identificación del activo">
          <input value={equipo} onChange={(e) => setEquipo(e.target.value)} placeholder="Equipo / sistema intervenido *" className="u-input" />
          <div className="mt-2 grid grid-cols-2 gap-2"><L label="TAG del activo"><input value={technical.assetTag} onChange={(e) => setTechnicalField("assetTag", e.target.value)} placeholder="Ej. VFD-L2-03" className="u-input" /></L><L label="Fabricante"><input value={technical.manufacturer} onChange={(e) => setTechnicalField("manufacturer", e.target.value)} className="u-input" /></L><L label="Modelo"><input value={technical.model} onChange={(e) => setTechnicalField("model", e.target.value)} className="u-input" /></L><L label="N° de serie"><input value={technical.serial} onChange={(e) => setTechnicalField("serial", e.target.value)} className="u-input" /></L></div>
        </Section>
        </>)}
        {step === 1 && (
        <Section title="Documentación del trabajo">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500"><Sparkles className="h-3.5 w-3.5 text-brand-500" /> Las fotos autocompletan equipo y descripción con IA</div>
          <div className="grid grid-cols-3 gap-2"><PhotoBtn icon={Camera} label="Antes" cat="antes" capture onPick={addPhoto} /><PhotoBtn icon={Camera} label="Durante" cat="durante" capture onPick={addPhoto} /><PhotoBtn icon={Upload} label="Después" cat="después" onPick={addPhoto} /></div>
          {analyzing && <div className="mt-2 flex items-center gap-2 text-xs text-brand-700"><Loader2 className="h-4 w-4 animate-spin" /> Analizando imagen…</div>}
          {photos.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{photos.map((p, i) => (<div key={i} className="relative"><img src={p.preview || p.url} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-slate-200" /><span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 text-center text-[9px] text-white">{p.cat}</span><button onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 shadow ring-1 ring-slate-200"><X className="h-3 w-3 text-slate-500" /></button></div>))}</div>}
          {category && <div className="mt-2"><Chip className="bg-brand-50 text-brand-700 ring-brand-600/20"><Sparkles className="h-3 w-3" />{category}</Chip></div>}
          <input value={sintoma} onChange={(e) => setSintoma(e.target.value)} placeholder={profile.symptom} className="u-input mt-2" />
          <textarea value={technical.diagnosis} onChange={(e) => setTechnicalField("diagnosis", e.target.value)} rows={3} placeholder={profile.diagnosis} className="u-input mt-2 resize-none" />
          {profile.rootCause && <textarea value={technical.rootCause} onChange={(e) => setTechnicalField("rootCause", e.target.value)} rows={2} placeholder="Causa raíz probable o confirmada" className="u-input mt-2 resize-none" />}
          {profile.installation && <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/50 p-3"><h4 className="text-xs font-semibold text-sky-800">Preparación de la instalación</h4><textarea value={technical.installationScope} onChange={(e) => setTechnicalField("installationScope", e.target.value)} rows={2} placeholder="Alcance, puntos de conexión y entregables" className="u-input mt-2 resize-none bg-white" /><textarea value={technical.requiredDocuments} onChange={(e) => setTechnicalField("requiredDocuments", e.target.value)} rows={2} placeholder="Planos, permisos y documentación disponible" className="u-input mt-2 resize-none bg-white" /></div>}
          {profile.preventive && <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/50 p-3"><h4 className="text-xs font-semibold text-sky-800">Inspección preventiva</h4><textarea value={technical.preventiveChecklist} onChange={(e) => setTechnicalField("preventiveChecklist", e.target.value)} rows={3} placeholder="Ítems inspeccionados y estado inicial" className="u-input mt-2 resize-none bg-white" /><textarea value={technical.wearFindings} onChange={(e) => setTechnicalField("wearFindings", e.target.value)} rows={2} placeholder="Desgaste, anomalías o riesgo de falla" className="u-input mt-2 resize-none bg-white" /></div>}
          {profile.warranty && <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-violet-200 bg-violet-50/50 p-3 sm:grid-cols-2"><L label="Referencia de garantía"><input value={technical.warrantyReference} onChange={(e) => setTechnicalField("warrantyReference", e.target.value)} className="u-input bg-white" /></L><L label="Validación"><select value={technical.warrantyDecision} onChange={(e) => setTechnicalField("warrantyDecision", e.target.value)} className="u-input bg-white"><option value="">Pendiente</option><option>Cubierto</option><option>No cubierto</option><option>Requiere autorización</option></select></L></div>}
          {profile.emergency && <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-rose-200 bg-rose-50/50 p-3 sm:grid-cols-2"><L label="Criticidad"><select value={technical.emergencyPriority} onChange={(e) => setTechnicalField("emergencyPriority", e.target.value)} className="u-input bg-white"><option value="">Seleccionar</option><option>Media</option><option>Alta</option><option>Crítica</option></select></L><L label="Impacto productivo"><input value={technical.productionImpact} onChange={(e) => setTechnicalField("productionImpact", e.target.value)} placeholder="Línea detenida, producción parcial…" className="u-input bg-white" /></L></div>}
        </Section>
        )}
        {step === 2 && (<>
        <Section title="Intervención realizada">
          <textarea value={solucion} onChange={(e) => setSolucion(e.target.value)} rows={4} placeholder="Procedimiento, trabajo realizado y solución aplicada *" className="u-input resize-none" />
          {profile.automation && <><div className="mt-3 grid grid-cols-2 gap-2"><L label="Dispositivo"><input value={technical.deviceType} onChange={(e) => setTechnicalField("deviceType", e.target.value)} placeholder="PLC, HMI, VFD…" className="u-input" /></L><L label="Firmware"><input value={technical.firmware} onChange={(e) => setTechnicalField("firmware", e.target.value)} className="u-input" /></L><L label="Versión de programa"><input value={technical.programVersion} onChange={(e) => setTechnicalField("programVersion", e.target.value)} className="u-input" /></L><L label="Referencia de respaldo"><input value={technical.backupRef} onChange={(e) => setTechnicalField("backupRef", e.target.value)} className="u-input" /></L></div><textarea value={technical.ioVerified} onChange={(e) => setTechnicalField("ioVerified", e.target.value)} rows={2} placeholder="Entradas, salidas y señales verificadas" className="u-input mt-2 resize-none" /><textarea value={technical.alarmsVerified} onChange={(e) => setTechnicalField("alarmsVerified", e.target.value)} rows={2} placeholder="Alarmas e interlocks verificados" className="u-input mt-2 resize-none" /><textarea value={technical.setpointChanges} onChange={(e) => setTechnicalField("setpointChanges", e.target.value)} rows={2} placeholder="Setpoints o parámetros modificados: valor anterior → valor nuevo" className="u-input mt-2 resize-none" /></>}
          {profile.installation && <><textarea value={technical.mountingWiring} onChange={(e) => setTechnicalField("mountingWiring", e.target.value)} rows={2} placeholder="Montaje, conexionado y verificaciones eléctricas" className="u-input mt-2 resize-none" /><textarea value={technical.commissioning} onChange={(e) => setTechnicalField("commissioning", e.target.value)} rows={2} placeholder="Puesta en marcha y criterios de aceptación" className="u-input mt-2 resize-none" /><input value={technical.trainingProvided} onChange={(e) => setTechnicalField("trainingProvided", e.target.value)} placeholder="Capacitación entregada y asistentes" className="u-input mt-2" /></>}
          {profile.preventive && <textarea value={technical.cleaningAdjustments} onChange={(e) => setTechnicalField("cleaningAdjustments", e.target.value)} rows={3} placeholder="Limpieza, lubricación, ajustes y elementos reemplazados" className="u-input mt-2 resize-none" />}
          {profile.emergency && <textarea value={technical.temporaryRestoration} onChange={(e) => setTechnicalField("temporaryRestoration", e.target.value)} rows={2} placeholder="Restablecimiento temporal aplicado y limitaciones" className="u-input mt-2 resize-none" />}
        </Section>
        <Section title="Mano de obra">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Las horas se calculan desde la cronología del servicio. No es necesario operar un cronómetro separado.</p>
          <div className={`mt-2 grid gap-2 ${ger ? "grid-cols-2 min-[430px]:grid-cols-4" : "grid-cols-2"}`}><L label="Tiempo efectivo" help="Tiempo real de intervención, descontando las pausas registradas en la cronología."><div className="u-input flex items-center bg-slate-50 font-medium text-slate-700">{compactDuration(elapsedWorkMs)}</div></L>{ger && <L label="Horas facturables" help="Horas cobradas por técnico. Si la permanencia es menor a una hora, se aplica el mínimo comercial de dos horas."><div className="u-input flex items-center bg-brand-50 font-semibold text-brand-700">{projectedBillableHours} h</div></L>}<L label="Técnicos en planta" help="Cantidad de técnicos que participaron presencialmente. Multiplica las horas facturables para obtener horas-técnico."><input type="number" min="1" step="1" value={technicians} onChange={(e) => setTechnicians(e.target.value)} onBlur={(e) => setTechnicians(Math.max(1, Math.round(Number(e.target.value) || 1)))} className="u-input" /></L>{ger && <L label="Tarifa/h por técnico (USD)" help="Tarifa comercial aplicada a cada hora facturable de cada técnico en planta."><input type="number" min="0" step="1" value={rate} onChange={(e) => setRate(e.target.value)} onBlur={(e) => setRate(normalizedRate(e.target.value))} className="u-input" /></L>}</div>
          {ger && minimumBillingApplied && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">Mínimo aplicado: permanencia menor a 1 hora → se facturan 2 horas por técnico.</p>}
          {ger && <label className="mt-2 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={laborBillable} onChange={(e) => setLaborBillable(e.target.checked)} /> Facturable</label>}
        </Section>
        <Section title="Materiales y repuestos usados">
          <div className="space-y-3">{materials.map((m, i) => (<div key={i} className="rounded-lg border border-slate-200 p-2.5"><div className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_6rem_auto_auto]"><input list="parts-list" value={m.name} onChange={(e) => { const v = e.target.value; const hit = parts.find((p) => p.name === v); setMat(i, hit ? { name: hit.name, partId: hit.id, unit: hit.unit, price: wholeMoney(hit.price), cost: wholeMoney(hit.cost), partNumber: hit.partNumber || "", brand: hit.brand || "", model: hit.model || "", supplier: hit.supplier || "" } : { name: v, partId: null }); }} placeholder="Buscar en inventario" className="u-input col-span-4 min-w-0 sm:col-span-1" /><input type="number" min={m.unit === "u" ? 1 : 0} step={m.unit === "u" ? 1 : 0.1} value={m.qty} onChange={(e) => setMat(i, { qty: e.target.value })} onBlur={(e) => m.unit === "u" && setMat(i, { qty: Math.max(1, Math.round(Number(e.target.value) || 1)) })} className="u-input min-w-0" title="Cantidad" aria-label="Cantidad" placeholder="Cant." />{ger && <input type="number" min="0" step="1" value={m.price} onChange={(e) => setMat(i, { price: e.target.value })} onBlur={(e) => setMat(i, { price: wholeMoney(e.target.value) })} placeholder="Venta USD" aria-label="Venta unitaria en USD con adicional" className="u-input min-w-0" />}{ger && <button onClick={() => setMat(i, { billable: !m.billable })} title={m.billable ? "Material facturable" : "Material no facturable"} aria-label={m.billable ? "Material facturable" : "Material no facturable"} className={`grid h-10 w-10 place-items-center rounded-md ${m.billable ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-300"}`}><DollarSign className="h-4 w-4" /></button>}<button onClick={() => delMat(i)} title="Eliminar material" aria-label="Eliminar material" className="grid h-10 w-10 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button></div><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3"><input value={m.partNumber || ""} onChange={(e) => setMat(i, { partNumber: e.target.value })} placeholder="N° de parte" className="u-input" /><input value={m.brand || ""} onChange={(e) => setMat(i, { brand: e.target.value })} placeholder="Marca" className="u-input" /><input value={m.model || ""} onChange={(e) => setMat(i, { model: e.target.value })} placeholder="Modelo" className="u-input" /><input value={m.serial || ""} onChange={(e) => setMat(i, { serial: e.target.value })} placeholder="N° de serie / lote" className="u-input" /><input value={m.supplier || ""} onChange={(e) => setMat(i, { supplier: e.target.value })} placeholder="Proveedor" className="u-input" />{ger && <input type="number" min="0" step="1" value={m.cost || ""} onChange={(e) => setMat(i, { cost: e.target.value })} onBlur={(e) => setMat(i, { cost: wholeMoney(e.target.value) })} placeholder="Costo interno USD" className="u-input" />}</div>{m.partId && <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Precio tomado del inventario</span>}</div>))}</div>
          <datalist id="parts-list">{parts.map((p) => <option key={p.id} value={p.name} />)}</datalist>
          <button onClick={addMaterial} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-brand-400 hover:text-brand-600"><Plus className="h-3.5 w-3.5" /> Agregar material</button>
          {!ger && <p className="mt-2 text-[11px] text-slate-400">Selecciona el repuesto del inventario. El precio de venta con adicional y el costo interno se asignan automáticamente sin mostrarse al técnico.</p>}
        </Section>
        </>)}
        {step === 3 && (<>
        <Section title="Verificación y estado final"><div className="grid grid-cols-2 gap-2"><L label="Finalización (desde cronología)"><div className="u-input flex items-center bg-slate-50 font-medium text-slate-700">{technical.completedAt ? new Date(technical.completedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "Pendiente de finalizar intervención"}</div></L><L label="Estado del activo"><select value={technical.finalCondition} onChange={(e) => setTechnicalField("finalCondition", e.target.value)} className="u-input"><option>Operativo</option><option>Operativo con restricciones</option><option>Fuera de servicio</option><option>Pendiente de repuesto</option></select></L></div><textarea value={technical.measurementsBefore} onChange={(e) => setTechnicalField("measurementsBefore", e.target.value)} rows={2} placeholder="Mediciones y parámetros antes de intervenir" className="u-input mt-2 resize-none" /><textarea value={technical.measurementsAfter} onChange={(e) => setTechnicalField("measurementsAfter", e.target.value)} rows={2} placeholder="Mediciones y parámetros finales" className="u-input mt-2 resize-none" /><textarea value={technical.testsPerformed} onChange={(e) => setTechnicalField("testsPerformed", e.target.value)} rows={2} placeholder="Pruebas funcionales realizadas" className="u-input mt-2 resize-none" /><textarea value={technical.testResult} onChange={(e) => setTechnicalField("testResult", e.target.value)} rows={2} placeholder="Resultados y criterios de aceptación" className="u-input mt-2 resize-none" /></Section>
        <Section title="Recomendaciones y pendientes"><textarea value={technical.recommendations} onChange={(e) => setTechnicalField("recommendations", e.target.value)} rows={3} placeholder="Recomendación técnica concreta para el cliente" className="u-input resize-none" /><textarea value={technical.pendingActions} onChange={(e) => setTechnicalField("pendingActions", e.target.value)} rows={2} placeholder="Acción pendiente, responsable y fecha comprometida" className="u-input mt-2 resize-none" /><p className="mt-1 text-[11px] text-slate-400">Describe la acción; la prioridad se gestiona únicamente en la información interna.</p><L label={profile.preventive ? "Próximo mantenimiento sugerido" : "Fecha sugerida de seguimiento"}><input type="date" value={technical.followUpDate} onChange={(e) => setTechnicalField("followUpDate", e.target.value)} className="u-input" /></L></Section>
        {ger && profile.warranty && <Section title="Gestión de garantía"><L label="Cobertura y vigencia"><input value={technical.warranty} onChange={(e) => setTechnicalField("warranty", e.target.value)} placeholder="Alcance de cobertura, fecha de vencimiento o exclusiones" className="u-input" /></L></Section>}
        {ger && <Section title="Información interna"><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><L label="Recurrencia"><select value={technical.recurrence} onChange={(e) => setTechnicalField("recurrence", e.target.value)} className="u-input"><option value="">Seleccionar</option><option>Primera intervención</option><option>Recurrente</option><option>Seguimiento programado</option></select></L><L label="Próxima acción interna"><select value={technical.internalDisposition} onChange={(e) => setTechnicalField("internalDisposition", e.target.value)} className="u-input"><option value="">Sin acción definida</option><option>Seguimiento técnico</option><option>Cotizar mejora o repuesto</option><option>Esperar repuesto</option><option>Escalar a ingeniería</option><option>Cerrar sin seguimiento</option></select></L><L label="Responsable interno"><input value={technical.internalOwner} onChange={(e) => setTechnicalField("internalOwner", e.target.value)} placeholder="Persona responsable del seguimiento" className="u-input" /></L></div><textarea value={technical.internalNotes} onChange={(e) => setTechnicalField("internalNotes", e.target.value)} rows={3} placeholder="Notas privadas, riesgos comerciales o próximos pasos internos" className="u-input mt-2 resize-none" /></Section>}
        <Section title="Firma del técnico responsable"><p className="mb-2 text-xs text-slate-500">Confirma la ejecución y la información técnica registrada en esta orden.</p><SignaturePad onChange={setTechnicianSignatureUrl} /><div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Técnico: <b>{tech || me.name}</b></div></Section>
        <Section title="Conformidad del cliente"><SignaturePad onChange={setSignatureUrl} /><input value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Nombre de quien firma" className="u-input mt-2" /><div className="mt-2 grid grid-cols-2 gap-2"><L label="Cargo / área"><select value={signerRoleChoice} onChange={(e) => { const value = e.target.value; setSignerRoleChoice(value); setTechnicalField("signerRole", value === "Otro" ? "" : value); }} className="u-input"><option value="">Seleccionar</option>{SIGNER_ROLES.map((role) => <option key={role}>{role}</option>)}<option>Otro</option></select></L><div><span className="mb-1 block text-[11px] font-medium text-slate-500">Empresa</span><div className="u-input flex items-center bg-slate-50 text-slate-700" title="Se toma automáticamente del cliente seleccionado">{client?.name || "—"}</div></div></div>{signerRoleChoice === "Otro" && <L label="Especificar cargo / área"><input autoFocus value={technical.signerRole} onChange={(e) => setTechnicalField("signerRole", e.target.value)} placeholder="Escribe el cargo o área" className="u-input mt-2" /></L>}{!signatureUrl && (<div className="mt-2"><p className="mb-1 text-[11px] text-amber-600">Se recomienda la firma del cliente. Si no es posible, indica el motivo para poder completar igual:</p><input value={noSignReason} onChange={(e) => setNoSignReason(e.target.value)} placeholder="Motivo (ej. cliente ausente)" className="u-input" /></div>)}</Section>
        <Box className="p-4"><h3 className="mb-3 text-sm font-semibold text-slate-900">Resumen antes de enviar</h3><div className="space-y-1.5 text-sm text-slate-600"><div className="flex justify-between gap-3"><span>Cliente</span><span className="text-right font-medium text-slate-800">{client?.name || "—"}</span></div><div className="flex justify-between gap-3"><span>Servicio</span><span className="text-right font-medium text-slate-800">{service}</span></div><div className="flex justify-between gap-3"><span>Tiempo efectivo</span><span className="font-medium text-slate-800">{compactDuration(elapsedWorkMs)}</span></div>{ger && <div className="flex justify-between gap-3"><span>Horas facturables</span><span className="font-medium text-slate-800">{projectedBillableHours} h × {technicians || 1} técnico(s) = {round2(projectedBillableHours * (Number(technicians) || 1))} h-técnico</span></div>}<div className="flex justify-between gap-3"><span>Materiales</span><span className="font-medium text-slate-800">{materials.length}</span></div>{ger && <><div className="flex justify-between gap-3 border-t border-slate-100 pt-2"><span>Mano de obra</span><span>{money(preview.labor)}</span></div><div className="flex justify-between gap-3"><span>Materiales</span><span>{money(preview.mats)}</span></div><div className="flex justify-between gap-3 font-semibold text-slate-900"><span>Total</span><span>{money(preview.total)}</span></div></>}</div></Box>
        </>)}
        </div>
      </main>
      <div className="mobile-bottom-bar fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur sm:px-4"><div className="mx-auto max-w-lg">{step === 3 && chronologyErrors.length > 0 && <div className="mb-2 flex items-start gap-1.5 text-[11px] text-rose-600"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Corrige la cronología antes de completar la orden.</div>}{step === 3 && canSave && !technicianSignatureUrl && <div className="mb-2 flex items-start gap-1.5 text-[11px] font-medium text-rose-600"><FileSignature className="mt-0.5 h-3.5 w-3.5 shrink-0" /> La firma del técnico es obligatoria para completar.</div>}{step === 3 && canSave && !signatureUrl && !noSignReason.trim() && <div className="mb-2 flex items-start gap-1.5 text-[11px] text-amber-600"><FileSignature className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Para la conformidad del cliente, capta la firma o indica un motivo.</div>}<div className="grid grid-cols-[auto_1fr_auto] gap-2">{step > 0 ? <button onClick={() => setStep((value) => value - 1)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Atrás</button> : <button disabled={saving || !canStartOrder} onClick={() => save("En proceso de ejecución")} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 disabled:opacity-50">Iniciar orden</button>}<div />{step < steps.length - 1 ? <button onClick={() => setStep((value) => value + 1)} disabled={!stepReady} className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Continuar <ChevronRight className="h-4 w-4" /></button> : <button onClick={() => save("Completada")} disabled={!canComplete || saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />} Completar orden</button>}</div></div></div>
    </div>
  );
}
const Section = ({ title, children }) => <div className="motion-card rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>{children}</div>;
function ServiceTimeline({ technical, active, elapsedMs, billableHours, minimumApplied, showBilling = false, technicians, errors = [], disabled = false, onAction, onDowntime, onBillableWait, onBillableWaitReason }) {
  const stamp = (value) => value ? new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "Pendiente";
  const responseMs = technical.arrivalAt && technical.reportedAt ? new Date(technical.arrivalAt) - new Date(technical.reportedAt) : 0;
  const onSiteMs = technical.completedAt && technical.arrivalAt ? new Date(technical.completedAt) - new Date(technical.arrivalAt) : 0;
  return <section className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900">Cronología del servicio</h3><p className="mt-0.5 text-[11px] text-slate-500">Registra cada hito; los tiempos y horas se calculan automáticamente.</p></div>{active && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> En curso</span>}</div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{[["Aviso", technical.reportedAt], ["Llegada", technical.arrivalAt], ["Inicio", technical.startedAt], ["Fin", technical.completedAt]].map(([label, value]) => <div key={label} className={`rounded-lg border px-2.5 py-2 ${value ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50"}`}><div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div><div className={`mt-0.5 font-semibold ${value ? "text-slate-700" : "text-slate-400"}`}>{stamp(value)}</div></div>)}</div>
    <div className="mt-3 flex flex-wrap gap-2">
      {!technical.arrivalAt && <button disabled={disabled} onClick={() => onAction("arrival")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><MapPin className="h-4 w-4" /> Registrar llegada</button>}
      {technical.arrivalAt && !technical.startedAt && <button disabled={disabled} onClick={() => onAction("start")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" /> Iniciar intervención</button>}
      {active && <button disabled={disabled} onClick={() => onAction("pause")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 disabled:opacity-50"><Square className="h-3.5 w-3.5" /> Pausar</button>}
      {technical.startedAt && !active && !technical.completedAt && <button disabled={disabled} onClick={() => onAction("resume")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" /> Reanudar</button>}
      {technical.startedAt && !technical.completedAt && <button disabled={disabled} onClick={() => onAction("finish")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Finalizar intervención</button>}
      {technical.completedAt && <button disabled={disabled} onClick={() => onAction("reopen")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700 disabled:opacity-50"><RefreshCw className="h-4 w-4" /> Reabrir intervención</button>}
    </div>
    {technical.completedAt && <p className="mt-2 text-[11px] text-slate-500">Si la orden todavía está en ejecución, reabrí la intervención para continuar registrando tiempo y volver a finalizarla.</p>}
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs"><span className="flex items-center gap-1 text-[10px] text-slate-400">Tiempo efectivo <HelpHint text="Tiempo real trabajado entre inicio y finalización, descontando pausas." /></span><b className="text-slate-700">{compactDuration(elapsedMs)}</b></div>{showBilling && <div className={`rounded-lg px-2.5 py-2 text-xs ${minimumApplied ? "bg-amber-50" : "bg-brand-50"}`}><span className="flex items-center gap-1 text-[10px] text-slate-400">Horas facturables <HelpHint text="Horas comerciales cobradas por técnico; puede aplicar un mínimo de dos horas cuando la visita es menor a una hora." /></span><b className={minimumApplied ? "text-amber-700" : "text-brand-700"}>{billableHours} h{minimumApplied ? " · mínimo" : ""}</b></div>}{responseMs > 0 && <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs"><span className="flex items-center gap-1 text-[10px] text-slate-400">Respuesta <HelpHint text="Tiempo transcurrido desde el aviso recibido hasta la llegada al sitio." /></span><b className="text-slate-700">{compactDuration(responseMs)}</b></div>}{onSiteMs > 0 && <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs"><span className="flex items-center gap-1 text-[10px] text-slate-400">Total en planta <HelpHint text="Permanencia total desde la llegada al sitio hasta la finalización, incluyendo esperas y pausas." /></span><b className="text-slate-700">{compactDuration(onSiteMs)}</b></div>}</div>
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"><label className="flex h-full flex-col"><span className="mb-1 flex min-h-8 items-end gap-1 text-[11px] font-medium leading-tight text-slate-500">Espera por condiciones del sitio (minutos) <HelpHint text="Tiempo en planta sin poder intervenir por autorización, acceso, disponibilidad del equipo u otra condición atribuible al sitio. Puede incorporarse a la facturación." /></span><input type="number" min="0" step="1" value={technical.billableWaitMinutes ?? ""} onChange={(event) => onBillableWait(event.target.value)} onBlur={(event) => onBillableWait(Math.max(0, Math.round(Number(event.target.value) || 0)))} className="u-input" /></label><label className="flex h-full flex-col"><span className="mb-1 flex min-h-8 items-end gap-1 text-[11px] font-medium leading-tight text-slate-500">Parada productiva informada (minutos, independiente de la visita) <HelpHint text="Duración informada de la afectación productiva del cliente. Es un dato técnico de impacto y no aumenta automáticamente las horas del servicio." /></span><input type="number" min="0" step="1" value={technical.downtimeMinutes ?? ""} onChange={(event) => onDowntime(event.target.value)} onBlur={(event) => onDowntime(Math.max(0, Math.round(Number(event.target.value) || 0)))} className="u-input" /></label></div>
    {(Number(technical.billableWaitMinutes) || 0) > 0 && <L label="Motivo de la espera"><input value={technical.billableWaitReason || ""} onChange={(event) => onBillableWaitReason(event.target.value)} placeholder="Ej. espera de autorización, acceso o disponibilidad del equipo" className="u-input mt-2" /></L>}
    {errors.length > 0 && <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{errors.map((error) => <p key={error}>• {error}</p>)}</div>}
  </section>;
}
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
function FieldTaskList({ tasks, projects, onOpen, onMove }) {
  const open = tasks.filter((t) => t.status !== "Hecho");
  const groups = [
    { id: "overdue", title: "Vencidas", items: open.filter(isOverdue), tone: "border-rose-200 bg-rose-50/50", icon: AlertTriangle },
    { id: "today", title: "Para hoy", items: open.filter((t) => t.due === todayStr()), tone: "border-brand-200 bg-brand-50/40", icon: Calendar },
    { id: "active", title: "En progreso", items: open.filter((t) => t.status === "En progreso" && !isOverdue(t) && t.due !== todayStr()), tone: "border-violet-200 bg-violet-50/40", icon: Clock },
    { id: "upcoming", title: "Próximas", items: open.filter((t) => !isOverdue(t) && t.due !== todayStr() && t.status !== "En progreso"), tone: "border-slate-200 bg-white", icon: ListTodo },
  ];
  const projectById = (id) => projects.find((p) => p.id === id);
  if (!open.length) return <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" /><h3 className="mt-3 text-sm font-semibold text-slate-800">No tenés tareas pendientes</h3><p className="mt-1 text-xs text-slate-500">Las nuevas asignaciones aparecerán en esta vista.</p></div>;
  return <div className="space-y-4">{groups.map(({ id, title, items, tone, icon: Icon }) => items.length > 0 && <section key={id}><div className="mb-2 flex items-center gap-2"><Icon className="h-4 w-4 text-slate-500" /><h3 className="text-sm font-semibold text-slate-800">{title}</h3><span className="rounded-full bg-slate-200 px-2 text-xs text-slate-600">{items.length}</span></div><div className="space-y-2">{items.map((task) => { const index = T_STATUS.indexOf(task.status); const project = projectById(task.project); const color = project?.color || task.color || "#94a3b8"; return <article key={task.id} className={`rounded-xl border border-l-4 p-3 ${tone}`} style={{ borderLeftColor: color }}><button onClick={() => onOpen(task)} className="block w-full text-left"><div className="flex flex-wrap items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" /><Chip className={`${prioMeta[task.priority]} ring-black/5`}><Flag className="h-3 w-3" />{task.priority}</Chip>{task._offline && <Chip className="bg-amber-50 text-amber-700 ring-amber-200"><WifiOff className="h-3 w-3" />Pendiente</Chip>}</div><h4 className="mt-2 text-sm font-semibold leading-snug text-slate-900">{task.title}</h4><p className="mt-1 text-xs text-slate-500">{project?.name || task.id}{task.due ? ` · ${dueLabel(task.due)}` : ""}</p></button><div className="mt-3 flex items-center gap-2 border-t border-slate-200/70 pt-3"><span className="text-xs font-medium text-slate-600">{task.status}</span><button onClick={() => onOpen(task)} className="ml-auto min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">Ver detalle</button>{index < T_STATUS.length - 1 && <button onClick={() => onMove(task.id, 1)} className="min-h-10 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white">Avanzar</button>}</div></article>; })}</div></section>)}</div>;
}

function TaskColumn({ status, tasks, projects = [], userById, onOpen, onMove, roomy = false, readOnly = false, tvMode = false }) {
  const col = tasks.filter((task) => task.status === status);
  const meta = T_STYLE[status];
  const limit = WIP_LIMITS[status];
  const over = limit && col.length > limit;
  return <section className={`tv-task-column rounded-xl border-t-4 ${meta.col} bg-slate-50/60 ${roomy ? "min-h-[18rem]" : ""}`}>
    <div className="flex items-center justify-between px-3 py-2"><h3 className="text-sm font-semibold text-slate-700">{status}</h3><span className={`rounded-full px-2 text-xs font-medium ring-1 ${over ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-white text-slate-500 ring-slate-200"}`}>{col.length}{limit ? `/${limit}` : ""}</span></div>
    {over && <div className="mx-2 mb-1 rounded-md bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-700">Límite de trabajo en curso superado</div>}
    <div className={`tv-column-list space-y-2 px-2 pb-3 ${tvMode ? "overflow-y-auto" : ""}`}>
      {col.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-xs text-slate-400">Sin tareas en esta etapa</div>}
      {col.map((task) => { const index = T_STATUS.indexOf(task.status); const age = daysSince(task._updatedAt); const project = projects.find((item) => item.id === task.project); const color = project?.color || task.color || "#94a3b8"; return <article key={task.id} className="tv-task-card rounded-lg border border-l-4 border-slate-200 bg-white p-3 shadow-sm" style={{ borderLeftColor: color }}>
        <button onClick={() => onOpen(task)} className="block w-full text-left"><div className="flex flex-wrap items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-label={`Color del proyecto ${project?.name || "sin identificar"}`} /><Chip className={`${typeMeta[task.type]} ring-1 ring-inset ring-black/5`}>{task.type}</Chip>{isOverdue(task) && <Chip className="bg-rose-50 text-rose-700 ring-rose-600/20"><AlertTriangle className="h-3 w-3" />Vencida</Chip>}{isStale(task) && <Chip className="bg-amber-50 text-amber-700 ring-amber-600/20"><Clock className="h-3 w-3" />Estancada</Chip>}</div><h4 className="mt-1.5 text-sm font-semibold leading-snug text-slate-900">{task.title}</h4><div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400"><span className="font-mono">{task.id}</span>{task.due && <span className="inline-flex items-center gap-0.5"><Calendar className="h-3 w-3" />{dueLabel(task.due)}</span>}{task.status !== "Hecho" && task._updatedAt && <span className="inline-flex items-center gap-0.5"><Clock className="h-3 w-3" />{age === 0 ? "Actualizada hoy" : `Hace ${age}d`}</span>}</div></button>
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3"><div className="flex min-w-0 items-center gap-1.5"><Avatar user={userById(task.assignee)} size={24} /><Chip className={`${prioMeta[task.priority]} ring-1 ring-inset ring-black/5`}><Flag className="h-3 w-3" />{task.priority}</Chip></div>{!readOnly && <div className="flex gap-1"><button onClick={() => onMove(task.id, -1)} disabled={index === 0} aria-label={`Mover ${task.title} hacia atrás`} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><button onClick={() => onMove(task.id, 1)} disabled={index === T_STATUS.length - 1} aria-label={`Avanzar ${task.title}`} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div>}</div>
      </article>; })}
    </div>
  </section>;
}

function Board({ tasks, projects = [], userById, onOpen, onMove, readOnly = false, tvMode = false }) {
  return <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 ${tvMode ? "tv-board" : ""}`}>{T_STATUS.map((status) => <TaskColumn key={status} status={status} tasks={tasks} projects={projects} userById={userById} onOpen={onOpen} onMove={onMove} readOnly={readOnly} tvMode={tvMode} />)}</div>;
}

function TechnicianBoard({ tasks, projects = [], userById, onOpen, onMove }) {
  const [mobileStatus, setMobileStatus] = useState(() => tasks.some((task) => task.status === "En progreso") ? "En progreso" : "Por hacer");
  return <>
    <div className="sm:hidden"><nav aria-label="Etapas de tareas" className="-mx-3 mb-3 flex gap-2 overflow-x-auto px-3 pb-1">{T_STATUS.map((status) => { const count = tasks.filter((task) => task.status === status).length; return <button key={status} onClick={() => setMobileStatus(status)} aria-pressed={mobileStatus === status} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${mobileStatus === status ? "border-brand-400 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600"}`}>{status}<span className="rounded-full bg-white px-1.5 text-[11px] text-slate-500 ring-1 ring-slate-200">{count}</span></button>; })}</nav><TaskColumn status={mobileStatus} tasks={tasks} projects={projects} userById={userById} onOpen={onOpen} onMove={onMove} roomy /></div>
    <div className="hidden sm:block"><Board tasks={tasks} projects={projects} userById={userById} onOpen={onOpen} onMove={onMove} /></div>
  </>;
}

function WorkCalendar({ tasks, orders, projects, userById, onOpenTask, onOpenOrder, showOrders }) {
  const initial = new Date(`${todayStr()}T12:00:00`);
  const [cursor, setCursor] = useState(initial);
  const [selected, setSelected] = useState(todayStr());
  const projectById = (id) => projects.find((project) => project.id === id);
  const items = useMemo(() => [
    ...tasks.filter((task) => task.due).map((task) => { const project = projectById(task.project); return { id: task.id, kind: "task", date: task.due, title: task.title, meta: `${project?.key || task.id} · ${task.status}`, color: project?.color || task.color || "#0ea5e9", source: task }; }),
    ...(showOrders ? orders.filter((order) => order.date).map((order) => ({ id: order.id, kind: "order", date: order.date, title: order.client, meta: `${order.id} · ${order.service}`, source: order })) : []),
  ], [tasks, orders, projects, showOrders]);
  const byDate = useMemo(() => items.reduce((map, item) => { if (!map[item.date]) map[item.date] = []; map[item.date].push(item); return map; }, {}), [items]);
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
  const calendarStart = startOfCalendarWeek(firstOfMonth);
  const monthDays = Array.from({ length: 42 }, (_, index) => addCalendarDays(calendarStart, index));
  const selectedDate = new Date(`${selected}T12:00:00`);
  const weekStart = startOfCalendarWeek(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addCalendarDays(weekStart, index));
  const selectedItems = byDate[selected] || [];
  const noDate = tasks.filter((task) => !task.due && task.status !== "Hecho").length;
  const chooseDate = (date) => { setSelected(dateKey(date)); setCursor(new Date(date.getFullYear(), date.getMonth(), 1, 12)); };
  const moveMonth = (amount) => { const next = new Date(cursor.getFullYear(), cursor.getMonth() + amount, 1, 12); setCursor(next); setSelected(dateKey(next)); };
  const moveWeek = (amount) => chooseDate(addCalendarDays(selectedDate, amount * 7));
  const goToday = () => { setCursor(initial); setSelected(todayStr()); };
  const openItem = (item) => item.kind === "task" ? onOpenTask(item.source) : onOpenOrder(item.source);
  return <div className="space-y-4">
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-3 sm:px-4"><div className="min-w-0 flex-1"><h2 className="text-base font-semibold capitalize text-slate-900">{cursor.toLocaleDateString("es-AR", { month: "long", year: "numeric" })}</h2><p className="text-[11px] text-slate-500"><span className="font-medium text-brand-600">Tareas</span> y {showOrders ? <span className="font-medium text-amber-600">órdenes programadas</span> : "agenda asignada"}</p></div><button onClick={goToday} className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Hoy</button><div className="flex gap-1"><button onClick={() => moveMonth(-1)} aria-label="Mes anterior" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500"><ChevronLeft className="h-4 w-4" /></button><button onClick={() => moveMonth(1)} aria-label="Mes siguiente" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500"><ChevronRight className="h-4 w-4" /></button></div></div>
      <div className="sm:hidden"><div className="flex items-center justify-between px-3 py-2"><button onClick={() => moveWeek(-1)} aria-label="Semana anterior" className="grid h-9 w-9 place-items-center rounded-lg text-slate-500"><ChevronLeft className="h-4 w-4" /></button><span className="text-xs font-medium text-slate-500">Semana del {weekStart.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}</span><button onClick={() => moveWeek(1)} aria-label="Semana siguiente" className="grid h-9 w-9 place-items-center rounded-lg text-slate-500"><ChevronRight className="h-4 w-4" /></button></div><div className="grid grid-cols-7 gap-1 px-2 pb-3">{weekDays.map((date) => { const key = dateKey(date); const count = (byDate[key] || []).length; const active = key === selected; return <button key={key} onClick={() => chooseDate(date)} aria-pressed={active} className={`min-w-0 rounded-lg px-1 py-2 text-center ${active ? "bg-brand-500 text-white" : "bg-slate-50 text-slate-600"}`}><span className="block text-[9px] font-medium uppercase">{date.toLocaleDateString("es-AR", { weekday: "short" }).slice(0, 2)}</span><span className="mt-0.5 block text-sm font-semibold">{date.getDate()}</span><span className={`mx-auto mt-1 block h-1.5 w-1.5 rounded-full ${count ? (active ? "bg-white" : "bg-brand-500") : "bg-transparent"}`} /></button>; })}</div></div>
      <div className="hidden sm:block"><div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => <div key={day} className="px-2 py-2 text-center text-[11px] font-semibold uppercase text-slate-400">{day}</div>)}</div><div className="grid grid-cols-7">{monthDays.map((date) => { const key = dateKey(date); const dayItems = byDate[key] || []; const inMonth = date.getMonth() === cursor.getMonth(); const active = key === selected; return <button key={key} onClick={() => chooseDate(date)} className={`min-h-24 border-b border-r border-slate-100 p-1.5 text-left align-top hover:bg-slate-50 ${active ? "bg-brand-50/60 ring-2 ring-inset ring-brand-400" : ""}`}><span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${key === todayStr() ? "bg-brand-500 text-white" : inMonth ? "text-slate-700" : "text-slate-300"}`}>{date.getDate()}</span><span className="mt-1 block space-y-1">{dayItems.slice(0, 3).map((item) => <span key={`${item.kind}-${item.id}`} className={`block truncate rounded border-l-[3px] px-1.5 py-1 text-[10px] font-medium ${item.kind === "task" ? "bg-slate-50 text-slate-700" : "border-amber-500 bg-amber-50 text-amber-700"}`} style={item.kind === "task" ? { borderLeftColor: item.color, backgroundColor: `${item.color}14` } : undefined}>{item.kind === "order" ? "OT · " : ""}{item.title}</span>)}{dayItems.length > 3 && <span className="block text-[10px] font-medium text-slate-400">+{dayItems.length - 3} más</span>}</span></button>; })}</div></div>
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4"><div className="mb-3 flex flex-wrap items-center gap-2"><Calendar className="h-4 w-4 text-brand-600" /><h3 className="text-sm font-semibold capitalize text-slate-900">{selectedDate.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}</h3><span className="rounded-full bg-slate-100 px-2 text-xs text-slate-500">{selectedItems.length}</span>{noDate > 0 && <span className="ml-auto text-[11px] text-amber-600">{noDate} tarea(s) sin fecha</span>}</div><div className="space-y-2">{!selectedItems.length && <div className="rounded-lg border border-dashed border-slate-200 py-7 text-center text-xs text-slate-400">No hay trabajo programado para este día.</div>}{selectedItems.map((item) => <button key={`${item.kind}-${item.id}`} onClick={() => openItem(item)} className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-l-4 border-slate-200 p-3 text-left hover:bg-slate-50" style={item.kind === "task" ? { borderLeftColor: item.color } : { borderLeftColor: "#f59e0b" }}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${item.kind === "task" ? "bg-slate-50 text-slate-600" : "bg-amber-50 text-amber-600"}`} style={item.kind === "task" ? { color: item.color, backgroundColor: `${item.color}14` } : undefined}>{item.kind === "task" ? <ListTodo className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800">{item.title}</span><span className="block truncate text-xs text-slate-500">{item.meta}</span></span>{item.kind === "task" && <Avatar user={userById(item.source.assignee)} size={26} />}<ChevronRight className="h-4 w-4 shrink-0 text-slate-300" /></button>)}</div></section>
  </div>;
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
function TaskModal({ task, me, users, projects, canAssign, canDelete, readOnly = false, nextId, onClose, onSave, onDelete, onComment, prefill }) {
  const editingExisting = !!task;
  const [f, setF] = useState(() => task || { id: null, project: projects[0]?.id || "", title: "", desc: "", assignee: me.id, status: "Por hacer", priority: "Media", type: "Tarea", due: "", ...(prefill || {}) });
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const save = () => { if (!f.title.trim()) return; onSave({ ...f, id: f.id || nextId(f.project), createdAt: f.createdAt || todayStr() }); };
  const assignable = readOnly || canAssign ? users : users.filter((u) => u.id === me.id);
  return (
    <div className="motion-backdrop fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-semibold text-slate-900">{editingExisting ? f.id : "Nueva tarea"}</h3><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="space-y-3">
          <input value={f.title} onChange={(e) => set({ title: e.target.value })} disabled={readOnly} placeholder="Título de la tarea" className="u-input text-sm font-medium disabled:bg-slate-50" />
          <textarea value={f.desc} onChange={(e) => set({ desc: e.target.value })} disabled={readOnly} rows={3} placeholder="Descripción / criterios" className="u-input resize-none disabled:bg-slate-50" />
          <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2"><L label="Proyecto"><select value={f.project} onChange={(e) => set({ project: e.target.value })} disabled={editingExisting || readOnly} className="u-input disabled:bg-slate-50">{projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}</select></L><L label="Responsable"><select value={f.assignee} onChange={(e) => set({ assignee: e.target.value })} disabled={readOnly} className="u-input disabled:bg-slate-50">{assignable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></L></div>
          <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-3"><L label="Estado"><select value={f.status} onChange={(e) => set({ status: e.target.value })} disabled={readOnly} className="u-input disabled:bg-slate-50">{T_STATUS.map((s) => <option key={s}>{s}</option>)}</select></L><L label="Prioridad"><select value={f.priority} onChange={(e) => set({ priority: e.target.value })} disabled={readOnly} className="u-input disabled:bg-slate-50">{PRIORITIES.map((s) => <option key={s}>{s}</option>)}</select></L><L label="Tipo"><select value={f.type} onChange={(e) => set({ type: e.target.value })} disabled={readOnly} className="u-input disabled:bg-slate-50">{TYPES.map((s) => <option key={s}>{s}</option>)}</select></L></div>
          <L label="Fecha límite"><input type="date" value={f.due} onChange={(e) => set({ due: e.target.value })} disabled={readOnly} className="u-input disabled:bg-slate-50" /></L>
        </div>
        {editingExisting && onComment && !readOnly && <div className="mt-4 border-t border-slate-100 pt-4"><ActivitySection entity={f} onSend={(text) => onComment(f.id, text)} /></div>}
        <div className="mt-5 flex gap-2">{editingExisting && canDelete && !readOnly && <button onClick={() => onDelete(f.id)} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>}<button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{readOnly ? "Cerrar" : "Cancelar"}</button>{!readOnly && <button onClick={save} disabled={!f.title.trim()} className="flex-1 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50">{editingExisting ? "Guardar" : "Crear"}</button>}</div>
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
  const byAssignee = users.filter((u) => u.active && u.role !== "monitor_oficina").map((u) => ({ name: u.name.split(" ")[0], value: tasks.filter((t) => t.assignee === u.id).length, fill: u.color }));
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
  const techs = users.filter((u) => u.active && (u.role === "tecnico" || u.role === "tecnico_oficina" || u.role === "monitor_oficina"));
  const [sel, setSel] = useState(new Set(project.allowedUsers || []));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between"><h3 className="text-base font-semibold text-slate-900">Accesos del proyecto</h3><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <p className="mb-3 text-sm text-slate-500">{project.key} · {project.name}. Marcá qué técnicos y monitores pueden ver este proyecto y sus tareas. La gerencia siempre lo ve.</p>
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
  const people = users.filter((u) => u.active && u.role !== "monitor_oficina");
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
  const [pendingDelete, setPendingDelete] = useState(null);
  const wrap = (fn) => async (...a) => { try { await fn(...a); } catch (e) { onErr(e); } };
  const add = async () => { if (!nf.name.trim()) return; try { await onAdd({ name: nf.name.trim(), unit: nf.unit.trim() || "u", price: wholeMoney(nf.price), cost: wholeMoney(nf.cost), stock: Number(nf.stock) || 0, minStock: Number(nf.minStock) || 0 }); setNf({ name: "", unit: "u", price: "", cost: "", stock: "", minStock: "" }); } catch (e) { onErr(e); } };
  const startEdit = (p) => { setEditId(p.id); setEf({ name: p.name || "", unit: p.unit || "u", price: p.price ?? 0, cost: p.cost ?? 0, stock: p.stock ?? 0, minStock: p.minStock ?? 0 }); };
  const saveEdit = async () => { if (!ef.name.trim()) return; try { await onPatch(editId, { name: ef.name.trim(), unit: ef.unit.trim() || "u", price: wholeMoney(ef.price), cost: wholeMoney(ef.cost), stock: Number(ef.stock) || 0, minStock: Number(ef.minStock) || 0 }); setEditId(null); } catch (e) { onErr(e); } };
  const low = parts.filter((p) => typeof p.stock === "number" && typeof p.minStock === "number" && p.stock <= p.minStock);
  const sorted = [...parts].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return <>
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
                    <L label="Stock mínimo" help="Nivel que activa la alerta de reposición. El repuesto se considera crítico cuando el stock disponible es igual o menor a este valor."><input type="number" value={ef.minStock} onChange={(e) => setEf({ ...ef, minStock: e.target.value })} className="u-input" /></L>
                    <L label="Precio venta"><input type="number" min="0" step="1" value={ef.price} onChange={(e) => setEf({ ...ef, price: e.target.value })} onBlur={(e) => setEf({ ...ef, price: wholeMoney(e.target.value) })} className="u-input" /></L>
                    <L label="Costo"><input type="number" min="0" step="1" value={ef.cost} onChange={(e) => setEf({ ...ef, cost: e.target.value })} onBlur={(e) => setEf({ ...ef, cost: wholeMoney(e.target.value) })} className="u-input" /></L>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => setEditId(null)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
                    <button onClick={saveEdit} disabled={!ef.name.trim()} className="flex-1 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50">Guardar</button>
                  </div>
                </div>
              );
              return (
                <div key={p.id} className={`rounded-lg border p-3 ${isLow ? "border-rose-200 bg-rose-50/40" : "border-slate-200"}`}>
                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold text-slate-800">{p.name}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>Venta <b className="font-medium text-slate-700">{money(p.price)}</b></span>
                      <span>Costo <b className="font-medium text-slate-700">{money(p.cost)}</b></span>
                      {margin != null && <span className="font-medium text-emerald-600">Margen {margin}%</span>}
                    </div>
                  </div>
                  <div className="mt-3 flex w-full flex-wrap items-center gap-2 border-t border-slate-200/70 pt-3">
                    <span className={`rounded-md px-2 py-1.5 text-xs font-medium ${isLow ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"}`}>Stock: {p.stock} {p.unit}</span>
                    <span className="rounded-md border border-slate-200 bg-white/60 px-2 py-1.5 text-xs text-slate-500">Mín: {p.minStock}</span>
                    <button onClick={() => startEdit(p)} className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Editar</button>
                    <button onClick={() => setPendingDelete(p)} title="Eliminar" aria-label={`Eliminar ${p.name}`} className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
                  </div>
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
            <L label="Precio venta"><input type="number" min="0" step="1" value={nf.price} onChange={(e) => setNf({ ...nf, price: e.target.value })} onBlur={(e) => setNf({ ...nf, price: wholeMoney(e.target.value) })} className="u-input" /></L>
            <L label="Costo"><input type="number" min="0" step="1" value={nf.cost} onChange={(e) => setNf({ ...nf, cost: e.target.value })} onBlur={(e) => setNf({ ...nf, cost: wholeMoney(e.target.value) })} className="u-input" /></L>
            <L label="Stock mínimo" help="Nivel que activa la alerta de reposición. El repuesto se considera crítico cuando el stock disponible es igual o menor a este valor."><input type="number" value={nf.minStock} onChange={(e) => setNf({ ...nf, minStock: e.target.value })} className="u-input" /></L>
          </div>
          <button onClick={add} disabled={!nf.name.trim()} className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"><Plus className="h-4 w-4" /> Agregar repuesto</button>
          <p className="text-[11px] text-slate-400">El catálogo autocompleta los materiales al crear una orden. Cuando el stock llega al mínimo, aparece un aviso en esta pestaña.</p>
        </div>
      </Panel></div>
    </div>
    {pendingDelete && <ConfirmDialog title="Eliminar repuesto" message={`Se eliminará “${pendingDelete.name}” del catálogo. Esta acción no modifica órdenes anteriores.`} confirmLabel="Eliminar" danger onClose={() => setPendingDelete(null)} onConfirm={async () => { await wrap(onRemove)(pendingDelete.id); setPendingDelete(null); }} />}
  </>;
}

/* ===================================== CLIENTES ===================================== */
function Clients({ clients, orders, onAdd, onPatch, onRemove, onErr }) {
  const [nf, setNf] = useState({ name: "", site: "", code: "" });
  const [editingClient, setEditingClient] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const suggest = (name) => (name || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  const add = async () => {
    if (!nf.name.trim()) return;
    try { await onAdd({ name: nf.name.trim(), site: nf.site.trim(), code: nf.code.trim().toUpperCase() || undefined }); setNf({ name: "", site: "", code: "" }); }
    catch (e) { onErr(e); }
  };
  const wrap = (fn) => async (...a) => { try { await fn(...a); } catch (e) { onErr(e); } };
  return <>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2"><Panel title={`Clientes (${clients.length})`}>
        <div className="space-y-2">
          {clients.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">Sin clientes</div>}
          {clients.map((c) => { const ords = orders.filter((o) => (o.client || "").trim().toLowerCase() === (c.name || "").trim().toLowerCase()).length; return (
            <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3">
              <span className="grid h-9 min-w-[3rem] place-items-center rounded-md bg-slate-800 px-2 font-mono text-xs font-bold text-white" title="Código del cliente">{c.code || "—"}</span>
              <div className="min-w-0 flex-1"><div className="break-words text-sm font-semibold text-slate-800">{c.name}</div><div className="break-words text-xs text-slate-500">{c.site || "—"} · {ords} orden(es)</div></div>
              <div className="flex w-full items-center justify-end gap-1 border-t border-slate-100 pt-2 sm:w-auto sm:border-0 sm:pt-0">
                <button onClick={() => setEditingClient(c)} title="Editar cliente" className="inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Editar</button>
                <button onClick={() => setPendingDelete(c)} title="Eliminar" aria-label="Eliminar cliente" className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
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
    {editingClient && <ClientEditor value={editingClient} onClose={() => setEditingClient(null)} onSave={async (form) => { await wrap(onPatch)(editingClient.id, form); setEditingClient(null); }} />}
    {pendingDelete && <ConfirmDialog title="Eliminar cliente" message={`Se eliminará “${pendingDelete.name}”. ${orders.filter((o) => (o.client || "").trim().toLowerCase() === (pendingDelete.name || "").trim().toLowerCase()).length || "No tiene"} orden(es) asociadas permanecerán en el historial.`} confirmLabel="Eliminar" danger onClose={() => setPendingDelete(null)} onConfirm={async () => { await wrap(onRemove)(pendingDelete.id); setPendingDelete(null); }} />}
  </>;
}

function ClientEditor({ value, onClose, onSave }) {
  const [form, setForm] = useState({ name: value.name || "", site: value.site || "", code: value.code || "" });
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onClick={onClose}><div className="mobile-sheet-content w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold text-slate-900">Editar cliente</h2><p className="text-xs text-slate-500">Los cambios se aplican a futuras selecciones.</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="space-y-3"><L label="Nombre"><input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="u-input" /></L><L label="Sitio / ubicación"><input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} className="u-input" /></L><L label="Código"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })} className="u-input font-mono" /></L></div><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={!form.name.trim() || !form.code.trim()} onClick={() => onSave({ name: form.name.trim(), site: form.site.trim(), code: form.code.trim() })} className="rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Guardar</button></div></div></div>;
}

function SettingsModule({ branding, onSaveBranding }) {
  const [form, setForm] = useState({ ...DEFAULT_BRANDING, ...branding });
  const [saving, setSaving] = useState(false);
  const [logoError, setLogoError] = useState("");
  useEffect(() => { setForm({ ...DEFAULT_BRANDING, ...branding }); }, [branding]);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const chooseTheme = (theme) => setForm((current) => ({ ...current, theme: theme.id, primaryColor: theme.primaryColor, headerColor: theme.headerColor }));
  const selectLogo = (file) => {
    if (!file) return;
    setLogoError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setLogoError("Usa una imagen PNG, JPG o WebP."); return; }
    if (file.size > 1.5 * 1024 * 1024) { setLogoError("El archivo supera 1,5 MB. Reduce su tamaño antes de cargarlo."); return; }
    const reader = new FileReader();
    reader.onload = () => set("logoDataUrl", String(reader.result || ""));
    reader.onerror = () => setLogoError("No se pudo leer la imagen.");
    reader.readAsDataURL(file);
  };
  const save = async () => { setSaving(true); await onSaveBranding(form); setSaving(false); };
  const tvPreviewColors = ["#94A3B8", "#F59E0B", "#8B5CF6", "#10B981"];
  return <div className="space-y-5">
    <div><h2 className="text-lg font-semibold text-slate-900">Configuración</h2><p className="text-xs text-slate-500">Identidad visual y tema general de la aplicación.</p></div>
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
      <Box className="overflow-hidden">
        <div className="border-b border-slate-100 p-4"><div className="flex items-center gap-2"><Palette className="h-5 w-5 text-brand-600" /><div><h3 className="text-sm font-semibold text-slate-900">Marca y apariencia</h3><p className="text-[11px] text-slate-500">Los cambios se aplican a todos los usuarios y dispositivos.</p></div></div></div>
        <div className="space-y-5 p-4">
          <section><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Logo</h4><div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center"><div className="grid min-h-20 w-full place-items-center rounded-lg p-3 sm:w-56" style={{ background: form.headerColor }}><img src={form.logoDataUrl || LOGO_LIGHT} alt="Vista previa del logo" className="max-h-12 max-w-full object-contain" /></div><div className="flex-1"><div className="flex flex-wrap gap-2"><label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white"><Upload className="h-4 w-4" /> Cargar logo<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { selectLogo(event.target.files?.[0]); event.target.value = ""; }} /></label>{form.logoDataUrl && <button onClick={() => set("logoDataUrl", "")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">Usar logo original</button>}</div><p className="mt-2 text-[11px] text-slate-500">PNG transparente recomendado. Máximo 1,5 MB. También admite JPG y WebP.</p>{logoError && <p className="mt-1 text-xs font-medium text-rose-600">{logoError}</p>}</div></div></section>
          <section><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Identidad</h4><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><L label="Nombre de la aplicación"><input value={form.appName} maxLength={40} onChange={(event) => set("appName", event.target.value)} className="u-input" /></L><L label="Empresa"><input value={form.companyName} maxLength={80} onChange={(event) => set("companyName", event.target.value)} className="u-input" /></L><div className="sm:col-span-2"><L label="Subtítulo"><input value={form.subtitle} maxLength={80} onChange={(event) => set("subtitle", event.target.value)} className="u-input" /></L></div></div></section>
          <section><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Tema</h4><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{BRAND_THEMES.map((theme) => { const active = form.theme === theme.id && form.primaryColor.toUpperCase() === theme.primaryColor; return <button key={theme.id} onClick={() => chooseTheme(theme)} aria-pressed={active} className={`rounded-xl border p-2.5 text-left ${active ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/15" : "border-slate-200 bg-white"}`}><span className="mb-2 flex gap-1"><i className="h-5 flex-1 rounded" style={{ background: theme.primaryColor }} /><i className="h-5 flex-1 rounded" style={{ background: theme.headerColor }} /></span><span className="block truncate text-[11px] font-semibold text-slate-700">{theme.name}</span></button>; })}</div><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"><L label="Color principal"><div className="flex gap-2"><input type="color" value={form.primaryColor} onChange={(event) => setForm((current) => ({ ...current, theme: "personalizado", primaryColor: event.target.value.toUpperCase() }))} className="h-10 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1" /><input value={form.primaryColor} readOnly className="u-input font-mono uppercase" /></div></L><L label="Color de cabecera"><div className="flex gap-2"><input type="color" value={form.headerColor} onChange={(event) => setForm((current) => ({ ...current, theme: "personalizado", headerColor: event.target.value.toUpperCase() }))} className="h-10 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1" /><input value={form.headerColor} readOnly className="u-input font-mono uppercase" /></div></L></div></section>
        </div>
      </Box>
      <Box className="self-start overflow-hidden">
        <div className="border-b border-slate-100 p-4"><h3 className="text-sm font-semibold text-slate-900">Vista previa</h3><p className="mt-0.5 text-[11px] text-slate-500">Así se verá la identidad general de la aplicación.</p></div>
        <div className="p-4"><div className="overflow-hidden rounded-xl border border-slate-200"><div className="flex items-center gap-2 p-3 text-white" style={{ background: form.headerColor }}><img src={form.logoDataUrl || LOGO_LIGHT} alt="Logo" className="h-7 max-w-28 object-contain" /><div className="border-l border-white/15 pl-2"><b className="block text-xs">{form.appName || "Aplicación"}</b><span className="block text-[9px] text-white/65">{form.subtitle || "Subtítulo"}</span></div></div><div className="bg-slate-50 p-3"><div className="rounded-lg border border-slate-200 bg-white p-3"><span className="text-[10px] text-slate-400">Acción principal</span><button className="mt-2 block rounded-lg px-3 py-2 text-xs font-semibold text-white" style={{ background: form.primaryColor }}>Crear registro</button></div></div></div></div>
      </Box>
    </div>
    <Box className="overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2"><Maximize2 className="mt-0.5 h-5 w-5 text-brand-600" /><div><h3 className="text-sm font-semibold text-slate-900">Pantalla de oficina · TV</h3><p className="mt-0.5 text-[11px] text-slate-500">Configura el tablero Full HD que utiliza el perfil Monitor Oficina.</p></div></div><span className="w-fit rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-700">Sólo administradores</span></div>
      <div className="grid grid-cols-1 gap-5 p-4 lg:grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.1fr)] lg:items-center">
        <div><div className="aspect-video overflow-hidden rounded-xl border border-slate-300 bg-slate-900 p-2 shadow-inner" aria-label="Vista previa de pantalla 16:9"><div className="flex h-full flex-col rounded-md bg-slate-100"><div className="flex h-5 items-center gap-1 rounded-t-md px-1.5" style={{ background: form.headerColor }}><span className="h-1.5 w-5 rounded bg-white/60" /><span className="h-1.5 w-9 rounded bg-white/20" /></div><div className="flex flex-1 gap-1.5 p-1.5">{T_STATUS.map((status, index) => <div key={status} className="flex-1 rounded-sm border-t-[3px] bg-white p-1 shadow-sm" style={{ borderTopColor: tvPreviewColors[index] }}><span className="mb-1 block h-1 w-2/3 rounded bg-slate-300" /><span className="mb-1 block h-4 rounded bg-slate-100" /><span className="block h-4 rounded bg-slate-100" /></div>)}</div></div></div><div className="mt-2 flex items-center justify-between text-[10px] text-slate-400"><span>Formato 16:9</span><span>1920 × 1080 Full HD</span></div></div>
        <div className="space-y-3"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${form.tvModeEnabled ? "border-brand-300 bg-brand-50/60" : "cursor-pointer border-slate-200"}`}><input type="checkbox" checked={form.tvModeEnabled} onChange={(event) => setForm((current) => ({ ...current, tvModeEnabled: event.target.checked, tvCycleEnabled: event.target.checked ? current.tvCycleEnabled : false }))} className="mt-0.5 h-4 w-4" /><span><b className="block text-sm text-slate-800">Activar modo TV</b><span className="mt-1 block text-[11px] leading-4 text-slate-500">Optimiza automáticamente el tablero para una pantalla 16:9.</span></span></label><label className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${form.tvModeEnabled ? "cursor-pointer border-slate-200" : "border-slate-100 bg-slate-50 opacity-60"}`}><input type="checkbox" disabled={!form.tvModeEnabled} checked={form.tvCycleEnabled} onChange={(event) => set("tvCycleEnabled", event.target.checked)} className="mt-0.5 h-4 w-4" /><span><b className="block text-sm text-slate-800">Rotación automática</b><span className="mt-1 block text-[11px] leading-4 text-slate-500">Cambia entre los proyectos sin intervención del usuario.</span></span></label></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)] sm:items-end"><L label="Tiempo visible por proyecto"><select disabled={!form.tvModeEnabled || !form.tvCycleEnabled} value={form.tvCycleSeconds} onChange={(event) => set("tvCycleSeconds", Number(event.target.value))} className="u-input disabled:bg-slate-100 disabled:text-slate-400">{[15, 30, 45, 60, 120].map((seconds) => <option key={seconds} value={seconds}>{seconds < 60 ? `${seconds} segundos` : `${seconds / 60} minuto${seconds > 60 ? "s" : ""}`}</option>)}</select></L><p className="rounded-lg bg-sky-50 px-3 py-2.5 text-[11px] leading-4 text-sky-700">Se aplica exclusivamente al usuario <b>Monitor Oficina</b>. Los demás perfiles conservan su vista habitual.</p></div></div>
      </div>
    </Box>
    <div className="flex flex-col-reverse gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:justify-end"><button onClick={() => setForm(DEFAULT_BRANDING)} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600">Restaurar valores originales</button><button disabled={saving || !form.appName.trim() || !form.companyName.trim()} onClick={save} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar configuración</button></div>
  </div>;
}

function Team({ users, tasks, orders, me, onAdd, onPatch, onRemove, onErr }) {
  const [nf, setNf] = useState({ name: "", role: "tecnico", email: "", password: "" });
  const [passwordUser, setPasswordUser] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const add = async () => { if (!nf.name.trim() || !nf.email.trim() || nf.password.length < 8) return; try { await onAdd({ ...nf }); setNf({ name: "", role: "tecnico", email: "", password: "" }); } catch (e) { onErr(e); } };
  const wrap = (fn) => async (...a) => { try { await fn(...a); } catch (e) { onErr(e); } };
  return <>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2"><Panel title={`Empleados (${users.length}) · directorio compartido`}>
        <div className="space-y-2">{users.map((u) => { const isViewer = u.role === "monitor_oficina"; const load = tasks.filter((t) => t.assignee === u.id && t.status !== "Hecho").length; const ords = orders.filter((o) => o.tech === u.name).length; return (
          <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3">
            <Avatar user={u} size={38} />
            <div className="min-w-0 flex-1"><div className="break-words text-sm font-semibold text-slate-800">{u.name}{u.id === me.id && <span className="ml-1 text-[11px] text-slate-400">(tú)</span>}</div><div className="break-all text-xs text-slate-500">{u.email}{isViewer ? " · Solo visualización · no computa carga" : ` · ${load} tarea(s) · ${ords} orden(es)`}</div></div>
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-slate-100 pt-2 sm:w-auto sm:border-0 sm:pt-0">
              <select title="Define los módulos, datos y acciones que puede utilizar este usuario." value={u.role} onChange={(e) => wrap(onPatch)(u.id, { role: e.target.value })} disabled={u.id === me.id} className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs disabled:opacity-60 sm:flex-none">{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button onClick={() => wrap(onPatch)(u.id, { active: !u.active })} disabled={u.id === me.id} className={`min-h-9 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40 ${u.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{u.active ? "Activo" : "Inactivo"}</button>
              <button onClick={() => setPasswordUser(u)} title="Restablecer contraseña" aria-label={`Restablecer contraseña de ${u.name}`} className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-brand-50 hover:text-brand-600"><KeyRound className="h-4 w-4" /></button>
              <button onClick={() => setPendingDelete(u)} disabled={u.id === me.id} title="Eliminar empleado" aria-label="Eliminar empleado" className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ); })}</div>
      </Panel></div>
      <div><Panel title="Nuevo empleado">
        <div className="space-y-2"><L label="Nombre"><input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="Nombre y apellido" className="u-input" /></L><L label="Correo"><input type="email" value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} placeholder="correo@empresa.com" className="u-input" /></L><L label="Contraseña inicial"><input type="password" autoComplete="new-password" value={nf.password} onChange={(e) => setNf({ ...nf, password: e.target.value })} placeholder="Mínimo 8 caracteres" className="u-input" /></L><L label="Rol" help="Administrador: acceso total. Gerencia: gestión operativa y financiera. Técnico de campo: órdenes y tareas asignadas. Técnico de oficina: proyectos sin órdenes. Monitor: solo visualización."><select value={nf.role} onChange={(e) => setNf({ ...nf, role: e.target.value })} className="u-input">{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></L><button onClick={add} disabled={!nf.name.trim() || !nf.email.trim() || nf.password.length < 8} className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"><UserPlus className="h-4 w-4" /> Crear perfil</button><p className="text-[11px] text-slate-400">La contraseña inicial es temporal y deberá cambiarse al ingresar. Los monitores son perfiles de solo visualización: no reciben tareas ni órdenes y no aparecen en métricas de carga.</p></div>
      </Panel></div>
    </div>
    {passwordUser && <PasswordResetDialog user={passwordUser} onClose={() => setPasswordUser(null)} onSave={async (password) => { await wrap(onPatch)(passwordUser.id, { password }); setPasswordUser(null); }} />}
    {pendingDelete && <ConfirmDialog title="Eliminar empleado" message={`Se eliminará el acceso de “${pendingDelete.name}”. Sus órdenes y tareas históricas no se borrarán.`} confirmLabel="Eliminar" danger onClose={() => setPendingDelete(null)} onConfirm={async () => { await wrap(onRemove)(pendingDelete.id); setPendingDelete(null); }} />}
  </>;
}

function PasswordResetDialog({ user, onClose, onSave }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = password.length >= 8 && password === confirm;
  const generate = () => { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#"; const values = crypto.getRandomValues(new Uint32Array(12)); const next = Array.from(values, (value) => alphabet[value % alphabet.length]).join(""); setPassword(next); setConfirm(next); setShow(true); };
  const submit = async () => { if (!valid || busy) return; setBusy(true); try { await onSave(password); } finally { setBusy(false); } };
  return <div className="motion-backdrop fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onClick={onClose}><div className="mobile-sheet-content w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}><div className="mb-4 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600"><KeyRound className="h-5 w-5" /></span><div><h2 className="text-lg font-semibold text-slate-900">Restablecer contraseña</h2><p className="text-xs text-slate-500">{user.name} deberá cambiarla al ingresar.</p></div></div><div className="space-y-3"><button onClick={generate} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-brand-300 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700"><KeyRound className="h-3.5 w-3.5" /> Generar contraseña temporal segura</button><L label="Contraseña temporal"><input autoFocus type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="u-input" /></L><L label="Repetir contraseña"><input type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="u-input" /></L><label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} /> Mostrar contraseña temporal</label>{confirm && password !== confirm && <p className="text-xs text-rose-600">Las contraseñas no coinciden.</p>}<p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">Comunícala por un canal seguro. No se podrá volver a consultar después de guardar.</p></div><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={!valid || busy} onClick={submit} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Restablecer</button></div></div></div>;
}
