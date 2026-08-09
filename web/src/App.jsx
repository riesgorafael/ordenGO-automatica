import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart, Bar as RechartsBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie as RechartsPie, Legend } from "recharts";
import {
  Plus, X, Search, Camera, Upload, Sparkles, Loader2, MapPin, Clock, ClipboardList,
  FileSignature, CheckCircle2, AlertTriangle, Download, Trash2, Play, Square,
  ChevronLeft, ChevronRight, Wrench, DollarSign, Building2, Filter, LayoutGrid,
  BarChart3, Users, UserPlus, Calendar, Flag, Folder, LogOut, Briefcase, KeyRound, FileText, Pencil,
  Bell, Home, MessageSquare, Copy, Link2, TrendingUp, TrendingDown, Menu, Settings2, Palette,
  WifiOff, RefreshCw, ListTodo, Phone, Navigation, ExternalLink, CircleHelp, Maximize2,
  ShoppingCart, Truck, ChevronDown, Eraser, Minimize2, Package, Share2, StickyNote, PenLine,
  Undo2, Redo2, ClipboardPaste, ScanLine, Mic, GanttChartSquare, EyeOff,
} from "lucide-react";
import { api, setToken, getToken } from "./api";
import { LOGO, LOGO_LIGHT } from "./logo";
import { budgetReportPDF, clientOrderReportPDF, dashboardReportPDF, financeReportPDF, internalOrderReportPDF, materialListReportPDF, monthlyReportPDF, purchaseOrderReportPDF, valuedClientReportPDF } from "./pdf";
import { parseReceiptImage } from "./receiptOcr";
import { warpPerspective, autoDetectCorners } from "./imagePerspective";
import GanttChart from "./GanttChart";
import { clearOrderDraft, flushOfflineQueue, loadOrderDraft, offlineQueueSize, queueOfflineOperation, rememberSyncedOrderId, resolveSyncedOrderId, saveOrderDraft, updateQueuedOrder } from "./offline";

/* ===================================== CONFIG ===================================== */
const CUR = "USD ";
const DEFAULT_RATE = 50;
const ROLES = { admin: "Administrador", gerente: "Gerencia / Gerente", tecnico: "Técnico de campo", tecnico_oficina: "Técnico de oficina", monitor_oficina: "Monitor de oficina" };
const allowedModulesForRole = (role) => role === "monitor_oficina" ? ["projects", "whiteboard"] : ["inicio", ...(["admin", "gerente"].includes(role) ? ["panel", "budgets", "finances"] : []), ...(["tecnico_oficina", "monitor_oficina"].includes(role) ? [] : ["orders"]), "projects", "whiteboard", ...(["admin", "gerente", "tecnico"].includes(role) ? ["materialLists"] : []), ...(["admin", "gerente"].includes(role) ? ["clients", "purchaseOrders", "inventory"] : []), ...(role === "admin" ? ["team", "settings"] : [])];
const DEFAULT_BRANDING = { appName: "OrdenGO", subtitle: "Campo + Proyectos", companyName: "AUTOMATICA ARG", theme: "automatica", primaryColor: "#F18700", headerColor: "#2E2E2D", logoDataUrl: "", hideAdminModules: false, companyCuit: "", companyLegalName: "", companyIvaCondition: "IVA Responsable Inscripto", companyAddress: "" };
const cuitDigits = (value) => String(value || "").replace(/\D/g, "");
const formatCuit = (value) => { const digits = cuitDigits(value); return digits.length === 11 ? `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}` : digits; };
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
// Se pisa en cada render de <App> según branding.hideAdminModules, para que los montos se
// enmascaren en toda la pantalla (Panel, Órdenes, Mi día, etc.) mientras el módulo Administración
// esté oculto — sin tener que pasar la bandera como prop a cada componente que usa money().
let HIDE_COSTS = false;
const money = (n) => (HIDE_COSTS ? "***" : `${CUR}${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const wholeMoney = (value) => Math.max(0, Math.round(Number(value) || 0));
// Los diálogos de confirmación viven dentro de cada módulo (no en el estado global de App),
// así que usamos una clase en <body> para poder ocultar el botón flotante mientras alguno esté abierto,
// sin tener que subir el estado de cada "pendingDelete" hasta la raíz.
let openDialogCount = 0;
function useDialogOpenClass() {
  useEffect(() => {
    openDialogCount++;
    document.body.classList.add("dialog-open");
    return () => { openDialogCount = Math.max(0, openDialogCount - 1); if (openDialogCount === 0) document.body.classList.remove("dialog-open"); };
  }, []);
}
// Un cliente puede tener varias plantas, cada una con su propio código (usado para numerar OTs).
// Los clientes viejos solo tienen site/code sueltos — se tratan como una única planta.
const clientSites = (c) => c?.sites?.length ? c.sites : (c?.site ? [{ code: c.code || "", name: c.site }] : []);
const normalizedRate = (value) => { const rate = wholeMoney(value); return !rate || rate === 850 ? DEFAULT_RATE : rate; };

const O_STATUS = ["Borrador", "En proceso de ejecución", "Completada", "Aprobada", "Facturada"];
const O_STYLE = {
  "Borrador": "bg-slate-100 text-slate-600 ring-slate-500/20", "En progreso": "bg-brand-50 text-brand-700 ring-brand-600/20", "En proceso de ejecución": "bg-brand-50 text-brand-700 ring-brand-600/20",
  "Completada": "bg-amber-50 text-amber-700 ring-amber-600/20", "Aprobada": "bg-violet-50 text-violet-700 ring-violet-600/20",
  "Facturada": "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  "Suspendida": "bg-rose-50 text-rose-700 ring-rose-600/20",
};
const SERVICE_TYPES = ["Instalación", "Automatización", "Eléctrico", "Mantenimiento preventivo", "Mantenimiento correctivo", "Garantía", "Emergencia"];
// No hay un campo de prioridad manual en las órdenes (a diferencia de las tareas): se deriva del
// tipo de servicio, que ya es obligatorio y siempre está cargado, en vez de pedir un dato más.
const URGENT_SERVICES = new Set(["Emergencia", "Garantía"]);
const isUrgentOrder = (o) => URGENT_SERVICES.has(o.service);
// Una orden "espera respuesta" mientras no se registró la llegada al sitio y todavía no se cerró
// por otra vía (completada/aprobada/facturada/suspendida). RESPONSE_SLA_MS es el umbral desde que
// se generó el aviso (technical.reportedAt, cargado automáticamente al crear la orden).
const RESPONSE_SLA_MS = 2 * 60 * 60 * 1000;
const isResponseOverdue = (o) => !o.technical?.arrivalAt && !!o.technical?.reportedAt && !["Completada", "Aprobada", "Facturada", "Suspendida"].includes(o.status) && (Date.now() - new Date(o.technical.reportedAt).getTime()) > RESPONSE_SLA_MS;
const BUDGET_STAGES = ["Borrador", "En preparación", "Enviado", "En seguimiento", "Aprobado", "Facturado", "Rechazado"];
const BUDGET_STAGE_PROBABILITY = { "Borrador": 10, "En preparación": 25, "Enviado": 50, "En seguimiento": 70, "Aprobado": 100, "Facturado": 100, "Rechazado": 0 };
const LABOR_ROLES = [
  { name: "Programador", cost: 50 }, { name: "Ingeniero", cost: 25 }, { name: "Asesor", cost: 20 },
  { name: "Programador AUX", cost: 45 }, { name: "Tablerista", cost: 17 }, { name: "Dibujante", cost: 17 },
  { name: "Administrativo", cost: 6 }, { name: "Ayudante", cost: 5 }, { name: "Programador Aprendiz", cost: 7 },
];
// "Mano de obra" se fusionó con "Ingeniería" (mismo perfil por defecto, mismo listado de roles
// completo, cero diferencia real): ya no aparece como opción del desplegable "Tipo" en el ítem de
// presupuesto, pero se mantiene aquí para que los presupuestos ya guardados con ese tipo sigan
// mostrándose como mano de obra (perfil editable, costo fijado por rol) en vez de romperse.
const LABOR_TYPES = ["Mano de obra", "Ingeniería", "Programación", "Montaje", "Puesta en marcha"];
const ADDITIONAL_COST_CATEGORIES = ["Retrabajo", "Ingeniería adicional", "Programación adicional", "Materiales", "Viáticos", "Terceros", "Otro"];
// Categorías fijas de pausa/interrupción, para poder filtrar y agregar en reportes en vez de
// depender solo del texto libre que carga cada técnico.
const PAUSE_CATEGORIES = ["Espera de repuesto", "Sin acceso al sitio", "Decisión del cliente", "Clima", "Corte de energía/servicios", "Descanso / almuerzo", "Disponibilidad del equipo/planta", "Otro"];
const DEFAULT_ROLE_BY_TYPE = { "Mano de obra": "Ingeniero", "Ingeniería": "Ingeniero", "Programación": "Programador", "Montaje": "Tablerista", "Puesta en marcha": "Ingeniero" };
const UNIT_OPTIONS = ["u", "hs", "mts", "gl"];
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
const PO_STAGES = ["Borrador", "Enviada", "Confirmada", "Recibida", "Cancelada"];
const isDeliveryOverdue = (po) => !!po.dueDate && po.dueDate < todayStr() && !["Recibida", "Cancelada"].includes(po.stage);
const PO_CURRENCIES = ["USD", "ARS", "EUR"];
const PO_VAT_RATES = [10.5, 21];
const PO_STAGE_STYLE = {
  "Borrador": "bg-slate-100 text-slate-600 ring-slate-200", "Enviada": "bg-sky-50 text-sky-700 ring-sky-200",
  "Confirmada": "bg-violet-50 text-violet-700 ring-violet-200", "Recibida": "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "Cancelada": "bg-rose-50 text-rose-700 ring-rose-200",
};
const emptyPurchaseOrderItem = () => ({ description: "", sku: "", qty: 1, unit: "u", unitPrice: "", currency: "USD", vatRate: 21, exchangeRate: 1 });
const poItemMath = (item) => {
  const currency = PO_CURRENCIES.includes(item.currency) ? item.currency : "USD";
  const vatRate = PO_VAT_RATES.includes(Number(item.vatRate)) ? Number(item.vatRate) : 21;
  const qty = Math.max(0, Math.round(Number(item.qty) || 0));
  const unitPrice = Number(item.unitPrice) || 0;
  const exchangeRate = currency === "USD" ? 1 : Number(item.exchangeRate) || 0;
  const netAmount = Math.round(qty * unitPrice * 100) / 100;
  const vatAmount = Math.round(netAmount * vatRate) / 100;
  const grossAmount = Math.round((netAmount + vatAmount) * 100) / 100;
  const netAmountUsd = Math.round((exchangeRate > 0 ? netAmount / exchangeRate : 0) * 100) / 100;
  const vatAmountUsd = Math.round((exchangeRate > 0 ? vatAmount / exchangeRate : 0) * 100) / 100;
  const grossAmountUsd = Math.round((netAmountUsd + vatAmountUsd) * 100) / 100;
  return { netAmount, vatAmount, grossAmount, netAmountUsd, vatAmountUsd, grossAmountUsd };
};
const MATERIAL_LIST_DISCIPLINES = ["Eléctricos", "Mecánicos", "Instrumentación", "Neumáticos", "Automatización", "Otro"];
const MATERIAL_LIST_STAGES = ["Borrador", "Enviado al cliente", "Cotizado", "Comprado", "Recibido"];
const MATERIAL_LIST_STAGE_STYLE = {
  "Borrador": "bg-slate-100 text-slate-600 ring-slate-200", "Enviado al cliente": "bg-sky-50 text-sky-700 ring-sky-200",
  "Cotizado": "bg-violet-50 text-violet-700 ring-violet-200", "Comprado": "bg-amber-50 text-amber-700 ring-amber-200",
  "Recibido": "bg-emerald-50 text-emerald-700 ring-emerald-200",
};
const MATERIAL_LIST_DEFAULT_NOTES = [
  "Los datos de cómputos y unidades presentados en este documento son provistos solo a efectos orientativos, pudiendo presentar cierto grado de incerteza producto de la calidad y metodología de la medición empleada. Es responsabilidad de los oferentes verificar las cantidades a suministrar de la mejor manera que consideren pertinente y ajustarlos o asumirlos como verdaderos.",
  "El formato aquí suministrado es a los efectos de facilitar la comparación y ecualización de ofertas. Se ruega no alterar la estructura de los ítems mayores que componen el alcance del trabajo y en caso de considerar necesario acrecentar el grado de apertura para brindar mayor detalle sobre algún ítem en particular, favor de hacerlo agregando líneas debajo de la línea al final. En caso de opcionales y/o variantes a lo especificado cotizar por separado dejándolo expresamente indicado.",
];
const emptyMaterialListItem = () => ({ ref: "", description: "", brand: "", qty: 1, unit: "un" });
const emptyMaterialListSection = () => ({ title: "", items: [emptyMaterialListItem()] });
const SIGNER_ROLES = ["Responsable de planta", "Mantenimiento", "Jefe o supervisor de mantenimiento", "Producción / Operaciones", "Ingeniería / Automatización", "Seguridad e Higiene", "Calidad", "Administración / Compras", "Contratista / Integrador"];
const SERVICE_PROFILES = {
  "Instalación": { assess: "Preparación", work: "Ejecución", symptom: "Alcance de la instalación y condición inicial", diagnosis: "Condiciones previas y requisitos técnicos", automation: true, installation: true },
  "Automatización": { assess: "Relevamiento", work: "Programación", symptom: "Necesidad funcional o comportamiento reportado", diagnosis: "Relevamiento técnico del sistema", rootCause: true, automation: true },
  "Eléctrico": { assess: "Diagnóstico", work: "Reparación", symptom: "Síntoma o falla eléctrica reportada", diagnosis: "Diagnóstico técnico / condición encontrada", rootCause: true },
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
// Antes Media (naranja) y Alta (ámbar) usaban tonos casi idénticos y no se distinguían de un
// vistazo. Ahora cada nivel tiene un color de familia distinta y va ganando intensidad: gris →
// azul → naranja fuerte → rojo sólido, para que la urgencia se note sin tener que leer el texto.
const prioMeta = { Baja: "bg-slate-100 text-slate-500", Media: "bg-sky-50 text-sky-700", Alta: "bg-orange-100 text-orange-800 font-semibold", Urgente: "bg-rose-600 text-white font-semibold" };
const typeMeta = { Tarea: "bg-brand-100 text-brand-700", Bug: "bg-rose-100 text-rose-700", Mejora: "bg-emerald-100 text-emerald-700", Historia: "bg-violet-100 text-violet-700" };

/* ===================================== Utils ===================================== */
function fileToImages(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => { const img = new Image(); img.onload = () => {
      const mk = (max, q) => { const s = Math.min(1, max / Math.max(img.width, img.height)); const w = Math.round(img.width * s), h = Math.round(img.height * s);
        const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h); return c.toDataURL("image/jpeg", q); };
      resolve({ report: mk(1600, 0.86), thumb: mk(320, 0.7) }); };
      img.onerror = reject; img.src = rd.result; };
    rd.onerror = reject; rd.readAsDataURL(file);
  });
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(rd.result);
    rd.onerror = reject;
    rd.readAsDataURL(file);
  });
}
const EVIDENCE_ACCEPT = "image/*,.pdf,application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv";
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

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
// Días laborables entre dos fechas (inclusive): lunes a viernes cuentan como día completo,
// sábado cuenta medio día (solo mediodía) y domingo no cuenta.
const businessDaysBetween = (startStr, endStr) => {
  if (!startStr || !endStr) return 0;
  const start = new Date(`${startStr}T00:00:00`);
  const end = new Date(`${endStr}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  let total = 0;
  for (let cursor = new Date(start); cursor <= end; cursor = addCalendarDays(cursor, 1)) {
    const day = cursor.getDay(); // 0 domingo, 6 sábado
    if (day === 0) continue;
    total += day === 6 ? 0.5 : 1;
  }
  return total;
};
const startOfCalendarWeek = (date) => addCalendarDays(date, -((date.getDay() + 6) % 7));
const isOverdue = (t) => t.due && t.due < todayStr() && t.status !== "Hecho";
// Vence en los próximos N días (por defecto 2), sin contar las que ya están vencidas.
const isDueSoon = (t, days = 4) => t.due && t.status !== "Hecho" && t.due >= todayStr() && t.due <= localDateKey(addCalendarDays(new Date(), days));
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

// Recharts identifica sus propias piezas (Bar, Pie) buscando un método estático
// (getComposedData) en el `type` de cada elemento hijo dentro de <BarChart>/<PieChart>. Envolver
// <Bar>/<Pie> en un componente propio (como se hacía antes, solo para inyectar animationDuration
// según prefers-reduced-motion) cambia ese `type` a una función sin ese estático: Recharts no logra
// calcular la geometría de la serie y las barras/porciones dejan de dibujarse, aunque ejes y grilla
// (que no dependen de ese estático) se vean normales. Por eso acá NO se envuelve: se reutiliza la
// clase real de Recharts y sólo se le pisan los defaultProps de animación.
const applyReducedMotionDefaults = () => {
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  RechartsBar.defaultProps = { ...RechartsBar.defaultProps, isAnimationActive: !reduced, animationDuration: 550, animationEasing: "ease-out" };
  RechartsPie.defaultProps = { ...RechartsPie.defaultProps, isAnimationActive: !reduced, animationDuration: 550, animationEasing: "ease-out" };
};
applyReducedMotionDefaults();
if (typeof window !== "undefined") window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", applyReducedMotionDefaults);
const Bar = RechartsBar;
const Pie = RechartsPie;

const Chip = ({ children, className = "", ...rest }) => (<span {...rest} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>{children}</span>);
const Box = ({ children, className = "", ...rest }) => (<div {...rest} className={`motion-card rounded-xl border border-slate-200 bg-white ${className}`}>{children}</div>);
const Panel = ({ title, action, children }) => (<div className="motion-card h-full rounded-xl border border-slate-200 bg-white p-4"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold leading-5 text-slate-900 sm:min-h-10">{title}</h3>{action}</div>{children}</div>);
const HelpHint = ({ text }) => <span tabIndex={0} aria-label={text} className="group/hint relative inline-flex cursor-help align-middle outline-none"><CircleHelp className="h-3.5 w-3.5 text-slate-400 transition-colors group-hover/hint:text-brand-600 group-focus-visible/hint:text-brand-600" /><span role="tooltip" className="pointer-events-none invisible absolute bottom-[calc(100%+0.4rem)] right-0 z-[80] w-64 rounded-lg bg-slate-900 px-3 py-2 text-left text-[11px] font-normal leading-relaxed text-white opacity-0 shadow-xl transition-opacity group-hover/hint:visible group-hover/hint:opacity-100 group-focus-visible/hint:visible group-focus-visible/hint:opacity-100">{text}</span></span>;
const L = ({ label, children, help = "", required = false, labelClass = "" }) => <label className="block"><span className={`mb-1 flex items-center gap-1 text-[11px] ${required ? "font-semibold text-slate-700" : "font-medium text-slate-500"} ${labelClass}`}>{label}{required && <span className="text-rose-500">*</span>}{help && <HelpHint text={help} />}</span>{children}</label>;
const ReqLabel = ({ children }) => <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-700">{children}<span className="text-rose-500">*</span></span>;
const Avatar = ({ user, size = 28 }) => (<div className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: user?.color || "#94a3b8", fontSize: size * 0.4 }} title={user?.name}>{initials(user?.name)}</div>);
// "caption" queda siempre visible (clave en móvil, donde no existe el hover del tooltip);
// "description" se reserva para el detalle más largo que solo hace falta ocasionalmente.
const Metric = ({ label, value, icon: Icon, tint, caption = "", description = "" }) => (
  <div tabIndex={description ? 0 : undefined} aria-label={description ? `${label}: ${value}. ${description}` : undefined} className={`motion-card group relative rounded-xl border border-slate-200 bg-white p-3 ${description ? "cursor-help outline-none hover:z-40 focus-visible:z-40 focus-visible:ring-2 focus-visible:ring-brand-500/40" : ""}`}>
    <div className="flex items-center justify-between"><span className="text-[11px] font-medium text-slate-500">{label}</span><Icon className={`h-4 w-4 ${tint}`} /></div>
    <div className="mt-0.5 text-lg font-semibold text-slate-900" style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
    {caption && <div className="mt-0.5 text-[10px] leading-snug text-slate-400">{caption}</div>}
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
  const [suppliers, setSuppliers] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [materialLists, setMaterialLists] = useState([]);
  const [whiteboardNotes, setWhiteboardNotes] = useState([]);
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  HIDE_COSTS = !!branding.hideAdminModules;
  const [module, setModule] = useState("orders");
  const [oView, setOView] = useState("list");
  const [oDetail, setODetail] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [oQ, setOQ] = useState(savedOrderFilters.q); const [oStatus, setOStatus] = useState(savedOrderFilters.status); const [oBillable, setOBillable] = useState(savedOrderFilters.billable);
  const [oTab, setOTab] = useState("list");
  const [pTab, setPTab] = useState("board");
  const [techTaskView, setTechTaskView] = useState(() => { try { return localStorage.getItem("ordengo_tech_task_view") || "work"; } catch { return "work"; } });
  const [pProj, setPProj] = useState(savedProjectFilters.project); const [pQ, setPQ] = useState(savedProjectFilters.q); const [pMine, setPMine] = useState(savedProjectFilters.mine);
  const [finishedMenuOpen, setFinishedMenuOpen] = useState(false);
  const finishedMenuRef = useRef(null);
  const [editing, setEditing] = useState(undefined);
  const [pwOpen, setPwOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);
  const [utilMenuOpen, setUtilMenuOpen] = useState(false);
  const utilMenuRef = useRef(null);
  const [bizMenuOpen, setBizMenuOpen] = useState(false);
  const bizMenuRef = useRef(null);
  // La fila de pestañas de escritorio puede desbordar en ventanas angostas; la barra de scroll
  // nativa queda oculta a propósito (estética), así que sin esto no habría ninguna señal visual
  // de que hay más pestañas para el costado — se podrían perder de vista sin que nadie lo note.
  const navTabsRef = useRef(null);
  const navTabsObserverRef = useRef(null);
  const [navScroll, setNavScroll] = useState({ left: false, right: false });
  // Evita re-render si el valor no cambió: si no, cada scroll/resize dispararía un setState con un
  // objeto nuevo (aunque left/right sean iguales) y React nunca podría "descartar" el render.
  const updateNavScroll = () => {
    const el = navTabsRef.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setNavScroll((current) => (current.left === left && current.right === right) ? current : { left, right });
  };
  // Con un callback ref nos enteramos apenas el elemento se monta (aunque sea condicional, como
  // acá con la vista de "Nueva orden"), sin depender de un useEffect con variables que todavía
  // no existen a esta altura del componente — así no se rompen las reglas de hooks.
  // useCallback con [] es clave: si no, React ve una función "nueva" en cada render, desmonta y
  // vuelve a montar el ref todo el tiempo, y cada montaje dispara otra actualización de estado
  // → bucle infinito de renders (la causa de la pantalla en blanco).
  const setNavTabsRef = useCallback((el) => {
    navTabsRef.current = el;
    navTabsObserverRef.current?.disconnect();
    navTabsObserverRef.current = null;
    if (!el) return;
    updateNavScroll();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateNavScroll);
      observer.observe(el); // ancho disponible (se achica/agranda la ventana)
      const inner = el.querySelector("nav"); if (inner) observer.observe(inner); // ancho del contenido (cambian las pestañas o sus badges)
      navTabsObserverRef.current = observer;
    }
  }, []);
  useEffect(() => {
    window.addEventListener("resize", updateNavScroll);
    return () => { window.removeEventListener("resize", updateNavScroll); navTabsObserverRef.current?.disconnect(); };
  }, []);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [projectEditor, setProjectEditor] = useState(null);
  const [pStale, setPStale] = useState(savedProjectFilters.stale);
  const [prefill, setPrefill] = useState(null);
  const [orderPrefill, setOrderPrefill] = useState(null);
  const [accessProj, setAccessProj] = useState(null); // proyecto cuyo acceso se está gestionando
  const [dupProj, setDupProj] = useState(null); // proyecto a duplicar
  const [whiteboardProjectFilter, setWhiteboardProjectFilter] = useState(""); // al saltar desde Proyectos a Notas, filtra por ese proyecto
  const [budgetCreateSignal, setBudgetCreateSignal] = useState(0);
  const [financeCreateSignal, setFinanceCreateSignal] = useState(0);
  const [purchaseOrderCreateSignal, setPurchaseOrderCreateSignal] = useState(0);
  const [materialListCreateSignal, setMaterialListCreateSignal] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [offlineCount, setOfflineCount] = useState(() => offlineQueueSize());
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [offlineSyncFailed, setOfflineSyncFailed] = useState(false);
  const [offlineRetry, setOfflineRetry] = useState(0);
  const toast = (msg, type = "info") => { const id = Date.now() + Math.random(); setToasts((t) => [...t, { id, msg, type, leaving: false }]); setTimeout(() => setToasts((t) => t.map((x) => x.id === id ? { ...x, leaving: true } : x)), 3200); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3450); };
  const navigateModule = (nextModule) => {
    if (nextModule !== module) {
      setBudgetCreateSignal(0); setFinanceCreateSignal(0); setPurchaseOrderCreateSignal(0); setMaterialListCreateSignal(0);
      setODetail(null); setEditingOrder(null); setEditing(undefined); setPrefill(null); setOrderPrefill(null);
      setProjectEditor(null); setAccessProj(null); setDupProj(null); setWhiteboardProjectFilter("");
      setConfirmDialog(null); setGlobalSearchOpen(false); setNotifOpen(false); setUtilMenuOpen(false); setBizMenuOpen(false); setFinishedMenuOpen(false); setMobileMoreOpen(false);
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
  useEffect(() => {
    if (!utilMenuOpen) return;
    const closeOutside = (event) => { if (utilMenuRef.current && !utilMenuRef.current.contains(event.target)) setUtilMenuOpen(false); };
    const closeWithKeyboard = (event) => { if (event.key === "Escape") setUtilMenuOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithKeyboard);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeWithKeyboard); };
  }, [utilMenuOpen]);
  useEffect(() => {
    if (!bizMenuOpen) return;
    const closeOutside = (event) => { if (bizMenuRef.current && !bizMenuRef.current.contains(event.target)) setBizMenuOpen(false); };
    const closeWithKeyboard = (event) => { if (event.key === "Escape") setBizMenuOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithKeyboard);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeWithKeyboard); };
  }, [bizMenuOpen]);
  useEffect(() => {
    if (!finishedMenuOpen) return;
    const closeOutside = (event) => { if (finishedMenuRef.current && !finishedMenuRef.current.contains(event.target)) setFinishedMenuOpen(false); };
    const closeWithKeyboard = (event) => { if (event.key === "Escape") setFinishedMenuOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithKeyboard);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeWithKeyboard); };
  }, [finishedMenuOpen]);
  useEffect(() => { setNotifOpen(false); }, [module]);

  const boot = async () => {
    const d = await api.bootstrap();
    setMe(d.me); setUsers(d.users); setClients(d.clients); setProjects(d.projects); setBudgets(d.budgets || []); setFinances(d.finances || []); setOrders((d.orders || []).map((order) => order.status === "En progreso" ? { ...order, status: "En proceso de ejecución" } : order)); setTasks(d.tasks); setBranding(d.branding || DEFAULT_BRANDING);
    setSuppliers(d.suppliers || []); setPurchaseOrders(d.purchaseOrders || []); setMaterialLists(d.materialLists || []); setWhiteboardNotes(d.whiteboardNotes || []);
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
    // Las pantallas TV (Monitor Oficina) quedan encendidas indefinidamente; re-consultan su propia
    // configuración (nombre, modo TV, rotación) periódicamente para reflejar cambios hechos por un admin
    // sin necesidad de recargar la página manualmente en el televisor.
    if (!me || me.role !== "monitor_oficina" || !online) return;
    const interval = window.setInterval(() => { boot().catch(() => {}); }, 60000);
    return () => window.clearInterval(interval);
  }, [me?.id, me?.role, online]);

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
    // Mientras se está viendo Proyectos, se refrescan las tareas periódicamente para reflejar
    // cambios hechos por otros usuarios (otro técnico, gerencia) sin tener que recargar a mano.
    if (!me || !online || module !== "projects") return;
    let cancelled = false;
    const refreshTasks = async () => { try { const fresh = await api.tasks(); if (!cancelled) setTasks(fresh || []); } catch {} };
    const onVisibility = () => { if (document.visibilityState === "visible") void refreshTasks(); };
    const timer = window.setInterval(refreshTasks, 10000);
    window.addEventListener("focus", refreshTasks);
    document.addEventListener("visibilitychange", onVisibility);
    void refreshTasks();
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", refreshTasks); document.removeEventListener("visibilitychange", onVisibility); };
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

  const tvSettings = me?.settings || {};
  useEffect(() => {
    if (me?.role !== "monitor_oficina" || !tvSettings.tvModeEnabled) return;
    // Un proyecto finalizado (active === false) no debe seguir rotando en la cartelera del
    // Monitor Oficina: ni se muestra ni cuenta para la animación de avance automático.
    const projectIds = projects.filter((project) => project.active !== false).map((project) => project.id);
    setModule("projects"); setPTab("board"); setPQ(""); setPMine(false); setPStale(false);
    setPProj((current) => projectIds.includes(current) ? current : (projectIds[0] || "all"));
    if (!tvSettings.tvCycleEnabled || projectIds.length < 2) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setPProj((current) => {
        const currentIndex = projectIds.indexOf(current);
        return projectIds[(currentIndex + 1 + projectIds.length) % projectIds.length];
      });
    }, Math.max(10, Number(tvSettings.tvCycleSeconds) || 30) * 1000);
    return () => window.clearInterval(interval);
  }, [me?.role, tvSettings.tvModeEnabled, tvSettings.tvCycleEnabled, tvSettings.tvCycleSeconds, projects.map((project) => `${project.id}:${project.active !== false}`).join("|")]);

  // Evita que la pantalla del televisor se suspenda mientras esté en modo TV.
  // El Wake Lock del navegador se libera solo si la pestaña pierde visibilidad; lo reactivamos al volver.
  useEffect(() => {
    if (me?.role !== "monitor_oficina" || !tvSettings.tvModeEnabled) return;
    if (!("wakeLock" in navigator)) return;
    let wakeLock = null;
    let cancelled = false;
    const requestLock = async () => { try { wakeLock = await navigator.wakeLock.request("screen"); } catch {} };
    requestLock();
    const onVisibility = () => { if (document.visibilityState === "visible" && !cancelled) requestLock(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisibility); wakeLock?.release().catch(() => {}); };
  }, [me?.role, tvSettings.tvModeEnabled]);

  const logout = () => { setToken(null); setMe(null); setModule("orders"); setOView("list"); };
  const err = (e) => toast(e?.message || "Ocurrió un error", "error");

  if (booting) return <div className="grid min-h-screen place-items-center bg-ink-900 text-slate-300"><div className="motion-page flex flex-col items-center gap-3" role="status" aria-label="Cargando OrdenGO"><div className="skeleton h-9 w-36 rounded-lg" /><Loader2 className="h-5 w-5 animate-spin" /></div></div>;
  if (!me) return <Login branding={branding} onLogin={async (email, password) => { const r = await api.login(email, password); setToken(r.token); await boot(); }} />;

  const isMgr = me.role === "admin" || me.role === "gerente";
  const isAdmin = me.role === "admin";
  const isMonitor = me.role === "monitor_oficina";
  const tvMode = isMonitor && tvSettings.tvModeEnabled;
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
    try {
      const u = await api.updateOrder(id, patch);
      setOrders((p) => p.map((o) => (o.id === id ? u : o)));
      // Mantenimiento preventivo con recurrencia: al completar la orden (recién en esta llamada,
      // no en cada guardado posterior mientras ya está Completada) se genera automáticamente el
      // próximo borrador para el mismo cliente/planta, para no depender de que alguien se acuerde
      // de duplicarla a mano.
      if (patch.status === "Completada" && Number(u.recurrenceMonths) > 0 && !u.recurrenceSpawnedId) {
        try {
          const nextDate = new Date(u.date || todayStr()); nextDate.setMonth(nextDate.getMonth() + Number(u.recurrenceMonths));
          const next = await api.createOrder({ client: u.client, site: u.site, siteCode: u.siteCode, contact: u.contact, service: u.service, recurrenceMonths: u.recurrenceMonths, equipo: u.equipo, technicians: u.technicians, rate: u.rate, currency: "USD", laborBillable: u.laborBillable, date: nextDate.toISOString().slice(0, 10), status: "Borrador" });
          setOrders((p) => [next, ...p]);
          const withLink = await api.updateOrder(id, { recurrenceSpawnedId: next.id });
          setOrders((p) => p.map((o) => (o.id === id ? withLink : o)));
          toast(`Próximo mantenimiento preventivo generado: ${next.id} (${nextDate.toLocaleDateString("es-AR")})`, "success");
        } catch (spawnError) { console.error("No se pudo generar el próximo mantenimiento preventivo:", spawnError); }
      }
      return u;
    } catch (e) { err(e); return false; }
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
    try {
      const s = exists ? await api.updateTask(t.id, t) : await api.saveTask(t);
      setTasks((p) => (p.some((x) => x.id === s.id) ? p.map((x) => (x.id === s.id ? s : x)) : [s, ...p]));
      // El servidor le da acceso automático al proyecto al responsable si es técnico (de campo u
      // oficina), ya que esos roles solo ven los proyectos habilitados en allowedUsers. Se refleja
      // acá mismo para que el diálogo de "Accesos" no quede desactualizado hasta el próximo reinicio.
      const assigneeUser = users.find((u) => u.id === s.assignee);
      if (assigneeUser && (assigneeUser.role === "tecnico" || assigneeUser.role === "tecnico_oficina")) {
        setProjects((p) => p.map((proj) => (proj.id === s.project && !(proj.allowedUsers || []).includes(s.assignee) ? { ...proj, allowedUsers: [...(proj.allowedUsers || []), s.assignee] } : proj)));
      }
      setEditing(undefined);
    } catch (e) { err(e); }
  };
  const onDeleteTask = async (id) => { try { await api.deleteTask(id); setTasks((p) => p.filter((x) => x.id !== id)); setEditing(undefined); } catch (e) { err(e); } };
  // Copia una tarea a otro proyecto: nace como una tarea nueva e independiente (ID propio del
  // proyecto destino, "Por hacer", sin comentarios ni historial), no se queda vinculada al original.
  const duplicateTask = async (source, targetProjectId) => {
    const { id, activity, createdAt, ...rest } = source;
    const copy = { ...rest, project: targetProjectId, id: nextTaskId(targetProjectId), status: "Por hacer" };
    try { const saved = await api.saveTask(copy); setTasks((p) => [saved, ...p]); toast(`Tarea duplicada en ${projects.find((p) => p.id === targetProjectId)?.key || "el proyecto"}`, "success"); } catch (e) { err(e); }
  };
  // Convierte una tarea del diagrama de Gantt en una tarea real de proyecto (tablero Kanban).
  // Queda con vencimiento = fin planificado en el Gantt, y con "ganttTaskId" para trazabilidad;
  // GanttChart.jsx marca la tarea de origen como convertida (linkedTaskId) para no duplicarla.
  // Si la tarea pertenece a una sección del Gantt (ej. "Comisionamiento"), ese nombre queda en la
  // descripción para poder ubicar la tarea dentro de la estructura jerárquica del cronograma.
  const convertGanttTaskToProjectTask = async (ganttTask, { assignee, priority, sectionName }) => {
    const draft = {
      id: nextTaskId(ganttTask.projectId),
      project: ganttTask.projectId,
      title: ganttTask.name,
      desc: `Generada desde el Gantt${sectionName ? ` · Sección: ${sectionName}` : ""} · ${ganttTask.durationDays ? `${ganttTask.durationDays} día(s) · ` : ""}${ganttTask.start} → ${ganttTask.end}`,
      assignee, priority, status: "Por hacer", type: "Tarea",
      due: ganttTask.end,
      ganttTaskId: ganttTask.id,
      createdAt: todayStr(),
    };
    const saved = await api.saveTask(draft);
    setTasks((p) => [saved, ...p]);
    return saved;
  };
  const setTaskStatus = async (id, status) => {
    const t = tasks.find((x) => x.id === id); if (!t || t.status === status) return;
    if (!online) { queueOfflineOperation("task:update", { id, patch: { status } }); setOfflineCount(offlineQueueSize()); setTasks((p) => p.map((x) => x.id === id ? { ...x, status, _offline: true } : x)); return; }
    try { const u = await api.updateTask(id, { status }); setTasks((p) => p.map((x) => (x.id === id ? u : x))); } catch (e) { err(e); }
  };
  const moveTask = (id, dir) => {
    const t = tasks.find((x) => x.id === id); if (!t) return;
    const i = T_STATUS.indexOf(t.status);
    setTaskStatus(id, T_STATUS[Math.min(T_STATUS.length - 1, Math.max(0, i + dir))]);
  };
  // Arrastrar una tarjeta la manda directo a la columna soltada (no solo un paso adelante/atrás
  // como las flechas), así que se necesita el estado de destino en vez de una dirección relativa.
  const moveTaskToStatus = (id, status) => setTaskStatus(id, status);
  const nextTaskId = (projectId) => { const key = projects.find((p) => p.id === projectId)?.key || "TASK"; const n = Math.max(0, ...tasks.filter((t) => t.id.startsWith(key + "-")).map((t) => parseInt(t.id.split("-")[1], 10) || 0)) + 1; return `${key}-${n}`; };
  const createProject = () => setProjectEditor({ mode: "create", name: "", key: "PRJ", color: PALETTE[projects.length % PALETTE.length] });
  const editProject = (id) => { const current = projects.find((p) => p.id === id); if (current) setProjectEditor({ mode: "edit", ...current }); };
  const saveProjectEditor = async (form) => { try { if (form.mode === "create") { const project = await api.createProject({ name: form.name, key: form.key, color: form.color, active: form.active !== false }); setProjects((items) => [...items, project]); } else { const project = await api.updateProject(form.id, { name: form.name, color: form.color, active: form.active !== false }); setProjects((items) => items.map((item) => item.id === form.id ? project : item)); setTasks((items) => items.map((task) => task.project === project.id ? { ...task, color: project.color } : task)); if (project.active === false && pProj === project.id) setPProj("all"); } setProjectEditor(null); toast("Proyecto guardado", "success"); } catch (e) { err(e); } };
  const deleteProject = async (id) => {
    const cur = projects.find((p) => p.id === id); if (!cur) return;
    const n = tasks.filter((t) => t.project === id).length;
    const linkedBudget = budgets.find((budget) => budget.projectId === id);
    setConfirmDialog({ title: `Eliminar ${cur.name}`, message: `Se eliminará el proyecto${n ? ` junto con ${n} tarea(s)` : ""}.${linkedBudget ? ` El presupuesto ${linkedBudget.number || linkedBudget.id} se conservará y volverá a habilitarse para crear otro proyecto.` : ""} Esta acción no se puede deshacer.`, confirmLabel: "Eliminar proyecto", danger: true, action: async () => { try { const result = await api.deleteProject(id); setProjects((x) => x.filter((y) => y.id !== id)); setTasks((x) => x.filter((t) => t.project !== id)); if (result?.budgets?.length) setBudgets((items) => items.map((item) => result.budgets.find((budget) => budget.id === item.id) || item)); setPProj("all"); toast("Proyecto eliminado y presupuesto desvinculado", "success"); } catch (e) { err(e); } } });
  };
  const saveAccess = async (id, allowedUsers) => {
    try { const p = await api.updateProject(id, { allowedUsers }); setProjects((x) => x.map((y) => (y.id === id ? p : y))); setAccessProj(null); toast("Accesos actualizados", "success"); } catch (e) { err(e); }
  };
  // Vista inversa de los accesos por proyecto: desde la ficha del empleado se elige a qué
  // proyectos queda asociado, actualizando el allowedUsers de cada proyecto afectado.
  const saveUserProjects = async (userId, projectIds) => {
    const selected = new Set(projectIds);
    const toUpdate = projects.filter((p) => selected.has(p.id) !== (p.allowedUsers || []).includes(userId));
    if (!toUpdate.length) return;
    try {
      const updated = await Promise.all(toUpdate.map((p) => api.updateProject(p.id, { allowedUsers: selected.has(p.id) ? [...new Set([...(p.allowedUsers || []), userId])] : (p.allowedUsers || []).filter((id) => id !== userId) })));
      setProjects((current) => current.map((p) => updated.find((u) => u.id === p.id) || p));
      toast("Proyectos actualizados", "success");
    } catch (e) { err(e); }
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
  const duplicateBudget = async (budget) => {
    const copy = { ...budget, title: `${budget.title} (copia)`, stage: "Borrador", probability: BUDGET_STAGE_PROBABILITY["Borrador"], probabilityOverridden: false, number: "", purchaseOrderNumber: "", purchaseOrderDate: "", purchaseOrderNotes: "", invoiceNumber: "", invoicedAt: "", invoiceDueDate: "", invoiceDetail: "", projectId: "", commercialLockedAt: "", approvedAt: "", sentAt: "", additionalCosts: [], negativeMarginReason: "", activity: [], createdAt: new Date().toISOString() };
    delete copy.id; delete copy._updatedAt;
    try { const saved = await api.createBudget(copy); setBudgets((items) => [saved, ...items]); toast(`Duplicado como ${saved.number || saved.id} (borrador)`, "success"); return saved; } catch (e) { err(e); return null; }
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
  // Para gastos autogenerados (desde una OT o una OC) solo se permite tocar el estado de pago —
  // el resto de los datos se sincroniza solo. Queda la fecha de pago guardada para trazabilidad.
  const markFinancePaid = async (id, paid = true) => {
    try { const saved = await api.updateFinance(id, { paymentStatus: paid ? "paid" : "pending", paidAt: paid ? todayStr() : "" }); setFinances((items) => items.map((item) => (item.id === saved.id ? { ...item, ...saved } : item))); toast(paid ? "Marcado como pagado" : "Marcado como pendiente de pago", "success"); return saved; } catch (e) { err(e); return null; }
  };
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
    // Retoma en el primer paso realmente incompleto, con las mismas reglas obligatorias del asistente
    // (síntoma Y diagnóstico son ambos obligatorios, no alcanza con uno solo) — así no se salta ningún dato pendiente.
    const step0Missing = !order.client || !(order.site || "").trim() || !(order.equipo || order.technical?.assetTag);
    const step1Missing = !(order.sintoma || "").trim() || !(order.technical?.diagnosis || "").trim() || !(order.photos || []).length;
    const step2Missing = !(order.solucion || "").trim() || !order.technical?.completedAt;
    const resumeStep = step0Missing ? 0 : step1Missing ? 1 : step2Missing ? 2 : 3;
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

  /* Proveedores */
  const addSupplierMgr = async (s) => { const saved = await api.addSupplier(s); setSuppliers((p) => (p.some((x) => x.id === saved.id) ? p.map((x) => (x.id === saved.id ? saved : x)) : [...p, saved])); return saved; };
  const updateSupplier = async (id, patch) => { const saved = await api.updateSupplier(id, patch); setSuppliers((p) => p.map((x) => (x.id === id ? saved : x))); };
  const removeSupplier = async (id) => { await api.deleteSupplier(id); setSuppliers((p) => p.filter((x) => x.id !== id)); };

  /* Órdenes de compra */
  const savePurchaseOrder = async (form, id) => {
    const saved = id ? await api.updatePurchaseOrder(id, form) : await api.createPurchaseOrder(form);
    setPurchaseOrders((p) => (p.some((x) => x.id === saved.id) ? p.map((x) => (x.id === saved.id ? saved : x)) : [...p, saved]));
    if (saved._generatedMovement) setFinances((p) => (p.some((x) => x.id === saved._generatedMovement.id) ? p.map((x) => (x.id === saved._generatedMovement.id ? saved._generatedMovement : x)) : [...p, saved._generatedMovement]));
    else setFinances((p) => p.filter((x) => x.sourcePurchaseOrderId !== saved.id));
    return saved;
  };
  const deletePurchaseOrder = async (id) => { await api.deletePurchaseOrder(id); setPurchaseOrders((p) => p.filter((x) => x.id !== id)); setFinances((p) => p.filter((x) => x.sourcePurchaseOrderId !== id)); };
  const duplicatePurchaseOrder = async (po) => {
    // Nace como Borrador y sin factura del proveedor: evita generar de nuevo la cuenta por pagar
    // y no arrastra un N° de factura que corresponde a la compra original.
    const { id, number, createdAt, activity, receivedAt, supplierInvoiceNumber, _updatedAt, _generatedMovement, ...rest } = po;
    try { const saved = await api.createPurchaseOrder({ ...rest, stage: "Borrador" }); setPurchaseOrders((p) => [saved, ...p]); toast(`Orden de compra duplicada: ${saved.number || saved.id}`, "success"); }
    catch (e) { err(e); }
  };

  /* Listados de materiales */
  const saveMaterialList = async (form, id) => {
    const saved = id ? await api.updateMaterialList(id, form) : await api.createMaterialList(form);
    setMaterialLists((p) => (p.some((x) => x.id === saved.id) ? p.map((x) => (x.id === saved.id ? saved : x)) : [...p, saved]));
    return saved;
  };
  const deleteMaterialList = async (id) => { await api.deleteMaterialList(id); setMaterialLists((p) => p.filter((x) => x.id !== id)); };
  const duplicateMaterialList = async (ml) => {
    const { id, number, createdAt, createdBy, createdByName, _updatedAt, ...rest } = ml;
    try { const saved = await api.createMaterialList({ ...rest, version: "1.0" }); setMaterialLists((p) => [saved, ...p]); toast(`Listado duplicado: ${saved.number || saved.id}`, "success"); }
    catch (e) { err(e); }
  };

  /* Pizarra: notas y dibujos */
  const saveWhiteboardNote = async (note) => {
    const { id, ...rest } = note;
    const saved = id ? await api.updateWhiteboardNote(id, rest) : await api.createWhiteboardNote(rest);
    setWhiteboardNotes((p) => (p.some((x) => x.id === saved.id) ? p.map((x) => (x.id === saved.id ? saved : x)) : [...p, saved]));
    return saved;
  };
  const deleteWhiteboardNote = async (id) => { await api.deleteWhiteboardNote(id); setWhiteboardNotes((p) => p.filter((x) => x.id !== id)); };

  /* Repuestos */
  const addPart = async (pt) => { const s = await api.addPart(pt); setParts((p) => (p.some((x) => x.id === s.id) ? p.map((x) => (x.id === s.id ? s : x)) : [...p, s])); };
  const updatePart = async (id, patch) => { const s = await api.updatePart(id, patch); setParts((p) => p.map((x) => (x.id === id ? s : x))); };
  const removePart = async (id) => { await api.deletePart(id); setParts((p) => p.filter((x) => x.id !== id)); };
  const lowStock = parts.filter((p) => typeof p.stock === "number" && typeof p.minStock === "number" && p.stock <= p.minStock).length;

  if (!isOffice && module === "orders" && oView === "new")
    return <NewOrder ger={isMgr} showInternal={isMgr || me.role === "tecnico"} me={me} clients={clients} users={users} parts={parts} knownOrders={orders} online={online} prefill={orderPrefill} toast={toast} onDeleted={(id) => { clearOrderDraft(me.id); setOrderPrefill(null); setOView("list"); toast(`La orden ${id} fue eliminada por un administrador. Debes abrir una OT nueva.`, "error"); }} onCancel={() => { setOrderPrefill(null); setOView("list"); }} onSave={async (order, currentOrderId, { stayOpen = false } = {}) => { const existingId = currentOrderId || orderPrefill?.existingOrderId; const saved = existingId ? await updateOrder(existingId, order) : await onSaveOrder(order, { stayOpen }); if (saved && !stayOpen) { setOrderPrefill(null); setOView("list"); } return saved; }} />;

  // Los módulos se agrupan por área de trabajo: Inicio/Órdenes/Proyectos quedan
  // como núcleo operativo sin agrupar (uso diario, incluye técnicos de campo);
  // el resto se organiza en Negocio (pipeline comercial → compras → resultado
  // financiero, de uso frecuente para gerencia) y Utilidades (herramientas y
  // catálogos de uso esporádico, plegados en un menú aparte).
  const modTabs = isMonitor ? [
    { id: "projects", label: "Proyectos", icon: LayoutGrid },
    { id: "whiteboard", label: "Notas", icon: Pencil, group: "Utilidades" },
  ] : [
    { id: "inicio", label: "Mi día", icon: Home },
    ...(isMgr ? [{ id: "panel", label: "Panel", icon: TrendingUp }] : []),
    ...(isOffice ? [] : [{ id: "orders", label: "Órdenes", icon: ClipboardList }]),
    { id: "projects", label: "Proyectos", icon: LayoutGrid },
    ...(isMgr && !branding.hideAdminModules ? [{ id: "budgets", label: "Presupuestos", icon: FileText, group: "Administración" }] : []),
    ...(isMgr ? [{ id: "clients", label: "Clientes", icon: Building2, group: "Administración" }] : []),
    ...(isMgr && !branding.hideAdminModules ? [{ id: "purchaseOrders", label: "Compras", icon: ShoppingCart, group: "Administración" }] : []),
    ...(isMgr || me.role === "tecnico" ? [{ id: "materialLists", label: "Materiales", icon: Package, group: "Administración" }] : []),
    ...(isMgr && !branding.hideAdminModules ? [{ id: "finances", label: "Finanzas", icon: DollarSign, group: "Administración" }] : []),
    { id: "whiteboard", label: "Notas", icon: Pencil, group: "Utilidades" },
    ...(isMgr ? [{ id: "inventory", label: "Inventario", icon: Wrench, badge: lowStock, group: "Utilidades" }] : []),
    ...(isAdmin ? [{ id: "team", label: "Equipo", icon: Users, group: "Utilidades" }] : []),
    ...(isAdmin ? [{ id: "settings", label: "Configuración", icon: Settings2, group: "Utilidades" }] : []),
  ];
  // Si el módulo activo no está permitido para el rol, caer en "Mi día"
  const allowedIds = modTabs.map((t) => t.id);
  const activeModule = allowedIds.includes(module) ? module : (isMonitor ? "projects" : "inicio");
  // En teléfono priorizamos las áreas operativas de uso diario. El resto
  // queda agrupado en “Más” por área (Negocio, Utilidades);
  // además de evitar etiquetas superpuestas, reduce cambios de contexto accidentales.
  // Elegidos a propósito por rol (no por posición en el arreglo): así un módulo nuevo agregado
  // en el medio de modTabs no puede empujar sin querer una pestaña de uso frecuente a "Más".
  // Monitor Oficina y técnico de oficina tienen 3 o menos módulos en total, entran todos igual.
  const mobilePrimaryIds = isMgr ? ["inicio", "panel", "orders", "projects"]
    : me.role === "tecnico" ? ["inicio", "orders", "projects", "whiteboard"]
    : modTabs.map((tab) => tab.id).slice(0, 4);
  const mobilePrimaryTabs = mobilePrimaryIds.map((id) => modTabs.find((tab) => tab.id === id)).filter(Boolean);
  const mobileExtraTabs = modTabs.filter((tab) => !mobilePrimaryIds.includes(tab.id));
  const mobileExtraGroups = mobileExtraTabs.reduce((groups, tab) => {
    const name = tab.group || "General";
    const existing = groups.find((g) => g.name === name);
    if (existing) existing.tabs.push(tab); else groups.push({ name, tabs: [tab] });
    return groups;
  }, []);
  const mobileMoreActive = mobileExtraTabs.some((t) => t.id === activeModule);
  const mobileMoreBadge = mobileExtraTabs.reduce((sum, t) => sum + (t.badge || 0), 0);
  // En escritorio, "Utilidades" y "Administración" se pliegan cada una en su propio
  // menú desplegable para que la barra no desborde el ancho disponible con muchas pestañas.
  const utilGroupTabs = modTabs.filter((tab) => tab.group === "Utilidades");
  const utilGroupActive = utilGroupTabs.some((tab) => tab.id === activeModule);
  const utilGroupBadge = utilGroupTabs.reduce((sum, tab) => sum + (tab.badge || 0), 0);
  const bizGroupTabs = modTabs.filter((tab) => tab.group === "Administración");
  const bizGroupActive = bizGroupTabs.some((tab) => tab.id === activeModule);
  const bizGroupBadge = bizGroupTabs.reduce((sum, tab) => sum + (tab.badge || 0), 0);

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
            {activeModule === "purchaseOrders" && <button onClick={() => setPurchaseOrderCreateSignal((value) => value + 1)} className="hidden items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 sm:inline-flex"><Plus className="h-4 w-4" /> Orden de compra</button>}
            {activeModule === "materialLists" && <button onClick={() => setMaterialListCreateSignal((value) => value + 1)} className="hidden items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 sm:inline-flex"><Plus className="h-4 w-4" /> Listado de materiales</button>}
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
        <div className={`mx-auto flex max-w-6xl items-stretch gap-1 px-2 ${tvMode ? "hidden" : "hidden sm:flex"}`}>
          <div className="relative min-w-0 flex-1">
            {navScroll.left && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8" style={{ background: "linear-gradient(to right, #2E2E2D, transparent)" }} />}
            <div ref={setNavTabsRef} onScroll={updateNavScroll} className="nav-tabs-scroll min-w-0 overflow-x-auto">
              <nav className="flex gap-0.5 pb-1">
                {modTabs.map(({ id, label, icon: Icon, badge, group }, index) => {
                  if (group === "Utilidades" || group === "Administración") return null;
                  const divider = group && group !== modTabs[index - 1]?.group && <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 self-center bg-slate-700" />;
                  return (
                    <React.Fragment key={id}>
                      {divider}
                      <button onClick={() => navigateModule(id)} className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 py-2 text-sm font-medium transition ${activeModule === id ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}><Icon className="h-4 w-4" /> {label}{badge > 0 && <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{badge}</span>}</button>
                    </React.Fragment>
                  );
                })}
              </nav>
            </div>
            {navScroll.right && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8" style={{ background: "linear-gradient(to left, #2E2E2D, transparent)" }} />}
          </div>
          {bizGroupTabs.length > 0 && (
            <>
              <span aria-hidden="true" className="my-2 w-px shrink-0 bg-slate-700" />
              <div ref={bizMenuRef} className="relative shrink-0 py-1">
                <button onClick={() => setBizMenuOpen((v) => !v)} aria-expanded={bizMenuOpen} aria-haspopup="menu" className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 py-2 text-sm font-medium transition ${bizGroupActive ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
                  <Briefcase className="h-4 w-4" /> Administración
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${bizMenuOpen ? "rotate-180" : ""}`} />
                  {bizGroupBadge > 0 && <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{bizGroupBadge}</span>}
                </button>
                {bizMenuOpen && (
                  <div role="menu" className="motion-popover absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 text-slate-800 shadow-lg">
                    {bizGroupTabs.map((tab) => (
                      <button key={tab.id} role="menuitem" onClick={() => { navigateModule(tab.id); setBizMenuOpen(false); }} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${activeModule === tab.id ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700 hover:bg-slate-50"}`}>
                        <tab.icon className="h-4 w-4 shrink-0" /> {tab.label}
                        {tab.badge > 0 && <span className="ml-auto grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{tab.badge}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          {utilGroupTabs.length > 0 && (
            <>
              <span aria-hidden="true" className="my-2 w-px shrink-0 bg-slate-700" />
              <div ref={utilMenuRef} className="relative shrink-0 py-1">
                <button onClick={() => setUtilMenuOpen((v) => !v)} aria-expanded={utilMenuOpen} aria-haspopup="menu" className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 py-2 text-sm font-medium transition ${utilGroupActive ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
                  <Settings2 className="h-4 w-4" /> Utilidades
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${utilMenuOpen ? "rotate-180" : ""}`} />
                  {utilGroupBadge > 0 && <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{utilGroupBadge}</span>}
                </button>
                {utilMenuOpen && (
                  <div role="menu" className="motion-popover absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 text-slate-800 shadow-lg">
                    {utilGroupTabs.map((tab) => (
                      <button key={tab.id} role="menuitem" onClick={() => { navigateModule(tab.id); setUtilMenuOpen(false); }} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${activeModule === tab.id ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700 hover:bg-slate-50"}`}>
                        <tab.icon className="h-4 w-4 shrink-0" /> {tab.label}
                        {tab.badge > 0 && <span className="ml-auto grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{tab.badge}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {(!online || offlineCount > 0) && <div className={`motion-banner sticky top-0 z-30 flex items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium text-white ${online && offlineSyncFailed ? "bg-rose-600" : online ? "bg-brand-600" : "bg-amber-600"}`} role="status">{!online ? <WifiOff className="h-4 w-4" /> : syncingOffline ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}{!online ? `${offlineCount ? `${offlineCount} cambio(s) guardado(s). ` : ""}Podés seguir trabajando sin conexión.` : offlineSyncFailed ? <><span>{offlineCount} cambio(s) pendientes por un error.</span><button type="button" onClick={() => setOfflineRetry((value) => value + 1)} className="inline-flex items-center gap-1 rounded border border-white/40 px-2 py-1 hover:bg-white/10"><RefreshCw className="h-3.5 w-3.5" /> Reintentar</button></> : `Sincronizando ${offlineCount} cambio(s)…`}</div>}
      <main className={`mx-auto px-3 py-4 pb-28 sm:px-4 sm:py-5 sm:pb-5 ${tvMode ? "max-w-none lg:px-7 lg:py-4" : "max-w-6xl"}`}>
        <div key={activeModule} className="motion-page">
        {activeModule === "inicio" && <MiDia me={me} tasks={tasks} orders={orders} purchaseOrders={purchaseOrders} finances={finances} budgets={budgets} userById={userById} onOpenTask={(t) => { navigateModule("projects"); setPTab("board"); setEditing(t); }} onOpenOrder={setODetail} onGoToPurchaseOrders={() => navigateModule("purchaseOrders")} onGoToBudgets={() => navigateModule("budgets")} ger={isMgr} />}
        {activeModule === "panel" && isMgr && <Dashboard orders={orders} users={users} tasks={tasks} parts={parts} budgets={budgets} onOpen={setODetail} onGo={(destination) => { if (destination === "billing") { navigateModule("orders"); setOTab("list"); setOBillable(true); } else if (destination === "budgets") navigateModule("budgets"); else if (destination === "inventory") navigateModule("inventory"); else if (destination === "projects") { navigateModule("projects"); setPTab("board"); setPStale(true); } }} />}
        {activeModule === "budgets" && isMgr && <BudgetsModule budgets={budgets} finances={finances} clients={clients} parts={parts} projects={projects} users={users} orders={orders} onOpenOrder={setODetail} me={me} createSignal={budgetCreateSignal} onConsumeCreate={() => setBudgetCreateSignal(0)} onSave={saveBudget} onDelete={deleteBudget} onDuplicate={duplicateBudget} onConvert={convertBudget} onCreateOrder={createOrderFromBudget} onInvoice={saveFinance} />}
        {activeModule === "finances" && isMgr && <FinanceModule movements={finances} projects={projects} budgets={budgets} clients={clients} branding={branding} createSignal={financeCreateSignal} onConsumeCreate={() => setFinanceCreateSignal(0)} onSave={saveFinance} onLoad={loadFinance} onDelete={deleteFinance} />}
        {activeModule === "inventory" && isMgr && <Inventory parts={parts} onAdd={addPart} onPatch={updatePart} onRemove={removePart} onErr={err} />}
        {activeModule === "orders" && (
          <>
            {isMgr && (
              <div className="mb-4 flex w-fit rounded-lg bg-slate-200 p-0.5">
                {[["list", "Órdenes", ClipboardList], ["report", "Reportes OT", BarChart3]].map(([id, lb, Ic]) => (
                  <button key={id} onClick={() => setOTab(id)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium ${oTab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}><Ic className="h-4 w-4" /> {lb}</button>
                ))}
              </div>
            )}
            {(!isMgr || oTab === "list")
              ? <OrdersHome {...{ orders, ger: isMgr, oQ, setOQ, oStatus, setOStatus, oBillable, setOBillable, exportCSV, onOpen: setODetail }} />
              : <MonthlyReport orders={orders} />}
          </>
        )}
        {activeModule === "projects" && (() => {
          const tvProjects = projects.filter((project) => project.active !== false);
          return (
          <>
            {tvMode && <div className="tv-project-banner relative mb-4 flex items-center gap-4 overflow-hidden rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
              <span className="h-10 w-2 shrink-0 rounded-full" style={{ background: tvProjects.find((project) => project.id === pProj)?.color || branding.primaryColor }} />
              <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{tvSettings.screenName || "Proyecto en pantalla"}</p><h1 className="truncate text-2xl font-bold text-slate-900">{tvProjects.find((project) => project.id === pProj)?.key || "—"} · {tvProjects.find((project) => project.id === pProj)?.name || "Sin proyectos disponibles"}</h1></div>
              <div className="hidden items-center gap-3 text-right lg:flex"><div><p className="text-xs font-semibold text-slate-600">{tvSettings.tvCycleEnabled && tvProjects.length > 1 ? `Rotación cada ${tvSettings.tvCycleSeconds} s` : "Vista fija"}</p><p className="text-[11px] text-slate-400">{Math.max(0, tvProjects.findIndex((project) => project.id === pProj) + 1)} de {tvProjects.length}</p></div><button type="button" onClick={() => document.documentElement.requestFullscreen?.()} title="Abrir pantalla completa" aria-label="Abrir pantalla completa" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Maximize2 className="h-5 w-5" /></button></div>
              {tvSettings.tvCycleEnabled && tvProjects.length > 1 && <span key={pProj} className="tv-cycle-progress absolute bottom-0 left-0 h-1 bg-brand-500" style={{ animationDuration: `${tvSettings.tvCycleSeconds}s` }} />}
            </div>}
            {!tvMode && <div className="mb-4 flex flex-wrap items-center gap-2">
              {/* Con Gantt sumado como 4ª pestaña, en móvil este grupo ya no entra completo en el
                  ancho de pantalla — sin esto, la última ("Reportes") quedaba cortada sin ningún
                  aviso de que había más para el costado. Ahora se puede desplazar horizontalmente. */}
              <div className="nav-tabs-scroll mr-1 flex max-w-full overflow-x-auto rounded-lg bg-slate-200 p-0.5">
                {(isMgr || isMonitor ? [["board", "Tablero", LayoutGrid], ["calendar", "Calendario", Calendar], ...(isMgr && pProj !== "all" ? [["gantt", "Gantt", GanttChartSquare]] : []), ["reports", "Reportes", BarChart3]] : [["work", "Mi trabajo", ListTodo], ["board", "Tablero", LayoutGrid], ["calendar", "Calendario", Calendar]]).map(([id, lb, Ic]) => {
                  const active = isMgr || isMonitor ? pTab === id : techTaskView === id;
                  return <button key={id} onClick={() => isMgr || isMonitor ? setPTab(id) : setTechTaskView(id)} className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium sm:px-3 ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}><Ic className="h-4 w-4" /> {lb}</button>;
                })}
              </div>
              <select value={pProj} onChange={(e) => setPProj(e.target.value)} className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium sm:w-auto">
                <option value="all">Todos los proyectos</option>{projects.filter((p) => p.active !== false || p.id === pProj).map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}{p.active === false ? " (Finalizado)" : ""}</option>)}
              </select>
              {projects.some((p) => p.active === false) && (
                <div ref={finishedMenuRef} className="relative shrink-0">
                  <button onClick={() => setFinishedMenuOpen((v) => !v)} aria-expanded={finishedMenuOpen} aria-haspopup="menu" className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium ${finishedMenuOpen || projects.find((p) => p.id === pProj)?.active === false ? "border-slate-400 bg-slate-100 text-slate-700" : "border-slate-200 bg-white text-slate-600"}`}><Folder className="h-4 w-4" /> Finalizados</button>
                  {finishedMenuOpen && (
                    <div role="menu" className="motion-popover absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 text-slate-800 shadow-lg">
                      {projects.filter((p) => p.active === false).map((p) => (
                        <button key={p.id} role="menuitem" onClick={() => { setPProj(p.id); setFinishedMenuOpen(false); }} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${pProj === p.id ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700 hover:bg-slate-50"}`}>
                          <span className="font-mono text-xs text-slate-400">{p.key}</span> {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {pProj !== "all" && whiteboardNotes.filter((n) => n.projectId === pProj).length > 0 && (
                <button onClick={() => { navigateModule("whiteboard"); setWhiteboardProjectFilter(pProj); }} title="Ver notas y dibujos vinculados a este proyecto" className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100">
                  <StickyNote className="h-4 w-4" /> {whiteboardNotes.filter((n) => n.projectId === pProj).length} nota(s)
                </button>
              )}
              {!["reports", "gantt"].includes(activeProjectView) && (<>
                <div className="relative w-full min-w-0 sm:min-w-[200px] sm:flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
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
              const finishedProjectIds = new Set(projects.filter((p) => p.active === false).map((p) => p.id));
              const vis = tasks.filter((t) => (pProj === "all" ? !finishedProjectIds.has(t.project) : t.project === pProj) && (!pMine || isMonitor || t.assignee === me.id) && (activeProjectView !== "board" || !pStale || isStale(t)) && (!pQ || `${t.id} ${t.title} ${t.desc}`.toLowerCase().includes(pQ.toLowerCase())));
              if (pTab === "reports" && (isMgr || isMonitor)) return <Reports tasks={vis} users={users} projects={projects} proj={pProj} whiteboardNotes={whiteboardNotes} onOpenNotes={(projectId) => { navigateModule("whiteboard"); setWhiteboardProjectFilter(projectId); }} />;
              if (activeProjectView === "calendar") return <WorkCalendar tasks={isMgr || isMonitor ? vis : vis.filter((task) => task.assignee === me.id)} orders={isOffice ? [] : orders.filter((order) => isMgr || order.tech === me.name || order.assignedTechs?.includes(me.name))} projects={projects} userById={userById} onOpenTask={setEditing} onOpenOrder={setODetail} showOrders={pProj === "all"} />;
              if (isMgr && activeProjectView === "gantt" && pProj !== "all") return <GanttChart projectId={pProj} projectName={projects.find((p) => p.id === pProj)?.name || pProj} users={users} toast={toast} onConvertToTask={convertGanttTaskToProjectTask} />;
              if (isMonitor) return <Board tasks={vis} projects={projects} userById={userById} onOpen={setEditing} onMove={moveTask} readOnly tvMode={tvMode} />;
              if (isMgr) return <Board tasks={vis} projects={projects} userById={userById} onOpen={setEditing} onMove={moveTask} onMoveToStatus={moveTaskToStatus} />;
              const technicianTasks = techTaskView === "work" ? vis.filter((task) => task.assignee === me.id) : vis;
              return techTaskView === "work" ? <FieldTaskList tasks={technicianTasks} projects={projects} onOpen={setEditing} onMove={moveTask} /> : <TechnicianBoard tasks={technicianTasks} projects={projects} userById={userById} onOpen={setEditing} onMove={moveTask} onMoveToStatus={moveTaskToStatus} />;
            })()}
          </>
          ); })()}
        {activeModule === "whiteboard" && <Whiteboard notes={whiteboardNotes} projects={projects} users={users} me={me} initialProjectId={whiteboardProjectFilter} onSave={saveWhiteboardNote} onDelete={deleteWhiteboardNote} onErr={err} />}
        {activeModule === "clients" && isMgr && <Clients clients={clients} orders={orders} onAdd={addClientMgr} onPatch={updateClient} onRemove={removeClient} onErr={err} />}
        {activeModule === "purchaseOrders" && isMgr && <PurchaseOrdersModule purchaseOrders={purchaseOrders} suppliers={suppliers} projects={projects} finances={finances} me={me} createSignal={purchaseOrderCreateSignal} onConsumeCreate={() => setPurchaseOrderCreateSignal(0)} onSave={savePurchaseOrder} onDelete={deletePurchaseOrder} onDuplicate={duplicatePurchaseOrder} onMarkPaid={markFinancePaid} onAddSupplier={addSupplierMgr} onPatchSupplier={updateSupplier} onRemoveSupplier={removeSupplier} onErr={err} />}
        {activeModule === "materialLists" && (isMgr || me.role === "tecnico") && <MaterialListsModule materialLists={materialLists} projects={projects} clients={clients} me={me} isMgr={isMgr} createSignal={materialListCreateSignal} onConsumeCreate={() => setMaterialListCreateSignal(0)} onSave={saveMaterialList} onDelete={deleteMaterialList} onDuplicate={duplicateMaterialList} onErr={err} />}
        {activeModule === "team" && isAdmin && <Team users={users} tasks={tasks} orders={orders} projects={projects} me={me} onAdd={addUser} onPatch={patchUser} onRemove={removeUser} onSaveUserProjects={saveUserProjects} onErr={err} />}
        {activeModule === "settings" && isAdmin && <SettingsModule branding={branding} onSaveBranding={saveBranding} />}

        {!tvMode && <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-400">Conectado al servidor · {me.name} ({ROLES[me.role]})</footer>}
        </div>
      </main>

      {oDetail && <OrderDetail ger={isMgr} users={users} projects={projects} order={orders.find((o) => o.id === oDetail.id) || oDetail} onClose={() => setODetail(null)} onUpdate={updateOrder} onAdvance={(id, st) => updateOrder(id, { status: st })} onExport={(o) => exportCSV([o], `${o.id}.csv`)} onDelete={deleteOrder} onComment={commentOrder} onDuplicate={duplicateOrder} onCreateTask={taskFromOrder} onContinue={["Borrador", "En progreso", "En proceso de ejecución"].includes((orders.find((o) => o.id === oDetail.id) || oDetail).status) ? continueOrder : null} onEdit={isAdmin ? setEditingOrder : null} me={me} />}
      {editingOrder && <OrderEditDialog order={orders.find((o) => o.id === editingOrder.id) || editingOrder} clients={clients} users={users} parts={parts} budgets={budgets} projects={projects} onClose={() => setEditingOrder(null)} onSave={async (patch) => { const saved = await updateOrder(editingOrder.id, patch); if (saved) { setEditingOrder(null); toast(`Orden ${editingOrder.id} actualizada`, "success"); } return saved; }} />}
      {editing !== undefined && <TaskModal task={editing} me={me} users={users.filter((u) => u.active && u.role !== "monitor_oficina")} projects={projects} canAssign={isMgr} canDelete={isMgr} readOnly={isMonitor} nextId={nextTaskId} onClose={() => { setEditing(undefined); setPrefill(null); }} onSave={onSaveTask} onDelete={onDeleteTask} onComment={commentTask} onDuplicate={duplicateTask} prefill={prefill} />}
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
      {accessProj && <ProjectAccess project={accessProj} users={users} onClose={() => setAccessProj(null)} onSave={saveAccess} />}
      {dupProj && <DuplicateProject project={dupProj} users={users} tasksCount={tasks.filter((t) => t.project === dupProj.id).length} onClose={() => setDupProj(null)} onDuplicate={doDuplicate} />}
      {me.mustChangePassword && <ChangePassword forced onDone={() => setMe((m) => ({ ...m, mustChangePassword: false }))} />}
      {globalSearchOpen && <GlobalSearch orders={orders} tasks={tasks} clients={clients} parts={parts} projects={projects} budgets={budgets} finances={finances} suppliers={suppliers} purchaseOrders={purchaseOrders} materialLists={materialLists} isMgr={isMgr} canSeeMaterialLists={isMgr || me.role === "tecnico"} onClose={() => setGlobalSearchOpen(false)} onSelect={(result) => { setGlobalSearchOpen(false); if (result.kind === "order") { navigateModule("orders"); setODetail(result.item); } else if (result.kind === "task") { navigateModule("projects"); setPTab("board"); setEditing(result.item); } else if (result.kind === "budget") navigateModule("budgets"); else if (result.kind === "finance") navigateModule("finances"); else if (result.kind === "client") navigateModule("clients"); else if (result.kind === "part") navigateModule("inventory"); else if (result.kind === "supplier" || result.kind === "purchaseOrder") navigateModule("purchaseOrders"); else if (result.kind === "materialList") navigateModule("materialLists"); }} />}
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
            <nav className="space-y-4" aria-label="Más opciones de navegación">
              {mobileExtraGroups.map((groupData) => (
                <div key={groupData.name}>
                  {groupData.name !== "General" && <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{groupData.name}</p>}
                  <div className="grid grid-cols-1 gap-2">
                    {groupData.tabs.map(({ id, label, icon: Icon, badge }) => (
                      <button key={id} onClick={() => { navigateModule(id); setMobileMoreOpen(false); }} className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${activeModule === id ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${activeModule === id ? "bg-brand-100" : "bg-slate-100"}`}><Icon className="h-5 w-5" /></span>
                        <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
                        {badge > 0 && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-rose-500 px-1.5 text-xs font-bold text-white">{badge}</span>}
                      </button>
                    ))}
                  </div>
                </div>
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

      {/* Botón de acción flotante (móvil). En la pestaña Gantt se oculta: ese botón siempre creaba
          una tarea del tablero Kanban, no una tarea del Gantt, y en pantallas chicas quedaba
          literalmente encima de los propios botones de la barra de herramientas del Gantt
          (que ya tiene su "Nueva tarea" correcta ahí mismo). */}
      {!isMonitor && (activeModule === "orders" || (activeModule === "projects" && activeProjectView !== "gantt") || activeModule === "budgets" || activeModule === "finances" || activeModule === "purchaseOrders" || activeModule === "materialLists") && (
        <button onClick={() => { if (activeModule === "orders") { clearOrderDraft(me.id); setOrderPrefill(null); setOView("new"); } else if (activeModule === "budgets") setBudgetCreateSignal((value) => value + 1); else if (activeModule === "finances") setFinanceCreateSignal((value) => value + 1); else if (activeModule === "purchaseOrders") setPurchaseOrderCreateSignal((value) => value + 1); else if (activeModule === "materialLists") setMaterialListCreateSignal((value) => value + 1); else setEditing(null); }} className="mobile-fab fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-brand-500 text-white shadow-lg shadow-brand-500/30 hover:bg-brand-400 sm:hidden" aria-label={activeModule === "orders" ? "Nueva orden" : activeModule === "budgets" ? "Nuevo presupuesto" : activeModule === "finances" ? "Nuevo movimiento" : activeModule === "purchaseOrders" ? "Nueva orden de compra" : activeModule === "materialLists" ? "Nuevo listado de materiales" : "Nueva tarea"}>
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
const LAST_EMAIL_KEY = "og_last_email";
function Login({ branding = DEFAULT_BRANDING, onLogin }) {
  const [email, setEmail] = useState(() => localStorage.getItem(LAST_EMAIL_KEY) || ""); const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!email || !pass) return;
    setBusy(true); setErr(null);
    try { await onLogin(email.trim(), pass); localStorage.setItem(LAST_EMAIL_KEY, email.trim()); }
    catch (e) { setErr({ message: e?.message || "No se pudo iniciar sesión", locked: e?.status === 429 }); setBusy(false); }
  };
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
                {err && (err.locked ? (
                  <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="text-xs leading-relaxed text-amber-800">
                      <b className="block font-semibold">Acceso bloqueado temporalmente</b>
                      Detectamos demasiados intentos fallidos con este correo. Por seguridad, esperá 15 minutos antes de volver a intentar. Si no fuiste vos, contactá al administrador.
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{err.message}</div>
                ))}
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
    try { const r = await api.changePassword(cur, n1); if (r?.token) setToken(r.token); setDone(true); }
    catch (e) { setMsg(e?.message || "No se pudo cambiar la contraseña."); }
    finally { setBusy(false); }
  };
  const mouseDownOnBackdrop = useRef(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) close(); }}>
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
  const mouseDownOnBackdrop = useRef(false);
  useDialogOpenClass();
  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}><div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="mobile-dialog mobile-sheet-content w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:pb-5" onClick={(e) => e.stopPropagation()}><div className={`mb-4 grid h-11 w-11 place-items-center rounded-xl ${danger ? "bg-rose-50 text-rose-600" : "bg-brand-50 text-brand-600"}`}>{danger ? <Trash2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}</div><h2 id="confirm-title" className="text-lg font-semibold text-slate-900">{title}</h2><p className="mt-2 text-sm leading-relaxed text-slate-500">{message}</p><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button onClick={onConfirm} className={`rounded-lg px-3 py-2.5 text-sm font-semibold text-white ${danger ? "bg-rose-600 hover:bg-rose-500" : "bg-brand-500 hover:bg-brand-400"}`}>{confirmLabel}</button></div></div></div>;
}

function ProjectEditor({ value, onClose, onSave }) {
  const [form, setForm] = useState(value);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const mouseDownOnBackdrop = useRef(false);
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}><div className="mobile-dialog mobile-sheet-content w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold text-slate-900">{form.mode === "create" ? "Nuevo proyecto" : "Editar proyecto"}</h2><p className="text-xs text-slate-500">Definí una identidad clara para las tareas.</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="space-y-3"><L label="Nombre"><input autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} className="u-input" placeholder="Nombre del proyecto" /></L><L label="Clave"><input disabled={form.mode === "edit"} value={form.key} onChange={(e) => set({ key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })} className="u-input font-mono" placeholder="AUT" /></L><L label="Color"><div className="flex flex-wrap gap-2">{PALETTE.map((color) => <button key={color} onClick={() => set({ color })} aria-label={`Color ${color}`} className={`h-9 w-9 rounded-full ring-2 ring-offset-2 ${form.color === color ? "ring-slate-700" : "ring-transparent"}`} style={{ background: color }} />)}</div></L><label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={form.active !== false} onChange={(e) => set({ active: e.target.checked })} /> Proyecto activo</label>{form.active === false && <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">Un proyecto finalizado deja de listarse por defecto en el selector de Proyectos. Podés reactivarlo cuando quieras.</p>}</div><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={!form.name.trim() || !form.key.trim()} onClick={() => onSave(form)} className="rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Guardar proyecto</button></div></div></div>;
}

function GlobalSearch({ orders, tasks, clients, parts, projects, budgets = [], finances = [], suppliers = [], purchaseOrders = [], materialLists = [], isMgr, canSeeMaterialLists, onClose, onSelect }) {
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
      ...(isMgr ? clients.filter((c) => `${c.name} ${c.site || ""} ${c.code || ""} ${clientSites(c).map((s) => `${s.name} ${s.code}`).join(" ")}`.toLowerCase().includes(q)).map((item) => ({ kind: "client", item, title: item.name, meta: `Cliente · ${clientSites(item).map((s) => s.name).join(", ") || "Sin ubicación"}`, icon: Building2 })) : []),
      ...(isMgr ? suppliers.filter((s) => `${s.name} ${s.code || ""} ${s.cuit || ""}`.toLowerCase().includes(q)).map((item) => ({ kind: "supplier", item, title: item.name, meta: `Proveedor · ${item.cuit || "Sin CUIT"}`, icon: Truck })) : []),
      ...(isMgr ? purchaseOrders.filter((po) => `${po.number || po.id} ${po.supplierName || ""} ${po.supplierInvoiceNumber || ""}`.toLowerCase().includes(q)).map((item) => ({ kind: "purchaseOrder", item, title: `${item.number || item.id} · ${item.supplierName}`, meta: `Orden de compra · ${item.stage} · ${money(item.grossAmountUsd)}`, icon: ShoppingCart })) : []),
      ...(canSeeMaterialLists ? materialLists.filter((ml) => `${ml.number || ml.id} ${ml.projectName || ""} ${ml.client || ""} ${ml.site || ""}`.toLowerCase().includes(q)).map((item) => ({ kind: "materialList", item, title: `${item.number || item.id} · ${item.projectName}`, meta: `Listado de materiales · ${item.discipline} · ${item.totalItems || 0} ítem(s)`, icon: Package })) : []),
      ...(isMgr ? parts.filter((p) => `${p.name} ${p.unit || ""}`.toLowerCase().includes(q)).map((item) => ({ kind: "part", item, title: item.name, meta: `Inventario · Stock ${item.stock ?? "—"}`, icon: Wrench })) : []),
    ];
    return found.slice(0, 12);
  }, [q, orders, tasks, clients, parts, projects, budgets, finances, suppliers, purchaseOrders, materialLists, isMgr]);
  const mouseDownOnBackdrop = useRef(false);
  return (
    <div className="motion-backdrop fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-3 pt-[8vh] sm:p-6 sm:pt-[12vh]" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
      <div className="motion-popover w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3"><Search className="h-5 w-5 shrink-0 text-slate-400" /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()} placeholder="Buscar órdenes, presupuestos, tareas o clientes…" className="min-w-0 flex-1 border-0 bg-transparent text-base text-slate-900 outline-none" /><button onClick={onClose} aria-label="Cerrar búsqueda" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="max-h-[60dvh] overflow-y-auto p-2">
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
const EXPENSE_CATEGORIES = ["Materiales y repuestos", "Viáticos", "Combustible", "Herramientas", "Servicios contratados", "Logística", "Software y licencias", "Impuestos", "Administración", "Órdenes de trabajo", "Otro"];
const PAYMENT_METHODS = ["Transferencia", "Efectivo", "Tarjeta", "Cuenta corriente", "Cheque", "Otro"];
const currencyAmount = (amount, currency = "USD") => `${currency} ${(Number(amount) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const currentMonth = () => todayStr().slice(0, 7);

// Recorte con corrección de perspectiva estilo CamScanner: apenas se abre, se autodetectan los
// bordes del papel (best-effort, por contraste de brillo contra el fondo) y se ofrecen las 4
// esquinas ya puestas — en el caso común (papel claro sobre un escritorio) la persona de
// administración solo tiene que apretar "Confirmar". Si el encuadre automático no queda bien
// (fondo claro, factura girada), puede arrastrar cualquiera de las 4 esquinas de forma
// independiente para ajustarla a mano antes de continuar.
function ImageCropModal({ imageUrl, onDiscard, onSkipCrop, onConfirm }) {
  useDialogOpenClass();
  const boxRef = useRef(null);
  const [corners, setCorners] = useState(null); // [{x,y}×4] TL,TR,BR,BL en fracción [0,1] | null mientras autodetecta
  const [detecting, setDetecting] = useState(true);
  const dragRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  useEffect(() => {
    let cancelled = false;
    setDetecting(true);
    autoDetectCorners(imageUrl).then((detected) => { if (!cancelled) { setCorners(detected); setDetecting(false); } });
    return () => { cancelled = true; };
  }, [imageUrl]);

  const pointFraction = (event) => {
    const box = boxRef.current.getBoundingClientRect();
    return { fx: clamp01((event.clientX - box.left) / box.width), fy: clamp01((event.clientY - box.top) / box.height) };
  };
  const onHandleDown = (index) => (event) => {
    event.preventDefault(); event.stopPropagation();
    event.target.setPointerCapture?.(event.pointerId);
    dragRef.current = { index, pointerId: event.pointerId };
  };
  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { fx, fy } = pointFraction(event);
    setCorners((current) => current.map((point, index) => (index === drag.index ? { x: fx, y: fy } : point)));
  };
  const onPointerUp = () => { dragRef.current = null; };

  const confirmCrop = () => {
    setBusy(true);
    const img = new Image();
    img.onload = () => {
      const srcCorners = corners.map((point) => ({ x: point.x * img.naturalWidth, y: point.y * img.naturalHeight }));
      const edgeLen = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
      const outWraw = (edgeLen(srcCorners[0], srcCorners[1]) + edgeLen(srcCorners[3], srcCorners[2])) / 2;
      const outHraw = (edgeLen(srcCorners[0], srcCorners[3]) + edgeLen(srcCorners[1], srcCorners[2])) / 2;
      const scale = Math.min(1, 1600 / Math.max(outWraw, outHraw));
      const outW = Math.max(1, Math.round(outWraw * scale)), outH = Math.max(1, Math.round(outHraw * scale));
      const canvas = warpPerspective(img, srcCorners, outW, outH);
      setBusy(false);
      onConfirm(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => { setBusy(false); onSkipCrop(); };
    img.src = imageUrl;
  };

  const handleCls = "absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-brand-500 shadow";
  const polygonPoints = corners ? corners.map((point) => `${point.x * 100},${point.y * 100}`).join(" ") : "";
  const maskPath = corners
    ? `M0,0 H100 V100 H0 Z M ${corners.map((point) => `${point.x * 100},${point.y * 100}`).join(" L ")} Z`
    : "";
  return <div className="motion-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/85 p-3">
    <div className="mobile-dialog flex max-h-[95dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 className="text-base font-semibold text-slate-900">Recortar comprobante</h2><p className="text-xs text-slate-500">{detecting ? "Detectando los bordes del papel…" : "Ajustá las esquinas si el encuadre automático no quedó exacto."}</p></div><button onClick={onDiscard} aria-label="Cerrar" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
      <div className="flex-1 overflow-auto bg-slate-900 p-3">
        <div ref={boxRef} className="relative mx-auto touch-none select-none" style={{ maxWidth: "100%", width: "fit-content" }}>
          <img src={imageUrl} alt="Comprobante a recortar" className="block max-h-[60dvh] select-none" draggable={false} />
          {detecting && <div className="absolute inset-0 flex items-center justify-center bg-black/50"><span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700"><Loader2 className="h-4 w-4 animate-spin" /> Detectando bordes…</span></div>}
          {corners && !detecting && <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d={maskPath} fillRule="evenodd" fill="rgba(0,0,0,0.6)" />
            <polygon points={polygonPoints} fill="none" stroke="#F18700" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
          </svg>}
          {corners && !detecting && corners.map((point, index) => <div key={index} className={handleCls} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} onPointerDown={onHandleDown(index)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button onClick={onSkipCrop} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Usar imagen completa</button>
        <button onClick={confirmCrop} disabled={busy || detecting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar y continuar</button>
      </div>
    </div>
  </div>;
}

function FinanceEntryModal({ movement, initialKind = "expense", projects, budgets, clients, branding, onClose, onSave }) {
  useDialogOpenClass();
  const [form, setForm] = useState({ kind: initialKind, concept: "", amount: "", currency: "USD", exchangeRate: 1, date: todayStr(), category: EXPENSE_CATEGORIES[0], paymentMethod: PAYMENT_METHODS[0], projectId: "", budgetId: "", clientId: "", supplier: "", receiptNumber: "", detail: "", attachmentUrl: "", attachmentName: "", vatIncluded: false, paymentStatus: "paid", paidAt: todayStr(), ...(movement || {}) });
  const [pickMode, setPickMode] = useState(!movement); const [saving, setSaving] = useState(false); const [processing, setProcessing] = useState(false);
  const [aiNotice, setAiNotice] = useState(null); // {ok, confidence} | null
  const [companyMismatch, setCompanyMismatch] = useState(null); // {receptorCuit, receptorName} | null
  const [mismatchConfirmed, setMismatchConfirmed] = useState(false);
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
  const [cropPending, setCropPending] = useState(null); // { dataUrl, fileName } | null — foto recién elegida, esperando recorte
  // Corre el OCR sobre la imagen ya recortada (o la original, si el usuario eligió no recortar) y
  // pre-completa el formulario. Nunca guarda solo — el usuario siempre revisa/corrige antes de
  // confirmar, ya que un monto mal leído contaminaría Finanzas.
  // "ocrSourceUrl" existe aparte de "dataUrl" para el caso PDF: el adjunto que se guarda como
  // evidencia es el PDF original (para poder abrirlo/descargarlo después tal cual), pero el OCR
  // necesita una imagen — así que corre sobre una imagen renderizada de la primera página, no
  // sobre el PDF en sí.
  const processReceiptImage = async (dataUrl, fileName, ocrSourceUrl = dataUrl) => {
    setProcessing(true); setAiNotice(null); setCompanyMismatch(null); setMismatchConfirmed(false);
    setForm((current) => ({ ...current, attachmentUrl: dataUrl, attachmentName: fileName }));
    try {
      const extracted = await parseReceiptImage(ocrSourceUrl);
      setForm((current) => ({
        ...current,
        concept: extracted.concept || current.concept,
        amount: Number(extracted.amount) > 0 ? Number(extracted.amount) : current.amount,
        currency: extracted.currency || current.currency,
        date: extracted.date || current.date,
        supplier: extracted.supplier || current.supplier,
        receiptNumber: extracted.receiptNumber || current.receiptNumber,
        vatIncluded: extracted.vatIncluded || current.vatIncluded,
      }));
      const foundSomething = extracted.amount || extracted.date || extracted.supplier || extracted.receiptNumber || extracted.concept;
      // Diagnóstico de calidad de la foto (oscura / quemada de luz / borrosa), medido sobre la
      // imagen real recién capturada — así el aviso apunta a la causa concreta en vez de un
      // genérico "revisá los datos", que es justo lo que se pidió: verificar iluminación y nitidez.
      const qualityHints = [];
      if (extracted.quality?.dark) qualityHints.push("la foto se ve oscura — probá con más luz directa sobre el papel");
      if (extracted.quality?.bright) qualityHints.push("la foto se ve sobreexpuesta/quemada de luz — evitá el flash de frente o el sol directo");
      if (extracted.quality?.blurry) qualityHints.push("la foto parece borrosa — apoyá el celular firme y esperá a que enfoque antes de sacarla");
      setAiNotice({ ok: !!foundSomething, rawText: extracted.rawText || "", qualityHints });
      // Un "gasto" debería estar facturado A la empresa configurada; si el CUIT del receptor que
      // detectó el OCR no coincide, probablemente es un comprobante de otra persona/empresa
      // (mezclado por error entre varios recibos, o de un gasto personal). No se bloquea el campo
      // de forma silenciosa: se avisa y se exige una confirmación explícita antes de poder guardar,
      // porque el OCR puede leer mal un dígito del CUIT y no queremos trabar un gasto legítimo.
      if (form.kind === "expense" && branding?.companyCuit && extracted.receptorCuit && extracted.receptorCuit !== branding.companyCuit) {
        setCompanyMismatch({ receptorCuit: extracted.receptorCuit, receptorName: extracted.receptorName });
      }
    } catch (error) {
      // Se guarda el motivo real (en vez de un mensaje genérico) para poder diagnosticar sin
      // acceso a los logs del servidor: fallo al descargar el modelo de idioma, imagen inválida, etc.
      console.error("No se pudo leer el comprobante:", error);
      setAiNotice({ ok: false, error: error?.message || "" });
    } finally { setProcessing(false); setPickMode(false); }
  };
  // Antes de correr el OCR sobre una foto, se deja recortar (como CamScanner) para descartar todo
  // lo que no sea la factura — mesa, mano, otros papeles. Un PDF no necesita ese recorte manual
  // (ya viene "plano"): se renderiza su primera página a imagen (pdf.js, 100% en el navegador) y
  // esa imagen alimenta el mismo OCR local que las fotos — el PDF original se conserva como
  // adjunto, la imagen renderizada es solo un paso intermedio para poder leerlo.
  const selectFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      if (file.size > MAX_DOCUMENT_BYTES) { setAiNotice({ ok: false, error: "El archivo supera los 5 MB permitidos." }); return; }
      const pdfDataUrl = await fileToDataUrl(file);
      try {
        const { pdfFirstPageToImage } = await import("./pdfToImage");
        const pageImage = await pdfFirstPageToImage(file);
        await processReceiptImage(pdfDataUrl, file.name, pageImage);
      } catch (error) {
        // Si pdf.js no logra renderizar la página (PDF escaneado con formato raro, protegido,
        // corrupto, etc.) el PDF igual queda guardado como evidencia — solo falla la lectura
        // automática, no la carga del comprobante.
        console.error("No se pudo renderizar el PDF para OCR:", error);
        setForm((current) => ({ ...current, attachmentUrl: pdfDataUrl, attachmentName: file.name }));
        setAiNotice({ ok: false, error: `No se pudo leer el PDF automáticamente (solo se analiza la primera página). ${error?.message || ""}`.trim() });
        setPickMode(false);
      }
      return;
    }
    const image = await fileToImages(file);
    setCropPending({ dataUrl: image.report, fileName: file.name });
  };
  const loadBnaRate = async () => { setRateLoading(true); setRateError(""); try { const quote = await api.bnaExchangeRate(); setRateInfo(quote); setForm((current) => ({ ...current, exchangeRate: quote.arsPerUsd, exchangeRateSource: "BNA dólar billete vendedor", exchangeRateUpdatedAt: quote.updatedAt })); } catch (error) { setRateError(error.message || "No se pudo consultar BNA"); } finally { setRateLoading(false); } };
  useEffect(() => { if (form.currency === "ARS" && (!movement || !form.exchangeRate)) loadBnaRate(); }, [form.currency]);
  const usd = form.currency === "USD" ? Number(form.amount) || 0 : Number(form.exchangeRate) > 0 ? (Number(form.amount) || 0) / Number(form.exchangeRate) : 0;
  const usdLabel = usd > 0 && usd < 0.01 ? `USD ${usd.toLocaleString("es-AR", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}` : money(usd);
  // Un importe carga con la moneda equivocada (ej. un monto en pesos seleccionado como "USD" sin
  // convertir) pasa desapercibido en el momento, pero después domina todos los gráficos de
  // Finanzas (un solo movimiento de USD 1,5M puede ser el 100% de "Exposición por moneda"). No se
  // bloquea, porque compras grandes reales existen, pero se exige confirmación explícita.
  const [unusualConfirmed, setUnusualConfirmed] = useState(false);
  const unusualAmount = usd > 100000;
  useEffect(() => { setUnusualConfirmed(false); }, [form.amount, form.currency, form.exchangeRate]);
  const submit = async () => { setSaving(true); const saved = await onSave(form); setSaving(false); if (saved) onClose(); };
  const mouseDownOnBackdrop = useRef(false);
  return <div className="motion-backdrop fixed inset-0 z-[70] flex items-end justify-center overflow-hidden bg-slate-900/60 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}><div role="dialog" aria-modal="true" aria-labelledby="finance-dialog-title" className="modal-frame mobile-dialog mobile-sheet-content flex h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
    <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4 py-3 sm:px-5 sm:py-4"><div><h2 id="finance-dialog-title" className="text-lg font-semibold text-slate-900">{movement ? "Editar movimiento" : `Registrar ${form.kind === "expense" ? "gasto" : "ingreso"}`}</h2><p className="text-xs text-slate-500">Ingresos, gastos y comprobantes de la operación</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"><div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1"><button onClick={() => selectKind("expense")} className={`rounded-lg py-2.5 text-sm font-medium ${form.kind === "expense" ? "bg-white text-brand-600 shadow-sm" : "text-slate-500"}`}>Gasto</button><button onClick={() => selectKind("income")} className={`rounded-lg py-2.5 text-sm font-medium ${form.kind === "income" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500"}`}>Ingreso</button></div>
      {pickMode ? <div className="mt-4"><h3 className="text-sm font-semibold text-slate-800">¿Cómo querés cargar el comprobante?</h3><div className="mt-3 space-y-2"><button onClick={() => setPickMode(false)} className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-slate-200 px-3 text-left hover:border-brand-300"><span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600"><ClipboardList className="h-5 w-5" /></span><span className="flex-1"><b className="block text-sm">Carga manual</b><span className="text-xs text-slate-500">Completá los datos del movimiento.</span></span><ChevronRight className="h-4 w-4 text-slate-400" /></button><label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 hover:border-brand-300"><span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600"><Camera className="h-5 w-5" /></span><span className="flex-1"><b className="block text-sm">Tomar una foto</b><span className="text-xs text-slate-500">Usala como evidencia durante la carga.</span></span><ChevronRight className="h-4 w-4 text-slate-400" /><input type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => selectFile(event.target.files?.[0])} /></label><label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 hover:border-brand-300"><span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600"><Upload className="h-5 w-5" /></span><span className="flex-1"><b className="block text-sm">Elegir imagen o PDF</b><span className="text-xs text-slate-500">Seleccioná una imagen o un PDF ya existente (máx. 5 MB).</span></span><ChevronRight className="h-4 w-4 text-slate-400" /><input type="file" accept="image/*,.pdf,application/pdf" className="hidden" onChange={(event) => selectFile(event.target.files?.[0])} /></label></div>{processing && <div className="mt-3 flex items-center gap-2 rounded-lg bg-brand-50 p-3 text-xs text-brand-700"><Loader2 className="h-4 w-4 animate-spin" /> Leyendo el comprobante…</div>}<div className="mt-3 rounded-xl bg-gradient-to-r from-brand-50 to-violet-50 p-3 text-xs text-brand-700"><b className="block">Lectura automática (OCR local)</b>Al elegir una foto, se intenta completar concepto, importe, moneda, fecha, proveedor y N.º de comprobante. Ningún OCR es 100% exacto: siempre revisá los datos antes de guardar, y si falta algo podés verlo en el texto reconocido. Los PDF también se leen automáticamente (solo la primera página).</div></div> : <div className="mt-4 space-y-3">{aiNotice && (aiNotice.ok ? <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700"><b className="block">Datos completados por OCR</b>Revisá los campos, sobre todo el importe y la fecha, antes de guardar. Si falta algún dato, buscalo en el texto reconocido de abajo.</div> : <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><b className="block">No se pudo completar los campos automáticamente</b>La imagen quedó guardada como evidencia; completá los datos manualmente.{aiNotice.error && <span className="mt-1 block text-slate-400">Motivo: {aiNotice.error}</span>}</div>)}{aiNotice?.qualityHints?.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><b className="block">La foto puede estar afectando la lectura</b><ul className="mt-1 list-disc space-y-0.5 pl-4">{aiNotice.qualityHints.map((hint) => <li key={hint}>{hint}</li>)}</ul><p className="mt-1.5">Si tenés la factura en PDF, subila directo en vez de sacarle una foto — se lee mejor y más rápido.</p></div>}{aiNotice?.rawText && <details className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs"><summary className="cursor-pointer font-medium text-slate-600">Ver texto reconocido por OCR (para copiar lo que falte)</summary><pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono text-[10px] leading-relaxed text-slate-600">{aiNotice.rawText}</pre></details>}{form.kind === "expense" && companyMismatch && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"><b className="block">Este comprobante no parece corresponder a {branding?.companyLegalName || branding?.companyName || "tu empresa"}</b>El CUIT detectado en el receptor es {formatCuit(companyMismatch.receptorCuit)}{companyMismatch.receptorName ? ` (${companyMismatch.receptorName})` : ""}, distinto al configurado ({formatCuit(branding?.companyCuit)}). Puede ser un comprobante de otra persona/empresa, o un error de lectura del OCR.<label className="mt-2 flex items-center gap-2 font-medium"><input type="checkbox" checked={mismatchConfirmed} onChange={(event) => setMismatchConfirmed(event.target.checked)} /> Confirmo que este gasto corresponde igual a mi empresa</label></div>}<L label="Concepto *"><input autoFocus value={form.concept} onChange={(event) => set("concept", event.target.value)} placeholder={form.kind === "expense" ? "Ej. Compra de sensor inductivo" : "Ej. Cobro de factura"} className="u-input" /></L><div className="grid grid-cols-2 gap-2"><L label="Importe *"><input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => set("amount", event.target.value)} placeholder="0,00" className="u-input" /></L><L label="Moneda"><select value={form.currency} onChange={(event) => { const currency = event.target.value; setForm((current) => ({ ...current, currency, exchangeRate: currency === "USD" ? 1 : "", exchangeRateSource: "", exchangeRateUpdatedAt: "" })); }} className="u-input"><option value="ARS">ARS · Peso argentino</option><option value="USD">USD · Dólar estadounidense</option><option value="EUR">EUR · Euro</option></select></L></div>{unusualAmount && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><b className="block">Importe inusualmente alto: {money(usd)}</b>Es fácil equivocarse de moneda (ej. cargar pesos como si fueran dólares) — un error así distorsiona todos los gráficos de Finanzas. Verificá el importe y la moneda antes de continuar.<label className="mt-2 flex items-center gap-2 font-medium"><input type="checkbox" checked={unusualConfirmed} onChange={(event) => setUnusualConfirmed(event.target.checked)} /> Confirmo que el importe y la moneda son correctos</label></div>}{form.currency !== "USD" && <><div className="grid grid-cols-2 gap-2"><L label={form.currency === "ARS" ? "Dólar BNA vendedor (ARS/USD)" : `Cambio (${form.currency} por USD)`}><input type="number" min="0" step="0.0001" readOnly={form.currency === "ARS" && !rateError} value={form.exchangeRate || ""} onChange={(event) => set("exchangeRate", event.target.value)} placeholder={rateLoading ? "Consultando BNA…" : form.currency === "ARS" ? "Cotización BNA" : "Ej. 0,92"} className={`u-input ${form.currency === "ARS" && !rateError ? "bg-slate-50" : ""}`} /></L><div className="rounded-lg bg-slate-50 px-3 py-2"><span className="block text-[11px] text-slate-400">Equivalente</span><b>{usdLabel}</b></div></div>{form.currency === "ARS" && <div className="flex items-center justify-between gap-2 text-[11px]"><span className={rateError ? "text-rose-600" : "text-slate-500"}>{rateError ? `${rateError} Puedes ingresar la cotización manualmente.` : (form.exchangeRate ? `BNA billete vendedor · ${rateInfo?.updatedAt || form.exchangeRateUpdatedAt ? new Date(rateInfo?.updatedAt || form.exchangeRateUpdatedAt).toLocaleString("es-AR") : "cotización registrada"}` : "Consultando cotización…")}</span><button type="button" onClick={loadBnaRate} disabled={rateLoading} className="font-medium text-brand-600">{rateLoading ? "Actualizando…" : "Actualizar"}</button></div>}</>}<div className="grid grid-cols-2 gap-2"><L label="Fecha *"><input type="date" value={form.date} onChange={(event) => set("date", event.target.value)} className="u-input" /></L>{form.kind === "expense" ? <L label="Categoría"><select value={form.category} onChange={(event) => set("category", event.target.value)} className="u-input">{EXPENSE_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></L> : <L label="Cliente"><select value={form.clientId || ""} onChange={(event) => set("clientId", event.target.value)} className="u-input"><option value="">Sin asociar</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></L>}</div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><L label="Proyecto"><select value={form.projectId || ""} onChange={(event) => selectProject(event.target.value)} className="u-input"><option value="">General / sin proyecto</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}</select></L><L label="Presupuesto">{form.kind === "expense" ? <div className={`min-h-10 rounded-lg border px-3 py-2 text-xs ${selectedLink.budget ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{selectedLink.budget ? <><b className="block">{selectedLink.budget.number || selectedLink.budget.id} · {selectedLink.budget.title}</b><span>Vinculado automáticamente</span></> : form.projectId ? "El proyecto no tiene un presupuesto aprobado." : "Se vinculará al seleccionar un proyecto."}</div> : <select value={form.budgetId || ""} onChange={(event) => set("budgetId", event.target.value)} className="u-input"><option value="">Sin asociar</option>{budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.number || budget.id} · {budget.title}</option>)}</select>}</L></div>{form.kind === "expense" && form.projectId && <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"><Link2 className="h-4 w-4 shrink-0 text-brand-600" /><div><b className="block text-slate-700">Trazabilidad del gasto</b><span className="text-slate-500">{selectedLink.clientName || "Cliente sin identificar"}{selectedLink.budget ? ` · ${selectedLink.budget.number || selectedLink.budget.id}` : " · pendiente de presupuesto aprobado"}</span></div></div>}<div className="grid grid-cols-2 gap-2"><L label={form.kind === "expense" ? "Proveedor" : "Pagador / referencia"}><input value={form.supplier || ""} onChange={(event) => set("supplier", event.target.value)} className="u-input" /></L><L label="Factura / comprobante"><input value={form.receiptNumber || ""} onChange={(event) => set("receiptNumber", event.target.value)} className="u-input" /></L></div><L label="Medio de pago"><select value={form.paymentMethod || ""} onChange={(event) => set("paymentMethod", event.target.value)} className="u-input">{PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}</select></L>{form.kind === "expense" && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!form.vatIncluded} onChange={(event) => set("vatIncluded", event.target.checked)} /> El importe incluye IVA (21%)</label>{form.vatIncluded && <p className="mt-1 text-[11px] text-slate-500">Neto estimado: {money(usd / 1.21)} · Crédito fiscal: {money(usd - usd / 1.21)}</p>}<div className="mt-3 grid grid-cols-2 gap-2"><L label="Estado de pago"><select value={form.paymentStatus || "paid"} onChange={(event) => { const paymentStatus = event.target.value; setForm((current) => ({ ...current, paymentStatus, paidAt: paymentStatus === "paid" ? (current.paidAt || current.date) : "" })); }} className="u-input"><option value="paid">Pagado</option><option value="pending">Pendiente de pago</option></select></L>{form.paymentStatus !== "pending" && <L label="Fecha de pago"><input type="date" value={form.paidAt || form.date} onChange={(event) => set("paidAt", event.target.value)} className="u-input" /></L>}</div>{form.paymentStatus === "pending" && <p className="mt-2 text-[11px] text-amber-600">Este gasto quedará como cuenta por pagar hasta que actualices su estado.</p>}</div>}<L label="Detalle"><textarea value={form.detail || ""} onChange={(event) => set("detail", event.target.value)} rows={3} className="u-input resize-none" /></L>{form.attachmentUrl ? <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-2">{form.attachmentUrl.startsWith("data:image") ? <img src={form.attachmentUrl} alt="Comprobante" className="h-16 w-16 rounded-lg object-cover" /> : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><FileText className="h-6 w-6" /></span>}<div className="min-w-0 flex-1"><b className="block truncate text-xs">{form.attachmentName || "Comprobante adjunto"}</b><span className="text-[11px] text-emerald-600">{form.attachmentUrl.startsWith("data:image") ? "Imagen vinculada" : "PDF vinculado"}</span></div><button onClick={() => setForm((current) => ({ ...current, attachmentUrl: "", attachmentName: "" }))} className="grid h-9 w-9 place-items-center rounded-lg text-rose-500"><Trash2 className="h-4 w-4" /></button></div> : <button onClick={() => setPickMode(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium"><Camera className="h-4 w-4" /> Adjuntar comprobante</button>}</div>}
    </div>{!pickMode && <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium">Cancelar</button><button disabled={saving || !form.concept.trim() || !(Number(form.amount) > 0) || !form.date || (form.currency !== "USD" && !(Number(form.exchangeRate) > 0)) || (form.kind === "expense" && companyMismatch && !mismatchConfirmed) || (unusualAmount && !unusualConfirmed)} onClick={submit} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40 ${form.kind === "expense" ? "bg-brand-500" : "bg-emerald-600"}`}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar {form.kind === "expense" ? "gasto" : "ingreso"}</button></div>}
  </div>
  {cropPending && <ImageCropModal imageUrl={cropPending.dataUrl} onDiscard={() => setCropPending(null)} onSkipCrop={() => { const { dataUrl, fileName } = cropPending; setCropPending(null); processReceiptImage(dataUrl, fileName); }} onConfirm={(cropped) => { const { fileName } = cropPending; setCropPending(null); processReceiptImage(cropped, fileName); }} />}
  </div>;
}

function FinanceModule({ movements, projects, budgets, clients, branding, createSignal, onConsumeCreate, onSave, onLoad, onDelete }) {
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
  useEffect(() => {
    loadBnaQuote();
    const interval = setInterval(loadBnaQuote, 15 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") loadBnaQuote(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const projectRows = projectFilter === "all" ? movements : movements.filter((movement) => movement.projectId === projectFilter);
  const monthRows = (key) => projectRows.filter((movement) => String(movement.date || "").slice(0, 7) === key);
  const sumKind = (rows, kind) => rows.filter((movement) => movement.kind === kind).reduce((sum, movement) => sum + (Number(movement.amountUsd) || 0), 0);
  const periodDate = new Date(`${period}-01T12:00:00`);
  const previousDate = new Date(periodDate); previousDate.setMonth(previousDate.getMonth() - 1);
  const previousPeriod = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, "0")}`;
  const inMonth = monthRows(period); const previousRows = monthRows(previousPeriod);
  const income = sumKind(inMonth, "income"); const billed = sumKind(inMonth, "invoice"); const expense = sumKind(inMonth, "expense"); const result = billed - expense;
  const paidExpense = inMonth.filter((movement) => movement.kind === "expense" && movement.paymentStatus !== "pending").reduce((sum, movement) => sum + (Number(movement.amountUsd) || 0), 0);
  const cashFlow = income - paidExpense;
  const vatDebit = inMonth.filter((movement) => movement.kind === "invoice").reduce((sum, movement) => sum + (Number(movement.vatAmountUsd) || 0), 0);
  const vatCredit = inMonth.filter((movement) => movement.kind === "expense" && movement.vatIncluded).reduce((sum, movement) => sum + (Number(movement.vatAmountUsd) || 0), 0);
  const vatPayable = vatDebit - vatCredit;
  const cumulativeBilled = sumKind(projectRows, "invoice"); const cumulativeCollected = projectRows.filter((movement) => movement.kind === "income" && (movement.projectId || movement.budgetId)).reduce((sum, movement) => sum + (Number(movement.amountUsd) || 0), 0); const receivable = Math.max(0, cumulativeBilled - cumulativeCollected);
  const payable = projectRows.filter((movement) => movement.kind === "expense" && movement.paymentStatus === "pending").reduce((sum, movement) => sum + (Number(movement.amountUsd) || 0), 0);
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
  if (vatPayable !== 0) insights.push({ tone: vatPayable > 0 ? "amber" : "emerald", title: vatPayable > 0 ? "IVA a pagar (posición estimada)" : "Saldo a favor de IVA (posición estimada)", text: `Débito ${money(vatDebit)} − crédito ${money(vatCredit)} = ${money(Math.abs(vatPayable))}${vatCredit === 0 ? ". Cargá el IVA de tus gastos para que el crédito fiscal se descuente." : "."}` });
  if (payable > 0) insights.push({ tone: "amber", title: "Cuentas por pagar", text: `Hay ${money(payable)} en gastos marcados como pendientes de pago.` });
  if (inMonth.length && !insights.length) insights.push({ tone: "emerald", title: "Indicadores bajo control", text: "No se detectaron desvíos relevantes con los umbrales actuales." });

  const visible = movements.filter((movement) => (projectFilter === "all" || movement.projectId === projectFilter) && (kindFilter === "all" || movement.kind === kindFilter) && (!query || `${movement.id} ${movement.concept} ${movement.supplier || ""} ${movement.receiptNumber || ""}`.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const openEdit = async (movement) => { setLoadingEdit(movement.id); const full = onLoad ? await onLoad(movement.id) : movement; setLoadingEdit(""); if (full) setEditor(full); };
  const Kpi = ({ label, value, comparison, icon: Icon, tint, detail, description, size = "sm" }) => <div tabIndex={0} aria-label={`${label}: ${value}. ${description}`} className={`motion-card group relative grid cursor-help grid-rows-[auto_auto_1fr] rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/40 outline-none hover:z-40 focus-visible:z-40 focus-visible:ring-2 focus-visible:ring-brand-500/40 ${size === "lg" ? "min-h-32 p-5" : "min-h-24 p-3.5"}`}>
    <div className="flex items-center justify-between gap-3"><span className={`font-medium leading-4 text-slate-500 ${size === "lg" ? "text-sm" : "text-[11px]"}`}>{label}</span><span className={`grid shrink-0 place-items-center rounded-lg bg-slate-50 ${size === "lg" ? "h-10 w-10" : "h-7 w-7"}`}><Icon className={`${size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"} ${tint}`} /></span></div>
    <b className={`mt-2 block whitespace-nowrap text-slate-900 ${size === "lg" ? "text-2xl sm:text-3xl" : "text-base sm:text-lg"}`}>{value}</b>
    <div className={`mt-1 self-end leading-4 ${size === "lg" ? "text-[11px]" : "text-[9px]"} ${comparison != null && comparison < 0 ? "text-rose-600" : "text-slate-400"}`}>{detail || fmtDelta(comparison)}</div>
    <div role="tooltip" className="pointer-events-none invisible absolute left-2 right-2 top-[calc(100%+0.45rem)] z-50 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-normal leading-relaxed text-white opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100">{description}</div>
  </div>;
  const EmptyChart = ({ children = "Sin datos para este período." }) => <div className="grid h-full place-items-center text-center text-xs leading-5 text-slate-400">{projectFilter === "all" && children === "No hay presupuestos aprobados vinculados." ? "Seleccioná un proyecto para analizar su ejecución." : children}</div>;
  const chartTooltip = (value) => money(value);
  const ars = (value) => `ARS ${(Number(value) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const bnaUpdatedAt = bnaQuote?.updatedAt ? new Date(bnaQuote.updatedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "";
  const exportPdf = () => {
    const kpis = [
      { label: "Ingresos cobrados", value: money(income) },
      { label: "Facturado", value: money(billed) },
      { label: "Egresos", value: money(expense) },
      { label: "Resultado (facturado - egresos)", value: money(result) },
      { label: "Flujo de caja (cobrado - pagado)", value: money(cashFlow) },
      { label: "Margen", value: `${margin.toFixed(1)}%` },
      { label: "IVA debito / credito / saldo", value: `${money(vatDebit)} / ${money(vatCredit)} / ${money(vatPayable)}` },
      { label: "Por cobrar", value: money(receivable) },
      { label: "Por pagar", value: money(payable) },
      { label: "Gastos con comprobante", value: `${receiptCompliance.toFixed(0)}%` },
    ];
    financeReportPDF(period, kpis, insights);
  };

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end"><div><h2 className="text-lg font-semibold text-slate-900">Finanzas</h2><p className="text-xs text-slate-500">Desempeño, eficiencia y control financiero · valores comparables en USD</p></div><button onClick={exportPdf} className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><FileText className="h-4 w-4" /> PDF</button><div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:ml-auto lg:w-auto"><L label="Proyecto"><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="u-input w-full lg:min-w-52"><option value="all">Toda la operación</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}</select></L><L label="Período de análisis"><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className="u-input w-full" /></L></div></div>

    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-2.5 text-xs" aria-label="Cotización vendedor del dólar Banco Nación Argentina — referencia externa">
      <span className="font-medium text-slate-500">Referencia · dólar BNA <span className="text-slate-400">(billete, vendedor)</span></span>
      {bnaQuote ? <b className="text-sm text-sky-700">USD 1 = {ars(bnaQuote.arsPerUsd)}</b> : bnaLoading ? <span className="flex items-center gap-1.5 text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando…</span> : <span className="font-medium text-rose-600">No disponible</span>}
      <span className="text-slate-400">{bnaError || (bnaQuote?.stale ? "Última cotización disponible" : bnaUpdatedAt ? `Actualizada ${bnaUpdatedAt} · se autoactualiza cada 15 min` : "Fuente: Banco Nación Argentina")}</span>
      <button type="button" onClick={loadBnaQuote} disabled={bnaLoading} title="Actualizar cotización del BNA" aria-label="Actualizar cotización del BNA" className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sky-600 hover:bg-sky-100 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${bnaLoading ? "animate-spin" : ""}`} /></button>
    </div>

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Kpi size="lg" label="Resultado operativo" value={money(result)} comparison={delta(result, previousResult)} icon={BarChart3} tint={result >= 0 ? "text-emerald-600" : "text-rose-600"} detail="Neto facturado − egresos incurridos" description="Resultado contable simplificado del período: facturación neta menos egresos incurridos (devengado). No representa caja disponible." />
      <Kpi size="lg" label="Flujo de caja" value={money(cashFlow)} icon={DollarSign} tint={cashFlow >= 0 ? "text-emerald-600" : "text-rose-600"} detail="Cobrado − egresos pagados" description="Movimiento real de efectivo del período: ingresos cobrados menos egresos efectivamente pagados (excluye gastos marcados como pendientes de pago)." />
    </div>

    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
      <Kpi label="Facturado neto" value={money(billed)} comparison={delta(billed, previousBilled)} icon={FileText} tint="text-sky-600" description="Facturas emitidas en el período sin IVA. No implica que el importe ya haya sido cobrado." />
      <Kpi label="Cobrado" value={money(income)} comparison={delta(income, previousIncome)} icon={TrendingUp} tint="text-emerald-600" description="Ingresos efectivamente registrados durante el período, independientemente de cuándo se emitió la factura." />
      <Kpi label="Por cobrar" value={money(receivable)} icon={Clock} tint={receivable > 0 ? "text-amber-600" : "text-emerald-600"} detail="Saldo acumulado vinculado" description="Diferencia acumulada entre facturación neta y cobros vinculados a proyectos o presupuestos." />
      <Kpi label="Por pagar" value={money(payable)} icon={Clock} tint={payable > 0 ? "text-amber-600" : "text-emerald-600"} detail="Gastos pendientes de pago" description="Suma de los gastos marcados como 'Pendiente de pago', acumulados según el filtro de proyecto elegido." />
      <Kpi label="Egresos" value={money(expense)} comparison={delta(expense, previousExpense) == null ? null : -delta(expense, previousExpense)} icon={TrendingDown} tint="text-rose-600" detail={fmtDelta(delta(expense, previousExpense))} description="Total de gastos incurridos en el período seleccionado, normalizados a USD (independiente de si ya se pagaron)." />
      <Kpi label="Posición de IVA" value={money(Math.abs(vatPayable))} icon={AlertTriangle} tint={vatPayable > 0 ? "text-amber-600" : "text-emerald-600"} detail={vatPayable > 0 ? `A pagar · débito ${money(vatDebit)} − crédito ${money(vatCredit)}` : "Saldo a favor"} description="Débito fiscal (IVA de facturas emitidas) menos crédito fiscal (IVA de gastos marcados como 'incluye IVA'). Requiere cargar el IVA en los gastos para ser preciso." />
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

    <div><Box className="p-4"><div className="flex flex-col gap-2 sm:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar concepto, proveedor o comprobante…" className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-500" /></div><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"><option value="all">Todos los movimientos</option><option value="expense">Gastos</option><option value="income">Cobros</option><option value="invoice">Facturas</option></select></div><div className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto">{visible.length === 0 ? <div className="py-10 text-center text-sm text-slate-400">No hay movimientos registrados.</div> : visible.map((movement) => { const project = projects.find((item) => item.id === movement.projectId); const invoice = movement.kind === "invoice"; return <div key={movement.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${invoice ? "bg-sky-50 text-sky-600" : movement.kind === "income" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>{invoice ? <FileText className="h-5 w-5" /> : movement.kind === "income" ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><b className="text-sm">{movement.concept}</b><span className="font-mono text-[10px] text-slate-400">{movement.id}</span>{movement.budgetId && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">{movement.budgetNumber || budgets.find((item) => item.id === movement.budgetId)?.number || movement.budgetId}</span>}{movement.sourceOrderId && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Automático · OT {movement.sourceOrderId}</span>}{movement.sourcePurchaseOrderId && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">Automático · OC {movement.purchaseOrderNumber || movement.sourcePurchaseOrderId}</span>}{movement.kind === "expense" && movement.paymentStatus === "pending" && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Pendiente de pago</span>}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{budgetDate(movement.date)}{project ? ` · ${project.key}` : ""}{movement.category ? ` · ${movement.category}` : ""}{movement.receiptNumber ? ` · ${movement.receiptNumber}` : ""}{movement.purchaseOrderNumber ? ` · OC ${movement.purchaseOrderNumber}` : ""}{movement.kind === "expense" && movement.vatIncluded ? ` · IVA cred. ${money(movement.vatAmountUsd)}` : ""}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 sm:shrink-0 sm:justify-end sm:gap-3">
                  <div className="text-left sm:text-right"><b className={invoice ? "text-sky-700" : movement.kind === "income" ? "text-emerald-600" : "text-rose-600"}>{invoice ? "" : movement.kind === "income" ? "+" : "−"}{currencyAmount(movement.amount, movement.currency)}</b>{movement.currency !== "USD" && <span className="block text-[10px] text-slate-400">{money(movement.amountUsd)}</span>}{movement.arsReference?.grossArs && <span className="block text-[10px] text-slate-400">≈ {ars(movement.arsReference.grossArs)}</span>}</div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {(movement.hasAttachment || movement.attachmentUrl) && <span title="Comprobante adjunto" className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><FileText className="h-4 w-4" /></span>}
                    {!invoice && !movement.sourceOrderId && !movement.sourcePurchaseOrderId && <button disabled={loadingEdit === movement.id} onClick={() => openEdit(movement)} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-50">{loadingEdit === movement.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}</button>}
                    {!movement.sourceBudgetId && !movement.sourceOrderId && !movement.sourcePurchaseOrderId && <button onClick={() => onDelete(movement)} className="grid h-10 w-10 place-items-center rounded-lg border border-rose-200 text-rose-500"><Trash2 className="h-4 w-4" /></button>}
                  </div>
                </div>
              </div>; })}</div></Box></div>
    {editor && <FinanceEntryModal movement={editor.mode === "new" ? null : editor} initialKind={newKind} projects={projects} budgets={budgets} clients={clients} branding={branding} onClose={() => setEditor(null)} onSave={onSave} />}
  </div>;
}

/* ===================================== PRESUPUESTOS ===================================== */
const budgetDisplayStage = (budget) => {
  return budget.stage || "Borrador";
};
const budgetDate = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR") : "—";
// Mismo criterio que ya usa la creación de OT: por defecto el cliente/planta más frecuente
// (Corteva · Venado Tuerto), buscado por coincidencia parcial de nombre en vez de exacto porque
// el directorio puede tener variantes (ej. "[VTU] Corteva Seeds Argentina").
const defaultBudgetClient = (clients) =>
  clients.find((c) => /corteva/i.test(c.name || "") && clientSites(c).some((s) => /venado tuerto/i.test(s.name || "")))
  || clients.find((c) => /corteva/i.test(c.name || ""))
  || clients[0];
const emptyBudget = (me, clients) => {
  const client = defaultBudgetClient(clients);
  const site = clientSites(client).find((s) => /venado tuerto/i.test(s.name || "")) || clientSites(client)[0];
  return { number: "", clientId: client?.id || "", client: client?.name || "", site: site?.name || client?.site || "", title: "", service: "Automatización", stage: "Borrador", probability: BUDGET_STAGE_PROBABILITY.Borrador, targetMargin: 35, validUntil: "", expectedDecisionDate: "", plannedStart: "", plannedEnd: "", durationDays: 0, teamSize: 1, owner: me.name, contact: "", scope: "", assumptions: "", exclusions: "", risks: "", nextAction: "", nextFollowUp: "", items: [{ type: "Ingeniería", description: "Ingeniero", qty: 1, unit: "hs", unitPrice: 38.46, unitCost: 25 }] };
};

function BudgetEditor({ budget, clients, parts, me, orders = [], onOpenOrder, onClose, onSave }) {
  useDialogOpenClass();
  const [form, setForm] = useState(() => ({ ...emptyBudget(me, clients), ...(budget || {}), number: budget?.number || budget?.id || "", probabilityOverridden: Boolean(budget?.probabilityOverridden), probability: budget?.probabilityOverridden ? budget.probability : BUDGET_STAGE_PROBABILITY[budget?.stage || "Borrador"], items: (budget?.items || emptyBudget(me, clients).items).map((item) => ({ ...item })), additionalCosts: (budget?.additionalCosts || []).map((item) => ({ ...item })) }));
  const [saving, setSaving] = useState(false);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const setItem = (index, patch) => setForm((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  useEffect(() => {
    if (!form.plannedStart || !form.plannedEnd) return;
    const computed = businessDaysBetween(form.plannedStart, form.plannedEnd);
    if (computed !== form.durationDays) set("durationDays", computed);
  }, [form.plannedStart, form.plannedEnd]);
  const saleRate = (costValue, marginValue = form.targetMargin) => { const costRate = Number(costValue) || 0; const target = Math.min(100, Math.max(0, Number(marginValue) || 0)); return Math.round((target >= 100 ? costRate : costRate / (1 - target / 100)) * 100) / 100; };
  const changeLaborRole = (index, roleName) => { const role = LABOR_ROLES.find((item) => item.name === roleName); if (role) setItem(index, { description: role.name, unit: "hs", unitCost: role.cost, unitPrice: saleRate(role.cost) }); };
  // Al cambiar el Tipo de una línea, si el tipo anterior era mano de obra (ej. "Ingeniería") sus
  // datos (perfil, unidad "h", costo/venta del rol) quedaban pegados en la línea aunque el nuevo
  // tipo fuera "Materiales" — mostraba "Ingenier[ía]" como concepto y el costo/venta de un rol de
  // mano de obra en vez de los de Inventario. Se limpia la línea al pasar a un tipo no-laboral.
  const changeItemType = (index, type) => { if (LABOR_TYPES.includes(type)) { const role = LABOR_ROLES.find((item) => item.name === DEFAULT_ROLE_BY_TYPE[type]) || LABOR_ROLES[0]; setItem(index, { type, description: role.name, unit: "hs", unitCost: role.cost, unitPrice: saleRate(role.cost) }); } else setItem(index, { type, description: "", partId: null, unit: "u", unitPrice: 0, unitCost: 0 }); };
  const changeTargetMargin = (value) => { const targetMargin = Math.min(100, Math.max(0, Number(value) || 0)); setForm((current) => ({ ...current, targetMargin, items: current.items.map((item) => LABOR_TYPES.includes(item.type) ? { ...item, unitPrice: saleRate(item.unitCost, targetMargin) } : item) })); };
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
  const exportPdf = (audience) => budgetReportPDF(form, clients.find((client) => client.id === form.clientId), audience);
  const mouseDownOnBackdrop = useRef(false);
  // Trazabilidad: qué OTs se generaron a partir de este presupuesto (por vínculo directo, o por
  // compatibilidad con OTs viejas que solo guardaron el número de presupuesto en quoteNumber).
  const linkedOrders = form.id ? orders.filter((o) => o.budgetId === form.id || (form.number && (o.quoteNumber === form.number || o.budgetNumber === form.number))).sort((a, b) => (b.date || "").localeCompare(a.date || "")) : [];
  return <div className="motion-backdrop fixed inset-0 z-[60] flex items-end justify-center overflow-hidden bg-slate-900/60 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="budget-dialog-title" className="modal-frame mobile-dialog mobile-sheet-content flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 bg-white px-4 py-3 sm:px-5"><div className="min-w-0"><h2 id="budget-dialog-title" className="text-lg font-semibold text-slate-900">{form.id ? `Editar ${form.number || form.id}` : "Nuevo presupuesto"}</h2><p className="text-xs text-slate-500">Estimación técnica, comercial y planificación preliminar</p></div><div className="flex shrink-0 items-center gap-1.5">{form.id && <><button onClick={() => exportPdf("cliente")} title="Exportar PDF para el cliente" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><FileText className="h-4 w-4" /> PDF cliente</button><button onClick={() => exportPdf("interno")} title="Exportar PDF interno (con costo y margen)" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><FileText className="h-4 w-4" /> PDF interno</button></>}<button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div></div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        <Section title="Oportunidad y cliente"><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><L label="N.º de presupuesto"><input value={form.number || ""} onChange={(event) => set("number", event.target.value)} placeholder="Automático al guardar" className="u-input" /></L><L label="Cliente *"><select value={form.clientId} onChange={(event) => { const client = clients.find((item) => item.id === event.target.value); setForm((current) => ({ ...current, clientId: event.target.value, client: client?.name || "", site: clientSites(client)[0]?.name || "", contact: client?.contactName || "" })); }} className="u-input"><option value="">Seleccionar cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></L><L label="Sitio / planta">{clientSites(clients.find((c) => c.id === form.clientId)).length > 1 ? (<select value={form.site || ""} onChange={(event) => set("site", event.target.value)} className="u-input">{clientSites(clients.find((c) => c.id === form.clientId)).map((s) => <option key={s.code || s.name} value={s.name}>{s.name}{s.code ? ` (${s.code})` : ""}</option>)}</select>) : (<input value={form.site || ""} onChange={(event) => set("site", event.target.value)} className="u-input" />)}</L><L label="Nombre del presupuesto *"><input value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="Ej. Automatización celda de secado 2" className="u-input" /></L><L label="Tipo de servicio"><select value={form.service} onChange={(event) => set("service", event.target.value)} className="u-input">{SERVICE_TYPES.map((service) => <option key={service}>{service}</option>)}</select></L><L label="Contacto"><input value={form.contact || ""} onChange={(event) => set("contact", event.target.value)} placeholder="Nombre, correo o teléfono" className="u-input" /></L><L label="Responsable comercial"><input value={form.owner || ""} onChange={(event) => set("owner", event.target.value)} className="u-input" /></L></div></Section>

        <Section title="Estado y seguimiento"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><L label="Etapa"><select value={form.stage} onChange={(event) => { const stage = event.target.value; setForm((current) => ({ ...current, stage, probability: current.probabilityOverridden ? current.probability : BUDGET_STAGE_PROBABILITY[stage], invoicedAt: stage === "Facturado" ? current.invoicedAt || todayStr() : current.invoicedAt })); }} className="u-input">{BUDGET_STAGE_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.stages.map((stage) => <option key={stage}>{stage}</option>)}</optgroup>)}</select></L><L label={form.probabilityOverridden ? "Probabilidad (manual)" : "Probabilidad automática"}><div className="flex h-10 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-1"><input type="number" min="0" max="100" step="1" value={form.probability} onChange={(event) => setForm((current) => ({ ...current, probabilityOverridden: true, probability: Math.min(100, Math.max(0, Number(event.target.value) || 0)) }))} className="w-full min-w-0 border-0 bg-transparent px-2 text-sm font-semibold text-slate-700 outline-none" />%</div></L><L label="Válido hasta"><input type="date" value={form.validUntil || ""} onChange={(event) => set("validUntil", event.target.value)} className="u-input" /></L><L label="Decisión estimada"><input type="date" value={form.expectedDecisionDate || ""} onChange={(event) => set("expectedDecisionDate", event.target.value)} className="u-input" /></L></div><p className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">{form.probabilityOverridden ? "Probabilidad ajustada manualmente para esta oportunidad." : "La probabilidad se actualiza automáticamente según la etapa comercial."}{form.probabilityOverridden && <button type="button" onClick={() => setForm((current) => ({ ...current, probabilityOverridden: false, probability: BUDGET_STAGE_PROBABILITY[current.stage] }))} className="font-medium text-brand-600 hover:underline">Volver a automática</button>}</p><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"><L label="Próxima acción"><input value={form.nextAction || ""} onChange={(event) => set("nextAction", event.target.value)} placeholder="Llamar, enviar revisión, visita técnica…" className="u-input" /></L><L label="Próximo seguimiento"><input type="date" value={form.nextFollowUp || ""} onChange={(event) => set("nextFollowUp", event.target.value)} className="u-input" /></L></div></Section>
        {["Aprobado", "Facturado"].includes(form.stage) && <Section title="Orden de compra del cliente">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <L label="N.º de OC del cliente *"><input value={form.purchaseOrderNumber || ""} onChange={(event) => set("purchaseOrderNumber", event.target.value)} placeholder="Ej. OC 4500123456" className="u-input" /></L>
            <L label="Fecha de la OC"><input type="date" value={form.purchaseOrderDate || ""} onChange={(event) => set("purchaseOrderDate", event.target.value)} className="u-input" /></L>
          </div>
          <L label="Observaciones de la OC"><textarea rows={2} value={form.purchaseOrderNotes || ""} onChange={(event) => set("purchaseOrderNotes", event.target.value)} placeholder="Condiciones, posición, liberación, contacto o referencia interna del cliente" className="u-input resize-none" /></L>
          <p className="mt-2 text-[11px] text-slate-500">La OC quedará vinculada al presupuesto, al proyecto y a la factura para conservar la trazabilidad comercial.</p>
        </Section>}

        {form.id && <Section title={`Órdenes de trabajo vinculadas (${linkedOrders.length})`}>
          {linkedOrders.length === 0 ? <p className="text-xs text-slate-400">Todavía no se generó ninguna OT a partir de este presupuesto.</p> : (
            <div className="space-y-1.5">
              {linkedOrders.map((order) => <div key={order.id} onClick={() => onOpenOrder?.(order)} className={`flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2.5 text-xs ${onOpenOrder ? "cursor-pointer hover:border-brand-300 hover:bg-brand-50/40" : ""}`}>
                <span className="font-mono font-semibold text-slate-700">{order.id}</span>
                <Chip className={O_STYLE[order.status]}>{order.status}</Chip>
                <span className="text-slate-500">{order.equipo || order.service}</span>
                <span className="ml-auto text-slate-400">{order.date}</span>
              </div>)}
            </div>
          )}
        </Section>}

        {form.stage === "Facturado" && <Section title="Datos de facturación · IVA 21%"><div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><L label="N.º de factura *"><input value={form.invoiceNumber || ""} onChange={(event) => set("invoiceNumber", event.target.value)} placeholder="Ej. FC A 0001-00000123" className="u-input" /></L><L label="Fecha de facturación *"><input type="date" value={form.invoicedAt || ""} onChange={(event) => set("invoicedAt", event.target.value)} className="u-input" /></L><L label="Vencimiento"><input type="date" value={form.invoiceDueDate || ""} onChange={(event) => set("invoiceDueDate", event.target.value)} className="u-input" /></L></div><div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><span className="block text-[10px] uppercase text-slate-400">Neto sin IVA</span><b>{money(amount)}</b></div><div className="rounded-xl bg-amber-50 p-3"><span className="block text-[10px] uppercase text-amber-600">IVA 21%</span><b className="text-amber-700">{money(Math.round(amount * 21) / 100)}</b></div><div className="rounded-xl bg-sky-50 p-3"><span className="block text-[10px] uppercase text-sky-600">Total con IVA</span><b className="text-sky-700">{money(Math.round(amount * 121) / 100)}</b></div></div><L label="Detalle de factura"><input value={form.invoiceDetail || ""} onChange={(event) => set("invoiceDetail", event.target.value)} placeholder="Anticipo, hito, avance o saldo final" className="u-input" /></L><p className="mt-2 text-[11px] text-slate-500">Al guardar se generará o actualizará automáticamente la factura en Finanzas usando la fecha indicada.</p></Section>}

        <Section title="Alcance técnico"><textarea value={form.scope || ""} onChange={(event) => set("scope", event.target.value)} rows={4} placeholder="Equipos, señales, software, tableros, documentación, puesta en marcha y entregables" className="u-input resize-none" /><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3"><textarea value={form.assumptions || ""} onChange={(event) => set("assumptions", event.target.value)} rows={3} placeholder="Supuestos y condiciones" className="u-input resize-none" /><textarea value={form.exclusions || ""} onChange={(event) => set("exclusions", event.target.value)} rows={3} placeholder="Exclusiones" className="u-input resize-none" /><textarea value={form.risks || ""} onChange={(event) => set("risks", event.target.value)} rows={3} placeholder="Riesgos técnicos y dependencias" className="u-input resize-none" /></div></Section>

        <Section title="Planificación estimada"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><L label="Inicio previsto"><input type="date" value={form.plannedStart || ""} onChange={(event) => set("plannedStart", event.target.value)} className="u-input" /></L><L label="Fin previsto"><input type="date" value={form.plannedEnd || ""} onChange={(event) => set("plannedEnd", event.target.value)} className="u-input" /></L><L label="Duración (días)"><input type="number" min="0" step="1" value={form.durationDays || ""} onChange={(event) => set("durationDays", event.target.value)} className="u-input" /></L><L label="Equipo estimado"><input type="number" min="1" step="1" value={form.teamSize || 1} onChange={(event) => set("teamSize", event.target.value)} className="u-input" /></L></div></Section>

        <Section title="Estimación económica · USD">
          {commerciallyLocked && <div className="mb-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><div><b className="block">Estimación comercial cerrada</b><span>La venta, cantidades, tarifas, costos base y margen objetivo quedaron fijados al aprobar el presupuesto.</span></div></div>}
          <fieldset disabled={commerciallyLocked} className={commerciallyLocked ? "opacity-75" : ""}>
          <p className="text-[11px] leading-relaxed text-slate-500">Las horas de cada perfil toman automáticamente su costo interno. La tarifa de venta se calcula con el margen objetivo; materiales y repuestos toman venta y costo desde Inventario.</p>
          <div className="my-3 grid grid-cols-1 gap-2 rounded-xl border border-brand-100 bg-brand-50 p-3 sm:grid-cols-[12rem_minmax(0,1fr)]"><L label="Margen objetivo (%)"><input type="number" min="0" max="100" step="1" value={form.targetMargin ?? 35} onChange={(event) => changeTargetMargin(event.target.value)} className="u-input bg-white" /></L><div className="self-center text-xs text-brand-800"><b className="block">Tarifa sugerida = costo ÷ (1 − margen)</b><span className="text-[11px] text-brand-700">Puedes ajustar la tarifa de venta de una línea sin modificar su costo interno.</span></div></div>
          <datalist id="budget-parts">{parts.map((part) => <option key={part.id} value={part.name} />)}</datalist>
          <div className="space-y-2">{form.items.map((item, index) => { const labor = LABOR_TYPES.includes(item.type); const lineSale = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0); const lineCost = (Number(item.qty) || 0) * (Number(item.unitCost) || 0); return <div key={index} className="rounded-lg border border-slate-200 p-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
              <L label="Tipo"><select value={item.type || "Otro"} onChange={(event) => changeItemType(index, event.target.value)} aria-label="Tipo de concepto" className="u-input"><option>Ingeniería</option><option>Programación</option><option>Materiales</option><option>Montaje</option><option>Puesta en marcha</option><option>Viáticos</option><option>Otro</option></select></L>
              <L label="Perfil / concepto">{labor ? <select value={item.description || DEFAULT_ROLE_BY_TYPE[item.type]} onChange={(event) => changeLaborRole(index, event.target.value)} aria-label="Perfil de mano de obra" className="u-input">{LABOR_ROLES.map((role) => <option key={role.name} value={role.name}>{role.name}</option>)}</select> : <input list={item.type === "Materiales" ? "budget-parts" : undefined} value={item.description || ""} onChange={(event) => { const value = event.target.value; const part = parts.find((candidate) => candidate.name === value); setItem(index, part ? { description: value, partId: part.id, unit: part.unit || "u", unitPrice: part.price || 0, unitCost: part.cost || 0 } : { description: value, partId: null }); }} placeholder="Descripción" className="u-input" />}</L>
              <div className="flex justify-end sm:items-end sm:pb-0.5"><button onClick={() => set("items", form.items.filter((_, itemIndex) => itemIndex !== index))} title="Eliminar concepto" aria-label="Eliminar concepto" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <L label="Cantidad"><input type="number" min="0" step="1" value={item.qty} onChange={(event) => setItem(index, { qty: event.target.value })} onBlur={(event) => setItem(index, { qty: Math.max(0, Math.round(Number(event.target.value) || 0)) })} aria-label={labor ? "Horas estimadas" : "Cantidad"} className="u-input" /></L>
              <L label="Unidad"><select value={UNIT_OPTIONS.includes(item.unit) ? item.unit : (labor ? "hs" : "u")} onChange={(event) => setItem(index, { unit: event.target.value })} aria-label="Unidad" className="u-input">{UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></L>
              <L label="Venta/u (USD)"><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => setItem(index, { unitPrice: event.target.value })} placeholder="Venta" aria-label="Precio de venta unitario USD" className="u-input" /></L>
              <L label="Costo/u (USD)"><input type="number" min="0" step="0.01" value={item.unitCost} readOnly={labor} onChange={(event) => setItem(index, { unitCost: event.target.value })} placeholder="Costo" aria-label="Costo unitario USD" className={`u-input ${labor ? "bg-slate-50" : ""}`} /></L>
            </div>
            <div className="mt-2 flex flex-wrap justify-end gap-x-4 gap-y-1 text-[11px] text-slate-500"><span>Venta: <b>{money(lineSale)}</b></span><span>Costo: <b>{money(lineCost)}</b></span><span>Margen: <b className={lineSale - lineCost >= 0 ? "text-emerald-600" : "text-rose-600"}>{money(lineSale - lineCost)}</b></span></div>
          </div>; })}</div>
          <button onClick={() => set("items", [...form.items, { type: "Ingeniería", description: "Ingeniero", qty: 1, unit: "hs", unitPrice: saleRate(25), unitCost: 25 }])} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600"><Plus className="h-4 w-4" /> Agregar concepto</button>
          <div className="mt-4 grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-3"><div><span className="block text-[10px] uppercase text-slate-400">Venta presupuestada</span><b>{money(amount)}</b></div><div><span className="block text-[10px] uppercase text-slate-400">Costo interno estimado</span><b>{money(cost)}</b></div><div><span className="block text-[10px] uppercase text-slate-400">Margen bruto estimado</span><b className={margin >= 0 ? "text-emerald-600" : "text-rose-600"}>{money(margin)}{amount > 0 ? ` · ${Math.round((margin / amount) * 100)}%` : ""}</b></div></div>
          </fieldset>
          {margin < 0 && ["Aprobado", "Facturado"].includes(form.stage) && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3"><p className="mb-2 text-xs font-medium text-rose-700">El margen es negativo. Para aprobar o facturar este presupuesto, indicá el motivo (venta estratégica, cliente clave, riesgo de perder la cuenta, etc.).</p><textarea value={form.negativeMarginReason || ""} onChange={(event) => set("negativeMarginReason", event.target.value)} rows={2} placeholder="Motivo del margen negativo *" className="u-input resize-none bg-white" /></div>}
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
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={saving || invalidAdditionalCost || !form.client || !form.title.trim() || (["Aprobado", "Facturado"].includes(form.stage) && !form.purchaseOrderNumber?.trim()) || (form.stage === "Facturado" && (!form.invoicedAt || !form.invoiceNumber?.trim())) || (margin < 0 && ["Aprobado", "Facturado"].includes(form.stage) && !form.negativeMarginReason?.trim())} onClick={submit} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar presupuesto</button></div>
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
  const mouseDownOnBackdrop = useRef(false);
  return <div className="motion-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/60 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
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

function BudgetsModule({ budgets, finances, clients, parts, projects, orders = [], onOpenOrder, me, createSignal, onConsumeCreate, onSave, onDelete, onDuplicate, onConvert, onCreateOrder, onInvoice }) {
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
  // Se desglosa por cliente + planta (no solo cliente) porque un mismo cliente puede tener varias plantas.
  const approvedByClient = Object.values(approved.reduce((map, budget) => { const key = `${budget.client || "Sin cliente"}||${budget.site || ""}`; if (!map[key]) map[key] = { name: budget.client || "Sin cliente", site: budget.site || "", total: 0, count: 0 }; map[key].total += Number(budget.amount) || 0; map[key].count += 1; return map; }, {})).sort((a, b) => b.total - a.total);
  const projectRecommended = (budget) => (Number(budget.durationDays) || 0) > 2 || (Number(budget.teamSize) || 1) > 1 || (budget.items || []).length > 3 || (["Automatización", "Instalación"].includes(budget.service) && (Number(budget.durationDays) || 0) > 1);
  const groupSummary = BUDGET_GROUPS.map((group) => { const rows = budgets.filter((budget) => group.statuses.includes(budget.stage)); return { ...group, count: rows.length, total: rows.reduce((sum, budget) => sum + (Number(budget.amount) || 0), 0), breakdown: group.detail.map((name) => ({ name, count: rows.filter((budget) => budget.stage === name).length })) }; });
  const visible = budgets.filter((budget) => { const selectedGroup = stage.startsWith("group:") ? BUDGET_GROUPS.find((group) => group.id === stage.slice(6)) : null; const overdueFollowUp = !["Aprobado", "Facturado", "Rechazado"].includes(budget.stage) && budget.nextFollowUp && budget.nextFollowUp <= todayStr(); const stageMatches = stage === "Todos" || (selectedGroup ? selectedGroup.statuses.includes(budget.stage) : stage === "Vencido" ? overdueFollowUp : budget.stage === stage); return stageMatches && (!query || `${budget.number || budget.id} ${budget.title} ${budget.client} ${budget.site || ""}`.toLowerCase().includes(query.toLowerCase())); });
  return <div className="space-y-4">
    <div><h2 className="text-lg font-semibold text-slate-900">Gestión de presupuestos</h2><p className="text-xs text-slate-500">Seguimiento comercial de oportunidades y presupuestos de automatización, desde la primera estimación hasta la aprobación y facturación.</p></div>
    <div className="motion-list grid grid-cols-2 gap-3 lg:grid-cols-5"><Metric label="En negociación" value={money(pipeline)} icon={Briefcase} tint="text-brand-600" caption="En gestión, sin decidir todavía" description="Suma del valor neto de todos los presupuestos que todavía están en gestión comercial. No incluye aprobados, facturados ni rechazados." /><Metric label="Valor esperado" value={money(weighted)} icon={TrendingUp} tint="text-violet-600" caption="Ajustado por probabilidad de cierre" description="Valor esperado del pipeline: cada presupuesto abierto se multiplica por la probabilidad automática de su etapa comercial." /><Metric label="Negocio ganado" value={money(approvedTotal)} icon={CheckCircle2} tint="text-emerald-600" caption="Ganado, aún no facturado ni cobrado" description="Suma neta, sin IVA, de los presupuestos aprobados o ya facturados. Representa negocio ganado, no necesariamente cobrado." /><Metric label="Seguimientos vencidos" value={due} icon={AlertTriangle} tint={due ? "text-rose-600" : "text-emerald-600"} caption="Seguimientos que ya deberían hacerse" description="Cantidad de presupuestos abiertos cuyo próximo seguimiento estaba previsto para hoy o una fecha anterior." /><Metric label="Tasa de conversión" value={`${winRate}%`} icon={CheckCircle2} tint="text-emerald-600" caption="% de oportunidades ganadas" description="Porcentaje de oportunidades ganadas: presupuestos aprobados o facturados dividido por el total de decisiones cerradas, incluyendo rechazados." /></div>
    <Box className="p-3 sm:p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-900">Presupuestos por etapa comercial</h3><p className="text-[11px] text-slate-500">Cantidad y valor de tus presupuestos según en qué etapa de la negociación están: en preparación, en gestión, ganados o perdidos. Tocá una etapa para filtrar la lista de abajo.</p></div>{stage !== "Todos" && <button onClick={() => setStage("Todos")} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">Ver todo</button>}</div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">{groupSummary.map((item, index) => { const selected = stage === `group:${item.id}`; const tones = { slate: selected ? "border-slate-500 bg-slate-50" : "border-slate-200 bg-white", violet: selected ? "border-violet-500 bg-violet-50" : "border-violet-200 bg-white", emerald: selected ? "border-emerald-500 bg-emerald-50" : "border-emerald-200 bg-white", rose: selected ? "border-rose-500 bg-rose-50" : "border-rose-200 bg-white" }; const dots = { slate: "bg-slate-500", violet: "bg-violet-500", emerald: "bg-emerald-500", rose: "bg-rose-500" }; return <div key={item.id} className="relative flex items-center"><button onClick={() => setStage(selected ? "Todos" : `group:${item.id}`)} className={`w-full rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${tones[item.color]}`}><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${dots[item.color]}`} /><span className="text-xs font-semibold text-slate-700">{item.label}</span><b className="ml-auto text-xl text-slate-900">{item.count}</b></div><div className="mt-2 flex items-end justify-between gap-2"><span className="text-[10px] text-slate-400">{item.breakdown.map((row) => `${row.name}: ${row.count}`).join(" · ")}</span><span className="shrink-0 text-[10px] font-semibold text-slate-600">{money(item.total)}</span></div></button>{index < groupSummary.length - 1 && <ChevronRight className="absolute -right-3 z-10 hidden h-4 w-4 text-slate-300 xl:block" />}</div>; })}</div><div className="mt-3 flex flex-wrap gap-2 text-[10px]"><button onClick={() => setStage(stage === "Vencido" ? "Todos" : "Vencido")} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-medium ${stage === "Vencido" ? "bg-rose-100 text-rose-700" : due ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-500"}`}><AlertTriangle className="h-3.5 w-3.5" /> Seguimientos vencidos: {due}</button><span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1.5 font-medium text-sky-700"><FileText className="h-3.5 w-3.5" /> Facturados: {budgets.filter((budget) => budget.stage === "Facturado").length}</span></div></Box>
    {approvedByClient.length > 0 && <Box className="p-4"><div className="mb-3"><h3 className="text-sm font-semibold text-slate-900">Presupuestos aprobados por cliente</h3><p className="text-[11px] text-slate-500">Valor comercial contratado; todavía no representa facturación ni cobro.</p></div><div className="motion-list grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{approvedByClient.map((row) => <div key={`${row.name}||${row.site}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><span className="block truncate text-xs text-slate-500">{row.name}{row.site ? ` · ${row.site}` : ""}</span><b className="mt-1 block text-base text-slate-900">{money(row.total)}</b><span className="text-[10px] text-slate-400">{row.count} presupuesto(s) aprobado(s)</span></div>)}</div></Box>}
    <div className="flex flex-col gap-2 sm:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar presupuesto, cliente o planta…" className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-500" /></div><select value={stage} onChange={(event) => setStage(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="Todos">Todos los presupuestos</option><optgroup label="Grupos del pipeline">{BUDGET_GROUPS.map((group) => <option key={group.id} value={`group:${group.id}`}>{group.label}</option>)}</optgroup><optgroup label="Estado detallado">{BUDGET_STAGE_GROUPS.flatMap((group) => group.stages).map((item) => <option key={item} value={item}>{item}</option>)}<option value="Vencido">Seguimiento vencido</option></optgroup></select></div>
    {visible.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><FileText className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-2 text-sm font-semibold text-slate-700">Sin presupuestos para mostrar</h3><p className="mt-1 text-xs text-slate-400">Crea una oportunidad y registra su estimación técnica.</p></div> : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{visible.map((budget) => { const displayStage = budgetDisplayStage(budget); const margin = (Number(budget.amount) || 0) - (Number(budget.totalEstimatedCost ?? budget.estimatedCost) || 0); const followDue = budget.nextFollowUp && budget.nextFollowUp <= todayStr() && !["Aprobado", "Facturado", "Rechazado"].includes(budget.stage); const offerExpired = budget.validUntil && budget.validUntil < todayStr() && !["Aprobado", "Facturado", "Rechazado"].includes(budget.stage); const billed = finances.filter((movement) => movement.kind === "invoice" && movement.budgetId === budget.id).reduce((sum, movement) => sum + (Number(movement.amountUsd) || 0), 0); const project = projects.find((item) => item.id === budget.projectId); const ageDays = budget.createdAt ? daysSince(budget.createdAt) : null; const weightedValue = (Number(budget.amount) || 0) * (Number(budget.probability) || 0) / 100; return <Box key={budget.id} onClick={() => { setEditingBudget(budget); setEditorOpen(true); }} className="flex h-full cursor-pointer flex-col p-4 hover:border-brand-300"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold text-slate-700">{budget.number || budget.id}</span><Chip className={`${BUDGET_STYLE[displayStage]} ring-1`}>{displayStage}</Chip>{budget.purchaseOrderNumber && <Chip className="bg-sky-50 text-sky-700 ring-sky-200">OC {budget.purchaseOrderNumber}</Chip>}{Number(budget.additionalCostTotal) > 0 && <Chip className="bg-amber-50 text-amber-700 ring-amber-200">Costos extra {money(budget.additionalCostTotal)}</Chip>}{followDue && <Chip className="bg-rose-50 text-rose-700 ring-rose-200"><AlertTriangle className="h-3 w-3" /> Seguimiento vencido</Chip>}{offerExpired && <Chip className="bg-amber-50 text-amber-700 ring-amber-200"><Clock className="h-3 w-3" /> Oferta vencida</Chip>}</div><h3 className="mt-2 text-base font-semibold text-slate-900">{budget.title}</h3><p className="mt-0.5 text-xs text-slate-500">{budget.client}{budget.site ? ` · ${budget.site}` : ""}</p></div><div className="flex shrink-0 gap-1.5" onClick={(event) => event.stopPropagation()}><button onClick={() => { setEditingBudget(budget); setEditorOpen(true); }} title="Editar presupuesto" aria-label="Editar presupuesto" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button><button onClick={() => onDuplicate(budget)} title="Duplicar presupuesto" aria-label="Duplicar presupuesto" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Copy className="h-4 w-4" /></button><button onClick={() => onDelete(budget)} title="Eliminar presupuesto" aria-label="Eliminar presupuesto" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div></div><div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2.5 text-xs sm:grid-cols-4"><div><span className="block text-[10px] text-slate-400">Valor</span><b>{money(budget.amount)}</b></div><div><span className="block text-[10px] text-slate-400">Valor ponderado</span><b>{money(weightedValue)}</b></div><div><span className="block text-[10px] text-slate-400">Probabilidad</span><b>{budget.probability || 0}%</b></div><div><span className="flex items-center gap-1 text-[10px] text-slate-400">Margen actual{["Aprobado", "Facturado"].includes(budget.stage) && <HelpHint text="Costo congelado: quedó fijado al aprobar el presupuesto y solo cambia si se cargan costos adicionales." />}</span><b className={margin >= 0 ? "text-emerald-600" : "text-rose-600"}>{money(margin)}{Number(budget.amount) > 0 ? <span className="ml-1 font-normal text-slate-400">· {Math.round((margin / Number(budget.amount)) * 100)}%</span> : null}</b></div></div><div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-600"><div><span className="block text-[10px] text-slate-400">Próxima acción</span><b>{budget.nextAction || "Sin definir"}</b></div><div><span className="block text-[10px] text-slate-400">Seguimiento</span><b className={followDue ? "text-rose-600" : ""}>{budgetDate(budget.nextFollowUp)}</b></div><div><span className="block text-[10px] text-slate-400">Válido hasta</span><b className={offerExpired ? "text-amber-600" : ""}>{budget.validUntil ? budgetDate(budget.validUntil) : "Sin definir"}</b></div><div><span className="block text-[10px] text-slate-400">Plan previsto</span><b>{budgetDate(budget.plannedStart)}{budget.plannedEnd ? ` → ${budgetDate(budget.plannedEnd)}` : ""}</b></div><div><span className="block text-[10px] text-slate-400">Recursos</span><b>{budget.teamSize || 1} persona(s) · {budget.durationDays || 0} días</b></div><div><span className="block text-[10px] text-slate-400">Antigüedad</span><b className={ageDays >= 30 && !["Aprobado", "Facturado", "Rechazado"].includes(budget.stage) ? "text-amber-600" : ""}>{ageDays != null ? `${ageDays} día(s)` : "—"}</b></div></div><div className="mt-auto flex flex-wrap gap-2 border-t border-slate-100 pt-3" onClick={(event) => event.stopPropagation()}>{budget.projectId ? <><span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700"><Folder className="h-4 w-4" /> Proyecto {project?.key || "creado"}</span>{billed > 0 && <span className="inline-flex items-center rounded-lg bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700">Facturado: {money(billed)}</span>}{billed < Number(budget.amount) && <button onClick={() => setBillingBudget(budget)} className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-100"><FileText className="h-4 w-4" /> Registrar factura</button>}</> : null}{["Aprobado", "Facturado"].includes(budget.stage) && <button onClick={() => setExecutionBudget(budget)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-400" title="Elegir cómo iniciar la ejecución del presupuesto"><ChevronRight className="h-4 w-4" /> Iniciar ejecución</button>}</div></Box>; })}</div>}
    {editorOpen && <BudgetEditor budget={editingBudget} clients={clients} parts={parts} orders={orders} onOpenOrder={onOpenOrder} me={me} onClose={() => setEditorOpen(false)} onSave={onSave} />}
    {billingBudget && <ProjectInvoiceModal budget={billingBudget} project={projects.find((project) => project.id === billingBudget.projectId)} onClose={() => setBillingBudget(null)} onSave={onInvoice} />}
    {executionBudget && <ExecutionChoiceModal budget={executionBudget} project={projects.find((project) => project.id === executionBudget.projectId)} recommendProject={projectRecommended(executionBudget)} onClose={() => setExecutionBudget(null)} onOrder={() => { setExecutionBudget(null); onCreateOrder(executionBudget); }} onProject={async () => { const result = await onConvert(executionBudget); if (result) setExecutionBudget(null); return result; }} />}
  </div>;
}

function ExecutionChoiceModal({ budget, project, recommendProject, onClose, onOrder, onProject }) {
  useDialogOpenClass();
  const [creatingProject, setCreatingProject] = useState(false);
  const orderIsRecommended = !recommendProject || Boolean(project);
  const createProject = async () => { setCreatingProject(true); await onProject(); setCreatingProject(false); };
  const mouseDownOnBackdrop = useRef(false);
  return <div className="motion-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/60 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
    <div className="mobile-dialog mobile-sheet-content w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="execution-choice-title" onClick={(event) => event.stopPropagation()}>
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

function PurchaseOrderEditor({ po, suppliers, projects, onClose, onSave, onErr }) {
  useDialogOpenClass();
  const [form, setForm] = useState(() => ({ supplierId: "", projectId: "", stage: "Borrador", dueDate: "", supplierQuoteNumber: "", supplierInvoiceNumber: "", notes: "", ...(po || {}), items: (po?.items?.length ? po.items : [emptyPurchaseOrderItem()]).map((item) => ({ ...item })) }));
  const [saving, setSaving] = useState(false);
  const [rateLoading, setRateLoading] = useState(false);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const setItem = (index, patch) => setForm((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  const addItem = () => set("items", [...form.items, emptyPurchaseOrderItem()]);
  const removeItem = (index) => set("items", form.items.filter((_, itemIndex) => itemIndex !== index));
  const totals = form.items.reduce((sum, item) => { const math = poItemMath(item); return { net: sum.net + math.netAmountUsd, vat: sum.vat + math.vatAmountUsd, gross: sum.gross + math.grossAmountUsd }; }, { net: 0, vat: 0, gross: 0 });
  const validItems = form.items.filter((item) => item.description.trim() && Number(item.qty) > 0 && Number(item.unitPrice) > 0);
  const missingRate = form.items.some((item) => item.currency !== "USD" && !(Number(item.exchangeRate) > 0));
  const applyBnaRate = async (index) => {
    setRateLoading(true);
    try { const quote = await api.bnaExchangeRate(); setItem(index, { exchangeRate: quote.arsPerUsd }); }
    catch (e) { onErr?.(e); }
    finally { setRateLoading(false); }
  };
  const submit = async () => { setSaving(true); try { const saved = await onSave({ ...form, items: validItems }); if (saved) onClose(); } finally { setSaving(false); } };
  const mouseDownOnBackdrop = useRef(false);
  return <div className="motion-backdrop fixed inset-0 z-[60] flex items-end justify-center overflow-hidden bg-slate-900/60 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="po-dialog-title" className="modal-frame mobile-dialog mobile-sheet-content flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4 py-3 sm:px-5"><div><h2 id="po-dialog-title" className="text-lg font-semibold text-slate-900">{po?.id ? `Editar ${po.number || po.id}` : "Nueva orden de compra"}</h2><p className="text-xs text-slate-500">Compra a proveedor con moneda e IVA por ítem</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        {suppliers.length === 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Todavía no hay proveedores cargados. Creá uno en la pestaña “Proveedores” antes de emitir la orden.</div>}
        <Section title="Proveedor y seguimiento"><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><L label="N.º de orden"><input value={form.number || ""} onChange={(event) => set("number", event.target.value)} placeholder="Automático al guardar" className="u-input" /></L><L label="Proveedor *"><select value={form.supplierId} onChange={(event) => set("supplierId", event.target.value)} className="u-input"><option value="">Seleccionar proveedor</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></L><L label="Proyecto"><select value={form.projectId || ""} onChange={(event) => set("projectId", event.target.value)} className="u-input"><option value="">General / sin proyecto</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}</select></L><L label="Estado"><select value={form.stage} onChange={(event) => set("stage", event.target.value)} className="u-input">{PO_STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></L><L label="Fecha de entrega estimada"><input type="date" value={form.dueDate || ""} onChange={(event) => set("dueDate", event.target.value)} className="u-input" /></L><L label="N.º de presupuesto del proveedor" help="El número de presupuesto/cotización que el proveedor te compartió al solicitarle los materiales o servicios."><input value={form.supplierQuoteNumber || ""} onChange={(event) => set("supplierQuoteNumber", event.target.value)} placeholder="Ej. 100600040730" className="u-input" /></L><div className="sm:col-span-2"><L label={form.stage === "Recibida" ? "N.º de factura del proveedor *" : "N.º de factura del proveedor"} help="Se completa cuando el proveedor envía la factura correspondiente a esta orden."><input value={form.supplierInvoiceNumber || ""} onChange={(event) => set("supplierInvoiceNumber", event.target.value)} placeholder="Ej. 0001-00001234" className={`u-input ${form.stage === "Recibida" && !form.supplierInvoiceNumber?.trim() ? "border-amber-400 bg-amber-50" : ""}`} /></L></div></div><L label="Notas"><textarea rows={2} value={form.notes || ""} onChange={(event) => set("notes", event.target.value)} placeholder="Condiciones de entrega, referencia interna, etc." className="u-input resize-none" /></L></Section>

        <Section title="Ítems">
          <div className="space-y-3">{form.items.map((item, index) => { const math = poItemMath(item); return <div key={index} className="rounded-lg border border-slate-200 p-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <input value={item.sku || ""} onChange={(event) => setItem(index, { sku: event.target.value })} placeholder="Código" aria-label="Código" className="u-input font-mono" />
              <input value={item.description} onChange={(event) => setItem(index, { description: event.target.value })} placeholder="Descripción del producto o servicio" aria-label="Descripción" className="u-input" />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[5rem_5rem_6.5rem_6rem_5.5rem_auto]">
              <input type="number" min="0" step="1" value={item.qty} onChange={(event) => setItem(index, { qty: event.target.value === "" ? "" : Math.max(0, Math.round(Number(event.target.value))) })} placeholder="Cant." aria-label="Cantidad" className="u-input" />
              <select value={UNIT_OPTIONS.includes(item.unit) ? item.unit : "u"} onChange={(event) => setItem(index, { unit: event.target.value })} aria-label="Unidad" className="u-input">{UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select>
              <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => setItem(index, { unitPrice: event.target.value })} placeholder="Precio unit." aria-label="Precio unitario" className="u-input" />
              <select value={item.currency} onChange={(event) => { const currency = event.target.value; setItem(index, { currency, exchangeRate: currency === "USD" ? 1 : (item.exchangeRate === 1 ? "" : item.exchangeRate) }); }} aria-label="Moneda" className="u-input">{PO_CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select>
              <select value={item.vatRate} onChange={(event) => setItem(index, { vatRate: Number(event.target.value) })} aria-label="Alícuota de IVA" className="u-input">{PO_VAT_RATES.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}</select>
              <button onClick={() => removeItem(index)} aria-label="Quitar ítem" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:justify-self-end"><Trash2 className="h-4 w-4" /></button>
            </div>
            {item.currency !== "USD" && <div className="mt-2 flex flex-wrap items-center gap-2"><div className="w-40"><L label={`Tipo de cambio (${item.currency}/USD)`}><input type="number" min="0" step="0.0001" value={item.exchangeRate || ""} onChange={(event) => setItem(index, { exchangeRate: event.target.value })} placeholder="Ej. 1050" className="u-input" /></L></div>{item.currency === "ARS" && <button type="button" disabled={rateLoading} onClick={() => applyBnaRate(index)} className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 text-[11px] font-medium text-sky-700 disabled:opacity-50">{rateLoading ? "Consultando…" : "Usar cotización BNA"}</button>}</div>}
            <div className="mt-2 flex flex-wrap justify-end gap-x-4 gap-y-1 text-[11px] text-slate-500"><span>Neto: <b>{money(math.netAmountUsd)}</b></span><span>IVA: <b>{money(math.vatAmountUsd)}</b></span><span>Total: <b>{money(math.grossAmountUsd)}</b></span></div>
          </div>; })}</div>
          <button onClick={addItem} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600"><Plus className="h-4 w-4" /> Agregar ítem</button>
          <div className="mt-4 grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-3"><div><span className="block text-[10px] uppercase text-slate-400">Neto (USD)</span><b>{money(totals.net)}</b></div><div><span className="block text-[10px] uppercase text-slate-400">IVA (USD)</span><b>{money(totals.vat)}</b></div><div><span className="block text-[10px] uppercase text-slate-400">Total (USD)</span><b className="text-brand-700">{money(totals.gross)}</b></div></div>
          {form.stage === "Recibida" && !form.supplierInvoiceNumber?.trim() && <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><b className="block">Falta el N.º de factura del proveedor</b><span>No se puede guardar como Recibida sin ese dato. Completalo arriba, en “Proveedor y seguimiento”, para generar la cuenta por pagar en Finanzas.</span></div></div>}
          {form.stage === "Recibida" && form.supplierInvoiceNumber?.trim() && <p className="mt-2 text-[11px] text-slate-500">Al guardar como <b>Recibida</b>, esta orden generará automáticamente una cuenta por pagar en Finanzas por el total con IVA.</p>}
        </Section>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={saving || !form.supplierId || validItems.length === 0 || missingRate || (form.stage === "Recibida" && !form.supplierInvoiceNumber?.trim())} onClick={submit} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar orden de compra</button></div>
    </div>
  </div>;
}

function PurchaseOrdersModule({ purchaseOrders, suppliers, projects, finances, me, createSignal, onConsumeCreate, onSave, onDelete, onDuplicate, onMarkPaid, onAddSupplier, onPatchSupplier, onRemoveSupplier, onErr }) {
  const [poTab, setPoTab] = useState("orders");
  const [editingPo, setEditingPo] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("Todos");
  useEffect(() => { if (createSignal > 0) { setEditingPo(null); setPoTab("orders"); setEditorOpen(true); onConsumeCreate(); } }, [createSignal, onConsumeCreate]);
  const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { onErr(e); } };
  const pending = purchaseOrders.filter((po) => !["Recibida", "Cancelada"].includes(po.stage));
  const pendingTotal = pending.reduce((sum, po) => sum + (Number(po.grossAmountUsd) || 0), 0);
  const receivedTotal = purchaseOrders.filter((po) => po.stage === "Recibida").reduce((sum, po) => sum + (Number(po.grossAmountUsd) || 0), 0);
  const payableCount = finances.filter((f) => f.sourcePurchaseOrderId && f.paymentStatus === "pending").length;
  // "Sin pagar" no depende de haber llegado a Recibida (recién ahí se genera la cuenta por pagar
  // formal en Finanzas): cualquier OC activa que todavía no tenga el pago confirmado cuenta como
  // pendiente, para poder anticiparse desde que se confirma la compra, no solo al recibirla.
  const unpaidPOs = purchaseOrders.filter((po) => { if (po.stage === "Cancelada") return false; const payable = finances.find((f) => f.sourcePurchaseOrderId === po.id); return !payable || payable.paymentStatus === "pending"; });
  const unpaidTotal = unpaidPOs.reduce((sum, po) => sum + (Number(po.grossAmountUsd) || 0), 0);
  const overdueDeliveries = purchaseOrders.filter(isDeliveryOverdue);
  const visible = purchaseOrders.filter((po) => { const stageMatches = stage === "Todos" || po.stage === stage; return stageMatches && (!query || `${po.number || po.id} ${po.supplierName} ${po.supplierInvoiceNumber || ""}`.toLowerCase().includes(query.toLowerCase())); });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-semibold text-slate-900">Órdenes de compra</h2><p className="text-xs text-slate-500">Compras a proveedores y su impacto en cuentas por pagar</p></div>
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-xs font-medium">
        <button onClick={() => setPoTab("orders")} className={`rounded-md px-3 py-1.5 ${poTab === "orders" ? "bg-brand-500 text-white" : "text-slate-600"}`}>Órdenes</button>
        <button onClick={() => setPoTab("suppliers")} className={`rounded-md px-3 py-1.5 ${poTab === "suppliers" ? "bg-brand-500 text-white" : "text-slate-600"}`}>Proveedores</button>
      </div>
    </div>
    {poTab === "suppliers" ? <Suppliers suppliers={suppliers} purchaseOrders={purchaseOrders} onAdd={onAddSupplier} onPatch={onPatchSupplier} onRemove={onRemoveSupplier} onErr={onErr} /> : <>
      {overdueDeliveries.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><Clock className="mt-0.5 h-4 w-4 shrink-0" />{overdueDeliveries.length} orden(es) de compra con fecha de entrega vencida: {overdueDeliveries.slice(0, 4).map((po) => po.number || po.id).join(", ")}{overdueDeliveries.length > 4 ? "…" : ""}.</div>
      )}
      {unpaidPOs.length > 0 && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
          <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{unpaidPOs.length} orden(es) de compra sin pagar · {money(unpaidTotal)}</span>
          <button onClick={() => { setStage("Todos"); setQuery(""); }} className="shrink-0 rounded-md bg-white/70 px-2 py-1.5 text-xs font-medium hover:bg-white">Ver pendientes de pago</button>
        </div>
      )}
      <div className="motion-list grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Pendiente de recibir" value={money(pendingTotal)} icon={Truck} tint="text-brand-600" description="Suma del total con IVA de las órdenes de compra en Borrador, Enviada o Confirmada." /><Metric label="Recibido (histórico)" value={money(receivedTotal)} icon={CheckCircle2} tint="text-emerald-600" description="Suma del total con IVA de las órdenes marcadas como Recibidas." /><Metric label="Cuentas por pagar de OC" value={payableCount} icon={AlertTriangle} tint={payableCount ? "text-amber-600" : "text-emerald-600"} description="Movimientos de Finanzas generados por órdenes de compra recibidas que siguen pendientes de pago." /><Metric label="Proveedores activos" value={suppliers.filter((s) => s.active !== false).length} icon={Building2} tint="text-slate-600" description="Cantidad de proveedores marcados como activos." /></div>
      <div className="flex flex-col gap-2 sm:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar orden, proveedor o factura…" className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-500" /></div><select value={stage} onChange={(event) => setStage(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="Todos">Todos los estados</option>{PO_STAGES.map((item) => <option key={item}>{item}</option>)}</select></div>
      {visible.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><ShoppingCart className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-2 text-sm font-semibold text-slate-700">Sin órdenes de compra para mostrar</h3><p className="mt-1 text-xs text-slate-400">Registrá una compra a proveedor para empezar.</p></div> : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{visible.map((po) => <Box key={po.id} onClick={() => { setEditingPo(po); setEditorOpen(true); }} className="cursor-pointer p-4 hover:border-brand-300"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold text-slate-700">{po.number || po.id}</span><Chip className={`${PO_STAGE_STYLE[po.stage]} ring-1`}>{po.stage}</Chip>{isDeliveryOverdue(po) && <Chip className="bg-rose-50 text-rose-700 ring-rose-200"><Clock className="h-3 w-3" />Entrega vencida</Chip>}{po.supplierQuoteNumber &&<Chip className="bg-violet-50 text-violet-700 ring-violet-200" title="Número de cotización que te dio el proveedor (no un Presupuesto tuyo)">Cotiz. proveedor {po.supplierQuoteNumber}</Chip>}{po.supplierInvoiceNumber && <Chip className="bg-sky-50 text-sky-700 ring-sky-200">Fact. {po.supplierInvoiceNumber}</Chip>}</div><h3 className="mt-2 text-base font-semibold text-slate-900">{po.supplierName}</h3><p className="mt-0.5 text-xs text-slate-500">{(po.items || []).length} producto(s) · {(po.items || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0)} unidad(es){po.dueDate ? ` · Entrega ${budgetDate(po.dueDate)}` : ""}</p></div><div className="flex shrink-0 gap-1.5" onClick={(event) => event.stopPropagation()}><button onClick={() => purchaseOrderReportPDF(po, suppliers.find((s) => s.id === po.supplierId), projects.find((p) => p.id === po.projectId))} title="Descargar PDF" aria-label="Descargar PDF de la orden de compra" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Download className="h-4 w-4" /></button><button onClick={() => { setEditingPo(po); setEditorOpen(true); }} title="Editar orden de compra" aria-label="Editar orden de compra" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>{onDuplicate && <button onClick={() => wrap(onDuplicate)(po)} title="Duplicar orden de compra" aria-label="Duplicar orden de compra" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Copy className="h-4 w-4" /></button>}<button onClick={() => setPendingDelete(po)} title="Eliminar orden de compra" aria-label="Eliminar orden de compra" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5 text-xs"><div><span className="block text-[10px] text-slate-400">Neto</span><b>{money(po.netAmountUsd)}</b></div><div><span className="block text-[10px] text-slate-400">IVA</span><b>{money(po.vatAmountUsd)}</b></div><div><span className="block text-[10px] text-slate-400">Total</span><b>{money(po.grossAmountUsd)}</b></div></div>{po.stage === "Recibida" && (() => { const payable = finances.find((f) => f.sourcePurchaseOrderId === po.id); if (!payable) return null; const isPaid = payable.paymentStatus !== "pending"; return (
                <div onClick={(event) => event.stopPropagation()} className={`mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs font-medium ${isPaid ? "text-emerald-700" : "text-amber-700"}`}>
                  <Link2 className="h-3.5 w-3.5 shrink-0" />
                  {isPaid ? <span>Pagada{payable.paidAt ? ` el ${budgetDate(payable.paidAt)}` : ""}</span> : <span>Cuenta por pagar pendiente</span>}
                  {onMarkPaid && (isPaid
                    ? <button onClick={() => wrap(onMarkPaid)(payable.id, false)} className="ml-auto rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50">Deshacer</button>
                    : <button onClick={() => wrap(onMarkPaid)(payable.id, true)} className="ml-auto rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500">Marcar como pagada</button>)}
                </div>
              ); })()}</Box>)}</div>}
    </>}
    {editorOpen && <PurchaseOrderEditor po={editingPo} suppliers={suppliers} projects={projects} onClose={() => setEditorOpen(false)} onSave={wrap(async (form) => onSave(form, editingPo?.id))} onErr={onErr} />}
    {pendingDelete && <ConfirmDialog title="Eliminar orden de compra" message={`Se eliminará “${pendingDelete.number || pendingDelete.id}”. ${pendingDelete.stage === "Recibida" ? "La cuenta por pagar asociada en Finanzas también se eliminará." : "No tiene movimientos financieros asociados."}`} confirmLabel="Eliminar" danger onClose={() => setPendingDelete(null)} onConfirm={async () => { await wrap(onDelete)(pendingDelete.id); setPendingDelete(null); }} />}
  </div>;
}

/* ===================================== LISTADO DE MATERIALES ===================================== */
const SECTION_LETTERS_CLIENT = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function MaterialListEditor({ materialList, projects, clients, onClose, onSave, onErr }) {
  useDialogOpenClass();
  const [form, setForm] = useState(() => ({
    projectId: "", discipline: "Eléctricos", stage: "Borrador", version: "1.0", client: "", site: "", notes: [...MATERIAL_LIST_DEFAULT_NOTES],
    ...(materialList || {}),
    sections: (materialList?.sections?.length ? materialList.sections : [emptyMaterialListSection()]).map((section) => ({ ...section, items: section.items.map((item) => ({ ...item })) })),
  }));
  const [saving, setSaving] = useState(false);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const setSection = (index, patch) => setForm((current) => ({ ...current, sections: current.sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, ...patch } : section) }));
  const addSection = () => set("sections", [...form.sections, emptyMaterialListSection()]);
  const removeSection = (index) => set("sections", form.sections.filter((_, sectionIndex) => sectionIndex !== index));
  const setItem = (sectionIndex, itemIndex, patch) => setForm((current) => ({ ...current, sections: current.sections.map((section, si) => si === sectionIndex ? { ...section, items: section.items.map((item, ii) => ii === itemIndex ? { ...item, ...patch } : item) } : section) }));
  const addItem = (sectionIndex) => setSection(sectionIndex, { items: [...form.sections[sectionIndex].items, emptyMaterialListItem()] });
  const removeItem = (sectionIndex, itemIndex) => setSection(sectionIndex, { items: form.sections[sectionIndex].items.filter((_, ii) => ii !== itemIndex) });
  const setNote = (index, value) => set("notes", form.notes.map((note, noteIndex) => noteIndex === index ? value : note));
  const addNote = () => set("notes", [...form.notes, ""]);
  const removeNote = (index) => set("notes", form.notes.filter((_, noteIndex) => noteIndex !== index));
  const selectProject = (projectId) => { const project = projects.find((p) => p.id === projectId); setForm((current) => ({ ...current, projectId, client: project?.client || current.client, site: project?.site || current.site })); };
  const selectClient = (clientId) => { const client = clients.find((c) => c.id === clientId); setForm((current) => ({ ...current, clientId, client: client?.name || "", site: clientSites(client)[0]?.name || "" })); };
  const validSections = form.sections.map((section) => ({ ...section, items: section.items.filter((item) => item.description.trim() && Number(item.qty) > 0) })).filter((section) => section.title.trim() && section.items.length > 0);
  const submit = async () => { setSaving(true); try { const saved = await onSave({ ...form, sections: validSections, notes: form.notes.filter((note) => note.trim()) }); if (saved) onClose(); } finally { setSaving(false); } };
  const mouseDownOnBackdrop = useRef(false);
  return <div className="motion-backdrop fixed inset-0 z-[60] flex items-end justify-center overflow-hidden bg-slate-900/60 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="ml-dialog-title" className="modal-frame mobile-dialog mobile-sheet-content flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4 py-3 sm:px-5"><div><h2 id="ml-dialog-title" className="text-lg font-semibold text-slate-900">{materialList?.id ? `Editar ${materialList.number || materialList.id}` : "Nuevo listado de materiales"}</h2><p className="text-xs text-slate-500">Documento para que el cliente cotice los materiales con su proveedor</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        {projects.length === 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Todavía no hay proyectos cargados. Creá uno en la pestaña “Proyectos” antes de emitir el listado.</div>}
        <Section title="Encabezado">
          <L label="Uso del reporte" help="Define qué logo se imprime en el PDF: el de Automática (uso interno) o el del cliente elegido abajo."><div className="flex gap-2"><Toggle active={form.audience !== "interno"} onClick={() => set("audience", "cliente")}>Para el cliente</Toggle><Toggle active={form.audience === "interno"} onClick={() => set("audience", "interno")}>Uso interno (Automática)</Toggle></div></L>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <L label={form.audience === "interno" ? "Proyecto (opcional)" : "Proyecto *"}><select value={form.projectId} onChange={(event) => selectProject(event.target.value)} className="u-input"><option value="">{form.audience === "interno" ? "Sin vincular" : "Seleccionar proyecto"}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}</select></L>
          <L label="Disciplina"><select value={form.discipline} onChange={(event) => set("discipline", event.target.value)} className="u-input">{MATERIAL_LIST_DISCIPLINES.map((discipline) => <option key={discipline}>{discipline}</option>)}</select></L>
          <L label="Estado" help="Seguimiento después de generado: si el cliente ya lo cotizó, si ya se compró o recibió el material."><select value={form.stage || "Borrador"} onChange={(event) => set("stage", event.target.value)} className="u-input">{MATERIAL_LIST_STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></L>
          <L label="Cliente / Empresa"><select value={form.clientId || ""} onChange={(event) => selectClient(event.target.value)} className="u-input"><option value="">Seleccionar cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></L>
          <L label="Planta">{clientSites(clients.find((c) => c.id === form.clientId)).length > 0 ? (<select value={form.site || ""} onChange={(event) => set("site", event.target.value)} className="u-input"><option value="">Seleccionar planta</option>{clientSites(clients.find((c) => c.id === form.clientId)).map((s) => <option key={s.code || s.name} value={s.name}>{s.name}{s.code ? ` (${s.code})` : ""}</option>)}</select>) : (<input value={form.site || ""} onChange={(event) => set("site", event.target.value)} placeholder="Ej. Venado Tuerto" className="u-input" />)}</L>
          <L label="Versión"><input value={form.version || ""} onChange={(event) => set("version", event.target.value)} placeholder="1.0" className="u-input" /></L>
        </div></Section>

        <Section title="Secciones y materiales">
          <div className="space-y-3">{form.sections.map((section, sectionIndex) => (
            <div key={sectionIndex} className="rounded-lg border border-slate-200 p-2.5">
              <div className="flex items-center gap-2"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#DDD8C3] font-mono text-xs font-bold text-slate-700">{SECTION_LETTERS_CLIENT[sectionIndex] || sectionIndex + 1}</span><input value={section.title} onChange={(event) => setSection(sectionIndex, { title: event.target.value })} placeholder="Título de la sección (ej. Arquitectura de Red)" className="u-input flex-1" /><button onClick={() => removeSection(sectionIndex)} aria-label="Quitar sección" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div>
              <div className="mt-2 space-y-2">{section.items.map((item, itemIndex) => (
                <div key={itemIndex} className="grid grid-cols-2 gap-2 sm:grid-cols-[6.5rem_minmax(0,1fr)_7rem_4rem_4rem_auto]">
                  <input value={item.ref} onChange={(event) => setItem(sectionIndex, itemIndex, { ref: event.target.value })} placeholder="Ref." aria-label="Referencia" className="u-input font-mono" />
                  <input value={item.description} onChange={(event) => setItem(sectionIndex, itemIndex, { description: event.target.value })} placeholder="Descripción" aria-label="Descripción" className="u-input col-span-2 sm:col-span-1" />
                  <input value={item.brand} onChange={(event) => setItem(sectionIndex, itemIndex, { brand: event.target.value })} placeholder="Marca" aria-label="Marca" className="u-input" />
                  <input type="number" min="0" step="1" value={item.qty} onChange={(event) => setItem(sectionIndex, itemIndex, { qty: event.target.value === "" ? "" : Math.max(0, Math.round(Number(event.target.value))) })} placeholder="Cant." aria-label="Cantidad" className="u-input" />
                  <input value={item.unit} onChange={(event) => setItem(sectionIndex, itemIndex, { unit: event.target.value })} placeholder="Ud." aria-label="Unidad" className="u-input" />
                  <button onClick={() => removeItem(sectionIndex, itemIndex)} aria-label="Quitar ítem" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}</div>
              <button onClick={() => addItem(sectionIndex)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600"><Plus className="h-3.5 w-3.5" /> Agregar ítem</button>
            </div>
          ))}</div>
          <button onClick={addSection} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600"><Plus className="h-4 w-4" /> Agregar sección</button>
        </Section>

        <Section title="Notas importantes">
          <div className="space-y-2">{form.notes.map((note, index) => (
            <div key={index} className="flex gap-2"><textarea rows={2} value={note} onChange={(event) => setNote(index, event.target.value)} className="u-input flex-1 resize-none text-xs" /><button onClick={() => removeNote(index)} aria-label="Quitar nota" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div>
          ))}</div>
          <button onClick={addNote} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600"><Plus className="h-3.5 w-3.5" /> Agregar nota</button>
        </Section>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={saving || (form.audience !== "interno" && !form.projectId) || validSections.length === 0} onClick={submit} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar listado</button></div>
    </div>
  </div>;
}

function MaterialListsModule({ materialLists, projects, clients, me, isMgr, createSignal, onConsumeCreate, onSave, onDelete, onDuplicate, onErr }) {
  const [editingMl, setEditingMl] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [query, setQuery] = useState("");
  useEffect(() => { if (createSignal > 0) { setEditingMl(null); setEditorOpen(true); onConsumeCreate(); } }, [createSignal, onConsumeCreate]);
  const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { onErr(e); } };
  const [stage, setStage] = useState("Todos");
  const visible = materialLists.filter((ml) => (stage === "Todos" || (ml.stage || "Borrador") === stage) && (!query || `${ml.number || ml.id} ${ml.projectName || ""} ${ml.client || ""} ${ml.site || ""}`.toLowerCase().includes(query.toLowerCase())));
  return <div className="space-y-4">
    <div><h2 className="text-lg font-semibold text-slate-900">Listados de materiales</h2><p className="text-xs text-slate-500">Documentos para que el cliente cotice materiales con su proveedor</p></div>
    <div className="motion-list grid grid-cols-2 gap-3 lg:grid-cols-3"><Metric label="Listados" value={materialLists.length} icon={Package} tint="text-brand-600" /><Metric label="Proyectos con listado" value={new Set(materialLists.map((ml) => ml.projectId)).size} icon={Folder} tint="text-violet-600" /><Metric label="Ítems totales" value={materialLists.reduce((sum, ml) => sum + (ml.totalItems || 0), 0)} icon={ClipboardList} tint="text-slate-600" /></div>
    <div className="flex flex-col gap-2 sm:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar listado, proyecto o planta…" className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-500" /></div><select value={stage} onChange={(event) => setStage(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="Todos">Todos los estados</option>{MATERIAL_LIST_STAGES.map((item) => <option key={item}>{item}</option>)}</select></div>
    {visible.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><Package className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-2 text-sm font-semibold text-slate-700">Sin listados de materiales para mostrar</h3><p className="mt-1 text-xs text-slate-400">Creá uno para pedirle a un cliente que cotice materiales con su proveedor.</p></div> : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{visible.map((ml) => <Box key={ml.id} onClick={() => { setEditingMl(ml); setEditorOpen(true); }} className="cursor-pointer p-4 hover:border-brand-300"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold text-slate-700">{ml.number || ml.id}</span><Chip className={`${MATERIAL_LIST_STAGE_STYLE[ml.stage || "Borrador"]} ring-1`}>{ml.stage || "Borrador"}</Chip><Chip className="bg-emerald-50 text-emerald-700 ring-emerald-200">{ml.discipline}</Chip></div><h3 className="mt-2 text-base font-semibold text-slate-900">{ml.projectName}</h3><p className="mt-0.5 text-xs text-slate-500">{ml.client || "Sin cliente"}{ml.site ? ` · ${ml.site}` : ""}</p></div><div className="flex shrink-0 gap-1.5" onClick={(event) => event.stopPropagation()}><button onClick={() => materialListReportPDF(ml, projects.find((p) => p.id === ml.projectId), clients.find((c) => c.id === ml.clientId))} title="Descargar PDF" aria-label="Descargar PDF del listado" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Download className="h-4 w-4" /></button><button onClick={() => { setEditingMl(ml); setEditorOpen(true); }} title="Editar listado" aria-label="Editar listado" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>{onDuplicate && <button onClick={() => wrap(onDuplicate)(ml)} title="Duplicar listado" aria-label="Duplicar listado" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Copy className="h-4 w-4" /></button>}{isMgr && <button onClick={() => setPendingDelete(ml)} title="Eliminar listado" aria-label="Eliminar listado" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>}</div></div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500"><span>{(ml.sections || []).length} sección(es)</span><span>{ml.totalItems || 0} ítem(s)</span><span>Versión {ml.version}</span></div></Box>)}</div>}
    {editorOpen && <MaterialListEditor materialList={editingMl} projects={projects} clients={clients} onClose={() => setEditorOpen(false)} onSave={wrap(async (form) => onSave(form, editingMl?.id))} onErr={onErr} />}
    {pendingDelete && <ConfirmDialog title="Eliminar listado de materiales" message={`Se eliminará “${pendingDelete.number || pendingDelete.id}”.`} confirmLabel="Eliminar" danger onClose={() => setPendingDelete(null)} onConfirm={async () => { await wrap(onDelete)(pendingDelete.id); setPendingDelete(null); }} />}
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
  const mix = Object.entries(byService).map(([name, value], i) => ({ name, value: Math.round(value), fill: PIE_COLORS[i % PIE_COLORS.length] })).filter((m) => m.value > 0);

  // 6) Productividad por técnico (período)
  const byTech = {};
  periodOrders.forEach((o) => { const k = o.tech || "—"; if (!byTech[k]) byTech[k] = { name: k.split(" ")[0], horas: 0, ordenes: 0 }; byTech[k].horas += (Number(o.laborHours) || 0) * (Number(o.technicians) || 1); byTech[k].ordenes += 1; });
  const tech = Object.values(byTech).map((t) => ({ ...t, horas: Math.round(t.horas * 100) / 100 })).sort((a, b) => b.horas - a.horas);

  const periodLabel = { mes: "este mes", trim: "último trimestre", anio: "este año" }[period];
  const fmtK = (value) => {
    const amount = Number(value) || 0;
    return `USD ${Math.abs(amount) >= 1000 ? `${(amount / 1000).toFixed(0)}k` : Math.round(amount)}`;
  };

  const exportPdf = () => {
    const kpis = [
      { label: `Facturado (${periodLabel})`, value: money(periodBilled) },
      { label: "Variación vs. período anterior", value: variation != null ? `${variation >= 0 ? "+" : ""}${variation}%` : "Sin base anterior" },
      { label: "Ticket promedio", value: money(ticket) },
      { label: "Por facturar (total)", value: money(pendingTotal) },
      { label: `Órdenes (${periodLabel})`, value: periodOrders.length },
      { label: "Margen del período", value: marginPct != null ? `${marginPct}% · ${money(marginAmount)}` : "Sin datos" },
      { label: "Días promedio para facturar", value: avgToBill != null ? `${avgToBill} días` : "Sin datos" },
    ];
    dashboardReportPDF(periodLabel, kpis, topClients, mix, tech, aging);
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Panel de dirección</h2>
        <button onClick={exportPdf} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><FileText className="h-4 w-4" /> PDF</button>
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
              <Tooltip formatter={(v) => money(v)} cursor={{ fill: "#f1f5f9" }} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
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
                  <Tooltip formatter={(v) => money(v)} cursor={{ fill: "#f1f5f9" }} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
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
                  <Tooltip formatter={(v) => money(v)} cursor={{ fill: "#f1f5f9" }} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
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
                <Tooltip cursor={{ fill: "#f1f5f9" }} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
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
                <Tooltip formatter={(v) => money(v)} cursor={{ fill: "#f1f5f9" }} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
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
function MiDia({ me, tasks, orders, purchaseOrders = [], finances = [], budgets = [], userById, onOpenTask, onOpenOrder, onGoToPurchaseOrders, onGoToBudgets, ger }) {
  const myTasks = tasks.filter((t) => t.assignee === me.id && t.status !== "Hecho")
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority));
  // Incluye "Suspendida": si no, una orden pausada desaparece por completo de la vista del técnico
  // hasta que alguien la reabra, dando la falsa sensación de que no tiene nada pendiente con ella.
  const myOrders = orders.filter((o) => (o.tech === me.name || o.assignedTechs?.includes(me.name)) && ["Borrador", "En progreso", "En proceso de ejecución", "Suspendida"].includes(o.status));
  const overdue = myTasks.filter(isOverdue).length;
  const dueSoon = myTasks.filter((t) => !isOverdue(t) && isDueSoon(t));
  const pend = ger ? orders.filter((o) => o.status === "Completada" || o.status === "Aprobada") : [];
  // La gerencia necesita anticiparse a las tareas vencidas de todo el equipo, no solo a las propias.
  const teamOverdue = ger ? tasks.filter((t) => isOverdue(t) && t.assignee !== me.id) : [];
  // Cuenta cualquier OC activa sin pago confirmado, no solo las que ya llegaron a "Recibida"
  // (recién ahí existe una cuenta por pagar formal en Finanzas) — así avisa desde que se confirma la compra.
  const unpaidPOs = ger ? purchaseOrders.filter((po) => { if (po.stage === "Cancelada") return false; const payable = finances.find((f) => f.sourcePurchaseOrderId === po.id); return !payable || payable.paymentStatus === "pending"; }) : [];
  // La gerencia necesita ver qué órdenes están en curso en todo el equipo, no solo las propias
  // (que suelen estar vacías para un admin que no hace trabajo de campo).
  const teamActiveOrders = ger ? orders.filter((o) => ["Borrador", "En progreso", "En proceso de ejecución", "Suspendida"].includes(o.status) && !myOrders.some((m) => m.id === o.id)) : [];
  const unsignedTeam = ger ? orders.filter((o) => o.status === "Completada" && !o.signatureUrl && !o.noSignReason) : [];
  const budgetFollowUps = ger ? budgets.filter((budget) => !["Aprobado", "Facturado", "Rechazado"].includes(budget.stage) && budget.nextFollowUp && budget.nextFollowUp <= todayStr()) : [];
  const attentionOrders = orders.filter((o) => (isUrgentOrder(o) || isResponseOverdue(o)) && !["Completada", "Aprobada", "Facturada", "Suspendida"].includes(o.status) && (ger || o.tech === me.name || o.assignedTechs?.includes(me.name)));
  return (
    <div className="space-y-5">
      <div><h2 className="text-lg font-semibold text-slate-900">Hola, {me.name.split(" ")[0]}</h2><p className="text-sm text-slate-500">Esto es lo que tienes pendiente hoy.</p></div>
      {attentionOrders.length > 0 && (
        <div className="motion-banner rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><b>{attentionOrders.length === 1 ? "Hay una orden que necesita atención" : `Hay ${attentionOrders.length} órdenes que necesitan atención`}</b> (urgentes o con respuesta demorada):</span>
          <div className="mt-2 flex flex-wrap gap-1.5">{attentionOrders.slice(0, 6).map((o) => <button key={o.id} onClick={() => onOpenOrder(o)} className="rounded-md bg-white/70 px-2 py-1 font-mono text-xs font-medium hover:bg-white">{o.id}</button>)}{attentionOrders.length > 6 && <span className="self-center text-xs text-rose-700">+{attentionOrders.length - 6} más</span>}</div>
        </div>
      )}
      {dueSoon.length > 0 && (
        <div className="motion-banner rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><b>{dueSoon.length === 1 ? "Tenés una tarea por vencer" : `Tenés ${dueSoon.length} tareas por vencer`}</b></span>
          <div className="mt-2 flex flex-wrap gap-1.5">{dueSoon.slice(0, 6).map((t) => <button key={t.id} onClick={() => onOpenTask(t)} className="rounded-md bg-white/70 px-2 py-1 text-xs font-medium hover:bg-white">{t.title}</button>)}{dueSoon.length > 6 && <span className="self-center text-xs text-amber-700">+{dueSoon.length - 6} más</span>}</div>
          <p className="mt-1.5 text-[11px] text-amber-700">Vencen en los próximos 4 días. El aviso se mantiene hasta que las marques como Hecho.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Mis tareas abiertas" value={myTasks.length} icon={LayoutGrid} tint="text-brand-600" />
        <Metric label="Tareas vencidas" value={overdue} icon={AlertTriangle} tint="text-rose-600" />
        <Metric label="Por vencer (4 días)" value={dueSoon.length} icon={Clock} tint="text-amber-600" />
        <Metric label="Mis órdenes activas" value={myOrders.length} icon={ClipboardList} tint="text-emerald-600" />
        {ger && <Metric label="Por facturar" value={pend.length} icon={FileText} tint="text-amber-600" />}
        {ger && <Metric label="Vencidas del equipo" value={teamOverdue.length} icon={AlertTriangle} tint="text-rose-600" />}
        {ger && <Metric label="OC sin pagar" value={unpaidPOs.length} icon={ShoppingCart} tint="text-amber-600" />}
        {ger && <Metric label="Órdenes activas del equipo" value={teamActiveOrders.length} icon={ClipboardList} tint="text-emerald-600" />}
        {ger && <Metric label="Sin firma" value={unsignedTeam.length} icon={FileSignature} tint="text-rose-600" />}
        {ger && <Metric label="Presupuestos a seguir" value={budgetFollowUps.length} icon={Briefcase} tint="text-sky-600" />}
      </div>
      {ger && teamOverdue.length > 0 && (
        <div className="motion-banner rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><b>{teamOverdue.length === 1 ? "Hay una tarea vencida del equipo" : `Hay ${teamOverdue.length} tareas vencidas del equipo`}</b></span>
          <div className="mt-2 flex flex-wrap gap-1.5">{teamOverdue.slice(0, 6).map((t) => <button key={t.id} onClick={() => onOpenTask(t)} className="rounded-md bg-white/70 px-2 py-1 text-xs font-medium hover:bg-white">{t.title} <span className="text-rose-500">({userById(t.assignee)?.name?.split(" ")[0] || "sin asignar"})</span></button>)}{teamOverdue.length > 6 && <span className="self-center text-xs text-rose-700">+{teamOverdue.length - 6} más</span>}</div>
        </div>
      )}
      {ger && unpaidPOs.length > 0 && (
        <div className="motion-banner flex flex-col items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
          <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{unpaidPOs.length === 1 ? "Hay una orden de compra sin pagar" : `Hay ${unpaidPOs.length} órdenes de compra sin pagar`}: {unpaidPOs.slice(0, 4).map((po) => po.number || po.id).join(", ")}{unpaidPOs.length > 4 ? "…" : ""}.</span>
          {onGoToPurchaseOrders && <button onClick={onGoToPurchaseOrders} className="shrink-0 rounded-md bg-white/70 px-2 py-1.5 text-xs font-medium hover:bg-white">Ver en Compras</button>}
        </div>
      )}
      {ger && unsignedTeam.length > 0 && (
        <div className="motion-banner rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span className="flex items-start gap-2"><FileSignature className="mt-0.5 h-4 w-4 shrink-0" /><b>{unsignedTeam.length === 1 ? "Hay una orden completada sin firma del cliente" : `Hay ${unsignedTeam.length} órdenes completadas sin firma del cliente`}</b></span>
          <div className="mt-2 flex flex-wrap gap-1.5">{unsignedTeam.slice(0, 6).map((o) => <button key={o.id} onClick={() => onOpenOrder(o)} className="rounded-md bg-white/70 px-2 py-1 font-mono text-xs font-medium hover:bg-white">{o.id}</button>)}{unsignedTeam.length > 6 && <span className="self-center text-xs text-rose-700">+{unsignedTeam.length - 6} más</span>}</div>
        </div>
      )}
      {ger && budgetFollowUps.length > 0 && (
        <div className="motion-banner flex flex-col items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
          <span className="flex items-start gap-2"><Briefcase className="mt-0.5 h-4 w-4 shrink-0" />{budgetFollowUps.length === 1 ? "Hay un presupuesto con seguimiento vencido" : `Hay ${budgetFollowUps.length} presupuestos con seguimiento vencido`}: {budgetFollowUps.slice(0, 4).map((b) => b.number || b.id).join(", ")}{budgetFollowUps.length > 4 ? "…" : ""}.</span>
          {onGoToBudgets && <button onClick={onGoToBudgets} className="shrink-0 rounded-md bg-white/70 px-2 py-1.5 text-xs font-medium hover:bg-white">Ver en Presupuestos</button>}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Mis tareas">
          <div className="space-y-2">
            {myTasks.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">Sin tareas pendientes</div>}
            {myTasks.slice(0, 8).map((t) => (
              <button key={t.id} onClick={() => onOpenTask(t)} className="block w-full rounded-lg border border-slate-200 p-2.5 text-left hover:border-slate-300">
                <div className="flex items-center gap-2">
                  <Chip className={`${prioMeta[t.priority]} ring-1 ring-inset ring-black/5`}><Flag className="h-3 w-3" />{t.priority}</Chip>
                  <span className="truncate text-sm font-medium text-slate-800">{t.title}</span>
                  {isOverdue(t)
                    ? <Chip className="ml-auto bg-rose-50 text-rose-700 ring-rose-600/20">Vencida</Chip>
                    : isDueSoon(t)
                      ? <Chip className="ml-auto bg-amber-50 text-amber-700 ring-amber-600/20">Vence pronto</Chip>
                      : isStale(t) && <Chip className="ml-auto bg-amber-50 text-amber-700 ring-amber-600/20">Estancada</Chip>}
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
        {ger && teamActiveOrders.length > 0 && (
          <Panel title="Órdenes activas del equipo">
            <div className="space-y-2">
              {teamActiveOrders.slice(0, 8).map((o) => (
                <button key={o.id} onClick={() => onOpenOrder(o)} className="block w-full rounded-lg border border-slate-200 p-2.5 text-left hover:border-slate-300">
                  <div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold text-slate-700">{o.id}</span><Chip className={O_STYLE[o.status]}>{o.status}</Chip><span className="truncate text-sm text-slate-700">{o.client}</span></div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{o.site} · {o.service} · {o.tech || "Sin técnico"}</div>
                </button>
              ))}
            </div>
          </Panel>
        )}
        {ger && teamOverdue.length > 0 && (
          <Panel title="Vencidas del equipo">
            <div className="space-y-2">
              {teamOverdue.slice(0, 8).map((t) => (
                <button key={t.id} onClick={() => onOpenTask(t)} className="block w-full rounded-lg border border-slate-200 p-2.5 text-left hover:border-slate-300">
                  <div className="flex items-center gap-2">
                    <Chip className={`${prioMeta[t.priority]} ring-1 ring-inset ring-black/5`}><Flag className="h-3 w-3" />{t.priority}</Chip>
                    <span className="truncate text-sm font-medium text-slate-800">{t.title}</span>
                    <Chip className="ml-auto bg-rose-50 text-rose-700 ring-rose-600/20">Vencida</Chip>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400"><span className="font-mono">{t.id}</span>{t.due && <span className="inline-flex items-center gap-0.5"><Calendar className="h-3 w-3" />{t.due}</span>}<span>· {userById(t.assignee)?.name || "Sin asignar"}</span></div>
                </button>
              ))}
            </div>
          </Panel>
        )}
        {ger && unsignedTeam.length > 0 && (
          <Panel title="Sin firma">
            <div className="space-y-2">
              {unsignedTeam.slice(0, 8).map((o) => (
                <button key={o.id} onClick={() => onOpenOrder(o)} className="block w-full rounded-lg border border-slate-200 p-2.5 text-left hover:border-slate-300">
                  <div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold text-slate-700">{o.id}</span><Chip className={O_STYLE[o.status]}>{o.status}</Chip><span className="truncate text-sm text-slate-700">{o.client}</span></div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{o.site} · {o.service} · {o.tech || "Sin técnico"}</div>
                </button>
              ))}
            </div>
          </Panel>
        )}
        {ger && budgetFollowUps.length > 0 && (
          <Panel title="Presupuestos a seguir">
            <div className="space-y-2">
              {budgetFollowUps.slice(0, 8).map((b) => (
                <button key={b.id} onClick={onGoToBudgets} className="block w-full rounded-lg border border-slate-200 p-2.5 text-left hover:border-slate-300">
                  <div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold text-slate-700">{b.number || b.id}</span><span className="truncate text-sm text-slate-700">{b.title || b.client}</span></div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{b.client}{b.stage ? ` · ${b.stage}` : ""} · Seguimiento: {b.nextFollowUp}</div>
                </button>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}


function OrderRow({ order: o, ger, onOpen }) {
  const t = orderTotals(o);
  return (
    <button onClick={() => onOpen(o)} className="block w-full text-left">
      <Box className="p-4 transition hover:border-slate-300 hover:shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-slate-800">{o.id}</span>
          <Chip className={O_STYLE[o.status]}>{o.status}</Chip>
          {isUrgentOrder(o) && <Chip className="bg-rose-50 text-rose-700 ring-rose-600/20"><AlertTriangle className="h-3 w-3" />Urgente</Chip>}
          {isResponseOverdue(o) && <Chip className="bg-rose-50 text-rose-700 ring-rose-600/20"><Clock className="h-3 w-3" />Respuesta demorada</Chip>}
          {o._offline && <Chip className="bg-amber-50 text-amber-700 ring-amber-200"><WifiOff className="h-3 w-3" />Pendiente de sincronizar</Chip>}
          {o.category && <Chip className="bg-brand-50 text-brand-700 ring-brand-600/20"><Sparkles className="h-3 w-3" />{o.category}</Chip>}
          {(o.quoteNumber || o.budgetNumber) && <Chip title="Presupuesto vinculado" className="bg-sky-50 text-sky-700 ring-sky-600/20"><FileText className="h-3 w-3" />{o.quoteNumber || o.budgetNumber}</Chip>}
          <span className="ml-auto text-sm font-semibold text-slate-900">{ger ? money(t.total) : <span className="text-slate-400">{compactDuration((Number(o.laborHours) || 0) * 3600000)}</span>}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-800"><Building2 className="h-3.5 w-3.5 text-slate-400" />{o.client}</div>
        <div className="text-xs text-slate-500">{o.site} · {o.service} · {o.date}</div>
        {o.equipo && <div className="mt-1 truncate text-xs text-slate-500">Equipo: {o.equipo}</div>}
      </Box>
    </button>
  );
}
/* ===================================== ÓRDENES: HOME ===================================== */
function OrdersHome({ orders, ger, oQ, setOQ, oStatus, setOStatus, oBillable, setOBillable, exportCSV, onOpen }) {
  const [oUrgent, setOUrgent] = useState(false);
  const [view, setView] = useState("lista"); // "lista" | "estado"
  const pendingBill = orders.filter((o) => o.status === "Completada" || o.status === "Aprobada");
  const unsigned = orders.filter((o) => o.status === "Completada" && !o.signatureUrl && !o.noSignReason);
  const overdueResponse = orders.filter(isResponseOverdue);
  const monthKey = localMonthKey();
  const monthOrders = orders.filter((o) => (o.date || "").startsWith(monthKey));
  const monthTotal = monthOrders.reduce((s, o) => s + orderTotals(o).total, 0);
  const monthPending = monthOrders.filter((o) => o.status === "Completada" || o.status === "Aprobada").reduce((s, o) => s + orderTotals(o).total, 0);
  const filtered = orders
    .filter((o) => (oStatus === "Todas" || o.status === oStatus) && (!oBillable || o.status === "Completada" || o.status === "Aprobada") && (!oUrgent || isUrgentOrder(o)) && `${o.id} ${o.client} ${o.site} ${o.service} ${o.equipo} ${o.tech || ""} ${o.category || ""} ${o.sintoma || ""} ${o.solucion || ""}`.toLowerCase().includes(oQ.toLowerCase()))
    .sort((a, b) => (isUrgentOrder(b) - isUrgentOrder(a)) || (isResponseOverdue(b) - isResponseOverdue(a)));
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
        {overdueResponse.length > 0 && (<div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><Clock className="mt-0.5 h-4 w-4 shrink-0" />{overdueResponse.length} orden(es) sin llegada registrada hace más de 2 horas desde el aviso.</div>)}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-0 sm:flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={oQ} onChange={(e) => setOQ(e.target.value)} placeholder="Buscar folio, cliente, equipo, técnico, síntoma…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" /></div>
        <select value={oStatus} onChange={(e) => setOStatus(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm sm:flex-none"><option>Todas</option>{[...O_STATUS.filter((s) => ger || s !== "Facturada"), "Suspendida"].map((s) => <option key={s}>{s}</option>)}</select>
        <button onClick={() => setOUrgent((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium ${oUrgent ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200 bg-white text-slate-600"}`}><AlertTriangle className="h-4 w-4" /> Urgentes</button>
        <div className="flex rounded-lg bg-slate-200 p-0.5"><button onClick={() => setView("lista")} className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${view === "lista" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Lista</button><button onClick={() => setView("estado")} className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${view === "estado" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Por estado</button></div>
        {ger && (<>
          <button onClick={() => setOBillable((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium ${oBillable ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-600"}`}><Filter className="h-4 w-4" /> Facturables</button>
          <button onClick={() => exportCSV(filtered, `ordenes_${monthKey}.csv`)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Download className="h-4 w-4" /> CSV</button>
        </>)}
      </div>
      {view === "estado" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="flex gap-3" style={{ minWidth: "max-content" }}>
            {[...O_STATUS.filter((s) => ger || s !== "Facturada"), "Suspendida"].map((status) => { const items = filtered.filter((o) => o.status === status); return (
              <div key={status} className="w-72 shrink-0">
                <div className="mb-2 flex items-center gap-2 px-1"><Chip className={O_STYLE[status]}>{status}</Chip><span className="text-xs text-slate-400">{items.length}</span></div>
                <div className="space-y-2">
                  {items.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-center text-xs text-slate-400">Sin órdenes</div>}
                  {items.map((o) => <OrderRow key={o.id} order={o} ger={ger} onOpen={onOpen} />)}
                </div>
              </div>
            ); })}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No hay órdenes que coincidan.</div>}
          {filtered.map((o) => <OrderRow key={o.id} order={o} ger={ger} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
}

/* ===================================== ÓRDENES: REPORTE MENSUAL ===================================== */
function MonthlyReport({ orders }) {
  const [mode, setMode] = useState("mes"); // "mes" | "anio"
  const [month, setMonth] = useState(localMonthKey());
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const period = mode === "anio" ? year : month;
  const monthOrders = orders.filter((o) => (o.date || "").startsWith(period) && ["Completada", "Aprobada", "Facturada"].includes(o.status));
  const groups = {};
  monthOrders.forEach((o) => {
    const t = orderTotals(o);
    const g = groups[o.client] || (groups[o.client] = { client: o.client, count: 0, hours: 0, labor: 0, mats: 0, total: 0, facturado: 0, pendiente: 0 });
    g.count++; g.hours += (Number(o.laborHours) || 0) * (Number(o.technicians) || 1); g.labor += t.labor; g.mats += t.mats; g.total += t.total;
    if (o.status === "Facturada") g.facturado += t.total; else g.pendiente += t.total;
  });
  const rows = Object.values(groups).sort((a, b) => b.total - a.total);
  const sum = rows.reduce((s, r) => ({ count: s.count + r.count, total: s.total + r.total, facturado: s.facturado + r.facturado, pendiente: s.pendiente + r.pendiente }), { count: 0, total: 0, facturado: 0, pendiente: 0 });
  const monthLabel = mode === "anio" ? `Año ${year}` : new Date(month + "-01T00:00:00").toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  const chart = rows.slice(0, 8).map((r) => ({ name: r.client.length > 14 ? r.client.slice(0, 13) + "…" : r.client, value: Math.round(r.total), fill: "#F18700" }));
  const exportCSV = () => {
    const head = ["Cliente", "Órdenes", "Horas-técnico", "Mano de obra (USD)", "Materiales (USD)", "Total (USD)", "Facturado (USD)", "Por facturar (USD)"];
    const lines = rows.map((r) => [r.client, r.count, round2(r.hours), r.labor.toFixed(2), r.mats.toFixed(2), r.total.toFixed(2), r.facturado.toFixed(2), r.pendiente.toFixed(2)].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    downloadFile(`reporte_${period}.csv`, [head.join(","), ...lines].join("\n"));
  };
  // Análisis de pausas: cuenta y suma la duración (fin de la pausa dentro del período elegido) de
  // cada categoría y de cada técnico, sobre todas las órdenes (no solo las ya facturables) — a
  // diferencia de la facturación, una pausa importa para el análisis operativo aunque la orden
  // todavía no esté cerrada.
  const pauseByCategory = {}, pauseByTech = {};
  orders.forEach((o) => {
    const sessions = Array.isArray(o.technical?.workSessions) ? o.technical.workSessions : [];
    sessions.filter((s) => s.pauseReason && s.end && String(s.end).startsWith(period)).forEach((s) => {
      const ms = Math.max(0, new Date(s.end) - new Date(s.start));
      const cat = s.pauseCategory || "Otro";
      if (!pauseByCategory[cat]) pauseByCategory[cat] = { category: cat, count: 0, ms: 0 };
      pauseByCategory[cat].count++; pauseByCategory[cat].ms += ms;
      const tech = o.tech || "Sin asignar";
      if (!pauseByTech[tech]) pauseByTech[tech] = { tech, count: 0, ms: 0 };
      pauseByTech[tech].count++; pauseByTech[tech].ms += ms;
    });
  });
  const pauseCategoryRows = Object.values(pauseByCategory).sort((a, b) => b.ms - a.ms);
  const pauseTechRows = Object.values(pauseByTech).sort((a, b) => b.ms - a.ms);
  const pauseTotal = pauseCategoryRows.reduce((s, r) => ({ count: s.count + r.count, ms: s.ms + r.ms }), { count: 0, ms: 0 });
  const suspensionsInPeriod = orders.filter((o) => o.suspendedAt && String(o.suspendedAt).startsWith(period));
  const exportPausesCSV = () => {
    const head = ["Categoría", "Cantidad", "Duración total"];
    const lines = pauseCategoryRows.map((r) => [r.category, r.count, compactDuration(r.ms)].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    downloadFile(`pausas_${period}.csv`, [head.join(","), ...lines].join("\n"));
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-slate-200 p-0.5">
          <button onClick={() => setMode("mes")} className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${mode === "mes" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Mes</button>
          <button onClick={() => setMode("anio")} className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${mode === "anio" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Año</button>
        </div>
        {mode === "anio" ? (
          <input type="number" min="2000" max="2100" step="1" value={year} onChange={(e) => setYear(e.target.value)} className="w-28 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm" />
        ) : (
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm" />
        )}
        <span className="text-sm font-medium capitalize text-slate-600">{monthLabel}</span>
        <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          <button onClick={exportCSV} disabled={!rows.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"><Download className="h-4 w-4" /> CSV</button>
          <button onClick={() => monthlyReportPDF(period, monthLabel, rows, sum)} disabled={!rows.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"><FileText className="h-4 w-4" /> PDF</button>
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
                  <span className="text-xs text-slate-400">{r.count} orden(es) · {round2(r.hours)} h-técnico</span>
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
      <Panel title="Análisis de pausas" action={pauseCategoryRows.length > 0 && <button onClick={exportPausesCSV} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><Download className="h-3.5 w-3.5" /> CSV</button>}>
        {pauseCategoryRows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">No se registraron pausas en {monthLabel}.</p>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Metric label="Pausas" value={pauseTotal.count} icon={Square} tint="text-amber-600" />
              <Metric label="Tiempo total pausado" value={compactDuration(pauseTotal.ms)} icon={Clock} tint="text-amber-600" />
              <Metric label="Suspensiones de orden" value={suspensionsInPeriod.length} icon={AlertTriangle} tint="text-rose-600" description="Órdenes suspendidas por completo (clima, acceso, cliente, etc.), no pausas cortas de sesión de trabajo." />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Por tipo de pausa</p>
                <div className="space-y-1.5">{pauseCategoryRows.map((r) => (
                  <div key={r.category} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <span className="font-medium text-slate-700">{r.category}</span>
                    <span className="text-slate-500">{r.count} · <b className="text-slate-700">{compactDuration(r.ms)}</b></span>
                  </div>
                ))}</div>
              </div>
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Por técnico</p>
                <div className="space-y-1.5">{pauseTechRows.map((r) => (
                  <div key={r.tech} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <span className="font-medium text-slate-700">{r.tech}</span>
                    <span className="text-slate-500">{r.count} · <b className="text-slate-700">{compactDuration(r.ms)}</b></span>
                  </div>
                ))}</div>
              </div>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

/* ===================================== ÓRDENES: DETALLE ===================================== */
function OrderDetail({ ger, order, users = [], projects = [], onClose, onUpdate, onAdvance, onExport, onDelete, onComment, onDuplicate, onCreateTask, onContinue, onEdit, me }) {
  useDialogOpenClass();
  const idx = O_STATUS.indexOf(order.status);
  const next = idx >= 0 && idx < O_STATUS.length - 1 ? O_STATUS[idx + 1] : null;
  const assignedTechs = order.assignedTechs?.length ? order.assignedTechs : (order.tech ? [order.tech] : []);
  const canManageTechs = ger || assignedTechs.some((name) => name.toLowerCase() === (me?.name || "").toLowerCase());
  const fieldTechs = users.filter((u) => u.active && ["admin", "gerente", "tecnico"].includes(u.role));
  const [mateTechPick, setMateTechPick] = useState("");
  const addMateTech = (name) => { const value = (name || "").trim(); if (!value || assignedTechs.some((t) => t.toLowerCase() === value.toLowerCase())) return; onUpdate(order.id, { assignedTechs: [...assignedTechs, value] }); setMateTechPick(""); };
  const removeMateTech = (name) => onUpdate(order.id, { assignedTechs: assignedTechs.filter((t) => t !== name) });
  const reportReady = ["Completada", "Aprobada", "Facturada"].includes(order.status);
  const closureReady = ["Completada", "Aprobada", "Facturada"].includes(order.status);
  const needSign = next === "Aprobada" && !order.signatureUrl && !order.noSignReason;
  const needTechnicianSign = !!next && ["Completada", "Aprobada", "Facturada"].includes(next) && !order.technicianSignatureUrl;
  const canAdvance = next && (next !== "Aprobada" || ger) && (next !== "Facturada" || ger);
  const isSuspended = order.status === "Suspendida";
  const canSuspend = ["En proceso de ejecución", "Completada", "Aprobada"].includes(order.status);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const suspend = ({ category, reason }) => { onUpdate(order.id, { status: "Suspendida", suspendReason: reason, suspendCategory: category, suspendedFromStatus: order.status, suspendedAt: new Date().toISOString() }); setSuspendOpen(false); };
  const resume = () => onUpdate(order.id, { status: order.suspendedFromStatus || "Borrador", suspendReason: "", suspendedFromStatus: "", resumedAt: new Date().toISOString() });
  // Reabrir una orden Completada la devuelve a "En proceso de ejecución" para poder retomarla desde
  // el asistente (botón "Retomar y finalizar trabajo") y agregar fotos u otra evidencia faltante.
  const canReopen = order.status === "Completada";
  const [reopenOpen, setReopenOpen] = useState(false);
  const reopen = (reason) => { onUpdate(order.id, { status: "En proceso de ejecución", reopenReason: reason, reopenedAt: new Date().toISOString() }); setReopenOpen(false); };
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
    const project = projects.find((item) => item.id === order.projectId) || null;
    if (audience === "internal") internalOrderReportPDF(order, project);
    else if (audience === "valued") valuedClientReportPDF(order, project);
    else clientOrderReportPDF(order, project);
  };
  const [zoom, setZoom] = useState(null);
  const mouseDownOnBackdrop = useRef(false);
  return (
    <div className="motion-backdrop fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3"><div className="flex items-center gap-2"><span className="font-mono text-sm font-semibold text-slate-800">{order.id}</span><Chip className={O_STYLE[order.status]}>{order.status}</Chip></div><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="space-y-4 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-5">
          <section><div className="text-base font-semibold text-slate-900">{order.client}</div><div className="text-sm text-slate-500">{order.site}{order.contact ? ` · ${order.contact}` : ""}</div><div className="mt-1 text-xs text-slate-500">{order.service} · {order.date}{order.tech ? ` · Técnico: ${order.tech}` : ""}</div>{(order.quoteNumber || order.customerPO) && <div className="mt-1 text-xs text-slate-400">{order.quoteNumber ? `Presupuesto: ${order.quoteNumber}` : ""}{order.quoteNumber && order.customerPO ? " · " : ""}{order.customerPO ? `OC: ${order.customerPO}` : ""}</div>}<div className="mt-3 flex flex-wrap gap-2">{order.contactPhone && <a href={`tel:${order.contactPhone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600"><Phone className="h-4 w-4" /> Llamar</a>}{order.location && <a href={`https://www.google.com/maps/search/?api=1&query=${order.location.lat},${order.location.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600"><Navigation className="h-4 w-4" /> Abrir mapa</a>}<button onClick={shareOrder} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600"><ExternalLink className="h-4 w-4" /> Compartir</button></div></section>
          {(assignedTechs.length > 1 || canManageTechs) && <section className="rounded-lg border border-slate-200 p-3"><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Técnicos con acceso</h4><div className="flex flex-wrap gap-1.5">{assignedTechs.map((name) => <Chip key={name} className="bg-slate-100 text-slate-700 ring-slate-300">{name}{canManageTechs && name !== order.tech && <button type="button" onClick={() => removeMateTech(name)} aria-label={`Quitar a ${name}`} className="ml-1 text-slate-400 hover:text-rose-500"><X className="h-3 w-3" /></button>}</Chip>)}</div>{canManageTechs && <div className="mt-2 flex gap-2"><input list="order-detail-mate-techs" value={mateTechPick} onChange={(e) => setMateTechPick(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMateTech(mateTechPick); } }} placeholder="Sumar técnico a esta orden" className="u-input flex-1 text-sm" /><button type="button" onClick={() => addMateTech(mateTechPick)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Agregar</button><datalist id="order-detail-mate-techs">{fieldTechs.filter((u) => !assignedTechs.some((name) => name.toLowerCase() === u.name.toLowerCase())).map((u) => <option key={u.id} value={u.name} />)}</datalist></div>}</section>}
          {onContinue && <button onClick={() => onContinue(order)} className="flex w-full items-center justify-between gap-3 rounded-xl bg-brand-500 px-4 py-3 text-left text-white shadow-sm hover:bg-brand-400"><span><b className="block text-sm">Retomar y finalizar trabajo</b><span className="mt-0.5 block text-[11px] text-white/80">Completar imágenes, diagnóstico, intervención, verificaciones y firmas.</span></span><ChevronRight className="h-5 w-5 shrink-0" /></button>}
          {(order.equipo || order.sintoma || order.solucion) && (<section className="rounded-lg bg-slate-50 p-3 text-sm">{order.equipo && <p><span className="font-medium text-slate-700">Equipo:</span> {order.equipo}</p>}{order.sintoma && <p className="mt-1"><span className="font-medium text-slate-700">Síntoma:</span> {order.sintoma}</p>}{order.solucion && <p className="mt-1"><span className="font-medium text-slate-700">Trabajo:</span> {order.solucion}</p>}</section>)}
          {order.technical?.reportedAt && <section className="rounded-lg border border-slate-200 p-3"><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Cronología del servicio</h4><div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{[["Aviso", order.technical.reportedAt], ["Llegada", order.technical.arrivalAt], ["Inicio", order.technical.startedAt], ["Fin", order.technical.completedAt]].map(([label, value]) => <div key={label}><span className="block text-[10px] text-slate-400">{label}</span><b className="text-slate-700">{value ? new Date(value).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Pendiente"}</b></div>)}</div><div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600"><span className="rounded-md bg-slate-100 px-2 py-1">Intervención: {compactDuration(timelineWorkMs(order.technical, order.technical.completedAt ? new Date(order.technical.completedAt).getTime() : Date.now()))}</span>{order.technical.downtimeMinutes > 0 && <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-700">Parada productiva: {order.technical.downtimeMinutes} min</span>}</div></section>}
          {order.technical && Object.values(order.technical).some(Boolean) && <section className="rounded-lg border border-slate-200 p-3 text-sm"><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Ficha técnica</h4><div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">{order.technical.assetTag && <p><b>TAG:</b> {order.technical.assetTag}</p>}{order.technical.manufacturer && <p><b>Fabricante:</b> {order.technical.manufacturer}</p>}{order.technical.model && <p><b>Modelo:</b> {order.technical.model}</p>}{order.technical.serial && <p><b>Serie:</b> {order.technical.serial}</p>}{order.technical.finalCondition && <p><b>Estado final:</b> {order.technical.finalCondition}</p>}{order.technical.downtimeMinutes > 0 && <p><b>Parada:</b> {order.technical.downtimeMinutes} min</p>}</div>{order.technical.diagnosis && <p className="mt-2 text-xs text-slate-600"><b>Diagnóstico:</b> {order.technical.diagnosis}</p>}{order.technical.rootCause && <p className="mt-1 text-xs text-slate-600"><b>Causa raíz:</b> {order.technical.rootCause}</p>}{order.technical.testsPerformed && <p className="mt-1 text-xs text-slate-600"><b>Pruebas:</b> {order.technical.testsPerformed}</p>}{order.technical.testResult && <p className="mt-1 text-xs text-slate-600"><b>Resultado:</b> {order.technical.testResult}</p>}{order.technical.recommendations && <p className="mt-1 text-xs text-slate-600"><b>Recomendaciones:</b> {order.technical.recommendations}</p>}{ger && order.technical.internalNotes && <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800"><b>Nota interna:</b> {order.technical.internalNotes}</p>}</section>}
          {ger && (order.technical?.recurrence || order.technical?.internalDisposition || order.technical?.internalOwner || (order.service === "Garantía" && order.technical?.warranty)) && <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 text-xs text-slate-600"><h4 className="mb-2 font-semibold uppercase tracking-wide text-violet-500">Gestión interna</h4>{order.service === "Garantía" && order.technical?.warranty && <p><b>Garantía:</b> {order.technical.warranty}</p>}{order.technical?.recurrence && <p><b>Recurrencia:</b> {order.technical.recurrence}</p>}{order.technical?.internalDisposition && <p><b>Próxima acción:</b> {order.technical.internalDisposition}</p>}{order.technical?.internalOwner && <p><b>Responsable:</b> {order.technical.internalOwner}</p>}</section>}
          {order.noSignReason && <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700">Cerrada sin firma. Motivo: {order.noSignReason}</div>}
          {order.recurrenceMonths > 0 && <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800"><RefreshCw className="h-4 w-4 shrink-0" />Mantenimiento preventivo recurrente cada {order.recurrenceMonths} mes(es).{order.recurrenceSpawnedId ? ` Próximo generado: ${order.recurrenceSpawnedId}.` : ""}</div>}
          {isSuspended && <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>Orden suspendida por causas ajenas al trabajo{order.suspendedAt ? ` · ${new Date(order.suspendedAt).toLocaleString("es-AR")}` : ""}.<br />{order.suspendCategory && <Chip className="mb-1 mt-1 bg-rose-100 text-rose-700 ring-rose-600/20">{order.suspendCategory}</Chip>}<br />Motivo: {order.suspendReason || "Sin especificar"}</span></div>}
          {order.photos && order.photos.length > 0 && (<section><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Evidencia</h4><div className="flex flex-wrap gap-2">{order.photos.map((p, i) => p.kind === "document" ? (<a key={i} href={p.url} download={p.name || "documento"} title={p.name} className="relative flex h-16 w-16 flex-col items-center justify-center rounded-lg bg-slate-100 ring-1 ring-slate-200 hover:bg-slate-200"><FileText className="h-6 w-6 text-slate-500" /><span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 text-center text-[9px] text-white">{p.cat}</span></a>) : (<button key={i} onClick={() => setZoom(p)} className="relative" aria-label={`Ampliar foto ${p.cat || ""}`}><img src={p.preview || p.url} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-200" /><span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 text-center text-[9px] text-white">{p.cat}</span></button>))}</div></section>)}
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
          <section className="space-y-3 pt-1">
            {/* Flujo de la orden: qué hacer con ella ahora mismo */}
            <div className="flex flex-wrap items-center gap-2">
              {onEdit && <button onClick={() => onEdit(order)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400"><Pencil className="h-4 w-4" /> Editar orden</button>}
              {canAdvance && <button disabled={needSign || needTechnicianSign} onClick={() => onAdvance(order.id, next)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Marcar {next}</button>}
              {needSign && <button onClick={() => setNoSignOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"><AlertTriangle className="h-4 w-4" /> Aprobar sin firma</button>}
              {isSuspended ? <button onClick={resume} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"><Play className="h-4 w-4" /> Reanudar orden</button> : canSuspend && <button onClick={() => setSuspendOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"><AlertTriangle className="h-4 w-4" /> Suspender orden</button>}
              {canReopen && <button onClick={() => setReopenOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100"><RefreshCw className="h-4 w-4" /> Reabrir orden</button>}
              {needTechnicianSign && <span className="self-center text-xs font-medium text-amber-600">Guarda la firma técnica para completar.</span>}
              {next === "Aprobada" && !ger && <span className="self-center text-xs text-slate-400">La aprobación corresponde a Gerencia.</span>}
              {next === "Facturada" && !ger && <span className="self-center text-xs text-slate-400">La facturación la realiza Gerencia.</span>}
            </div>

            {/* Reportes y documentos descargables */}
            {reportReady && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                <button title="Documento técnico para entregar al cliente, sin costos internos ni cronología administrativa." onClick={() => downloadReport("client")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><FileText className="h-4 w-4" /> Reporte para cliente</button>
                {ger && <button title="Constancia para el cliente que incorpora los importes facturables, sin revelar costos internos ni margen." onClick={() => downloadReport("valued")} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"><DollarSign className="h-4 w-4" /> Constancia valorizada</button>}
                {ger && <button title="Informe administrativo completo con cronología, costos internos, márgenes y datos de gestión." onClick={() => downloadReport("internal")} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"><FileText className="h-4 w-4" /> Informe interno</button>}
              </div>
            )}

            {/* Utilidades: exportar, duplicar, vincular con proyectos */}
            {ger && (onExport || onDuplicate || onCreateTask) && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                {onExport && <button onClick={() => onExport(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Download className="h-4 w-4" /> Exportar</button>}
                {onDuplicate && <button onClick={() => onDuplicate(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Copy className="h-4 w-4" /> Duplicar</button>}
                {onCreateTask && <button onClick={() => onCreateTask(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Link2 className="h-4 w-4" /> Crear tarea</button>}
              </div>
            )}

            {/* Zona de riesgo: separada del resto para no confundirla con una acción cualquiera */}
            {ger && onDelete && (
              <div className="flex flex-wrap items-center gap-2 border-t border-rose-100 pt-3">
                <button onClick={() => onDelete(order.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /> Eliminar orden</button>
              </div>
            )}
          </section>
          {onComment && <section className="border-t border-slate-100 pt-4"><ActivitySection entity={order} onSend={(text) => onComment(order.id, text)} /></section>}
        </div>
      </div>
      {zoom && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4" onClick={(e) => { e.stopPropagation(); setZoom(null); }}><img src={zoom.url} alt={zoom.cat} className="max-h-[90vh] max-w-full rounded-lg" /><button className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white"><X className="h-5 w-5" /></button></div>}
      {noSignOpen && <ReasonDialog onClose={() => setNoSignOpen(false)} onConfirm={(reason) => { onUpdate(order.id, { status: "Aprobada", noSignReason: reason }); setNoSignOpen(false); }} />}
      {suspendOpen && <ReasonDialog title="Suspender orden" description="Registrá el motivo ajeno al trabajo (clima, acceso, espera de repuestos, decisión del cliente, etc.). La orden queda pausada hasta que la reanudes." placeholder="Ej. Cliente reprogramó la visita; sin acceso a planta; a la espera de un repuesto" confirmLabel="Suspender" confirmClass="bg-rose-600" showCategory onClose={() => setSuspendOpen(false)} onConfirm={suspend} />}
      {reopenOpen && <ReasonDialog title="Reabrir orden" description="Registrá el motivo (fotos faltantes, corregir evidencia, etc.). La orden vuelve a 'En proceso de ejecución' y podrás retomarla con el botón 'Retomar y finalizar trabajo' para agregar imágenes u otros datos antes de completarla de nuevo." placeholder="Ej. Faltaban fotos del estado final del tablero" confirmLabel="Reabrir" confirmClass="bg-sky-600" onClose={() => setReopenOpen(false)} onConfirm={reopen} />}
    </div>
  );
}

function OrderEditDialog({ order, clients, users, parts, budgets = [], projects = [], onClose, onSave }) {
  useDialogOpenClass();
  const hydrateMaterial = (material) => {
    const part = parts.find((item) => (material.partId && item.id === material.partId) || item.name === material.name);
    if (!part) return { ...material };
    const quantity = part.unit === "u" ? Math.max(1, Math.round(Number(material.qty) || 1)) : material.qty;
    return { ...material, partId: part.id, name: part.name, unit: part.unit || material.unit, qty: quantity, price: wholeMoney(part.price), cost: wholeMoney(part.cost), partNumber: material.partNumber || part.partNumber || "", brand: material.brand || part.brand || "", model: material.model || part.model || "", supplier: material.supplier || part.supplier || "" };
  };
  const [form, setForm] = useState(() => ({ ...order, rate: normalizedRate(order.rate), laborCost: wholeMoney(order.laborCost), technical: { ...(order.technical || {}) }, materials: (order.materials || []).map(hydrateMaterial) }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  // Personas distintas entre el responsable y "Técnicos con acceso" — para avisar si "Técnicos en
  // planta" (el número que se usa para facturar) quedó desactualizado respecto a quién tiene
  // acceso hoy a la orden. Son dos campos independientes a propósito (alguien sin usuario en la
  // app también puede haber trabajado), así que no se auto-corrige, solo se avisa.
  const distinctAssigned = new Set([form.tech, ...(form.assignedTechs || [])].filter(Boolean).map((name) => name.trim().toLowerCase())).size;
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
  // Permite a un administrador sumar o corregir evidencia fotográfica de una orden ya cargada,
  // por si el técnico de campo se olvidó de alguna foto o subió una que no corresponde.
  const addEditPhoto = async (file, cat) => {
    if (!file) return;
    setPhotoBusy(true);
    try {
      if (!file.type.startsWith("image/")) {
        if (file.size > MAX_DOCUMENT_BYTES) { setSaveError("El archivo supera los 5 MB permitidos."); return; }
        const url = await fileToDataUrl(file);
        setForm((current) => ({ ...current, photos: [...(current.photos || []), { url, name: file.name, mime: file.type, cat, ts: new Date().toISOString(), kind: "document" }] }));
      } else {
        const { report, thumb } = await fileToImages(file);
        setForm((current) => ({ ...current, photos: [...(current.photos || []), { url: report, preview: thumb, cat, ts: new Date().toISOString(), kind: "image" }] }));
      }
    } catch { setSaveError("No se pudo adjuntar el archivo."); }
    finally { setPhotoBusy(false); }
  };
  const removeEditPhoto = (index) => setForm((current) => ({ ...current, photos: (current.photos || []).filter((_, photoIndex) => photoIndex !== index) }));
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
      photos: form.photos || [],
    };
    await onSave(patch); setSaving(false);
  };
  const fieldTechs = users.filter((user) => user.active && ["admin", "gerente", "tecnico"].includes(user.role));
  const timelineChanged = ["reportedAt", "arrivalAt", "startedAt", "completedAt", "billableWaitMinutes", "billableWaitReason", "downtimeMinutes"].some((field) => (form.technical[field] || "") !== (order.technical?.[field] || ""));
  const timelineReasonUpdated = !!form.technical.timelineAdjustmentReason?.trim() && form.technical.timelineAdjustmentReason.trim() !== (order.technical?.timelineAdjustmentReason || "").trim();
  const mouseDownOnBackdrop = useRef(false);
  return (
    <div className="motion-backdrop fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/60 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
      <div className="mobile-dialog mobile-sheet-content flex w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 p-4 pb-0 sm:p-5 sm:pb-0"><div><h2 className="text-lg font-semibold text-slate-900">Editar {order.id}</h2><p className="mt-0.5 text-xs text-slate-500">Edición administrativa completa · importes expresados en USD.</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-4 sm:p-5 sm:pt-4">
        <div className="space-y-5">
          <section className="rounded-xl border border-sky-200 bg-sky-50/60 p-4"><div className="mb-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-sky-700">Vinculación comercial</h3><p className="mt-1 text-[11px] text-slate-500">Selecciona el presupuesto para incorporar automáticamente su número, OC, cliente y proyecto.</p></div><L label="Presupuesto aprobado / facturado"><select value={form.budgetId || ""} onChange={(event) => selectBudget(event.target.value)} className="u-input bg-white"><option value="">Sin presupuesto asociado</option>{availableBudgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.number || budget.id} · {budget.client} · {budget.title}</option>)}</select></L><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"><div className="rounded-lg border border-sky-100 bg-white p-3"><span className="block text-[10px] text-slate-400">N° de presupuesto</span><b className="mt-1 block text-xs text-slate-700">{form.quoteNumber || "Sin asignar"}</b></div><div className="rounded-lg border border-sky-100 bg-white p-3"><span className="block text-[10px] text-slate-400">OC del cliente</span><b className="mt-1 block text-xs text-slate-700">{form.customerPO || "Sin asignar"}</b></div><div className="rounded-lg border border-sky-100 bg-white p-3"><span className="block text-[10px] text-slate-400">Proyecto vinculado</span><b className="mt-1 block truncate text-xs text-slate-700">{projects.find((project) => project.id === form.projectId)?.key || "Sin proyecto"}</b></div></div></section>
          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Cliente y servicio</h3><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><L label="Cliente *"><input list="edit-order-clients" value={form.client || ""} onChange={(event) => { const client = clients.find((item) => item.name === event.target.value); set({ client: event.target.value, ...(client ? { site: clientSites(client)[0]?.name || form.site, contact: client.contactName || form.contact } : {}) }); }} className="u-input" /><datalist id="edit-order-clients">{clients.map((client) => <option key={client.id} value={client.name} />)}</datalist></L><L label="Sitio *">{(() => { const matchedSites = clientSites(clients.find((item) => item.name === form.client)); return matchedSites.length > 1 ? (<select value={form.site || ""} onChange={(event) => set({ site: event.target.value })} className="u-input">{matchedSites.map((s) => <option key={s.code || s.name} value={s.name}>{s.name}{s.code ? ` (${s.code})` : ""}</option>)}</select>) : (<input value={form.site || ""} onChange={(event) => set({ site: event.target.value })} className="u-input" />); })()}</L><L label="Contacto"><input value={form.contact || ""} onChange={(event) => set({ contact: event.target.value })} className="u-input" /></L><L label="Técnico de campo"><input list="edit-order-techs" value={form.tech || ""} onChange={(event) => set({ tech: event.target.value })} className="u-input" /><datalist id="edit-order-techs">{fieldTechs.map((user) => <option key={user.id} value={user.name} />)}</datalist></L><L label="Tipo de servicio"><select value={form.service || SERVICE_TYPES[0]} onChange={(event) => set({ service: event.target.value })} className="u-input">{SERVICE_TYPES.map((service) => <option key={service}>{service}</option>)}</select></L><L label="Fecha"><input type="date" value={form.date || ""} onChange={(event) => set({ date: event.target.value })} className="u-input" /></L><L label="Estado"><select value={form.status || O_STATUS[0]} onChange={(event) => set({ status: event.target.value })} className="u-input">{O_STATUS.map((status) => <option key={status}>{status}</option>)}</select></L><L label="Clasificación"><input value={form.category || ""} onChange={(event) => set({ category: event.target.value })} className="u-input" /></L></div></section>

          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Trabajo realizado</h3><div className="space-y-2"><input value={form.equipo || ""} onChange={(event) => set({ equipo: event.target.value })} placeholder="Equipo o sistema intervenido" className="u-input" /><textarea value={form.sintoma || ""} onChange={(event) => set({ sintoma: event.target.value })} rows={2} placeholder="Síntoma o falla reportada" className="u-input resize-none" /><textarea value={form.solucion || ""} onChange={(event) => set({ solucion: event.target.value })} rows={3} placeholder="Intervención y solución" className="u-input resize-none" /></div></section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Fotos de evidencia</h3>
              {photoBusy && <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Procesando…</span>}
            </div>
            <p className="mb-2 text-[11px] text-slate-500">Corregí acá la evidencia de la orden si al técnico se le pasó una foto o subió una que no corresponde.</p>
            {(form.photos || []).length > 0 && <div className="mb-2 flex flex-wrap gap-2">{form.photos.map((p, index) => (<div key={index} className="relative">{p.kind === "document" ? <div title={p.name} className="grid h-16 w-16 place-items-center rounded-lg bg-slate-100 ring-1 ring-slate-200"><FileText className="h-6 w-6 text-slate-500" /></div> : <img src={p.preview || p.url} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-200" />}<span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 text-center text-[9px] text-white">{p.cat}</span><button type="button" onClick={() => removeEditPhoto(index)} aria-label="Quitar foto" className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 shadow ring-1 ring-slate-200 hover:bg-rose-50"><X className="h-3 w-3 text-slate-500 hover:text-rose-500" /></button></div>))}</div>}
            <div className="grid grid-cols-3 gap-2"><PhotoBtn icon={Camera} label="Antes" cat="antes" onPick={addEditPhoto} /><PhotoBtn icon={Camera} label="Durante" cat="durante" onPick={addEditPhoto} /><PhotoBtn icon={Camera} label="Después" cat="después" onPick={addEditPhoto} /></div>
            <p className="mt-1 text-[11px] text-slate-400">Foto, PDF, Excel o CSV · máx. 5 MB por archivo</p>
          </section>

          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Ficha técnica</h3><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><L label="TAG"><input value={form.technical.assetTag || ""} onChange={(event) => setTechnical("assetTag", event.target.value)} className="u-input" /></L><L label="Fabricante"><input value={form.technical.manufacturer || ""} onChange={(event) => setTechnical("manufacturer", event.target.value)} className="u-input" /></L><L label="Modelo"><input value={form.technical.model || ""} onChange={(event) => setTechnical("model", event.target.value)} className="u-input" /></L><L label="N° de serie"><input value={form.technical.serial || ""} onChange={(event) => setTechnical("serial", event.target.value)} className="u-input" /></L></div><div className="mt-2 space-y-2"><textarea value={form.technical.diagnosis || ""} onChange={(event) => setTechnical("diagnosis", event.target.value)} rows={4} placeholder="Diagnóstico" className="u-input resize-y" /><textarea value={form.technical.rootCause || ""} onChange={(event) => setTechnical("rootCause", event.target.value)} rows={3} placeholder="Causa raíz" className="u-input resize-y" /><textarea value={form.technical.testsPerformed || ""} onChange={(event) => setTechnical("testsPerformed", event.target.value)} rows={3} placeholder="Pruebas realizadas" className="u-input resize-y" /><textarea value={form.technical.testResult || ""} onChange={(event) => setTechnical("testResult", event.target.value)} rows={3} placeholder="Resultado de pruebas" className="u-input resize-y" /><textarea value={form.technical.recommendations || ""} onChange={(event) => setTechnical("recommendations", event.target.value)} rows={3} placeholder="Recomendaciones" className="u-input resize-y" /><textarea value={form.technical.pendingActions || ""} onChange={(event) => setTechnical("pendingActions", event.target.value)} rows={3} placeholder="Acciones pendientes" className="u-input resize-y" /><textarea value={form.technical.internalNotes || ""} onChange={(event) => setTechnical("internalNotes", event.target.value)} rows={3} placeholder="Notas internas" className="u-input resize-y" /></div></section>

          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Cronología · corrección administrativa</h3><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><L label="Aviso recibido"><input type="datetime-local" value={dateTimeLocalValue(form.technical.reportedAt)} onChange={(event) => setTechnical("reportedAt", isoFromLocal(event.target.value))} className="u-input" /></L><L label="Llegada al sitio"><input type="datetime-local" value={dateTimeLocalValue(form.technical.arrivalAt)} onChange={(event) => setTechnical("arrivalAt", isoFromLocal(event.target.value))} className="u-input" /></L><L label="Inicio de intervención"><input type="datetime-local" value={dateTimeLocalValue(form.technical.startedAt)} onChange={(event) => setTechnical("startedAt", isoFromLocal(event.target.value))} className="u-input" /></L><L label="Finalización"><input type="datetime-local" value={dateTimeLocalValue(form.technical.completedAt)} onChange={(event) => setTechnical("completedAt", isoFromLocal(event.target.value))} className="u-input" /></L><L label="Espera por condiciones del sitio (minutos)"><input type="number" min="0" step="1" value={form.technical.billableWaitMinutes || ""} onChange={(event) => setTechnical("billableWaitMinutes", Math.max(0, Math.round(Number(event.target.value) || 0)))} className="u-input" /></L><L label="Parada productiva informada (minutos, independiente de la visita)"><input type="number" min="0" step="1" value={form.technical.downtimeMinutes || ""} onChange={(event) => setTechnical("downtimeMinutes", Math.max(0, Math.round(Number(event.target.value) || 0)))} className="u-input" /></L></div>{(Number(form.technical.billableWaitMinutes) || 0) > 0 && <L label="Motivo de la espera"><input value={form.technical.billableWaitReason || ""} onChange={(event) => setTechnical("billableWaitReason", event.target.value)} placeholder="Autorización, acceso o disponibilidad del equipo" className="u-input mt-2" /></L>}<L label="Motivo de la corrección"><input value={form.technical.timelineAdjustmentReason || ""} onChange={(event) => setTechnical("timelineAdjustmentReason", event.target.value)} placeholder="Obligatorio y diferente al motivo anterior" className={`u-input mt-2 ${timelineChanged && !timelineReasonUpdated ? "border-amber-400" : ""}`} /></L>{timelineChanged && !timelineReasonUpdated && <p className="mt-1 text-[11px] text-amber-600">Escribe un nuevo motivo para conservar la trazabilidad de esta corrección.</p>}{saveError && <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{saveError}</div>}</section>

          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Gestión interna</h3>{form.service === "Garantía" && <L label="Cobertura y vigencia de garantía"><input value={form.technical.warranty || ""} onChange={(event) => setTechnical("warranty", event.target.value)} className="u-input" /></L>}<div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"><L label="Recurrencia"><select value={form.technical.recurrence || ""} onChange={(event) => setTechnical("recurrence", event.target.value)} className="u-input"><option value="">Seleccionar</option><option>Primera intervención</option><option>Recurrente</option><option>Seguimiento programado</option></select></L><L label="Próxima acción"><select value={form.technical.internalDisposition || ""} onChange={(event) => setTechnical("internalDisposition", event.target.value)} className="u-input"><option value="">Sin acción definida</option><option>Seguimiento técnico</option><option>Cotizar mejora o repuesto</option><option>Esperar repuesto</option><option>Escalar a ingeniería</option><option>Cerrar sin seguimiento</option></select></L><L label="Responsable interno"><input value={form.technical.internalOwner || ""} onChange={(event) => setTechnical("internalOwner", event.target.value)} className="u-input" /></L></div></section>

          <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Mano de obra · USD</h3><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><L label="Horas en planta"><input type="number" min="0" step="0.5" value={form.laborHours ?? ""} onChange={(event) => set({ laborHours: event.target.value })} className="u-input" /></L><L label="Técnicos en planta"><input type="number" min="1" step="1" value={form.technicians ?? 1} onChange={(event) => set({ technicians: event.target.value })} onBlur={(event) => set({ technicians: Math.max(1, Math.round(Number(event.target.value) || 1)) })} className={`u-input ${Number(form.technicians) !== distinctAssigned ? "border-amber-400" : ""}`} /></L><L label="Tarifa/h por técnico (USD)"><input type="number" min="0" step="1" value={form.rate ?? DEFAULT_RATE} onChange={(event) => set({ rate: event.target.value })} onBlur={(event) => set({ rate: normalizedRate(event.target.value) })} className="u-input" /></L><L label="Costo interno/h por técnico (USD)"><input type="number" min="0" step="1" value={form.laborCost ?? 0} onChange={(event) => set({ laborCost: event.target.value })} onBlur={(event) => set({ laborCost: wholeMoney(event.target.value) })} className="u-input" /></L></div><p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">Cálculo: {form.laborHours || 0} h × {form.technicians || 1} técnico(s) × {money(form.rate)} = <b>{money((Number(form.laborHours) || 0) * (Number(form.technicians) || 1) * (Number(form.rate) || 0))}</b></p>{Number(form.technicians) !== distinctAssigned && <p className="mt-1.5 text-[11px] text-amber-600">"Técnicos en planta" ({form.technicians || 1}) no coincide con la cantidad de personas en "Técnicos con acceso" ({distinctAssigned}). Verificá cuál es el número correcto antes de guardar.</p>}<label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={form.laborBillable !== false} onChange={(event) => set({ laborBillable: event.target.checked })} /> Mano de obra facturable</label></section>

          <section><div className="mb-2 flex items-center justify-between"><div><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Materiales · USD</h3><p className="mt-0.5 text-[11px] text-slate-500">Venta y costo interno se cargan automáticamente desde Inventario.</p></div><button onClick={addMaterial} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600"><Plus className="h-3.5 w-3.5" /> Material</button></div><datalist id="edit-order-parts">{parts.map((part) => <option key={part.id} value={part.name} />)}</datalist><div className="hidden grid-cols-[minmax(0,1fr)_5rem_7rem_7rem_auto] gap-2 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:grid"><span>Inventario</span><span>Cant.</span><span>Venta USD<br />con adicional</span><span>Costo interno<br />USD</span><span /></div><div className="space-y-2">{form.materials.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-5 text-center text-xs text-slate-400">Sin materiales.</div>}{form.materials.map((material, index) => <div key={index} className="rounded-lg border border-slate-200 p-2.5"><div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_7rem_7rem_auto]"><input list="edit-order-parts" value={material.name || ""} onChange={(event) => selectInventoryMaterial(index, event.target.value)} placeholder="Buscar en inventario" className="u-input col-span-2 sm:col-span-1" /><input type="number" min={material.unit === "u" ? 1 : 0} step={material.unit === "u" ? 1 : 0.1} value={material.qty ?? 1} onChange={(event) => setMaterial(index, { qty: event.target.value })} onBlur={(event) => material.unit === "u" && setMaterial(index, { qty: Math.max(1, Math.round(Number(event.target.value) || 1)) })} placeholder="Cant." aria-label="Cantidad" className="u-input" /><input type="number" min="0" step="1" value={material.price ?? 0} onChange={(event) => setMaterial(index, { price: event.target.value })} onBlur={(event) => setMaterial(index, { price: wholeMoney(event.target.value) })} placeholder="Venta USD" aria-label="Venta unitaria en USD con adicional" className="u-input" /><input type="number" min="0" step="1" value={material.cost ?? 0} onChange={(event) => setMaterial(index, { cost: event.target.value })} onBlur={(event) => setMaterial(index, { cost: wholeMoney(event.target.value) })} placeholder="Costo USD" aria-label="Costo interno unitario en USD" className="u-input" /><button onClick={() => removeMaterial(index)} aria-label="Quitar material" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button></div><div className="mt-2 flex flex-wrap items-center gap-3"><label className="inline-flex items-center gap-2 text-[11px] text-slate-500"><input type="checkbox" checked={material.billable !== false} onChange={(event) => setMaterial(index, { billable: event.target.checked })} /> Facturable</label>{material.partId && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Vinculado al inventario</span>}</div></div>)}</div></section>
        </div>
        </div>
        <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-white p-4 sm:p-5"><button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button onClick={save} disabled={saving || !form.client?.trim() || !form.site?.trim() || (timelineChanged && !timelineReasonUpdated)} className="flex-1 rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? "Guardando…" : "Guardar cambios"}</button></div>
      </div>
    </div>
  );
}

function ReasonDialog({ onClose, onConfirm, title = "Aprobar sin firma", description = "Registrá el motivo para mantener la trazabilidad de la orden.", placeholder = "Ej. Cliente ausente; conformidad recibida por teléfono", confirmLabel = "Aprobar", confirmClass = "bg-amber-600", showCategory = false }) {
  useDialogOpenClass();
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState(PAUSE_CATEGORIES[0]);
  const mouseDownOnBackdrop = useRef(false);
  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/60 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}><div className="mobile-dialog mobile-sheet-content w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}><div className="mb-4 flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600"><AlertTriangle className="h-5 w-5" /></span><div><h2 className="text-lg font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p></div></div>{showCategory && <L label="Tipo de pausa"><select value={category} onChange={(e) => setCategory(e.target.value)} className="u-input">{PAUSE_CATEGORIES.map((cat) => <option key={cat}>{cat}</option>)}</select></L>}<L label="Motivo"><textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} className="u-input resize-none mt-2" /></L><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={!reason.trim()} onClick={() => onConfirm(showCategory ? { category, reason: reason.trim() } : reason.trim())} className={`rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40 ${confirmClass}`}>{confirmLabel}</button></div></div></div>;
}

/* ===================================== DICTADO POR VOZ ===================================== */
const MIC_ERROR_MESSAGES = { "not-allowed": "Permiso de micrófono denegado", "service-not-allowed": "Permiso de micrófono denegado", "no-speech": "No se detectó voz, intentá de nuevo", "audio-capture": "No se encontró un micrófono", "network": "Sin conexión para el dictado" };
function MicButton({ value, onChange, className = "" }) {
  const [status, setStatus] = useState("idle"); // idle | listening | error
  const [errorMsg, setErrorMsg] = useState("");
  const recognitionRef = useRef(null);
  const errorTimerRef = useRef(null);
  const Recognition = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  useEffect(() => () => { recognitionRef.current?.stop?.(); clearTimeout(errorTimerRef.current); }, []);
  if (!Recognition) return null;
  const showError = (msg) => {
    setStatus("error"); setErrorMsg(msg);
    clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setStatus((current) => (current === "error" ? "idle" : current)), 4000);
  };
  const toggle = () => {
    if (status === "listening") { recognitionRef.current?.stop?.(); return; }
    let recognition;
    try { recognition = new Recognition(); } catch { showError("El dictado no está disponible en este navegador"); return; }
    recognition.lang = "es-AR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setStatus("listening");
    recognition.onresult = (event) => {
      const text = Array.from(event.results).map((r) => r[0].transcript).join(" ").trim();
      if (text) onChange(value?.trim() ? `${value.trim()} ${text}` : text);
    };
    recognition.onend = () => setStatus((current) => (current === "listening" ? "idle" : current));
    recognition.onerror = (event) => showError(MIC_ERROR_MESSAGES[event.error] || "No se pudo escuchar, intentá de nuevo");
    recognitionRef.current = recognition;
    try { recognition.start(); } catch { showError("El micrófono ya está en uso"); }
  };
  return (
    <span className="relative shrink-0 self-start">
      <button type="button" onClick={toggle} title={status === "listening" ? "Detener dictado" : "Dictar por voz"} aria-label={status === "listening" ? "Detener dictado" : "Dictar por voz"}
        className={`relative grid h-11 w-11 place-items-center overflow-hidden rounded-lg border transition-colors ${status === "listening" ? "border-rose-600 bg-rose-500 text-white" : status === "error" ? "border-amber-300 bg-amber-50 text-amber-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"} ${className}`}>
        {status === "listening" && <span className="absolute inset-0 animate-ping rounded-lg bg-rose-400" />}
        <Mic className="relative h-4 w-4" />
      </button>
      {status === "listening" && <span className="absolute -bottom-5 right-0 z-10 flex items-center gap-1 whitespace-nowrap rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-medium text-white shadow"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Escuchando…</span>}
      {status === "error" && <span className="absolute -bottom-5 right-0 z-10 whitespace-nowrap rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">{errorMsg}</span>}
    </span>
  );
}

/* ===================================== ESCÁNER DE CÓDIGO (TAG DE ACTIVO) ===================================== */
function BarcodeScannerDialog({ onClose, onDetect }) {
  useDialogOpenClass();
  const videoRef = useRef(null);
  const [error, setError] = useState("");
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;
  useEffect(() => {
    if (!supported) { setError("Tu navegador no soporta el escaneo de códigos. Ingresá el dato manualmente."); return; }
    let stream = null, raf = null, stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        const detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "codabar"] });
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try { const codes = await detector.detect(videoRef.current); if (codes.length) { onDetect(codes[0].rawValue); return; } } catch {}
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch { setError("No se pudo acceder a la cámara. Revisá los permisos del navegador."); }
    })();
    return () => { stopped = true; if (raf) cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [supported]);
  const mouseDownOnBackdrop = useRef(false);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/70 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 p-4"><h2 className="text-lg font-semibold text-slate-900">Escanear código</h2><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="relative bg-black" style={{ aspectRatio: "3/4" }}>
          {!error && <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />}
          {!error && <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/70" />}
          {error && <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/90">{error}</div>}
        </div>
        <p className="p-4 text-xs text-slate-500">Apuntá al código QR o de barras del equipo. Se detecta automáticamente.</p>
      </div>
    </div>
  );
}

/* ===================================== ÓRDENES: NUEVA ===================================== */
function NewOrder({ ger, showInternal = ger, me, clients, users = [], parts = [], knownOrders = [], online = true, prefill = null, onSave, onCancel, onDeleted, toast }) {
  const fieldTechs = users.filter((u) => u.active && ["admin", "gerente", "tecnico"].includes(u.role));
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
  const [stepAttempted, setStepAttempted] = useState(false);
  useEffect(() => { setStepAttempted(false); }, [step]);
  const [clientMode, setClientMode] = useState(initial.clientMode || "existing");
  // Cliente principal: Corteva Seeds Argentina, planta Venado Tuerto. Se busca por coincidencia
  // en vez de nombre exacto porque el directorio puede tener el cliente cargado con variantes
  // del nombre (p. ej. "[VTU] Corteva Seeds Argentina").
  const defaultClient = clients.find((c) => /corteva/i.test(c.name || "") && clientSites(c).some((s) => /venado tuerto/i.test(s.name || "")))
    || clients.find((c) => /corteva/i.test(c.name || ""))
    || clients[0];
  const defaultClientId = defaultClient?.id || "";
  const defaultSite = clientSites(defaultClient).find((s) => /venado tuerto/i.test(s.name || "")) || clientSites(defaultClient)[0];
  const [clientId, setClientId] = useState(initial.clientId || defaultClientId);
  const [newClient, setNewClient] = useState(initial.newClient || { name: "", site: "" });
  const [contact, setContact] = useState(initial.contact || ""); const [tech, setTech] = useState(initial.tech || me.name);
  const [assignedTechs, setAssignedTechs] = useState(initial.assignedTechs || (me.role === "tecnico" ? [me.name] : []));
  const [assignedTechPick, setAssignedTechPick] = useState("");
  const addAssignedTech = (name) => { const value = (name || "").trim(); if (!value || assignedTechs.some((t) => t.toLowerCase() === value.toLowerCase())) return; setAssignedTechs((current) => [...current, value]); setAssignedTechPick(""); };
  const removeAssignedTech = (name) => setAssignedTechs((current) => current.filter((t) => t !== name));
  const [quoteNumber, setQuoteNumber] = useState(initial.quoteNumber || ""); const [customerPO, setCustomerPO] = useState(initial.customerPO || "");
  const [service, setService] = useState(initial.service || "Mantenimiento preventivo");
  const [recurrenceMonths, setRecurrenceMonths] = useState(initial.recurrenceMonths || 0);
  const [equipo, setEquipo] = useState(initial.equipo || ""); const [sintoma, setSintoma] = useState(initial.sintoma || ""); const [solucion, setSolucion] = useState(initial.solucion || ""); const [category, setCategory] = useState(initial.category || "");
  const [linkedBudgetId] = useState(initial.budgetId || ""); const [linkedBudgetNumber] = useState(initial.budgetNumber || initial.quoteNumber || ""); const [linkedProjectId] = useState(initial.projectId || "");
  const [technical, setTechnical] = useState(() => ({ ...EMPTY_TECHNICAL, ...(initial.technical || {}), reportedAt: initial.technical?.reportedAt || new Date().toISOString() }));
  const setTechnicalField = (field, value) => setTechnical((current) => ({ ...current, [field]: value }));
  const [scannerOpen, setScannerOpen] = useState(false);
  const assetHistory = useMemo(() => {
    const tag = (technical.assetTag || "").trim().toLowerCase();
    if (!tag) return [];
    return knownOrders.filter((o) => o.id !== currentOrderId && (o.technical?.assetTag || "").trim().toLowerCase() === tag).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
  }, [technical.assetTag, knownOrders, currentOrderId]);
  const [signerRoleChoice, setSignerRoleChoice] = useState(() => SIGNER_ROLES.includes(initial.technical?.signerRole) ? initial.technical.signerRole : (initial.technical?.signerRole ? "Otro" : ""));
  const [photos, setPhotos] = useState(initial.photos || []); const [analyzing, setAnalyzing] = useState(false);
  const [rate, setRate] = useState(normalizedRate(initial.rate)); const [laborHours, setLaborHours] = useState(initial.laborHours || ""); const [laborBillable, setLaborBillable] = useState(initial.laborBillable ?? true);
  // No sumar 1 + assignedTechs.length a secas: ese array ya incluye al responsable en todos los
  // demás lugares (así lo lee OrderDetail, y así se inicializa cuando un técnico crea su propia
  // orden), así que sumarle 1 aparte lo contaba dos veces y facturaba de más. Se cuentan personas
  // distintas entre "tech" y "assignedTechs", sea cual sea la convención con la que se cargaron.
  const technicians = Math.max(1, new Set([tech, ...assignedTechs].filter(Boolean).map((name) => name.trim().toLowerCase())).size);
  const [materials, setMaterials] = useState(initial.materials || []); const [location, setLocation] = useState(initial.location || null); const [geoMsg, setGeoMsg] = useState("");
  const [siteLabel, setSiteLabel] = useState(initial.siteLabel || initial.location?.label || "");
  const [siteCode, setSiteCode] = useState(initial.siteCode || (initial.clientId ? "" : defaultSite?.code || ""));
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
  const timelineAction = (action, pauseDetail) => {
    if (action === "finish") {
      const missing = [];
      if (!sintoma.trim()) missing.push({ step: 1, label: "el síntoma" });
      if (!technical.diagnosis?.trim()) missing.push({ step: 1, label: "el diagnóstico" });
      if (photos.length === 0) missing.push({ step: 1, label: "al menos una foto de evidencia" });
      if (!solucion.trim()) missing.push({ step: 2, label: "el procedimiento y solución aplicada" });
      if (missing.length) {
        toast?.(`Completá ${missing.map((m) => m.label).join(" y ")} antes de finalizar la intervención.`, "error");
        setStep(missing[0].step);
        return;
      }
    }
    const now = new Date().toISOString();
    const next = { ...technical, workSessions: [...(technical.workSessions || [])] };
    if (action === "arrival") next.arrivalAt = next.arrivalAt || now;
    if (action === "start" || action === "resume" || action === "reopen") {
      next.arrivalAt = next.arrivalAt || now; next.startedAt = next.startedAt || now; next.completedAt = "";
      if (!next.workSessions.some((session) => !session.end)) next.workSessions.push({ start: now, end: null });
    }
    if (action === "pause" || action === "finish") next.workSessions = next.workSessions.map((session) => !session.end ? { ...session, end: now, ...(action === "pause" ? { pauseReason: pauseDetail?.reason || "", pauseCategory: pauseDetail?.category || "Otro" } : {}) } : session);
    if (action === "finish") next.completedAt = now;
    setTechnical(next);
    if (action === "reopen") setStep(2);
    if (action === "finish") setStep(3);
    setTimelineNow(Date.now());
    if (["start", "resume", "reopen", "pause", "finish"].includes(action)) void save("En proceso de ejecución", { stayOpen: true, technicalOverride: next });
  };
  const addPhoto = async (file, cat) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      if (file.size > MAX_DOCUMENT_BYTES) { toast?.("El archivo supera los 5 MB permitidos.", "error"); return; }
      setAnalyzing(true);
      try { const url = await fileToDataUrl(file); setPhotos((p) => [...p, { url, name: file.name, mime: file.type, cat, ts: new Date().toISOString(), kind: "document" }]); }
      catch { toast?.("No se pudo adjuntar el archivo.", "error"); }
      finally { setAnalyzing(false); }
      return;
    }
    setAnalyzing(true);
    try { const { report, thumb } = await fileToImages(file); setPhotos((p) => [...p, { url: report, preview: thumb, cat, ts: new Date().toISOString(), kind: "image" }]); } finally { setAnalyzing(false); }
  };
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
  const clientConformityComplete = signatureUrl ? (!!signedBy.trim() && !!technical.signerRole?.trim()) : !!noSignReason.trim();
  const canComplete = canSave && chronologyErrors.length === 0 && !!technicianSignatureUrl && clientConformityComplete && !!technical.recommendations?.trim() && !!sintoma.trim() && !!technical.diagnosis?.trim() && photos.length > 0 && !!solucion.trim();
  const steps = ["Activo", profile.assess, profile.work, "Cierre"];
  const stepReady = step === 0 ? !!client?.name && !!siteLabel.trim() && !!(equipo || technical.assetTag) : step === 1 ? !!sintoma.trim() && !!technical.diagnosis?.trim() && photos.length > 0 : step === 2 ? !!solucion && !!technical.completedAt : canComplete;
  const stepMissing = step === 0
    ? [!client?.name && (clientMode === "existing" ? "cliente" : "nombre del cliente"), !siteLabel.trim() && "sitio de intervención", !(equipo || technical.assetTag) && "equipo intervenido"].filter(Boolean)
    : step === 1
    ? [!sintoma.trim() && "síntoma", !technical.diagnosis?.trim() && "diagnóstico", photos.length === 0 && "al menos una foto de evidencia"].filter(Boolean)
    : step === 2
    ? [!solucion && "procedimiento y solución aplicada", !technical.completedAt && "finalizar la intervención en la cronología"].filter(Boolean)
    : [];
  const errCls = (missing) => stepAttempted && missing ? "border-rose-400 ring-1 ring-rose-200" : "";
  useEffect(() => {
    const timer = setTimeout(() => { saveOrderDraft(me.id, { existingOrderId: currentOrderId, step, clientMode, clientId, newClient, siteLabel, siteCode, contact, tech, assignedTechs, quoteNumber, customerPO, service, equipo, sintoma, solucion, category, technical, rate, laborHours, technicians, laborBillable, materials, location, budgetId: linkedBudgetId, budgetNumber: linkedBudgetNumber, projectId: linkedProjectId }); setDraftSaved(true); }, 500);
    setDraftSaved(false); return () => clearTimeout(timer);
  }, [me.id, currentOrderId, step, clientMode, clientId, newClient, siteLabel, siteCode, contact, tech, assignedTechs, quoteNumber, customerPO, service, equipo, sintoma, solucion, category, technical, rate, laborHours, technicians, laborBillable, materials, location]);
  const save = async (status, { stayOpen = false, technicalOverride = technical } = {}) => {
    setSaving(true);
    const selectedPlant = clientMode === "existing" ? clientSites(client).find((s) => s.code === siteCode) : null;
    // Al editar una orden ya guardada, "siteLabel" se precarga con el sitio ya combinado
    // (planta + sector), no solo con el sector: sin deduplicar acá, cada edición volvía a anteponer
    // el nombre de la planta y el campo crecía indefinidamente ("Venado Tuerto · Venado Tuerto ·
    // ... · Deschalado"). Deduplicar por segmento además autocorrige órdenes que ya quedaron así.
    const siteSegments = [selectedPlant?.name, ...siteLabel.split(" · ").map((part) => part.trim())].filter(Boolean);
    const resolvedSite = [...new Set(siteSegments)].join(" · ") || client.site || "";
    const savedLocation = location ? { ...location, label: resolvedSite } : null;
    const completionStamp = new Date().toISOString();
    const timelineHours = technicalOverride.startedAt ? round2(timelineWorkMs(technicalOverride, Date.now()) / 3600000) : automaticLaborHours;
    const o = { client: client.name, site: resolvedSite, siteCode: siteCode.trim(), contact, tech, assignedTechs, quoteNumber: quoteNumber.trim(), customerPO: customerPO.trim(), budgetId: linkedBudgetId, budgetNumber: linkedBudgetNumber, projectId: linkedProjectId, service, recurrenceMonths: Number(recurrenceMonths) || 0, date: todayStr(), createdAt: completionStamp, equipo, sintoma, solucion, category, technical: { ...technicalOverride, signerCompany: client.name, downtimeMinutes: Number(technicalOverride.downtimeMinutes) || 0, billableWaitMinutes: Number(technicalOverride.billableWaitMinutes) || 0 }, location: savedLocation, photos, signatureUrl, signedAt: signatureUrl ? completionStamp : null, signedBy, noSignReason: signatureUrl ? "" : noSignReason.trim(), technicianSignatureUrl, technicianSignedAt: technicianSignatureUrl ? completionStamp : null, technicianSignedBy: tech || me.name, laborHours: timelineHours, billableHours: projectedBillableHours, technicians: Math.max(1, Math.round(Number(technicians) || 1)), rate: normalizedRate(rate), currency: "USD", laborBillable, materials: materials.map((m) => ({ ...m, qty: m.unit === "u" ? Math.max(1, Math.round(Number(m.qty) || 1)) : (Number(m.qty) || 0), price: wholeMoney(m.price), cost: wholeMoney(m.cost) })), status };
    if (clientMode === "new" && newClient.name) o._newClient = { id: "c" + Date.now(), name: newClient.name, site: resolvedSite, sites: resolvedSite ? [{ code: "", name: resolvedSite }] : [] };
    const saved = await onSave(o, currentOrderId, { stayOpen });
    if (saved?.id && !currentOrderId) setCurrentOrderId(saved.id);
    if (saved && !stayOpen) clearOrderDraft(me.id);
    setSaving(false);
    return saved;
  };
  const bottomBarRef = useRef(null);
  const [bottomBarHeight, setBottomBarHeight] = useState(0);
  useEffect(() => {
    const el = bottomBarRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setBottomBarHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  });
  return (
    <div className="min-h-screen bg-slate-100" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-ink-900 text-slate-100"><div className="mx-auto max-w-lg px-3 py-3 sm:px-4"><div className="flex items-center gap-3"><button onClick={onCancel} aria-label="Volver" className="grid h-10 w-10 place-items-center rounded-lg text-slate-300 hover:bg-ink-800"><ChevronLeft className="h-5 w-5" /></button><div className="min-w-0 flex-1 leading-tight"><div className="text-sm font-semibold">{currentOrderId ? `Continuar ${currentOrderId}` : "Nueva orden"} · {steps[step]}</div><div className="font-mono text-[11px] text-brand-400">{currentOrderId || folioPreview}</div></div><span className={`text-[11px] ${draftSaved ? "text-emerald-400" : "text-slate-400"}`}>{draftSaved ? "Guardado" : "Guardando…"}</span></div><div className="mt-3 grid grid-cols-4 gap-1">{steps.map((label, index) => <button key={label} onClick={() => index <= step && setStep(index)} className="text-left" aria-label={`Paso ${index + 1}: ${label}`}><span className={`block h-1.5 rounded-full ${index <= step ? "bg-brand-500" : "bg-slate-700"}`} /><span className={`mt-1 block truncate text-[9px] ${index === step ? "text-white" : "text-slate-500"}`}>{label}</span></button>)}</div></div></header>
      <main className="mx-auto max-w-lg space-y-4 px-3 py-4 pb-40 sm:px-4 sm:py-5 sm:pb-32" style={{ paddingBottom: bottomBarHeight ? bottomBarHeight + 16 : undefined }}>
        {step === 0 && <p className="text-[11px] text-slate-400">Los campos marcados con <span className="text-rose-500">*</span> son obligatorios para poder completar la orden.</p>}
        {currentOrderId && <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-700"><ClipboardList className="mt-0.5 h-4 w-4 shrink-0" /><span>Continuando la orden <b>{currentOrderId}</b>. Los cambios actualizarán el mismo registro.</span></div>}
        {prefill && !prefill.existingOrderId && <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700"><FileText className="mt-0.5 h-4 w-4 shrink-0" /><span>Orden vinculada al presupuesto <b>{linkedBudgetNumber}</b>. Cliente, sitio, servicio y OC fueron precargados.</span></div>}
        {!prefill && draft && <div className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-xs text-brand-700"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />Recuperamos el borrador guardado en {deviceLabel()}.</div>}
        {!canStartOrder && <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Completá cliente, sitio y equipo (paso Activo) antes de iniciar la cronología — si no, la orden no queda guardada en el servidor.</div>}
        <ServiceTimeline technical={technical} active={activeWork} elapsedMs={elapsedWorkMs} billableHours={projectedBillableHours} minimumApplied={minimumBillingApplied} showBilling={ger} technicians={technicians} errors={chronologyErrors} disabled={saving || !canStartOrder} onAction={timelineAction} onDowntime={(value) => setTechnicalField("downtimeMinutes", value)} onBillableWait={(value) => setTechnicalField("billableWaitMinutes", value)} onBillableWaitReason={(value) => setTechnicalField("billableWaitReason", value)} />
        <div key={step} className="motion-step space-y-4">
        {step === 0 && (<>
        <Section title="Cliente y sitio">
          <div className="mb-2 flex gap-2"><Toggle active={clientMode === "existing"} onClick={() => { setClientMode("existing"); const selected = clients.find((c) => c.id === clientId); const first = clientSites(selected)[0]; setSiteLabel(""); setSiteCode(first?.code || ""); setContact(selected?.contactName || ""); setLocation(null); }}>Directorio</Toggle><Toggle active={clientMode === "new"} onClick={() => { setClientMode("new"); setSiteLabel(newClient.site || ""); setSiteCode(""); setLocation(null); }}>Cliente nuevo</Toggle></div>
          {clientMode === "existing" ? (<select value={clientId} onChange={(e) => { const nextId = e.target.value; const selected = clients.find((c) => c.id === nextId); const first = clientSites(selected)[0]; setClientId(nextId); setSiteLabel(""); setSiteCode(first?.code || ""); setContact(selected?.contactName || ""); setLocation(null); }} className="u-input">{clients.map((c) => <option key={c.id} value={c.id}>{c.code ? `[${c.code}] ` : ""}{c.name}{clientSites(c).length ? ` — ${clientSites(c).map((s) => s.name).join(" / ")}` : ""}</option>)}</select>) : (<input value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} placeholder="Nombre del cliente" className={`u-input ${errCls(!newClient.name)}`} />)}
          {clientMode === "existing" && clientSites(clients.find((c) => c.id === clientId)).length > 1 && (
            <L label="Planta" help="Este cliente tiene varias plantas cargadas — elegí en cuál se realiza esta intervención."><select value={siteCode} onChange={(e) => { const chosen = clientSites(clients.find((c) => c.id === clientId)).find((s) => s.code === e.target.value); setSiteCode(chosen?.code || ""); setLocation((current) => current ? { ...current, label: chosen?.name || "" } : current); }} className="u-input mt-1">{clientSites(clients.find((c) => c.id === clientId)).map((s) => <option key={s.code || s.name} value={s.code}>{s.name}{s.code ? ` (${s.code})` : ""}</option>)}</select></L>
          )}
          <div className="mt-2"><ReqLabel>Sitio de intervención</ReqLabel></div>
          <input value={siteLabel} onChange={(e) => { const value = e.target.value; setSiteLabel(value); if (clientMode === "new") setNewClient((current) => ({ ...current, site: value })); setLocation((current) => current ? { ...current, label: value } : current); }} placeholder="Escribí el sector o la etapa del proceso" className={`u-input mt-1 ${errCls(!siteLabel.trim())}`} />
          <p className="mt-1 text-[11px] text-slate-400">Ej.: Deschalado, Secado, Desgranado, Clasificación, etc.</p>
          <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Persona de contacto (opcional)" className="u-input mt-2" />
          <input list="new-order-techs" value={tech} onChange={(e) => setTech(e.target.value)} placeholder="Técnico responsable" className="u-input mt-2" />
          <datalist id="new-order-techs">{fieldTechs.map((u) => <option key={u.id} value={u.name} />)}</datalist>
          {ger && !fieldTechs.some((u) => u.name === tech) && tech.trim() && <p className="mt-1 text-[11px] text-amber-600">“{tech}” no coincide con ningún técnico de campo activo — verificá el nombre para que la orden le aparezca.</p>}
          <div className="mt-2">
            <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-500">Técnicos acompañantes (opcional)<HelpHint text="Suma a otro técnico si más de una persona trabaja en esta orden. Todos los que agregues acá van a poder ver y editar esta OT desde su propia cuenta." /></span>
            {assignedTechs.length > 0 && <div className="mb-1.5 flex flex-wrap gap-1.5">{assignedTechs.map((name) => <Chip key={name} className="bg-slate-100 text-slate-700 ring-slate-300">{name}{name !== me.name && <button type="button" onClick={() => removeAssignedTech(name)} aria-label={`Quitar a ${name}`} className="ml-1 text-slate-400 hover:text-rose-500"><X className="h-3 w-3" /></button>}</Chip>)}</div>}
            <div className="flex gap-2">
              <input list="new-order-mate-techs" value={assignedTechPick} onChange={(e) => setAssignedTechPick(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAssignedTech(assignedTechPick); } }} placeholder="Buscar técnico para sumar" className="u-input flex-1" />
              <button type="button" onClick={() => addAssignedTech(assignedTechPick)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Agregar</button>
            </div>
            <datalist id="new-order-mate-techs">{fieldTechs.filter((u) => !assignedTechs.some((name) => name.toLowerCase() === u.name.toLowerCase())).map((u) => <option key={u.id} value={u.name} />)}</datalist>
          </div>
          {ger && <div className="mt-2 grid grid-cols-2 gap-2"><L label="N° de presupuesto"><input value={quoteNumber} onChange={(e) => setQuoteNumber(e.target.value)} placeholder="Opcional" className="u-input" /></L><L label="Orden de compra del cliente"><input value={customerPO} onChange={(e) => setCustomerPO(e.target.value)} placeholder="Opcional" className="u-input" /></L></div>}
          <div className="mt-2 flex flex-wrap items-center gap-2">{!location && <button onClick={captureLocation} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><MapPin className="h-3.5 w-3.5" /> Vincular GPS manualmente</button>}{location && <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">GPS vinculado a “{siteLabel || location.label || "Sitio de intervención"}”</span>}{geoMsg && <span className="text-xs text-slate-500">{geoMsg}</span>}</div>
          {!location && <p className="mt-1 text-[11px] text-slate-400">La ubicación se captura automáticamente al pulsar “Iniciar orden”. Si tu navegador bloqueó el permiso, usá el botón manual.</p>}
        </Section>
        <Section title="Tipo de servicio"><div className="flex flex-wrap gap-2">{SERVICE_TYPES.map((s) => (<button key={s} onClick={() => setService(s)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${service === s ? "border-brand-400 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600"}`}>{s}</button>))}</div>
          {service === "Mantenimiento preventivo" && <L label="Repetir cada (meses)" help="Al completar esta orden, se crea automáticamente el próximo borrador de mantenimiento preventivo para este cliente/planta con esa cantidad de meses de anticipación. Dejalo en 0 para no repetir." labelClass="mt-3"><input type="number" min="0" step="1" value={recurrenceMonths} onChange={(e) => setRecurrenceMonths(Math.max(0, Math.round(Number(e.target.value) || 0)))} placeholder="Ej. 3" className="u-input mt-1 w-32" /></L>}
        </Section>
        <Section title="Identificación del activo">
          <ReqLabel>Equipo / sistema intervenido</ReqLabel>
          <input value={equipo} onChange={(e) => setEquipo(e.target.value)} placeholder="Ej. Tablero principal, línea 2" className={`u-input mt-1 ${errCls(!(equipo || technical.assetTag))}`} />
          <L label="Categoría" help="Etiqueta corta y libre para agrupar el tipo de falla o intervención (ej. Sobrecalentamiento, Falla eléctrica, Programación)."><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ej. Sobrecalentamiento" className="u-input mt-1" /></L>
          <div className="mt-2 grid grid-cols-2 gap-2"><L label="TAG del activo"><div className="flex gap-1.5"><input value={technical.assetTag} onChange={(e) => setTechnicalField("assetTag", e.target.value)} placeholder="Ej. VFD-L2-03" className="u-input" /><button type="button" onClick={() => setScannerOpen(true)} title="Escanear código del equipo" aria-label="Escanear código del equipo" className="grid h-10 w-11 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ScanLine className="h-4 w-4" /></button></div></L><L label="Fabricante"><input value={technical.manufacturer} onChange={(e) => setTechnicalField("manufacturer", e.target.value)} className="u-input" /></L><L label="Modelo"><input value={technical.model} onChange={(e) => setTechnicalField("model", e.target.value)} className="u-input" /></L><L label="N° de serie"><input value={technical.serial} onChange={(e) => setTechnicalField("serial", e.target.value)} className="u-input" /></L></div>
          {assetHistory.length > 0 && (
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/50 p-3">
              <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-sky-800"><ClipboardList className="h-3.5 w-3.5" /> Historial de este activo ({assetHistory.length})</h4>
              <div className="space-y-1.5">
                {assetHistory.map((o) => (
                  <div key={o.id} className="rounded-md bg-white p-2 text-xs text-slate-600 ring-1 ring-sky-100">
                    <div className="flex items-center justify-between gap-2"><span className="font-mono font-medium text-slate-700">{o.id}</span><span className="text-slate-400">{o.date}</span></div>
                    {o.sintoma && <p className="mt-0.5 truncate"><b>Síntoma:</b> {o.sintoma}</p>}
                    {o.solucion && <p className="mt-0.5 truncate"><b>Solución:</b> {o.solucion}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
        </>)}
        {step === 1 && (
        <Section title="Documentación del trabajo">
          <ReqLabel>Fotos de evidencia (mínimo 1)</ReqLabel>
          <div className={`grid grid-cols-3 gap-2 rounded-lg ${errCls(photos.length === 0)}`}><PhotoBtn icon={Camera} label="Antes" cat="antes" onPick={addPhoto} /><PhotoBtn icon={Camera} label="Durante" cat="durante" onPick={addPhoto} /><PhotoBtn icon={Camera} label="Después" cat="después" onPick={addPhoto} /></div>
          <p className="mt-1 text-[11px] text-slate-400">Foto, PDF, Excel o CSV · máx. 5 MB por archivo</p>
          {analyzing && <div className="mt-2 flex items-center gap-2 text-xs text-brand-700"><Loader2 className="h-4 w-4 animate-spin" /> Procesando archivo…</div>}
          {photos.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{photos.map((p, i) => (<div key={i} className="relative">{p.kind === "document" ? <div title={p.name} className="grid h-14 w-14 place-items-center rounded-lg bg-slate-100 ring-1 ring-slate-200"><FileText className="h-6 w-6 text-slate-500" /></div> : <img src={p.preview || p.url} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-slate-200" />}<span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 text-center text-[9px] text-white">{p.cat}</span><button onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 shadow ring-1 ring-slate-200"><X className="h-3 w-3 text-slate-500" /></button></div>))}</div>}
          {category && <div className="mt-2"><Chip className="bg-brand-50 text-brand-700 ring-brand-600/20"><Sparkles className="h-3 w-3" />{category}</Chip></div>}
          <ReqLabel>Síntoma</ReqLabel>
          <div className="mt-1 flex gap-1.5"><input value={sintoma} onChange={(e) => setSintoma(e.target.value)} placeholder={profile.symptom} className={`u-input ${errCls(!sintoma.trim())}`} /><MicButton value={sintoma} onChange={setSintoma} /></div>
          <div className="mt-3"><ReqLabel>Diagnóstico</ReqLabel></div>
          <div className="mt-1 flex gap-1.5"><textarea value={technical.diagnosis} onChange={(e) => setTechnicalField("diagnosis", e.target.value)} rows={3} placeholder={profile.diagnosis} className={`u-input resize-none ${errCls(!technical.diagnosis?.trim())}`} /><MicButton value={technical.diagnosis} onChange={(text) => setTechnicalField("diagnosis", text)} /></div>
          {profile.rootCause && <textarea value={technical.rootCause} onChange={(e) => setTechnicalField("rootCause", e.target.value)} rows={2} placeholder="Causa raíz probable o confirmada" className="u-input mt-2 resize-none" />}
          {profile.installation && <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/50 p-3"><h4 className="text-xs font-semibold text-sky-800">Preparación de la instalación</h4><textarea value={technical.installationScope} onChange={(e) => setTechnicalField("installationScope", e.target.value)} rows={2} placeholder="Alcance, puntos de conexión y entregables" className="u-input mt-2 resize-none bg-white" /><textarea value={technical.requiredDocuments} onChange={(e) => setTechnicalField("requiredDocuments", e.target.value)} rows={2} placeholder="Planos, permisos y documentación disponible" className="u-input mt-2 resize-none bg-white" /></div>}
          {profile.preventive && <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/50 p-3"><h4 className="text-xs font-semibold text-sky-800">Inspección preventiva</h4><textarea value={technical.preventiveChecklist} onChange={(e) => setTechnicalField("preventiveChecklist", e.target.value)} rows={3} placeholder="Ítems inspeccionados y estado inicial" className="u-input mt-2 resize-none bg-white" /><textarea value={technical.wearFindings} onChange={(e) => setTechnicalField("wearFindings", e.target.value)} rows={2} placeholder="Desgaste, anomalías o riesgo de falla" className="u-input mt-2 resize-none bg-white" /></div>}
          {profile.warranty && <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-violet-200 bg-violet-50/50 p-3 sm:grid-cols-2"><L label="Referencia de garantía"><input value={technical.warrantyReference} onChange={(e) => setTechnicalField("warrantyReference", e.target.value)} className="u-input bg-white" /></L><L label="Validación"><select value={technical.warrantyDecision} onChange={(e) => setTechnicalField("warrantyDecision", e.target.value)} className="u-input bg-white"><option value="">Pendiente</option><option>Cubierto</option><option>No cubierto</option><option>Requiere autorización</option></select></L></div>}
          {profile.emergency && <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-rose-200 bg-rose-50/50 p-3 sm:grid-cols-2"><L label="Criticidad"><select value={technical.emergencyPriority} onChange={(e) => setTechnicalField("emergencyPriority", e.target.value)} className="u-input bg-white"><option value="">Seleccionar</option><option>Media</option><option>Alta</option><option>Crítica</option></select></L><L label="Impacto productivo"><input value={technical.productionImpact} onChange={(e) => setTechnicalField("productionImpact", e.target.value)} placeholder="Línea detenida, producción parcial…" className="u-input bg-white" /></L></div>}
        </Section>
        )}
        {step === 2 && (<>
        <Section title="Intervención realizada">
          <ReqLabel>Procedimiento, trabajo realizado y solución aplicada</ReqLabel>
          <div className="mt-1 flex gap-1.5"><textarea value={solucion} onChange={(e) => setSolucion(e.target.value)} rows={4} placeholder="Describe el trabajo realizado y la solución aplicada" className={`u-input resize-none ${errCls(!solucion)}`} /><MicButton value={solucion} onChange={setSolucion} /></div>
          {profile.automation && <><div className="mt-3 grid grid-cols-2 gap-2"><L label="Dispositivo"><input value={technical.deviceType} onChange={(e) => setTechnicalField("deviceType", e.target.value)} placeholder="PLC, HMI, VFD…" className="u-input" /></L><L label="Firmware"><input value={technical.firmware} onChange={(e) => setTechnicalField("firmware", e.target.value)} className="u-input" /></L><L label="Versión de programa"><input value={technical.programVersion} onChange={(e) => setTechnicalField("programVersion", e.target.value)} className="u-input" /></L><L label="Referencia de respaldo"><input value={technical.backupRef} onChange={(e) => setTechnicalField("backupRef", e.target.value)} className="u-input" /></L></div><textarea value={technical.ioVerified} onChange={(e) => setTechnicalField("ioVerified", e.target.value)} rows={2} placeholder="Entradas, salidas y señales verificadas" className="u-input mt-2 resize-none" /><textarea value={technical.alarmsVerified} onChange={(e) => setTechnicalField("alarmsVerified", e.target.value)} rows={2} placeholder="Alarmas e interlocks verificados" className="u-input mt-2 resize-none" /><textarea value={technical.setpointChanges} onChange={(e) => setTechnicalField("setpointChanges", e.target.value)} rows={2} placeholder="Setpoints o parámetros modificados: valor anterior → valor nuevo" className="u-input mt-2 resize-none" /></>}
          {profile.installation && <><textarea value={technical.mountingWiring} onChange={(e) => setTechnicalField("mountingWiring", e.target.value)} rows={2} placeholder="Montaje, conexionado y verificaciones eléctricas" className="u-input mt-2 resize-none" /><textarea value={technical.commissioning} onChange={(e) => setTechnicalField("commissioning", e.target.value)} rows={2} placeholder="Puesta en marcha y criterios de aceptación" className="u-input mt-2 resize-none" /><input value={technical.trainingProvided} onChange={(e) => setTechnicalField("trainingProvided", e.target.value)} placeholder="Capacitación entregada y asistentes" className="u-input mt-2" /></>}
          {profile.preventive && <textarea value={technical.cleaningAdjustments} onChange={(e) => setTechnicalField("cleaningAdjustments", e.target.value)} rows={3} placeholder="Limpieza, lubricación, ajustes y elementos reemplazados" className="u-input mt-2 resize-none" />}
          {profile.emergency && <textarea value={technical.temporaryRestoration} onChange={(e) => setTechnicalField("temporaryRestoration", e.target.value)} rows={2} placeholder="Restablecimiento temporal aplicado y limitaciones" className="u-input mt-2 resize-none" />}
        </Section>
        <Section title="Mano de obra">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Las horas se calculan desde la cronología del servicio. No es necesario operar un cronómetro separado.</p>
          <div className={`mt-2 grid gap-2 ${ger ? "grid-cols-2 min-[430px]:grid-cols-4" : "grid-cols-2"}`}><L label="Tiempo efectivo" labelClass="whitespace-nowrap" help="Tiempo real de intervención, descontando las pausas registradas en la cronología."><div className="u-input flex items-center bg-slate-50 font-medium text-slate-700">{compactDuration(elapsedWorkMs)}</div></L>{ger && <L label="Horas facturables" labelClass="whitespace-nowrap" help="Horas cobradas por técnico. Si la permanencia es menor a una hora, se aplica el mínimo comercial de dos horas."><div className="u-input flex items-center bg-brand-50 font-semibold text-brand-700">{projectedBillableHours} h</div></L>}<L label="Técnicos" labelClass="whitespace-nowrap" help="Técnicos en planta. Se calcula automáticamente: técnico responsable + técnicos acompañantes agregados en el paso Activo."><div className="u-input flex items-center bg-slate-50 font-medium text-slate-700">{technicians}</div></L>{ger && <L label="Tarifa/h por técnico" labelClass="whitespace-nowrap" help="Tarifa comercial aplicada a cada hora facturable de cada técnico en planta (USD)."><input type="number" min="0" step="1" value={rate} onChange={(e) => setRate(e.target.value)} onBlur={(e) => setRate(normalizedRate(e.target.value))} className="u-input" /></L>}</div>
          {ger && minimumBillingApplied && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">Mínimo aplicado: {compactDuration(onSiteElapsedMs)} de permanencia en sitio desde la llegada (menos de 1 hora) → se facturan 2 horas por técnico. El "Tiempo efectivo" de arriba solo cuenta el trabajo activo, sin las pausas.</p>}
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
        <Section title="Recomendaciones y pendientes"><ReqLabel>Recomendación técnica</ReqLabel><div className="mt-1 flex gap-1.5"><textarea value={technical.recommendations} onChange={(e) => setTechnicalField("recommendations", e.target.value)} rows={3} placeholder="Recomendación técnica concreta para el cliente" className={`u-input resize-none ${errCls(!technical.recommendations?.trim())}`} /><MicButton value={technical.recommendations} onChange={(text) => setTechnicalField("recommendations", text)} /></div><textarea value={technical.pendingActions} onChange={(e) => setTechnicalField("pendingActions", e.target.value)} rows={2} placeholder="Acción pendiente, responsable y fecha comprometida" className="u-input mt-2 resize-none" /><p className="mt-1 text-[11px] text-slate-400">Describe la acción; la prioridad se gestiona únicamente en la información interna.</p><L label={profile.preventive ? "Próximo mantenimiento sugerido" : "Fecha sugerida de seguimiento"}><input type="date" min={todayStr()} value={technical.followUpDate} onChange={(e) => setTechnicalField("followUpDate", e.target.value)} onBlur={(e) => { if (e.target.value && e.target.value < todayStr()) setTechnicalField("followUpDate", ""); }} className="u-input" /></L></Section>
        {ger && profile.warranty && <Section title="Gestión de garantía"><L label="Cobertura y vigencia"><input value={technical.warranty} onChange={(e) => setTechnicalField("warranty", e.target.value)} placeholder="Alcance de cobertura, fecha de vencimiento o exclusiones" className="u-input" /></L></Section>}
        {showInternal && <Section title="Información interna"><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><L label="Recurrencia"><select value={technical.recurrence} onChange={(e) => setTechnicalField("recurrence", e.target.value)} className="u-input"><option value="">Seleccionar</option><option>Primera intervención</option><option>Recurrente</option><option>Seguimiento programado</option></select></L><L label="Próxima acción interna"><select value={technical.internalDisposition} onChange={(e) => setTechnicalField("internalDisposition", e.target.value)} className="u-input"><option value="">Sin acción definida</option><option>Seguimiento técnico</option><option>Cotizar mejora o repuesto</option><option>Esperar repuesto</option><option>Escalar a ingeniería</option><option>Cerrar sin seguimiento</option></select></L><L label="Responsable interno"><input value={technical.internalOwner} onChange={(e) => setTechnicalField("internalOwner", e.target.value)} placeholder="Persona responsable del seguimiento" className="u-input" /></L></div><textarea value={technical.internalNotes} onChange={(e) => setTechnicalField("internalNotes", e.target.value)} rows={3} placeholder="Notas privadas, riesgos comerciales o próximos pasos internos" className="u-input mt-2 resize-none" /></Section>}
        <Section title="Firma del técnico responsable"><p className="mb-2 text-xs text-slate-500">Confirma la ejecución y la información técnica registrada en esta orden.</p><SignaturePad onChange={setTechnicianSignatureUrl} /><div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Técnico: <b>{tech || me.name}</b></div></Section>
        <Section title="Conformidad del cliente"><SignaturePad onChange={setSignatureUrl} /><input value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Nombre de quien firma" className="u-input mt-2" /><div className="mt-2 grid grid-cols-2 gap-2"><L label="Cargo / área"><select value={signerRoleChoice} onChange={(e) => { const value = e.target.value; setSignerRoleChoice(value); setTechnicalField("signerRole", value === "Otro" ? "" : value); }} className="u-input"><option value="">Seleccionar</option>{SIGNER_ROLES.map((role) => <option key={role}>{role}</option>)}<option>Otro</option></select></L><div><span className="mb-1 block text-[11px] font-medium text-slate-500">Empresa</span><div className="u-input flex items-center bg-slate-50 text-slate-700" title="Se toma automáticamente del cliente seleccionado">{client?.name || "—"}</div></div></div>{signerRoleChoice === "Otro" && <L label="Especificar cargo / área"><input autoFocus value={technical.signerRole} onChange={(e) => setTechnicalField("signerRole", e.target.value)} placeholder="Escribe el cargo o área" className="u-input mt-2" /></L>}{!signatureUrl && (<div className="mt-2"><p className="mb-1 text-[11px] text-amber-600">Se recomienda la firma del cliente. Si no es posible, indica el motivo para poder completar igual:</p><input value={noSignReason} onChange={(e) => setNoSignReason(e.target.value)} placeholder="Motivo (ej. cliente ausente)" className="u-input" /></div>)}</Section>
        <Box className="p-4"><h3 className="mb-3 text-sm font-semibold text-slate-900">Resumen antes de enviar</h3><div className="space-y-1.5 text-sm text-slate-600"><div className="flex justify-between gap-3"><span>Cliente</span><span className="text-right font-medium text-slate-800">{client?.name || "—"}</span></div><div className="flex justify-between gap-3"><span>Servicio</span><span className="text-right font-medium text-slate-800">{service}</span></div><div className="flex justify-between gap-3"><span>Tiempo efectivo</span><span className="font-medium text-slate-800">{compactDuration(elapsedWorkMs)}</span></div>{ger && <div className="flex justify-between gap-3"><span>Horas facturables</span><span className="font-medium text-slate-800">{projectedBillableHours} h × {technicians || 1} técnico(s) = {round2(projectedBillableHours * (Number(technicians) || 1))} h-técnico</span></div>}<div className="flex justify-between gap-3"><span>Materiales</span><span className="font-medium text-slate-800">{materials.length}</span></div>{ger && <><div className="flex justify-between gap-3 border-t border-slate-100 pt-2"><span>Mano de obra</span><span>{money(preview.labor)}</span></div><div className="flex justify-between gap-3"><span>Materiales</span><span>{money(preview.mats)}</span></div><div className="flex justify-between gap-3 font-semibold text-slate-900"><span>Total</span><span>{money(preview.total)}</span></div></>}</div></Box>
        </>)}
        </div>
      </main>
      <div ref={bottomBarRef} className="mobile-bottom-bar fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur sm:px-4"><div className="mx-auto max-w-lg">{stepAttempted && stepMissing.length > 0 && <div className="mb-2 flex items-start gap-1.5 text-[11px] font-medium text-rose-600"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Completa antes de continuar: {stepMissing.join(", ")}.</div>}{step === 3 && chronologyErrors.length > 0 && <div className="mb-2 flex items-start gap-1.5 text-[11px] text-rose-600"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Corrige la cronología antes de completar la orden.</div>}{step === 3 && canSave && !technicianSignatureUrl && <div className="mb-2 flex items-start gap-1.5 text-[11px] font-medium text-rose-600"><FileSignature className="mt-0.5 h-3.5 w-3.5 shrink-0" /> La firma del técnico es obligatoria para completar.</div>}{step === 3 && canSave && !signatureUrl && !noSignReason.trim() && <div className="mb-2 flex items-start gap-1.5 text-[11px] text-amber-600"><FileSignature className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Para la conformidad del cliente, capta la firma o indica un motivo.</div>}{step === 3 && canSave && !!signatureUrl && (!signedBy.trim() || !technical.signerRole?.trim()) && <div className="mb-2 flex items-start gap-1.5 text-[11px] font-medium text-rose-600"><FileSignature className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Completá el nombre y el cargo/área de quien firma para poder completar la orden.</div>}{step === 3 && canSave && !technical.recommendations?.trim() && <div className="mb-2 flex items-start gap-1.5 text-[11px] font-medium text-rose-600"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> La recomendación técnica es obligatoria para completar la orden.</div>}{step === 3 && canSave && (!sintoma.trim() || !technical.diagnosis?.trim() || photos.length === 0 || !solucion.trim()) && <div className="mb-2 flex items-start gap-1.5 text-[11px] font-medium text-rose-600"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Falta completar en pasos anteriores: {[!sintoma.trim() && "síntoma", !technical.diagnosis?.trim() && "diagnóstico", photos.length === 0 && "foto de evidencia", !solucion.trim() && "solución aplicada"].filter(Boolean).join(", ")}.</div>}<div className="grid grid-cols-[auto_1fr_auto] gap-2">{step > 0 ? <button onClick={() => setStep((value) => value - 1)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Atrás</button> : <button disabled={saving || !canStartOrder} onClick={() => { if (!location) captureLocation(); save("En proceso de ejecución"); }} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 disabled:opacity-50">Iniciar orden</button>}<div />{step < steps.length - 1 ? <button onClick={() => { if (!stepReady) { setStepAttempted(true); return; } setStep((value) => value + 1); }} className={`inline-flex items-center gap-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white ${stepReady ? "bg-brand-500" : "bg-slate-300"}`}>Continuar <ChevronRight className="h-4 w-4" /></button> : <button onClick={() => { if (!canComplete) { setStepAttempted(true); return; } save("Completada"); }} disabled={saving} className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${canComplete ? "bg-brand-500" : "bg-slate-300"}`}>{saving && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />} Completar orden</button>}</div></div></div>
      {scannerOpen && <BarcodeScannerDialog onClose={() => setScannerOpen(false)} onDetect={(value) => { setTechnicalField("assetTag", value); setScannerOpen(false); }} />}
    </div>
  );
}
const Section = ({ title, children }) => <div className="motion-card rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>{children}</div>;
function ServiceTimeline({ technical, active, elapsedMs, billableHours, minimumApplied, showBilling = false, technicians, errors = [], disabled = false, onAction, onDowntime, onBillableWait, onBillableWaitReason }) {
  const stamp = (value) => value ? new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "Pendiente";
  const responseMs = technical.arrivalAt && technical.reportedAt ? new Date(technical.arrivalAt) - new Date(technical.reportedAt) : 0;
  const onSiteMs = technical.completedAt && technical.arrivalAt ? new Date(technical.completedAt) - new Date(technical.arrivalAt) : 0;
  const [pausePromptOpen, setPausePromptOpen] = useState(false);
  const [pauseCategory, setPauseCategory] = useState(PAUSE_CATEGORIES[0]);
  const [pauseReason, setPauseReason] = useState("");
  const confirmPause = () => { if (!pauseReason.trim()) return; onAction("pause", { category: pauseCategory, reason: pauseReason.trim() }); setPausePromptOpen(false); setPauseReason(""); setPauseCategory(PAUSE_CATEGORIES[0]); };
  const pastPauses = (technical.workSessions || []).filter((session) => session.pauseReason);
  const pauseDurationMs = (session) => { const start = new Date(session.start).getTime(); const end = new Date(session.end).getTime(); return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0; };
  return <section className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900">Cronología del servicio</h3><p className="mt-0.5 text-[11px] text-slate-500">Registra cada hito; los tiempos y horas se calculan automáticamente.</p></div>{active && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> En curso</span>}</div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{[["Aviso", technical.reportedAt], ["Llegada", technical.arrivalAt], ["Inicio", technical.startedAt], ["Fin", technical.completedAt]].map(([label, value]) => <div key={label} className={`rounded-lg border px-2.5 py-2 ${value ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50"}`}><div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div><div className={`mt-0.5 font-semibold ${value ? "text-slate-700" : "text-slate-400"}`}>{stamp(value)}</div></div>)}</div>
    <div className="mt-3 flex flex-wrap gap-2">
      {!technical.arrivalAt && <button disabled={disabled} onClick={() => onAction("arrival")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><MapPin className="h-4 w-4" /> Registrar llegada</button>}
      {technical.arrivalAt && !technical.startedAt && <button disabled={disabled} onClick={() => onAction("start")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" /> Iniciar intervención</button>}
      {active && !pausePromptOpen && <button disabled={disabled} onClick={() => setPausePromptOpen(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 disabled:opacity-50"><Square className="h-3.5 w-3.5" /> Pausar</button>}
      {technical.startedAt && !active && !technical.completedAt && <button disabled={disabled} onClick={() => onAction("resume")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" /> Reanudar</button>}
      {technical.startedAt && !technical.completedAt && <button disabled={disabled} onClick={() => onAction("finish")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Finalizar intervención</button>}
      {technical.completedAt && <button disabled={disabled} onClick={() => onAction("reopen")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700 disabled:opacity-50"><RefreshCw className="h-4 w-4" /> Reabrir intervención</button>}
    </div>
    {active && pausePromptOpen && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3"><label className="mb-1 block text-[11px] font-medium text-amber-800">Tipo de pausa <span className="text-rose-500">*</span></label><select autoFocus value={pauseCategory} onChange={(event) => setPauseCategory(event.target.value)} className="u-input bg-white">{PAUSE_CATEGORIES.map((cat) => <option key={cat}>{cat}</option>)}</select><label className="mb-1 mt-2 block text-[11px] font-medium text-amber-800">Detalle <span className="text-rose-500">*</span></label><input value={pauseReason} onChange={(event) => setPauseReason(event.target.value)} placeholder="Ej. corte de energía, espera de repuesto, almuerzo…" className="u-input" onKeyDown={(event) => { if (event.key === "Enter") confirmPause(); }} /><p className="mt-1 text-[10px] text-amber-700">Queda registrado en la cronología para el análisis posterior de la tarea.</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => { setPausePromptOpen(false); setPauseReason(""); setPauseCategory(PAUSE_CATEGORIES[0]); }} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">Cancelar</button><button type="button" disabled={!pauseReason.trim()} onClick={confirmPause} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Confirmar pausa</button></div></div>}
    {technical.completedAt && <p className="mt-2 text-[11px] text-slate-500">Si la orden todavía está en ejecución, reabrí la intervención para continuar registrando tiempo y volver a finalizarla.</p>}
    {pastPauses.length > 0 && <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Historial de pausas</p>{pastPauses.map((session, index) => <p key={index} className="text-[11px] text-slate-600"><span className="font-medium text-slate-700">{stamp(session.end)}</span> — <Chip className="bg-amber-50 text-amber-700 ring-amber-600/20">{session.pauseCategory || "Otro"}</Chip> {session.pauseReason} · <span className="text-slate-400">{compactDuration(pauseDurationMs(session))}</span></p>)}</div>}
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs"><span className="flex items-center gap-1 text-[10px] text-slate-400">Tiempo efectivo <HelpHint text="Tiempo real trabajado entre inicio y finalización, descontando pausas." /></span><b className="text-slate-700">{compactDuration(elapsedMs)}</b></div>{showBilling && <div className={`rounded-lg px-2.5 py-2 text-xs ${minimumApplied ? "bg-amber-50" : "bg-brand-50"}`}><span className="flex items-center gap-1 text-[10px] text-slate-400">Horas facturables <HelpHint text="Horas comerciales cobradas por técnico; puede aplicar un mínimo de dos horas cuando la visita es menor a una hora." /></span><b className={minimumApplied ? "text-amber-700" : "text-brand-700"}>{billableHours} h{minimumApplied ? " · mínimo" : ""}</b></div>}{responseMs > 0 && <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs"><span className="flex items-center gap-1 text-[10px] text-slate-400">Respuesta <HelpHint text="Tiempo transcurrido desde el aviso recibido hasta la llegada al sitio." /></span><b className="text-slate-700">{compactDuration(responseMs)}</b></div>}{onSiteMs > 0 && <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs"><span className="flex items-center gap-1 text-[10px] text-slate-400">Total en planta <HelpHint text="Permanencia total desde la llegada al sitio hasta la finalización, incluyendo esperas y pausas." /></span><b className="text-slate-700">{compactDuration(onSiteMs)}</b></div>}</div>
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"><label className="flex h-full flex-col"><span className="mb-1 flex min-h-8 items-end gap-1 text-[11px] font-medium leading-tight text-slate-500">Espera por condiciones del sitio (minutos) <HelpHint text="Tiempo en planta sin poder intervenir por autorización, acceso, disponibilidad del equipo u otra condición atribuible al sitio. Puede incorporarse a la facturación." /></span><input type="number" min="0" step="1" value={technical.billableWaitMinutes ?? ""} onChange={(event) => onBillableWait(event.target.value)} onBlur={(event) => onBillableWait(Math.max(0, Math.round(Number(event.target.value) || 0)))} className="u-input" /></label><label className="flex h-full flex-col"><span className="mb-1 flex min-h-8 items-end gap-1 text-[11px] font-medium leading-tight text-slate-500">Parada productiva informada (minutos, independiente de la visita) <HelpHint text="Duración informada de la afectación productiva del cliente. Es un dato técnico de impacto y no aumenta automáticamente las horas del servicio." /></span><input type="number" min="0" step="1" value={technical.downtimeMinutes ?? ""} onChange={(event) => onDowntime(event.target.value)} onBlur={(event) => onDowntime(Math.max(0, Math.round(Number(event.target.value) || 0)))} className="u-input" /></label></div>
    {(Number(technical.billableWaitMinutes) || 0) > 0 && <L label="Motivo de la espera"><input value={technical.billableWaitReason || ""} onChange={(event) => onBillableWaitReason(event.target.value)} placeholder="Ej. espera de autorización, acceso o disponibilidad del equipo" className="u-input mt-2" /></L>}
    {errors.length > 0 && <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{errors.map((error) => <p key={error}>• {error}</p>)}</div>}
  </section>;
}
const Toggle = ({ active, onClick, children }) => <button onClick={onClick} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${active ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600"}`}>{children}</button>;
function PhotoBtn({ icon: Icon, label, cat, onPick }) {
  return (<label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white py-3 text-[11px] font-medium text-slate-600 transition hover:border-brand-400 hover:text-brand-600"><Icon className="h-4 w-4" /> {label}<input type="file" accept={EVIDENCE_ACCEPT} capture="environment" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; onPick(f, cat); }} /></label>);
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

function TaskColumn({ status, tasks, projects = [], userById, onOpen, onMove, onMoveToStatus, roomy = false, readOnly = false, tvMode = false }) {
  const col = tasks.filter((task) => task.status === status);
  const meta = T_STYLE[status];
  const limit = WIP_LIMITS[status];
  const over = limit && col.length > limit;
  const draggable = !readOnly && !!onMoveToStatus;
  // Arrastrar y soltar es una mejora sobre las flechas, no un reemplazo: en touch (celular/tablet)
  // los eventos nativos de drag no disparan, así que ahí las flechas siguen siendo el único modo.
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = (event) => {
    event.preventDefault();
    setDragOver(false);
    const id = event.dataTransfer.getData("text/plain");
    if (id) onMoveToStatus(id, status);
  };
  return <section
    className={`tv-task-column rounded-xl border-t-4 ${meta.col} bg-slate-50/60 ${roomy ? "min-h-[18rem]" : ""} ${dragOver ? "ring-2 ring-inset ring-brand-400 bg-brand-50/40" : ""}`}
    onDragOver={draggable ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } : undefined}
    onDragEnter={draggable ? () => setDragOver(true) : undefined}
    onDragLeave={draggable ? (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false); } : undefined}
    onDrop={draggable ? handleDrop : undefined}>
    <div className="flex items-center justify-between px-3 py-2"><h3 className="text-sm font-semibold text-slate-700">{status}</h3><span className={`rounded-full px-2 text-xs font-medium ring-1 ${over ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-white text-slate-500 ring-slate-200"}`}>{col.length}{limit ? `/${limit}` : ""}</span></div>
    {over && <div className="mx-2 mb-1 rounded-md bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-700">Límite de trabajo en curso superado</div>}
    <div className={`tv-column-list space-y-2 px-2 pb-3 ${tvMode ? "overflow-y-auto" : ""}`}>
      {col.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-xs text-slate-400">Sin tareas en esta etapa</div>}
      {col.map((task) => { const index = T_STATUS.indexOf(task.status); const age = daysSince(task._updatedAt); const project = projects.find((item) => item.id === task.project); const color = project?.color || task.color || "#94a3b8"; return <article key={task.id} draggable={draggable} onDragStart={draggable ? (event) => { event.dataTransfer.setData("text/plain", task.id); event.dataTransfer.effectAllowed = "move"; } : undefined} className={`tv-task-card rounded-lg border border-l-4 border-slate-200 bg-white p-3 shadow-sm ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`} style={{ borderLeftColor: color }}>
        <button onClick={() => onOpen(task)} className="block w-full text-left"><div className="flex flex-wrap items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-label={`Color del proyecto ${project?.name || "sin identificar"}`} /><Chip className={`${typeMeta[task.type]} ring-1 ring-inset ring-black/5`}>{task.type}</Chip>{isOverdue(task) && <Chip className="bg-rose-50 text-rose-700 ring-rose-600/20"><AlertTriangle className="h-3 w-3" />Vencida</Chip>}{isDueSoon(task) && <Chip className="bg-amber-50 text-amber-700 ring-amber-600/20"><Clock className="h-3 w-3" />Vence pronto</Chip>}{isStale(task) && <Chip className="bg-amber-50 text-amber-700 ring-amber-600/20"><Clock className="h-3 w-3" />Estancada</Chip>}</div><h4 className="mt-1.5 text-sm font-semibold leading-snug text-slate-900">{task.title}</h4><div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400"><span className="font-mono">{task.id}</span>{task.due && <span className="inline-flex items-center gap-0.5"><Calendar className="h-3 w-3" />{dueLabel(task.due)}</span>}{task.status !== "Hecho" && task._updatedAt && <span className="inline-flex items-center gap-0.5"><Clock className="h-3 w-3" />{age === 0 ? "Actualizada hoy" : `Hace ${age}d`}</span>}</div></button>
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3"><div className="flex min-w-0 items-center gap-1.5"><Avatar user={userById(task.assignee)} size={24} /><Chip className={`${prioMeta[task.priority]} ring-1 ring-inset ring-black/5`}><Flag className="h-3 w-3" />{task.priority}</Chip></div>{!readOnly && <div className="flex gap-1"><button onClick={() => onMove(task.id, -1)} disabled={index === 0} aria-label={`Mover ${task.title} hacia atrás`} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><button onClick={() => onMove(task.id, 1)} disabled={index === T_STATUS.length - 1} aria-label={`Avanzar ${task.title}`} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div>}</div>
      </article>; })}
    </div>
  </section>;
}

function Board({ tasks, projects = [], userById, onOpen, onMove, onMoveToStatus, readOnly = false, tvMode = false }) {
  return <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 ${tvMode ? "tv-board" : ""}`}>{T_STATUS.map((status) => <TaskColumn key={status} status={status} tasks={tasks} projects={projects} userById={userById} onOpen={onOpen} onMove={onMove} onMoveToStatus={onMoveToStatus} readOnly={readOnly} tvMode={tvMode} />)}</div>;
}

function TechnicianBoard({ tasks, projects = [], userById, onOpen, onMove, onMoveToStatus }) {
  const [mobileStatus, setMobileStatus] = useState(() => tasks.some((task) => task.status === "En progreso") ? "En progreso" : "Por hacer");
  return <>
    <div className="sm:hidden"><nav aria-label="Etapas de tareas" className="-mx-3 mb-3 flex gap-2 overflow-x-auto px-3 pb-1">{T_STATUS.map((status) => { const count = tasks.filter((task) => task.status === status).length; return <button key={status} onClick={() => setMobileStatus(status)} aria-pressed={mobileStatus === status} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${mobileStatus === status ? "border-brand-400 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600"}`}>{status}<span className="rounded-full bg-white px-1.5 text-[11px] text-slate-500 ring-1 ring-slate-200">{count}</span></button>; })}</nav><TaskColumn status={mobileStatus} tasks={tasks} projects={projects} userById={userById} onOpen={onOpen} onMove={onMove} roomy /></div>
    <div className="hidden sm:block"><Board tasks={tasks} projects={projects} userById={userById} onOpen={onOpen} onMove={onMove} onMoveToStatus={onMoveToStatus} /></div>
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
function TaskModal({ task, me, users, projects, canAssign, canDelete, readOnly = false, nextId, onClose, onSave, onDelete, onComment, onDuplicate, prefill }) {
  useDialogOpenClass();
  const editingExisting = !!task;
  const [f, setF] = useState(() => task || { id: null, project: projects[0]?.id || "", title: "", desc: "", assignee: me.id, status: "Por hacer", priority: "Media", type: "Tarea", due: "", ...(prefill || {}) });
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const [dupProjectId, setDupProjectId] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  const duplicateToProject = async () => {
    if (!dupProjectId || !onDuplicate) return;
    setDuplicating(true);
    try { await onDuplicate(f, dupProjectId); setDupProjectId(""); } finally { setDuplicating(false); }
  };
  // "activity" (comentarios y cambios de estado) se gestiona en el servidor mediante endpoints propios
  // (comentar, cambiar estado). Nunca se reenvía desde acá para no pisar con una copia desactualizada
  // un comentario que se haya agregado durante esta misma sesión de edición.
  const save = () => { if (!f.title.trim()) return; const { activity, ...rest } = f; onSave({ ...rest, id: f.id || nextId(f.project), createdAt: f.createdAt || todayStr() }); };
  const assignable = readOnly || canAssign ? users : users.filter((u) => u.id === me.id);
  const mouseDownOnBackdrop = useRef(false);
  return (
    <div className="motion-backdrop fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-semibold text-slate-900">{editingExisting ? f.id : "Nueva tarea"}</h3><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="space-y-3">
          <input value={f.title} onChange={(e) => set({ title: e.target.value })} disabled={readOnly} placeholder="Título de la tarea" className="u-input text-sm font-medium disabled:bg-slate-50" />
          <textarea value={f.desc} onChange={(e) => set({ desc: e.target.value })} disabled={readOnly} rows={3} placeholder="Descripción / criterios" className="u-input resize-none disabled:bg-slate-50" />
          <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2"><L label="Proyecto" help={editingExisting ? "Podés mover la tarea a otro proyecto. Conserva su ID original." : undefined}><select value={f.project} onChange={(e) => set({ project: e.target.value })} disabled={readOnly} className="u-input disabled:bg-slate-50">{projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}</select></L><L label="Responsable"><select value={f.assignee} onChange={(e) => set({ assignee: e.target.value })} disabled={readOnly} className="u-input disabled:bg-slate-50">{assignable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></L></div>
          <L label="Participantes (opcional)" help="Otras personas que colaboran en la tarea además del responsable.">
            <div className="flex flex-wrap gap-1.5">
              {(f.participants || []).map((id) => { const u = users.find((user) => user.id === id); if (!u) return null; return (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-2.5 pr-1 text-xs font-medium text-slate-700">
                  {u.name}
                  {!readOnly && <button type="button" onClick={() => set({ participants: (f.participants || []).filter((pid) => pid !== id) })} aria-label={`Quitar a ${u.name}`} className="grid h-4 w-4 place-items-center rounded-full hover:bg-slate-200"><X className="h-3 w-3" /></button>}
                </span>
              ); })}
              {(f.participants || []).length === 0 && <span className="text-xs text-slate-400">Sin participantes adicionales</span>}
            </div>
            {!readOnly && (
              <select value="" onChange={(e) => { const id = e.target.value; if (id) set({ participants: [...(f.participants || []), id] }); }} className="u-input mt-1.5">
                <option value="">+ Agregar participante</option>
                {users.filter((u) => u.id !== f.assignee && !(f.participants || []).includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
          </L>
          <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-3"><L label="Estado"><select value={f.status} onChange={(e) => set({ status: e.target.value })} disabled={readOnly} className="u-input disabled:bg-slate-50">{T_STATUS.map((s) => <option key={s}>{s}</option>)}</select></L><L label="Prioridad"><select value={f.priority} onChange={(e) => set({ priority: e.target.value })} disabled={readOnly} className="u-input disabled:bg-slate-50">{PRIORITIES.map((s) => <option key={s}>{s}</option>)}</select></L><L label="Tipo"><select value={f.type} onChange={(e) => set({ type: e.target.value })} disabled={readOnly} className="u-input disabled:bg-slate-50">{TYPES.map((s) => <option key={s}>{s}</option>)}</select></L></div>
          <L label="Fecha límite"><input type="date" value={f.due} onChange={(e) => set({ due: e.target.value })} disabled={readOnly} className="u-input disabled:bg-slate-50" /></L>
        </div>
        {editingExisting && onDuplicate && !readOnly && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <span className="mb-1.5 block text-[11px] font-medium text-slate-500">Duplicar esta tarea en otro proyecto</span>
            <div className="flex gap-2">
              <select value={dupProjectId} onChange={(e) => setDupProjectId(e.target.value)} className="u-input flex-1">
                <option value="">Elegir proyecto…</option>
                {projects.filter((p) => p.id !== f.project).map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
              </select>
              <button type="button" onClick={duplicateToProject} disabled={!dupProjectId || duplicating} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">{duplicating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />} Duplicar</button>
            </div>
          </div>
        )}
        {editingExisting && onComment && !readOnly && <div className="mt-4 border-t border-slate-100 pt-4"><ActivitySection entity={f} onSend={(text) => onComment(f.id, text)} /></div>}
        <div className="mt-5 flex gap-2">{editingExisting && canDelete && !readOnly && <button onClick={() => onDelete(f.id)} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>}<button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{readOnly ? "Cerrar" : "Cancelar"}</button>{!readOnly && <button onClick={save} disabled={!f.title.trim()} className="flex-1 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50">{editingExisting ? "Guardar" : "Crear"}</button>}</div>
      </div>
    </div>
  );
}

/* ===================================== PROYECTOS: REPORTES ===================================== */
function Reports({ tasks, users, projects, proj, whiteboardNotes = [], onOpenNotes }) {
  const [staffQuery, setStaffQuery] = useState("");
  const done = tasks.filter((t) => t.status === "Hecho").length;
  const wip = tasks.filter((t) => t.status === "En progreso" || t.status === "En revisión").length;
  const overdue = tasks.filter(isOverdue).length;
  const byStatus = T_STATUS.map((s) => ({ name: s, value: tasks.filter((t) => t.status === s).length, fill: T_STYLE[s].bar }));
  const activeUsers = users.filter((u) => u.active && u.role !== "monitor_oficina");
  // Si dos personas comparten primer nombre, se distinguen con la inicial del apellido para no confundirlas en el gráfico.
  const firstNameCounts = activeUsers.reduce((acc, u) => { const first = u.name.split(" ")[0]; acc[first] = (acc[first] || 0) + 1; return acc; }, {});
  const byAssignee = activeUsers.map((u) => { const parts = u.name.split(" "); const first = parts[0]; const label = firstNameCounts[first] > 1 && parts[1] ? `${first} ${parts[1][0]}.` : first; return { name: label, value: tasks.filter((t) => t.assignee === u.id).length, fill: u.color }; });
  const projectLabel = (id) => { const p = projects.find((item) => item.id === id); return p ? `${p.key} · ${p.name}` : "Sin proyecto"; };
  const staffWorkload = activeUsers
    .map((u) => ({
      user: u,
      items: [
        ...tasks.filter((t) => t.assignee === u.id).map((t) => ({ ...t, role: "Responsable" })),
        ...tasks.filter((t) => (t.participants || []).includes(u.id)).map((t) => ({ ...t, role: "Participante" })),
      ],
    }))
    .filter((row) => row.items.length > 0 && (!staffQuery || row.user.name.toLowerCase().includes(staffQuery.toLowerCase())));
  const projList = proj === "all" ? projects : projects.filter((p) => p.id === proj);
  const activeProjects = projList.filter((p) => p.active !== false).length;
  const finishedProjects = projList.filter((p) => p.active === false).length;
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Proyectos</h3>
        <div className="grid grid-cols-3 gap-3"><Metric label="Total" value={projList.length} icon={Folder} tint="text-brand-600" /><Metric label="Activos" value={activeProjects} icon={Clock} tint="text-violet-600" /><Metric label="Finalizados" value={finishedProjects} icon={CheckCircle2} tint="text-emerald-600" /></div>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Tareas</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Tareas" value={tasks.length} icon={LayoutGrid} tint="text-brand-600" /><Metric label="Completadas" value={done} icon={CheckCircle2} tint="text-emerald-600" /><Metric label="En curso" value={wip} icon={Clock} tint="text-violet-600" /><Metric label="Vencidas" value={overdue} icon={AlertTriangle} tint="text-rose-600" /></div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><Panel title="Tareas por estado"><ChartBox data={byStatus} /></Panel><Panel title="Carga por responsable"><ChartBox data={byAssignee} /></Panel></div>
      <Panel title="Carga de trabajo por persona">
        <div className="relative mb-3"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={staffQuery} onChange={(e) => setStaffQuery(e.target.value)} placeholder="Buscar persona…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-500" /></div>
        {staffWorkload.length === 0 ? <Empty text="Nadie tiene tareas asignadas con este filtro." /> : (
          <div className="space-y-3">
            {staffWorkload.map(({ user, items }) => (
              <div key={user.id} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex items-center gap-2"><Avatar user={user} size={24} /><b className="text-sm text-slate-800">{user.name}</b><span className="ml-auto text-xs text-slate-400">{items.length} tarea(s)</span></div>
                <div className="space-y-1.5">
                  {items.map((t) => (
                    <div key={`${t.id}-${t.role}`} className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs">
                      <span className="font-mono text-slate-400">{t.id}</span>
                      <span className="font-medium text-slate-700">{t.title}</span>
                      <span className="text-slate-400">· {projectLabel(t.project)}</span>
                      <Chip className={T_STYLE[t.status]?.chip}>{t.status}</Chip>
                      <span className="ml-auto rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200">{t.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Progreso por proyecto"><div className="space-y-3">{projList.map((p) => { const ts = tasks.filter((t) => t.project === p.id); const d = ts.filter((t) => t.status === "Hecho").length; const pct = ts.length ? Math.round((d / ts.length) * 100) : 0; const linkedNotes = whiteboardNotes.filter((n) => n.projectId === p.id).length; return (<div key={p.id}><div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium text-slate-700"><span className="font-mono text-xs" style={{ color: p.color }}>{p.key}</span> {p.name}{linkedNotes > 0 && <button onClick={() => onOpenNotes?.(p.id)} title={`${linkedNotes} nota(s)/dibujo(s) vinculados`} className="ml-1.5 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 align-middle text-[10px] font-medium text-amber-700 hover:bg-amber-100"><StickyNote className="h-3 w-3" /> {linkedNotes}</button>}</span><span className="text-slate-500">{d}/{ts.length} · {pct}%</span></div><HealthBar v={pct} color={p.color} /></div>); })}</div></Panel>
    </div>
  );
}
function ChartBox({ data }) {
  return (<div style={{ width: "100%", height: 220 }}><ResponsiveContainer debounce={1} minWidth={200} minHeight={200}><BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: "#f1f5f9" }} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} /><RechartsBar dataKey="value" radius={[5, 5, 0, 0]} isAnimationActive={false}>{data.map((d, i) => <Cell key={i} fill={d.fill} />)}</RechartsBar></BarChart></ResponsiveContainer></div>);
}

/* ===================================== EQUIPO (ADMIN) ===================================== */
/* ===================================== ACCESO POR PROYECTO ===================================== */
function ProjectAccess({ project, users, onClose, onSave }) {
  useDialogOpenClass();
  const techs = users.filter((u) => u.active && (u.role === "tecnico" || u.role === "tecnico_oficina" || u.role === "monitor_oficina"));
  const [sel, setSel] = useState(new Set(project.allowedUsers || []));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const mouseDownOnBackdrop = useRef(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
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
  useDialogOpenClass();
  const people = users.filter((u) => u.active && u.role !== "monitor_oficina");
  const suggestKey = (project.key || "PRJ");
  const [name, setName] = useState(`${project.name} (copia)`);
  const [key, setKey] = useState(suggestKey);
  const [assignee, setAssignee] = useState("");
  const [resetStatus, setResetStatus] = useState(true);
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); await onDuplicate(project.id, { name: name.trim() || `${project.name} (copia)`, key: key.trim() || suggestKey, assignee: assignee || null, resetStatus }); setBusy(false); };
  const mouseDownOnBackdrop = useRef(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
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
  const [nf, setNf] = useState({ name: "", unit: "u", price: "", cost: "", margin: "", stock: "", minStock: "" });
  const [editId, setEditId] = useState(null);
  const [ef, setEf] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);
  const wrap = (fn) => async (...a) => { try { await fn(...a); } catch (e) { onErr(e); } };
  // Si hay un margen de venta cargado, el precio de venta se recalcula automáticamente a partir del costo.
  const applyMargin = (state) => state.margin !== "" && state.margin != null ? { ...state, price: String(wholeMoney(Number(state.cost || 0) * (1 + (Number(state.margin) || 0) / 100))) } : state;
  const add = async () => { if (!nf.name.trim()) return; try { await onAdd({ name: nf.name.trim(), unit: nf.unit.trim() || "u", price: wholeMoney(nf.price), cost: wholeMoney(nf.cost), stock: Number(nf.stock) || 0, minStock: Number(nf.minStock) || 0 }); setNf({ name: "", unit: "u", price: "", cost: "", margin: "", stock: "", minStock: "" }); } catch (e) { onErr(e); } };
  const startEdit = (p) => { setEditId(p.id); setEf({ name: p.name || "", unit: p.unit || "u", price: p.price ?? 0, cost: p.cost ?? 0, margin: "", stock: p.stock ?? 0, minStock: p.minStock ?? 0 }); };
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
                    <L label="Costo"><input type="number" min="0" step="1" value={ef.cost} onChange={(e) => setEf(applyMargin({ ...ef, cost: e.target.value }))} onBlur={(e) => setEf({ ...ef, cost: wholeMoney(e.target.value) })} className="u-input" /></L>
                    <L label="Margen de venta (%)" help="Si lo completás, el precio de venta se calcula automáticamente como costo + este porcentaje."><input type="number" min="0" step="1" value={ef.margin} onChange={(e) => setEf(applyMargin({ ...ef, margin: e.target.value }))} placeholder="Ej. 40" className="u-input" /></L>
                    <L label="Precio venta"><input type="number" min="0" step="1" value={ef.price} onChange={(e) => setEf({ ...ef, price: e.target.value, margin: "" })} onBlur={(e) => setEf({ ...ef, price: wholeMoney(e.target.value) })} className="u-input" /></L>
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
            <L label="Costo"><input type="number" min="0" step="1" value={nf.cost} onChange={(e) => setNf(applyMargin({ ...nf, cost: e.target.value }))} onBlur={(e) => setNf({ ...nf, cost: wholeMoney(e.target.value) })} className="u-input" /></L>
            <L label="Margen de venta (%)" help="Si lo completás, el precio de venta se calcula automáticamente como costo + este porcentaje."><input type="number" min="0" step="1" value={nf.margin} onChange={(e) => setNf(applyMargin({ ...nf, margin: e.target.value }))} placeholder="Ej. 40" className="u-input" /></L>
            <L label="Precio venta"><input type="number" min="0" step="1" value={nf.price} onChange={(e) => setNf({ ...nf, price: e.target.value, margin: "" })} onBlur={(e) => setNf({ ...nf, price: wholeMoney(e.target.value) })} className="u-input" /></L>
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
const IVA_CONDITIONS = ["IVA Responsable Inscripto", "Responsable Monotributo", "IVA Sujeto Exento", "Consumidor Final", "IVA No Responsable", "Sujeto No Categorizado"];
const SALE_CONDITIONS = ["Contado", "Transferencia Bancaria", "Cheque", "eCheq", "Cuenta Corriente", "Tarjeta de Crédito", "Otro"];
function Clients({ clients, orders, onAdd, onPatch, onRemove, onErr }) {
  const [nf, setNf] = useState({ name: "", cuit: "", contactName: "", site: "", code: "" });
  const [editingClient, setEditingClient] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const suggest = (name) => (name || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  const add = async () => {
    if (!nf.name.trim()) return;
    try { await onAdd({ name: nf.name.trim(), cuit: nf.cuit.trim(), contactName: nf.contactName.trim(), site: nf.site.trim(), code: nf.code.trim().toUpperCase() || undefined, sites: nf.site.trim() ? [{ code: nf.code.trim().toUpperCase(), name: nf.site.trim() }] : [] }); setNf({ name: "", cuit: "", contactName: "", site: "", code: "" }); }
    catch (e) { onErr(e); }
  };
  const wrap = (fn) => async (...a) => { try { await fn(...a); } catch (e) { onErr(e); } };
  return <>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2"><Panel title={`Clientes (${clients.length})`}>
        <div className="space-y-2">
          {clients.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">Sin clientes</div>}
          {clients.map((c) => { const ords = orders.filter((o) => (o.client || "").trim().toLowerCase() === (c.name || "").trim().toLowerCase()).length; return (
            <div key={c.id} onClick={() => setEditingClient(c)} className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3 hover:border-brand-300">
              <span className="grid h-9 min-w-[3rem] place-items-center rounded-md bg-slate-800 px-2 font-mono text-xs font-bold text-white" title="Código del cliente">{c.code || "—"}</span>
              <div className="min-w-0 flex-1"><div className="break-words text-sm font-semibold text-slate-800">{c.name}</div><div className="break-words text-xs text-slate-500">{c.cuit ? `CUIT ${c.cuit} · ` : ""}{(c.sites?.length ? c.sites.map((s) => s.code ? `${s.name} (${s.code})` : s.name).join(", ") : c.site) || "Sin planta"} · {ords} orden(es){c.ivaCondition ? ` · ${c.ivaCondition}` : ""}</div></div>
              <div className="flex w-full items-center justify-end gap-1 border-t border-slate-100 pt-2 sm:w-auto sm:border-0 sm:pt-0" onClick={(event) => event.stopPropagation()}>
                <button onClick={() => setEditingClient(c)} title="Editar cliente" className="inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Editar</button>
                <button onClick={() => setPendingDelete(c)} title="Eliminar" aria-label="Eliminar cliente" className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ); })}
        </div>
      </Panel></div>
      <div><Panel title="Nuevo cliente">
        <div className="space-y-2">
          <L label="Apellido y Nombre / Razón Social"><input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value, code: nf.code || suggest(e.target.value) })} placeholder="Razón social" className="u-input" /></L>
          <L label="CUIT"><input value={nf.cuit} onChange={(e) => setNf({ ...nf, cuit: e.target.value })} placeholder="20-12345678-9" className="u-input" /></L>
          <L label="Atención (contacto)"><input value={nf.contactName} onChange={(e) => setNf({ ...nf, contactName: e.target.value })} placeholder="Nombre de la persona de contacto" className="u-input" /></L>
          <L label="Primera planta" help="Podés agregar más plantas después, al editar el cliente."><input value={nf.site} onChange={(e) => setNf({ ...nf, site: e.target.value })} placeholder="Ej. Venado Tuerto" className="u-input" /></L>
          <L label="Código (para el N° de OT)"><input value={nf.code} onChange={(e) => setNf({ ...nf, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })} placeholder="Ej. LDV" className="u-input font-mono" /></L>
          <button onClick={add} disabled={!nf.name.trim()} className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"><Plus className="h-4 w-4" /> Agregar cliente</button>
          <p className="text-[11px] text-slate-400">El código identifica al cliente en el número de orden (ej. <span className="font-mono">OT-LDV-2026-001</span>). Si lo dejas vacío, se genera automáticamente. Los nombres duplicados se unifican. Condición frente al IVA, domicilio comercial y condición de venta se completan al editar el cliente.</p>
        </div>
      </Panel></div>
    </div>
    {editingClient && <ClientEditor value={editingClient} onClose={() => setEditingClient(null)} onSave={async (form) => { await wrap(onPatch)(editingClient.id, form); setEditingClient(null); }} />}
    {pendingDelete && <ConfirmDialog title="Eliminar cliente" message={`Se eliminará “${pendingDelete.name}”. ${orders.filter((o) => (o.client || "").trim().toLowerCase() === (pendingDelete.name || "").trim().toLowerCase()).length || "No tiene"} orden(es) asociadas permanecerán en el historial.`} confirmLabel="Eliminar" danger onClose={() => setPendingDelete(null)} onConfirm={async () => { await wrap(onRemove)(pendingDelete.id); setPendingDelete(null); }} />}
  </>;
}

function ClientEditor({ value, onClose, onSave }) {
  useDialogOpenClass();
  const [form, setForm] = useState({ name: value.name || "", cuit: value.cuit || "", ivaCondition: value.ivaCondition || "", address: value.address || "", locality: value.locality || "", phone: value.phone || "", email: value.email || "", contactName: value.contactName || "", saleCondition: value.saleCondition || "", logoDataUrl: value.logoDataUrl || "", sites: value.sites?.length ? value.sites.map((s) => ({ ...s })) : [{ code: value.code || "", name: value.site || "" }] });
  const [logoError, setLogoError] = useState("");
  const mouseDownOnBackdrop = useRef(false);
  const set = (field, val) => setForm((current) => ({ ...current, [field]: val }));
  const setSite = (index, patch) => setForm((current) => ({ ...current, sites: current.sites.map((s, i) => i === index ? { ...s, ...patch } : s) }));
  const addSite = () => set("sites", [...form.sites, { code: "", name: "" }]);
  const removeSite = (index) => set("sites", form.sites.filter((_, i) => i !== index));
  const validSites = form.sites.map((s) => ({ code: s.code.trim(), name: s.name.trim() })).filter((s) => s.name);
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
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}><div className="mobile-dialog mobile-sheet-content w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold text-slate-900">Editar cliente</h2><p className="text-xs text-slate-500">Los cambios se aplican a futuras selecciones.</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="space-y-3"><L label="Apellido y Nombre / Razón Social"><input autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} className="u-input" /></L><L label="Logotipo" help="Se usa en los reportes generados para este cliente (ej. Listado de Materiales)."><div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5"><div className="grid h-14 w-20 shrink-0 place-items-center rounded-lg bg-white ring-1 ring-slate-200">{form.logoDataUrl ? <img src={form.logoDataUrl} alt="Logo del cliente" className="max-h-12 max-w-full object-contain" /> : <Building2 className="h-5 w-5 text-slate-300" />}</div><div className="flex-1"><div className="flex flex-wrap gap-2"><label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white"><Upload className="h-3.5 w-3.5" /> Cargar logo<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { selectLogo(e.target.files?.[0]); e.target.value = ""; }} /></label>{form.logoDataUrl && <button type="button" onClick={() => set("logoDataUrl", "")} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">Quitar</button>}</div><p className="mt-1 text-[11px] text-slate-500">PNG, JPG o WebP. Máximo 1,5 MB.</p>{logoError && <p className="mt-1 text-xs font-medium text-rose-600">{logoError}</p>}</div></div></L><L label="CUIT"><input value={form.cuit} onChange={(e) => set("cuit", e.target.value)} placeholder="20-12345678-9" className="u-input" /></L><L label="Condición frente al IVA"><select value={form.ivaCondition} onChange={(e) => set("ivaCondition", e.target.value)} className="u-input"><option value="">Sin especificar</option>{IVA_CONDITIONS.map((c) => <option key={c}>{c}</option>)}</select></L><L label="Domicilio comercial"><input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Calle y número" className="u-input" /></L><L label="Localidad"><input value={form.locality} onChange={(e) => set("locality", e.target.value)} placeholder="Ciudad, provincia" className="u-input" /></L><L label="Condición de venta"><select value={form.saleCondition} onChange={(e) => set("saleCondition", e.target.value)} className="u-input"><option value="">Sin especificar</option>{SALE_CONDITIONS.map((c) => <option key={c}>{c}</option>)}</select></L><L label="Atención (contacto)"><input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="Nombre de la persona de contacto" className="u-input" /></L><div className="grid grid-cols-2 gap-2"><L label="Teléfono"><input value={form.phone} onChange={(e) => set("phone", e.target.value)} className="u-input" /></L><L label="Email"><input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="u-input" /></L></div><L label="Plantas / sitios" help="Un mismo cliente puede tener varias plantas. Cada una tiene su propio código, usado para numerar las órdenes de trabajo (ej. OT-VTU-2026-001)."><div className="space-y-2">{form.sites.map((s, index) => (<div key={index} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-2"><input value={s.code} onChange={(e) => setSite(index, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })} placeholder="Código" className="u-input font-mono" /><input value={s.name} onChange={(e) => setSite(index, { name: e.target.value })} placeholder="Nombre de la planta (ej. Venado Tuerto)" className="u-input" /><button type="button" onClick={() => removeSite(index)} aria-label="Quitar planta" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div>))}</div><button type="button" onClick={addSite} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600"><Plus className="h-3.5 w-3.5" /> Agregar planta</button></L></div><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={!form.name.trim()} onClick={() => { const payload = { name: form.name.trim(), cuit: form.cuit.trim(), sites: validSites, site: validSites[0]?.name || "", ivaCondition: form.ivaCondition, address: form.address.trim(), locality: form.locality.trim(), phone: form.phone.trim(), email: form.email.trim(), contactName: form.contactName.trim(), saleCondition: form.saleCondition, logoDataUrl: form.logoDataUrl }; if (validSites[0]?.code) payload.code = validSites[0].code; onSave(payload); }} className="rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Guardar</button></div></div></div>;
}

function Suppliers({ suppliers, purchaseOrders, onAdd, onPatch, onRemove, onErr }) {
  const [nf, setNf] = useState({ name: "", cuit: "", contactName: "", paymentTermsDays: 30 });
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const add = async () => {
    if (!nf.name.trim()) return;
    try { await onAdd({ name: nf.name.trim(), cuit: nf.cuit.trim(), contactName: nf.contactName.trim(), paymentTermsDays: Number(nf.paymentTermsDays) || 0 }); setNf({ name: "", cuit: "", contactName: "", paymentTermsDays: 30 }); }
    catch (e) { onErr(e); }
  };
  const wrap = (fn) => async (...a) => { try { await fn(...a); } catch (e) { onErr(e); } };
  return <>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2"><Panel title={`Proveedores (${suppliers.length})`}>
        <div className="space-y-2">
          {suppliers.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">Sin proveedores</div>}
          {suppliers.map((s) => { const ocs = purchaseOrders.filter((po) => po.supplierId === s.id).length; return (
            <div key={s.id} onClick={() => setEditingSupplier(s)} className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border p-3 hover:border-brand-300 ${s.active === false ? "border-slate-100 bg-slate-50 opacity-70" : "border-slate-200"}`}>
              <span className="grid h-9 min-w-[3rem] place-items-center rounded-md bg-slate-800 px-2 font-mono text-xs font-bold text-white" title="Código del proveedor">{s.code || "—"}</span>
              <div className="min-w-0 flex-1"><div className="break-words text-sm font-semibold text-slate-800">{s.name}{s.active === false && <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Inactivo</span>}</div><div className="break-words text-xs text-slate-500">{s.cuit || "Sin CUIT"} · {s.contactName || s.contact || "Sin contacto"} · {s.paymentTermsDays || 0} días de pago · {ocs} OC{s.ivaCondition ? ` · ${s.ivaCondition}` : ""}{s.locality ? ` · ${s.locality}` : ""}</div></div>
              <div className="flex w-full items-center justify-end gap-1 border-t border-slate-100 pt-2 sm:w-auto sm:border-0 sm:pt-0" onClick={(event) => event.stopPropagation()}>
                <button onClick={() => setEditingSupplier(s)} title="Editar proveedor" className="inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Editar</button>
                <button onClick={() => setPendingDelete(s)} title="Eliminar" aria-label="Eliminar proveedor" className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ); })}
        </div>
      </Panel></div>
      <div><Panel title="Nuevo proveedor">
        <div className="space-y-2">
          <L label="Razón social"><input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="Nombre del proveedor" className="u-input" /></L>
          <L label="CUIT"><input value={nf.cuit} onChange={(e) => setNf({ ...nf, cuit: e.target.value })} placeholder="30-12345678-9" className="u-input" /></L>
          <L label="Atención (contacto)"><input value={nf.contactName} onChange={(e) => setNf({ ...nf, contactName: e.target.value })} placeholder="Nombre de la persona de contacto" className="u-input" /></L>
          <L label="Condición de pago (días)"><input type="number" min={0} value={nf.paymentTermsDays} onChange={(e) => setNf({ ...nf, paymentTermsDays: e.target.value })} className="u-input" /></L>
          <button onClick={add} disabled={!nf.name.trim()} className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"><Plus className="h-4 w-4" /> Agregar proveedor</button>
          <p className="text-[11px] text-slate-400">El código se genera automáticamente a partir del nombre y se usa en el número de orden de compra. Los nombres duplicados se unifican.</p>
        </div>
      </Panel></div>
    </div>
    {editingSupplier && <SupplierEditor value={editingSupplier} onClose={() => setEditingSupplier(null)} onSave={async (form) => { await wrap(onPatch)(editingSupplier.id, form); setEditingSupplier(null); }} />}
    {pendingDelete && <ConfirmDialog title="Eliminar proveedor" message={`Se eliminará “${pendingDelete.name}”. ${purchaseOrders.filter((po) => po.supplierId === pendingDelete.id).length ? "No se puede eliminar: tiene órdenes de compra vinculadas." : "No tiene órdenes de compra asociadas."}`} confirmLabel="Eliminar" danger onClose={() => setPendingDelete(null)} onConfirm={async () => { await wrap(onRemove)(pendingDelete.id); setPendingDelete(null); }} />}
  </>;
}

function SupplierEditor({ value, onClose, onSave }) {
  useDialogOpenClass();
  const [form, setForm] = useState({ name: value.name || "", code: value.code || "", cuit: value.cuit || "", address: value.address || "", locality: value.locality || "", phone: value.phone || "", email: value.email || "", contactName: value.contactName || value.contact || "", ivaCondition: value.ivaCondition || "", saleCondition: value.saleCondition || "", paymentTermsDays: value.paymentTermsDays ?? 30, active: value.active !== false });
  const mouseDownOnBackdrop = useRef(false);
  const set = (field, val) => setForm((current) => ({ ...current, [field]: val }));
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
    <div className="mobile-dialog mobile-sheet-content w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold text-slate-900">Editar proveedor</h2><p className="text-xs text-slate-500">Los cambios se aplican a futuras órdenes de compra.</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
      <div className="space-y-3">
        <L label="Apellido y Nombre / Razón Social"><input autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} className="u-input" /></L>
        <L label="Código"><input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} className="u-input font-mono" /></L>
        <L label="CUIT"><input value={form.cuit} onChange={(e) => set("cuit", e.target.value)} className="u-input" /></L>
        <L label="Condición frente al IVA"><select value={form.ivaCondition} onChange={(e) => set("ivaCondition", e.target.value)} className="u-input"><option value="">Sin especificar</option>{IVA_CONDITIONS.map((c) => <option key={c}>{c}</option>)}</select></L>
        <L label="Dirección"><input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Calle y número" className="u-input" /></L>
        <L label="Localidad"><input value={form.locality} onChange={(e) => set("locality", e.target.value)} placeholder="Ciudad, provincia" className="u-input" /></L>
        <L label="Condición de venta"><select value={form.saleCondition} onChange={(e) => set("saleCondition", e.target.value)} className="u-input"><option value="">Sin especificar</option>{SALE_CONDITIONS.map((c) => <option key={c}>{c}</option>)}</select></L>
        <L label="Atención (contacto)"><input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="Nombre de la persona de contacto" className="u-input" /></L>
        <div className="grid grid-cols-2 gap-2"><L label="Teléfono"><input value={form.phone} onChange={(e) => set("phone", e.target.value)} className="u-input" /></L><L label="Email"><input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="u-input" /></L></div>
        <L label="Condición de pago (días)"><input type="number" min={0} value={form.paymentTermsDays} onChange={(e) => set("paymentTermsDays", e.target.value)} className="u-input" /></L>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> Proveedor activo</label>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={!form.name.trim()} onClick={() => onSave({ name: form.name.trim(), code: form.code.trim(), cuit: form.cuit.trim(), address: form.address.trim(), locality: form.locality.trim(), phone: form.phone.trim(), email: form.email.trim(), contactName: form.contactName.trim(), ivaCondition: form.ivaCondition, saleCondition: form.saleCondition, paymentTermsDays: Number(form.paymentTermsDays) || 0, active: form.active })} className="rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Guardar</button></div>
    </div>
  </div>;
}

/* ===================================== PIZARRA ===================================== */
const WHITEBOARD_COLORS = ["#111827", "#DC2626", "#2563EB", "#16A34A", "#F18700", "#FFFFFF"];
const WHITEBOARD_WIDTHS = [{ label: "Fino", value: 4 }, { label: "Medio", value: 10 }, { label: "Grueso", value: 20 }];
const WHITEBOARD_ERASER_WIDTH = 44;
const WHITEBOARD_MAX_HISTORY = 30;
// Resolución máxima del lienzo (px del lado más largo) al incorporar una imagen cargada o pegada,
// para que fotos y capturas de alta resolución no se guarden pixeladas dentro de una caja de edición chica.
const WHITEBOARD_MAX_CANVAS_DIM = 3200;
const WHITEBOARD_NOTE_COLORS = ["#FEF3C7", "#DBEAFE", "#DCFCE7", "#FCE7F3", "#E5E7EB"];

/* ===================================== PIZARRA: GALERÍA DE NOTAS ===================================== */
function Whiteboard({ notes, projects, users, me, initialProjectId = "", onSave, onDelete, onErr }) {
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState(initialProjectId);
  const [editorMode, setEditorMode] = useState(null); // { kind: "text" | "drawing", note }
  const [shareNote, setShareNote] = useState(null);
  const [viewNote, setViewNote] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (initialProjectId) setProjectFilter(initialProjectId); }, [initialProjectId]);

  const visible = notes.filter((n) => (!query || `${n.title} ${n.content || ""}`.toLowerCase().includes(query.toLowerCase())) && (!projectFilter || n.projectId === projectFilter));
  const emptyNote = (type) => ({ type, title: "", content: "", color: WHITEBOARD_NOTE_COLORS[0], projectId: "", imageDataUrl: "" });
  const startNew = (kind) => setEditorMode({ kind, note: emptyNote(kind) });
  const startEdit = (note) => setEditorMode({ kind: note.type, note });
  const startDuplicate = (note) => setEditorMode({ kind: note.type, note: { ...note, id: undefined, _updatedAt: undefined, sharedWith: [], title: `${note.title || "Sin título"} (copia)` } });

  const saveNote = async (payload) => {
    setSaving(true);
    try { await onSave({ ...editorMode.note, ...payload }); setEditorMode(null); }
    catch (e) { onErr(e); }
    finally { setSaving(false); }
  };

  if (editorMode?.kind === "drawing") {
    return <DrawingCanvasEditor note={editorMode.note} projects={projects} saving={saving} onCancel={() => setEditorMode(null)} onSave={(imageDataUrl, meta) => saveNote({ ...meta, type: "drawing", imageDataUrl })} />;
  }

  return (
    <div className="space-y-3">
      <div><h2 className="text-lg font-semibold text-slate-900">Notas</h2><p className="text-xs text-slate-500">Notas escritas o dibujadas — pensadas para un relevamiento en planta, antes de armar, aprobar o ejecutar un proyecto. Podés duplicarlas y compartirlas con otros usuarios.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nota…" className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-500" /></div>
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">Todos los proyectos</option>{projects.filter((p) => notes.some((n) => n.projectId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}</select>
        <button onClick={() => startNew("text")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"><StickyNote className="h-4 w-4" /> Nota de texto</button>
        <button onClick={() => startNew("drawing")} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-medium text-white hover:bg-brand-400"><PenLine className="h-4 w-4" /> Dibujo</button>
      </div>
      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><StickyNote className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-2 text-sm font-semibold text-slate-700">Sin notas para mostrar</h3><p className="mt-1 text-xs text-slate-400">Agregá una nota o un dibujo para empezar.</p></div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((note) => {
            const isOwner = note.createdBy === me.id;
            const isSharedWithMe = !isOwner && (note.sharedWith || []).includes(me.id);
            const project = projects.find((p) => p.id === note.projectId);
            return (
              <Box key={note.id} className="flex flex-col overflow-hidden">
                <button onClick={() => (isOwner ? startEdit(note) : setViewNote(note))} className="block text-left">
                  {note.type === "drawing"
                    ? <div className="h-36 w-full bg-slate-50">{note.imageDataUrl && <img src={note.imageDataUrl} alt={note.title || "Dibujo"} className="h-full w-full object-cover" />}</div>
                    : <div className="h-36 w-full overflow-hidden p-3" style={{ background: note.color || WHITEBOARD_NOTE_COLORS[0] }}><p className="line-clamp-5 whitespace-pre-wrap text-xs text-slate-700">{note.content || "Sin contenido"}</p></div>}
                </button>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div><h3 className="truncate text-sm font-semibold text-slate-900">{note.title || "Sin título"}</h3><p className="text-[11px] text-slate-400">{note.type === "drawing" ? "Dibujo" : "Nota"} · {budgetDate((note.createdAt || "").slice(0, 10))}</p></div>
                  <div className="flex flex-wrap gap-1.5">
                    {project && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{project.key}</span>}
                    {isOwner
                      ? ((note.sharedWith || []).length > 0
                        ? <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">Compartida con {note.sharedWith.length}</span>
                        : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">Privada</span>)
                      : isSharedWithMe
                        ? <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Compartida por {note.createdByName}</span>
                        : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">De {note.createdByName} · vista de administrador</span>}
                  </div>
                  <div className="mt-auto flex items-center gap-1.5 border-t border-slate-100 pt-2">
                    <button onClick={() => startDuplicate(note)} title="Duplicar" aria-label="Duplicar nota" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Copy className="h-4 w-4" /></button>
                    {isOwner && <button onClick={() => setShareNote(note)} title="Compartir" aria-label="Compartir nota" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Share2 className="h-4 w-4" /></button>}
                    {isOwner && <button onClick={() => startEdit(note)} title="Editar" aria-label="Editar nota" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>}
                    {(isOwner || me.role === "admin") && <button onClick={() => setPendingDelete(note)} title="Eliminar" aria-label="Eliminar nota" className="ml-auto grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>}
                  </div>
                </div>
              </Box>
            );
          })}
        </div>
      )}
      {editorMode?.kind === "text" && <WhiteboardTextEditor note={editorMode.note} projects={projects} saving={saving} onClose={() => setEditorMode(null)} onSave={(form) => saveNote({ ...form, type: "text" })} />}
      {shareNote && <WhiteboardShareDialog note={shareNote} users={users} me={me} onClose={() => setShareNote(null)} onSave={async (sharedWith) => { try { await onSave({ ...shareNote, sharedWith }); setShareNote(null); } catch (e) { onErr(e); } }} />}
      {viewNote && <WhiteboardViewDialog note={viewNote} projects={projects} onClose={() => setViewNote(null)} />}
      {pendingDelete && <ConfirmDialog title="Eliminar nota" message={`Se eliminará “${pendingDelete.title || "esta nota"}”. Esta acción no se puede deshacer.`} confirmLabel="Eliminar" danger onClose={() => setPendingDelete(null)} onConfirm={async () => { try { await onDelete(pendingDelete.id); setPendingDelete(null); } catch (e) { onErr(e); } }} />}
    </div>
  );
}

function WhiteboardTextEditor({ note, projects, saving, onClose, onSave }) {
  const [form, setForm] = useState({ title: note.title || "", content: note.content || "", color: note.color || WHITEBOARD_NOTE_COLORS[0], projectId: note.projectId || "" });
  const set = (field, val) => setForm((current) => ({ ...current, [field]: val }));
  const mouseDownOnBackdrop = useRef(false);
  useDialogOpenClass();
  return (
    <div className="motion-backdrop fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-900">{note.id ? "Editar nota" : "Nueva nota"}</h2><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="space-y-3">
          <L label="Título"><input autoFocus value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Ej. Relevamiento tablero sala 2" className="u-input" /></L>
          <L label="Color"><div className="flex gap-2">{WHITEBOARD_NOTE_COLORS.map((c) => <button key={c} type="button" onClick={() => set("color", c)} aria-label={`Color ${c}`} className={`h-9 w-9 rounded-full border-2 ${form.color === c ? "border-brand-500" : "border-slate-200"}`} style={{ background: c }} />)}</div></L>
          <L label="Proyecto (opcional)" help="Vinculala a un proyecto si surge de un relevamiento previo a su elaboración, aprobación o ejecución."><select value={form.projectId} onChange={(e) => set("projectId", e.target.value)} className="u-input"><option value="">Sin vincular</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}</select></L>
          <L label="Contenido"><textarea rows={8} value={form.content} onChange={(e) => set("content", e.target.value)} placeholder="Escribí lo que relevaste…" className="u-input resize-none" /></L>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={saving || (!form.title.trim() && !form.content.trim())} onClick={() => onSave(form)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</button></div>
      </div>
    </div>
  );
}

function WhiteboardShareDialog({ note, users, me, onClose, onSave }) {
  const [sel, setSel] = useState(new Set(note.sharedWith || []));
  const [saving, setSaving] = useState(false);
  const toggle = (id) => setSel((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const candidates = users.filter((u) => u.active && u.id !== me.id);
  const mouseDownOnBackdrop = useRef(false);
  useDialogOpenClass();
  const submit = async () => { setSaving(true); try { await onSave([...sel]); } finally { setSaving(false); } };
  return (
    <div className="motion-backdrop fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600"><Share2 className="h-5 w-5" /></span><div><h2 className="text-lg font-semibold text-slate-900">Compartir nota</h2><p className="text-xs text-slate-500">{note.title || "Sin título"}</p></div></div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {candidates.length === 0 && <p className="text-xs text-slate-400">No hay otros usuarios activos.</p>}
          {candidates.map((u) => (
            <label key={u.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-slate-50">
              <input type="checkbox" checked={sel.has(u.id)} onChange={() => toggle(u.id)} />
              <Avatar user={u} size={26} /><span className="text-sm text-slate-700">{u.name}</span>
            </label>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={saving} onClick={submit} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</button></div>
      </div>
    </div>
  );
}

function WhiteboardViewDialog({ note, projects, onClose }) {
  const project = projects.find((p) => p.id === note.projectId);
  const mouseDownOnBackdrop = useRef(false);
  const [zoomed, setZoomed] = useState(false);
  useDialogOpenClass();
  const isDrawing = note.type === "drawing";
  const downloadImage = () => {
    const a = document.createElement("a");
    a.href = note.imageDataUrl;
    a.download = `${(note.title || "dibujo").trim().replace(/[^\w\-]+/g, "_") || "dibujo"}.png`;
    a.click();
  };
  return (
    <div className="motion-backdrop fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
      <div className={`mobile-dialog mobile-sheet-content w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl ${isDrawing ? "max-w-4xl" : "max-w-lg"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold text-slate-900">{note.title || "Sin título"}</h2><p className="text-xs text-slate-500">Compartida por {note.createdByName}{project ? ` · ${project.key}` : ""}</p></div><button onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        {isDrawing
          ? (<>
              <button type="button" onClick={() => setZoomed(true)} title="Ampliar dibujo" aria-label="Ampliar dibujo" className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg border border-slate-200">
                <img src={note.imageDataUrl} alt={note.title || "Dibujo"} className="w-full" />
                <span className="absolute inset-0 hidden items-center justify-center bg-slate-900/0 transition group-hover:flex group-hover:bg-slate-900/10">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-white/90 text-slate-700 shadow"><Maximize2 className="h-5 w-5" /></span>
                </span>
              </button>
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={downloadImage} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Download className="h-4 w-4" /> Descargar</button>
                <button onClick={() => setZoomed(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Maximize2 className="h-4 w-4" /> Ampliar</button>
              </div>
            </>)
          : <p className="whitespace-pre-wrap rounded-lg p-3 text-sm text-slate-700" style={{ background: note.color || WHITEBOARD_NOTE_COLORS[0] }}>{note.content || "Sin contenido"}</p>}
      </div>
      {zoomed && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4" onClick={() => setZoomed(false)}>
          <img src={note.imageDataUrl} alt={note.title || "Dibujo"} className="max-h-[95vh] max-w-[95vw] rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          <button onClick={() => setZoomed(false)} aria-label="Cerrar vista ampliada" className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/20 text-white hover:bg-white/30"><X className="h-5 w-5" /></button>
          <button onClick={downloadImage} className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-2 text-sm font-medium text-white hover:bg-white/30"><Download className="h-4 w-4" /> Descargar</button>
        </div>
      )}
    </div>
  );
}

/* ===================================== PIZARRA: EDITOR DE DIBUJO ===================================== */
function DrawingCanvasEditor({ note, projects, saving, onCancel, onSave }) {
  useDialogOpenClass();
  const [title, setTitle] = useState(note.title || "");
  const [projectId, setProjectId] = useState(note.projectId || "");
  const boardRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [color, setColor] = useState(WHITEBOARD_COLORS[0]);
  const [width, setWidth] = useState(WHITEBOARD_WIDTHS[1].value);
  const [tool, setTool] = useState("draw"); // "draw" | "erase"
  const [confirmClear, setConfirmClear] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fileInputRef = useRef(null);
  const initialLoadedRef = useRef(false);
  // Imagen recién cargada/pegada que todavía no se "fijó" en el lienzo: se puede arrastrar
  // libremente antes de confirmarla, y recién ahí se dibuja sobre el canvas para poder escribir encima.
  const [placedImage, setPlacedImage] = useState(null); // { src, x, y, w, h }
  const dragImageRef = useRef(null);
  const historyRef = useRef([]);
  const redoRef = useRef([]);
  const [historyTick, setHistoryTick] = useState(0);
  // El historial guarda canvases (no dataURL + Image) para que copiar sea 100% síncrono. Antes,
  // "sacar la foto" con toDataURL() y "pintarla de vuelta" con new Image()/onload eran pasos
  // asíncronos: si dos redimensiones de ventana (o dos Ctrl+Z) ocurrían casi juntas, la segunda
  // sacaba la foto ANTES de que la primera terminara de restaurar — capturaba un lienzo recién
  // vaciado y el dibujo se perdía para siempre. Canvas-a-canvas no tiene ese hueco: no hay "carga".
  const cloneCanvas = (source) => {
    if (!source || !source.width || !source.height) return null;
    const clone = document.createElement("canvas");
    clone.width = source.width; clone.height = source.height;
    clone.getContext("2d").drawImage(source, 0, 0);
    return clone;
  };
  const snapshotCanvas = () => { try { return cloneCanvas(canvasRef.current); } catch { return null; } };
  const restoreSnapshot = (snapshotEl) => {
    const canvas = canvasRef.current, wrap = canvasWrapRef.current;
    if (!canvas || !wrap || !snapshotEl) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, wrap.clientWidth, wrap.clientHeight);
    ctx.drawImage(snapshotEl, 0, 0, wrap.clientWidth, wrap.clientHeight);
  };
  const pushHistory = () => {
    const snap = snapshotCanvas();
    if (!snap) return;
    historyRef.current.push(snap);
    if (historyRef.current.length > WHITEBOARD_MAX_HISTORY) historyRef.current.shift();
    redoRef.current = [];
    setHistoryTick((n) => n + 1);
  };
  const undo = () => {
    if (!historyRef.current.length) return;
    const current = snapshotCanvas();
    const prev = historyRef.current.pop();
    if (current) redoRef.current.push(current);
    restoreSnapshot(prev);
    setHistoryTick((n) => n + 1);
  };
  const redo = () => {
    if (!redoRef.current.length) return;
    const current = snapshotCanvas();
    const next = redoRef.current.pop();
    if (current) historyRef.current.push(current);
    restoreSnapshot(next);
    setHistoryTick((n) => n + 1);
  };
  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if ((event.ctrlKey || event.metaKey) && key === "y") { event.preventDefault(); redo(); }
      else if ((event.ctrlKey || event.metaKey) && key === "c") { event.preventDefault(); copyCanvas(); }
      else if (placedImage && key === "escape") { event.preventDefault(); cancelPlacedImage(); }
      else if (placedImage && key === "enter") { event.preventDefault(); confirmPlacedImage(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [placedImage]);

  const scaleRef = useRef(typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1);
  const sizeCanvas = (preserveExisting, forcedScale) => {
    const canvas = canvasRef.current;
    const wrap = canvasWrapRef.current;
    if (!canvas || !wrap) return;
    const { clientWidth, clientHeight } = wrap;
    if (!clientWidth || !clientHeight) return;
    const desired = forcedScale || scaleRef.current || (window.devicePixelRatio || 1);
    // Se limita el total de píxeles del lienzo (no solo la relación con el CSS) para no generar
    // bitmaps gigantes en pantalla completa después de haber cargado una foto de alta resolución.
    const scale = Math.max(1, Math.min(desired, WHITEBOARD_MAX_CANVAS_DIM / clientWidth, WHITEBOARD_MAX_CANVAS_DIM / clientHeight));
    scaleRef.current = scale;
    // Clonar el canvas (no toDataURL + Image) es síncrono: no hay ventana de tiempo en la que
    // otra redimensión pueda colarse y fotografiar un lienzo recién vaciado.
    const snapshot = preserveExisting ? cloneCanvas(canvas) : null;
    canvas.width = Math.round(clientWidth * scale);
    canvas.height = Math.round(clientHeight * scale);
    canvas.style.width = `${clientWidth}px`;
    canvas.style.height = `${clientHeight}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, clientWidth, clientHeight);
    if (snapshot) ctx.drawImage(snapshot, 0, 0, clientWidth, clientHeight);
  };
  // Si la imagen a incorporar tiene más resolución nativa que la que ofrece hoy el lienzo,
  // se sube la escala de trabajo antes de dibujarla para no perder nitidez al guardarla.
  const ensureResolutionFor = (img) => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const { clientWidth: w, clientHeight: h } = wrap;
    if (!w || !h) return;
    const neededScale = Math.max(img.width / w, img.height / h);
    if (neededScale > scaleRef.current) { scaleRef.current = neededScale; sizeCanvas(true); }
  };

  useEffect(() => {
    sizeCanvas(false);
    if (note.imageDataUrl && !initialLoadedRef.current) {
      initialLoadedRef.current = true;
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current, wrap = canvasWrapRef.current;
        if (!canvas || !wrap) return;
        ensureResolutionFor(img);
        const ctx = canvas.getContext("2d");
        const { clientWidth: w, clientHeight: h } = wrap;
        const scale = Math.min(w / img.width, h / img.height);
        const drawW = img.width * scale, drawH = img.height * scale;
        ctx.drawImage(img, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
      };
      img.src = note.imageDataUrl;
    }
    // Debounce: arrastrar el borde de la ventana dispara decenas de eventos "resize" por segundo;
    // ya no puede perder el dibujo (el copiado es síncrono), pero redimensionar en cada uno de
    // esos eventos es trabajo de sobra — se espera a que la ventana se quede quieta un instante.
    let resizeTimer = null;
    const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => sizeCanvas(true), 120); };
    const onFullscreenChange = () => { setIsFullscreen(document.fullscreenElement === boardRef.current); sizeCanvas(true); };
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => { clearTimeout(resizeTimer); window.removeEventListener("resize", onResize); document.removeEventListener("fullscreenchange", onFullscreenChange); };
  }, []);

  const pointFromEvent = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const startDraw = (event) => {
    if (placedImage) return;
    event.preventDefault();
    pushHistory();
    canvasRef.current?.setPointerCapture?.(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(event);
  };
  const draw = (event) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const point = pointFromEvent(event);
    const last = lastPointRef.current || point;
    ctx.strokeStyle = tool === "erase" ? "#FFFFFF" : color;
    ctx.lineWidth = tool === "erase" ? WHITEBOARD_ERASER_WIDTH : width;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  };
  const endDraw = (event) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    canvasRef.current?.releasePointerCapture?.(event.pointerId);
  };
  const clearBoard = () => {
    const canvas = canvasRef.current, wrap = canvasWrapRef.current;
    if (!canvas || !wrap) return;
    pushHistory();
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, wrap.clientWidth, wrap.clientHeight);
    setConfirmClear(false);
  };
  const toggleFullscreen = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else boardRef.current?.requestFullscreen?.(); };
  // Deja la imagen "flotando" sobre el lienzo, sin dibujarla todavía, para poder arrastrarla a la
  // posición deseada antes de fijarla — recién al confirmar se estampa sobre el dibujo existente
  // (sin borrar lo ya dibujado) y queda disponible para escribir o dibujar encima.
  const beginPlaceImage = (img) => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const { clientWidth: w, clientHeight: h } = wrap;
    if (!w || !h) return;
    const fitScale = Math.min(1, w / img.width, h / img.height);
    const boxW = Math.round(img.width * fitScale), boxH = Math.round(img.height * fitScale);
    setPlacedImage({ src: img.src, naturalW: img.width, naturalH: img.height, x: Math.round((w - boxW) / 2), y: Math.round((h - boxH) / 2), w: boxW, h: boxH });
  };
  const confirmPlacedImage = () => {
    const placement = placedImage;
    const canvas = canvasRef.current;
    if (!placement || !canvas) return;
    const img = new Image();
    img.onload = () => {
      pushHistory();
      ensureResolutionFor({ width: placement.naturalW, height: placement.naturalH });
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, placement.x, placement.y, placement.w, placement.h);
      setPlacedImage(null);
    };
    img.src = placement.src;
  };
  const cancelPlacedImage = () => setPlacedImage(null);
  const startDragImage = (event) => {
    if (!placedImage) return;
    event.preventDefault();
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    dragImageRef.current = { offsetX: event.clientX - rect.left - placedImage.x, offsetY: event.clientY - rect.top - placedImage.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const dragImage = (event) => {
    if (!dragImageRef.current) return;
    event.preventDefault();
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const nx = event.clientX - rect.left - dragImageRef.current.offsetX;
    const ny = event.clientY - rect.top - dragImageRef.current.offsetY;
    setPlacedImage((current) => (current ? { ...current, x: nx, y: ny } : current));
  };
  const endDragImage = (event) => { dragImageRef.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId); };
  const loadImage = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => beginPlaceImage(img);
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  };
  const [clipboardMsg, setClipboardMsg] = useState("");
  const flashClipboardMsg = (message) => { setClipboardMsg(message); setTimeout(() => setClipboardMsg(""), 3000); };
  const copyCanvas = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      if (!navigator.clipboard?.write || typeof window.ClipboardItem === "undefined") throw new Error("unsupported");
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("blob");
      await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
      flashClipboardMsg("Dibujo copiado al portapapeles.");
    } catch {
      flashClipboardMsg("No se pudo copiar: tu navegador no lo permite.");
    }
  };
  const pasteImageFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const img = new Image(); img.onload = () => beginPlaceImage(img); img.src = String(reader.result || ""); };
    reader.readAsDataURL(file);
  };
  const pasteFromClipboard = async () => {
    try {
      if (!navigator.clipboard?.read) throw new Error("unsupported");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        pasteImageFile(await item.getType(type));
        return;
      }
      flashClipboardMsg("El portapapeles no tiene una imagen.");
    } catch {
      flashClipboardMsg("No se pudo pegar: revisá los permisos del portapapeles.");
    }
  };
  useEffect(() => {
    const onPaste = (event) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const items = event.clipboardData?.items;
      if (!items) return;
      const imageItem = Array.from(items).find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;
      event.preventDefault();
      pasteImageFile(imageItem.getAsFile());
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);
  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Si queda una imagen sin fijar (el usuario la arrastró pero no tocó "Listo"), se estampa
    // automáticamente antes de exportar para no perderla silenciosamente al guardar.
    if (placedImage) {
      const placement = placedImage;
      const img = new Image();
      img.onload = () => {
        ensureResolutionFor({ width: placement.naturalW, height: placement.naturalH });
        canvas.getContext("2d").drawImage(img, placement.x, placement.y, placement.w, placement.h);
        setPlacedImage(null);
        onSave(canvas.toDataURL("image/png"), { title, projectId });
      };
      img.src = placement.src;
      return;
    }
    onSave(canvas.toDataURL("image/png"), { title, projectId });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><button onClick={onCancel} aria-label="Volver" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button><h2 className="text-lg font-semibold text-slate-900">{note.id ? "Editar dibujo" : "Nuevo dibujo"}</h2></div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <L label="Título"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Croquis tablero sala 2" className="u-input" /></L>
        <L label="Proyecto (opcional)" help="Vinculalo a un proyecto si surge de un relevamiento previo a su elaboración, aprobación o ejecución."><select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="u-input"><option value="">Sin vincular</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}</select></L>
      </div>
      <div ref={boardRef} className="motion-card overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          <div className="flex items-center gap-2">
            {WHITEBOARD_COLORS.map((c) => (
              <button key={c} onClick={() => { setColor(c); setTool("draw"); }} aria-label={`Color ${c}`} aria-pressed={tool === "draw" && color === c}
                className={`h-11 w-11 shrink-0 rounded-full border-2 transition ${tool === "draw" && color === c ? "border-brand-500 ring-2 ring-brand-500/30" : "border-slate-200"}`}
                style={{ background: c }} />
            ))}
          </div>
          <div className="h-9 w-px shrink-0 bg-slate-200" />
          <div className="flex items-center gap-1.5">
            {WHITEBOARD_WIDTHS.map((w) => (
              <button key={w.value} onClick={() => { setWidth(w.value); setTool("draw"); }} aria-pressed={tool === "draw" && width === w.value} title={w.label} aria-label={w.label}
                className={`grid h-11 w-14 shrink-0 place-items-center rounded-lg border-2 ${tool === "draw" && width === w.value ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
                <span className="rounded-full bg-slate-700" style={{ width: Math.min(w.value, 20), height: Math.min(w.value, 20) }} />
              </button>
            ))}
          </div>
          <div className="h-9 w-px shrink-0 bg-slate-200" />
          <button onClick={undo} disabled={!historyRef.current.length} title="Deshacer (Ctrl+Z)" aria-label="Deshacer" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
            <Undo2 className="h-5 w-5" />
          </button>
          <button onClick={redo} disabled={!redoRef.current.length} title="Rehacer (Ctrl+Shift+Z)" aria-label="Rehacer" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
            <Redo2 className="h-5 w-5" />
          </button>
          <div className="h-9 w-px shrink-0 bg-slate-200" />
          <button onClick={copyCanvas} title="Copiar dibujo (Ctrl+C)" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <Copy className="h-5 w-5" /> Copiar
          </button>
          <button onClick={pasteFromClipboard} title="Pegar imagen (Ctrl+V)" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <ClipboardPaste className="h-5 w-5" /> Pegar
          </button>
          <div className="h-9 w-px shrink-0 bg-slate-200" />
          <button onClick={() => setTool("erase")} aria-pressed={tool === "erase"} className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border-2 px-3.5 text-sm font-medium ${tool === "erase" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`}>
            <Eraser className="h-5 w-5" /> Borrador
          </button>
          <button onClick={() => setConfirmClear(true)} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border-2 border-rose-200 bg-white px-3.5 text-sm font-medium text-rose-600 hover:bg-rose-50">
            <Trash2 className="h-5 w-5" /> Borrar todo
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <Upload className="h-5 w-5" /> Cargar imagen
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { loadImage(event.target.files?.[0]); event.target.value = ""; }} />
          <button onClick={toggleFullscreen} title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"} aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"} className="ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-lg border-2 border-slate-200 text-slate-500 hover:bg-slate-50">
            {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </button>
        </div>
        {clipboardMsg && <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">{clipboardMsg}</div>}
        <div ref={canvasWrapRef} className={`relative w-full bg-white ${isFullscreen ? "h-[calc(100vh-4.5rem)]" : "h-[calc(100vh-20rem)] min-h-[380px]"}`}>
          <canvas ref={canvasRef}
            onPointerDown={startDraw} onPointerMove={draw} onPointerUp={endDraw} onPointerLeave={endDraw} onPointerCancel={endDraw}
            className="absolute inset-0 h-full w-full touch-none" />
          {placedImage && (
            <div className="absolute inset-0 z-20 touch-none">
              <img src={placedImage.src} alt="" draggable={false}
                onPointerDown={startDragImage} onPointerMove={dragImage} onPointerUp={endDragImage} onPointerCancel={endDragImage}
                style={{ position: "absolute", left: placedImage.x, top: placedImage.y, width: placedImage.w, height: placedImage.h, touchAction: "none", cursor: "grab" }}
                className="rounded-sm shadow-lg ring-2 ring-brand-500" />
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-slate-900/90 p-1.5 shadow-lg">
                <span className="hidden px-1.5 text-[11px] text-white/70 sm:inline">Arrastrá la imagen para ubicarla</span>
                <button onClick={cancelPlacedImage} className="rounded-md px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10">Cancelar</button>
                <button onClick={confirmPlacedImage} className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-400">Listo, fijar imagen</button>
              </div>
            </div>
          )}
        </div>
        {/* El diálogo de confirmación va DENTRO de boardRef: es el elemento que entra en pantalla
            completa, y la API de Fullscreen solo pinta su propio subárbol — si el diálogo quedara
            afuera, se montaría pero sería invisible mientras el lienzo está maximizado. */}
        {confirmClear && <ConfirmDialog title="Borrar todo el dibujo" message="Se va a borrar todo el dibujo actual. Esta acción no se puede deshacer." confirmLabel="Borrar todo" danger onClose={() => setConfirmClear(false)} onConfirm={clearBoard} />}
      </div>
      <div className="grid grid-cols-2 gap-2"><button onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={saving} onClick={handleSave} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar dibujo</button></div>
    </div>
  );
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
  return <div className="space-y-5">
    <div><h2 className="text-lg font-semibold text-slate-900">Configuración</h2><p className="text-xs text-slate-500">Identidad visual y tema general de la aplicación.</p></div>
    <Box className="overflow-hidden border-2 border-brand-100">
      <div className="border-b border-slate-100 bg-brand-50/40 p-4"><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-brand-600" /><div><h3 className="text-sm font-semibold text-slate-900">Datos de la empresa</h3><p className="text-[11px] text-slate-500">Nombre, subtítulo y datos fiscales — se usan en toda la app y en la validación de comprobantes.</p></div></div></div>
      <div className="space-y-5 p-4">
        <section><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><L label="Empresa" required><input value={form.companyName} maxLength={80} onChange={(event) => set("companyName", event.target.value)} className="u-input" /></L><L label="Nombre de la aplicación" required><input value={form.appName} maxLength={40} onChange={(event) => set("appName", event.target.value)} className="u-input" /></L><div className="sm:col-span-2"><L label="Subtítulo"><input value={form.subtitle} maxLength={80} onChange={(event) => set("subtitle", event.target.value)} className="u-input" /></L></div></div></section>
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-3"><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Datos fiscales</h4><p className="mb-2 text-[11px] text-slate-500">Se usan para validar que los comprobantes de gasto cargados con foto/OCR correspondan a esta empresa, y como base para la futura integración de facturación electrónica con ARCA.</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><L label="CUIT de la empresa" help="Se compara contra el CUIT del receptor detectado en el comprobante escaneado."><input value={formatCuit(form.companyCuit)} maxLength={13} placeholder="Ej. 20-35196020-6" onChange={(event) => set("companyCuit", cuitDigits(event.target.value))} className="u-input bg-white" /></L><L label="Razón social" help="Nombre legal tal como figura en las facturas recibidas."><input value={form.companyLegalName} maxLength={120} placeholder="Ej. AUTOMATICA ARG S.R.L." onChange={(event) => set("companyLegalName", event.target.value)} className="u-input bg-white" /></L><L label="Condición frente al IVA" help="Determina el tipo de factura (A/B/C) a emitir en la futura integración con ARCA."><select value={form.companyIvaCondition} onChange={(event) => set("companyIvaCondition", event.target.value)} className="u-input bg-white">{IVA_CONDITIONS.map((condition) => <option key={condition}>{condition}</option>)}</select></L><L label="Domicilio comercial" help="Tal como debe figurar en el encabezado de las facturas emitidas."><input value={form.companyAddress} maxLength={160} placeholder="Ej. Rivadavia 1379 Piso 1 Dpto 3 - Venado Tuerto, Santa Fe" onChange={(event) => set("companyAddress", event.target.value)} className="u-input bg-white" /></L></div></section>
      </div>
    </Box>
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
      <Box className="overflow-hidden">
        <div className="border-b border-slate-100 p-4"><div className="flex items-center gap-2"><Palette className="h-5 w-5 text-brand-600" /><div><h3 className="text-sm font-semibold text-slate-900">Marca y apariencia</h3><p className="text-[11px] text-slate-500">Los cambios se aplican a todos los usuarios y dispositivos.</p></div></div></div>
        <div className="space-y-5 p-4">
          <section><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Logo</h4><div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center"><div className="grid min-h-20 w-full place-items-center rounded-lg p-3 sm:w-56" style={{ background: form.headerColor }}><img src={form.logoDataUrl || LOGO_LIGHT} alt="Vista previa del logo" className="max-h-12 max-w-full object-contain" /></div><div className="flex-1"><div className="flex flex-wrap gap-2"><label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white"><Upload className="h-4 w-4" /> Cargar logo<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { selectLogo(event.target.files?.[0]); event.target.value = ""; }} /></label>{form.logoDataUrl && <button onClick={() => set("logoDataUrl", "")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">Usar logo original</button>}</div><p className="mt-2 text-[11px] text-slate-500">PNG transparente recomendado. Máximo 1,5 MB. También admite JPG y WebP.</p>{logoError && <p className="mt-1 text-xs font-medium text-rose-600">{logoError}</p>}</div></div></section>
          <section><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Tema</h4><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{BRAND_THEMES.map((theme) => { const active = form.theme === theme.id && form.primaryColor.toUpperCase() === theme.primaryColor; return <button key={theme.id} onClick={() => chooseTheme(theme)} aria-pressed={active} className={`rounded-xl border p-2.5 text-left ${active ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/15" : "border-slate-200 bg-white"}`}><span className="mb-2 flex gap-1"><i className="h-5 flex-1 rounded" style={{ background: theme.primaryColor }} /><i className="h-5 flex-1 rounded" style={{ background: theme.headerColor }} /></span><span className="block truncate text-[11px] font-semibold text-slate-700">{theme.name}</span></button>; })}</div><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"><L label="Color principal"><div className="flex gap-2"><input type="color" value={form.primaryColor} onChange={(event) => setForm((current) => ({ ...current, theme: "personalizado", primaryColor: event.target.value.toUpperCase() }))} className="h-10 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1" /><input value={form.primaryColor} readOnly className="u-input font-mono uppercase" /></div></L><L label="Color de cabecera"><div className="flex gap-2"><input type="color" value={form.headerColor} onChange={(event) => setForm((current) => ({ ...current, theme: "personalizado", headerColor: event.target.value.toUpperCase() }))} className="h-10 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1" /><input value={form.headerColor} readOnly className="u-input font-mono uppercase" /></div></L></div></section>
        </div>
      </Box>
      <Box className="self-start overflow-hidden">
        <div className="border-b border-slate-100 p-4"><h3 className="text-sm font-semibold text-slate-900">Vista previa</h3><p className="mt-0.5 text-[11px] text-slate-500">Así se verá la identidad general de la aplicación.</p></div>
        <div className="p-4"><div className="overflow-hidden rounded-xl border border-slate-200"><div className="flex items-center gap-2 p-3 text-white" style={{ background: form.headerColor }}><img src={form.logoDataUrl || LOGO_LIGHT} alt="Logo" className="h-7 max-w-28 object-contain" /><div className="border-l border-white/15 pl-2"><b className="block text-xs">{form.appName || "Aplicación"}</b><span className="block text-[9px] text-white/65">{form.subtitle || "Subtítulo"}</span></div></div><div className="bg-slate-50 p-3"><div className="rounded-lg border border-slate-200 bg-white p-3"><span className="text-[10px] text-slate-400">Acción principal</span><button className="mt-2 block rounded-lg px-3 py-2 text-xs font-semibold text-white" style={{ background: form.primaryColor }}>Crear registro</button></div></div></div></div>
      </Box>
    </div>
    <Box className="overflow-hidden">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2"><EyeOff className="mt-0.5 h-5 w-5 text-brand-600" /><div><h3 className="text-sm font-semibold text-slate-900">Ocultar módulos de Administración</h3><p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">Oculta <b>Presupuestos</b>, <b>Compras</b> y <b>Finanzas</b> de la navegación, y reemplaza por <b>***</b> los montos en USD que se muestran en el resto de la app (Panel, Órdenes, Mi día, etc.) para todos los usuarios (incluido vos). Útil para mostrar la aplicación a un cliente sin exponer datos comerciales sensibles. Volvé a activarlo cuando quieras recuperar el acceso.</p></div></div>
        <button type="button" role="switch" aria-checked={form.hideAdminModules} onClick={() => set("hideAdminModules", !form.hideAdminModules)} className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${form.hideAdminModules ? "bg-brand-500" : "bg-slate-200"}`}><span className={`h-5 w-5 transform rounded-full bg-white shadow transition-transform ${form.hideAdminModules ? "translate-x-6" : "translate-x-1"}`} /></button>
      </div>
    </Box>
    <Box className="overflow-hidden">
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2"><Maximize2 className="mt-0.5 h-5 w-5 text-brand-600" /><div><h3 className="text-sm font-semibold text-slate-900">Pantallas de oficina · TV</h3><p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">Cada televisor tiene su propia cuenta con rol <b>Monitor de oficina</b> y su propia configuración (nombre de pantalla, modo TV y rotación) — así podés tener varias pantallas en distintas ubicaciones, cada una mostrando lo que corresponda. Configurala desde <b>Equipo</b>, en la cuenta de cada pantalla.</p></div></div><span className="w-fit rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-700">Sólo administradores</span></div>
    </Box>
    <div className="flex flex-col-reverse gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:justify-end"><button onClick={() => setForm(DEFAULT_BRANDING)} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600">Restaurar valores originales</button><button disabled={saving || !form.appName.trim() || !form.companyName.trim()} onClick={save} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar configuración</button></div>
  </div>;
}

function Team({ users, tasks, orders, projects = [], me, onAdd, onPatch, onRemove, onSaveUserProjects, onErr }) {
  const [nf, setNf] = useState({ name: "", role: "tecnico", email: "", password: "", screenName: "" });
  const [passwordUser, setPasswordUser] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [tvScreenUser, setTvScreenUser] = useState(null);
  const [userProjectsFor, setUserProjectsFor] = useState(null);
  const add = async () => { if (!nf.name.trim() || !nf.email.trim() || nf.password.length < 8) return; try { await onAdd({ ...nf }); setNf({ name: "", role: "tecnico", email: "", password: "", screenName: "" }); } catch (e) { onErr(e); } };
  const wrap = (fn) => async (...a) => { try { await fn(...a); } catch (e) { onErr(e); } };
  return <>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2"><Panel title={`Empleados (${users.length}) · directorio compartido`}>
        <div className="space-y-2">{users.map((u) => { const isViewer = u.role === "monitor_oficina"; const load = tasks.filter((t) => t.assignee === u.id && t.status !== "Hecho").length; const ords = orders.filter((o) => o.tech === u.name).length; return (
          <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3">
            <Avatar user={u} size={38} />
            <div className="min-w-0 flex-1"><div className="break-words text-sm font-semibold text-slate-800">{u.name}{u.id === me.id && <span className="ml-1 text-[11px] text-slate-400">(tú)</span>}{isViewer && u.settings?.screenName && <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">{u.settings.screenName}</span>}</div><div className="break-all text-xs text-slate-500">{u.email}{isViewer ? ` · Solo visualización${u.settings?.tvModeEnabled ? " · Modo TV activo" : ""}` : ` · ${load} tarea(s) · ${ords} orden(es)`}{u.role === "tecnico_oficina" && ` · ${projects.filter((p) => (p.allowedUsers || []).includes(u.id)).length} proyecto(s)`}</div></div>
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-slate-100 pt-2 sm:w-auto sm:border-0 sm:pt-0">
              <select title="Define los módulos, datos y acciones que puede utilizar este usuario." value={u.role} onChange={(e) => wrap(onPatch)(u.id, { role: e.target.value })} disabled={u.id === me.id} className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs disabled:opacity-60 sm:flex-none">{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button onClick={() => wrap(onPatch)(u.id, { active: !u.active })} disabled={u.id === me.id} className={`min-h-9 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40 ${u.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{u.active ? "Activo" : "Inactivo"}</button>
              {isViewer && <button onClick={() => setTvScreenUser(u)} title="Configurar pantalla TV" aria-label={`Configurar pantalla TV de ${u.name}`} className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-brand-50 hover:text-brand-600"><Maximize2 className="h-4 w-4" /></button>}
              {u.role === "tecnico_oficina" && <button onClick={() => setUserProjectsFor(u)} title="Asociar a proyectos" aria-label={`Asociar proyectos a ${u.name}`} className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-brand-50 hover:text-brand-600"><Folder className="h-4 w-4" /></button>}
              <button onClick={() => setPasswordUser(u)} title="Restablecer contraseña" aria-label={`Restablecer contraseña de ${u.name}`} className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-brand-50 hover:text-brand-600"><KeyRound className="h-4 w-4" /></button>
              <button onClick={() => setPendingDelete(u)} disabled={u.id === me.id} title="Eliminar empleado" aria-label="Eliminar empleado" className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ); })}</div>
      </Panel></div>
      <div><Panel title="Nuevo empleado">
        <div className="space-y-2"><L label="Nombre"><input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="Nombre y apellido" className="u-input" /></L><L label="Correo"><input type="email" value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} placeholder="correo@empresa.com" className="u-input" /></L><L label="Contraseña inicial"><input type="password" autoComplete="new-password" value={nf.password} onChange={(e) => setNf({ ...nf, password: e.target.value })} placeholder="Mínimo 8 caracteres" className="u-input" /></L><L label="Rol" help="Administrador: acceso total. Gerencia: gestión operativa y financiera. Técnico de campo: órdenes y tareas asignadas. Técnico de oficina: proyectos sin órdenes. Monitor: solo visualización."><select value={nf.role} onChange={(e) => setNf({ ...nf, role: e.target.value })} className="u-input">{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></L>{nf.role === "monitor_oficina" && <L label="Nombre de la pantalla" help="Identifica esta cuenta cuando tengas varios televisores (ej. 'TV Recepción', 'TV Taller Norte')."><input value={nf.screenName} onChange={(e) => setNf({ ...nf, screenName: e.target.value })} placeholder="Ej. TV Recepción" className="u-input" /></L>}<button onClick={add} disabled={!nf.name.trim() || !nf.email.trim() || nf.password.length < 8} className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"><UserPlus className="h-4 w-4" /> Crear perfil</button><p className="text-[11px] text-slate-400">La contraseña inicial es temporal y deberá cambiarse al ingresar. Los monitores son perfiles de solo visualización: no reciben tareas ni órdenes y no aparecen en métricas de carga.</p></div>
      </Panel></div>
    </div>
    {passwordUser && <PasswordResetDialog user={passwordUser} onClose={() => setPasswordUser(null)} onSave={async (password) => { await wrap(onPatch)(passwordUser.id, { password }); setPasswordUser(null); }} />}
    {pendingDelete && <ConfirmDialog title="Eliminar empleado" message={`Se eliminará el acceso de “${pendingDelete.name}”. Sus órdenes y tareas históricas no se borrarán.`} confirmLabel="Eliminar" danger onClose={() => setPendingDelete(null)} onConfirm={async () => { await wrap(onRemove)(pendingDelete.id); setPendingDelete(null); }} />}
    {tvScreenUser && <TvScreenDialog user={tvScreenUser} onClose={() => setTvScreenUser(null)} onSave={async (patch) => { await wrap(onPatch)(tvScreenUser.id, patch); setTvScreenUser(null); }} />}
    {userProjectsFor && <UserProjectsDialog user={userProjectsFor} projects={projects} onClose={() => setUserProjectsFor(null)} onSave={async (ids) => { await wrap(onSaveUserProjects)(userProjectsFor.id, ids); setUserProjectsFor(null); }} />}
  </>;
}

function UserProjectsDialog({ user, projects, onClose, onSave }) {
  useDialogOpenClass();
  const [sel, setSel] = useState(new Set(projects.filter((p) => (p.allowedUsers || []).includes(user.id)).map((p) => p.id)));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const mouseDownOnBackdrop = useRef(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between"><h3 className="text-base font-semibold text-slate-900">Proyectos asociados</h3><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <p className="mb-3 text-sm text-slate-500">{user.name}. Marcá los proyectos a los que este técnico de oficina tiene acceso.</p>
        <div className="space-y-1.5">
          {projects.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">No hay proyectos cargados.</div>}
          {projects.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50">
              <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4" />
              <div className="min-w-0 flex-1"><div className="text-sm font-medium text-slate-800"><span className="font-mono text-xs" style={{ color: p.color }}>{p.key}</span> {p.name}</div></div>
            </label>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={() => onSave([...sel])} className="flex-1 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400">Guardar</button>
        </div>
      </div>
    </div>
  );
}

function TvScreenDialog({ user, onClose, onSave }) {
  useDialogOpenClass();
  const s = user.settings || {};
  const [form, setForm] = useState({ screenName: s.screenName || "", tvModeEnabled: s.tvModeEnabled || false, tvCycleEnabled: s.tvCycleEnabled || false, tvCycleSeconds: s.tvCycleSeconds || 30 });
  const [saving, setSaving] = useState(false);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async () => { setSaving(true); try { await onSave(form); } finally { setSaving(false); } };
  const mouseDownOnBackdrop = useRef(false);
  return <div className="motion-backdrop fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}>
    <div className="mobile-dialog mobile-sheet-content w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="mb-4 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600"><Maximize2 className="h-5 w-5" /></span><div><h2 className="text-lg font-semibold text-slate-900">Configurar pantalla TV</h2><p className="text-xs text-slate-500">{user.name} · {user.email}</p></div></div>
      <div className="space-y-3">
        <L label="Nombre de la pantalla" help="Identifica esta cuenta cuando tengas varios televisores (ej. 'TV Recepción', 'TV Taller Norte')."><input autoFocus value={form.screenName} onChange={(e) => set("screenName", e.target.value)} placeholder="Ej. TV Recepción" className="u-input" /></L>
        <label className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${form.tvModeEnabled ? "border-brand-300 bg-brand-50/60" : "cursor-pointer border-slate-200"}`}><input type="checkbox" checked={form.tvModeEnabled} onChange={(e) => setForm((current) => ({ ...current, tvModeEnabled: e.target.checked, tvCycleEnabled: e.target.checked ? current.tvCycleEnabled : false }))} className="mt-0.5 h-4 w-4" /><span><b className="block text-sm text-slate-800">Activar modo TV</b><span className="mt-1 block text-[11px] leading-4 text-slate-500">Optimiza automáticamente el tablero para esta pantalla 16:9.</span></span></label>
        <label className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${form.tvModeEnabled ? "cursor-pointer border-slate-200" : "border-slate-100 bg-slate-50 opacity-60"}`}><input type="checkbox" disabled={!form.tvModeEnabled} checked={form.tvCycleEnabled} onChange={(e) => set("tvCycleEnabled", e.target.checked)} className="mt-0.5 h-4 w-4" /><span><b className="block text-sm text-slate-800">Rotación automática</b><span className="mt-1 block text-[11px] leading-4 text-slate-500">Cambia entre los proyectos sin intervención del usuario.</span></span></label>
        <L label="Tiempo visible por proyecto"><select disabled={!form.tvModeEnabled || !form.tvCycleEnabled} value={form.tvCycleSeconds} onChange={(e) => set("tvCycleSeconds", Number(e.target.value))} className="u-input disabled:bg-slate-100 disabled:text-slate-400">{[15, 30, 45, 60, 120].map((seconds) => <option key={seconds} value={seconds}>{seconds < 60 ? `${seconds} segundos` : `${seconds / 60} minuto${seconds > 60 ? "s" : ""}`}</option>)}</select></L>
        <p className="rounded-lg bg-sky-50 px-3 py-2.5 text-[11px] leading-4 text-sky-700">Esta configuración solo afecta a la cuenta <b>{user.name}</b>. Cada televisor con su propia cuenta puede tener ajustes distintos.</p>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} disabled={saving} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={saving} onClick={submit} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</button></div>
    </div>
  </div>;
}

function PasswordResetDialog({ user, onClose, onSave }) {
  useDialogOpenClass();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = password.length >= 8 && password === confirm;
  const generate = () => { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#"; const values = crypto.getRandomValues(new Uint32Array(12)); const next = Array.from(values, (value) => alphabet[value % alphabet.length]).join(""); setPassword(next); setConfirm(next); setShow(true); };
  const submit = async () => { if (!valid || busy) return; setBusy(true); try { await onSave(password); } finally { setBusy(false); } };
  const mouseDownOnBackdrop = useRef(false);
  return <div className="motion-backdrop fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onMouseDown={(event) => { mouseDownOnBackdrop.current = event.target === event.currentTarget; }} onClick={(event) => { if (mouseDownOnBackdrop.current && event.target === event.currentTarget) onClose(); }}><div className="mobile-dialog mobile-sheet-content w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}><div className="mb-4 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600"><KeyRound className="h-5 w-5" /></span><div><h2 className="text-lg font-semibold text-slate-900">Restablecer contraseña</h2><p className="text-xs text-slate-500">{user.name} deberá cambiarla al ingresar.</p></div></div><div className="space-y-3"><button onClick={generate} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-brand-300 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700"><KeyRound className="h-3.5 w-3.5" /> Generar contraseña temporal segura</button><L label="Contraseña temporal"><input autoFocus type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="u-input" /></L><L label="Repetir contraseña"><input type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="u-input" /></L><label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} /> Mostrar contraseña temporal</label>{confirm && password !== confirm && <p className="text-xs text-rose-600">Las contraseñas no coinciden.</p>}<p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">Comunícala por un canal seguro. No se podrá volver a consultar después de guardar.</p></div><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600">Cancelar</button><button disabled={!valid || busy} onClick={submit} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Restablecer</button></div></div></div>;
}
