import express from "express";
import "express-async-errors";
import cors from "cors";
import pkg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import { registerGanttRoutes } from "./ganttRoutes.js";
import { billableHoursValue, normalizedRateValue, wholeMoneyValue } from "./domainRules.js";

const { Pool } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PRODUCTION = process.env.NODE_ENV === "production";
if (IS_PRODUCTION && String(process.env.JWT_SECRET || "").length < 32) throw new Error("JWT_SECRET seguro (mínimo 32 caracteres) es obligatorio en producción");
if (IS_PRODUCTION && !process.env.DATABASE_URL) throw new Error("DATABASE_URL es obligatorio en producción");
const JWT_SECRET = process.env.JWT_SECRET || "cambia-esto-en-produccion";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const allowedOrigins = String(process.env.CORS_ORIGIN || "").split(",").map((value) => value.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origen no permitido"));
  },
} : { origin: false }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), microphone=(self)");
  // worker-src 'self' blob:: Tesseract.js y pdf.js instancian su Web Worker desde un blob: URL.
  // Sin worker-src explícito, el navegador usa script-src como fallback (no incluye blob:) y
  // bloqueaba la creación del worker.
  // cdn.jsdelivr.net en script-src: Tesseract.js v5 NO trae su worker empaquetado localmente —
  // ese worker hace "importScripts()" contra cdn.jsdelivr.net/npm/tesseract.js@.../worker.min.js
  // en tiempo de ejecución, y también descarga desde ahí el modelo de idioma (.traineddata) y el
  // core .wasm. tessdata.projectnaptha.com queda como respaldo por si alguna ruta interna todavía
  // lo usa (era el CDN por defecto en versiones anteriores de la librería).
  // 'wasm-unsafe-eval' en script-src: instanciar un módulo WebAssembly (el motor de OCR de
  // Tesseract) cuenta como "eval" para CSP; esta keyword lo habilita sin abrir eval() de JS común.
  // "data:" en connect-src: Tesseract carga el binario .wasm como un data: URI internamente.
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: https://cdn.jsdelivr.net https://tessdata.projectnaptha.com");
  next();
});
app.use(express.json({ limit: "24mb" }));
app.use((req, res, next) => {
  const requestId = String(req.headers["x-request-id"] || crypto.randomUUID());
  const started = process.hrtime.bigint(); req.requestId = requestId; res.setHeader("X-Request-Id", requestId);
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    if (res.statusCode >= 400 || durationMs >= 1000) console.log(JSON.stringify({ level: res.statusCode >= 500 ? "error" : "warn", event: "http_request", requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(durationMs) }));
  });
  next();
});

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const DEFAULT_BRANDING = {
  appName: "OrdenGO",
  subtitle: "Campo + Proyectos",
  companyName: "AUTOMATICA ARG",
  theme: "automatica",
  primaryColor: "#F18700",
  headerColor: "#2E2E2D",
  logoDataUrl: "",
  tvModeEnabled: false,
  tvCycleEnabled: false,
  tvCycleSeconds: 30,
  hideAdminModules: false,
  companyCuit: "",
  companyLegalName: "",
  companyIvaCondition: "IVA Responsable Inscripto",
  companyAddress: "",
};
const validHexColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || ""));
const digitsOnly = (value) => String(value || "").replace(/\D/g, "");
const normalizeBranding = (value = {}) => ({
  ...DEFAULT_BRANDING,
  appName: String(value.appName || DEFAULT_BRANDING.appName).trim().slice(0, 40),
  subtitle: String(value.subtitle || DEFAULT_BRANDING.subtitle).trim().slice(0, 80),
  companyName: String(value.companyName || DEFAULT_BRANDING.companyName).trim().slice(0, 80),
  companyCuit: digitsOnly(value.companyCuit).slice(0, 11),
  companyLegalName: String(value.companyLegalName || "").trim().slice(0, 120),
  companyIvaCondition: IVA_CONDITIONS.includes(value.companyIvaCondition) ? value.companyIvaCondition : DEFAULT_BRANDING.companyIvaCondition,
  companyAddress: String(value.companyAddress || "").trim().slice(0, 160),
  theme: String(value.theme || DEFAULT_BRANDING.theme).trim().slice(0, 30),
  primaryColor: validHexColor(value.primaryColor) ? value.primaryColor.toUpperCase() : DEFAULT_BRANDING.primaryColor,
  headerColor: validHexColor(value.headerColor) ? value.headerColor.toUpperCase() : DEFAULT_BRANDING.headerColor,
  logoDataUrl: String(value.logoDataUrl || ""),
  tvModeEnabled: value.tvModeEnabled === true,
  tvCycleEnabled: value.tvModeEnabled === true && value.tvCycleEnabled === true,
  tvCycleSeconds: Math.min(300, Math.max(10, Math.round(Number(value.tvCycleSeconds) || 30))),
  hideAdminModules: value.hideAdminModules === true,
});
async function loadBranding() {
  const row = (await pool.query("SELECT value FROM app_settings WHERE key='branding_v1'")).rows[0];
  return normalizeBranding(row?.value || {});
}
function loginRateLimit(req, res, next) {
  const key = `${req.ip || req.socket.remoteAddress || "unknown"}:${String(req.body?.email || "").trim().toLowerCase()}`;
  const now = Date.now();
  const current = loginAttempts.get(key);
  const entry = !current || now - current.startedAt > LOGIN_WINDOW_MS ? { count: 0, startedAt: now } : current;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) return res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos e inténtalo nuevamente." });
  entry.count += 1;
  loginAttempts.set(key, entry);
  req.loginAttemptKey = key;
  next();
}
setInterval(() => {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  for (const [key, value] of loginAttempts) if (value.startedAt < cutoff) loginAttempts.delete(key);
}, LOGIN_WINDOW_MS).unref();

// Limitador genérico por usuario autenticado (además del de login): evita que una cuenta
// comprometida o un cliente descontrolado agote la base con llamadas repetidas a endpoints caros
// (ej. /api/bootstrap dispara ~15 consultas en paralelo) o golpee rutas de escritura en bucle.
const apiRequestCounts = new Map();
const API_RATE_WINDOW_MS = 60 * 1000;
function apiRateLimit(max) {
  return (req, res, next) => {
    const key = `${req.user?.id || req.ip}:${req.method}:${req.baseUrl}${req.route?.path || req.path}`;
    const now = Date.now();
    const current = apiRequestCounts.get(key);
    const entry = !current || now - current.startedAt > API_RATE_WINDOW_MS ? { count: 0, startedAt: now } : current;
    if (entry.count >= max) return res.status(429).json({ error: "Demasiadas solicitudes. Esperá un momento e intentá nuevamente." });
    entry.count += 1;
    apiRequestCounts.set(key, entry);
    next();
  };
}
setInterval(() => {
  const cutoff = Date.now() - API_RATE_WINDOW_MS;
  for (const [key, value] of apiRequestCounts) if (value.startedAt < cutoff) apiRequestCounts.delete(key);
}, API_RATE_WINDOW_MS).unref();

// Nunca hardcodear una contraseña por defecto en el código fuente (los escáneres de secretos como
// GitGuardian la detectan como una credencial expuesta, y cualquiera que lea el repo la conoce).
// Si no se definió la variable de entorno correspondiente, se genera una al azar en cada arranque
// y se imprime una única vez en el log del servidor — junto con mustchangepassword=true, obliga a
// definir una contraseña real en el primer inicio de sesión.
const randomTempPassword = () => crypto.randomBytes(9).toString("base64url");

/* ------------------------------------------------ DB init + seed ------------------------------------------------ */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id text PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL,
      password_hash text NOT NULL, role text NOT NULL DEFAULT 'tecnico',
      color text DEFAULT '#0ea5e9', active boolean DEFAULT true, created_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS clients ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS projects( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS budgets ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS financial_movements ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS orders  ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS tasks   ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS notifications ( id text PRIMARY KEY, user_id text, text text, link text, read boolean DEFAULT false, created_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS parts ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS suppliers ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS purchase_orders ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS material_lists ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS whiteboard_notes ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS stock_movements (
      id text PRIMARY KEY, part_id text NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
      quantity numeric NOT NULL, balance numeric NOT NULL, movement_type text NOT NULL,
      source_type text, source_id text, note text, user_id text,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS audit_log (
      id text PRIMARY KEY, entity_type text NOT NULL, entity_id text NOT NULL,
      action text NOT NULL, user_id text, user_name text, before_data jsonb,
      after_data jsonb, reason text, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS app_settings ( key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS gantt_tasks ( id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS gantt_tasks_project_idx ON gantt_tasks (project_id);");
  // Baja definitiva del módulo de gestión industrial (activos, contratos/SLA y documentación
  // técnica). Se eliminan las tablas y sus datos por pedido expreso. Las órdenes conservan los
  // campos que habían copiado del contrato (responseSlaHours, minimumBillableHours, assetId): son
  // el respaldo del criterio con el que se facturó cada OT y se siguen respetando para no alterar
  // el histórico. Las órdenes nuevas usan los valores por defecto (SLA 2 h, mínimo 2 h).
  await pool.query("DROP TABLE IF EXISTS technical_documents; DROP TABLE IF EXISTS service_contracts; DROP TABLE IF EXISTS assets;");
  await pool.query("CREATE INDEX IF NOT EXISTS stock_movements_part_date_idx ON stock_movements (part_id, created_at DESC); CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);");
  await pool.query("CREATE INDEX IF NOT EXISTS orders_updated_idx ON orders(updated_at); CREATE INDEX IF NOT EXISTS tasks_updated_idx ON tasks(updated_at); CREATE INDEX IF NOT EXISTS orders_project_idx ON orders((data->>'projectId')); CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks((data->>'project')); CREATE INDEX IF NOT EXISTS budgets_project_idx ON budgets((data->>'projectId')); CREATE INDEX IF NOT EXISTS finances_project_idx ON financial_movements((data->>'projectId'));");
  // Migración idempotente para instalaciones existentes
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS mustchangepassword boolean DEFAULT false;");
  // Config individual por usuario (pantalla TV: nombre, modo TV, rotación) — permite N televisores, uno por cuenta Monitor Oficina.
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb;");
  // Permite revocar sesiones: el JWT lleva el token_version vigente al momento de emitirlo, y
  // "auth" lo compara contra el valor actual en la base. Incrementarlo (al cambiar la contraseña,
  // propia o por un admin) invalida de inmediato cualquier token viejo, aunque todavía no expire.
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;");

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@empresa.com").toLowerCase();
  const adminPasswordProvided = Boolean(process.env.ADMIN_PASSWORD);
  const adminPass = process.env.ADMIN_PASSWORD || randomTempPassword();
  const monitorEmail = (process.env.MONITOR_EMAIL || "monitor.oficina@empresa.com").toLowerCase();
  const monitorPasswordProvided = Boolean(process.env.MONITOR_PASSWORD);
  const monitorPass = process.env.MONITOR_PASSWORD || randomTempPassword();

  if ((await pool.query("SELECT count(*)::int n FROM users")).rows[0].n === 0) {
    if (IS_PRODUCTION && adminPasswordProvided && String(process.env.ADMIN_PASSWORD).length < 8) throw new Error("ADMIN_PASSWORD (mínimo 8 caracteres) es obligatorio para inicializar una instalación productiva");
    await pool.query("INSERT INTO users(id,name,email,password_hash,role,color,mustchangepassword) VALUES($1,$2,$3,$4,$5,$6,$7)",
      ["u1", "Administrador", adminEmail, bcrypt.hashSync(adminPass, 10), "admin", "#6366f1", !adminPasswordProvided]);
    if (adminPasswordProvided) console.log("→ Usuario administrador sembrado:", adminEmail);
    else console.log(`→ Usuario administrador sembrado: ${adminEmail} · contraseña temporal generada (cambiala al ingresar): ${adminPass}`);
  }

  if ((await pool.query("SELECT count(*)::int n FROM clients")).rows[0].n === 0) {
    const clients = [
      { id: "c1", code: "LDV", name: "Lácteos del Valle", site: "Planta Norte, Nave 2" },
      { id: "c2", code: "EMB", name: "Embotelladora Andina", site: "Línea de llenado 3" },
      { id: "c3", code: "CAR", name: "Cárnicos Premium", site: "Sala de máquinas" },
    ];
    for (const c of clients) await pool.query("INSERT INTO clients(id,data) VALUES($1,$2)", [c.id, c]);

    const projects = [
      { id: "p1", key: "AUT", name: "Automatización Planta Andina", color: "#0ea5e9" },
      { id: "p2", key: "SCADA", name: "Migración SCADA", color: "#8b5cf6" },
      { id: "p3", key: "MANT", name: "Mantenimiento Q3", color: "#10b981" },
    ];
    for (const p of projects) await pool.query("INSERT INTO projects(id,data) VALUES($1,$2)", [p.id, p]);

    // Sin "assignee": los únicos usuarios sembrados en una instalación nueva son el administrador
    // (y el Monitor Oficina, sin tareas); asignar a un técnico demo inexistente rompería la tarea.
    const tasks = [
      { id: "AUT-1", project: "p1", title: "Programar PLC de línea de llenado", status: "En progreso", priority: "Alta", type: "Tarea", due: "2026-07-25", desc: "Lógica de arranque/paro y enclavamientos." },
      { id: "AUT-2", project: "p1", title: "Diseñar HMI de operador", status: "Por hacer", priority: "Media", type: "Historia", due: "2026-07-30", desc: "Pantallas de proceso y alarmas." },
      { id: "SCADA-2", project: "p2", title: "Configurar servidor OPC UA", status: "En progreso", priority: "Alta", type: "Tarea", due: "2026-07-28", desc: "Conexión con PLCs Siemens y Rockwell." },
      { id: "MANT-2", project: "p3", title: "Calibrar instrumentos de campo", status: "Por hacer", priority: "Alta", type: "Tarea", due: "2026-07-24", desc: "Presión, temperatura y flujo." },
    ];
    for (const t of tasks) await pool.query("INSERT INTO tasks(id,data) VALUES($1,$2)", [t.id, t]);

    const orders = [
      { id: "OT-2026-014", client: "Embotelladora Andina", site: "Línea de llenado 3", contact: "Ing. Salazar", service: "Mantenimiento correctivo", date: "2026-07-15", equipo: "Variador de frecuencia banda 3", sintoma: "Sobrecorriente intermitente", solucion: "Reemplazo de ventilador de disipador.", category: "Sobrecalentamiento", photos: [], signatureUrl: null, signedBy: "", laborHours: 3.5, technicians: 1, rate: 50, laborBillable: true, materials: [{ name: "Ventilador disipador VFD", qty: 1, price: 1200, billable: true }], status: "Completada", tech: "" },
    ];
    for (const o of orders) await pool.query("INSERT INTO orders(id,data) VALUES($1,$2)", [o.id, o]);
    console.log("→ Datos de demostración sembrados.");
  }

  if ((await pool.query("SELECT count(*)::int n FROM parts")).rows[0].n === 0) {
    const parts = [
      { id: "sp1", name: "Ventilador disipador VFD", unit: "u", price: 1200, cost: 780, stock: 4, minStock: 2 },
      { id: "sp2", name: "Cable de red blindado (m)", unit: "m", price: 350, cost: 210, stock: 120, minStock: 50 },
      { id: "sp3", name: "Sensor inductivo M12", unit: "u", price: 4200, cost: 2600, stock: 1, minStock: 3 },
      { id: "sp4", name: "Fuente 24VDC 5A", unit: "u", price: 9800, cost: 6100, stock: 2, minStock: 1 },
    ];
    for (const p of parts) await pool.query("INSERT INTO parts(id,data) VALUES($1,$2)", [p.id, p]);
  }

  // Alta única del monitor para instalaciones existentes. El marcador evita recrearlo
  // si el administrador decide eliminarlo más adelante.
  const monitorMigration = await pool.query("SELECT 1 FROM app_settings WHERE key='monitor_oficina_v1'");
  if (monitorMigration.rowCount === 0) {
    let monitor = (await pool.query("SELECT * FROM users WHERE email=$1", [monitorEmail])).rows[0];
    if (!monitor) {
      await pool.query("INSERT INTO users(id,name,email,password_hash,role,color,active,mustchangepassword) VALUES($1,$2,$3,$4,$5,$6,true,true)",
        ["u-monitor-oficina", "Monitor Oficina", monitorEmail, bcrypt.hashSync(monitorPass, 10), "monitor_oficina", "#14b8a6"]);
      monitor = (await pool.query("SELECT * FROM users WHERE email=$1", [monitorEmail])).rows[0];
      if (!monitorPasswordProvided) console.log(`→ Usuario Monitor Oficina: contraseña temporal generada (cambiala al ingresar): ${monitorPass}`);
    }
    const projectRows = await pool.query("SELECT id,data FROM projects");
    for (const row of projectRows.rows) {
      const allowedUsers = Array.isArray(row.data.allowedUsers) ? row.data.allowedUsers : [];
      if (!allowedUsers.includes(monitor.id)) {
        await pool.query("UPDATE projects SET data=$2, updated_at=now() WHERE id=$1", [row.id, { ...row.data, allowedUsers: [...allowedUsers, monitor.id] }]);
      }
    }
    await pool.query("INSERT INTO app_settings(key,value) VALUES('monitor_oficina_v1',$1)", [{ userId: monitor.id, email: monitorEmail }]);
    console.log("→ Usuario Monitor Oficina creado con acceso a los proyectos existentes.");
  }

  // Corrige únicamente el valor predeterminado histórico; conserva tarifas personalizadas.
  const usdRateMigration = await pool.query("SELECT 1 FROM app_settings WHERE key='default_rate_usd_50_v1'");
  if (usdRateMigration.rowCount === 0) {
    const orderRows = await pool.query("SELECT id,data FROM orders");
    for (const row of orderRows.rows) {
      const currentRate = Number(row.data.rate);
      if (!row.data.rate || currentRate === 850) {
        await pool.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [row.id, { ...row.data, rate: 50, currency: "USD" }]);
      } else if (!row.data.currency) {
        await pool.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [row.id, { ...row.data, currency: "USD" }]);
      }
    }
    await pool.query("INSERT INTO app_settings(key,value) VALUES('default_rate_usd_50_v1',$1)", [{ currency: "USD", defaultRate: 50 }]);
  }

  // Repite la corrección para órdenes creadas posteriormente desde borradores antiguos con la tarifa ARS 850.
  const legacyRateMigration = await pool.query("SELECT 1 FROM app_settings WHERE key='legacy_rate_850_to_usd_50_v2'");
  if (legacyRateMigration.rowCount === 0) {
    const orderRows = await pool.query("SELECT id,data FROM orders");
    for (const row of orderRows.rows) {
      if (Number(row.data.rate) === 850) await pool.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [row.id, { ...row.data, rate: 50, currency: "USD" }]);
    }
    await pool.query("INSERT INTO app_settings(key,value) VALUES('legacy_rate_850_to_usd_50_v2',$1)", [{ from: 850, to: 50, currency: "USD" }]);
  }

  // Renombra los folios de OT ya existentes al nuevo formato con código de tipo de servicio
  // (ej. OT-VTU-2026-001 → OT-VTU-AUT-2026-001) y corrige la referencia cruzada conocida (el gasto
  // automático "EXP-ORDER-<id>" que Finanzas genera para órdenes aprobadas/facturadas vinculadas a
  // un proyecto). Es idempotente: solo toca folios con el formato viejo (4 segmentos) y no se repite.
  const orderFolioMigration = await pool.query("SELECT 1 FROM app_settings WHERE key='order_folio_service_code_v1'");
  if (orderFolioMigration.rowCount === 0) {
    const legacyIdPattern = /^OT-([A-Z0-9]+)-(\d{4})-(\d+)$/;
    const orderRows = await pool.query("SELECT id,data FROM orders");
    let renamed = 0;
    for (const row of orderRows.rows) {
      const match = legacyIdPattern.exec(row.id);
      if (!match) continue;
      const [, siteCode, year, seq] = match;
      const typeCode = SERVICE_TYPE_CODES[row.data.service] || "GEN";
      const newId = `OT-${siteCode}-${typeCode}-${year}-${seq}`;
      if (newId === row.id) continue;
      const clash = await pool.query("SELECT 1 FROM orders WHERE id=$1", [newId]);
      if (clash.rowCount > 0) continue; // por seguridad, nunca pisa un folio que ya exista
      await pool.query("UPDATE orders SET id=$1, data=jsonb_set(data,'{id}',to_jsonb($1::text)), updated_at=now() WHERE id=$2", [newId, row.id]);
      const oldExpenseId = `EXP-ORDER-${row.id}`;
      const newExpenseId = `EXP-ORDER-${newId}`;
      const expenseRow = (await pool.query("SELECT data FROM financial_movements WHERE id=$1", [oldExpenseId])).rows[0];
      if (expenseRow) {
        const updatedExpense = { ...expenseRow.data, id: newExpenseId, sourceOrderId: newId };
        await pool.query("UPDATE financial_movements SET id=$1, data=$2, updated_at=now() WHERE id=$3", [newExpenseId, updatedExpense, oldExpenseId]);
      }
      renamed++;
    }
    await pool.query("INSERT INTO app_settings(key,value) VALUES('order_folio_service_code_v1',$1)", [{ renamed }]);
    if (renamed) console.log(`→ ${renamed} folio(s) de OT actualizados con el código de tipo de servicio.`);
  }

  // Ajuste pedido tras revisar el resultado de la migración anterior: se saca el código de tipo de
  // servicio del folio (no convencía), el año pasa a 2 dígitos, y si la orden tiene un presupuesto
  // vinculado se agrega su número como referencia directa. Reconoce cualquier formato previo
  // (con o sin código de tipo, año de 2 o 4 dígitos) para no reiniciar la numeración.
  const orderFolioShortYearMigration = await pool.query("SELECT 1 FROM app_settings WHERE key='order_folio_short_year_v1'");
  if (orderFolioShortYearMigration.rowCount === 0) {
    const idPattern = /^OT-([A-Z0-9]+)-(?:[A-Z]{2,4}-)?(?:20)?(\d{2})-(\d+)$/;
    const orderRows = await pool.query("SELECT id,data FROM orders");
    let renamed = 0;
    for (const row of orderRows.rows) {
      const match = idPattern.exec(row.id);
      if (!match) continue;
      const [, siteCode, year2, seq] = match;
      const budgetSuffix = row.data.budgetId ? String(row.data.quoteNumber || row.data.budgetNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
      const newId = `OT-${siteCode}-${year2}-${seq}${budgetSuffix ? `-${budgetSuffix}` : ""}`;
      if (newId === row.id) continue;
      const clash = await pool.query("SELECT 1 FROM orders WHERE id=$1", [newId]);
      if (clash.rowCount > 0) continue; // por seguridad, nunca pisa un folio que ya exista
      await pool.query("UPDATE orders SET id=$1, data=jsonb_set(data,'{id}',to_jsonb($1::text)), updated_at=now() WHERE id=$2", [newId, row.id]);
      const oldExpenseId = `EXP-ORDER-${row.id}`;
      const newExpenseId = `EXP-ORDER-${newId}`;
      const expenseRow = (await pool.query("SELECT data FROM financial_movements WHERE id=$1", [oldExpenseId])).rows[0];
      if (expenseRow) {
        const updatedExpense = { ...expenseRow.data, id: newExpenseId, sourceOrderId: newId };
        await pool.query("UPDATE financial_movements SET id=$1, data=$2, updated_at=now() WHERE id=$3", [newExpenseId, updatedExpense, oldExpenseId]);
      }
      renamed++;
    }
    await pool.query("INSERT INTO app_settings(key,value) VALUES('order_folio_short_year_v1',$1)", [{ renamed }]);
    if (renamed) console.log(`→ ${renamed} folio(s) de OT actualizados a año corto y referencia de presupuesto.`);
  }

  // Completa órdenes históricas que habían quedado con materiales en cero.
  const materialPriceMigration = await pool.query("SELECT 1 FROM app_settings WHERE key='order_inventory_prices_v1'");
  if (materialPriceMigration.rowCount === 0) {
    const orderRows = await pool.query("SELECT id,data FROM orders");
    for (const row of orderRows.rows) {
      const materials = await materialsFromInventory(row.data.materials, true);
      if (JSON.stringify(materials) !== JSON.stringify(row.data.materials || [])) {
        await pool.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [row.id, { ...row.data, materials }]);
      }
    }
    await pool.query("INSERT INTO app_settings(key,value) VALUES('order_inventory_prices_v1',$1)", [{ source: "parts", currency: "USD" }]);
  }

  const unitQuantityMigration = await pool.query("SELECT 1 FROM app_settings WHERE key='integer_unit_quantities_v1'");
  if (unitQuantityMigration.rowCount === 0) {
    const orderRows = await pool.query("SELECT id,data FROM orders");
    for (const row of orderRows.rows) {
      const materials = await materialsFromInventory(row.data.materials, true);
      if (JSON.stringify(materials) !== JSON.stringify(row.data.materials || [])) {
        await pool.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [row.id, { ...row.data, materials }]);
      }
    }
    await pool.query("INSERT INTO app_settings(key,value) VALUES('integer_unit_quantities_v1',$1)", [{ unit: "u", step: 1 }]);
  }

  const wholeMoneyMigration = await pool.query("SELECT 1 FROM app_settings WHERE key='whole_usd_values_v1'");
  if (wholeMoneyMigration.rowCount === 0) {
    const partRows = await pool.query("SELECT id,data FROM parts");
    for (const row of partRows.rows) {
      const data = { ...row.data, price: wholeMoneyValue(row.data.price), cost: wholeMoneyValue(row.data.cost) };
      await pool.query("UPDATE parts SET data=$2, updated_at=now() WHERE id=$1", [row.id, data]);
    }
    const orderRows = await pool.query("SELECT id,data FROM orders");
    for (const row of orderRows.rows) {
      const data = {
        ...row.data,
        rate: wholeMoneyValue(row.data.rate || 50),
        laborCost: wholeMoneyValue(row.data.laborCost),
        materials: (row.data.materials || []).map((material) => ({ ...material, price: wholeMoneyValue(material.price), cost: wholeMoneyValue(material.cost) })),
      };
      await pool.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [row.id, data]);
    }
    await pool.query("INSERT INTO app_settings(key,value) VALUES('whole_usd_values_v1',$1)", [{ currency: "USD", step: 1 }]);
  }

  const billingPolicyMigration = await pool.query("SELECT 1 FROM app_settings WHERE key='billing_minimum_2h_under_1h_v1'");
  if (billingPolicyMigration.rowCount === 0) {
    const orderRows = await pool.query("SELECT id,data FROM orders");
    for (const row of orderRows.rows) {
      const data = { ...row.data, billableHours: billableHoursValue(row.data) };
      await pool.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [row.id, data]);
    }
    await pool.query("INSERT INTO app_settings(key,value) VALUES('billing_minimum_2h_under_1h_v1',$1)", [{ thresholdHours: 1, minimumHours: 2 }]);
  }

  // Recalcula presupuestos facturados ya existentes con la nueva distinción entre efectivo
  // ingresado y factura cancelada. Es idempotente y permite que cobros anteriores con retenciones
  // aparezcan en el filtro Pagado inmediatamente después de desplegar esta versión.
  const paymentReconcileMigration = await pool.query("SELECT 1 FROM app_settings WHERE key='budget_payment_settlement_v2'");
  if (paymentReconcileMigration.rowCount === 0) {
    const budgetIds = (await pool.query("SELECT id FROM budgets WHERE data->>'stage' IN ('Facturado','Pagado')")).rows.map((row) => row.id);
    await syncBudgetPaymentStatuses(budgetIds, pool, null);
    await pool.query("INSERT INTO app_settings(key,value) VALUES('budget_payment_settlement_v2',$1)", [{ reconciled: budgetIds.length, paymentStates: ["paid", "partial"] }]);
  }
}

/* ------------------------------------------------ Helpers ------------------------------------------------ */
const pubUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, color: u.color, active: u.active, mustChangePassword: u.mustchangepassword || false, settings: u.settings || {} });
// Config de pantalla TV por usuario (Monitor Oficina): permite N televisores, cada uno con su propia cuenta e identidad.
const buildSettingsPatch = (body, current = {}) => {
  const patch = {};
  if (body.screenName !== undefined) patch.screenName = String(body.screenName || "").trim().slice(0, 60);
  if (body.tvModeEnabled !== undefined) patch.tvModeEnabled = Boolean(body.tvModeEnabled);
  if (body.tvCycleEnabled !== undefined) patch.tvCycleEnabled = Boolean(body.tvCycleEnabled);
  if (body.tvCycleSeconds !== undefined) patch.tvCycleSeconds = Math.max(10, Math.round(Number(body.tvCycleSeconds) || 30));
  return Object.keys(patch).length ? { ...current, ...patch } : null;
};
const directoryUser = (u, viewerRole) => viewerRole === "admin" ? pubUser(u) : ({ id: u.id, name: u.name, role: u.role, color: u.color, active: u.active });
const VALID_ROLES = new Set(["admin", "gerente", "tecnico", "tecnico_oficina", "monitor_oficina"]);
const timelineErrorsValue = (technical, now = Date.now()) => {
  const errors = [];
  const points = [["aviso", technical?.reportedAt], ["llegada", technical?.arrivalAt], ["inicio", technical?.startedAt], ["finalización", technical?.completedAt]]
    .filter(([, value]) => value)
    .map(([label, value]) => [label, new Date(value).getTime()]);
  for (let index = 1; index < points.length; index += 1) {
    if (!Number.isFinite(points[index - 1][1]) || !Number.isFinite(points[index][1]) || points[index][1] < points[index - 1][1]) errors.push(`La ${points[index][0]} no puede ser anterior al ${points[index - 1][0]}.`);
  }
  const arrival = technical?.arrivalAt ? new Date(technical.arrivalAt).getTime() : NaN;
  const end = technical?.completedAt ? new Date(technical.completedAt).getTime() : now;
  if (Number.isFinite(arrival) && Number.isFinite(end) && end >= arrival) {
    const onSiteMinutes = Math.max(1, Math.ceil((end - arrival) / 60000));
    const sessions = Array.isArray(technical?.workSessions) ? technical.workSessions : [];
    const effectiveMs = sessions.length ? sessions.reduce((total, session) => {
      const start = new Date(session.start).getTime(); const sessionEnd = new Date(session.end || end).getTime();
      return total + (Number.isFinite(start) && Number.isFinite(sessionEnd) ? Math.max(0, sessionEnd - start) : 0);
    }, 0) : (technical?.startedAt ? Math.max(0, end - new Date(technical.startedAt).getTime()) : 0);
    const effectiveMinutes = Math.ceil(effectiveMs / 60000);
    if (effectiveMinutes > onSiteMinutes) errors.push(`El tiempo efectivo (${effectiveMinutes} min) supera el tiempo total en planta (${onSiteMinutes} min). Revisa los horarios.`);
    const waitMinutes = Number(technical?.billableWaitMinutes) || 0;
    if (waitMinutes > onSiteMinutes) errors.push(`La espera registrada (${waitMinutes} min) supera el tiempo total en planta (${onSiteMinutes} min). Revisa la llegada, la finalización o la espera.`);
  }
  if ((Number(technical?.billableWaitMinutes) || 0) > 0 && !technical?.billableWaitReason?.trim()) errors.push("Debe indicarse el motivo de la espera por condiciones del sitio.");
  return errors;
};
async function notify(userId, text, link) {
  if (!userId) return;
  const id = "n" + Date.now() + Math.floor(Math.random() * 100000);
  try { await pool.query("INSERT INTO notifications(id,user_id,text,link) VALUES($1,$2,$3,$4)", [id, userId, text, link || null]); } catch {}
}

// Envío de correo de notificación de asignación de tareas. Se configura por variables de
// entorno (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS) — nunca hardcodear credenciales acá.
// Si no está configurado, se omite en silencio (no debe romper la asignación de tareas).
let mailTransporter = null;
function getMailTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.office365.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false, // STARTTLS en el puerto 587
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return mailTransporter;
}
async function notifyTaskAssignmentEmail(userId, task, project) {
  if (!userId) return;
  const transporter = getMailTransporter();
  if (!transporter) return;
  try {
    const { rows } = await pool.query("SELECT email, name FROM users WHERE id=$1", [userId]);
    const user = rows[0];
    if (!user?.email) return;
    const projectLabel = project ? `${project.key ? project.key + " · " : ""}${project.name}` : "—";
    const lines = [
      `Hola ${user.name || ""},`.trim(),
      "",
      `Se te asignó una tarea en OrdenGO:`,
      "",
      `Proyecto: ${projectLabel}`,
      `Tarea: ${task.id} — ${task.title}`,
      task.desc ? `Descripción: ${task.desc}` : null,
      task.due ? `Vencimiento: ${task.due}` : null,
      task.priority ? `Prioridad: ${task.priority}` : null,
      "",
      "Ingresá a OrdenGO para ver el detalle completo.",
    ].filter((line) => line !== null).join("\n");
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: `OrdenGO · Nueva tarea asignada: ${task.title}`,
      text: lines,
    });
  } catch (error) { console.error("No se pudo enviar el correo de asignación de tarea:", error.message); }
}
async function notifyProjectAssignmentEmail(userId, project, taskCount) {
  if (!userId) return;
  const transporter = getMailTransporter();
  if (!transporter) return;
  try {
    const { rows } = await pool.query("SELECT email, name FROM users WHERE id=$1", [userId]);
    const user = rows[0];
    if (!user?.email) return;
    const lines = [
      `Hola ${user.name || ""},`.trim(),
      "",
      `Se te asignó el proyecto "${project.name}" en OrdenGO, con ${taskCount} tarea(s).`,
      "",
      "Ingresá a OrdenGO para ver el detalle completo.",
    ].join("\n");
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: `OrdenGO · Nuevo proyecto asignado: ${project.name}`,
      text: lines,
    });
  } catch (error) { console.error("No se pudo enviar el correo de asignación de proyecto:", error.message); }
}
function stripMoney(o) {
  const x = { ...o }; delete x.rate; delete x.laborBillable; delete x.laborCost; delete x.billableHours;
  // El técnico no ve montos ni si la OT fue facturada
  if (x.status === "Facturada") x.status = "Aprobada";
  if (Array.isArray(x.materials)) x.materials = x.materials.map((m) => { const y = { ...m }; delete y.price; delete y.billable; delete y.cost; return y; });
  return x;
}
async function materialsFromInventory(materials, onlyMissing = false) {
  if (!Array.isArray(materials) || materials.length === 0) return [];
  const inventory = (await pool.query("SELECT data FROM parts")).rows.map((row) => row.data);
  return materials.map((material) => {
    const normalizedName = String(material.name || "").trim().toLowerCase();
    const part = inventory.find((item) => (material.partId && item.id === material.partId) || String(item.name || "").trim().toLowerCase() === normalizedName);
    if (!part) return { ...material, price: wholeMoneyValue(material.price), cost: wholeMoneyValue(material.cost) };
    return {
      ...material,
      partId: part.id,
      name: part.name,
      unit: part.unit || material.unit,
      qty: part.unit === "u" ? Math.max(1, Math.round(Number(material.qty) || 1)) : (Number(material.qty) || 0),
      price: onlyMissing && Number(material.price) > 0 ? wholeMoneyValue(material.price) : wholeMoneyValue(part.price),
      cost: onlyMissing && Number(material.cost) > 0 ? wholeMoneyValue(material.cost) : wholeMoneyValue(part.cost),
      partNumber: material.partNumber || part.partNumber || "",
      brand: material.brand || part.brand || "",
      model: material.model || part.model || "",
      supplier: material.supplier || part.supplier || "",
    };
  });
}
// Conciliación automática de stock: antes ni consumir materiales en una orden ni recibir una OC
// tocaban el stock del catálogo — quedaba 100% a cargo de que alguien lo actualizara a mano.
async function adjustPartStock(partId, delta, db = pool, meta = {}) {
  if (!partId || !delta) return;
  // La suma se ejecuta dentro del UPDATE, no como read-modify-write en JavaScript. Así dos
  // recepciones/consumos simultáneos no pisan el saldo calculado por la otra operación.
  const row = (await db.query(
    "UPDATE parts SET data=jsonb_set(data,'{stock}',to_jsonb(GREATEST(0,COALESCE((data->>'stock')::numeric,0)+$2::numeric)),true), updated_at=now() WHERE id=$1 RETURNING data",
    [partId, delta],
  )).rows[0];
  if (!row) return;
  await db.query(
    "INSERT INTO stock_movements(id,part_id,quantity,balance,movement_type,source_type,source_id,note,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [crypto.randomUUID(), partId, delta, Number(row.data.stock) || 0, meta.movementType || (delta > 0 ? "Entrada" : "Salida"), meta.sourceType || "Ajuste", meta.sourceId || "", String(meta.note || "").slice(0, 300), meta.userId || null],
  );
  return row.data;
}

async function auditChange({ entityType, entityId, action, user, beforeData = null, afterData = null, reason = "" }, db = pool) {
  await db.query(
    "INSERT INTO audit_log(id,entity_type,entity_id,action,user_id,user_name,before_data,after_data,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [crypto.randomUUID(), entityType, entityId, action, user?.id || null, user?.name || "Sistema", beforeData, afterData, String(reason || "").slice(0, 500)],
  );
}
// Los ítems de una OC son texto libre del proveedor (sku/descripción), sin vínculo obligatorio al
// catálogo — se intenta emparejar por nombre igual que materialsFromInventory; lo que no matchea
// simplemente no ajusta stock (es una compra que no está en el catálogo de repuestos).
async function matchPartIdByName(name, db = pool) {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return null;
  const row = (await db.query("SELECT id FROM parts WHERE lower(data->>'name')=$1 LIMIT 1", [normalized])).rows[0];
  return row?.id || null;
}
function codeFromName(name) {
  return (String(name || "CLI").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3)) || "CLI";
}
async function uniqueClientCode(base, excludeId) {
  const rows = (await pool.query("SELECT id, data->>'code' AS c FROM clients")).rows;
  const taken = new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.c).filter(Boolean));
  if (!taken.has(base)) return base;
  for (let i = 1; i < 1000; i++) { const cand = (base.slice(0, 2) + i); if (!taken.has(cand)) return cand; }
  return base + Date.now().toString().slice(-3);
}
const IVA_CONDITIONS = ["IVA Responsable Inscripto", "Responsable Monotributo", "IVA Sujeto Exento", "Consumidor Final", "IVA No Responsable", "Sujeto No Categorizado"];
const SALE_CONDITIONS = ["Contado", "Transferencia Bancaria", "Cheque", "eCheq", "Cuenta Corriente", "Tarjeta de Crédito", "Otro"];
function codeFromSupplierName(name) {
  return (String(name || "PRV").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3)) || "PRV";
}
async function uniqueSupplierCode(base, excludeId) {
  const rows = (await pool.query("SELECT id, data->>'code' AS c FROM suppliers")).rows;
  const taken = new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.c).filter(Boolean));
  if (!taken.has(base)) return base;
  for (let i = 1; i < 1000; i++) { const cand = (base.slice(0, 2) + i); if (!taken.has(cand)) return cand; }
  return base + Date.now().toString().slice(-3);
}
async function uniqueProjectKey(base, db = pool) {
  const clean = (String(base || "PRJ").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)) || "PRJ";
  const taken = new Set((await db.query("SELECT upper(data->>'key') AS key FROM projects")).rows.map((row) => row.key).filter(Boolean));
  if (!taken.has(clean)) return clean;
  for (let index = 2; index < 1000; index += 1) {
    const suffix = String(index); const candidate = `${clean.slice(0, 6 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${clean.slice(0, 3)}${Date.now().toString().slice(-3)}`;
}
async function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const cookieToken = String(req.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith("og_session="))?.slice("og_session=".length);
  const t = h.startsWith("Bearer ") ? h.slice(7) : cookieToken ? decodeURIComponent(cookieToken) : null;
  if (!t) return res.status(401).json({ error: "Sin token" });
  try {
    const claims = jwt.verify(t, JWT_SECRET, { algorithms: ["HS256"] });
    const current = (await pool.query("SELECT id,name,role,active,mustchangepassword,token_version FROM users WHERE id=$1", [claims.id])).rows[0];
    if (!current?.active) return res.status(401).json({ error: "La cuenta está inactiva o ya no existe" });
    // Si el token trae un token_version anterior al vigente en la base, ya fue revocado (cambio
    // de contraseña propio o forzado por un admin) — se rechaza aunque todavía no haya expirado.
    if ((claims.tokenVersion || 0) !== (current.token_version || 0)) return res.status(401).json({ error: "La sesión ya no es válida. Iniciá sesión de nuevo." });
    if (current.mustchangepassword && !["/api/bootstrap", "/api/me/password"].includes(req.path)) return res.status(403).json({ error: "Debes cambiar la contraseña temporal antes de continuar" });
    req.user = { id: current.id, name: current.name, role: current.role, mustChangePassword: current.mustchangepassword };
    next();
  } catch { res.status(401).json({ error: "Token inválido" }); }
}
const requireRole = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: "No autorizado" });
registerGanttRoutes(app, pool, { auth, requireRole, tecCanProject });
// Roles "técnicos" (campo u oficina): nunca ven importes ni el estado "Facturada"
const isTec = (r) => r === "tecnico" || r === "tecnico_oficina";
const isMonitor = (r) => r === "monitor_oficina";
const isProjectScoped = (r) => isTec(r) || isMonitor(r);
const requireOrdersAccess = (req, res, next) => (req.user.role === "tecnico_oficina" || isMonitor(req.user.role)) ? res.status(403).json({ error: "Este perfil no tiene acceso a órdenes de trabajo" }) : next();
const requireProjectWrite = (req, res, next) => isMonitor(req.user.role) ? res.status(403).json({ error: "Monitor Oficina tiene acceso de solo visualización" }) : next();
const normName = (name) => String(name || "").trim().toLowerCase();
const orderAssignedNames = (order) => [order?.tech, ...(Array.isArray(order?.assignedTechs) ? order.assignedTechs : [])].map(normName).filter(Boolean);
const orderVisibleToUser = (user, order) => user.role !== "tecnico" || orderAssignedNames(order).includes(normName(user.name));
// Código corto de tipo de servicio que se incorpora al folio de la OT (ej. OT-VTU-COR-2026-014)
// para poder identificar de un vistazo qué clase de trabajo es, sin abrir la orden.
const SERVICE_TYPE_CODES = { "Instalación": "INS", "Automatización": "AUT", "Eléctrico": "ELE", "Mantenimiento preventivo": "PRE", "Mantenimiento correctivo": "COR", "Garantía": "GAR", "Emergencia": "EMG" };
const TECH_ORDER_STATUSES = new Set(["Borrador", "En proceso de ejecución", "Completada", "Suspendida"]);
const ORDER_STATUSES = new Set(["Borrador", "En proceso de ejecución", "Completada", "Aprobada", "Facturada", "Suspendida"]);
const orderBusinessErrors = (order) => {
  const errors = [];
  if (!ORDER_STATUSES.has(order?.status || "Borrador")) errors.push("El estado de la orden no es válido.");
  if (order?.status === "Suspendida" && !String(order?.suspendReason || "").trim()) errors.push("El motivo de la suspensión es obligatorio.");
  if (order?.status !== "Borrador") {
    if (!String(order?.client || "").trim()) errors.push("El cliente es obligatorio.");
    if (!String(order?.site || "").trim()) errors.push("El sitio de intervención es obligatorio.");
    if (!String(order?.tech || "").trim()) errors.push("El técnico responsable es obligatorio.");
    if (!String(order?.equipo || "").trim() && !String(order?.technical?.assetTag || "").trim()) errors.push("El equipo o activo intervenido es obligatorio.");
  }
  if (["Completada", "Aprobada", "Facturada"].includes(order?.status)) {
    if (!order?.technical?.completedAt) errors.push("La finalización debe registrarse desde la cronología.");
    if (!String(order?.solucion || "").trim()) errors.push("La intervención realizada es obligatoria.");
    if (!order?.technicianSignatureUrl) errors.push("La firma del técnico responsable es obligatoria.");
    if (!order?.signatureUrl && !String(order?.noSignReason || "").trim()) errors.push("Registra la conformidad del cliente o el motivo por el que no firma.");
    if (order?.signatureUrl && (!String(order?.signedBy || "").trim() || !String(order?.technical?.signerRole || "").trim())) errors.push("Completa el nombre y el cargo/área de quien firma la conformidad del cliente.");
    if (!String(order?.sintoma || "").trim()) errors.push("El síntoma es obligatorio.");
    if (!String(order?.technical?.diagnosis || "").trim()) errors.push("El diagnóstico es obligatorio.");
    if (!Array.isArray(order?.photos) || order.photos.length === 0) errors.push("Se requiere al menos una foto de evidencia.");
    if (!String(order?.technical?.recommendations || "").trim()) errors.push("La recomendación técnica es obligatoria.");
  }
  return errors;
};
// Reconcilia el costo real de mano de obra + materiales de una OT aprobada con Finanzas,
// para que "Ejecución del presupuesto" refleje costos reales sin carga manual duplicada.
async function upsertOrderCostExpense(order) {
  const id = `EXP-ORDER-${order.id}`;
  if (!order.projectId || !["Aprobada", "Facturada"].includes(order.status)) {
    await pool.query("DELETE FROM financial_movements WHERE id=$1 AND data->>'sourceOrderId' IS NOT NULL", [id]);
    return null;
  }
  const actualHours = (Number(order.laborHours) || 0) + (Math.max(0, Number(order.technical?.billableWaitMinutes) || 0) / 60);
  const laborCost = actualHours * (Number(order.technicians) || 1) * (Number(order.laborCost) || 0);
  const materialsCost = (order.materials || []).reduce((sum, m) => sum + (Number(m.qty) || 0) * (Number(m.cost) || 0), 0);
  const totalCost = Math.round((laborCost + materialsCost) * 100) / 100;
  if (totalCost <= 0) {
    await pool.query("DELETE FROM financial_movements WHERE id=$1 AND data->>'sourceOrderId' IS NOT NULL", [id]);
    return null;
  }
  const project = (await pool.query("SELECT data FROM projects WHERE id=$1", [order.projectId])).rows[0]?.data;
  const existing = (await pool.query("SELECT data FROM financial_movements WHERE id=$1", [id])).rows[0]?.data;
  const movement = {
    ...(existing || {}), id, kind: "expense", category: "Órdenes de trabajo",
    concept: `Costo real de mano de obra y materiales · OT ${order.id}`,
    amount: totalCost, currency: "USD", exchangeRate: 1, amountUsd: totalCost,
    vatIncluded: false, vatRate: 0, netAmountUsd: totalCost, vatAmountUsd: 0, grossAmountUsd: totalCost,
    date: String(order.technical?.completedAt || order.date || "").slice(0, 10),
    projectId: order.projectId, clientId: project?.clientId || "", clientName: order.client || project?.client || "",
    budgetId: project?.budgetId || "", budgetNumber: existing?.budgetNumber || "",
    sourceOrderId: order.id, paymentStatus: "paid", paidAt: String(order.technical?.completedAt || order.date || "").slice(0, 10),
    receiptNumber: order.id, supplier: "",
    detail: `Generado automáticamente al aprobar la orden de trabajo ${order.id}. Se actualiza si cambian horas, costo/h o materiales.`,
    createdAt: existing?.createdAt || new Date().toISOString(), createdBy: existing?.createdBy || "system", createdByName: existing?.createdByName || "Sistema (OT aprobada)",
    updatedAt: new Date().toISOString(),
  };
  await pool.query("INSERT INTO financial_movements(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2, updated_at=now()", [id, movement]);
  return movement;
}
// ¿El usuario (si es técnico) tiene permiso sobre este proyecto?
async function tecCanProject(user, projectId) {
  if (!isProjectScoped(user.role)) return true;
  if (!projectId) return false;
  const { rows } = await pool.query("SELECT data FROM projects WHERE id=$1", [projectId]);
  const p = rows[0]?.data;
  return !!(p && Array.isArray(p.allowedUsers) && p.allowedUsers.includes(user.id));
}
async function assigneeIsAllowed(userId) {
  if (!userId) return true;
  const user = (await pool.query("SELECT role,active FROM users WHERE id=$1", [userId])).rows[0];
  return !!(user && user.active && !isMonitor(user.role));
}
// Al asignar una tarea a un técnico (de campo u oficina), esos roles quedan "scopeados" por
// allowedUsers (ver isProjectScoped) — si todavía no tienen acceso al proyecto de la tarea, se lo
// da automáticamente para que no queden con una tarea asignada a un proyecto que no pueden ver.
async function ensureProjectAccess(userId, projectId) {
  if (!userId || !projectId) return;
  const user = (await pool.query("SELECT role FROM users WHERE id=$1", [userId])).rows[0];
  if (!user || !isTec(user.role)) return;
  const { rows } = await pool.query("SELECT data FROM projects WHERE id=$1", [projectId]);
  const project = rows[0]?.data;
  if (!project) return;
  const allowedUsers = Array.isArray(project.allowedUsers) ? project.allowedUsers : [];
  if (allowedUsers.includes(userId)) return;
  await pool.query("UPDATE projects SET data=$2, updated_at=now() WHERE id=$1", [projectId, { ...project, allowedUsers: [...allowedUsers, userId] }]);
}

/* ------------------------------------------------ Auth ------------------------------------------------ */
app.get("/api/branding", async (_req, res) => {
  try { res.json(await loadBranding()); } catch { res.json(DEFAULT_BRANDING); }
});
app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "ordengo", at: new Date().toISOString() }));
app.get("/api/ready", async (_req, res) => { try { await pool.query("SELECT 1"); res.json({ status: "ready" }); } catch { res.status(503).json({ status: "unavailable" }); } });

app.post("/api/auth/login", loginRateLimit, async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [String(email || "").toLowerCase()]);
  const u = rows[0];
  if (!u || !u.active || !bcrypt.compareSync(password || "", u.password_hash))
    return res.status(401).json({ error: "Correo o contraseña inválidos" });
  loginAttempts.delete(req.loginAttemptKey);
  const token = jwt.sign({ id: u.id, role: u.role, name: u.name, tokenVersion: u.token_version || 0 }, JWT_SECRET, { expiresIn: "7d" });
  res.setHeader("Set-Cookie", `og_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${IS_PRODUCTION ? "; Secure" : ""}`);
  res.json({ authenticated: true, user: pubUser(u) });
});
app.post("/api/auth/logout", (_req, res) => { res.setHeader("Set-Cookie", `og_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${IS_PRODUCTION ? "; Secure" : ""}`); res.status(204).end(); });

/* Cada usuario cambia su propia contraseña */
app.post("/api/me/password", auth, async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 8) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres" });
  const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [req.user.id]);
  const u = rows[0];
  if (!u || !bcrypt.compareSync(current || "", u.password_hash)) return res.status(400).json({ error: "La contraseña actual es incorrecta" });
  // Cambiar la contraseña revoca cualquier otra sesión abierta con la anterior (token_version++);
  // se firma y devuelve un token nuevo para que la sesión actual, la que acaba de hacer el cambio,
  // no quede invalidada también.
  const tokenVersion = (u.token_version || 0) + 1;
  await pool.query("UPDATE users SET password_hash=$2, mustchangepassword=false, token_version=$3 WHERE id=$1", [u.id, bcrypt.hashSync(next, 10), tokenVersion]);
  const token = jwt.sign({ id: u.id, role: u.role, name: u.name, tokenVersion }, JWT_SECRET, { expiresIn: "7d" });
  res.setHeader("Set-Cookie", `og_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${IS_PRODUCTION ? "; Secure" : ""}`);
  res.json({ ok: true, authenticated: true });
});

/* ------------------------------------------------ Bootstrap (carga inicial) ------------------------------------------------ */
app.get("/api/bootstrap", auth, apiRateLimit(30), async (req, res) => {
  const tec = isTec(req.user.role);
  const [me, u, cl, pr, bu, fi, or, ta, no, pa, branding, sup, po, ml, wb] = await Promise.all([
    pool.query("SELECT * FROM users WHERE id=$1", [req.user.id]),
    pool.query("SELECT * FROM users ORDER BY created_at"),
    pool.query("SELECT data FROM clients"),
    pool.query("SELECT data FROM projects"),
    pool.query("SELECT data, updated_at FROM budgets ORDER BY updated_at DESC"),
    pool.query("SELECT data, updated_at FROM financial_movements ORDER BY updated_at DESC"),
    pool.query("SELECT data, updated_at FROM orders ORDER BY updated_at DESC"),
    pool.query("SELECT data, updated_at FROM tasks ORDER BY updated_at DESC"),
    pool.query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [req.user.id]),
    pool.query("SELECT data FROM parts ORDER BY data->>'name'"),
    loadBranding(),
    pool.query("SELECT data FROM suppliers ORDER BY data->>'name'"),
    pool.query("SELECT data, updated_at FROM purchase_orders ORDER BY updated_at DESC"),
    pool.query("SELECT data, updated_at FROM material_lists ORDER BY updated_at DESC"),
    pool.query("SELECT data, updated_at FROM whiteboard_notes ORDER BY updated_at DESC"),
  ]);
  // Aviso de tareas por vencer (próximos 2 días): se genera una sola vez por tarea (id determinístico)
  // y queda en la bandeja de notificaciones —visible en la campana de cualquier pantalla— hasta que
  // el usuario la lea; no se repite en cada carga porque ON CONFLICT la ignora si ya existe.
  const todayKey = new Date().toISOString().slice(0, 10);
  const dueSoonKey = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const dueSoonTasks = ta.rows.map((r) => r.data).filter((t) => t.assignee === req.user.id && t.status !== "Hecho" && t.due && t.due >= todayKey && t.due <= dueSoonKey);
  for (const t of dueSoonTasks) {
    try {
      await pool.query(
        "INSERT INTO notifications(id,user_id,text,link) VALUES($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
        [`due-${t.id}`, req.user.id, `La tarea ${t.id}: ${t.title} vence pronto (${t.due}).`, "task:" + t.id],
      );
    } catch {}
  }
  const notifRows = dueSoonTasks.length
    ? (await pool.query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [req.user.id])).rows
    : no.rows;
  const partOut = (p) => tec ? { id: p.id, name: p.name, unit: p.unit } : p;
  const allProjects = pr.rows.map((r) => r.data);
  // Técnicos y monitores solo ven los proyectos que el administrador les habilitó.
  const scoped = isProjectScoped(req.user.role);
  const canSeeProject = (p) => !scoped || (Array.isArray(p.allowedUsers) && p.allowedUsers.includes(req.user.id));
  const visibleProjects = allProjects.filter(canSeeProject);
  const allowedProjectIds = new Set(visibleProjects.map((p) => p.id));
  res.json({
    me: pubUser(me.rows[0]),
    users: u.rows.map((user) => directoryUser(user, req.user.role)),
    clients: cl.rows.map((r) => r.data),
    projects: visibleProjects,
    budgets: tec || isMonitor(req.user.role) ? [] : bu.rows.map((r) => ({ ...normalizeBudget(r.data), _updatedAt: r.updated_at })),
    finances: tec || isMonitor(req.user.role) ? [] : fi.rows.map((r) => {
      // Los adjuntos no viajan en el listado (son data: URIs pesados): solo cuántos hay.
      const { attachmentUrl, attachments, ...summary } = r.data;
      const count = Array.isArray(attachments) ? attachments.length : (attachmentUrl ? 1 : 0);
      return { ...summary, hasAttachment: count > 0, attachmentCount: count, _updatedAt: r.updated_at };
    }),
    orders: (req.user.role === "tecnico_oficina" || isMonitor(req.user.role)) ? [] : or.rows.filter((row) => orderVisibleToUser(req.user, row.data)).map((r) => ({ ...(tec ? stripMoney(r.data) : r.data), _updatedAt: r.updated_at })),
    tasks: ta.rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })).filter((t) => !scoped || allowedProjectIds.has(t.project)),
    notifications: notifRows.map((n) => ({ id: n.id, text: n.text, link: n.link, read: n.read, at: n.created_at })),
    parts: pa.rows.map((r) => partOut(r.data)),
    suppliers: tec || isMonitor(req.user.role) ? [] : sup.rows.map((r) => r.data),
    purchaseOrders: tec || isMonitor(req.user.role) ? [] : po.rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })),
    materialLists: (req.user.role === "tecnico_oficina" || isMonitor(req.user.role)) ? [] : ml.rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })),
    whiteboardNotes: wb.rows.filter((r) => whiteboardNoteVisible(req.user, r.data)).map((r) => ({ ...r.data, _updatedAt: r.updated_at })),
    branding,
  });
});

/* ------------------------------------------------ Configuración de marca (solo Admin) ------------------------------------------------ */
app.put("/api/settings/branding", auth, requireRole("admin"), async (req, res) => {
  const input = req.body || {};
  const logo = String(input.logoDataUrl || "");
  if (logo && !/^data:image\/(png|jpeg|webp);base64,/i.test(logo)) return res.status(400).json({ error: "El logo debe ser una imagen PNG, JPG o WebP" });
  if (Buffer.byteLength(logo, "utf8") > 2 * 1024 * 1024) return res.status(400).json({ error: "El logo no puede superar 2 MB" });
  if (!validHexColor(input.primaryColor) || !validHexColor(input.headerColor)) return res.status(400).json({ error: "Los colores deben estar en formato hexadecimal" });
  const branding = normalizeBranding(input);
  await pool.query("INSERT INTO app_settings(key,value,updated_at) VALUES('branding_v1',$1,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()", [branding]);
  res.json(branding);
});

/* ------------------------------------------------ Notificaciones ------------------------------------------------ */
app.get("/api/notifications", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [req.user.id]);
  res.json(rows.map((n) => ({ id: n.id, text: n.text, link: n.link, read: n.read, at: n.created_at })));
});
app.post("/api/notifications/:id/read", auth, async (req, res) => {
  await pool.query("UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
  res.status(204).end();
});
app.post("/api/notifications/read-all", auth, async (req, res) => {
  await pool.query("UPDATE notifications SET read=true WHERE user_id=$1", [req.user.id]);
  res.status(204).end();
});

app.get("/api/parts/:id/movements", auth, requireRole("admin", "gerente"), async (req, res) => { const rows = (await pool.query("SELECT * FROM stock_movements WHERE part_id=$1 ORDER BY created_at DESC LIMIT 200", [req.params.id])).rows; res.json(rows.map((row) => ({ id: row.id, partId: row.part_id, quantity: Number(row.quantity), balance: Number(row.balance), type: row.movement_type, sourceType: row.source_type, sourceId: row.source_id, note: row.note, at: row.created_at }))); });
app.get("/api/audit-log", auth, requireRole("admin"), async (req, res) => { const rows = (await pool.query("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 300")).rows; res.json(rows); });

/* ------------------------------------------------ Clientes ------------------------------------------------ */
app.post("/api/clients", auth, requireProjectWrite, async (req, res) => {
  const c = { ...(req.body || {}) };
  c.name = String(c.name || "").trim();
  if (!c.name) return res.status(400).json({ error: "El nombre del cliente es obligatorio" });
  const existing = (await pool.query("SELECT data FROM clients")).rows.map((r) => r.data);
  // Evita duplicados por nombre (reutiliza el existente)
  const dup = existing.find((x) => (x.name || "").trim().toLowerCase() === (c.name || "").trim().toLowerCase());
  if (dup) return res.json(dup);
  if (!c.id) c.id = "c" + Date.now();
  if (c.code) {
    const taken = new Set(existing.map((x) => x.code).filter(Boolean));
    if (taken.has(c.code)) return res.status(400).json({ error: "Ese código de cliente ya existe" });
  } else {
    c.code = await uniqueClientCode(codeFromName(c.name));
  }
  try { await pool.query("INSERT INTO clients(id,data) VALUES($1,$2)", [c.id, c]); }
  catch (error) { if (error.code === "23505") return res.status(409).json({ error: "Ya existe un cliente con ese identificador" }); throw error; }
  res.json(c);
});
app.patch("/api/clients/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM clients WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  const patch = req.body || {};
  if (patch.code) {
    const code = await uniqueClientCode(patch.code, req.params.id);
    if (code !== patch.code) return res.status(400).json({ error: "Ese código de cliente ya existe" });
  }
  const merged = { ...rows[0].data, ...patch, id: req.params.id };
  merged.name = String(merged.name || "").trim();
  if (!merged.name) return res.status(400).json({ error: "El nombre del cliente es obligatorio" });
  const duplicateName = (await pool.query("SELECT 1 FROM clients WHERE id<>$1 AND lower(trim(data->>'name'))=lower($2) LIMIT 1", [req.params.id, merged.name])).rows[0];
  if (duplicateName) return res.status(409).json({ error: "Ya existe otro cliente con ese nombre" });
  await pool.query("UPDATE clients SET data=$2 WHERE id=$1", [req.params.id, merged]);
  // Si cambió el nombre, se propaga a los presupuestos, órdenes y listados de materiales que ya
  // referencian a este cliente (por clientId cuando lo tienen, o por coincidencia del nombre anterior
  // para registros más viejos que solo guardaban el texto), para que no queden con un nombre desactualizado.
  const oldName = rows[0].data.name;
  if (oldName && oldName !== merged.name) {
    await pool.query(
      "UPDATE budgets SET data = jsonb_set(data, '{client}', to_jsonb($3::text)), updated_at=now() WHERE data->>'clientId'=$1 OR data->>'client'=$2",
      [req.params.id, oldName, merged.name],
    );
    await pool.query(
      "UPDATE orders SET data = jsonb_set(data, '{client}', to_jsonb($2::text)), updated_at=now() WHERE data->>'client'=$1",
      [oldName, merged.name],
    );
    await pool.query(
      "UPDATE material_lists SET data = jsonb_set(data, '{client}', to_jsonb($3::text)), updated_at=now() WHERE data->>'clientId'=$1 OR data->>'client'=$2",
      [req.params.id, oldName, merged.name],
    );
    await pool.query(
      "UPDATE financial_movements SET data = jsonb_set(data, '{clientName}', to_jsonb($3::text)), updated_at=now() WHERE data->>'clientId'=$1 OR data->>'clientName'=$2",
      [req.params.id, oldName, merged.name],
    );
  }
  res.json(merged);
});
app.delete("/api/clients/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const links = await Promise.all([
    pool.query("SELECT count(*)::int count FROM projects WHERE data->>'clientId'=$1", [req.params.id]),
    pool.query("SELECT count(*)::int count FROM budgets WHERE data->>'clientId'=$1", [req.params.id]),
    pool.query("SELECT count(*)::int count FROM financial_movements WHERE data->>'clientId'=$1", [req.params.id]),
  ]);
  const linked = links.reduce((sum, result) => sum + Number(result.rows[0]?.count || 0), 0);
  if (linked) return res.status(409).json({ error: `No se puede eliminar: el cliente tiene ${linked} registro(s) vinculado(s). Reasigna o elimina primero esos registros.` });
  const deleted = await pool.query("DELETE FROM clients WHERE id=$1 RETURNING id", [req.params.id]);
  if (!deleted.rowCount) return res.status(404).json({ error: "No existe" });
  res.status(204).end();
});

/* ------------------------------------------------ Proyectos ------------------------------------------------ */
app.post("/api/projects", auth, requireRole("admin", "gerente"), async (req, res) => {
  const p = { ...(req.body || {}) }; if (!p.id) p.id = "p" + Date.now();
  p.name = String(p.name || "").trim(); p.key = String(p.key || "PRJ").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "PRJ";
  if (!p.name) return res.status(400).json({ error: "El nombre del proyecto es obligatorio" });
  if ((await pool.query("SELECT 1 FROM projects WHERE upper(data->>'key')=upper($1) LIMIT 1", [p.key])).rows[0]) return res.status(409).json({ error: "Ya existe un proyecto con esa clave" });
  if (!Array.isArray(p.allowedUsers)) {
    const monitors = (await pool.query("SELECT id FROM users WHERE active=true AND role='monitor_oficina'")).rows.map((row) => row.id);
    p.allowedUsers = monitors;
  }
  try { await pool.query("INSERT INTO projects(id,data) VALUES($1,$2)", [p.id, p]); }
  catch (error) { if (error.code === "23505") return res.status(409).json({ error: "Ya existe un proyecto con ese identificador" }); throw error; }
  res.json(p);
});
app.patch("/api/projects/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM projects WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  const patch = { ...(req.body || {}) };
  // La clave forma parte de los folios de tarea. Cambiarla dejaría referencias
  // históricas inconsistentes, por eso sólo se define al crear el proyecto.
  delete patch.key;
  const merged = { ...rows[0].data, ...patch, key: rows[0].data.key, id: req.params.id };
  merged.name = String(merged.name || "").trim();
  if (!merged.name) return res.status(400).json({ error: "El nombre del proyecto es obligatorio" });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("UPDATE projects SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
    // El proyecto es la fuente de verdad del color. También lo persistimos en las
    // tareas para que clientes antiguos/offline no conserven el color anterior.
    if (patch.color) {
      await db.query(
        "UPDATE tasks SET data=jsonb_set(data, '{color}', to_jsonb($2::text), true), updated_at=now() WHERE data->>'project'=$1",
        [req.params.id, merged.color],
      );
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
  res.json(merged);
});
app.delete("/api/projects/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const project = (await pool.query("SELECT data FROM projects WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!project) return res.status(404).json({ error: "No existe" });
  const financialCount = Number((await pool.query("SELECT count(*)::int AS count FROM financial_movements WHERE data->>'projectId'=$1", [req.params.id])).rows[0]?.count || 0);
  if (financialCount > 0) return res.status(409).json({ error: `No se puede eliminar: el proyecto tiene ${financialCount} movimiento(s) financiero(s) asociado(s). Elimina o reasigna primero esos registros.` });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const linkedBudgets = (await db.query("SELECT id,data FROM budgets WHERE data->>'projectId'=$1", [req.params.id])).rows;
    const updatedBudgets = [];
    for (const row of linkedBudgets) {
      const { projectId, ...rest } = row.data;
      const budget = { ...rest, stage: "Aprobado", probability: 100, activity: [...(row.data.activity || []), { type: "project_unlinked", text: `Proyecto ${project.key || project.name} eliminado; presupuesto habilitado para una nueva conversión`, by: req.user.id, byName: req.user.name, at: new Date().toISOString() }] };
      await db.query("UPDATE budgets SET data=$2, updated_at=now() WHERE id=$1", [row.id, budget]);
      updatedBudgets.push(budget);
    }
    await db.query("DELETE FROM tasks WHERE data->>'project'=$1", [req.params.id]);
    await db.query("DELETE FROM projects WHERE id=$1", [req.params.id]);
    await db.query("COMMIT");
    res.json({ deletedProjectId: req.params.id, budgets: updatedBudgets });
  } catch (error) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: "No se pudo eliminar y desvincular el proyecto." });
  } finally {
    db.release();
  }
});

/* ------------------------------------------------ Presupuestos ------------------------------------------------ */
const BUDGET_STAGES = ["Borrador", "En preparación", "Enviado", "En seguimiento", "Aprobado", "Facturado", "Pagado", "Rechazado"];
const BUDGET_STAGE_PROBABILITY = { "Borrador": 10, "En preparación": 25, "Enviado": 50, "En seguimiento": 70, "Aprobado": 100, "Facturado": 100, "Pagado": 100, "Rechazado": 0 };
// Motivos de pérdida. Lista cerrada a propósito: en texto libre cada persona escribe distinto y
// después no se puede agrupar ni comparar, que es justamente para lo que sirve el dato.
const BUDGET_REJECTION_REASONS = ["Precio", "Plazo de entrega", "Competencia", "Alcance técnico", "Presupuesto del cliente", "Proyecto postergado", "Sin respuesta", "Otro"];
const LABOR_ROLE_COST = { "Programador": 50, "Ingeniero": 25, "Asesor": 20, "Programador AUX": 45, "Tablerista": 17, "Dibujante": 17, "Administrativo": 6, "Ayudante": 5, "Programador Aprendiz": 7 };
const LABOR_DEFAULT_ROLE = { "Mano de obra": "Ingeniero", "Ingeniería": "Ingeniero", "Programación": "Programador", "Montaje": "Tablerista", "Puesta en marcha": "Ingeniero" };
const normalizeAdditionalCost = (cost) => ({ ...cost, id: String(cost?.id || ""), category: String(cost?.category || "Otro").slice(0, 50), description: String(cost?.description || "").trim().slice(0, 200), amount: Math.round(Math.max(0, Number(cost?.amount) || 0) * 100) / 100, date: String(cost?.date || "").slice(0, 10), notes: String(cost?.notes || "").trim().slice(0, 500) });
const normalizeBudget = (input, previous = {}) => {
  const budget = { ...previous, ...(input || {}) };
  delete budget._updatedAt;
  budget.currency = "USD";
  budget.stage = BUDGET_STAGES.includes(budget.stage) ? budget.stage : "Borrador";
  budget.probabilityOverridden = Boolean(budget.probabilityOverridden);
  budget.probability = budget.probabilityOverridden ? Math.min(100, Math.max(0, Number(budget.probability) || 0)) : BUDGET_STAGE_PROBABILITY[budget.stage];
  if (budget.projectId && !["Facturado", "Pagado"].includes(budget.stage)) { budget.stage = "Aprobado"; budget.probability = 100; }
  budget.negativeMarginReason = String(budget.negativeMarginReason || "").trim().slice(0, 500);
  // Motivo de pérdida. Sin esto, la tasa de conversión dice cuánto se pierde pero nunca por qué,
  // y no hay forma de accionar sobre ella. Si el presupuesto deja de estar rechazado, se limpia:
  // un motivo de rechazo colgando de un presupuesto ganado ensucia el análisis.
  budget.rejectionReason = BUDGET_REJECTION_REASONS.includes(budget.rejectionReason) ? budget.rejectionReason : "";
  budget.rejectionDetail = String(budget.rejectionDetail || "").trim().slice(0, 500);
  if (budget.stage !== "Rechazado") { budget.rejectionReason = ""; budget.rejectionDetail = ""; budget.rejectedAt = ""; }
  else budget.rejectedAt = budget.rejectedAt || new Date().toISOString();
  budget.number = String(budget.number || budget.id || "").trim().slice(0, 40);
  budget.purchaseOrderNumber = String(budget.purchaseOrderNumber || "").trim().slice(0, 80);
  budget.purchaseOrderDate = String(budget.purchaseOrderDate || "").slice(0, 10);
  budget.purchaseOrderNotes = String(budget.purchaseOrderNotes || "").trim().slice(0, 500);
  budget.durationDays = Math.max(0, Math.round(Number(budget.durationDays) || 0));
  budget.teamSize = Math.max(1, Math.round(Number(budget.teamSize) || 1));
  budget.targetMargin = Math.min(100, Math.max(0, Number(budget.targetMargin) || 35));
  budget.items = Array.isArray(budget.items) ? budget.items.map((item) => {
    const laborRole = LABOR_ROLE_COST[item.description] != null ? item.description : LABOR_DEFAULT_ROLE[item.type];
    const isLabor = Boolean(laborRole && LABOR_ROLE_COST[laborRole] != null);
    const originalCost = Math.max(0, Number(item.unitCost) || 0);
    const unitCost = isLabor ? LABOR_ROLE_COST[laborRole] : originalCost;
    const suggestedSale = budget.targetMargin >= 100 ? unitCost : Math.round((unitCost / (1 - budget.targetMargin / 100)) * 100) / 100;
    return { ...item, description: isLabor ? laborRole : item.description, unit: isLabor ? "h" : item.unit, qty: Math.max(0, Number(item.qty) || 0), unitPrice: Math.max(0, originalCost <= 0 && isLabor ? suggestedSale : Number(item.unitPrice) || 0), unitCost };
  }) : [];
  budget.additionalCosts = Array.isArray(budget.additionalCosts) ? budget.additionalCosts.map(normalizeAdditionalCost).filter((cost) => cost.description && cost.amount > 0) : [];
  budget.amount = Math.round(budget.items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0) * 100) / 100;
  budget.estimatedCost = Math.round(budget.items.reduce((sum, item) => sum + item.qty * item.unitCost, 0) * 100) / 100;
  budget.additionalCostTotal = Math.round(budget.additionalCosts.reduce((sum, cost) => sum + cost.amount, 0) * 100) / 100;
  budget.totalEstimatedCost = Math.round((budget.estimatedCost + budget.additionalCostTotal) * 100) / 100;
  return budget;
};

async function upsertBudgetInvoice(budget, user, db = pool) {
  if (!["Facturado", "Pagado"].includes(budget.stage)) {
    await db.query("DELETE FROM financial_movements WHERE data->>'sourceBudgetId'=$1", [budget.id]);
    return null;
  }
  const invoiceDate = String(budget.invoicedAt || "").slice(0, 10);
  const invoiceNumber = String(budget.invoiceNumber || "").trim();
  if (!invoiceDate || !invoiceNumber) throw new Error("INVOICE_FIELDS_REQUIRED");
  const net = Math.round((Number(budget.amount) || 0) * 100) / 100;
  const vatRate = 21;
  const vatAmount = Math.round(net * vatRate) / 100;
  const grossAmount = Math.round((net + vatAmount) * 100) / 100;
  const existing = (await db.query("SELECT id,data FROM financial_movements WHERE data->>'sourceBudgetId'=$1 LIMIT 1", [budget.id])).rows[0];
  const duplicate = (await db.query("SELECT id FROM financial_movements WHERE data->>'kind'='invoice' AND data->>'invoiceNumber'=$1 AND ($2::text IS NULL OR id<>$2) LIMIT 1", [invoiceNumber, existing?.id || null])).rows[0];
  if (duplicate) throw new Error("DUPLICATE_INVOICE");
  const id = existing?.id || `INV-${budget.id}`;
  // Referencia informativa en ARS al tipo de cambio mayorista A 3500 disponible al facturar.
  // No cambia la moneda de registro (USD): es solo trazabilidad para el circuito fiscal local.
  const arsQuote = wholesaleRateCache?.data?.arsPerUsd || null;
  const arsReference = arsQuote ? { arsPerUsd: arsQuote, source: "BCRA dólar mayorista · Comunicación A 3500", quotedAt: wholesaleRateCache?.data?.updatedAt || null, netArs: Math.round(net * arsQuote * 100) / 100, vatArs: Math.round(vatAmount * arsQuote * 100) / 100, grossArs: Math.round(grossAmount * arsQuote * 100) / 100 } : (existing?.data?.arsReference || null);
  const invoice = { ...(existing?.data || {}), id, kind: "invoice", concept: `Factura ${budget.number || budget.id} · ${budget.title}`, amount: net, amountUsd: net, netAmountUsd: net, vatRate, vatAmountUsd: vatAmount, grossAmountUsd: grossAmount, arsReference, currency: "USD", exchangeRate: 1, date: invoiceDate, dueDate: budget.invoiceDueDate || "", invoiceNumber, receiptNumber: invoiceNumber, detail: budget.invoiceDetail || "", projectId: budget.projectId || "", budgetId: budget.id, budgetNumber: budget.number || budget.id, purchaseOrderNumber: budget.purchaseOrderNumber || "", purchaseOrderDate: budget.purchaseOrderDate || "", clientId: budget.clientId || "", clientName: budget.client || "", sourceBudgetId: budget.id, paymentStatus: existing?.data?.paymentStatus || "pending", createdAt: existing?.data?.createdAt || new Date().toISOString(), createdBy: existing?.data?.createdBy || user.id, createdByName: existing?.data?.createdByName || user.name, updatedAt: new Date().toISOString() };
  await db.query("INSERT INTO financial_movements(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2, updated_at=now()", [id, invoice]);
  return invoice;
}

const movementBudgetIds = (movement) => [...new Set([
  movement?.budgetId,
  ...(Array.isArray(movement?.allocations) ? movement.allocations.map((allocation) => allocation?.budgetId) : []),
].filter(Boolean))];

// "Pagado" es una condición financiera derivada: nunca depende de que una persona la marque.
// Se compara contra el total bruto de las facturas (neto + IVA), porque ese es el importe que el
// cliente cancela. Si un cobro se corrige o elimina, el presupuesto vuelve automáticamente a
// Facturado y conserva toda la trazabilidad de sus movimientos.
async function syncBudgetPaymentStatuses(budgetIds, db = pool, user = null) {
  const updated = [];
  const uniqueBudgetIds = [...new Set((budgetIds || []).filter(Boolean))];
  if (!uniqueBudgetIds.length) return updated;
  // Se leen una sola vez aunque un aviso de pago cancele varias facturas/presupuestos.
  const incomes = (await db.query("SELECT data FROM financial_movements WHERE data->>'kind'='income'")).rows.map((income) => income.data);
  for (const budgetId of uniqueBudgetIds) {
    const row = (await db.query("SELECT data FROM budgets WHERE id=$1", [budgetId])).rows[0];
    if (!row?.data || !["Facturado", "Pagado"].includes(row.data.stage)) continue;
    const budget = row.data;
    const invoices = (await db.query("SELECT id,data FROM financial_movements WHERE data->>'kind'='invoice' AND (data->>'budgetId'=$1 OR data->>'sourceBudgetId'=$1)", [budgetId])).rows;
    const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
    const billedGross = invoices.reduce((sum, invoice) => sum + (Number(invoice.data.grossAmountUsd) || (Number(invoice.data.amountUsd) || 0) + (Number(invoice.data.vatAmountUsd) || 0)), 0);
    const invoiceGrossById = new Map(invoices.map((invoice) => [invoice.id, Number(invoice.data.grossAmountUsd) || (Number(invoice.data.amountUsd) || 0) + (Number(invoice.data.vatAmountUsd) || 0)]));
    let collected = 0;
    let settled = 0;
    let lastPaymentDate = "";
    for (const income of incomes) {
      const allocations = (income.allocations || []).filter((allocation) => Number(allocation.amountUsd) > 0);
      const matched = allocations.filter((allocation) => allocation.budgetId === budgetId || invoiceIds.has(allocation.invoiceId));
      let cashContribution = 0;
      let settlementContribution = 0;
      if (matched.length) {
        cashContribution = matched.reduce((sum, allocation) => sum + (Number(allocation.netAmountUsd) || Math.max(0, (Number(allocation.amountUsd) || 0) - (Number(allocation.deductionsUsd) || 0))), 0);
        // Una partida identificada como cancelación total salda la factura aunque el depósito sea
        // menor por retenciones. En un anticipo se aplica el bruto informado, distinguiéndolo del
        // efectivo neto que realmente ingresó al banco.
        settlementContribution = income.paymentStatus === "partial"
          ? matched.reduce((sum, allocation) => sum + Number(allocation.amountUsd), 0)
          : [...new Set(matched.map((allocation) => allocation.invoiceId).filter((id) => invoiceGrossById.has(id)))].reduce((sum, invoiceId) => sum + invoiceGrossById.get(invoiceId), 0) || matched.reduce((sum, allocation) => sum + Number(allocation.amountUsd), 0);
      } else if (income.budgetId === budgetId) {
        cashContribution = Number(income.netAmountUsd) || Math.max(0, (Number(income.amountUsd) || 0) - (Number(income.deductionsUsd) || 0));
        settlementContribution = income.paymentStatus === "partial" ? (Number(income.amountUsd) || 0) : billedGross;
      }
      if (cashContribution > 0 || settlementContribution > 0) {
        collected += cashContribution;
        settled += settlementContribution;
        if (String(income.date || "") > lastPaymentDate) lastPaymentDate = String(income.date || "").slice(0, 10);
      }
    }
    collected = Math.round(collected * 100) / 100;
    settled = Math.round(Math.min(billedGross, settled) * 100) / 100;
    const outstanding = Math.round(Math.max(0, billedGross - settled) * 100) / 100;
    const settlementDifference = Math.round(Math.max(0, settled - collected) * 100) / 100;
    const fullyPaid = billedGross > 0 && outstanding <= 0.01;
    const nextStage = fullyPaid ? "Pagado" : "Facturado";
    const stageChanged = budget.stage !== nextStage;
    const next = {
      ...budget,
      stage: nextStage,
      probability: 100,
      collectedAmountUsd: collected,
      settledAmountUsd: settled,
      settlementDifferenceUsd: settlementDifference,
      outstandingAmountUsd: outstanding,
      collectionProgress: billedGross > 0 ? Math.min(100, Math.round((settled / billedGross) * 100)) : 0,
      paidAt: fullyPaid ? (lastPaymentDate || budget.paidAt || new Date().toISOString().slice(0, 10)) : "",
    };
    if (stageChanged) next.activity = [...(budget.activity || []), { type: fullyPaid ? "paid" : "payment_reopened", text: fullyPaid ? `Pago completo registrado: USD ${collected.toFixed(2)} ingresados${settlementDifference ? ` · USD ${settlementDifference.toFixed(2)} en retenciones/ajustes` : ""}` : `Cobro modificado: saldo pendiente USD ${outstanding.toFixed(2)}`, by: user?.id || "system", byName: user?.name || "Sistema", at: new Date().toISOString() }];
    await db.query("UPDATE budgets SET data=$2, updated_at=now() WHERE id=$1", [budgetId, next]);
    for (const invoice of invoices) await db.query("UPDATE financial_movements SET data=$2, updated_at=now() WHERE id=$1", [invoice.id, { ...invoice.data, paymentStatus: fullyPaid ? "paid" : collected > 0 ? "partial" : "pending", paidAmountUsd: collected, settledAmountUsd: settled, settlementDifferenceUsd: settlementDifference, outstandingAmountUsd: outstanding, paidAt: next.paidAt }]);
    updated.push(next);
  }
  return updated;
}

/* ------------------------------------------------ Órdenes de compra ------------------------------------------------ */
const PO_STAGES = ["Borrador", "Enviada", "Confirmada", "Recibida", "Cancelada"];
const PO_CURRENCIES = ["USD", "ARS", "EUR"];
const PO_VAT_RATES = [10.5, 21];
const normalizePurchaseOrderItem = (item) => {
  const currency = PO_CURRENCIES.includes(item?.currency) ? item.currency : "USD";
  const vatRate = PO_VAT_RATES.includes(Number(item?.vatRate)) ? Number(item.vatRate) : 21;
  const qty = Math.max(0, Math.round(Number(item?.qty) || 0));
  const unitPrice = Math.max(0, Number(item?.unitPrice) || 0);
  const exchangeRate = currency === "USD" ? 1 : Math.max(0, Number(item?.exchangeRate) || 0);
  const netAmount = Math.round(qty * unitPrice * 100) / 100;
  const vatAmount = Math.round(netAmount * vatRate) / 100;
  const grossAmount = Math.round((netAmount + vatAmount) * 100) / 100;
  const netAmountUsd = Math.round((exchangeRate > 0 ? netAmount / exchangeRate : 0) * 100) / 100;
  const vatAmountUsd = Math.round((exchangeRate > 0 ? vatAmount / exchangeRate : 0) * 100) / 100;
  const grossAmountUsd = Math.round((netAmountUsd + vatAmountUsd) * 100) / 100;
  return { ...item, description: String(item?.description || "").trim().slice(0, 200), sku: String(item?.sku || "").trim().slice(0, 60), unit: String(item?.unit || "u").trim().slice(0, 10) || "u", qty, unitPrice, currency, vatRate, exchangeRate, netAmount, vatAmount, grossAmount, netAmountUsd, vatAmountUsd, grossAmountUsd };
};
const normalizePurchaseOrder = (input, previous = {}) => {
  const po = { ...previous, ...(input || {}) };
  delete po._updatedAt;
  po.stage = PO_STAGES.includes(po.stage) ? po.stage : "Borrador";
  po.number = String(po.number || po.id || "").trim().slice(0, 40);
  po.supplierId = String(po.supplierId || "").trim();
  po.supplierName = String(po.supplierName || "").trim();
  po.projectId = String(po.projectId || "").trim();
  po.supplierInvoiceNumber = String(po.supplierInvoiceNumber || "").trim().slice(0, 80);
  po.supplierQuoteNumber = String(po.supplierQuoteNumber || "").trim().slice(0, 80);
  po.dueDate = String(po.dueDate || "").slice(0, 10);
  po.notes = String(po.notes || "").trim().slice(0, 1000);
  po.items = Array.isArray(po.items) ? po.items.map(normalizePurchaseOrderItem).filter((item) => item.description && item.qty > 0) : [];
  po.netAmountUsd = Math.round(po.items.reduce((sum, item) => sum + item.netAmountUsd, 0) * 100) / 100;
  po.vatAmountUsd = Math.round(po.items.reduce((sum, item) => sum + item.vatAmountUsd, 0) * 100) / 100;
  po.grossAmountUsd = Math.round((po.netAmountUsd + po.vatAmountUsd) * 100) / 100;
  return po;
};
// Genera/actualiza el compromiso de pago en Finanzas al recibir la orden de compra; lo retira si se reabre o cancela.
async function upsertPurchaseOrderPayable(po, user, db = pool) {
  const id = `EXP-PO-${po.id}`;
  if (po.stage !== "Recibida") {
    await db.query("DELETE FROM financial_movements WHERE id=$1 AND data->>'sourcePurchaseOrderId' IS NOT NULL", [id]);
    return null;
  }
  const existing = (await db.query("SELECT id,data FROM financial_movements WHERE id=$1", [id])).rows[0];
  const effectiveVatRate = po.netAmountUsd > 0 ? Math.round((po.vatAmountUsd / po.netAmountUsd) * 1000) / 10 : 21;
  const movement = {
    ...(existing?.data || {}), id, kind: "expense", category: "Compras a proveedores",
    concept: `${po.number || po.id} · ${po.supplierName || "Proveedor"}`,
    amount: po.grossAmountUsd, currency: "USD", exchangeRate: 1, amountUsd: po.grossAmountUsd,
    vatIncluded: true, vatRate: effectiveVatRate, netAmountUsd: po.netAmountUsd, vatAmountUsd: po.vatAmountUsd, grossAmountUsd: po.grossAmountUsd,
    date: String(po.receivedAt || existing?.data?.date || new Date().toISOString()).slice(0, 10),
    projectId: po.projectId || "", supplier: po.supplierName || "", receiptNumber: po.supplierInvoiceNumber || po.number || po.id,
    paymentStatus: existing?.data?.paymentStatus || "pending", paidAt: existing?.data?.paidAt || "",
    sourcePurchaseOrderId: po.id, purchaseOrderNumber: po.number || po.id,
    detail: `Generado automáticamente al recibir la orden de compra ${po.number || po.id}. Se actualiza si cambian los ítems.`,
    createdAt: existing?.data?.createdAt || new Date().toISOString(), createdBy: existing?.data?.createdBy || user.id, createdByName: existing?.data?.createdByName || user.name,
    updatedAt: new Date().toISOString(),
  };
  await db.query("INSERT INTO financial_movements(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2, updated_at=now()", [id, movement]);
  return movement;
}

app.get("/api/suppliers", auth, requireRole("admin", "gerente"), async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM suppliers ORDER BY data->>'name'");
  res.json(rows.map((r) => r.data));
});
app.post("/api/suppliers", auth, requireRole("admin", "gerente"), async (req, res) => {
  const s = { ...(req.body || {}) };
  s.name = String(s.name || "").trim();
  if (!s.name) return res.status(400).json({ error: "El nombre del proveedor es obligatorio" });
  const existingRows = (await pool.query("SELECT data FROM suppliers")).rows.map((r) => r.data);
  const dup = existingRows.find((x) => (x.name || "").trim().toLowerCase() === s.name.toLowerCase());
  if (dup) return res.json(dup);
  if (!s.id) s.id = "sup" + Date.now();
  s.cuit = String(s.cuit || "").trim().slice(0, 20);
  s.address = String(s.address || "").trim().slice(0, 200);
  s.locality = String(s.locality || "").trim().slice(0, 120);
  s.phone = String(s.phone || "").trim().slice(0, 40);
  s.email = String(s.email || "").trim().slice(0, 120);
  s.contactName = String(s.contactName || s.contact || "").trim().slice(0, 120);
  s.contact = String(s.contact || "").trim().slice(0, 120);
  s.ivaCondition = IVA_CONDITIONS.includes(s.ivaCondition) ? s.ivaCondition : "";
  s.saleCondition = SALE_CONDITIONS.includes(s.saleCondition) ? s.saleCondition : "";
  s.paymentTermsDays = Math.max(0, Math.round(Number(s.paymentTermsDays) || 0));
  s.active = s.active !== false;
  if (s.code) {
    const taken = new Set(existingRows.map((x) => x.code).filter(Boolean));
    if (taken.has(s.code)) return res.status(400).json({ error: "Ese código de proveedor ya existe" });
  } else {
    s.code = await uniqueSupplierCode(codeFromSupplierName(s.name));
  }
  try { await pool.query("INSERT INTO suppliers(id,data) VALUES($1,$2)", [s.id, s]); }
  catch (error) { if (error.code === "23505") return res.status(409).json({ error: "Ya existe un proveedor con ese identificador" }); throw error; }
  res.json(s);
});
app.patch("/api/suppliers/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM suppliers WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  const patch = req.body || {};
  if (patch.code) {
    const code = await uniqueSupplierCode(patch.code, req.params.id);
    if (code !== patch.code) return res.status(400).json({ error: "Ese código de proveedor ya existe" });
  }
  const merged = { ...rows[0].data, ...patch, id: req.params.id };
  merged.name = String(merged.name || "").trim();
  if (!merged.name) return res.status(400).json({ error: "El nombre del proveedor es obligatorio" });
  if (patch.paymentTermsDays !== undefined) merged.paymentTermsDays = Math.max(0, Math.round(Number(patch.paymentTermsDays) || 0));
  if (patch.cuit !== undefined) merged.cuit = String(patch.cuit || "").trim().slice(0, 20);
  if (patch.address !== undefined) merged.address = String(patch.address || "").trim().slice(0, 200);
  if (patch.locality !== undefined) merged.locality = String(patch.locality || "").trim().slice(0, 120);
  if (patch.phone !== undefined) merged.phone = String(patch.phone || "").trim().slice(0, 40);
  if (patch.email !== undefined) merged.email = String(patch.email || "").trim().slice(0, 120);
  if (patch.contactName !== undefined) merged.contactName = String(patch.contactName || "").trim().slice(0, 120);
  if (patch.ivaCondition !== undefined) merged.ivaCondition = IVA_CONDITIONS.includes(patch.ivaCondition) ? patch.ivaCondition : "";
  if (patch.saleCondition !== undefined) merged.saleCondition = SALE_CONDITIONS.includes(patch.saleCondition) ? patch.saleCondition : "";
  const duplicateName = (await pool.query("SELECT 1 FROM suppliers WHERE id<>$1 AND lower(trim(data->>'name'))=lower($2) LIMIT 1", [req.params.id, merged.name])).rows[0];
  if (duplicateName) return res.status(409).json({ error: "Ya existe otro proveedor con ese nombre" });
  await pool.query("UPDATE suppliers SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
  res.json(merged);
});
app.delete("/api/suppliers/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const linked = (await pool.query("SELECT count(*)::int count FROM purchase_orders WHERE data->>'supplierId'=$1", [req.params.id])).rows[0].count;
  if (linked) return res.status(409).json({ error: `No se puede eliminar: el proveedor tiene ${linked} orden(es) de compra vinculada(s). Reasigná o eliminá primero esas órdenes.` });
  const deleted = await pool.query("DELETE FROM suppliers WHERE id=$1 RETURNING id", [req.params.id]);
  if (!deleted.rowCount) return res.status(404).json({ error: "No existe" });
  res.status(204).end();
});

app.get("/api/purchase-orders", auth, requireRole("admin", "gerente"), async (req, res) => {
  const { rows } = await pool.query("SELECT data, updated_at FROM purchase_orders ORDER BY updated_at DESC");
  res.json(rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })));
});
app.post("/api/purchase-orders", auth, requireRole("admin", "gerente"), apiRateLimit(60), async (req, res) => {
  const po = normalizePurchaseOrder(req.body);
  if (!po.supplierId) return res.status(400).json({ error: "El proveedor es obligatorio" });
  const supplier = (await pool.query("SELECT data FROM suppliers WHERE id=$1", [po.supplierId])).rows[0]?.data;
  if (!supplier) return res.status(400).json({ error: "El proveedor seleccionado ya no existe." });
  po.supplierName = supplier.name;
  if (!po.items.length) return res.status(400).json({ error: "Agregá al menos un ítem a la orden de compra." });
  if (po.stage === "Recibida" && !po.supplierInvoiceNumber) return res.status(400).json({ error: "El número de factura del proveedor es obligatorio para marcar la orden como Recibida." });
  if (!po.id) {
    const year = new Date().getFullYear();
    const rows = (await pool.query("SELECT id FROM purchase_orders WHERE id LIKE $1", [`OC-${year}-%`])).rows;
    const next = Math.max(0, ...rows.map((row) => Number(String(row.id).split("-").pop()) || 0)) + 1;
    po.id = `OC-${year}-${String(next).padStart(3, "0")}`;
  }
  po.number = po.number || po.id;
  po.createdAt = po.createdAt || new Date().toISOString();
  if (po.stage === "Recibida") po.receivedAt = po.receivedAt || new Date().toISOString();
  po.activity = [...(po.activity || []), { type: "created", text: "Orden de compra creada", by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Si nace ya recibida, el stock entra acá y queda marcado, para que un cambio de estado
    // posterior sepa que esta entrega ya fue aplicada y no la sume de nuevo.
    if (po.stage === "Recibida") {
      for (const item of po.items || []) {
        const partId = item.partId || await matchPartIdByName(item.description, db);
        if (partId) await adjustPartStock(partId, Number(item.qty) || 0, db, { movementType: "Recepción", sourceType: "Orden de compra", sourceId: po.id, userId: req.user.id });
      }
      po.stockAppliedAt = new Date().toISOString();
    }
    await db.query("INSERT INTO purchase_orders(id,data) VALUES($1,$2)", [po.id, po]);
    const generatedMovement = await upsertPurchaseOrderPayable(po, req.user, db);
    await db.query("COMMIT");
    res.json({ ...po, _generatedMovement: generatedMovement });
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "Ya existe una orden de compra con ese identificador." });
    return res.status(500).json({ error: "No se pudo guardar la orden de compra de forma consistente." });
  } finally { db.release(); }
});
app.patch("/api/purchase-orders/:id", auth, requireRole("admin", "gerente"), apiRateLimit(60), async (req, res) => {
  const current = (await pool.query("SELECT data FROM purchase_orders WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!current) return res.status(404).json({ error: "No existe" });
  const po = normalizePurchaseOrder(req.body, current);
  po.id = req.params.id;
  if (!po.supplierId) return res.status(400).json({ error: "El proveedor es obligatorio" });
  if (po.supplierId !== current.supplierId) {
    const supplier = (await pool.query("SELECT data FROM suppliers WHERE id=$1", [po.supplierId])).rows[0]?.data;
    if (!supplier) return res.status(400).json({ error: "El proveedor seleccionado ya no existe." });
    po.supplierName = supplier.name;
  }
  po.number = po.number || po.id;
  if (!po.items.length) return res.status(400).json({ error: "Agregá al menos un ítem a la orden de compra." });
  if (po.stage === "Recibida" && !po.supplierInvoiceNumber) return res.status(400).json({ error: "El número de factura del proveedor es obligatorio para marcar la orden como Recibida." });
  if (po.stage === "Recibida" && current.stage !== "Recibida") po.receivedAt = po.receivedAt || new Date().toISOString();
  const changes = [];
  if (po.stage !== current.stage) changes.push(`Estado: ${current.stage} → ${po.stage}`);
  if (!changes.length) changes.push("Orden de compra actualizada");
  po.activity = [...(current.activity || []), { type: "update", text: changes.join(" · "), by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  const receivingNow = po.stage === "Recibida" && current.stage !== "Recibida";
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // El ingreso de stock se marca con stockAppliedAt, igual que stockDeductedAt en las OT.
    // Sin ese marcador, el ciclo Recibida → Cancelada → Recibida volvía a sumar la misma entrega
    // (porque el estado anterior ya no era "Recibida"), y salir de Recibida no devolvía nada:
    // el stock quedaba inflado por mercadería que nunca entró. Va antes del UPDATE para que el
    // marcador se persista en la misma escritura.
    const alreadyApplied = Boolean(current.stockAppliedAt);
    const leavingReceived = current.stage === "Recibida" && po.stage !== "Recibida";
    if (receivingNow && !alreadyApplied) {
      for (const item of po.items || []) {
        const partId = item.partId || await matchPartIdByName(item.description, db);
        if (partId) await adjustPartStock(partId, Number(item.qty) || 0, db, { movementType: "Recepción", sourceType: "Orden de compra", sourceId: po.id, userId: req.user.id });
      }
      po.stockAppliedAt = new Date().toISOString();
    } else if (leavingReceived && alreadyApplied) {
      for (const item of po.items || []) {
        const partId = item.partId || await matchPartIdByName(item.description, db);
        if (partId) await adjustPartStock(partId, -(Number(item.qty) || 0), db, { movementType: "Reversión", sourceType: "Orden de compra", sourceId: po.id, userId: req.user.id });
      }
      po.stockAppliedAt = "";
    }
    await db.query("UPDATE purchase_orders SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, po]);
    const generatedMovement = await upsertPurchaseOrderPayable(po, req.user, db);
    await db.query("COMMIT");
    res.json({ ...po, _generatedMovement: generatedMovement });
  } catch (error) {
    await db.query("ROLLBACK");
    return res.status(500).json({ error: "No se pudo actualizar la orden de compra de forma consistente." });
  } finally { db.release(); }
});
app.delete("/api/purchase-orders/:id", auth, requireRole("admin"), async (req, res) => {
  await pool.query("DELETE FROM financial_movements WHERE data->>'sourcePurchaseOrderId'=$1", [req.params.id]);
  const deleted = await pool.query("DELETE FROM purchase_orders WHERE id=$1 RETURNING id", [req.params.id]);
  if (!deleted.rowCount) return res.status(404).json({ error: "No existe" });
  res.status(204).end();
});

/* ------------------------------------------------ Listado de materiales ------------------------------------------------ */
// Documento que Automática entrega al cliente para que este cotice los materiales con su
// proveedor (columnas de precio quedan siempre en blanco; las completa quien cotiza).
const MATERIAL_LIST_DISCIPLINES = ["Eléctricos", "Mecánicos", "Instrumentación", "Neumáticos", "Automatización", "Otro"];
// Seguimiento del ciclo del listado después de generado (a diferencia de Presupuestos/Compras,
// antes no tenía ningún estado: era solo un documento para exportar y listo).
const MATERIAL_LIST_STAGES = ["Borrador", "Enviado al cliente", "Cotizado", "Comprado", "Recibido"];
const MATERIAL_LIST_DEFAULT_NOTES = [
  "Los datos de cómputos y unidades presentados en este documento son provistos solo a efectos orientativos, pudiendo presentar cierto grado de incerteza producto de la calidad y metodología de la medición empleada. Es responsabilidad de los oferentes verificar las cantidades a suministrar de la mejor manera que consideren pertinente y ajustarlos o asumirlos como verdaderos.",
  "El formato aquí suministrado es a los efectos de facilitar la comparación y ecualización de ofertas. Se ruega no alterar la estructura de los ítems mayores que componen el alcance del trabajo y en caso de considerar necesario acrecentar el grado de apertura para brindar mayor detalle sobre algún ítem en particular, favor de hacerlo agregando líneas debajo de la línea al final. En caso de opcionales y/o variantes a lo especificado cotizar por separado dejándolo expresamente indicado.",
];
const SECTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function normalizeMaterialListItem(item) {
  return {
    ref: String(item?.ref || "").trim().slice(0, 60),
    description: String(item?.description || "").trim().slice(0, 300),
    brand: String(item?.brand || "").trim().slice(0, 80),
    qty: Math.max(0, Number(item?.qty) || 0),
    unit: String(item?.unit || "un").trim().slice(0, 10) || "un",
  };
}
function normalizeMaterialList(input, previous = {}) {
  const ml = { ...previous, ...(input || {}) };
  delete ml._updatedAt;
  ml.version = String(ml.version || "1.0").trim().slice(0, 10) || "1.0";
  ml.projectId = String(ml.projectId || "").trim();
  ml.projectName = String(ml.projectName || "").trim();
  ml.clientId = String(ml.clientId || "").trim();
  ml.client = String(ml.client || "").trim();
  ml.site = String(ml.site || "").trim();
  ml.audience = ml.audience === "interno" ? "interno" : "cliente";
  ml.discipline = MATERIAL_LIST_DISCIPLINES.includes(ml.discipline) ? ml.discipline : "Eléctricos";
  ml.stage = MATERIAL_LIST_STAGES.includes(ml.stage) ? ml.stage : "Borrador";
  ml.notes = Array.isArray(ml.notes) ? ml.notes.map((note) => String(note || "").trim().slice(0, 600)).filter(Boolean) : MATERIAL_LIST_DEFAULT_NOTES;
  ml.sections = (Array.isArray(ml.sections) ? ml.sections : [])
    .map((section) => ({
      title: String(section?.title || "").trim().slice(0, 120),
      items: (Array.isArray(section?.items) ? section.items : []).map(normalizeMaterialListItem).filter((item) => item.description),
    }))
    .filter((section) => section.title && section.items.length > 0)
    .map((section, index) => ({ ...section, code: SECTION_LETTERS[index] || `S${index + 1}` }));
  ml.totalItems = ml.sections.reduce((sum, section) => sum + section.items.length, 0);
  return ml;
}
app.get("/api/material-lists", auth, requireRole("admin", "gerente", "tecnico"), async (req, res) => {
  const { rows } = await pool.query("SELECT data, updated_at FROM material_lists ORDER BY updated_at DESC");
  const materialLists = rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at }));
  // Un técnico de campo solo debe ver los listados de los proyectos que tiene habilitados (o los
  // de uso interno sin proyecto asociado); admin y gerente ven todos.
  if (req.user.role !== "tecnico") return res.json(materialLists);
  const allowedProjectIds = new Set((await pool.query("SELECT id FROM projects WHERE data->'allowedUsers' ? $1", [req.user.id])).rows.map((row) => row.id));
  res.json(materialLists.filter((ml) => !ml.projectId || allowedProjectIds.has(ml.projectId)));
});
app.post("/api/material-lists", auth, requireRole("admin", "gerente", "tecnico"), apiRateLimit(60), async (req, res) => {
  const ml = normalizeMaterialList(req.body);
  // El proyecto solo es obligatorio para el listado destinado al cliente; uno de uso interno no necesita estar atado a un proyecto.
  if (ml.audience !== "interno" && !ml.projectId) return res.status(400).json({ error: "El proyecto es obligatorio" });
  let project = null;
  if (ml.projectId) {
    project = (await pool.query("SELECT data FROM projects WHERE id=$1", [ml.projectId])).rows[0]?.data;
    if (!project) return res.status(400).json({ error: "El proyecto seleccionado ya no existe." });
    ml.projectName = project.name;
  } else {
    ml.projectName = "";
  }
  // Un técnico de campo solo puede crear listados para proyectos que tiene habilitados (los de
  // uso interno, sin proyecto asociado, quedan afuera de este chequeo).
  if (ml.projectId && !(await tecCanProject(req.user, ml.projectId))) return res.status(403).json({ error: "Sin acceso a ese proyecto" });
  if (!ml.sections.length) return res.status(400).json({ error: "Agregá al menos una sección con un ítem." });
  if (!ml.id) {
    const siteCode = String(project?.key || "INT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "INT";
    const stamp = new Date();
    const mmdd = `${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}`;
    const prefix = `${siteCode}-${mmdd}-MAT-`;
    const rows = (await pool.query("SELECT id FROM material_lists WHERE id LIKE $1", [`${prefix}%`])).rows;
    const next = Math.max(0, ...rows.map((row) => Number(String(row.id).slice(prefix.length)) || 0)) + 1;
    ml.id = `${prefix}${String(next).padStart(3, "0")}`;
  }
  ml.number = ml.id;
  ml.createdAt = ml.createdAt || new Date().toISOString();
  ml.createdBy = ml.createdBy || req.user.id; ml.createdByName = ml.createdByName || req.user.name;
  try { await pool.query("INSERT INTO material_lists(id,data) VALUES($1,$2)", [ml.id, ml]); }
  catch (error) { if (error.code === "23505") return res.status(409).json({ error: "Ya existe un listado con ese identificador" }); throw error; }
  res.json(ml);
});
app.patch("/api/material-lists/:id", auth, requireRole("admin", "gerente", "tecnico"), apiRateLimit(60), async (req, res) => {
  const current = (await pool.query("SELECT data FROM material_lists WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!current) return res.status(404).json({ error: "No existe" });
  // Necesita acceso tanto al proyecto donde está hoy el listado como, si lo mueve, al de destino.
  if (current.projectId && !(await tecCanProject(req.user, current.projectId))) return res.status(403).json({ error: "Sin acceso a ese proyecto" });
  const ml = normalizeMaterialList(req.body, current);
  ml.id = req.params.id; ml.number = ml.id;
  if (ml.audience !== "interno" && !ml.projectId) return res.status(400).json({ error: "El proyecto es obligatorio" });
  if (ml.projectId && !(await tecCanProject(req.user, ml.projectId))) return res.status(403).json({ error: "Sin acceso a ese proyecto" });
  if (ml.projectId && ml.projectId !== current.projectId) {
    const project = (await pool.query("SELECT data FROM projects WHERE id=$1", [ml.projectId])).rows[0]?.data;
    if (!project) return res.status(400).json({ error: "El proyecto seleccionado ya no existe." });
    ml.projectName = project.name;
  } else if (!ml.projectId) {
    ml.projectName = "";
  }
  if (!ml.sections.length) return res.status(400).json({ error: "Agregá al menos una sección con un ítem." });
  ml.updatedBy = req.user.id; ml.updatedByName = req.user.name;
  await pool.query("UPDATE material_lists SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, ml]);
  res.json(ml);
});
app.delete("/api/material-lists/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const deleted = await pool.query("DELETE FROM material_lists WHERE id=$1 RETURNING id", [req.params.id]);
  if (!deleted.rowCount) return res.status(404).json({ error: "No existe" });
  res.status(204).end();
});

/* ------------------------------------------------ Pizarra: notas y dibujos ------------------------------------------------ */
const WHITEBOARD_NOTE_TYPES = ["text", "drawing"];
function normalizeWhiteboardNote(input, previous = {}) {
  const n = { ...previous, ...(input || {}) };
  delete n._updatedAt;
  n.type = WHITEBOARD_NOTE_TYPES.includes(n.type) ? n.type : "text";
  n.title = String(n.title || "").trim().slice(0, 120);
  n.content = n.type === "text" ? String(n.content || "").trim().slice(0, 4000) : "";
  n.imageDataUrl = n.type === "drawing" ? String(n.imageDataUrl || "") : "";
  n.color = String(n.color || "#FEF3C7").trim().slice(0, 20);
  n.projectId = String(n.projectId || "").trim();
  n.sharedWith = Array.isArray(n.sharedWith) ? [...new Set(n.sharedWith.map((id) => String(id || "")).filter(Boolean))] : [];
  return n;
}
// Una nota es visible para quien la creó, para quienes fueron agregados a sharedWith,
// y siempre para Administrador (visibilidad total, no implica permiso de edición/borrado).
function whiteboardNoteVisible(user, note) {
  if (user.role === "admin") return true;
  return note.createdBy === user.id || (Array.isArray(note.sharedWith) && note.sharedWith.includes(user.id));
}
app.get("/api/whiteboard-notes", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT data, updated_at FROM whiteboard_notes ORDER BY updated_at DESC");
  res.json(rows.filter((r) => whiteboardNoteVisible(req.user, r.data)).map((r) => ({ ...r.data, _updatedAt: r.updated_at })));
});
app.post("/api/whiteboard-notes", auth, async (req, res) => {
  const n = normalizeWhiteboardNote(req.body);
  if (n.type === "text" && !n.title && !n.content) return res.status(400).json({ error: "La nota necesita un título o contenido." });
  if (n.type === "drawing" && !n.imageDataUrl) return res.status(400).json({ error: "El dibujo está vacío." });
  if (!n.id) n.id = "wbn" + Date.now();
  n.createdAt = new Date().toISOString();
  n.createdBy = req.user.id; n.createdByName = req.user.name;
  n.sharedWith = []; // una nota nueva siempre arranca privada; compartir es un paso aparte y explícito
  try { await pool.query("INSERT INTO whiteboard_notes(id,data) VALUES($1,$2)", [n.id, n]); }
  catch (error) { if (error.code === "23505") return res.status(409).json({ error: "Ya existe una nota con ese identificador" }); throw error; }
  res.json(n);
});
app.patch("/api/whiteboard-notes/:id", auth, async (req, res) => {
  const current = (await pool.query("SELECT data FROM whiteboard_notes WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!current) return res.status(404).json({ error: "No existe" });
  const isOwner = current.createdBy === req.user.id;
  // Ver todo (Administrador) no implica poder editar: solo el dueño o alguien con quien se compartió explícitamente puede modificar la nota.
  const isCollaborator = Array.isArray(current.sharedWith) && current.sharedWith.includes(req.user.id);
  if (!isOwner && !isCollaborator) return res.status(403).json({ error: "No tenés acceso a esta nota" });
  const patch = { ...(req.body || {}) };
  if (!isOwner) delete patch.sharedWith; // solo quien la creó decide con quién se comparte
  const n = normalizeWhiteboardNote(patch, current);
  n.id = req.params.id;
  if (n.type === "text" && !n.title && !n.content) return res.status(400).json({ error: "La nota necesita un título o contenido." });
  if (n.type === "drawing" && !n.imageDataUrl) return res.status(400).json({ error: "El dibujo está vacío." });
  n.createdBy = current.createdBy; n.createdByName = current.createdByName; n.createdAt = current.createdAt;
  await pool.query("UPDATE whiteboard_notes SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, n]);
  res.json(n);
});
app.delete("/api/whiteboard-notes/:id", auth, async (req, res) => {
  const current = (await pool.query("SELECT data FROM whiteboard_notes WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!current) return res.status(404).json({ error: "No existe" });
  if (current.createdBy !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Solo quien creó la nota (o un administrador) puede eliminarla" });
  await pool.query("DELETE FROM whiteboard_notes WHERE id=$1", [req.params.id]);
  res.status(204).end();
});

app.post("/api/budgets", auth, requireRole("admin", "gerente"), apiRateLimit(60), async (req, res) => {
  const budget = normalizeBudget(req.body);
  if (budget.stage === "Pagado") return res.status(400).json({ error: "El estado Pagado se asigna automáticamente al registrar el cobro completo." });
  if (!String(budget.client || "").trim() || !String(budget.title || "").trim()) return res.status(400).json({ error: "Cliente y nombre del presupuesto son obligatorios." });
  if (!budget.id) {
    const year = new Date().getFullYear();
    const rows = (await pool.query("SELECT id FROM budgets WHERE id LIKE $1", [`PRES-${year}-%`])).rows;
    const next = Math.max(0, ...rows.map((row) => Number(String(row.id).split("-").pop()) || 0)) + 1;
    budget.id = `PRES-${year}-${String(next).padStart(3, "0")}`;
  }
  budget.number = budget.number || budget.id;
  if (["Aprobado", "Facturado", "Pagado"].includes(budget.stage) && !budget.purchaseOrderNumber) return res.status(400).json({ error: "El número de OC del cliente es obligatorio para aprobar el presupuesto." });
  if (["Aprobado", "Facturado", "Pagado"].includes(budget.stage) && (budget.amount - budget.estimatedCost) < 0 && !budget.negativeMarginReason) return res.status(400).json({ error: "El margen es negativo: indica el motivo para aprobar este presupuesto." });
  if (budget.stage === "Rechazado" && !budget.rejectionReason) return res.status(400).json({ error: "Indica el motivo del rechazo: es lo que permite analizar por qué se pierden oportunidades." });
  if (["Facturado", "Pagado"].includes(budget.stage) && (!String(budget.invoicedAt || "").trim() || !String(budget.invoiceNumber || "").trim())) return res.status(400).json({ error: "Fecha y número de factura son obligatorios al marcar el presupuesto como Facturado." });
  if (["Facturado", "Pagado"].includes(budget.stage) && (await pool.query("SELECT id FROM financial_movements WHERE data->>'kind'='invoice' AND data->>'invoiceNumber'=$1 LIMIT 1", [String(budget.invoiceNumber).trim()])).rows[0]) return res.status(409).json({ error: "Ya existe una factura con ese número." });
  const duplicateNumber = (await pool.query("SELECT id FROM budgets WHERE id=$1 OR data->>'number'=$1 LIMIT 1", [budget.number])).rows[0];
  if (duplicateNumber) return res.status(409).json({ error: "Ya existe un presupuesto con ese número." });
  budget.createdAt = budget.createdAt || new Date().toISOString();
  budget.additionalCosts = budget.additionalCosts.map((cost, index) => ({ ...cost, id: `AC-${budget.id}-${Date.now()}-${index}`, createdAt: new Date().toISOString(), createdBy: req.user.id, createdByName: req.user.name }));
  budget.additionalCostTotal = Math.round(budget.additionalCosts.reduce((sum, cost) => sum + cost.amount, 0) * 100) / 100;
  budget.totalEstimatedCost = Math.round((budget.estimatedCost + budget.additionalCostTotal) * 100) / 100;
  if (["Aprobado", "Facturado", "Pagado"].includes(budget.stage)) budget.commercialLockedAt = new Date().toISOString();
  if (["Facturado", "Pagado"].includes(budget.stage)) { budget.approvedAt = budget.approvedAt || new Date().toISOString(); budget.invoicedAt = String(budget.invoicedAt).slice(0, 10); }
  budget.activity = [...(budget.activity || []), { type: "created", text: "Presupuesto creado", by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("INSERT INTO budgets(id,data) VALUES($1,$2)", [budget.id, budget]);
    const generatedInvoice = await upsertBudgetInvoice(budget, req.user, db);
    await db.query("COMMIT");
    res.json({ ...budget, _generatedInvoice: generatedInvoice });
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "Ya existe un presupuesto con ese identificador." });
    if (error.message === "DUPLICATE_INVOICE") return res.status(409).json({ error: "Ya existe una factura con ese número." });
    return res.status(500).json({ error: "No se pudo guardar el presupuesto y su factura de forma consistente." });
  } finally { db.release(); }
});

app.patch("/api/budgets/:id", auth, requireRole("admin", "gerente"), apiRateLimit(60), async (req, res) => {
  const current = (await pool.query("SELECT data FROM budgets WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!current) return res.status(404).json({ error: "No existe" });
  const budget = normalizeBudget(req.body, current);
  if (req.body?.stage === "Pagado" && current.stage !== "Pagado") return res.status(400).json({ error: "El estado Pagado se asigna automáticamente al registrar el cobro completo." });
  if (current.stage === "Pagado" && budget.stage !== "Pagado") return res.status(409).json({ error: "Un presupuesto pagado no puede cambiarse manualmente. Edita o elimina el ingreso asociado para recalcular su estado." });
  const wasCommerciallyLocked = Boolean(current.commercialLockedAt || ["Aprobado", "Facturado", "Pagado"].includes(current.stage));
  const currentAdditionalCosts = Array.isArray(current.additionalCosts) ? current.additionalCosts.map(normalizeAdditionalCost) : [];
  const currentCostIds = new Set(currentAdditionalCosts.map((cost) => cost.id));
  const appendedCosts = (Array.isArray(req.body?.additionalCosts) ? req.body.additionalCosts : []).map(normalizeAdditionalCost).filter((cost) => cost.description && cost.amount > 0 && !currentCostIds.has(cost.id)).map((cost, index) => ({ ...cost, id: `AC-${req.params.id}-${Date.now()}-${index}`, createdAt: new Date().toISOString(), createdBy: req.user.id, createdByName: req.user.name }));
  budget.additionalCosts = [...currentAdditionalCosts, ...appendedCosts];
  if (wasCommerciallyLocked) {
    budget.targetMargin = current.targetMargin;
    budget.items = current.items;
    budget.amount = current.amount;
    budget.estimatedCost = current.estimatedCost;
  }
  budget.additionalCostTotal = Math.round(budget.additionalCosts.reduce((sum, cost) => sum + cost.amount, 0) * 100) / 100;
  budget.totalEstimatedCost = Math.round(((Number(budget.estimatedCost) || 0) + budget.additionalCostTotal) * 100) / 100;
  budget.commercialLockedAt = current.commercialLockedAt || (wasCommerciallyLocked ? current.approvedAt || new Date().toISOString() : ["Aprobado", "Facturado", "Pagado"].includes(budget.stage) ? new Date().toISOString() : "");
  budget.id = req.params.id;
  budget.number = budget.number || budget.id;
  if (["Aprobado", "Facturado", "Pagado"].includes(budget.stage) && !budget.purchaseOrderNumber) return res.status(400).json({ error: "El número de OC del cliente es obligatorio para aprobar el presupuesto." });
  if (["Aprobado", "Facturado", "Pagado"].includes(budget.stage) && (budget.amount - budget.estimatedCost) < 0 && !budget.negativeMarginReason) return res.status(400).json({ error: "El margen es negativo: indica el motivo para aprobar este presupuesto." });
  if (budget.stage === "Rechazado" && !budget.rejectionReason) return res.status(400).json({ error: "Indica el motivo del rechazo: es lo que permite analizar por qué se pierden oportunidades." });
  if (["Facturado", "Pagado"].includes(budget.stage) && (!String(budget.invoicedAt || "").trim() || !String(budget.invoiceNumber || "").trim())) return res.status(400).json({ error: "Fecha y número de factura son obligatorios al marcar el presupuesto como Facturado." });
  if (["Facturado", "Pagado"].includes(budget.stage)) { const currentInvoiceId = (await pool.query("SELECT id FROM financial_movements WHERE data->>'sourceBudgetId'=$1 LIMIT 1", [budget.id])).rows[0]?.id; const duplicateInvoice = (await pool.query("SELECT id FROM financial_movements WHERE data->>'kind'='invoice' AND data->>'invoiceNumber'=$1 AND ($2::text IS NULL OR id<>$2) LIMIT 1", [String(budget.invoiceNumber).trim(), currentInvoiceId || null])).rows[0]; if (duplicateInvoice) return res.status(409).json({ error: "Ya existe una factura con ese número." }); }
  const duplicateNumber = (await pool.query("SELECT id FROM budgets WHERE id<>$2 AND (id=$1 OR data->>'number'=$1) LIMIT 1", [budget.number, req.params.id])).rows[0];
  if (duplicateNumber) return res.status(409).json({ error: "Ya existe un presupuesto con ese número." });
  const changes = [];
  if ((budget.number || budget.id) !== (current.number || current.id)) changes.push(`Número: ${current.number || current.id} → ${budget.number}`);
  if (budget.stage !== current.stage) changes.push(`Estado: ${current.stage} → ${budget.stage}`);
  if (budget.purchaseOrderNumber !== current.purchaseOrderNumber) changes.push(`OC cliente: ${budget.purchaseOrderNumber || "sin asignar"}`);
  if (appendedCosts.length) changes.push(`${appendedCosts.length} costo(s) adicional(es): USD ${appendedCosts.reduce((sum, cost) => sum + cost.amount, 0).toFixed(2)}`);
  if (budget.nextFollowUp !== current.nextFollowUp || budget.nextAction !== current.nextAction) changes.push("Seguimiento actualizado");
  if (!changes.length) changes.push("Presupuesto actualizado");
  budget.activity = [...(current.activity || []), { type: "update", text: changes.join(" · "), by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  if (budget.stage === "Enviado" && !budget.sentAt) budget.sentAt = new Date().toISOString();
  if (budget.stage === "Aprobado" && !budget.approvedAt) budget.approvedAt = new Date().toISOString();
  if (["Facturado", "Pagado"].includes(budget.stage)) { budget.approvedAt = budget.approvedAt || new Date().toISOString(); budget.invoicedAt = String(budget.invoicedAt).slice(0, 10); }
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("UPDATE budgets SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, budget]);
    if (["Aprobado", "Facturado", "Pagado"].includes(budget.stage) && budget.projectId) {
      const project = (await db.query("SELECT data FROM projects WHERE id=$1", [budget.projectId])).rows[0]?.data;
      if (project) {
        const linkedProject = { ...project, budgetId: budget.id, clientId: budget.clientId || project.clientId || "", client: budget.client || project.client || "", site: budget.site || project.site || "", purchaseOrderNumber: budget.purchaseOrderNumber || "", purchaseOrderDate: budget.purchaseOrderDate || "" };
        await db.query("UPDATE projects SET data=$2, updated_at=now() WHERE id=$1", [budget.projectId, linkedProject]);
        const financeLink = JSON.stringify({ budgetId: budget.id, budgetNumber: budget.number || budget.id, budgetTitle: budget.title || "", purchaseOrderNumber: budget.purchaseOrderNumber || "", purchaseOrderDate: budget.purchaseOrderDate || "", clientId: linkedProject.clientId, clientName: linkedProject.client, linkageSource: "approved-project-budget", linkedAt: new Date().toISOString() });
        await db.query("UPDATE financial_movements SET data=data || $2::jsonb, updated_at=now() WHERE data->>'kind'='expense' AND data->>'projectId'=$1", [budget.projectId, financeLink]);
      }
    }
    const generatedInvoice = await upsertBudgetInvoice(budget, req.user, db);
    await db.query("COMMIT");
    res.json({ ...budget, _generatedInvoice: generatedInvoice });
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.message === "DUPLICATE_INVOICE") return res.status(409).json({ error: "Ya existe una factura con ese número." });
    return res.status(500).json({ error: "No se pudo actualizar el presupuesto y sus vínculos de forma consistente." });
  } finally { db.release(); }
});

app.delete("/api/budgets/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const budget = (await db.query("SELECT data FROM budgets WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0]?.data;
    if (!budget) { await db.query("ROLLBACK"); return res.status(404).json({ error: "No existe" }); }
    const removedInvoices = (await db.query("DELETE FROM financial_movements WHERE data->>'sourceBudgetId'=$1 RETURNING id", [req.params.id])).rows.map((row) => row.id);
    const linkedProjects = (await db.query("SELECT id,data FROM projects WHERE data->>'budgetId'=$1", [req.params.id])).rows;
    for (const row of linkedProjects) {
      const { budgetId, ...project } = row.data;
      await db.query("UPDATE projects SET data=$2, updated_at=now() WHERE id=$1", [row.id, project]);
    }
    const linkedOrders = (await db.query("SELECT id,data FROM orders WHERE data->>'budgetId'=$1", [req.params.id])).rows;
    for (const row of linkedOrders) await db.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [row.id, { ...row.data, budgetId: "", formerBudgetNumber: row.data.budgetNumber || budget.number || budget.id }]);
    const linkedMovements = (await db.query("SELECT id,data FROM financial_movements WHERE data->>'budgetId'=$1", [req.params.id])).rows;
    for (const row of linkedMovements) {
      const { budgetId, linkageSource, linkedAt, ...movement } = row.data;
      await db.query("UPDATE financial_movements SET data=$2, updated_at=now() WHERE id=$1", [row.id, { ...movement, formerBudgetNumber: row.data.budgetNumber || budget.number || budget.id }]);
    }
    await db.query("DELETE FROM budgets WHERE id=$1", [req.params.id]);
    await db.query("COMMIT");
    res.json({ deleted: true, removedInvoices });
  } catch (error) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: "No se pudo eliminar el presupuesto y su factura asociada." });
  } finally {
    db.release();
  }
});

app.post("/api/budgets/:id/convert", auth, requireRole("admin", "gerente"), async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const budget = (await db.query("SELECT data FROM budgets WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0]?.data;
    if (!budget) { await db.query("ROLLBACK"); return res.status(404).json({ error: "No existe" }); }
    if (!["Aprobado", "Facturado", "Pagado"].includes(budget.stage) || !String(budget.purchaseOrderNumber || "").trim()) { await db.query("ROLLBACK"); return res.status(400).json({ error: "El presupuesto debe estar aprobado y tener una OC del cliente antes de crear el proyecto." }); }
    if (budget.projectId) {
      const existing = (await db.query("SELECT data FROM projects WHERE id=$1", [budget.projectId])).rows[0]?.data;
      await db.query("COMMIT");
      return res.json({ budget, project: existing });
    }
    const projectId = "p" + Date.now();
    const rawKey = String(req.body?.key || budget.title || "PRJ").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    const key = await uniqueProjectKey(rawKey || "PRJ", db);
    const monitors = (await db.query("SELECT id FROM users WHERE active=true AND role='monitor_oficina'")).rows.map((row) => row.id);
    const project = { id: projectId, key, name: budget.title, color: req.body?.color || "#F18700", allowedUsers: monitors, budgetId: budget.id, clientId: budget.clientId || "", client: budget.client, site: budget.site || "", plannedStart: budget.plannedStart || "", plannedEnd: budget.plannedEnd || "", estimatedAmount: budget.amount, currency: "USD", purchaseOrderNumber: budget.purchaseOrderNumber || "", purchaseOrderDate: budget.purchaseOrderDate || "" };
    await db.query("INSERT INTO projects(id,data) VALUES($1,$2)", [projectId, project]);
    const updated = { ...budget, stage: ["Facturado", "Pagado"].includes(budget.stage) ? budget.stage : "Aprobado", probability: 100, projectId, approvedAt: budget.approvedAt || new Date().toISOString(), activity: [...(budget.activity || []), { type: "converted", text: `Convertido en proyecto ${key}`, by: req.user.id, byName: req.user.name, at: new Date().toISOString() }] };
    await db.query("UPDATE budgets SET data=$2, updated_at=now() WHERE id=$1", [budget.id, updated]);
    if (["Facturado", "Pagado"].includes(updated.stage)) await upsertBudgetInvoice(updated, req.user, db);
    await db.query("COMMIT");
    res.json({ budget: updated, project });
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.message === "DUPLICATE_INVOICE") return res.status(409).json({ error: "Ya existe una factura con ese número." });
    throw error;
  } finally { db.release(); }
});

/* ------------------------------------------------ Finanzas ------------------------------------------------ */
const FINANCE_KINDS = ["expense", "income", "invoice"];
const FINANCE_CURRENCIES = ["ARS", "USD", "EUR"];
let wholesaleRateCache = null;
const WHOLESALE_RATE_CACHE_MS = 60 * 60 * 1000; // 1 hora
app.get("/api/exchange-rates/wholesale", auth, requireRole("admin", "gerente"), async (req, res) => {
  // El botón de refrescar manda force=1: sin esto el pedido caía en la caché del servidor y la
  // pantalla no cambiaba nada, dando la impresión de que la cotización no se actualizaba nunca.
  const force = req.query.force === "1";
  if (!force && wholesaleRateCache && Date.now() - wholesaleRateCache.cachedAt < WHOLESALE_RATE_CACHE_MS)
    return res.json({ ...wholesaleRateCache.data, fetchedAt: new Date(wholesaleRateCache.cachedAt).toISOString() });
  try {
    const response = await fetch("https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/5?limit=1", { headers: { Accept: "application/json", "User-Agent": "OrdenGO/1.0" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const quote = payload?.results?.[0]?.detalle?.[0];
    const value = Number(quote?.valor);
    if (!(value > 0) || !quote?.fecha) throw new Error("Cotización inválida");
    // updatedAt identifica el día hábil publicado; fetchedAt, cuándo se realizó la consulta.
    const data = { currency: "USD", arsPerUsd: value, buy: null, sell: value, updatedAt: `${quote.fecha}T00:00:00-03:00`, source: "Banco Central de la República Argentina", sourceLabel: "Dólar mayorista · Comunicación A 3500", sourceUrl: "https://www.bcra.gob.ar/principales-variables/", variableId: 5 };
    wholesaleRateCache = { cachedAt: Date.now(), data };
    res.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    if (wholesaleRateCache?.data) return res.json({ ...wholesaleRateCache.data, fetchedAt: new Date(wholesaleRateCache.cachedAt).toISOString(), stale: true });
    res.status(503).json({ error: "No fue posible obtener el tipo de cambio mayorista A 3500 del BCRA. Intenta nuevamente." });
  }
});
const MAX_MOVEMENT_ATTACHMENTS = 8;
const MAX_MOVEMENT_ATTACHMENT_CHARS = 18 * 1024 * 1024; // el body de express admite 24 MB
// Un gasto cargado dos veces (mismo proveedor, mismo comprobante) infla el resultado operativo,
// el flujo de caja, la concentración por proveedor y el crédito fiscal de IVA. Con carga por OCR
// desde el celular y varias personas subiendo comprobantes, es de los errores más probables.
// No se bloquea —una nota de débito puede reutilizar el número, y una recarga tras corregir un
// dato es legítima— pero no puede pasar en silencio: exige confirmación explícita.
async function findDuplicateExpense(movement, excludeId = "") {
  const receipt = String(movement.receiptNumber || "").trim().toLowerCase();
  if (movement.kind !== "expense" || !receipt) return null;
  const supplier = String(movement.supplier || "").trim().toLowerCase();
  const row = (await pool.query(
    `SELECT data FROM financial_movements
      WHERE id <> $3 AND data->>'kind' = 'expense'
        AND lower(trim(coalesce(data->>'receiptNumber', ''))) = $1
        AND lower(trim(coalesce(data->>'supplier', ''))) = $2
      LIMIT 1`,
    [receipt, supplier, excludeId || ""])).rows[0];
  return row?.data || null;
}
const duplicateExpenseResponse = (duplicate) => ({
  error: "Ya existe un gasto cargado con ese comprobante para el mismo proveedor.",
  duplicateOf: {
    id: duplicate.id, date: duplicate.date, concept: duplicate.concept,
    supplier: duplicate.supplier || "", receiptNumber: duplicate.receiptNumber || "",
    amount: duplicate.amount, currency: duplicate.currency, amountUsd: duplicate.amountUsd,
  },
});

const normalizeFinancialMovement = (input, previous = {}) => {
  const movement = { ...previous, ...(input || {}) };
  delete movement._updatedAt;
  // Bandera de la petición, no un dato del movimiento: no debe quedar guardada.
  delete movement.confirmDuplicate;
  // Un gasto suele necesitar más de un respaldo (factura + cupón de tarjeta + remito). Se guardan
  // en `attachments`; los movimientos viejos traen un único adjunto suelto y se migran acá, y se
  // sigue publicando el primero en attachmentUrl/attachmentName por compatibilidad.
  const legacy = movement.attachmentUrl ? [{ url: movement.attachmentUrl, name: movement.attachmentName || "Comprobante" }] : [];
  movement.attachments = (Array.isArray(movement.attachments) ? movement.attachments : legacy)
    .filter((item) => typeof item?.url === "string" && item.url.startsWith("data:"))
    .slice(0, MAX_MOVEMENT_ATTACHMENTS)
    .map((item, index) => ({ url: item.url, name: String(item.name || `Documento ${index + 1}`).slice(0, 120) }));
  movement.attachmentUrl = movement.attachments[0]?.url || "";
  movement.attachmentName = movement.attachments[0]?.name || "";
  movement.kind = FINANCE_KINDS.includes(movement.kind) ? movement.kind : "expense";
  movement.currency = FINANCE_CURRENCIES.includes(movement.currency) ? movement.currency : "USD";
  movement.amount = Math.max(0, Number(movement.amount) || 0);
  movement.exchangeRate = movement.currency === "USD" ? 1 : Math.max(0, Number(movement.exchangeRate) || 0);
  movement.amountUsd = movement.currency === "USD" ? movement.amount : movement.exchangeRate > 0 ? movement.amount / movement.exchangeRate : 0;
  movement.amountUsd = Math.round(movement.amountUsd * 1000000) / 1000000;
  if (movement.kind === "invoice") {
    movement.vatRate = 21;
    movement.netAmountUsd = Math.round(movement.amountUsd * 100) / 100;
    movement.vatAmountUsd = Math.round(movement.netAmountUsd * movement.vatRate) / 100;
    movement.grossAmountUsd = Math.round((movement.netAmountUsd + movement.vatAmountUsd) * 100) / 100;
  } else if (movement.kind === "income") {
    // "paid" declara cancelación total de la factura/presupuesto; "partial" registra un anticipo.
    // La distinción es necesaria porque las retenciones pueden hacer que el banco reciba menos que
    // el total facturado sin que exista saldo comercial pendiente.
    movement.paymentStatus = movement.paymentStatus === "partial" ? "partial" : "paid";
    // Un aviso de pago suele cancelar varias facturas de una vez, cada una con su propia retención
    // (ver formato de aviso ACH: Documento / Su documento / Deducciones / Importe bruto).
    // `allocations` guarda esas partidas; el proyecto y el presupuesto se heredan de cada factura.
    const toUsd = (value) => {
      const usd = movement.currency === "USD" ? value : movement.exchangeRate > 0 ? value / movement.exchangeRate : 0;
      return Math.round(usd * 1000000) / 1000000;
    };
    movement.allocations = (Array.isArray(movement.allocations) ? movement.allocations : [])
      .map((allocation) => {
        const amount = Math.max(0, Number(allocation?.amount) || 0);
        const deductions = Math.max(0, Number(allocation?.deductions) || 0);
        return {
          invoiceId: allocation?.invoiceId || "",
          receiptNumber: String(allocation?.receiptNumber || "").trim(),
          projectId: allocation?.projectId || "",
          budgetId: allocation?.budgetId || "",
          amount, deductions,
          amountUsd: toUsd(amount),
          deductionsUsd: toUsd(deductions),
          netAmountUsd: toUsd(Math.max(0, amount - deductions)),
        };
      })
      .filter((allocation) => allocation.amount > 0);
    // Con partidas cargadas, los totales del movimiento se derivan de ellas: así el encabezado no
    // puede quedar desincronizado del detalle por una edición parcial.
    if (movement.allocations.length) {
      movement.amount = Math.round(movement.allocations.reduce((sum, a) => sum + a.amount, 0) * 100) / 100;
      movement.deductions = Math.round(movement.allocations.reduce((sum, a) => sum + a.deductions, 0) * 100) / 100;
      movement.amountUsd = toUsd(movement.amount);
    } else {
      movement.deductions = Math.max(0, Number(movement.deductions) || 0);
    }
    movement.deductionsUsd = toUsd(movement.deductions);
    movement.netAmountUsd = Math.round(Math.max(0, movement.amountUsd - movement.deductionsUsd) * 1000000) / 1000000;
  } else if (movement.kind === "expense") {
    // El importe cargado es el total pagado (IVA incluido si corresponde). Se descompone para
    // poder calcular crédito fiscal, sin alterar el monto en caja que efectivamente salió.
    movement.vatIncluded = Boolean(movement.vatIncluded);
    movement.vatRate = movement.vatIncluded ? 21 : 0;
    movement.grossAmountUsd = movement.amountUsd;
    movement.netAmountUsd = movement.vatIncluded ? Math.round((movement.amountUsd / (1 + movement.vatRate / 100)) * 100) / 100 : movement.amountUsd;
    movement.vatAmountUsd = movement.vatIncluded ? Math.round((movement.grossAmountUsd - movement.netAmountUsd) * 100) / 100 : 0;
    movement.paymentStatus = ["paid", "pending"].includes(movement.paymentStatus) ? movement.paymentStatus : "paid";
    movement.paidAt = movement.paymentStatus === "paid" ? String(movement.paidAt || movement.date || "").slice(0, 10) : "";
  }
  return movement;
};

const applyApprovedBudgetLink = async (movement) => {
  if (!movement.projectId) return movement;
  const project = (await pool.query("SELECT data FROM projects WHERE id=$1", [movement.projectId])).rows[0]?.data;
  if (!project) return movement;
  let budget = null;
  if (project.budgetId) budget = (await pool.query("SELECT data FROM budgets WHERE id=$1", [project.budgetId])).rows[0]?.data || null;
  if (!budget || !["Aprobado", "Facturado", "Pagado"].includes(budget.stage)) budget = (await pool.query("SELECT data FROM budgets WHERE data->>'projectId'=$1 AND data->>'stage' IN ('Aprobado','Facturado','Pagado') ORDER BY updated_at DESC LIMIT 1", [movement.projectId])).rows[0]?.data || null;
  movement.clientId = project.clientId || budget?.clientId || movement.clientId || "";
  movement.clientName = project.client || budget?.client || movement.clientName || "";
  if (["Aprobado", "Facturado", "Pagado"].includes(budget?.stage)) {
    movement.budgetId = budget.id;
    movement.budgetNumber = budget.number || budget.id;
    movement.budgetTitle = budget.title || "";
    movement.purchaseOrderNumber = budget.purchaseOrderNumber || project.purchaseOrderNumber || "";
    movement.purchaseOrderDate = budget.purchaseOrderDate || project.purchaseOrderDate || "";
    movement.linkageSource = "approved-project-budget";
    movement.linkedAt = movement.linkedAt || new Date().toISOString();
  } else {
    movement.budgetId = "";
    movement.budgetNumber = "";
    movement.budgetTitle = "";
    movement.linkageSource = "project-without-approved-budget";
  }
  return movement;
};

app.post("/api/finances", auth, requireRole("admin", "gerente"), async (req, res) => {
  const movement = await applyApprovedBudgetLink(normalizeFinancialMovement(req.body));
  if (!String(movement.concept || "").trim() || movement.amount <= 0 || !movement.date) return res.status(400).json({ error: "Concepto, importe y fecha son obligatorios." });
  if (movement.currency !== "USD" && !movement.exchangeRate) return res.status(400).json({ error: "Indica el tipo de cambio para calcular el equivalente en USD." });
  if (movement.attachments.reduce((sum, item) => sum + item.url.length, 0) > MAX_MOVEMENT_ATTACHMENT_CHARS) return res.status(413).json({ error: "Los documentos adjuntos superan el tamaño permitido. Quita alguno o reducí su peso." });
  if (movement.kind === "invoice" && !String(movement.invoiceNumber || movement.receiptNumber || "").trim()) return res.status(400).json({ error: "Indica el número de factura." });
  if (!req.body?.confirmDuplicate) {
    const duplicate = await findDuplicateExpense(movement);
    if (duplicate) return res.status(409).json(duplicateExpenseResponse(duplicate));
  }
  if (movement.kind === "invoice") {
    movement.invoiceNumber = String(movement.invoiceNumber || movement.receiptNumber).trim();
    movement.receiptNumber = movement.invoiceNumber;
    movement.paymentStatus = movement.paymentStatus || "pending";
    const duplicateInvoice = (await pool.query("SELECT id FROM financial_movements WHERE data->>'kind'='invoice' AND data->>'invoiceNumber'=$1 LIMIT 1", [movement.invoiceNumber])).rows[0];
    if (duplicateInvoice) return res.status(409).json({ error: "Ya existe una factura con ese número." });
  }
  if (!movement.id) {
    const year = new Date().getFullYear();
    const rows = (await pool.query("SELECT id FROM financial_movements WHERE id LIKE $1", [`MOV-${year}-%`])).rows;
    const next = Math.max(0, ...rows.map((row) => Number(String(row.id).split("-").pop()) || 0)) + 1;
    movement.id = `MOV-${year}-${String(next).padStart(4, "0")}`;
  }
  movement.createdAt = movement.createdAt || new Date().toISOString();
  movement.createdBy = movement.createdBy || req.user.id;
  movement.createdByName = movement.createdByName || req.user.name;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("INSERT INTO financial_movements(id,data) VALUES($1,$2)", [movement.id, movement]);
    const updatedBudgets = movement.kind === "income" ? await syncBudgetPaymentStatuses(movementBudgetIds(movement), db, req.user) : [];
    await db.query("COMMIT");
    res.json({ ...movement, _updatedBudgets: updatedBudgets });
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "Ya existe un movimiento con ese identificador" });
    throw error;
  } finally { db.release(); }
});

app.get("/api/finances/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const movement = (await pool.query("SELECT data FROM financial_movements WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!movement) return res.status(404).json({ error: "No existe" });
  res.json(movement);
});

app.patch("/api/finances/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const current = (await pool.query("SELECT data FROM financial_movements WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!current) return res.status(404).json({ error: "No existe" });
  const isAutoGenerated = !!(current.sourceOrderId || current.sourcePurchaseOrderId);
  const patchKeys = Object.keys(req.body || {});
  const onlyPaymentFields = patchKeys.length > 0 && patchKeys.every((key) => ["paymentStatus", "paidAt"].includes(key));
  // Los gastos generados automáticamente (desde una OT o una OC) no se editan a mano, salvo su
  // estado de pago: eso sí se necesita poder confirmarlo, y queda la fecha de pago para trazabilidad.
  if (isAutoGenerated && onlyPaymentFields) {
    const paymentStatus = req.body.paymentStatus === "pending" ? "pending" : "paid";
    const movement = { ...current, paymentStatus, paidAt: paymentStatus === "paid" ? String(req.body.paidAt || new Date().toISOString().slice(0, 10)) : "", updatedBy: req.user.id, updatedByName: req.user.name, updatedAt: new Date().toISOString() };
    await pool.query("UPDATE financial_movements SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, movement]);
    return res.json(movement);
  }
  if (current.sourceOrderId) return res.status(409).json({ error: "Este gasto se genera automáticamente desde la orden de trabajo y no se edita manualmente." });
  if (current.sourcePurchaseOrderId) return res.status(409).json({ error: "Este gasto se genera automáticamente desde la orden de compra y no se edita manualmente." });
  const movement = await applyApprovedBudgetLink(normalizeFinancialMovement(req.body, current));
  movement.id = req.params.id;
  if (!String(movement.concept || "").trim() || movement.amount <= 0 || !movement.date) return res.status(400).json({ error: "Concepto, importe y fecha son obligatorios." });
  if (movement.currency !== "USD" && !movement.exchangeRate) return res.status(400).json({ error: "Indica el tipo de cambio para calcular el equivalente en USD." });
  if (movement.attachments.reduce((sum, item) => sum + item.url.length, 0) > MAX_MOVEMENT_ATTACHMENT_CHARS) return res.status(413).json({ error: "Los documentos adjuntos superan el tamaño permitido. Quita alguno o reducí su peso." });
  if (!req.body?.confirmDuplicate) {
    const duplicate = await findDuplicateExpense(movement, req.params.id);
    if (duplicate) return res.status(409).json(duplicateExpenseResponse(duplicate));
  }
  if (movement.kind === "invoice") {
    movement.invoiceNumber = String(movement.invoiceNumber || movement.receiptNumber || "").trim();
    if (!movement.invoiceNumber) return res.status(400).json({ error: "Indica el número de factura." });
    movement.receiptNumber = movement.invoiceNumber;
    const duplicateInvoice = (await pool.query("SELECT id FROM financial_movements WHERE id<>$2 AND data->>'kind'='invoice' AND data->>'invoiceNumber'=$1 LIMIT 1", [movement.invoiceNumber, req.params.id])).rows[0];
    if (duplicateInvoice) return res.status(409).json({ error: "Ya existe una factura con ese número." });
  }
  movement.updatedBy = req.user.id; movement.updatedByName = req.user.name; movement.updatedAt = new Date().toISOString();
  const affectedBudgetIds = [...new Set([...movementBudgetIds(current), ...movementBudgetIds(movement)])];
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("UPDATE financial_movements SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, movement]);
    const updatedBudgets = (current.kind === "income" || movement.kind === "income") ? await syncBudgetPaymentStatuses(affectedBudgetIds, db, req.user) : [];
    await db.query("COMMIT");
    res.json({ ...movement, _updatedBudgets: updatedBudgets });
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
});

app.delete("/api/finances/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const movement = (await pool.query("SELECT data FROM financial_movements WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (movement?.sourceBudgetId) return res.status(409).json({ error: "Esta factura se administra desde el presupuesto. Cambia su etapa para quitarla de Finanzas." });
  if (movement?.sourceOrderId) return res.status(409).json({ error: "Este gasto se genera automáticamente desde la orden de trabajo. Se actualiza o se quita solo si la OT deja de estar aprobada o vinculada a un proyecto." });
  if (movement?.sourcePurchaseOrderId) return res.status(409).json({ error: "Este gasto se genera automáticamente desde la orden de compra. Cambia su estado para quitarla de Finanzas." });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("DELETE FROM financial_movements WHERE id=$1", [req.params.id]);
    const updatedBudgets = movement?.kind === "income" ? await syncBudgetPaymentStatuses(movementBudgetIds(movement), db, req.user) : [];
    await db.query("COMMIT");
    res.json({ deleted: true, _updatedBudgets: updatedBudgets });
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
});
// Duplica un proyecto con todas sus tareas; permite renombrar, cambiar clave, accesos y reasignar
app.post("/api/projects/:id/duplicate", auth, requireRole("admin", "gerente"), async (req, res) => {
  const src = (await pool.query("SELECT data FROM projects WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!src) return res.status(404).json({ error: "No existe" });
  const body = req.body || {};
  const newId = "p" + Date.now();
  const assignee = body.assignee || null;                 // reasignar todas las tareas (opcional)
  if (assignee && !(await assigneeIsAllowed(assignee))) return res.status(400).json({ error: "El responsable seleccionado no admite asignación de tareas" });
  const resetStatus = body.resetStatus !== false;         // por defecto, arranca en "Por hacer"
  const allowedUsers = Array.isArray(body.allowedUsers) ? body.allowedUsers : (assignee ? [assignee] : (src.allowedUsers || []));
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const key = await uniqueProjectKey(body.key || src.key || "PRJ", db);
    const project = { ...src, id: newId, key, name: body.name || `${src.name} (copia)`, allowedUsers };
    await db.query("INSERT INTO projects(id,data) VALUES($1,$2)", [newId, project]);
    const srcTasks = (await db.query("SELECT data FROM tasks WHERE data->>'project'=$1", [req.params.id])).rows.map((r) => r.data)
      .sort((a, b) => (parseInt(String(a.id).split("-")[1], 10) || 0) - (parseInt(String(b.id).split("-")[1], 10) || 0));
    const newTasks = [];
    let i = 1;
    for (const t of srcTasks) {
      const nt = { ...t, id: `${key}-${i}`, project: newId, color: project.color, activity: [], createdAt: new Date().toISOString() };
      if (assignee) nt.assignee = assignee;
      if (resetStatus) nt.status = "Por hacer";
      delete nt._updatedAt;
      await db.query("INSERT INTO tasks(id,data) VALUES($1,$2)", [nt.id, nt]);
      newTasks.push(nt); i++;
    }
    await db.query("COMMIT");
    if (assignee) { await notify(assignee, `Se te asignó el proyecto ${project.name} (${newTasks.length} tareas)`, null); notifyProjectAssignmentEmail(assignee, project, newTasks.length); }
    res.json({ project, tasks: newTasks });
  } catch (error) { await db.query("ROLLBACK"); res.status(500).json({ error: "No se pudo duplicar el proyecto sin conflictos" }); }
  finally { db.release(); }
});

/* ------------------------------------------------ Repuestos / Inventario ------------------------------------------------ */
app.post("/api/parts", auth, requireRole("admin", "gerente"), async (req, res) => {
  const p = { ...(req.body || {}) }; if (!p.id) p.id = "sp" + Date.now();
  p.name = String(p.name || "").trim();
  if (!p.name) return res.status(400).json({ error: "El nombre del repuesto es obligatorio" });
  p.category = MATERIAL_LIST_DISCIPLINES.includes(p.category) ? p.category : "Otro";
  ["price", "cost"].forEach((k) => { if (p[k] !== undefined) p[k] = wholeMoneyValue(p[k]); });
  ["stock", "minStock"].forEach((k) => { if (p[k] !== undefined) p[k] = Number(p[k]) || 0; });
  try { await pool.query("INSERT INTO parts(id,data) VALUES($1,$2)", [p.id, p]); }
  catch (error) { if (error.code === "23505") return res.status(409).json({ error: "Ya existe un repuesto con ese identificador" }); throw error; }
  res.json(p);
});
app.patch("/api/parts/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM parts WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  const patch = { ...(req.body || {}) };
  if (patch.category !== undefined) patch.category = MATERIAL_LIST_DISCIPLINES.includes(patch.category) ? patch.category : "Otro";
  ["price", "cost"].forEach((k) => { if (patch[k] !== undefined) patch[k] = wholeMoneyValue(patch[k]); });
  ["stock", "minStock"].forEach((k) => { if (patch[k] !== undefined) patch[k] = Number(patch[k]) || 0; });
  const merged = { ...rows[0].data, ...patch, id: req.params.id };
  await pool.query("UPDATE parts SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
  res.json(merged);
});
app.delete("/api/parts/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  // Clientes y proveedores ya se protegían contra el borrado con registros vinculados; los
  // materiales no. Al borrar uno referenciado, adjustPartStock encuentra la fila vacía y sale sin
  // hacer nada: la OT se completa o la OC se recibe y el stock NO se mueve, sin error ni aviso.
  // Solo se bloquea cuando el movimiento de stock todavía está pendiente — las referencias
  // históricas ya se aplicaron y borrar el material no altera nada.
  const reference = JSON.stringify([{ partId: req.params.id }]);
  const [orders, purchases] = await Promise.all([
    pool.query("SELECT count(*)::int count FROM orders WHERE data->'materials' @> $1::jsonb AND data->>'stockDeductedAt' IS NULL", [reference]),
    pool.query("SELECT count(*)::int count FROM purchase_orders WHERE data->'items' @> $1::jsonb AND data->>'stockAppliedAt' IS NULL AND data->>'stage' <> 'Cancelada'", [reference]),
  ]);
  const pendingOrders = Number(orders.rows[0]?.count || 0);
  const pendingPurchases = Number(purchases.rows[0]?.count || 0);
  if (pendingOrders || pendingPurchases) {
    const detail = [pendingOrders ? `${pendingOrders} orden(es) de trabajo sin completar` : "", pendingPurchases ? `${pendingPurchases} orden(es) de compra sin recibir` : ""].filter(Boolean).join(" y ");
    return res.status(409).json({ error: `No se puede eliminar: el material figura en ${detail}. Al completarlas, su stock no se movería. Quitalo de esos documentos primero.` });
  }
  const deleted = await pool.query("DELETE FROM parts WHERE id=$1 RETURNING id", [req.params.id]);
  if (!deleted.rowCount) return res.status(404).json({ error: "No existe" });
  res.status(204).end();
});

/* ------------------------------------------------ Órdenes (con reglas de montos por rol) ------------------------------------------------ */
const TEC_PATCH = ["signatureUrl", "signedAt", "signedBy", "noSignReason", "technicianSignatureUrl", "technicianSignedAt", "technicianSignedBy", "photos", "assetId", "equipo", "sintoma", "solucion", "category", "technical", "status", "location", "laborHours", "technicians", "contact", "materials", "assignedTechs", "suspendReason", "suspendedFromStatus", "suspendedAt", "resumedAt", "reopenReason", "reopenedAt", "recurrenceMonths", "recurrenceSpawnedId", "urgent"];
const MANAGEMENT_PATCH = ["assetId", "rate", "laborCost", "materials", "laborBillable", "status", "signatureUrl", "signedAt", "signedBy", "noSignReason", "technicianSignatureUrl", "technicianSignedAt", "technicianSignedBy", "quoteNumber", "customerPO", "tech", "assignedTechs", "suspendReason", "suspendedFromStatus", "suspendedAt", "resumedAt", "reopenReason", "reopenedAt", "recurrenceMonths", "recurrenceSpawnedId", "urgent"];
const sanitizeAssignedTechs = (value) => Array.isArray(value) ? [...new Set(value.map((name) => String(name || "").trim()).filter(Boolean))].slice(0, 8) : [];

app.get("/api/orders", auth, requireOrdersAccess, async (req, res) => {
  const since = req.query.updated_since ? new Date(String(req.query.updated_since)) : null;
  if (since && !Number.isFinite(since.getTime())) return res.status(400).json({ error: "updated_since inválido" });
  const { rows } = since
    ? await pool.query("SELECT data, updated_at FROM orders WHERE updated_at>$1 ORDER BY updated_at", [since.toISOString()])
    : await pool.query("SELECT data, updated_at FROM orders ORDER BY updated_at DESC");
  const tec = isTec(req.user.role);
  res.json(rows.filter((row) => orderVisibleToUser(req.user, row.data)).map((row) => ({ ...(tec ? stripMoney(row.data) : row.data), _updatedAt: row.updated_at })));
});

app.post("/api/orders", auth, requireOrdersAccess, apiRateLimit(60), async (req, res) => {
  let o = { ...(req.body || {}) };
  o.status = o.status || "Borrador";
  if (o.status === "En progreso") o.status = "En proceso de ejecución";
  o.assignedTechs = sanitizeAssignedTechs(o.assignedTechs);
  if (isTec(req.user.role)) {
    delete o.budgetId; delete o.budgetNumber; delete o.projectId; delete o.quoteNumber; delete o.customerPO;
    o.tech = req.user.name;
    o.assignedTechs = [...new Set([req.user.name, ...o.assignedTechs])];
    if (!TECH_ORDER_STATUSES.has(o.status)) o.status = "Borrador";
  }
  if (o.budgetId) {
    const linkedBudget = (await pool.query("SELECT data FROM budgets WHERE id=$1", [o.budgetId])).rows[0]?.data;
    if (!linkedBudget) return res.status(400).json({ error: "El presupuesto vinculado ya no existe." });
    if (!["Aprobado", "Facturado", "Pagado"].includes(linkedBudget.stage)) return res.status(400).json({ error: "Solo se pueden generar órdenes desde presupuestos aprobados, facturados o pagados." });
    o.budgetNumber = linkedBudget.number || linkedBudget.id;
    o.quoteNumber = linkedBudget.number || linkedBudget.id;
    o.customerPO = linkedBudget.purchaseOrderNumber || o.customerPO || "";
    o.client = linkedBudget.client || o.client || "";
    o.site = linkedBudget.site || o.site || "";
    o.contact = linkedBudget.contact || o.contact || "";
    o.service = linkedBudget.service || o.service || "Automatización";
    o.projectId = linkedBudget.projectId || o.projectId || "";
  }
  o.currency = "USD";
  if (o.rate === undefined || o.rate === null || o.rate === "") o.rate = Number(process.env.DEFAULT_RATE) || 50;
  o.rate = normalizedRateValue(o.rate);
  o.laborCost = wholeMoneyValue(o.laborCost);
  o.technicians = Math.max(1, Math.round(Number(o.technicians) || 1));
  o.materials = await materialsFromInventory(o.materials);
  if (!o.id) {
    const year2 = String(new Date().getFullYear()).slice(-2);
    // Un cliente puede tener varias plantas, cada una con su propio código de numeración.
    // Si la orden indica de qué planta se trata (siteCode), ese código manda sobre el del cliente.
    let code = String(o.siteCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (!code) {
      const cl = (await pool.query("SELECT data FROM clients")).rows.map((r) => r.data)
        .find((x) => (x.name || "").trim().toLowerCase() === String(o.client || "").trim().toLowerCase());
      code = (cl && cl.code) ? cl.code : "GEN";
    }
    // El correlativo se mantiene por sitio + año. La expresión regular reconoce cualquier formato
    // histórico de folio (con año de 2 o 4 dígitos, con o sin código de tipo) para no reiniciar
    // ni pisar la numeración ya usada.
    const n = (await pool.query("SELECT count(*)::int c FROM orders WHERE id ~ $1", [`^OT-${code}-([A-Z]{2,4}-)?(20)?${year2}-`])).rows[0].c + 1;
    // Si la orden queda vinculada a un presupuesto aprobado/facturado, el folio incorpora su número
    // como referencia directa (ej. OT-VTU-26-001-026367), para poder rastrearla sin abrirla.
    const budgetSuffix = o.budgetId ? String(o.quoteNumber || o.budgetNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    o.id = `OT-${code}-${year2}-${String(n).padStart(3, "0")}${budgetSuffix ? `-${budgetSuffix}` : ""}`;
  }
  if (isTec(req.user.role)) {
    // El técnico nunca fija importes: la tarifa la define el servidor y Gerencia la ajusta después.
    o.rate = normalizedRateValue(process.env.DEFAULT_RATE || 50); o.currency = "USD"; o.laborBillable = true; o.laborCost = 0;
    if (Array.isArray(o.materials)) o.materials = o.materials.map((m) => ({ ...m, billable: true }));
    if (o.status === "Facturada") o.status = "Aprobada";
  }
  const chronologyErrors = timelineErrorsValue(o.technical);
  if (o.status !== "Borrador" && chronologyErrors.length) return res.status(400).json({ error: chronologyErrors.join(" ") });
  const businessErrors = orderBusinessErrors(o);
  if (businessErrors.length) return res.status(400).json({ error: businessErrors.join(" ") });
  o.billableHours = billableHoursValue(o);
  try { await pool.query("INSERT INTO orders(id,data) VALUES($1,$2)", [o.id, o]); }
  catch (error) { if (error.code === "23505") return res.status(409).json({ error: "El folio generado ya existe. Intenta guardar nuevamente." }); throw error; }
  res.json(isTec(req.user.role) ? stripMoney(o) : o);
});

app.patch("/api/orders/:id", auth, requireOrdersAccess, apiRateLimit(60), async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM orders WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  if (!orderVisibleToUser(req.user, rows[0].data)) return res.status(403).json({ error: "Esta orden está asignada a otro técnico" });
  let patch = req.body || {};
  if ("assignedTechs" in patch) patch.assignedTechs = sanitizeAssignedTechs(patch.assignedTechs);
  if (isTec(req.user.role)) {
    const clean = {}; for (const k of TEC_PATCH) if (k in patch) clean[k] = patch[k];
    if (clean.status && !TECH_ORDER_STATUSES.has(clean.status)) delete clean.status;
    if (clean.assignedTechs) clean.assignedTechs = [...new Set([req.user.name, ...clean.assignedTechs])];
    patch = clean;
  } else if (req.user.role === "gerente") {
    const clean = {}; for (const k of MANAGEMENT_PATCH) if (k in patch) clean[k] = patch[k];
    patch = clean;
  }
  if (patch.status === "En progreso") patch.status = "En proceso de ejecución";
  if (req.user.role === "admin" && "budgetId" in patch) {
    if (!patch.budgetId) {
      patch.budgetId = ""; patch.budgetNumber = ""; patch.projectId = ""; patch.quoteNumber = ""; patch.customerPO = "";
    } else {
      const budget = (await pool.query("SELECT data FROM budgets WHERE id=$1", [patch.budgetId])).rows[0]?.data;
      if (!budget) return res.status(400).json({ error: "El presupuesto seleccionado ya no existe." });
      if (!["Aprobado", "Facturado", "Pagado"].includes(budget.stage)) return res.status(400).json({ error: "La orden solo puede vincularse con un presupuesto aprobado, facturado o pagado." });
      patch.budgetNumber = budget.number || budget.id; patch.quoteNumber = budget.number || budget.id;
      patch.customerPO = budget.purchaseOrderNumber || ""; patch.projectId = budget.projectId || "";
      patch.client = budget.client || patch.client || ""; patch.site = budget.site || patch.site || "";
      patch.contact = budget.contact || patch.contact || ""; patch.service = budget.service || patch.service || "Automatización";
    }
  }
  if ("rate" in patch) patch.rate = normalizedRateValue(patch.rate);
  if ("laborCost" in patch) patch.laborCost = wholeMoneyValue(patch.laborCost);
  if (Array.isArray(patch.materials)) patch.materials = isTec(req.user.role) ? await materialsFromInventory(patch.materials) : patch.materials.map((material) => ({ ...material, price: wholeMoneyValue(material.price), cost: wholeMoneyValue(material.cost) }));
  const prev = rows[0].data;
  const merged = { ...prev, ...patch };
  if (merged.status === "En progreso") merged.status = "En proceso de ejecución";
  merged.currency = "USD";
  merged.technicians = Math.max(1, Math.round(Number(merged.technicians) || 1));
  const chronologyErrors = timelineErrorsValue(merged.technical);
  if (("technical" in patch || "status" in patch) && merged.status !== "Borrador" && chronologyErrors.length) return res.status(400).json({ error: chronologyErrors.join(" ") });
  const businessErrors = orderBusinessErrors(merged);
  if (businessErrors.length) return res.status(400).json({ error: businessErrors.join(" ") });
  merged.billableHours = billableHoursValue(merged);
  if (req.user.role === "admin" && "budgetId" in patch && patch.budgetId !== (prev.budgetId || "")) {
    merged.activity = [...(prev.activity || []), { type: "commercial_link", text: patch.budgetId ? `Vinculó el presupuesto ${patch.budgetNumber}${patch.customerPO ? ` · OC ${patch.customerPO}` : ""}` : "Desvinculó el presupuesto y la OC", by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  } else if (req.user.role === "admin" && patch.technical?.timelineAdjustmentReason && patch.technical.timelineAdjustmentReason !== prev.technical?.timelineAdjustmentReason) {
    merged.activity = [...(prev.activity || []), { type: "timeline", text: `Corrigió la cronología: ${patch.technical.timelineAdjustmentReason}`, by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  } else if (patch.status && patch.status !== prev.status) {
    const statusText = patch.status === "Suspendida" && patch.suspendReason ? `Suspendió la orden. Motivo: ${patch.suspendReason}` : prev.status === "Suspendida" && patch.status !== "Suspendida" ? `Reanudó la orden (estado: ${patch.status})` : prev.status === "Completada" && patch.reopenReason ? `Reabrió la orden. Motivo: ${patch.reopenReason}` : `Cambió el estado a ${patch.status}`;
    merged.activity = [...(prev.activity || []), { type: "status", text: statusText, by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  } else if (req.user.role === "admin" && Object.keys(patch).length) {
    merged.activity = [...(prev.activity || []), { type: "edit", text: "Actualizó los datos de la orden", by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  }
  // Al completar la orden por primera vez, descuenta del catálogo los materiales facturables
  // vinculados a un repuesto (partId). Guardado con stockDeductedAt para no descontar de nuevo si
  // la orden se reabre y se vuelve a completar — evita descuentos duplicados, a costa de no
  // reflejar correcciones de materiales posteriores a la primera finalización.
  if (merged.status === "Completada" && prev.status !== "Completada" && !prev.stockDeductedAt) {
    try {
      for (const material of merged.materials || []) {
        if (material.billable && material.partId) await adjustPartStock(material.partId, -(Number(material.qty) || 0), pool, { movementType: "Consumo", sourceType: "Orden de trabajo", sourceId: merged.id, userId: req.user.id });
      }
      merged.stockDeductedAt = new Date().toISOString();
    } catch (error) { console.error("No se pudo descontar el stock de la OT:", error); }
  }
  await pool.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
  if (merged.projectId || prev.projectId) { try { await upsertOrderCostExpense(merged); } catch (error) { console.error("No se pudo reconciliar el costo de la OT en Finanzas:", error); } }
  res.json(isTec(req.user.role) ? stripMoney(merged) : merged);
});

app.post("/api/orders/:id/comment", auth, requireOrdersAccess, async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM orders WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  if (!orderVisibleToUser(req.user, rows[0].data)) return res.status(403).json({ error: "Esta orden está asignada a otro técnico" });
  const text = String((req.body || {}).text || "").trim();
  if (!text) return res.status(400).json({ error: "Comentario vacío" });
  const merged = { ...rows[0].data, activity: [...(rows[0].data.activity || []), { type: "comment", text, by: req.user.id, byName: req.user.name, at: new Date().toISOString() }] };
  await pool.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
  res.json(isTec(req.user.role) ? stripMoney(merged) : merged);
});

app.delete("/api/orders/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  await pool.query("DELETE FROM orders WHERE id=$1", [req.params.id]);
  res.status(204).end();
});

/* ------------------------------------------------ Tareas ------------------------------------------------ */
const TASK_STATUSES = new Set(["Por hacer", "En progreso", "En revisión", "Hecho"]);
const TASK_PRIORITIES = new Set(["Baja", "Media", "Alta", "Urgente"]);
const TASK_TYPES = new Set(["Tarea", "Bug", "Mejora", "Historia"]);
const TECH_TASK_PATCH = new Set(["title", "desc", "status", "priority", "type", "due", "participants"]);
app.get("/api/tasks", auth, async (req, res) => {
  const since = req.query.updated_since ? new Date(String(req.query.updated_since)) : null;
  if (since && !Number.isFinite(since.getTime())) return res.status(400).json({ error: "updated_since inválido" });
  const { rows } = since
    ? await pool.query("SELECT data, updated_at FROM tasks WHERE updated_at>$1 ORDER BY updated_at", [since.toISOString()])
    : await pool.query("SELECT data, updated_at FROM tasks ORDER BY updated_at DESC");
  const tasks = rows.map((row) => ({ ...row.data, _updatedAt: row.updated_at }));
  // Igual que en /api/bootstrap: técnicos (campo u oficina) y monitores solo ven tareas de los
  // proyectos que el administrador les habilitó explícitamente (allowedUsers).
  if (!isProjectScoped(req.user.role)) return res.json(tasks);
  const allowedProjectIds = new Set((await pool.query("SELECT id FROM projects WHERE data->'allowedUsers' ? $1", [req.user.id])).rows.map((row) => row.id));
  res.json(tasks.filter((t) => allowedProjectIds.has(t.project)));
});
app.post("/api/tasks", auth, requireProjectWrite, async (req, res) => {
  const t = { ...(req.body || {}) }; if (!t.id) t.id = "T-" + Date.now();
  t.title = String(t.title || "").trim();
  if (!t.title || !t.project) return res.status(400).json({ error: "Proyecto y título son obligatorios" });
  if (!(await tecCanProject(req.user, t.project))) return res.status(403).json({ error: "Sin acceso a ese proyecto" });
  if (isTec(req.user.role)) t.assignee = req.user.id;
  if (!(await assigneeIsAllowed(t.assignee))) return res.status(400).json({ error: "Monitor Oficina no puede ser responsable de tareas" });
  t.status = TASK_STATUSES.has(t.status) ? t.status : "Por hacer";
  t.priority = TASK_PRIORITIES.has(t.priority) ? t.priority : "Media";
  t.type = TASK_TYPES.has(t.type) ? t.type : "Tarea";
  const taskProject = (await pool.query("SELECT data FROM projects WHERE id=$1", [t.project])).rows[0]?.data;
  if (!taskProject) return res.status(404).json({ error: "El proyecto ya no existe" });
  if (taskProject?.color) t.color = taskProject.color;
  const existing = (await pool.query("SELECT data FROM tasks WHERE id=$1", [t.id])).rows[0]?.data;
  if (existing) {
    const key = String(taskProject.key || "TASK").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "TASK";
    const ids = (await pool.query("SELECT id FROM tasks WHERE id LIKE $1", [`${key}-%`])).rows.map((row) => Number(String(row.id).slice(key.length + 1)) || 0);
    t.id = `${key}-${Math.max(0, ...ids) + 1}`;
  }
  await pool.query("INSERT INTO tasks(id,data) VALUES($1,$2)", [t.id, t]);
  if (t.assignee) await ensureProjectAccess(t.assignee, t.project);
  // Notifica al responsable si es una asignación nueva (a otra persona)
  if (t.assignee && t.assignee !== req.user.id && (!existing || existing.assignee !== t.assignee)) {
    await notify(t.assignee, `Te asignaron la tarea ${t.id}: ${t.title}`, "task:" + t.id);
    notifyTaskAssignmentEmail(t.assignee, t, taskProject);
  }
  res.json(t);
});
app.patch("/api/tasks/:id", auth, requireProjectWrite, async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM tasks WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  const prev = rows[0].data; let patch = req.body || {};
  if (!(await tecCanProject(req.user, prev.project))) return res.status(403).json({ error: "Sin acceso a ese proyecto" });
  if (isTec(req.user.role)) patch = Object.fromEntries(Object.entries(patch).filter(([key]) => TECH_TASK_PATCH.has(key)));
  if (patch.project !== undefined && !(await tecCanProject(req.user, patch.project))) return res.status(403).json({ error: "Sin acceso al proyecto de destino" });
  if (patch.assignee !== undefined && !(await assigneeIsAllowed(patch.assignee))) return res.status(400).json({ error: "Monitor Oficina no puede ser responsable de tareas" });
  if (patch.status !== undefined && !TASK_STATUSES.has(patch.status)) return res.status(400).json({ error: "Estado de tarea inválido" });
  if (patch.priority !== undefined && !TASK_PRIORITIES.has(patch.priority)) return res.status(400).json({ error: "Prioridad inválida" });
  if (patch.type !== undefined && !TASK_TYPES.has(patch.type)) return res.status(400).json({ error: "Tipo de tarea inválido" });
  const merged = { ...prev, ...patch };
  if (patch.status && patch.status !== prev.status)
    merged.activity = [...(prev.activity || []), { type: "status", text: `Estado: ${patch.status}`, by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  await pool.query("UPDATE tasks SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
  if (patch.assignee !== undefined) await ensureProjectAccess(patch.assignee, merged.project);
  if (patch.assignee && patch.assignee !== prev.assignee && patch.assignee !== req.user.id) {
    await notify(patch.assignee, `Te asignaron la tarea ${merged.id}: ${merged.title}`, "task:" + merged.id);
    pool.query("SELECT data FROM projects WHERE id=$1", [merged.project]).then((result) => notifyTaskAssignmentEmail(patch.assignee, merged, result.rows[0]?.data)).catch(() => {});
  }
  res.json(merged);
});
app.post("/api/tasks/:id/comment", auth, requireProjectWrite, async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM tasks WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  if (!(await tecCanProject(req.user, rows[0].data.project))) return res.status(403).json({ error: "Sin acceso a ese proyecto" });
  const text = String((req.body || {}).text || "").trim();
  if (!text) return res.status(400).json({ error: "Comentario vacío" });
  const merged = { ...rows[0].data, activity: [...(rows[0].data.activity || []), { type: "comment", text, by: req.user.id, byName: req.user.name, at: new Date().toISOString() }] };
  await pool.query("UPDATE tasks SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
  // avisa al responsable si comenta otra persona
  if (merged.assignee && merged.assignee !== req.user.id) await notify(merged.assignee, `Nuevo comentario en ${merged.id}`, "task:" + merged.id);
  res.json(merged);
});
app.delete("/api/tasks/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  await pool.query("DELETE FROM tasks WHERE id=$1", [req.params.id]); res.status(204).end();
});

/* ------------------------------------------------ Usuarios (solo Admin) ------------------------------------------------ */
app.post("/api/users", auth, requireRole("admin"), async (req, res) => {
  const { name, email, role, color, password } = req.body || {};
  const cleanName = String(name || "").trim(); const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanName || !cleanEmail || !password) return res.status(400).json({ error: "Nombre, correo y contraseña inicial son obligatorios" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: "El correo no es válido" });
  if (role !== undefined && !VALID_ROLES.has(role)) return res.status(400).json({ error: "Rol inválido" });
  if (String(password).length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
  const id = "u" + Date.now();
  const hash = bcrypt.hashSync(password, 10);
  const settings = buildSettingsPatch(req.body || {}) || {};
  try {
    await pool.query("INSERT INTO users(id,name,email,password_hash,role,color,active,mustchangepassword,settings) VALUES($1,$2,$3,$4,$5,$6,true,true,$7)",
      [id, cleanName, cleanEmail, hash, role || "tecnico", color || "#0ea5e9", settings]);
  } catch { return res.status(400).json({ error: "Ese correo ya está registrado" }); }
  if (role === "monitor_oficina") {
    const projectRows = await pool.query("SELECT id,data FROM projects");
    for (const row of projectRows.rows) {
      const allowedUsers = Array.isArray(row.data.allowedUsers) ? row.data.allowedUsers : [];
      if (!allowedUsers.includes(id)) await pool.query("UPDATE projects SET data=$2, updated_at=now() WHERE id=$1", [row.id, { ...row.data, allowedUsers: [...allowedUsers, id] }]);
    }
  }
  const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [id]);
  res.json(pubUser(rows[0]));
});
app.patch("/api/users/:id", auth, requireRole("admin"), async (req, res) => {
  const { role, active, name, color, password } = req.body || {};
  const target = (await pool.query("SELECT id,role,active,settings FROM users WHERE id=$1", [req.params.id])).rows[0];
  if (!target) return res.status(404).json({ error: "El usuario ya no existe" });
  if (role !== undefined && !VALID_ROLES.has(role)) return res.status(400).json({ error: "Rol inválido" });
  if (req.params.id === req.user.id && ((role !== undefined && role !== "admin") || active === false)) return res.status(400).json({ error: "No puedes quitarte tu propio acceso de administrador" });
  if (target.role === "admin" && ((role !== undefined && role !== "admin") || active === false)) {
    const activeAdmins = Number((await pool.query("SELECT count(*)::int AS count FROM users WHERE role='admin' AND active=true")).rows[0].count || 0);
    if (activeAdmins <= 1) return res.status(400).json({ error: "Debe existir al menos un administrador activo" });
  }
  const sets = [], vals = []; let i = 1;
  if (role !== undefined) { sets.push(`role=$${i++}`); vals.push(role); }
  if (active !== undefined) { sets.push(`active=$${i++}`); vals.push(active); }
  if (name !== undefined) { sets.push(`name=$${i++}`); vals.push(name); }
  if (color !== undefined) { sets.push(`color=$${i++}`); vals.push(color); }
  const mergedSettings = buildSettingsPatch(req.body || {}, target.settings || {});
  if (mergedSettings) { sets.push(`settings=$${i++}`); vals.push(mergedSettings); }
  if (password) {
    if (String(password).length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    sets.push(`password_hash=$${i++}`); vals.push(bcrypt.hashSync(password, 10));
    sets.push("mustchangepassword=true");
    // Un reseteo de contraseña por un admin revoca de inmediato cualquier sesión abierta con la
    // anterior (a diferencia del cambio de contraseña propio, acá no hay sesión "actual" que
    // preservar: el usuario afectado va a tener que loguearse de nuevo con la clave temporal).
    sets.push("token_version=token_version+1");
  }
  if (!sets.length) return res.status(400).json({ error: "Nada que actualizar" });
  vals.push(req.params.id);
  await pool.query(`UPDATE users SET ${sets.join(",")} WHERE id=$${i}`, vals);
  if (role === "monitor_oficina") {
    await pool.query("UPDATE tasks SET data=data-'assignee', updated_at=now() WHERE data->>'assignee'=$1", [req.params.id]);
    const projectRows = await pool.query("SELECT id,data FROM projects");
    for (const row of projectRows.rows) {
      const allowedUsers = Array.isArray(row.data.allowedUsers) ? row.data.allowedUsers : [];
      if (!allowedUsers.includes(req.params.id)) await pool.query("UPDATE projects SET data=$2, updated_at=now() WHERE id=$1", [row.id, { ...row.data, allowedUsers: [...allowedUsers, req.params.id] }]);
    }
  }
  const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [req.params.id]);
  res.json(pubUser(rows[0]));
});
app.delete("/api/users/:id", auth, requireRole("admin"), async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "No puedes eliminar tu propio usuario" });
  const target = (await pool.query("SELECT id,name,role,active FROM users WHERE id=$1", [req.params.id])).rows[0];
  if (!target) return res.status(404).json({ error: "El usuario ya no existe" });
  if (target.role === "admin" && target.active) {
    const activeAdmins = Number((await pool.query("SELECT count(*)::int AS count FROM users WHERE role='admin' AND active=true")).rows[0].count || 0);
    if (activeAdmins <= 1) return res.status(400).json({ error: "Debe existir al menos un administrador activo" });
  }
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("UPDATE tasks SET data=(data-'assignee') || jsonb_build_object('formerAssigneeName',$2::text), updated_at=now() WHERE data->>'assignee'=$1", [req.params.id, target.name]);
    const projects = (await db.query("SELECT id,data FROM projects WHERE data->'allowedUsers' ? $1", [req.params.id])).rows;
    for (const row of projects) await db.query("UPDATE projects SET data=$2, updated_at=now() WHERE id=$1", [row.id, { ...row.data, allowedUsers: (row.data.allowedUsers || []).filter((id) => id !== req.params.id) }]);
    await db.query("DELETE FROM notifications WHERE user_id=$1", [req.params.id]);
    await db.query("DELETE FROM users WHERE id=$1", [req.params.id]);
    await db.query("COMMIT");
    res.status(204).end();
  } catch (error) { await db.query("ROLLBACK"); res.status(500).json({ error: "No se pudo eliminar el usuario de forma segura" }); }
  finally { db.release(); }
});

// Express 4 no captura por sí solo los rechazos de handlers async. Este
// middleware evita que un error de base de datos derribe el proceso o deje la
// petición abierta, sin filtrar detalles internos al navegador.
app.use((error, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, error);
  if (res.headersSent) return;
  if (error?.type === "entity.too.large") return res.status(413).json({ error: "El archivo o formulario supera el tamaño permitido" });
  if (error?.message === "Origen no permitido") return res.status(403).json({ error: "Origen no permitido" });
  return res.status(500).json({ error: "Ocurrió un error interno. Intenta nuevamente." });
});

/* ------------------------------------------------ Frontend estático (SPA) ------------------------------------------------ */
const dist = path.join(__dirname, "public");
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

/* ---------------------------------- Resumen diario de pendientes ----------------------------------
Todo el vencimiento del sistema era "de tirar": había que abrir Mi Día para enterarse de que una
tarea venció, un seguimiento de presupuesto se pasó o una orden de compra está demorada. Nadie
avisaba nada. Esto recorre una vez por día lo que ya está vencido o por vencer y deja UNA
notificación por persona — una sola, con el total: varias por día se vuelven ruido y se ignoran. */
const DIGEST_KEY = "daily_digest_v1";
const DIGEST_HOUR = 8; // hora de Argentina en la que se emite
// Argentina no aplica horario de verano, así que un desplazamiento fijo alcanza y evita depender
// de la zona horaria del contenedor, que en el hosting suele estar en UTC.
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const arDate = () => new Date(Date.now() - AR_OFFSET_MS);
const arDayKey = () => arDate().toISOString().slice(0, 10);

async function runDailyDigest() {
  const today = arDayKey();
  // El marcado es atómico y va ANTES de notificar: si dos instancias arrancan a la vez, solo una
  // gana el UPDATE y la otra sale sin mandar nada. Un resumen perdido es preferible a uno doble.
  const claimed = await pool.query(
    `INSERT INTO app_settings(key, value, updated_at) VALUES($1, $2, now())
     ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     WHERE app_settings.value->>'day' IS DISTINCT FROM $3
     RETURNING key`,
    [DIGEST_KEY, { day: today }, today]);
  if (claimed.rowCount === 0) return 0;

  const users = (await pool.query("SELECT id, role FROM users WHERE active = true")).rows.filter((user) => !isMonitor(user.role));
  const tasks = (await pool.query("SELECT data FROM tasks")).rows.map((row) => row.data);
  const budgets = (await pool.query("SELECT data FROM budgets")).rows.map((row) => row.data);
  const purchaseOrders = (await pool.query("SELECT data FROM purchase_orders")).rows.map((row) => row.data);
  const movements = (await pool.query("SELECT data FROM financial_movements")).rows.map((row) => row.data);
  // Facturas con vencimiento pactado ya pasado y saldo pendiente. El cobro se descuenta por las
  // partidas que apuntan a cada factura, que es como se imputa en el resto del módulo.
  const collectedByInvoice = movements.filter((movement) => movement.kind === "income").reduce((acc, movement) => {
    for (const allocation of movement.allocations || []) {
      if (allocation?.invoiceId) acc[allocation.invoiceId] = (acc[allocation.invoiceId] || 0) + (Number(allocation.amountUsd) || 0);
    }
    return acc;
  }, {});
  const overdueInvoices = movements.filter((movement) => {
    if (movement.kind !== "invoice" || !movement.dueDate || movement.dueDate >= today) return false;
    const gross = Number(movement.grossAmountUsd) || ((Number(movement.amountUsd) || 0) + (Number(movement.vatAmountUsd) || 0));
    return gross - (collectedByInvoice[movement.id] || 0) > 0.01;
  });
  const soon = new Date(arDate().getTime() + 4 * 86400000).toISOString().slice(0, 10);
  const pending = tasks.filter((task) => task.status !== "Hecho" && task.due);
  let sent = 0;

  for (const user of users) {
    const mine = pending.filter((task) => task.assignee === user.id);
    const overdue = mine.filter((task) => task.due < today).length;
    const dueSoon = mine.filter((task) => task.due >= today && task.due <= soon).length;
    const parts = [];
    if (overdue) parts.push(`${overdue} tarea(s) vencida(s)`);
    if (dueSoon) parts.push(`${dueSoon} por vencer en 4 días`);
    // Lo comercial y las compras solo le importan a quien puede accionarlas.
    if (["admin", "gerente"].includes(user.role)) {
      const followUps = budgets.filter((budget) => !["Aprobado", "Facturado", "Pagado", "Rechazado"].includes(budget.stage) && budget.nextFollowUp && budget.nextFollowUp <= today).length;
      const latePurchases = purchaseOrders.filter((po) => po.dueDate && po.dueDate < today && !["Recibida", "Cancelada"].includes(po.stage)).length;
      if (followUps) parts.push(`${followUps} seguimiento(s) de presupuesto atrasado(s)`);
      if (latePurchases) parts.push(`${latePurchases} orden(es) de compra demorada(s)`);
      if (overdueInvoices.length) parts.push(`${overdueInvoices.length} factura(s) con el cobro vencido`);
    }
    if (!parts.length) continue; // a quien no tiene nada pendiente no se le escribe
    await notify(user.id, `Resumen de hoy: ${parts.join(" · ")}.`, null);
    sent++;
  }
  console.log(`Resumen diario ${today}: ${sent} notificación(es).`);
  return sent;
}

function scheduleDailyDigest() {
  // Se revisa cada 15 minutos en vez de programar un timer largo: sobrevive a reinicios de
  // contenedor sin perder el día, y el marcado en base evita que se repita.
  const tick = () => {
    if (arDate().getUTCHours() < DIGEST_HOUR) return;
    runDailyDigest().catch((error) => console.error("Resumen diario:", error));
  };
  setInterval(tick, 15 * 60 * 1000);
  tick();
}

/* ------------------------------------------------ Arranque ------------------------------------------------ */
const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => { console.log(`OrdenGO API + web escuchando en :${PORT}`); scheduleDailyDigest(); }))
  .catch((e) => { console.error("Error iniciando la base de datos:", e); process.exit(1); });
