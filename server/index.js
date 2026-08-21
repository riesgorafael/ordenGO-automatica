import express from "express";
import "express-async-errors";
import cors from "cors";
import compression from "compression";
import pkg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import crypto from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import { registerGanttRoutes } from "./ganttRoutes.js";
import { billableHoursValue, expenseVatBreakdown, normalizedRateValue, orderAssignedIdsValue, orderVisibleToUserValue, targetMarginValue, wholeMoneyValue } from "./domainRules.js";

const { Pool } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PRODUCTION = process.env.NODE_ENV === "production";
if (IS_PRODUCTION && String(process.env.JWT_SECRET || "").length < 32) throw new Error("JWT_SECRET seguro (mínimo 32 caracteres) es obligatorio en producción");
if (IS_PRODUCTION && !process.env.DATABASE_URL) throw new Error("DATABASE_URL es obligatorio en producción");
const JWT_SECRET = process.env.JWT_SECRET || "cambia-esto-en-produccion";
// El default de pg son 10 conexiones, y /api/bootstrap dispara 16 consultas en paralelo: una sola
// carga de página ya no entraba en el pool, y al refrescar seguido se apilaban varios bootstraps.
// Además cada conexión paga cuatro viajes extra por el aislamiento multiempresa (set_config y SET
// ROLE al tomarla, los RESET al devolverla), así que permanece ocupada bastante más que el tiempo
// de la consulta en sí. El máximo queda por encima de ese abanico para que un request no pueda
// agotar el pool por sí solo.
// connectionTimeoutMillis es clave: el default es 0, o sea esperar para siempre. Con el pool
// saturado las peticiones quedaban colgadas en lugar de fallar, que es exactamente el síntoma de
// "se cargó a medias". Con un tope, satura ruidosamente y el cliente muestra el error de arranque.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PGPOOL_MAX) || 24,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});
const TENANT_DB_ROLE = "ordengo_tenant";
// Cada request autenticado conserva su organización en AsyncLocalStorage. Al tomar una conexión
// del pool se fija ese contexto en PostgreSQL; las políticas RLS hacen el aislamiento efectivo
// incluso si una ruta olvida agregar un WHERE organization_id.
const tenantContext = new AsyncLocalStorage();
const rawPoolConnect = pool.connect.bind(pool);
const configureTenantClient = async (client) => {
  const organizationId = tenantContext.getStore()?.organizationId;
  if (!organizationId) return client;
  const rawRelease = client.release.bind(client);
  try {
    await client.query("SELECT set_config('app.organization_id',$1,false)", [organizationId]);
    // La conexión de despliegue suele ser propietaria o superusuario y, por diseño de
    // PostgreSQL, puede omitir RLS. SET ROLE hace que cada consulta de la aplicación se
    // ejecute con un rol sin privilegios de bypass y las políticas sean obligatorias.
    await client.query(`SET ROLE ${TENANT_DB_ROLE}`);
  } catch (error) {
    rawRelease(error); // descarta la conexión si no pudo fijarse el tenant
    throw error;
  }
  let released = false;
  client.release = (...releaseArgs) => {
    if (released) return;
    released = true;
    client.query("RESET app.organization_id")
      .then(() => client.query("RESET ROLE"))
      .then(() => rawRelease(...releaseArgs))
      .catch((error) => rawRelease(error)); // nunca reutilizar una conexión con contexto residual
  };
  return client;
};
// pg-pool usa internamente connect(callback) para implementar pool.query(), mientras que las
// transacciones de la aplicación usan await pool.connect(). El wrapper anterior era `async` y
// sólo contemplaba Promises: cuando pg-pool entregaba un callback, rawPoolConnect devolvía
// undefined y terminábamos ejecutando undefined.query(). Se preservan aquí ambas firmas.
pool.connect = (...args) => {
  const callbackIndex = args.findIndex((argument) => typeof argument === "function");
  if (callbackIndex >= 0) {
    const callback = args[callbackIndex];
    const connectArgs = args.filter((_, index) => index !== callbackIndex);
    rawPoolConnect(...connectArgs, (error, client) => {
      if (error) return callback(error);
      configureTenantClient(client)
        .then((configuredClient) => callback(null, configuredClient, configuredClient.release.bind(configuredClient)))
        .catch((configureError) => callback(configureError));
    });
    return undefined;
  }
  return rawPoolConnect(...args).then(configureTenantClient);
};

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
  // fonts.googleapis.com en style-src y fonts.gstatic.com en font-src: el index.html carga
  // Montserrat desde Google Fonts. Son dos hosts distintos —la hoja de estilos y los archivos de
  // fuente viven separados—, así que hace falta habilitar los dos o la tipografía no se aplica.
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://www.googletagmanager.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.google-analytics.com https://www.googletagmanager.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' data: https://cdn.jsdelivr.net https://tessdata.projectnaptha.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com");
  next();
});
app.use(compression({ threshold: 1024 }));
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

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const DEFAULT_BRANDING = {
  appName: "MiOrdenGo",
  subtitle: "Gestión de servicios",
  companyName: "",
  theme: "ordengo",
  primaryColor: "#0EA5C5",
  headerColor: "#0B315F",
  logoDataUrl: "",
  tvModeEnabled: false,
  tvCycleEnabled: false,
  tvCycleSeconds: 30,
  hideAdminModules: false,
  companyCuit: "",
  companyLegalName: "",
  companyIvaCondition: "",
  companyAddress: "",
  companyLocality: "",
  companyCity: "",
  companyProvince: "",
  companyCountry: "",
  companyPhone: "",
  companyEmail: "",
  companyWebsite: "",
};
// AUTOMATICA es un tenant, no el valor predeterminado del producto. Mantener sus datos en un
// objeto separado evita que otra empresa los herede cuando aún no completó su configuración.
const AUTOMATICA_BRANDING = {
  ...DEFAULT_BRANDING,
  subtitle: "Campo + Proyectos",
  companyName: "AUTOMATICA ARG",
  theme: "automatica",
  primaryColor: "#F18700",
  headerColor: "#2E2E2D",
  companyCuit: "20351960206",
  companyLegalName: "AUTOMATICA ARG",
  companyIvaCondition: "IVA Responsable Inscripto",
  companyAddress: "Bv. Ovidio Lagos 160 - Venado Tuerto (Santa Fe)",
  companyPhone: "+54 3462 596041",
  companyWebsite: "www.automatica-arg.com.ar",
};
const DEFAULT_ORGANIZATION_ID = "org-automatica";
const DEFAULT_COMPANY_PROFILE = {
  locale: "es-AR", timezone: "America/Buenos_Aires", baseCurrency: "USD",
  pricing: { defaultHourlyRate: 50, defaultInternalHourlyCost: 0, minimumBillableHours: 2, targetMargin: 35, vatRate: 21 },
  laborRoles: [
    { name: "Programador", cost: 50 }, { name: "Ingeniero", cost: 25 }, { name: "Asesor", cost: 20 },
    { name: "Programador AUX", cost: 45 }, { name: "Tablerista", cost: 17 }, { name: "Dibujante", cost: 17 },
    { name: "Administrativo", cost: 6 }, { name: "Ayudante", cost: 5 }, { name: "Programador Aprendiz", cost: 7 },
  ],
  features: { panel: true, budgets: true, finances: true, orders: true, projects: true, whiteboard: true, materialLists: true, clients: true, purchaseOrders: true, inventory: true, team: true, reports: true },
};
const EMPTY_ORGANIZATION_PROFILE = {
  locale: "es-AR", timezone: "America/Buenos_Aires", baseCurrency: "USD",
  pricing: { defaultHourlyRate: 0, defaultInternalHourlyCost: 0, minimumBillableHours: 0, targetMargin: 0, vatRate: 0 },
  laborRoles: [{ name: "Técnico", cost: 0 }],
  features: { ...DEFAULT_COMPANY_PROFILE.features },
};
const boundedNumber = (value, fallback, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));
const normalizeCompanyProfile = (value = {}) => {
  const pricing = value.pricing || {};
  const roles = Array.isArray(value.laborRoles) ? value.laborRoles.map((role) => ({ name: String(role?.name || "").trim().slice(0, 60), cost: boundedNumber(role?.cost, 0, 0, 100000) })).filter((role) => role.name).slice(0, 30) : EMPTY_ORGANIZATION_PROFILE.laborRoles;
  return {
    locale: ["es-AR", "es-UY", "es-CL", "es-MX", "en-US"].includes(value.locale) ? value.locale : EMPTY_ORGANIZATION_PROFILE.locale,
    timezone: String(value.timezone || EMPTY_ORGANIZATION_PROFILE.timezone).trim().slice(0, 80),
    baseCurrency: ["USD", "ARS", "EUR"].includes(value.baseCurrency) ? value.baseCurrency : EMPTY_ORGANIZATION_PROFILE.baseCurrency,
    pricing: {
      defaultHourlyRate: boundedNumber(pricing.defaultHourlyRate, 0, 0, 100000),
      defaultInternalHourlyCost: boundedNumber(pricing.defaultInternalHourlyCost, 0, 0, 100000),
      minimumBillableHours: boundedNumber(pricing.minimumBillableHours, 0, 0, 24),
      targetMargin: boundedNumber(pricing.targetMargin, 0, 0, 95),
      vatRate: boundedNumber(pricing.vatRate, 0, 0, 100),
    },
    laborRoles: roles.length ? roles : EMPTY_ORGANIZATION_PROFILE.laborRoles,
    features: Object.fromEntries(Object.keys(DEFAULT_COMPANY_PROFILE.features).map((key) => [key, value.features?.[key] !== false])),
  };
};
const validHexColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || ""));
const digitsOnly = (value) => String(value || "").replace(/\D/g, "");
const normalizeBranding = (value = {}) => ({
  ...DEFAULT_BRANDING,
  // MiOrdenGo es la marca fija del producto; cada tenant personaliza su empresa, logo y tema,
  // pero no puede renombrar la aplicación desde la interfaz ni mediante la API.
  appName: DEFAULT_BRANDING.appName,
  subtitle: String(value.subtitle || DEFAULT_BRANDING.subtitle).trim().slice(0, 80),
  companyName: String(value.companyName || "").trim().slice(0, 80),
  companyCuit: digitsOnly(value.companyCuit).slice(0, 11),
  companyLegalName: String(value.companyLegalName || "").trim().slice(0, 120),
  companyIvaCondition: IVA_CONDITIONS.includes(value.companyIvaCondition) ? value.companyIvaCondition : "",
  companyAddress: String(value.companyAddress || "").trim().slice(0, 160),
  // Localidad en renglón propio: el membrete la muestra debajo de la calle, como en un papel
  // membretado. Antes había que meterla dentro de la dirección y quedaba todo en una línea larga.
  // Ciudad, provincia y país por separado: el membrete los arma en un renglón propio y así se puede
  // componer "Venado Tuerto, Santa Fe" sin obligar a escribirlo dentro de la calle. companyLocality
  // se conserva para las empresas que ya lo tenían cargado.
  companyLocality: String(value.companyLocality || "").trim().slice(0, 120),
  companyCity: String(value.companyCity || "").trim().slice(0, 80),
  companyProvince: String(value.companyProvince || "").trim().slice(0, 80),
  companyCountry: String(value.companyCountry || "").trim().slice(0, 60),
  companyPhone: String(value.companyPhone || "").trim().slice(0, 40),
  companyEmail: String(value.companyEmail || "").trim().slice(0, 120),
  companyWebsite: String(value.companyWebsite || "").trim().slice(0, 160),
  theme: String(value.theme || DEFAULT_BRANDING.theme).trim().slice(0, 30),
  primaryColor: validHexColor(value.primaryColor) ? value.primaryColor.toUpperCase() : DEFAULT_BRANDING.primaryColor,
  headerColor: validHexColor(value.headerColor) ? value.headerColor.toUpperCase() : DEFAULT_BRANDING.headerColor,
  logoDataUrl: String(value.logoDataUrl || ""),
  tvModeEnabled: value.tvModeEnabled === true,
  tvCycleEnabled: value.tvModeEnabled === true && value.tvCycleEnabled === true,
  tvCycleSeconds: Math.min(300, Math.max(10, Math.round(Number(value.tvCycleSeconds) || 30))),
  hideAdminModules: value.hideAdminModules === true,
});
async function loadBranding(organizationId = tenantContext.getStore()?.organizationId) {
  // Sin tenant explícito no se elige una configuración "reciente": eso podría exponer la marca
  // de otra empresa en una pantalla pública o en un proceso fuera del contexto autenticado.
  if (!organizationId) return normalizeBranding({});
  const row = (await pool.query(`
    SELECT organization.name, settings.value
      FROM organizations organization
      LEFT JOIN app_settings settings
        ON settings.organization_id=organization.id AND settings.key='branding_v1'
     WHERE organization.id=$1
  `, [organizationId])).rows[0];
  const value = row?.value || {};
  const normalized = normalizeBranding({
    ...value,
    companyName: value.companyName || row?.name || "",
    companyLegalName: value.companyLegalName || value.companyName || row?.name || "",
  });
  return { ...normalized, builtInCompanyLogo: organizationId === DEFAULT_ORGANIZATION_ID ? "automatica" : "" };
}
async function loadCompanyProfile(organizationId) {
  const row = (await pool.query("SELECT profile FROM organizations WHERE id=$1", [organizationId || tenantContext.getStore()?.organizationId || DEFAULT_ORGANIZATION_ID])).rows[0];
  return normalizeCompanyProfile(row?.profile || {});
}
async function consumeRateLimit(key, windowMs, max) {
  const interval = `${Math.max(1000, windowMs)} milliseconds`;
  const { rows } = await pool.query(
    `INSERT INTO rate_limits(key, count, window_start)
     VALUES($1, 1, now())
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < now() - $2::interval THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - $2::interval THEN now() ELSE rate_limits.window_start END
     RETURNING count`,
    [key, interval],
  );
  return Number(rows[0]?.count || 0) <= max;
}
async function loginRateLimit(req, res, next) {
  const key = `${req.ip || req.socket.remoteAddress || "unknown"}:${String(req.body?.email || "").trim().toLowerCase()}`;
  if (!(await consumeRateLimit(`login:${key}`, LOGIN_WINDOW_MS, LOGIN_MAX_ATTEMPTS))) return res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos e inténtalo nuevamente." });
  req.loginAttemptKey = key;
  next();
}
setInterval(() => {
  pool.query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'").catch(() => {});
}, LOGIN_WINDOW_MS).unref();

// Limitador genérico por usuario autenticado (además del de login): evita que una cuenta
// comprometida o un cliente descontrolado agote la base con llamadas repetidas a endpoints caros
// (ej. /api/bootstrap dispara ~15 consultas en paralelo) o golpee rutas de escritura en bucle.
const API_RATE_WINDOW_MS = 60 * 1000;
function apiRateLimit(max) {
  return async (req, res, next) => {
    const key = `${req.user?.id || req.ip}:${req.method}:${req.baseUrl}${req.route?.path || req.path}`;
    if (!(await consumeRateLimit(`api:${key}`, API_RATE_WINDOW_MS, max))) return res.status(429).json({ error: "Demasiadas solicitudes. Esperá un momento e intentá nuevamente." });
    next();
  };
}

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
    CREATE TABLE IF NOT EXISTS push_subscriptions ( endpoint text PRIMARY KEY, user_id text, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
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
    CREATE TABLE IF NOT EXISTS delivery_notes ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS whiteboard_notes ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS stock_movements (
      id text PRIMARY KEY, part_id text NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
      quantity numeric NOT NULL, balance numeric NOT NULL, movement_type text NOT NULL,
      source_type text, source_id text, note text, user_id text,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS audit_log (
      id text PRIMARY KEY, entity_type text NOT NULL, entity_id text NOT NULL,
      action text NOT NULL, user_id text, user_name text, before_data jsonb,
      after_data jsonb, reason text, request_id text, ip_address text,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS app_settings ( key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS rate_limits ( key text PRIMARY KEY, count integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS file_assets (
      id text PRIMARY KEY, entity_type text NOT NULL, entity_id text NOT NULL, field_name text NOT NULL,
      original_name text, mime_type text NOT NULL, size_bytes integer, sha256 text, content bytea NOT NULL, created_by text,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS gantt_tasks ( id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
  `);
  // Migración multiempresa. Los datos existentes pasan a la organización Automática sin alterar
  // IDs ni relaciones. RLS aplica el tenant de la sesión a lecturas, escrituras y eliminaciones.
  // node-postgres usa el protocolo extendido cuando hay parámetros ($1). PostgreSQL no
  // admite más de una sentencia en ese modo, por eso CREATE + INSERT en una misma llamada
  // impedía iniciar el servidor con "cannot insert multiple commands into a prepared statement".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations(
      id text PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL,
      active boolean NOT NULL DEFAULT true, plan text NOT NULL DEFAULT 'professional',
      profile jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())
  `);
  await pool.query(`
    INSERT INTO organizations(id,slug,name,profile)
      VALUES('org-automatica','automatica','AUTOMATICA ARG',$1)
      ON CONFLICT(id) DO NOTHING
  `, [DEFAULT_COMPANY_PROFILE]);
  const tenantTables = ["users", "clients", "projects", "budgets", "financial_movements", "orders", "tasks", "notifications", "parts", "suppliers", "purchase_orders", "material_lists", "delivery_notes", "push_subscriptions", "whiteboard_notes", "stock_movements", "audit_log", "app_settings", "file_assets", "gantt_tasks"];
  for (const table of tenantTables) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS organization_id text DEFAULT '${DEFAULT_ORGANIZATION_ID}'; UPDATE ${table} SET organization_id='${DEFAULT_ORGANIZATION_ID}' WHERE organization_id IS NULL; ALTER TABLE ${table} ALTER COLUMN organization_id SET NOT NULL;`);
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='${table}_organization_fk') THEN ALTER TABLE ${table} ADD CONSTRAINT ${table}_organization_fk FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE; END IF; END $$;`);
  }
  // Cada empresa puede tener las mismas claves de configuración (branding, cierres, cotización).
  await pool.query(`DO $$ DECLARE definition text; BEGIN SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conname='app_settings_pkey' AND conrelid='app_settings'::regclass; IF definition IS NULL OR position('organization_id' in definition)=0 THEN ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey; ALTER TABLE app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY(organization_id,key); END IF; END $$;`);
  // Sólo el tenant histórico de AUTOMATICA recibe sus datos corporativos. Los demás tenants
  // parten de valores neutros y nunca usan a AUTOMATICA como fallback de una OC o reporte.
  await pool.query(
    "INSERT INTO app_settings(organization_id,key,value) VALUES($1,'branding_v1',$2) ON CONFLICT(organization_id,key) DO NOTHING",
    [DEFAULT_ORGANIZATION_ID, AUTOMATICA_BRANDING],
  );
  // Versiones anteriores normalizaban campos vacíos con datos de AUTOMATICA. Se sanea únicamente
  // la coincidencia exacta en tenants ajenos, preservando cualquier dato corporativo real.
  await pool.query(`
    UPDATE app_settings settings
       SET value = coalesce(settings.value,'{}'::jsonb) || jsonb_build_object(
         'companyName', CASE WHEN upper(trim(coalesce(settings.value->>'companyName',''))) IN ('','AUTOMATICA ARG') THEN organization.name ELSE settings.value->>'companyName' END,
         'companyLegalName', CASE WHEN upper(trim(coalesce(settings.value->>'companyLegalName',''))) IN ('','AUTOMATICA ARG') THEN organization.name ELSE settings.value->>'companyLegalName' END,
         'companyCuit', CASE WHEN regexp_replace(coalesce(settings.value->>'companyCuit',''),'[^0-9]','','g')='20351960206' THEN '' ELSE coalesce(settings.value->>'companyCuit','') END,
         'companyAddress', CASE WHEN trim(coalesce(settings.value->>'companyAddress',''))='Bv. Ovidio Lagos 160 - Venado Tuerto (Santa Fe)' THEN '' ELSE coalesce(settings.value->>'companyAddress','') END,
         'companyPhone', CASE WHEN regexp_replace(coalesce(settings.value->>'companyPhone',''),'[^0-9]','','g') IN ('543462596041','3462596041') THEN '' ELSE coalesce(settings.value->>'companyPhone','') END,
         'companyWebsite', CASE WHEN lower(regexp_replace(coalesce(settings.value->>'companyWebsite',''),'^https?://(www\\.)?','','i')) IN ('automatica-arg.com.ar','www.automatica-arg.com.ar') THEN '' ELSE coalesce(settings.value->>'companyWebsite','') END
       ), updated_at=now()
      FROM organizations organization
     WHERE settings.organization_id=organization.id
       AND settings.organization_id<>$1
       AND settings.key='branding_v1'
  `, [DEFAULT_ORGANIZATION_ID]);
  await pool.query(`
    CREATE OR REPLACE FUNCTION ordengo_apply_organization() RETURNS trigger AS $$
    DECLARE active_org text;
    BEGIN
      active_org := NULLIF(current_setting('app.organization_id', true), '');
      IF active_org IS NOT NULL THEN NEW.organization_id := active_org; END IF;
      IF NEW.organization_id IS NULL THEN NEW.organization_id := '${DEFAULT_ORGANIZATION_ID}'; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
  `);
  for (const table of tenantTables) {
    await pool.query(`DROP TRIGGER IF EXISTS ${table}_organization_trigger ON ${table}; CREATE TRIGGER ${table}_organization_trigger BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ordengo_apply_organization();`);
    await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY; DROP POLICY IF EXISTS ${table}_tenant_policy ON ${table}; CREATE POLICY ${table}_tenant_policy ON ${table} USING ((current_user <> '${TENANT_DB_ROLE}' AND NULLIF(current_setting('app.organization_id',true),'') IS NULL) OR organization_id=NULLIF(current_setting('app.organization_id',true),'')) WITH CHECK ((current_user <> '${TENANT_DB_ROLE}' AND NULLIF(current_setting('app.organization_id',true),'') IS NULL) OR organization_id=NULLIF(current_setting('app.organization_id',true),''));`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${table}_organization_idx ON ${table}(organization_id);`);
  }
  // Rol de ejecución sin BYPASSRLS. Se crea durante la migración con la conexión propietaria
  // y recibe sólo los permisos CRUD necesarios; el aislamiento real lo determinan las políticas.
  await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${TENANT_DB_ROLE}') THEN CREATE ROLE ${TENANT_DB_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF; END $$;`);
  await pool.query(`GRANT ${TENANT_DB_ROLE} TO CURRENT_USER`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${TENANT_DB_ROLE}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${TENANT_DB_ROLE}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${TENANT_DB_ROLE};`);
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${TENANT_DB_ROLE}; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO ${TENANT_DB_ROLE};`);
  await pool.query(`ALTER TABLE organizations ENABLE ROW LEVEL SECURITY; ALTER TABLE organizations FORCE ROW LEVEL SECURITY; DROP POLICY IF EXISTS organizations_tenant_policy ON organizations; CREATE POLICY organizations_tenant_policy ON organizations USING ((current_user <> '${TENANT_DB_ROLE}' AND NULLIF(current_setting('app.organization_id',true),'') IS NULL) OR id=NULLIF(current_setting('app.organization_id',true),'')) WITH CHECK ((current_user <> '${TENANT_DB_ROLE}' AND NULLIF(current_setting('app.organization_id',true),'') IS NULL) OR id=NULLIF(current_setting('app.organization_id',true),''));`);
  // Verificación fail-closed: si una migración futura agrega una tabla al conjunto multiempresa
  // pero deja RLS desactivado, sin FORCE o sin política, la API no debe arrancar y exponer datos.
  const isolationAudit = await pool.query(`
    SELECT tenant_table.table_name,
           table_class.relrowsecurity AS rls_enabled,
           table_class.relforcerowsecurity AS rls_forced,
           EXISTS (
             SELECT 1 FROM pg_policies policy
              WHERE policy.schemaname='public' AND policy.tablename=tenant_table.table_name
           ) AS has_policy
      FROM unnest($1::text[]) AS tenant_table(table_name)
      JOIN pg_class table_class ON table_class.oid=('public.' || tenant_table.table_name)::regclass
  `, [tenantTables]);
  const unsafeTables = isolationAudit.rows.filter((row) => !row.rls_enabled || !row.rls_forced || !row.has_policy);
  const tenantRole = (await pool.query("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=$1", [TENANT_DB_ROLE])).rows[0];
  if (unsafeTables.length || !tenantRole || tenantRole.rolbypassrls || tenantRole.rolsuper) {
    throw new Error(`Aislamiento multiempresa inválido: ${unsafeTables.map((row) => row.table_name).join(", ") || TENANT_DB_ROLE}`);
  }
  // Prueba real de aislamiento sobre PostgreSQL, no sólo inspección de configuración. Se crean
  // dos notas temporales dentro de una transacción, se cambia al rol de la aplicación y se exige
  // que el tenant A no pueda leer la nota B. ROLLBACK elimina todas las filas de prueba.
  const isolationProbe = await rawPoolConnect();
  try {
    const probeSuffix = crypto.randomUUID();
    const organizationA = `org-probe-a-${probeSuffix}`;
    const organizationB = `org-probe-b-${probeSuffix}`;
    const noteA = `note-probe-a-${probeSuffix}`;
    const noteB = `note-probe-b-${probeSuffix}`;
    await isolationProbe.query("BEGIN");
    await isolationProbe.query("INSERT INTO organizations(id,slug,name,profile) VALUES($1,$2,'Probe A','{}'),($3,$4,'Probe B','{}')", [organizationA, `probe-a-${probeSuffix}`, organizationB, `probe-b-${probeSuffix}`]);
    await isolationProbe.query("INSERT INTO whiteboard_notes(id,data,organization_id) VALUES($1,$2,$3),($4,$5,$6)", [noteA, { id: noteA, title: "A" }, organizationA, noteB, { id: noteB, title: "B" }, organizationB]);
    const partA = `part-probe-a-${probeSuffix}`;
    const partB = `part-probe-b-${probeSuffix}`;
    await isolationProbe.query("INSERT INTO parts(id,data,organization_id) VALUES($1,$2,$3),($4,$5,$6)", [partA, { id: partA, name: "A" }, organizationA, partB, { id: partB, name: "B" }, organizationB]);
    await isolationProbe.query("SELECT set_config('app.organization_id',$1,true)", [organizationA]);
    await isolationProbe.query(`SET LOCAL ROLE ${TENANT_DB_ROLE}`);

    // Lectura. Se comprueba en dos tablas distintas: si alguna quedara fuera del bucle que
    // aplica las políticas, una sola tabla de muestra no lo detectaría.
    const visibleProbeNotes = (await isolationProbe.query("SELECT id FROM whiteboard_notes WHERE id=ANY($1::text[]) ORDER BY id", [[noteA, noteB]])).rows.map((row) => row.id);
    if (visibleProbeNotes.length !== 1 || visibleProbeNotes[0] !== noteA) throw new Error("La política RLS permitió leer otro tenant");
    const visibleProbeParts = (await isolationProbe.query("SELECT id FROM parts WHERE id=ANY($1::text[]) ORDER BY id", [[partA, partB]])).rows.map((row) => row.id);
    if (visibleProbeParts.length !== 1 || visibleProbeParts[0] !== partA) throw new Error("La política RLS permitió leer inventario de otro tenant");

    // Escritura. La política tiene WITH CHECK además de USING, pero eso no se verificaba nunca:
    // si alguien lo quitara al editarla, la lectura seguiría aislada y las escrituras cruzadas
    // pasarían sin que nada avisara. Se usan SAVEPOINT porque un error aborta la transacción.
    const mustFail = async (label, sql, params) => {
      await isolationProbe.query("SAVEPOINT probe_write");
      try {
        await isolationProbe.query(sql, params);
        throw new Error(label);
      } catch (error) {
        if (error.message === label) throw error; // no falló: el aislamiento está roto
        await isolationProbe.query("ROLLBACK TO SAVEPOINT probe_write");
      }
    };
    // Un alta que declara otra empresa no falla: el trigger BEFORE INSERT reescribe el campo con el
    // tenant activo. Lo que corresponde comprobar es eso, que el registro quede estampado en la
    // empresa de la sesión y no en la que pidió el cliente.
    const stampedId = `note-probe-x-${probeSuffix}`;
    await isolationProbe.query("INSERT INTO whiteboard_notes(id,data,organization_id) VALUES($1,$2,$3)", [stampedId, { title: "X" }, organizationB]);
    const stamped = (await isolationProbe.query("SELECT organization_id FROM whiteboard_notes WHERE id=$1", [stampedId])).rows[0];
    if (!stamped || stamped.organization_id !== organizationA) throw new Error("Un alta pudo declarar una empresa ajena");

    await mustFail(
      "La política RLS permitió mover un registro a otro tenant",
      "UPDATE whiteboard_notes SET organization_id=$2 WHERE id=$1",
      [noteA, organizationB]);

    // UPDATE y DELETE sobre filas ajenas no deben fallar: simplemente no alcanzan ninguna fila.
    // Si afectaran alguna, el tenant estaría escribiendo sobre datos de otra empresa.
    const updatedForeign = (await isolationProbe.query("UPDATE whiteboard_notes SET data=$2 WHERE id=$1", [noteB, { title: "hackeado" }])).rowCount;
    if (updatedForeign !== 0) throw new Error("La política RLS permitió modificar un registro de otro tenant");
    const deletedForeign = (await isolationProbe.query("DELETE FROM whiteboard_notes WHERE id=$1", [noteB])).rowCount;
    if (deletedForeign !== 0) throw new Error("La política RLS permitió eliminar un registro de otro tenant");

    await isolationProbe.query("ROLLBACK");
  } catch (error) {
    try { await isolationProbe.query("ROLLBACK"); } catch {}
    throw new Error(`Aislamiento multiempresa inválido: ${error.message}`);
  } finally {
    isolationProbe.release();
  }
  // Repara notas creadas por versiones previas cuyo organization_id no coincide con el creador.
  // No se eliminan: vuelven al tenant del autor. Después se quitan vínculos a proyectos o usuarios
  // externos para que ni siquiera queden referencias cruzadas ocultas dentro del JSON.
  await pool.query(`
    UPDATE whiteboard_notes note
       SET organization_id=author.organization_id, updated_at=now()
      FROM users author
     WHERE note.data->>'createdBy'=author.id
       AND note.organization_id<>author.organization_id
  `);
  await pool.query(`
    UPDATE whiteboard_notes note
       SET data=jsonb_set(note.data,'{projectId}','""'::jsonb,true), updated_at=now()
     WHERE coalesce(note.data->>'projectId','')<>''
       AND NOT EXISTS (
         SELECT 1 FROM projects project
          WHERE project.id=note.data->>'projectId'
            AND project.organization_id=note.organization_id
       )
  `);
  await pool.query(`
    UPDATE whiteboard_notes note
       SET data=jsonb_set(
         note.data,
         '{sharedWith}',
         coalesce((
           SELECT jsonb_agg(shared.user_id)
             FROM jsonb_array_elements_text(coalesce(note.data->'sharedWith','[]'::jsonb)) shared(user_id)
             JOIN users target ON target.id=shared.user_id AND target.organization_id=note.organization_id
         ), '[]'::jsonb),
         true
       ), updated_at=now()
     WHERE jsonb_typeof(coalesce(note.data->'sharedWith','[]'::jsonb))='array'
  `);
  // Integridad relacional por tenant. Los IDs globales por sí solos no bastan: estas claves
  // compuestas impiden asociar una tarea, OC, nota, movimiento o archivo a datos de otra empresa.
  for (const table of ["users", "clients", "projects", "budgets", "suppliers", "parts"]) {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_organization_id_unique ON ${table}(organization_id,id)`);
  }
  await pool.query(`
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id text GENERATED ALWAYS AS (NULLIF(data->>'project','')) STORED;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS project_id text GENERATED ALWAYS AS (NULLIF(data->>'projectId','')) STORED;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id text GENERATED ALWAYS AS (NULLIF(data->>'supplierId','')) STORED;
    ALTER TABLE whiteboard_notes ADD COLUMN IF NOT EXISTS project_id text GENERATED ALWAYS AS (NULLIF(data->>'projectId','')) STORED;
    ALTER TABLE whiteboard_notes ADD COLUMN IF NOT EXISTS created_by text GENERATED ALWAYS AS (NULLIF(data->>'createdBy','')) STORED;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tasks_project_tenant_fk') THEN ALTER TABLE tasks ADD CONSTRAINT tasks_project_tenant_fk FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='purchase_orders_project_tenant_fk') THEN ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_project_tenant_fk FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='purchase_orders_supplier_tenant_fk') THEN ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_supplier_tenant_fk FOREIGN KEY(organization_id,supplier_id) REFERENCES suppliers(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='whiteboard_project_tenant_fk') THEN ALTER TABLE whiteboard_notes ADD CONSTRAINT whiteboard_project_tenant_fk FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='whiteboard_author_tenant_fk') THEN ALTER TABLE whiteboard_notes ADD CONSTRAINT whiteboard_author_tenant_fk FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notifications_user_tenant_fk') THEN ALTER TABLE notifications ADD CONSTRAINT notifications_user_tenant_fk FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id) ON DELETE CASCADE NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stock_movements_part_tenant_fk') THEN ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_part_tenant_fk FOREIGN KEY(organization_id,part_id) REFERENCES parts(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gantt_tasks_project_tenant_fk') THEN ALTER TABLE gantt_tasks ADD CONSTRAINT gantt_tasks_project_tenant_fk FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id) ON DELETE CASCADE NOT VALID; END IF;
    END $$;
  `);
  // Los folios visibles (OT-..., OC-..., tareas, materiales, etc.) sólo deben ser únicos dentro
  // de cada empresa. Las versiones iniciales conservaban PRIMARY KEY(id), por lo que una segunda
  // organización podía chocar con un identificador legítimo de la primera y el alta desaparecía
  // al refrescar. Se eliminan primero las FK antiguas de una sola columna y luego se migra cada
  // entidad operativa a PRIMARY KEY(organization_id,id). Las FK *_tenant_fk creadas arriba son
  // las únicas relaciones válidas entre entidades multiempresa.
  // Estos módulos fueron retirados y versiones antiguas podían conservar FK simples hacia
  // projects/clients. Se quitan antes de cambiar las claves para no bloquear la migración.
  await pool.query("DROP TABLE IF EXISTS technical_documents; DROP TABLE IF EXISTS service_contracts; DROP TABLE IF EXISTS assets;");
  await pool.query(`
    ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_part_id_fkey;
    ALTER TABLE gantt_tasks DROP CONSTRAINT IF EXISTS gantt_tasks_project_id_fkey;
    ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_client_fk;
    ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_client_fk;
    ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_project_fk;
    ALTER TABLE financial_movements DROP CONSTRAINT IF EXISTS finances_client_fk;
    ALTER TABLE financial_movements DROP CONSTRAINT IF EXISTS finances_project_fk;
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_client_fk;
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_project_fk;
    ALTER TABLE material_lists DROP CONSTRAINT IF EXISTS material_lists_client_fk;
    ALTER TABLE material_lists DROP CONSTRAINT IF EXISTS material_lists_project_fk;
  `);
  // push_subscriptions queda fuera a propósito: no tiene columna "id" y su clave es el endpoint,
  // que el servicio de push del navegador genera único a nivel mundial. Sumarla acá haría que el
  // bucle intentara una PK (organization_id,id) sobre una columna inexistente. El aislamiento por
  // organización lo sigue dando RLS, que sí la cubre en tenantTables.
  const tenantEntityTables = [
    "clients", "projects", "budgets", "financial_movements", "orders", "tasks", "notifications",
    "parts", "suppliers", "purchase_orders", "material_lists", "delivery_notes", "whiteboard_notes", "stock_movements",
    "audit_log", "file_assets", "gantt_tasks",
  ];
  for (const table of tenantEntityTables) {
    await pool.query(`
      DO $$ DECLARE definition text;
      BEGIN
        SELECT pg_get_constraintdef(oid) INTO definition
          FROM pg_constraint
         WHERE conname='${table}_pkey' AND conrelid='${table}'::regclass;
        IF definition IS NULL OR position('organization_id' in definition)=0 THEN
          ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_pkey;
          ALTER TABLE ${table} ADD CONSTRAINT ${table}_pkey PRIMARY KEY(organization_id,id);
        END IF;
      END $$;
    `);
  }
  await pool.query(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_id text GENERATED ALWAYS AS (NULLIF(data->>'clientId','')) STORED;
    ALTER TABLE budgets ADD COLUMN IF NOT EXISTS client_id text GENERATED ALWAYS AS (NULLIF(data->>'clientId','')) STORED;
    ALTER TABLE budgets ADD COLUMN IF NOT EXISTS project_id text GENERATED ALWAYS AS (NULLIF(data->>'projectId','')) STORED;
    ALTER TABLE financial_movements ADD COLUMN IF NOT EXISTS client_id text GENERATED ALWAYS AS (NULLIF(data->>'clientId','')) STORED;
    ALTER TABLE financial_movements ADD COLUMN IF NOT EXISTS project_id text GENERATED ALWAYS AS (NULLIF(data->>'projectId','')) STORED;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_id text GENERATED ALWAYS AS (NULLIF(data->>'clientId','')) STORED;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS project_id text GENERATED ALWAYS AS (NULLIF(data->>'projectId','')) STORED;
    ALTER TABLE material_lists ADD COLUMN IF NOT EXISTS client_id text GENERATED ALWAYS AS (NULLIF(data->>'clientId','')) STORED;
    ALTER TABLE material_lists ADD COLUMN IF NOT EXISTS project_id text GENERATED ALWAYS AS (NULLIF(data->>'projectId','')) STORED;
    ALTER TABLE budgets ADD COLUMN IF NOT EXISTS budget_owner_id text GENERATED ALWAYS AS (NULLIF(data->>'ownerId','')) STORED;
    ALTER TABLE financial_movements ADD COLUMN IF NOT EXISTS budget_id text GENERATED ALWAYS AS (NULLIF(coalesce(data->>'budgetId',data->>'sourceBudgetId'),'')) STORED;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS budget_id text GENERATED ALWAYS AS (NULLIF(data->>'budgetId','')) STORED;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS tech_id text GENERATED ALWAYS AS (NULLIF(data->>'techId','')) STORED;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_id text GENERATED ALWAYS AS (NULLIF(data->>'assignee','')) STORED;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS budget_id text GENERATED ALWAYS AS (NULLIF(data->>'budgetId','')) STORED;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='projects_client_tenant_fk') THEN ALTER TABLE projects ADD CONSTRAINT projects_client_tenant_fk FOREIGN KEY(organization_id,client_id) REFERENCES clients(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='budgets_client_tenant_fk') THEN ALTER TABLE budgets ADD CONSTRAINT budgets_client_tenant_fk FOREIGN KEY(organization_id,client_id) REFERENCES clients(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='budgets_project_tenant_fk') THEN ALTER TABLE budgets ADD CONSTRAINT budgets_project_tenant_fk FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='budgets_owner_tenant_fk') THEN ALTER TABLE budgets ADD CONSTRAINT budgets_owner_tenant_fk FOREIGN KEY(organization_id,budget_owner_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='finances_client_tenant_fk') THEN ALTER TABLE financial_movements ADD CONSTRAINT finances_client_tenant_fk FOREIGN KEY(organization_id,client_id) REFERENCES clients(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='finances_project_tenant_fk') THEN ALTER TABLE financial_movements ADD CONSTRAINT finances_project_tenant_fk FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='finances_budget_tenant_fk') THEN ALTER TABLE financial_movements ADD CONSTRAINT finances_budget_tenant_fk FOREIGN KEY(organization_id,budget_id) REFERENCES budgets(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='orders_client_tenant_fk') THEN ALTER TABLE orders ADD CONSTRAINT orders_client_tenant_fk FOREIGN KEY(organization_id,client_id) REFERENCES clients(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='orders_project_tenant_fk') THEN ALTER TABLE orders ADD CONSTRAINT orders_project_tenant_fk FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='orders_budget_tenant_fk') THEN ALTER TABLE orders ADD CONSTRAINT orders_budget_tenant_fk FOREIGN KEY(organization_id,budget_id) REFERENCES budgets(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='orders_tech_tenant_fk') THEN ALTER TABLE orders ADD CONSTRAINT orders_tech_tenant_fk FOREIGN KEY(organization_id,tech_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tasks_assignee_tenant_fk') THEN ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_tenant_fk FOREIGN KEY(organization_id,assignee_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='purchase_orders_budget_tenant_fk') THEN ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_budget_tenant_fk FOREIGN KEY(organization_id,budget_id) REFERENCES budgets(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='material_lists_client_tenant_fk') THEN ALTER TABLE material_lists ADD CONSTRAINT material_lists_client_tenant_fk FOREIGN KEY(organization_id,client_id) REFERENCES clients(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='material_lists_project_tenant_fk') THEN ALTER TABLE material_lists ADD CONSTRAINT material_lists_project_tenant_fk FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id) ON DELETE RESTRICT NOT VALID; END IF;
    END $$;
  `);
  // Las organizaciones creadas por versiones anteriores quedaban con profile={} y al leerlas
  // heredaban las tarifas/perfiles predeterminados de AUTOMATICA. Se inicializan con valores
  // neutros sin tocar empresas que ya hayan configurado su perfil.
  await pool.query("UPDATE organizations SET profile=$2,updated_at=now() WHERE id<>$1 AND profile='{}'::jsonb", [DEFAULT_ORGANIZATION_ID, EMPTY_ORGANIZATION_PROFILE]);
  await pool.query("CREATE INDEX IF NOT EXISTS gantt_tasks_project_idx ON gantt_tasks (project_id);");
  // Baja definitiva del módulo de gestión industrial (activos, contratos/SLA y documentación
  // técnica). Se eliminan las tablas y sus datos por pedido expreso. Las órdenes conservan los
  // campos que habían copiado del contrato (responseSlaHours, minimumBillableHours, assetId): son
  // el respaldo del criterio con el que se facturó cada OT y se siguen respetando para no alterar
  // el histórico. Las órdenes nuevas usan los valores por defecto (SLA 2 h, mínimo 2 h).
  await pool.query("CREATE INDEX IF NOT EXISTS stock_movements_part_date_idx ON stock_movements (part_id, created_at DESC); CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);");
  await pool.query("CREATE INDEX IF NOT EXISTS file_assets_entity_idx ON file_assets(entity_type,entity_id);");
  await pool.query("ALTER TABLE file_assets ADD COLUMN IF NOT EXISTS size_bytes integer; ALTER TABLE file_assets ADD COLUMN IF NOT EXISTS sha256 text;");
  await pool.query("CREATE INDEX IF NOT EXISTS orders_updated_idx ON orders(updated_at); CREATE INDEX IF NOT EXISTS tasks_updated_idx ON tasks(updated_at); CREATE INDEX IF NOT EXISTS orders_project_idx ON orders((data->>'projectId')); CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks((data->>'project')); CREATE INDEX IF NOT EXISTS budgets_project_idx ON budgets((data->>'projectId')); CREATE INDEX IF NOT EXISTS finances_project_idx ON financial_movements((data->>'projectId'));");
  // Migración idempotente para instalaciones existentes
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS mustchangepassword boolean DEFAULT false;");
  // Config individual por usuario (pantalla TV: nombre, modo TV, rotación) — permite N televisores, uno por cuenta Monitor Oficina.
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb;");
  // Permite revocar sesiones: el JWT lleva el token_version vigente al momento de emitirlo, y
  // "auth" lo compara contra el valor actual en la base. Incrementarlo (al cambiar la contraseña,
  // propia o por un admin) invalida de inmediato cualquier token viejo, aunque todavía no expire.
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;");
  await pool.query("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_id text; ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_address text;");

  // Todo lo que sigue son siembras y migraciones de compatibilidad de la instalación histórica.
  // Se ejecutan bajo el tenant de AUTOMATICA para que un reinicio nunca lea ni reescriba filas de
  // una empresa nueva que reutilice los mismos folios visibles (p. ej. c1, sp1 u OT-2026-001).
  await tenantContext.run({ organizationId: DEFAULT_ORGANIZATION_ID }, async () => {

  // Migra asignaciones históricas basadas en nombres a identificadores inmutables. Solo se
  // resuelven nombres inequívocos; si hay dos usuarios con el mismo nombre, la orden queda sin
  // acceso técnico hasta que un administrador la reasigne explícitamente.
  const assignmentMigrationDone = (await pool.query("SELECT 1 FROM app_settings WHERE key='order_assignment_ids_v1'")).rowCount > 0;
  if (!assignmentMigrationDone) {
    const usersForMigration = (await pool.query("SELECT id,name FROM users")).rows;
    const idsByName = new Map();
    for (const user of usersForMigration) {
      const key = String(user.name || "").trim().toLowerCase();
      if (!key) continue;
      const ids = idsByName.get(key) || []; ids.push(user.id); idsByName.set(key, ids);
    }
    const historicalOrders = (await pool.query("SELECT id,data FROM orders")).rows;
    for (const row of historicalOrders) {
      const order = { ...row.data };
      const names = [order.tech, ...(Array.isArray(order.assignedTechs) ? order.assignedTechs : [])].map((name) => String(name || "").trim().toLowerCase()).filter(Boolean);
      const resolved = [...new Set(names.flatMap((name) => idsByName.get(name)?.length === 1 ? idsByName.get(name) : []))];
      if (!Array.isArray(order.assignedTechIds) || !order.assignedTechIds.length) order.assignedTechIds = resolved;
      if (!order.techId && order.tech) {
        const candidates = idsByName.get(String(order.tech).trim().toLowerCase()) || [];
        if (candidates.length === 1) order.techId = candidates[0];
      }
      await pool.query("UPDATE orders SET data=$2, updated_at=updated_at WHERE id=$1", [row.id, order]);
    }
    await pool.query("INSERT INTO app_settings(key,value) VALUES('order_assignment_ids_v1',$1) ON CONFLICT(organization_id,key) DO NOTHING", [{ migratedAt: new Date().toISOString() }]);
  }

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

  // Mismo criterio que el catálogo: la demo se siembra una vez y nunca se reintenta, así borrar
  // los clientes de ejemplo es definitivo.
  const clientsSeedDone = (await pool.query("SELECT 1 FROM app_settings WHERE key='demo_clients_seed_v1'")).rowCount > 0;
  if (!clientsSeedDone) await pool.query("INSERT INTO app_settings(key,value) VALUES('demo_clients_seed_v1',$1) ON CONFLICT(organization_id,key) DO NOTHING", [{ seededAt: new Date().toISOString() }]);
  if (!clientsSeedDone && (await pool.query("SELECT count(*)::int n FROM clients")).rows[0].n === 0) {
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

  // La siembra de demo corre UNA sola vez, marcada en app_settings — no "cada vez que la tabla
  // está vacía". Con la condición anterior, borrar todo el catálogo y reiniciar el servidor
  // resucitaba los cuatro materiales de ejemplo, y no había forma de dejar el inventario vacío.
  // Mismo criterio que ya se usa para el alta del monitor unas líneas más abajo.
  if ((await pool.query("SELECT 1 FROM app_settings WHERE key='demo_parts_seed_v1'")).rowCount === 0) {
    if ((await pool.query("SELECT count(*)::int n FROM parts")).rows[0].n === 0) {
      const parts = [
        { id: "sp1", name: "Ventilador disipador VFD", unit: "u", price: 1200, cost: 780, stock: 4, minStock: 2 },
        { id: "sp2", name: "Cable de red blindado (m)", unit: "m", price: 350, cost: 210, stock: 120, minStock: 50 },
        { id: "sp3", name: "Sensor inductivo M12", unit: "u", price: 4200, cost: 2600, stock: 1, minStock: 3 },
        { id: "sp4", name: "Fuente 24VDC 5A", unit: "u", price: 9800, cost: 6100, stock: 2, minStock: 1 },
      ];
      for (const p of parts) await pool.query("INSERT INTO parts(id,data) VALUES($1,$2)", [p.id, p]);
    }
    // Se marca igual aunque no se haya sembrado: en instalaciones que ya tienen catálogo, esto
    // deja registrado que la siembra no debe volver a intentarse nunca.
    await pool.query("INSERT INTO app_settings(key,value) VALUES('demo_parts_seed_v1',$1) ON CONFLICT(organization_id,key) DO NOTHING", [{ seededAt: new Date().toISOString() }]);
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
  });
}

/* ------------------------------------------------ Helpers ------------------------------------------------ */
const pubUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, color: u.color, active: u.active, organizationId: u.organization_id, mustChangePassword: u.mustchangepassword || false, settings: u.settings || {} });
// Tope de la foto de perfil, en caracteres del data URL. Estas fotos viajan dentro de settings y
// /api/bootstrap devuelve todos los usuarios, así que una foto sin achicar se multiplica por la
// nómina entera en cada arranque. El cliente la reduce a 256px antes de subirla; esto es la red.
const PROFILE_PHOTO_MAX_CHARS = 200_000;
// Campos de la ficha que cada persona puede editar de su propio perfil, sin pasar por administración.
const PROFILE_SELF_FIELDS = ["photoDataUrl", "phone", "position", "documentId", "emergencyContact", "emergencyPhone", "bloodType"];
// Config de pantalla TV por usuario (Monitor Oficina): permite N televisores, cada uno con su propia cuenta e identidad.
const buildSettingsPatch = (body, current = {}) => {
  const patch = {};
  if (body.screenName !== undefined) patch.screenName = String(body.screenName || "").trim().slice(0, 60);
  if (body.tvModeEnabled !== undefined) patch.tvModeEnabled = Boolean(body.tvModeEnabled);
  if (body.tvCycleEnabled !== undefined) patch.tvCycleEnabled = Boolean(body.tvCycleEnabled);
  if (body.tvCycleSeconds !== undefined) patch.tvCycleSeconds = Math.max(10, Math.round(Number(body.tvCycleSeconds) || 30));
  // Ficha personal para la credencial de empresa. La foto viaja como data URL y se valida el tipo
  // igual que el logo de marca: sin esta comprobación cualquier cadena entraría a la base y después
  // se renderizaría en un <img> y en el PDF. Se acepta cadena vacía para poder borrarla.
  if (body.photoDataUrl !== undefined) {
    const photo = String(body.photoDataUrl || "");
    // El tamaño se valida en la ruta (ver PROFILE_PHOTO_MAX_CHARS) para poder devolver un 400 con el
    // motivo: este helper es síncrono y con Express 4 un throw acá quedaría como unhandled rejection.
    if (!photo || (photo.length <= PROFILE_PHOTO_MAX_CHARS && /^data:image\/(png|jpeg|webp);base64,/i.test(photo))) patch.photoDataUrl = photo;
  }
  if (body.phone !== undefined) patch.phone = String(body.phone || "").trim().slice(0, 40);
  if (body.position !== undefined) patch.position = String(body.position || "").trim().slice(0, 60);
  if (body.documentId !== undefined) patch.documentId = String(body.documentId || "").trim().slice(0, 20);
  if (body.emergencyContact !== undefined) patch.emergencyContact = String(body.emergencyContact || "").trim().slice(0, 80);
  if (body.emergencyPhone !== undefined) patch.emergencyPhone = String(body.emergencyPhone || "").trim().slice(0, 40);
  if (body.bloodType !== undefined) patch.bloodType = String(body.bloodType || "").trim().slice(0, 10);
  // Alcance del cliente corporativo: a qué empresa pertenece y, opcionalmente, a qué planta. Define
  // QUÉ VE, así que queda fuera de PROFILE_SELF_FIELDS: sólo administración puede asignarlo. Planta
  // vacía significa "todas las plantas de esa empresa".
  if (body.clientId !== undefined) patch.clientId = String(body.clientId || "").trim().slice(0, 60);
  if (body.clientSite !== undefined) patch.clientSite = String(body.clientSite || "").trim().slice(0, 80);
  if (!Object.keys(patch).length) return null;
  const merged = { ...current, ...patch };
  // Token de verificación de la credencial. Lo genera el servidor la primera vez que se guarda una
  // ficha y no se vuelve a tocar: es lo que se imprime en el QR. Nunca se toma del cliente —este
  // helper sólo copia campos conocidos, así que un credentialToken enviado en el cuerpo se descarta—
  // porque si alguien pudiera elegirlo, podría clonar el QR de otra persona.
  if (!merged.credentialToken) merged.credentialToken = crypto.randomUUID();
  return merged;
};
// Qué ve del resto del equipo quien no es admin. Se suman foto y cargo, que son los datos con los
// que la app identifica a una persona en tarjetas y avatares. Documento, teléfono, contacto de
// emergencia y grupo sanguíneo NO se exponen: son datos personales que sólo necesitan la
// administración y su propio dueño, y la credencial se genera del lado de quien tiene acceso.
const directoryUser = (u, viewerRole) => viewerRole === "admin" ? pubUser(u) : ({
  id: u.id, name: u.name, role: u.role, color: u.color, active: u.active,
  settings: { photoDataUrl: u.settings?.photoDataUrl || "", position: u.settings?.position || "" },
});
// Saneador del texto con formato de las descripciones. Se guarda HTML porque es lo que produce un
// editor de texto enriquecido, y HTML sin filtrar guardado en base y devuelto al navegador es una
// vía directa de inyección: bastaría con escribir una etiqueta de script en una descripción para
// que se ejecutara en la sesión de cualquiera que abra esa tarea.
//
// El criterio es lista blanca, no lista negra: se descarta todo salvo las etiquetas de formato
// permitidas, y de los atributos sólo sobrevive un color. Cualquier cosa no contemplada —scripts,
// iframes, enlaces, eventos onclick, estilos con url()— se elimina en lugar de intentar corregirla.
const RICH_TEXT_TAGS = new Set(["b", "strong", "i", "em", "u", "s", "br", "p", "ul", "ol", "li", "span"]);
const sanitizeRichText = (value) => {
  const raw = String(value || "");
  if (!raw) return "";
  // Se quitan primero los bloques cuyo contenido también es peligroso, no sólo su etiqueta.
  let html = raw.replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "");
  html = html.replace(/<[^>]*>/g, (tag) => {
    const match = /^<\s*(\/?)\s*([a-zA-Z0-9]+)([\s\S]*)>$/.exec(tag);
    if (!match) return "";
    const [, closing, nameRaw, attrs] = match;
    const name = nameRaw.toLowerCase();
    if (!RICH_TEXT_TAGS.has(name)) return "";
    if (closing) return `</${name}>`;
    // Único atributo admitido: un color en formato hexadecimal o nombre simple. Se descarta todo lo
    // demás, incluidos los manejadores de eventos y cualquier estilo que no sea exactamente color.
    const color = /(?:^|[\s;"'])color\s*:\s*(#[0-9a-fA-F]{3,6}|[a-zA-Z]{3,20})/.exec(attrs);
    if (name === "span" && color) return `<span style="color:${color[1]}">`;
    return `<${name}>`;
  });
  return html.slice(0, 20000);
};
const VALID_ROLES = new Set(["admin", "gerente", "tecnico", "tecnico_oficina", "monitor_oficina", "cliente"]);
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
  const organizationId = tenantContext.getStore()?.organizationId;
  if (!organizationId) throw new Error("No se puede crear una notificación sin organización activa");
  const id = crypto.randomUUID();
  try { await pool.query("INSERT INTO notifications(id,user_id,text,link,organization_id) VALUES($1,$2,$3,$4,$5)", [id, userId, text, link || null, organizationId]); }
  catch (error) { console.error("No se pudo crear la notificación:", error.message); }
  // El aviso al teléfono es un extra: si falla, la notificación dentro de la aplicación ya quedó.
  await sendPush(userId, text, link).catch((error) => console.error("No se pudo enviar el push:", error.message));
}


// Envío push a los dispositivos suscritos. La librería web-push se carga a demanda: si no está
// instalada, o si faltan las claves VAPID, todo el bloque queda inerte y la notificación sigue
// viviendo dentro de la aplicación como hasta ahora. Nunca debe romper la operación que la disparó.
let webPushModule = null;
let webPushReady = null;
async function getWebPush() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return null;
  if (webPushModule) return webPushModule;
  if (!webPushReady) {
    webPushReady = import("web-push").then((mod) => {
      const wp = mod.default || mod;
      // El "subject" es el contacto que el servicio de push usa si hay un problema con los envíos.
      wp.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:soporte@miordengo.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
      webPushModule = wp;
      return wp;
    }).catch((error) => {
      console.warn("web-push no está instalado; las notificaciones al teléfono quedan desactivadas:", error.message);
      return null;
    });
  }
  return webPushReady;
}

async function sendPush(userId, text, link) {
  const wp = await getWebPush();
  if (!wp) return;
  let rows = [];
  try { ({ rows } = await pool.query("SELECT endpoint, data FROM push_subscriptions WHERE user_id=$1", [userId])); }
  catch (error) { console.error("No se pudieron leer las suscripciones push:", error.message); return; }
  const payload = JSON.stringify({ title: "MiOrdenGo", body: text, url: "/" });
  await Promise.all(rows.map(async (row) => {
    try {
      await wp.sendNotification(row.data, payload);
    } catch (error) {
      // 404/410 = el navegador dio de baja la suscripción. Se borra: reintentarla no sirve y deja
      // basura acumulándose por cada teléfono reinstalado.
      if (error.statusCode === 404 || error.statusCode === 410) {
        await pool.query("DELETE FROM push_subscriptions WHERE endpoint=$1", [row.endpoint]).catch(() => {});
      } else {
        console.error("Falló el envío push:", error.statusCode || error.message);
      }
    }
  }));
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
      `Se te asignó una tarea en MiOrdenGo:`,
      "",
      `Proyecto: ${projectLabel}`,
      `Tarea: ${task.id} — ${task.title}`,
      task.desc ? `Descripción: ${task.desc}` : null,
      task.due ? `Vencimiento: ${task.due}` : null,
      task.priority ? `Prioridad: ${task.priority}` : null,
      "",
      "Ingresá a MiOrdenGo para ver el detalle completo.",
    ].filter((line) => line !== null).join("\n");
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: `MiOrdenGo · Nueva tarea asignada: ${task.title}`,
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
      `Se te asignó el proyecto "${project.name}" en MiOrdenGo, con ${taskCount} tarea(s).`,
      "",
      "Ingresá a MiOrdenGo para ver el detalle completo.",
    ].join("\n");
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: `MiOrdenGo · Nuevo proyecto asignado: ${project.name}`,
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
function clientForRole(client, role) {
  if (["admin", "gerente"].includes(role)) return client;
  if (isMonitor(role)) return null;
  // El técnico necesita identificar empresa y planta, pero no la ficha administrativa completa.
  const safeSites = Array.isArray(client?.sites) ? client.sites.map((site) => ({ id: site.id || "", code: site.code || "", name: site.name || "", address: site.address || "" })) : [];
  return { id: client.id, code: client.code || "", name: client.name || "", site: client.site || "", sites: safeSites };
}
// `trustClientPrices` en false ignora por completo los importes que llegan del cliente para los
// materiales que no están en el catálogo. Es el modo que se usa con los técnicos: no ven precios
// (stripMoney se los quita) y no deben fijarlos, pero antes un material con un nombre que no
// existiera en el catálogo pasaba su price/cost del payload directo a la facturación del cliente.
// Quedan en cero y los valoriza gerencia, que es quien tiene la información y el permiso.
async function materialsFromInventory(materials, onlyMissing = false, trustClientPrices = true) {
  if (!Array.isArray(materials) || materials.length === 0) return [];
  const inventory = (await pool.query("SELECT data FROM parts")).rows.map((row) => row.data);
  return materials.map((material) => {
    const normalizedName = String(material.name || "").trim().toLowerCase();
    const part = inventory.find((item) => (material.partId && item.id === material.partId) || String(item.name || "").trim().toLowerCase() === normalizedName);
    if (!part) return { ...material, price: trustClientPrices ? wholeMoneyValue(material.price) : 0, cost: trustClientPrices ? wholeMoneyValue(material.cost) : 0 };
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
  const quantity = Number(delta);
  if (!partId || !Number.isFinite(quantity) || quantity === 0) return null;
  const organizationId = meta.organizationId || tenantContext.getStore()?.organizationId;
  if (!organizationId) throw new Error("No se puede ajustar inventario sin organización activa");
  // La suma se ejecuta dentro del UPDATE, no como read-modify-write en JavaScript. Así dos
  // recepciones/consumos simultáneos no pisan el saldo calculado por la otra operación.
  const row = (await db.query(
    `UPDATE parts
     SET data=jsonb_set(data,'{stock}',to_jsonb(COALESCE((data->>'stock')::numeric,0)+$2::numeric),true), updated_at=now()
     WHERE id=$1
       AND organization_id=$3
       AND ($2::numeric > 0 OR COALESCE((data->>'stock')::numeric,0)+$2::numeric >= 0)
     RETURNING data`,
    [partId, quantity, organizationId],
  )).rows[0];
  if (!row) {
    const exists = (await db.query("SELECT data->>'stock' AS stock FROM parts WHERE id=$1 AND organization_id=$2", [partId, organizationId])).rows[0];
    const error = new Error(exists ? `Stock insuficiente para ${partId}. Disponible: ${Number(exists.stock) || 0}.` : `El repuesto ${partId} no existe.`);
    error.code = exists ? "INSUFFICIENT_STOCK" : "PART_NOT_FOUND";
    throw error;
  }
  await db.query(
    "INSERT INTO stock_movements(id,part_id,quantity,balance,movement_type,source_type,source_id,note,user_id,organization_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [crypto.randomUUID(), partId, quantity, Number(row.data.stock) || 0, meta.movementType || (quantity > 0 ? "Entrada" : "Salida"), meta.sourceType || "Ajuste", meta.sourceId || "", String(meta.note || "").slice(0, 300), meta.userId || null, organizationId],
  );
  return row.data;
}

async function auditChange({ entityType, entityId, action, user, beforeData = null, afterData = null, reason = "" }, db = pool) {
  const organizationId = user?.organizationId || tenantContext.getStore()?.organizationId;
  if (!organizationId) throw new Error("No se puede auditar una operación sin organización activa");
  await db.query(
    "INSERT INTO audit_log(id,entity_type,entity_id,action,user_id,user_name,before_data,after_data,reason,request_id,ip_address,organization_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [crypto.randomUUID(), entityType, entityId, action, user?.id || null, user?.name || "Sistema", beforeData, afterData, String(reason || "").slice(0, 500), user?.requestId || null, user?.ip || null, organizationId],
  );
}
const DATA_URL_PATTERN = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i;
const ALLOWED_ASSET_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const assetSignatureMatches = (content, mime) => {
  if (mime === "image/jpeg") return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  if (mime === "image/png") return content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/webp") return content.length >= 12 && content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP";
  if (mime === "application/pdf") return content.length >= 5 && content.subarray(0, 5).toString("ascii") === "%PDF-";
  return false;
};
async function storeDataAsset(value, { entityType, entityId, fieldName, originalName = "", userId = null }, db = pool) {
  if (typeof value !== "string" || !value.startsWith("data:")) return value;
  const match = value.match(DATA_URL_PATTERN);
  if (!match || !ALLOWED_ASSET_MIME.has(match[1].toLowerCase())) throw Object.assign(new Error("El archivo adjunto no tiene un formato permitido."), { code: "INVALID_ASSET" });
  const content = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!content.length || content.length > 12 * 1024 * 1024) throw Object.assign(new Error("Cada archivo debe pesar entre 1 byte y 12 MB."), { code: "INVALID_ASSET" });
  const mime = match[1].toLowerCase();
  if (!assetSignatureMatches(content, mime)) throw Object.assign(new Error("El contenido del archivo no coincide con su formato declarado."), { code: "INVALID_ASSET" });
  const id = crypto.randomUUID();
  const organizationId = tenantContext.getStore()?.organizationId;
  if (!organizationId) throw new Error("No se puede guardar un archivo sin organización activa");
  await db.query("INSERT INTO file_assets(id,entity_type,entity_id,field_name,original_name,mime_type,size_bytes,sha256,content,created_by,organization_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [id, entityType, entityId, fieldName, String(originalName || "").slice(0, 180), mime, content.length, crypto.createHash("sha256").update(content).digest("hex"), content, userId, organizationId]);
  return `/api/files/${id}`;
}
async function externalizeOrderAssets(order, db, userId) {
  const next = { ...order };
  next.signatureUrl = await storeDataAsset(next.signatureUrl, { entityType: "order", entityId: next.id, fieldName: "client_signature", originalName: "firma-cliente.png", userId }, db);
  next.technicianSignatureUrl = await storeDataAsset(next.technicianSignatureUrl, { entityType: "order", entityId: next.id, fieldName: "technician_signature", originalName: "firma-tecnico.png", userId }, db);
  next.photos = [];
  for (const [index, photo] of (order.photos || []).entries()) {
    const url = await storeDataAsset(photo?.url, { entityType: "order", entityId: next.id, fieldName: `photo_${index}`, originalName: photo?.name || `evidencia-${index + 1}`, userId }, db);
    const preview = photo?.preview?.startsWith?.("data:") ? url : (photo?.preview || url);
    next.photos.push({ ...photo, url, preview });
  }
  return next;
}
async function externalizeFinancialAssets(movement, db, userId) {
  const next = { ...movement, attachments: [] };
  for (const [index, attachment] of (movement.attachments || []).entries()) {
    const url = await storeDataAsset(attachment?.url, { entityType: "financial", entityId: movement.id, fieldName: `attachment_${index}`, originalName: attachment?.name || `comprobante-${index + 1}`, userId }, db);
    next.attachments.push({ ...attachment, url });
  }
  next.attachmentUrl = next.attachments[0]?.url || "";
  next.attachmentName = next.attachments[0]?.name || "";
  return next;
}
async function migrateLegacyDataAssets() {
  if ((await pool.query("SELECT 1 FROM app_settings WHERE key='file_assets_migration_v1'")).rowCount) return;
  const orderRows = (await pool.query("SELECT id,data,organization_id FROM orders WHERE data::text LIKE '%data:%'")).rows;
  for (const row of orderRows) {
    await tenantContext.run({ organizationId: row.organization_id }, async () => {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const migrated = await externalizeOrderAssets({ ...row.data, id: row.id }, db, null);
        await db.query("UPDATE orders SET data=$2,updated_at=updated_at WHERE id=$1 AND organization_id=$3", [row.id, migrated, row.organization_id]);
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally { db.release(); }
    });
  }
  const financeRows = (await pool.query("SELECT id,data,organization_id FROM financial_movements WHERE data::text LIKE '%data:%'")).rows;
  for (const row of financeRows) {
    await tenantContext.run({ organizationId: row.organization_id }, async () => {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const legacyAttachments = Array.isArray(row.data.attachments) && row.data.attachments.length
          ? row.data.attachments
          : (row.data.attachmentUrl ? [{ name: row.data.attachmentName || "comprobante", url: row.data.attachmentUrl }] : []);
        const migrated = await externalizeFinancialAssets({ ...row.data, id: row.id, attachments: legacyAttachments }, db, null);
        await db.query("UPDATE financial_movements SET data=$2,updated_at=updated_at WHERE id=$1 AND organization_id=$3", [row.id, migrated, row.organization_id]);
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally { db.release(); }
    });
  }
  await pool.query("INSERT INTO app_settings(key,value) VALUES('file_assets_migration_v1',$1) ON CONFLICT(organization_id,key) DO NOTHING", [{ migratedAt: new Date().toISOString(), orders: orderRows.length, finances: financeRows.length }]);
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
    // Esta consulta ocurre antes de activar RLS; además valida que el tenant del JWT siga siendo
    // el mismo que el vigente en la cuenta.
    const current = (await pool.query("SELECT id,name,role,active,mustchangepassword,token_version,organization_id FROM users WHERE id=$1", [claims.id])).rows[0];
    if (!current?.active) return res.status(401).json({ error: "La cuenta está inactiva o ya no existe" });
    if (claims.organizationId && claims.organizationId !== current.organization_id) return res.status(401).json({ error: "La organización de la sesión ya no es válida" });
    // Si el token trae un token_version anterior al vigente en la base, ya fue revocado (cambio
    // de contraseña propio o forzado por un admin) — se rechaza aunque todavía no haya expirado.
    if ((claims.tokenVersion || 0) !== (current.token_version || 0)) return res.status(401).json({ error: "La sesión ya no es válida. Iniciá sesión de nuevo." });
    if (current.mustchangepassword && !["/api/bootstrap", "/api/me/password"].includes(req.path)) return res.status(403).json({ error: "Debes cambiar la contraseña temporal antes de continuar" });
    const featureByPrefix = [["/api/budgets", "budgets"], ["/api/finances", "finances"], ["/api/finance-", "finances"], ["/api/orders", "orders"], ["/api/projects", "projects"], ["/api/tasks", "projects"], ["/api/gantt", "projects"], ["/api/clients", "clients"], ["/api/purchase-orders", "purchaseOrders"], ["/api/suppliers", "purchaseOrders"], ["/api/material-lists", "materialLists"], ["/api/delivery-notes", "materialLists"], ["/api/parts", "inventory"], ["/api/stock", "inventory"], ["/api/whiteboard", "whiteboard"], ["/api/users", "team"], ["/api/audit-log", "team"]];
    const requiredFeature = featureByPrefix.find(([prefix]) => req.path.startsWith(prefix))?.[1];
    if (requiredFeature) {
      const profile = await loadCompanyProfile(current.organization_id);
      if (profile.features?.[requiredFeature] === false) return res.status(403).json({ error: "Este módulo no está habilitado para la empresa" });
    }
    req.user = { id: current.id, name: current.name, role: current.role, organizationId: current.organization_id, mustChangePassword: current.mustchangepassword, requestId: String(req.requestId || crypto.randomUUID()).slice(0, 100), ip: String(req.ip || req.socket.remoteAddress || "").slice(0, 100) };
    tenantContext.run({ organizationId: current.organization_id }, next);
  } catch { res.status(401).json({ error: "Token inválido" }); }
}
const requireRole = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: "No autorizado" });
registerGanttRoutes(app, pool, { auth, requireRole, tecCanProject });
// Roles "técnicos" (campo u oficina): nunca ven importes ni el estado "Facturada"
const isTec = (r) => r === "tecnico" || r === "tecnico_oficina";
const isMonitor = (r) => r === "monitor_oficina";
// Cliente corporativo: personal de una empresa contratante. Vive dentro de la organización del
// proveedor —no tiene organización propia— así que su aislamiento no lo da RLS sino allowedUsers,
// igual que un técnico. La diferencia es que además NO puede ver dinero interno: costos, márgenes
// ni precios de compra. Ese filtro se aplica al serializar, no en la interfaz.
const isClient = (r) => r === "cliente";
const isProjectScoped = (r) => isTec(r) || isMonitor(r) || isClient(r);
const requireOrdersAccess = (req, res, next) => (req.user.role === "tecnico_oficina" || isMonitor(req.user.role)) ? res.status(403).json({ error: "Este perfil no tiene acceso a órdenes de trabajo" }) : next();
// Monitores y clientes corporativos son perfiles de sólo lectura: ninguno puede crear ni modificar.
const requireProjectWrite = (req, res, next) => (isMonitor(req.user.role) || isClient(req.user.role)) ? res.status(403).json({ error: "Monitor Oficina tiene acceso de solo visualización" }) : next();
const orderAssignedIds = orderAssignedIdsValue;
const orderVisibleToUser = orderVisibleToUserValue;
async function hydrateOrderAssignments(order, db = pool) {
  const names = [...new Set([order.tech, ...(Array.isArray(order.assignedTechs) ? order.assignedTechs : [])].map((name) => String(name || "").trim()).filter(Boolean))];
  const requestedIds = [...new Set([order.techId, ...(Array.isArray(order.assignedTechIds) ? order.assignedTechIds : [])].filter(Boolean))];
  const users = (await db.query("SELECT id,name,active,role FROM users WHERE active=true")).rows;
  const allowed = new Map(users.filter((user) => user.role === "tecnico").map((user) => [user.id, user]));
  const ids = requestedIds.filter((id) => allowed.has(id));
  for (const name of names) {
    const matches = users.filter((user) => user.role === "tecnico" && String(user.name).trim().toLowerCase() === name.toLowerCase());
    if (matches.length === 1) ids.push(matches[0].id);
  }
  order.assignedTechIds = [...new Set(ids)].slice(0, 8);
  if (order.techId && !allowed.has(order.techId)) order.techId = "";
  if (!order.techId && order.tech) {
    const match = users.filter((user) => user.role === "tecnico" && String(user.name).trim().toLowerCase() === String(order.tech).trim().toLowerCase());
    if (match.length === 1) order.techId = match[0].id;
  }
  if (order.techId && !order.assignedTechIds.includes(order.techId)) order.assignedTechIds.unshift(order.techId);
  return order;
}
app.get("/api/files/:id", auth, async (req, res) => {
  const asset = (await pool.query("SELECT * FROM file_assets WHERE id=$1 AND organization_id=$2", [req.params.id, req.user.organizationId])).rows[0];
  if (!asset) return res.status(404).json({ error: "El archivo no existe" });
  let allowed = ["admin", "gerente"].includes(req.user.role);
  if (!allowed && asset.entity_type === "order" && req.user.role === "tecnico") {
    const order = (await pool.query("SELECT data FROM orders WHERE id=$1", [asset.entity_id])).rows[0]?.data;
    allowed = Boolean(order && orderVisibleToUser(req.user, order));
  }
  if (!allowed) return res.status(403).json({ error: "No autorizado para ver este archivo" });
  const safeName = String(asset.original_name || "archivo").replace(/[^a-z0-9._-]+/gi, "-").slice(0, 120) || "archivo";
  res.setHeader("Content-Type", asset.mime_type);
  res.setHeader("Content-Length", asset.content.length);
  res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(asset.content);
});
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
async function upsertOrderCostExpense(order, db = pool) {
  const id = `EXP-ORDER-${order.id}`;
  const currentMovement = (await db.query("SELECT data FROM financial_movements WHERE id=$1", [id])).rows[0]?.data;
  if (currentMovement?.date) await assertFinancePeriodOpen(currentMovement.date, db);
  if (!order.projectId || !["Aprobada", "Facturada"].includes(order.status)) {
    await db.query("DELETE FROM financial_movements WHERE id=$1 AND data->>'sourceOrderId' IS NOT NULL", [id]);
    return null;
  }
  const actualHours = (Number(order.laborHours) || 0) + (Math.max(0, Number(order.technical?.billableWaitMinutes) || 0) / 60);
  const laborCost = actualHours * (Number(order.technicians) || 1) * (Number(order.laborCost) || 0);
  const materialsCost = (order.materials || []).reduce((sum, m) => sum + (Number(m.qty) || 0) * (Number(m.cost) || 0), 0);
  const totalCost = Math.round((laborCost + materialsCost) * 100) / 100;
  if (totalCost <= 0) {
    await db.query("DELETE FROM financial_movements WHERE id=$1 AND data->>'sourceOrderId' IS NOT NULL", [id]);
    return null;
  }
  const project = (await db.query("SELECT data FROM projects WHERE id=$1", [order.projectId])).rows[0]?.data;
  const existing = (await db.query("SELECT data FROM financial_movements WHERE id=$1", [id])).rows[0]?.data;
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
  await assertFinancePeriodOpen(movement.date, db);
  await db.query("INSERT INTO financial_movements(id,data,organization_id) VALUES($1,$2,current_setting('app.organization_id')) ON CONFLICT(organization_id,id) DO UPDATE SET data=$2, updated_at=now()", [id, movement]);
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
// El login es siempre MiOrdenGo. La identidad corporativa sólo se entrega dentro de /api/bootstrap,
// después de autenticar al usuario y aplicar el RLS de su organización. Así no se puede consultar
// la ficha de otra empresa cambiando un slug o un parámetro de la URL.
app.get("/api/branding", (_req, res) => res.json(DEFAULT_BRANDING));

// Verificación pública de credenciales: es lo que abre el QR impreso en la tarjeta, para que en
// portería se pueda comprobar que la persona sigue activa en la empresa.
//
// Está deliberadamente acotada, porque es la única ruta sin autenticar que toca datos de personas:
//  · El identificador es un token opaco y aleatorio por empleado, no el id de usuario. Sin esto,
//    quien tuviera una credencial podría recorrer ids y enumerar la nómina entera.
//  · Devuelve sólo lo que ya está impreso en la tarjeta: nombre, cargo, foto y si está vigente.
//    Documento, teléfono, correo, contacto de emergencia y grupo sanguíneo NO salen por acá.
//  · Sin tenant en contexto la consulta corre con el rol de despliegue, así que se filtra por token
//    exacto y se limita a una fila.
//  · Va con límite de peticiones: un token filtrado no debe habilitar sondeo masivo.
app.get("/api/credential/:token", async (req, res) => {
  const token = String(req.params.token || "");
  if (!/^[0-9a-f-]{36}$/i.test(token)) return res.status(404).json({ error: "Credencial no encontrada" });
  if (!(await consumeRateLimit(`credential:${req.ip}`, 60 * 1000, 20))) return res.status(429).json({ error: "Demasiadas consultas. Esperá un momento." });
  const row = (await pool.query(
    `SELECT u.name, u.email, u.role, u.active, u.settings, o.name AS organization_name
       FROM users u JOIN organizations o ON o.id = u.organization_id
      WHERE u.settings->>'credentialToken' = $1 LIMIT 1`, [token])).rows[0];
  if (!row) return res.status(404).json({ error: "Credencial no encontrada" });
  res.json({
    name: row.name,
    position: row.settings?.position || "",
    photoDataUrl: row.settings?.photoDataUrl || "",
    active: row.active === true,
    organizationName: row.organization_name || "",
    // Datos de emergencia: se exponen a propósito. Quien escanea la credencial de alguien accidentado
    // necesita el grupo sanguíneo y a quién avisar, y ese es el caso de uso que justifica el QR.
    // Documento y teléfono personal se incluyen por pedido expreso: quedan legibles para cualquiera
    // que escanee la credencial. Es una decisión de negocio, no un descuido — ver la advertencia
    // dada al implementarlo. Si se revierte, basta con sacarlos de esta respuesta: no hay que
    // reimprimir credenciales porque el QR sólo lleva la URL, no los datos.
    documentId: row.settings?.documentId || "",
    phone: row.settings?.phone || "",
    // Correo laboral: se expone por pedido expreso, para que el contacto guardado desde el QR quede
    // completo. Queda legible para cualquiera que escanee la credencial, igual que el resto.
    email: row.email || "",
    bloodType: row.settings?.bloodType || "",
    emergencyContact: row.settings?.emergencyContact || "",
    emergencyPhone: row.settings?.emergencyPhone || "",
    checkedAt: new Date().toISOString(),
  });
});
app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "ordengo", at: new Date().toISOString() }));
app.get("/api/ready", async (_req, res) => { try { await pool.query("SELECT 1"); res.json({ status: "ready" }); } catch { res.status(503).json({ status: "unavailable" }); } });

app.post("/api/auth/login", loginRateLimit, async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [String(email || "").toLowerCase()]);
  const u = rows[0];
  if (!u || !u.active || !bcrypt.compareSync(password || "", u.password_hash))
    return res.status(401).json({ error: "Correo o contraseña inválidos" });
  await pool.query("DELETE FROM rate_limits WHERE key=$1", [`login:${req.loginAttemptKey}`]);
  const token = jwt.sign({ id: u.id, role: u.role, name: u.name, organizationId: u.organization_id, tokenVersion: u.token_version || 0 }, JWT_SECRET, { expiresIn: "7d" });
  res.setHeader("Set-Cookie", `og_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${IS_PRODUCTION ? "; Secure" : ""}`);
  res.json({ authenticated: true, user: pubUser(u) });
});
app.post("/api/auth/logout", (_req, res) => { res.setHeader("Set-Cookie", `og_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${IS_PRODUCTION ? "; Secure" : ""}`); res.status(204).end(); });

/* Cada usuario cambia su propia contraseña */
// Ficha personal propia. Va por una ruta aparte y no abriendo PATCH /api/users/:id a cualquiera:
// esa ruta también cambia rol, estado y contraseña, y habilitarla para que alguien suba su foto
// sería entregar mucho más que lo necesario. Acá el id sale del token, así que nadie puede editar
// la ficha de otro ni pasando un id en el cuerpo.
app.patch("/api/me/profile", auth, async (req, res) => {
  if (req.body?.photoDataUrl && String(req.body.photoDataUrl).length > PROFILE_PHOTO_MAX_CHARS) return res.status(400).json({ error: "La foto de perfil es demasiado grande. Usá una imagen más liviana." });
  const target = (await pool.query("SELECT settings FROM users WHERE id=$1", [req.user.id])).rows[0];
  if (!target) return res.status(404).json({ error: "El usuario ya no existe" });
  // Se filtra el cuerpo a los campos de ficha antes de sanear: buildSettingsPatch también entiende
  // la configuración de pantalla TV, que es potestad de administración y no tiene por qué viajar
  // por acá. Sin este filtro, cualquiera podría escribir esos campos en su propio registro.
  const profileBody = {};
  for (const field of PROFILE_SELF_FIELDS) if (req.body?.[field] !== undefined) profileBody[field] = req.body[field];
  const merged = buildSettingsPatch(profileBody, target.settings || {});
  if (!merged) return res.status(400).json({ error: "Nada que actualizar" });
  // Sólo settings: nombre, rol y estado siguen siendo potestad de administración. Que alguien pueda
  // cambiar su propia foto no significa que pueda renombrarse ni reasignarse el rol.
  const updated = (await pool.query("UPDATE users SET settings=$2 WHERE id=$1 RETURNING *", [req.user.id, merged])).rows[0];
  res.json(pubUser(updated));
});
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
  const token = jwt.sign({ id: u.id, role: u.role, name: u.name, organizationId: u.organization_id, tokenVersion }, JWT_SECRET, { expiresIn: "7d" });
  res.setHeader("Set-Cookie", `og_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${IS_PRODUCTION ? "; Secure" : ""}`);
  res.json({ ok: true, authenticated: true });
});

/* ------------------------------------------------ Bootstrap (carga inicial) ------------------------------------------------ */
app.get("/api/bootstrap", auth, apiRateLimit(30), async (req, res) => {
  const tec = isTec(req.user.role);
  // Un cliente corporativo ve el avance de sus proyectos, nada del negocio del proveedor. Se lo
  // excluye acá, al armar la respuesta, y no ocultando cosas en la interfaz: lo que no viaja no se
  // puede filtrar desde el navegador ni leer llamando la API a mano.
  const client = isClient(req.user.role);
  const organizationId = req.user.organizationId;
  const [me, u, cl, pr, bu, fi, or, ta, no, pa, branding, companyProfile, sup, po, ml, dn, wb] = await Promise.all([
    pool.query("SELECT * FROM users WHERE id=$1 AND organization_id=$2", [req.user.id, organizationId]),
    pool.query("SELECT * FROM users WHERE organization_id=$1 ORDER BY created_at", [organizationId]),
    pool.query("SELECT data FROM clients WHERE organization_id=$1", [organizationId]),
    pool.query("SELECT data FROM projects WHERE organization_id=$1", [organizationId]),
    pool.query("SELECT data, updated_at FROM budgets WHERE organization_id=$1 ORDER BY updated_at DESC", [organizationId]),
    pool.query("SELECT data, updated_at FROM financial_movements WHERE organization_id=$1 ORDER BY updated_at DESC", [organizationId]),
    pool.query("SELECT data, updated_at FROM orders WHERE organization_id=$1 ORDER BY updated_at DESC", [organizationId]),
    pool.query("SELECT data, updated_at FROM tasks WHERE organization_id=$1 ORDER BY updated_at DESC", [organizationId]),
    pool.query("SELECT * FROM notifications WHERE user_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 50", [req.user.id, organizationId]),
    pool.query("SELECT data FROM parts WHERE organization_id=$1 ORDER BY data->>'name'", [organizationId]),
    loadBranding(organizationId),
    loadCompanyProfile(organizationId),
    pool.query("SELECT data FROM suppliers WHERE organization_id=$1 ORDER BY data->>'name'", [organizationId]),
    pool.query("SELECT data, updated_at FROM purchase_orders WHERE organization_id=$1 ORDER BY updated_at DESC", [organizationId]),
    pool.query("SELECT data, updated_at FROM material_lists WHERE organization_id=$1 ORDER BY updated_at DESC", [organizationId]),
    pool.query("SELECT data, updated_at FROM delivery_notes WHERE organization_id=$1 ORDER BY updated_at DESC", [organizationId]),
    pool.query("SELECT data, updated_at FROM whiteboard_notes WHERE organization_id=$1 ORDER BY updated_at DESC", [organizationId]),
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
        "INSERT INTO notifications(id,user_id,text,link,organization_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT (organization_id,id) DO NOTHING",
        [`due-${t.id}`, req.user.id, `La tarea ${t.id}: ${t.title} vence pronto (${t.due}).`, "task:" + t.id, organizationId],
      );
    } catch {}
  }
  const notifRows = dueSoonTasks.length
    ? (await pool.query("SELECT * FROM notifications WHERE user_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 50", [req.user.id, organizationId])).rows
    : no.rows;
  const partOut = (p) => tec ? { id: p.id, name: p.name, unit: p.unit } : p;
  const allProjects = pr.rows.map((r) => r.data);
  // Técnicos y monitores solo ven los proyectos que el administrador les habilitó.
  const scoped = isProjectScoped(req.user.role);
  const canSeeProject = (p) => !scoped || (Array.isArray(p.allowedUsers) && p.allowedUsers.includes(req.user.id));
  const visibleProjects = allProjects.filter(canSeeProject);
  const allowedProjectIds = new Set(visibleProjects.map((p) => p.id));
  const visibleOrderRows = or.rows.filter((row) => !row.data.archivedAt && orderVisibleToUser(req.user, row.data));
  // Tareas con un comentario que alguien todavía no leyó. Se calcula sobre las notificaciones, que
  // ya registran el estado de lectura por persona: mientras quede una sin leer, el aviso sigue
  // visible para todos; cuando el último la abre, desaparece solo. Es a nivel equipo y no personal
  // a propósito: lo pedido es que el aviso dure hasta que todos lo hayan visto.
  const pendingCommentTaskIds = new Set(
    (await pool.query("SELECT DISTINCT link FROM notifications WHERE read=false AND link LIKE 'task:%'")).rows
      .map((row) => String(row.link).slice(5)));
  const operationalClientIds = new Set(visibleProjects.map((project) => project.clientId).filter(Boolean));
  const operationalClientNames = new Set(visibleProjects.map((project) => String(project.client || "").trim().toLowerCase()).filter(Boolean));
  for (const row of visibleOrderRows) {
    if (row.data.clientId) operationalClientIds.add(row.data.clientId);
    if (row.data.client) operationalClientNames.add(String(row.data.client).trim().toLowerCase());
  }
  const visibleClients = cl.rows
    .map((row) => row.data)
    // El cliente corporativo no ve la cartera del proveedor: sin esto recibía el listado completo
    // de clientes de la empresa, que es información comercial sensible y ajena.
    .filter(() => !client)
    // El técnico de campo ve la nómina completa: es quien da de alta las órdenes y necesita poder
    // elegir cualquier cliente, incluido uno al que todavía no fue. Antes sólo veía aquellos donde
    // ya tenía trabajo previo, así que la primera visita a un cliente nuevo era imposible de cargar.
    // No implica exponer información comercial: clientForRole ya recorta la ficha a nombre, código
    // y plantas, sin CUIT, condiciones de pago ni contactos administrativos.
    // El técnico de oficina sigue acotado, porque trabaja por proyecto y no crea órdenes.
    .filter((client) => req.user.role !== "tecnico_oficina" || operationalClientIds.has(client.id) || operationalClientNames.has(String(client.name || "").trim().toLowerCase()))
    .map((client) => clientForRole(client, req.user.role)).filter(Boolean);
  // Órdenes para el cliente corporativo: sólo las de su empresa y, si tiene planta asignada, sólo
  // las de esa planta. La serialización deja fuera todo el dinero y el costo interno —precios,
  // materiales, horas facturables, márgenes—: es el mismo criterio que la audiencia "cliente" de
  // los reportes. Recortar acá y no en la interfaz es lo que impide leerlo llamando la API a mano.
  const clientScopeId = String(me.rows[0]?.settings?.clientId || "");
  const clientScopeSite = String(me.rows[0]?.settings?.clientSite || "").trim().toLowerCase();
  const clientOrders = !client || !clientScopeId ? [] : visibleOrderRows
    .map((r) => r.data)
    .filter((o) => (o.clientId === clientScopeId || String(o.client || "").trim() === clientScopeId)
      && (!clientScopeSite || String(o.site || "").trim().toLowerCase() === clientScopeSite))
    .map((o) => ({
      id: o.id, date: o.date, status: o.status, service: o.service, equipment: o.equipment,
      client: o.client, site: o.site, tech: o.tech, assignedTechs: o.assignedTechs || [],
      technical: { solicitud: o.technical?.solicitud || "", trabajo: o.technical?.trabajo || "", resultado: o.technical?.resultado || "",
        arrivalAt: o.technical?.arrivalAt || "", completedAt: o.technical?.completedAt || "" },
      photos: o.photos || [], signatureUrl: o.signatureUrl || "", signedBy: o.signedBy || "",
    }));
  res.json({
    me: pubUser(me.rows[0]),
    users: u.rows.map((user) => directoryUser(user, req.user.role)),
    clients: visibleClients,
    projects: companyProfile.features.projects === false ? [] : visibleProjects,
    budgets: tec || client || isMonitor(req.user.role) || companyProfile.features.budgets === false ? [] : bu.rows.map((r) => ({ ...normalizeBudget(r.data), _updatedAt: r.updated_at })),
    finances: tec || client || isMonitor(req.user.role) || companyProfile.features.finances === false ? [] : fi.rows.map((r) => {
      // Los adjuntos no viajan en el listado (son data: URIs pesados): solo cuántos hay.
      const { attachmentUrl, attachments, ...summary } = r.data;
      const count = Array.isArray(attachments) ? attachments.length : (attachmentUrl ? 1 : 0);
      return { ...summary, hasAttachment: count > 0, attachmentCount: count, _updatedAt: r.updated_at };
    }),
    orders: client ? clientOrders : (req.user.role === "tecnico_oficina" || isMonitor(req.user.role) || companyProfile.features.orders === false) ? [] : visibleOrderRows.map((r) => ({ ...(tec ? stripMoney(r.data) : r.data), _updatedAt: r.updated_at })),
    tasks: companyProfile.features.projects === false ? [] : ta.rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at, _unreadComment: pendingCommentTaskIds.has(r.id) })).filter((t) => !scoped || allowedProjectIds.has(t.project)),
    notifications: notifRows.map((n) => ({ id: n.id, text: n.text, link: n.link, read: n.read, at: n.created_at })),
    parts: client ? [] : pa.rows.map((r) => partOut(r.data)),
    suppliers: tec || client || isMonitor(req.user.role) ? [] : sup.rows.map((r) => r.data),
    purchaseOrders: tec || client || isMonitor(req.user.role) || companyProfile.features.purchaseOrders === false ? [] : po.rows.filter((r) => !r.data.archivedAt).map((r) => ({ ...r.data, _updatedAt: r.updated_at })),
    deliveryNotes: (req.user.role === "tecnico_oficina" || client || isMonitor(req.user.role) || companyProfile.features.materialLists === false) ? [] : dn.rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })),
    materialLists: (req.user.role === "tecnico_oficina" || client || isMonitor(req.user.role) || companyProfile.features.materialLists === false) ? [] : ml.rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })),
    whiteboardNotes: companyProfile.features.whiteboard === false ? [] : wb.rows.filter((r) => whiteboardNoteVisible(req.user, r.data)).map((r) => ({ ...r.data, _updatedAt: r.updated_at })),
    branding,
    companyProfile,
  });
});

/* ------------------------------------------------ Configuración de marca (solo Admin) ------------------------------------------------ */
app.put("/api/settings/branding", auth, requireRole("admin"), async (req, res) => {
  const previousBranding = await loadBranding(req.user.organizationId);
  const input = req.body || {};
  const logo = String(input.logoDataUrl || "");
  if (logo && !/^data:image\/(png|jpeg|webp);base64,/i.test(logo)) return res.status(400).json({ error: "El logo debe ser una imagen PNG, JPG o WebP" });
  if (Buffer.byteLength(logo, "utf8") > 2 * 1024 * 1024) return res.status(400).json({ error: "El logo no puede superar 2 MB" });
  if (!validHexColor(input.primaryColor) || !validHexColor(input.headerColor)) return res.status(400).json({ error: "Los colores deben estar en formato hexadecimal" });
  const branding = normalizeBranding(input);
  await pool.query("INSERT INTO app_settings(key,value,updated_at) VALUES('branding_v1',$1,now()) ON CONFLICT(organization_id,key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()", [branding]);
  await auditChange({ entityType: "settings", entityId: "branding_v1", action: "update", user: req.user, beforeData: { appName: previousBranding.appName, theme: previousBranding.theme, primaryColor: previousBranding.primaryColor }, afterData: { appName: branding.appName, theme: branding.theme, primaryColor: branding.primaryColor } });
  res.json({ ...branding, builtInCompanyLogo: req.user.organizationId === DEFAULT_ORGANIZATION_ID ? "automatica" : "" });
});

app.get("/api/settings/company-profile", auth, requireRole("admin", "gerente"), async (req, res) => {
  res.json(await loadCompanyProfile(req.user.organizationId));
});
app.put("/api/settings/company-profile", auth, requireRole("admin"), async (req, res) => {
  const before = await loadCompanyProfile(req.user.organizationId);
  const profile = normalizeCompanyProfile(req.body || {});
  await pool.query("UPDATE organizations SET profile=$2,updated_at=now() WHERE id=$1", [req.user.organizationId, profile]);
  await auditChange({ entityType: "organization", entityId: req.user.organizationId, action: "update_profile", user: req.user, beforeData: before, afterData: profile });
  res.json(profile);
});

/* ------------------------------------------------ Notificaciones ------------------------------------------------ */

/* ------------------------------------------------ Notificaciones push ------------------------------------------------ */
// Cada navegador que acepta recibir avisos deja acá su suscripción. Se guarda por usuario y no por
// sesión: una misma persona puede tener el teléfono y la computadora, y ambos deben recibir.
// El endpoint es la URL única que el navegador entrega; sirve de clave natural para no duplicar.
app.post("/api/push/subscribe", auth, async (req, res) => {
  const subscription = req.body?.subscription;
  const endpoint = String(subscription?.endpoint || "");
  if (!/^https:\/\//.test(endpoint)) return res.status(400).json({ error: "Suscripción inválida" });
  const stored = {
    endpoint,
    keys: { p256dh: String(subscription?.keys?.p256dh || ""), auth: String(subscription?.keys?.auth || "") },
    userId: req.user.id,
    userAgent: String(req.get("user-agent") || "").slice(0, 200),
    createdAt: new Date().toISOString(),
  };
  if (!stored.keys.p256dh || !stored.keys.auth) return res.status(400).json({ error: "Suscripción incompleta" });
  await pool.query(
    `INSERT INTO push_subscriptions(endpoint,user_id,data,organization_id)
     VALUES($1,$2,$3,current_setting('app.organization_id'))
     ON CONFLICT(endpoint) DO UPDATE SET user_id=$2, data=$3, updated_at=now()`,
    // El conflicto se resuelve por endpoint solo: esa URL la genera el servicio de push del
    // navegador y es única en el mundo, así que no puede repetirse entre dos empresas.
    [endpoint, req.user.id, stored]);
  res.status(201).json({ ok: true });
});
// Baja explícita: el navegador avisa cuando el usuario revoca el permiso o cierra sesión.
app.post("/api/push/unsubscribe", auth, async (req, res) => {
  const endpoint = String(req.body?.endpoint || "");
  if (endpoint) await pool.query("DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2", [endpoint, req.user.id]);
  res.status(204).end();
});
// La clave pública VAPID identifica a esta aplicación ante el servicio de push del navegador. Es
// pública por diseño —viaja al cliente para suscribirse—; la privada nunca sale del servidor.
app.get("/api/push/key", auth, (_req, res) => res.json({ key: process.env.VAPID_PUBLIC_KEY || "" }));
app.get("/api/notifications", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM notifications WHERE user_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 50", [req.user.id, req.user.organizationId]);
  res.json(rows.map((n) => ({ id: n.id, text: n.text, link: n.link, read: n.read, at: n.created_at })));
});
app.post("/api/notifications/:id/read", auth, async (req, res) => {
  await pool.query("UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2 AND organization_id=$3", [req.params.id, req.user.id, req.user.organizationId]);
  res.status(204).end();
});
app.post("/api/notifications/read-all", auth, async (req, res) => {
  await pool.query("UPDATE notifications SET read=true WHERE user_id=$1 AND organization_id=$2", [req.user.id, req.user.organizationId]);
  res.status(204).end();
});

app.get("/api/parts/:id/movements", auth, requireRole("admin", "gerente"), async (req, res) => { const rows = (await pool.query("SELECT * FROM stock_movements WHERE part_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 200", [req.params.id, req.user.organizationId])).rows; res.json(rows.map((row) => ({ id: row.id, partId: row.part_id, quantity: Number(row.quantity), balance: Number(row.balance), type: row.movement_type, sourceType: row.source_type, sourceId: row.source_id, note: row.note, at: row.created_at }))); });
app.get("/api/audit-log", auth, requireRole("admin"), async (req, res) => { const rows = (await pool.query("SELECT * FROM audit_log WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 300", [req.user.organizationId])).rows; res.json(rows); });

/* ------------------------------------------------ Clientes ------------------------------------------------ */
// Contactos del cliente: personas responsables por sitio y por área. Sirven para vincular a alguien
// concreto en una orden o un remito, en lugar de escribir el nombre suelto cada vez y terminar con
// tres grafías distintas de la misma persona.
const normalizeClientContacts = (value) => (Array.isArray(value) ? value : []).slice(0, 60).map((contact) => ({
  id: String(contact?.id || "").trim().slice(0, 40) || `ct-${crypto.randomUUID()}`,
  name: String(contact?.name || "").trim().slice(0, 120),
  // El sitio se guarda por nombre y no por código: es lo que se imprime y lo que el usuario elige
  // en los desplegables, y los códigos de planta no siempre están cargados.
  site: String(contact?.site || "").trim().slice(0, 120),
  area: String(contact?.area || "").trim().slice(0, 80),
  role: String(contact?.role || "").trim().slice(0, 80),
  email: String(contact?.email || "").trim().slice(0, 120),
  phone: String(contact?.phone || "").trim().slice(0, 40),
})).filter((contact) => contact.name);
app.post("/api/clients", auth, requireProjectWrite, async (req, res) => {
  const c = { ...(req.body || {}) };
  c.name = String(c.name || "").trim();
  if (!c.name) return res.status(400).json({ error: "El nombre del cliente es obligatorio" });
  const existing = (await pool.query("SELECT data FROM clients")).rows.map((r) => r.data);
  // Evita duplicados por nombre (reutiliza el existente)
  const dup = existing.find((x) => (x.name || "").trim().toLowerCase() === (c.name || "").trim().toLowerCase());
  if (dup) return res.json(dup);
  c.contacts = normalizeClientContacts(c.contacts);
  if (!c.id) c.id = `c-${crypto.randomUUID()}`;
  if (c.code) {
    const taken = new Set(existing.map((x) => x.code).filter(Boolean));
    if (taken.has(c.code)) return res.status(400).json({ error: "Ese código de cliente ya existe" });
  } else {
    c.code = await uniqueClientCode(codeFromName(c.name));
  }
  try { await pool.query("INSERT INTO clients(id,data,organization_id) VALUES($1,$2,$3)", [c.id, c, req.user.organizationId]); await auditChange({ entityType: "client", entityId: c.id, action: "create", user: req.user, afterData: { code: c.code, name: c.name } }); }
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
  if (patch.contacts !== undefined) merged.contacts = normalizeClientContacts(patch.contacts);
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
  await auditChange({ entityType: "client", entityId: req.params.id, action: "update", user: req.user, beforeData: { code: rows[0].data.code, name: rows[0].data.name }, afterData: { code: merged.code, name: merged.name } });
  res.json(merged);
});
app.delete("/api/clients/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const client = (await pool.query("SELECT data FROM clients WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!client) return res.status(404).json({ error: "No existe" });
  const links = await Promise.all([
    pool.query("SELECT count(*)::int count FROM projects WHERE data->>'clientId'=$1", [req.params.id]),
    pool.query("SELECT count(*)::int count FROM budgets WHERE data->>'clientId'=$1", [req.params.id]),
    pool.query("SELECT count(*)::int count FROM financial_movements WHERE data->>'clientId'=$1", [req.params.id]),
    pool.query("SELECT count(*)::int count FROM orders WHERE data->>'clientId'=$1 OR data->>'client'=$2", [req.params.id, client.name || ""]),
    pool.query("SELECT count(*)::int count FROM material_lists WHERE data->>'clientId'=$1 OR data->>'client'=$2", [req.params.id, client.name || ""]),
  ]);
  const linked = links.reduce((sum, result) => sum + Number(result.rows[0]?.count || 0), 0);
  if (linked) return res.status(409).json({ error: `No se puede eliminar: el cliente tiene ${linked} registro(s) vinculado(s). Reasigna o elimina primero esos registros.` });
  await auditChange({ entityType: "client", entityId: req.params.id, action: "delete", user: req.user, beforeData: { code: client.code, name: client.name }, reason: String(req.body?.reason || "Eliminación solicitada desde la aplicación") });
  const deleted = await pool.query("DELETE FROM clients WHERE id=$1 RETURNING id", [req.params.id]);
  if (!deleted.rowCount) return res.status(404).json({ error: "No existe" });
  res.status(204).end();
});

/* ------------------------------------------------ Proyectos ------------------------------------------------ */
// Jerarquía de proyectos: un proyecto puede colgar de otro para armar "Proyecto General →
// subproyecto → tareas". La validación vive acá y no en el front porque un ciclo dejaría girando
// para siempre a todo lo que recorra el árbol (selector, acumulados, reportes). Devuelve
// {skip:true} cuando el patch no toca el vínculo, para no pisarlo sin querer.
async function resolveProjectParent(parentId, projectId) {
  if (parentId === undefined) return { skip: true };
  if (!parentId) return { value: null };
  const id = String(parentId);
  if (id === projectId) return { error: "Un proyecto no puede colgar de sí mismo" };
  // Se sube por la cadena de padres: si se vuelve a pasar por el propio proyecto, el vínculo
  // cerraría un ciclo. De paso confirma que cada eslabón exista y sea de esta empresa (lo segundo
  // lo garantiza RLS, que deja fuera del SELECT a los proyectos de otro tenant).
  const seen = new Set([projectId]);
  let cursor = id;
  while (cursor) {
    if (seen.has(cursor)) return { error: "La jerarquía no puede formar un ciclo" };
    seen.add(cursor);
    const row = (await pool.query("SELECT data->>'parentId' AS parent FROM projects WHERE id=$1", [cursor])).rows[0];
    if (!row) return { error: "El proyecto general indicado no existe" };
    cursor = row.parent || null;
  }
  return { value: id };
}

// Los técnicos entran acá además de admin y gerencia, pero con dos límites que se aplican abajo:
// sólo pueden crear subproyectos, y sólo colgando de un proyecto que ya tengan asignado. Editar,
// renombrar y eliminar proyectos sigue siendo exclusivo de admin y gerencia.
app.post("/api/projects", auth, requireRole("admin", "gerente", "tecnico", "tecnico_oficina"), async (req, res) => {
  const p = { ...(req.body || {}) }; if (!p.id) p.id = `p-${crypto.randomUUID()}`;
  p.name = String(p.name || "").trim(); p.key = String(p.key || "PRJ").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "PRJ";
  if (!p.name) return res.status(400).json({ error: "El nombre del proyecto es obligatorio" });
  const newParent = await resolveProjectParent(p.parentId, p.id);
  if (newParent.error) return res.status(400).json({ error: newParent.error });
  if (!newParent.skip) p.parentId = newParent.value;
  // Un técnico desglosa lo que tiene en la mano; no abre proyectos nuevos ni entra a los de otro
  // equipo. Se valida contra el padre ya resuelto, así no alcanza con mandar un parentId inventado.
  if (isProjectScoped(req.user.role)) {
    if (!p.parentId) return res.status(403).json({ error: "Sólo podés crear subproyectos dentro de un proyecto asignado" });
    if (!(await tecCanProject(req.user, p.parentId))) return res.status(403).json({ error: "No tenés acceso a ese proyecto" });
  }
  if ((await pool.query("SELECT 1 FROM projects WHERE upper(data->>'key')=upper($1) LIMIT 1", [p.key])).rows[0]) return res.status(409).json({ error: "Ya existe un proyecto con esa clave" });
  if (!Array.isArray(p.allowedUsers)) {
    if (p.parentId) {
      // Un subproyecto hereda los accesos de su general y suma a quien lo crea. Sin esto, un técnico
      // crearía un subproyecto que él mismo no puede ver, y el equipo del general tampoco lo vería.
      const parentRow = (await pool.query("SELECT data FROM projects WHERE id=$1", [p.parentId])).rows[0];
      const inherited = Array.isArray(parentRow?.data?.allowedUsers) ? parentRow.data.allowedUsers : [];
      p.allowedUsers = [...new Set([...inherited, ...(isProjectScoped(req.user.role) ? [req.user.id] : [])])];
    } else {
      const monitors = (await pool.query("SELECT id FROM users WHERE active=true AND role='monitor_oficina'")).rows.map((row) => row.id);
      p.allowedUsers = monitors;
    }
  }
  try { await pool.query("INSERT INTO projects(id,data,organization_id) VALUES($1,$2,$3)", [p.id, p, req.user.organizationId]); await auditChange({ entityType: "project", entityId: p.id, action: "create", user: req.user, afterData: { key: p.key, name: p.name, clientId: p.clientId || "" } }); }
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
  const movedParent = await resolveProjectParent(patch.parentId, req.params.id);
  if (movedParent.error) return res.status(400).json({ error: movedParent.error });
  if (!movedParent.skip) merged.parentId = movedParent.value;
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
    await auditChange({ entityType: "project", entityId: req.params.id, action: "update", user: req.user, beforeData: { name: rows[0].data.name, color: rows[0].data.color, allowedUsers: rows[0].data.allowedUsers || [] }, afterData: { name: merged.name, color: merged.color, allowedUsers: merged.allowedUsers || [] } }, db);
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
  // Se bloquea antes que nada: borrar un padre dejaría a sus subproyectos apuntando a un id que ya
  // no existe, y ahí no aparecerían ni bajo el general ni sueltos en la raíz. Mismo criterio que
  // los demás vínculos de abajo: se avisa y decide la persona, no se reasigna en silencio.
  const childCount = Number((await pool.query("SELECT count(*)::int AS count FROM projects WHERE data->>'parentId'=$1", [req.params.id])).rows[0]?.count || 0);
  if (childCount > 0) return res.status(409).json({ error: `No se puede eliminar: el proyecto tiene ${childCount} subproyecto(s). Movelos a otro proyecto general o eliminalos primero.` });
  const financialCount = Number((await pool.query("SELECT count(*)::int AS count FROM financial_movements WHERE data->>'projectId'=$1", [req.params.id])).rows[0]?.count || 0);
  if (financialCount > 0) return res.status(409).json({ error: `No se puede eliminar: el proyecto tiene ${financialCount} movimiento(s) financiero(s) asociado(s). Elimina o reasigna primero esos registros.` });
  const [orderLinks, materialLinks] = await Promise.all([
    pool.query("SELECT count(*)::int count FROM orders WHERE data->>'projectId'=$1", [req.params.id]),
    pool.query("SELECT count(*)::int count FROM material_lists WHERE data->>'projectId'=$1", [req.params.id]),
  ]);
  const operationalLinks = Number(orderLinks.rows[0]?.count || 0) + Number(materialLinks.rows[0]?.count || 0);
  if (operationalLinks) return res.status(409).json({ error: `No se puede eliminar: el proyecto tiene ${operationalLinks} orden(es) o listado(s) vinculado(s). Reasigna o anula primero esos registros.` });
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
    await auditChange({ entityType: "project", entityId: req.params.id, action: "delete", user: req.user, beforeData: { key: project.key, name: project.name }, reason: String(req.body?.reason || "Eliminación solicitada desde la aplicación") }, db);
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
  budget.targetMargin = targetMarginValue(budget.targetMargin);
  budget.items = Array.isArray(budget.items) ? budget.items.map((item) => {
    const laborRole = LABOR_ROLE_COST[item.description] != null ? item.description : LABOR_DEFAULT_ROLE[item.type];
    const isLabor = Boolean(laborRole && LABOR_ROLE_COST[laborRole] != null);
    // La tabla de roles pasa a ser un valor SUGERIDO, no impuesto: antes el costo cargado a mano se
    // descartaba en silencio para toda línea de mano de obra, así que un trabajo sin costo interno
    // igual arrastraba los USD 25/h del rol y el margen nunca podía dar 100%.
    // Se distingue "no vino el campo" de "vino en cero": un cero explícito ahora se respeta.
    const hasCost = item.unitCost !== undefined && item.unitCost !== null && item.unitCost !== "";
    const unitCost = hasCost ? Math.max(0, Number(item.unitCost) || 0) : (isLabor ? LABOR_ROLE_COST[laborRole] : 0);
    const suggestedSale = budget.targetMargin >= 100 ? unitCost : Math.round((unitCost / (1 - budget.targetMargin / 100)) * 100) / 100;
    // El precio sugerido solo aplica cuando no vino precio. Antes se disparaba con costo 0, así que
    // poner el costo en cero habría borrado también el precio de venta.
    const hasPrice = item.unitPrice !== undefined && item.unitPrice !== null && item.unitPrice !== "";
    return { ...item, description: isLabor ? laborRole : item.description, unit: isLabor ? "h" : item.unit, qty: Math.max(0, Number(item.qty) || 0), unitPrice: hasPrice ? Math.max(0, Number(item.unitPrice) || 0) : Math.max(0, suggestedSale), unitCost };
  }) : [];
  budget.additionalCosts = Array.isArray(budget.additionalCosts) ? budget.additionalCosts.map(normalizeAdditionalCost).filter((cost) => cost.description && cost.amount > 0) : [];
  budget.amount = Math.round(budget.items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0) * 100) / 100;
  budget.estimatedCost = Math.round(budget.items.reduce((sum, item) => sum + item.qty * item.unitCost, 0) * 100) / 100;
  budget.additionalCostTotal = Math.round(budget.additionalCosts.reduce((sum, cost) => sum + cost.amount, 0) * 100) / 100;
  budget.totalEstimatedCost = Math.round((budget.estimatedCost + budget.additionalCostTotal) * 100) / 100;
  return budget;
};

async function upsertBudgetInvoice(budget, user, db = pool) {
  const currentInvoice = (await db.query("SELECT data FROM financial_movements WHERE data->>'sourceBudgetId'=$1 LIMIT 1", [budget.id])).rows[0]?.data;
  if (currentInvoice?.date) await assertFinancePeriodOpen(currentInvoice.date, db);
  if (!["Facturado", "Pagado"].includes(budget.stage)) {
    await db.query("DELETE FROM financial_movements WHERE data->>'sourceBudgetId'=$1", [budget.id]);
    return null;
  }
  const invoiceDate = String(budget.invoicedAt || "").slice(0, 10);
  const invoiceNumber = String(budget.invoiceNumber || "").trim();
  if (!invoiceDate || !invoiceNumber) throw new Error("INVOICE_FIELDS_REQUIRED");
  await assertFinancePeriodOpen(invoiceDate, db);
  const net = Math.round((Number(budget.amount) || 0) * 100) / 100;
  const companyProfile = await loadCompanyProfile(user?.organizationId);
  const vatRate = companyProfile.pricing.vatRate;
  const vatAmount = Math.round(net * vatRate) / 100;
  const grossAmount = Math.round((net + vatAmount) * 100) / 100;
  const existing = (await db.query("SELECT id,data FROM financial_movements WHERE data->>'sourceBudgetId'=$1 LIMIT 1", [budget.id])).rows[0];
  const duplicate = (await db.query("SELECT id FROM financial_movements WHERE data->>'kind'='invoice' AND data->>'invoiceNumber'=$1 AND ($2::text IS NULL OR id<>$2) LIMIT 1", [invoiceNumber, existing?.id || null])).rows[0];
  if (duplicate) throw new Error("DUPLICATE_INVOICE");
  const id = existing?.id || `INV-${budget.id}`;
  // Referencia informativa en ARS al tipo de cambio mayorista A 3500 disponible al facturar.
  // No cambia la moneda de registro (USD): es solo trazabilidad para el circuito fiscal local.
  if (!wholesaleRateCache) {
    const persistedQuote = (await db.query("SELECT value,updated_at FROM app_settings WHERE key='wholesale_rate_last_good'")).rows[0];
    if (persistedQuote?.value?.arsPerUsd) wholesaleRateCache = { cachedAt: new Date(persistedQuote.updated_at).getTime(), data: persistedQuote.value };
  }
  const arsQuote = wholesaleRateCache?.data?.arsPerUsd || null;
  const arsReference = arsQuote ? { arsPerUsd: arsQuote, source: "BCRA dólar mayorista · Comunicación A 3500", quotedAt: wholesaleRateCache?.data?.updatedAt || null, netArs: Math.round(net * arsQuote * 100) / 100, vatArs: Math.round(vatAmount * arsQuote * 100) / 100, grossArs: Math.round(grossAmount * arsQuote * 100) / 100 } : (existing?.data?.arsReference || null);
  const invoice = { ...(existing?.data || {}), id, kind: "invoice", concept: `Factura ${budget.number || budget.id} · ${budget.title}`, amount: net, amountUsd: net, netAmountUsd: net, vatRate, vatAmountUsd: vatAmount, grossAmountUsd: grossAmount, arsReference, currency: "USD", exchangeRate: 1, date: invoiceDate, dueDate: budget.invoiceDueDate || "", invoiceNumber, receiptNumber: invoiceNumber, detail: budget.invoiceDetail || "", projectId: budget.projectId || "", budgetId: budget.id, budgetNumber: budget.number || budget.id, purchaseOrderNumber: budget.purchaseOrderNumber || "", purchaseOrderDate: budget.purchaseOrderDate || "", clientId: budget.clientId || "", clientName: budget.client || "", sourceBudgetId: budget.id, paymentStatus: existing?.data?.paymentStatus || "pending", createdAt: existing?.data?.createdAt || new Date().toISOString(), createdBy: existing?.data?.createdBy || user.id, createdByName: existing?.data?.createdByName || user.name, updatedAt: new Date().toISOString() };
  await db.query("INSERT INTO financial_movements(id,data,organization_id) VALUES($1,$2,current_setting('app.organization_id')) ON CONFLICT(organization_id,id) DO UPDATE SET data=$2, updated_at=now()", [id, invoice]);
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
  const currentMovement = (await db.query("SELECT data FROM financial_movements WHERE id=$1", [id])).rows[0]?.data;
  if (currentMovement?.date) await assertFinancePeriodOpen(currentMovement.date, db);
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
    paymentStatus: existing?.data?.paymentStatus || "pending", paidAt: existing?.data?.paidAt || "", dueDate: po.dueDate || existing?.data?.dueDate || "",
    sourcePurchaseOrderId: po.id, purchaseOrderNumber: po.number || po.id,
    detail: `Generado automáticamente al recibir la orden de compra ${po.number || po.id}. Se actualiza si cambian los ítems.`,
    createdAt: existing?.data?.createdAt || new Date().toISOString(), createdBy: existing?.data?.createdBy || user.id, createdByName: existing?.data?.createdByName || user.name,
    updatedAt: new Date().toISOString(),
  };
  await assertFinancePeriodOpen(movement.date, db);
  await db.query("INSERT INTO financial_movements(id,data,organization_id) VALUES($1,$2,current_setting('app.organization_id')) ON CONFLICT(organization_id,id) DO UPDATE SET data=$2, updated_at=now()", [id, movement]);
  return movement;
}

app.get("/api/suppliers", auth, requireRole("admin", "gerente"), async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM suppliers WHERE organization_id=$1 ORDER BY data->>'name'", [req.user.organizationId]);
  res.json(rows.map((r) => r.data));
});
app.post("/api/suppliers", auth, requireRole("admin", "gerente"), async (req, res) => {
  const s = { ...(req.body || {}) };
  s.name = String(s.name || "").trim();
  if (!s.name) return res.status(400).json({ error: "El nombre del proveedor es obligatorio" });
  const existingRows = (await pool.query("SELECT data FROM suppliers")).rows.map((r) => r.data);
  const dup = existingRows.find((x) => (x.name || "").trim().toLowerCase() === s.name.toLowerCase());
  if (dup) return res.json(dup);
  if (!s.id) s.id = `sup-${crypto.randomUUID()}`;
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
  try { await pool.query("INSERT INTO suppliers(id,data,organization_id) VALUES($1,$2,$3)", [s.id, s, req.user.organizationId]); }
  catch (error) { if (error.code === "23505") return res.status(409).json({ error: "Ya existe un proveedor con ese identificador" }); throw error; }
  await auditChange({ entityType: "supplier", entityId: s.id, action: "create", user: req.user, afterData: { name: s.name, code: s.code, active: s.active } });
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
  await auditChange({ entityType: "supplier", entityId: req.params.id, action: "update", user: req.user, beforeData: { name: rows[0].data.name, active: rows[0].data.active }, afterData: { name: merged.name, active: merged.active } });
  res.json(merged);
});
app.delete("/api/suppliers/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const linked = (await pool.query("SELECT count(*)::int count FROM purchase_orders WHERE data->>'supplierId'=$1", [req.params.id])).rows[0].count;
  if (linked) return res.status(409).json({ error: `No se puede eliminar: el proveedor tiene ${linked} orden(es) de compra vinculada(s). Reasigná o eliminá primero esas órdenes.` });
  const deleted = await pool.query("DELETE FROM suppliers WHERE id=$1 RETURNING id,data", [req.params.id]);
  if (!deleted.rowCount) return res.status(404).json({ error: "No existe" });
  await auditChange({ entityType: "supplier", entityId: req.params.id, action: "delete", user: req.user, beforeData: { name: deleted.rows[0].data.name } });
  res.status(204).end();
});

app.get("/api/purchase-orders", auth, requireRole("admin", "gerente"), async (req, res) => {
  const { rows } = await pool.query("SELECT data, updated_at FROM purchase_orders WHERE organization_id=$1 ORDER BY updated_at DESC", [req.user.organizationId]);
  res.json(rows.filter((r) => !r.data.archivedAt).map((r) => ({ ...r.data, _updatedAt: r.updated_at })));
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
    await db.query("INSERT INTO purchase_orders(id,data,organization_id) VALUES($1,$2,$3)", [po.id, po, req.user.organizationId]);
    const generatedMovement = await upsertPurchaseOrderPayable(po, req.user, db);
    await auditChange({ entityType: "purchase_order", entityId: po.id, action: "create", user: req.user, afterData: { stage: po.stage, supplierId: po.supplierId, grossAmountUsd: po.grossAmountUsd } }, db);
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
  if (current.stage === "Recibida" && po.stage === "Recibida" && JSON.stringify(po.items) !== JSON.stringify(current.items || [])) {
    return res.status(409).json({ error: "Una orden ya recibida no puede modificar sus ítems: primero revertí la recepción cambiando su estado y luego editá las cantidades." });
  }
  if (po.stage === "Recibida" && current.stage !== "Recibida") po.receivedAt = po.receivedAt || new Date().toISOString();
  const changes = [];
  if (po.stage !== current.stage) changes.push(`Estado: ${current.stage} → ${po.stage}`);
  if (!changes.length) changes.push("Orden de compra actualizada");
  po.activity = [...(current.activity || []), { type: "update", text: changes.join(" · "), by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  const receivingNow = po.stage === "Recibida" && current.stage !== "Recibida";
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const locked = (await db.query("SELECT data FROM purchase_orders WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0]?.data;
    if (!locked || JSON.stringify(locked) !== JSON.stringify(current)) {
      await db.query("ROLLBACK");
      return res.status(409).json({ error: "La orden de compra cambió mientras la editabas. Recargá la pantalla antes de volver a guardar." });
    }
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
      for (const item of current.items || []) {
        const partId = item.partId || await matchPartIdByName(item.description, db);
        if (partId) await adjustPartStock(partId, -(Number(item.qty) || 0), db, { movementType: "Reversión", sourceType: "Orden de compra", sourceId: po.id, userId: req.user.id });
      }
      po.stockAppliedAt = "";
    }
    await db.query("UPDATE purchase_orders SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, po]);
    const generatedMovement = await upsertPurchaseOrderPayable(po, req.user, db);
    await auditChange({ entityType: "purchase_order", entityId: po.id, action: "update", user: req.user, beforeData: { stage: current.stage, grossAmountUsd: current.grossAmountUsd }, afterData: { stage: po.stage, grossAmountUsd: po.grossAmountUsd } }, db);
    await db.query("COMMIT");
    res.json({ ...po, _generatedMovement: generatedMovement });
  } catch (error) {
    await db.query("ROLLBACK");
    return res.status(500).json({ error: "No se pudo actualizar la orden de compra de forma consistente." });
  } finally { db.release(); }
});
app.delete("/api/purchase-orders/:id", auth, requireRole("admin"), async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const current = (await db.query("SELECT data FROM purchase_orders WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0]?.data;
    if (!current) { await db.query("ROLLBACK"); return res.status(404).json({ error: "No existe" }); }
    if (current.stockAppliedAt) {
      for (const item of current.items || []) {
        const partId = item.partId || await matchPartIdByName(item.description, db);
        if (partId) await adjustPartStock(partId, -(Number(item.qty) || 0), db, { movementType: "Reversión", sourceType: "Orden de compra anulada", sourceId: current.id, userId: req.user.id });
      }
    }
    await db.query("DELETE FROM financial_movements WHERE data->>'sourcePurchaseOrderId'=$1", [req.params.id]);
    const archived = { ...current, stageBeforeArchive: current.stage, stage: "Cancelada", stockAppliedAt: "", archivedAt: new Date().toISOString(), archivedBy: req.user.id };
    await db.query("UPDATE purchase_orders SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, archived]);
    await auditChange({ entityType: "purchase_order", entityId: req.params.id, action: "archive", user: req.user, beforeData: { stage: current.stage, stockAppliedAt: current.stockAppliedAt || "" }, afterData: { stage: "Cancelada", archivedAt: archived.archivedAt }, reason: String(req.body?.reason || "Anulación solicitada desde la aplicación") }, db);
    await db.query("COMMIT");
    res.status(204).end();
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.code === "INSUFFICIENT_STOCK") return res.status(409).json({ error: `No se puede anular la compra porque parte del stock ya fue consumido. ${error.message}` });
    throw error;
  } finally { db.release(); }
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

/* ------------------------------------------------ Remitos de trabajo ------------------------------------------------ */
// Un remito acredita la entrega de un trabajo ante el cliente: agrupa una o varias órdenes ya
// ejecutadas, se firma y se envía. No lleva importes a propósito — eso va en la factura, y mezclar
// ambas cosas en un mismo papel confunde lo que el cliente está firmando.
const normalizeDeliveryNote = (body = {}) => {
  const text = (value, max) => String(value || "").trim().slice(0, max);
  return {
    id: text(body.id, 40) || `RT-${crypto.randomUUID()}`,
    number: text(body.number, 20),
    date: text(body.date, 10) || new Date().toISOString().slice(0, 10),
    clientId: text(body.clientId, 60),
    client: text(body.client, 120),
    site: text(body.site, 120),
    purchaseOrder: text(body.purchaseOrder, 60),
    // Los renglones se guardan tal como se firmaron, no como referencias a las órdenes: si mañana
    // se edita una OT, el remito ya entregado no puede cambiar de contenido.
    items: (Array.isArray(body.items) ? body.items : []).slice(0, 100).map((item) => ({
      orderId: text(item.orderId, 40),
      date: text(item.date, 10),
      description: text(item.description, 400),
      // Cantidad y unidad quedan vacías si no se cargaron: hay renglones que son conceptos
      // —"Entrega documental de planimetría"— y no cosas contables. Forzar "0 u" imprimía en el
      // remito una cantidad falsa, en un documento que el cliente firma.
      qty: String(item.qty ?? "").trim() === "" ? "" : Math.max(0, Math.min(99999, Number(item.qty) || 0)),
      unit: text(item.unit, 12),
    })),
    notes: text(body.notes, 2000),
    signedBy: text(body.signedBy, 120),
    signatureUrl: /^data:image\/(png|jpeg|webp);base64,/i.test(String(body.signatureUrl || "")) ? String(body.signatureUrl) : "",
    // Firma de la empresa emisora, aparte de la conformidad del cliente: un remito lo suscriben las
    // dos partes. Se valida como imagen igual que la otra — es un data URL que termina insertado en
    // el PDF, así que no puede entrar cualquier cadena.
    issuedBy: text(body.issuedBy, 120),
    issuerSignatureUrl: /^data:image\/(png|jpeg|webp);base64,/i.test(String(body.issuerSignatureUrl || "")) ? String(body.issuerSignatureUrl) : "",
    createdAt: body.createdAt || new Date().toISOString(),
  };
};
app.get("/api/delivery-notes", auth, requireRole("admin", "gerente", "tecnico"), async (req, res) => {
  const { rows } = await pool.query("SELECT data, updated_at FROM delivery_notes WHERE organization_id=$1 ORDER BY updated_at DESC", [req.user.organizationId]);
  res.json(rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })));
});
app.post("/api/delivery-notes", auth, requireRole("admin", "gerente", "tecnico"), apiRateLimit(60), async (req, res) => {
  const note = normalizeDeliveryNote(req.body);
  if (!note.client) return res.status(400).json({ error: "El cliente es obligatorio" });
  if (!note.items.length) return res.status(400).json({ error: "Agregá al menos un renglón al remito" });
  // La numeración se asigna en el servidor y no en el navegador: dos personas emitiendo a la vez
  // desde sus equipos generarían el mismo número si lo calculara cada cliente por su cuenta.
  if (!note.number) {
    const last = (await pool.query("SELECT data->>'number' AS number FROM delivery_notes WHERE organization_id=$1 ORDER BY (data->>'number') DESC LIMIT 1", [req.user.organizationId])).rows[0];
    // La serie arranca en 100 por pedido del usuario, para continuar la numeración que ya venía
    // llevando fuera del sistema. El máximo con el último emitido evita que un remito borrado haga
    // retroceder la serie y se repita un número ya entregado.
    const next = Math.max(99, Number(String(last?.number || "").replace(/\D/g, "")) || 0) + 1;
    note.number = `RT${String(next).padStart(5, "0")}`;
  }
  await pool.query("INSERT INTO delivery_notes(id,data,organization_id) VALUES($1,$2,current_setting('app.organization_id'))", [note.id, note]);
  await auditChange({ entityType: "delivery_note", entityId: note.id, action: "create", user: req.user, afterData: { number: note.number, client: note.client, items: note.items.length } });
  res.status(201).json(note);
});
app.patch("/api/delivery-notes/:id", auth, requireRole("admin", "gerente", "tecnico"), apiRateLimit(60), async (req, res) => {
  const current = (await pool.query("SELECT data FROM delivery_notes WHERE id=$1", [req.params.id])).rows[0];
  if (!current) return res.status(404).json({ error: "No existe" });
  // Número y fecha de creación no se reescriben: identifican el documento entregado.
  const merged = normalizeDeliveryNote({ ...current.data, ...req.body, id: current.data.id, number: current.data.number, createdAt: current.data.createdAt });
  await pool.query("UPDATE delivery_notes SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
  res.json(merged);
});
app.delete("/api/delivery-notes/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const deleted = await pool.query("DELETE FROM delivery_notes WHERE id=$1 RETURNING data", [req.params.id]);
  if (!deleted.rowCount) return res.status(404).json({ error: "No existe" });
  await auditChange({ entityType: "delivery_note", entityId: req.params.id, action: "delete", user: req.user, beforeData: { number: deleted.rows[0].data.number } });
  res.status(204).end();
});
app.get("/api/material-lists", auth, requireRole("admin", "gerente", "tecnico"), async (req, res) => {
  const { rows } = await pool.query("SELECT data, updated_at FROM material_lists WHERE organization_id=$1 ORDER BY updated_at DESC", [req.user.organizationId]);
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
  try { await pool.query("INSERT INTO material_lists(id,data,organization_id) VALUES($1,$2,$3)", [ml.id, ml, req.user.organizationId]); }
  catch (error) { if (error.code === "23505") return res.status(409).json({ error: "Ya existe un listado con ese identificador" }); throw error; }
  await auditChange({ entityType: "material_list", entityId: ml.id, action: "create", user: req.user, afterData: { projectId: ml.projectId, audience: ml.audience, sections: ml.sections.length } });
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
  await auditChange({ entityType: "material_list", entityId: req.params.id, action: "update", user: req.user, beforeData: { projectId: current.projectId, audience: current.audience }, afterData: { projectId: ml.projectId, audience: ml.audience, sections: ml.sections.length } });
  res.json(ml);
});
app.delete("/api/material-lists/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const deleted = await pool.query("DELETE FROM material_lists WHERE id=$1 RETURNING id,data", [req.params.id]);
  if (!deleted.rowCount) return res.status(404).json({ error: "No existe" });
  await auditChange({ entityType: "material_list", entityId: req.params.id, action: "delete", user: req.user, beforeData: { projectId: deleted.rows[0].data.projectId, audience: deleted.rows[0].data.audience } });
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
  const { rows } = await pool.query("SELECT data, updated_at FROM whiteboard_notes WHERE organization_id=$1 ORDER BY updated_at DESC", [req.user.organizationId]);
  res.json(rows.filter((r) => whiteboardNoteVisible(req.user, r.data)).map((r) => ({ ...r.data, _updatedAt: r.updated_at })));
});
app.post("/api/whiteboard-notes", auth, requireProjectWrite, async (req, res) => {
  const n = normalizeWhiteboardNote(req.body);
  if (n.type === "text" && !n.title && !n.content) return res.status(400).json({ error: "La nota necesita un título o contenido." });
  if (n.type === "drawing" && !n.imageDataUrl) return res.status(400).json({ error: "El dibujo está vacío." });
  if (!n.id) n.id = `wbn-${crypto.randomUUID()}`;
  if (n.projectId && !(await pool.query("SELECT 1 FROM projects WHERE id=$1 AND organization_id=$2", [n.projectId, req.user.organizationId])).rowCount) return res.status(400).json({ error: "El proyecto no pertenece a esta empresa." });
  n.createdAt = new Date().toISOString();
  n.createdBy = req.user.id; n.createdByName = req.user.name;
  n.sharedWith = []; // una nota nueva siempre arranca privada; compartir es un paso aparte y explícito
  try { await pool.query("INSERT INTO whiteboard_notes(id,data,organization_id) VALUES($1,$2,$3)", [n.id, n, req.user.organizationId]); await auditChange({ entityType: "whiteboard_note", entityId: n.id, action: "create", user: req.user, afterData: { type: n.type, projectId: n.projectId || "" } }); }
  catch (error) { if (error.code === "23505") return res.status(409).json({ error: "Ya existe una nota con ese identificador" }); throw error; }
  res.json(n);
});
app.patch("/api/whiteboard-notes/:id", auth, requireProjectWrite, async (req, res) => {
  const current = (await pool.query("SELECT data FROM whiteboard_notes WHERE id=$1 AND organization_id=$2", [req.params.id, req.user.organizationId])).rows[0]?.data;
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
  if (n.projectId && !(await pool.query("SELECT 1 FROM projects WHERE id=$1 AND organization_id=$2", [n.projectId, req.user.organizationId])).rowCount) return res.status(400).json({ error: "El proyecto no pertenece a esta empresa." });
  if (n.sharedWith.length) {
    const validUsers = (await pool.query("SELECT id FROM users WHERE id=ANY($1::text[]) AND organization_id=$2", [n.sharedWith, req.user.organizationId])).rows.map((row) => row.id);
    if (validUsers.length !== n.sharedWith.length) return res.status(400).json({ error: "Una persona seleccionada no pertenece a esta empresa." });
  }
  n.createdBy = current.createdBy; n.createdByName = current.createdByName; n.createdAt = current.createdAt;
  await pool.query("UPDATE whiteboard_notes SET data=$2, updated_at=now() WHERE id=$1 AND organization_id=$3", [req.params.id, n, req.user.organizationId]);
  await auditChange({ entityType: "whiteboard_note", entityId: req.params.id, action: "update", user: req.user, beforeData: { type: current.type, projectId: current.projectId || "" }, afterData: { type: n.type, projectId: n.projectId || "" } });
  res.json(n);
});
app.delete("/api/whiteboard-notes/:id", auth, requireProjectWrite, async (req, res) => {
  const current = (await pool.query("SELECT data FROM whiteboard_notes WHERE id=$1 AND organization_id=$2", [req.params.id, req.user.organizationId])).rows[0]?.data;
  if (!current) return res.status(404).json({ error: "No existe" });
  if (current.createdBy !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Solo quien creó la nota (o un administrador) puede eliminarla" });
  await pool.query("DELETE FROM whiteboard_notes WHERE id=$1 AND organization_id=$2", [req.params.id, req.user.organizationId]);
  await auditChange({ entityType: "whiteboard_note", entityId: req.params.id, action: "delete", user: req.user, beforeData: { type: current.type, projectId: current.projectId || "" } });
  res.status(204).end();
});

app.post("/api/budgets", auth, requireRole("admin", "gerente"), apiRateLimit(60), async (req, res) => {
  const profile = await loadCompanyProfile(req.user.organizationId);
  const budget = normalizeBudget({ targetMargin: profile.pricing.targetMargin, ...(req.body || {}) });
  if (budget.stage === "Pagado") return res.status(400).json({ error: "El estado Pagado se asigna automáticamente al registrar el cobro completo." });
  if (!String(budget.client || "").trim() || !String(budget.title || "").trim()) return res.status(400).json({ error: "Cliente y nombre del presupuesto son obligatorios." });
  if (!budget.id) {
    const year = new Date().getFullYear();
    const tenantPrefix = req.user.organizationId === DEFAULT_ORGANIZATION_ID ? "" : `${String(req.user.organizationId).replace(/^org-/, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)}-`;
    const stem = `PRES-${tenantPrefix}${year}-`;
    const rows = (await pool.query("SELECT id FROM budgets WHERE id LIKE $1", [`${stem}%`])).rows;
    const next = Math.max(0, ...rows.map((row) => Number(String(row.id).split("-").pop()) || 0)) + 1;
    budget.id = `${stem}${String(next).padStart(3, "0")}`;
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
    await db.query("INSERT INTO budgets(id,data,organization_id) VALUES($1,$2,$3)", [budget.id, budget, req.user.organizationId]);
    const generatedInvoice = await upsertBudgetInvoice(budget, req.user, db);
    await auditChange({ entityType: "budget", entityId: budget.id, action: "create", user: req.user, afterData: { number: budget.number, stage: budget.stage, amount: budget.amount, clientId: budget.clientId || "" } }, db);
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
    await auditChange({ entityType: "budget", entityId: budget.id, action: "update", user: req.user, beforeData: { stage: current.stage, amount: current.amount, number: current.number }, afterData: { stage: budget.stage, amount: budget.amount, number: budget.number }, reason: changes.join(" · ") }, db);
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
    await auditChange({ entityType: "budget", entityId: req.params.id, action: "delete", user: req.user, beforeData: { number: budget.number, stage: budget.stage, amount: budget.amount }, reason: String(req.body?.reason || "Eliminación solicitada desde la aplicación") }, db);
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
    const projectId = `p-${crypto.randomUUID()}`;
    const rawKey = String(req.body?.key || budget.title || "PRJ").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    const key = await uniqueProjectKey(rawKey || "PRJ", db);
    const monitors = (await db.query("SELECT id FROM users WHERE active=true AND role='monitor_oficina'")).rows.map((row) => row.id);
    const project = { id: projectId, key, name: budget.title, color: req.body?.color || "#F18700", allowedUsers: monitors, budgetId: budget.id, clientId: budget.clientId || "", client: budget.client, site: budget.site || "", plannedStart: budget.plannedStart || "", plannedEnd: budget.plannedEnd || "", estimatedAmount: budget.amount, currency: "USD", purchaseOrderNumber: budget.purchaseOrderNumber || "", purchaseOrderDate: budget.purchaseOrderDate || "" };
    await db.query("INSERT INTO projects(id,data,organization_id) VALUES($1,$2,$3)", [projectId, project, req.user.organizationId]);
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
  if (!wholesaleRateCache) {
    const persisted = (await pool.query("SELECT value,updated_at FROM app_settings WHERE key='wholesale_rate_last_good'")).rows[0];
    if (persisted?.value?.arsPerUsd) wholesaleRateCache = { cachedAt: new Date(persisted.updated_at).getTime(), data: persisted.value };
  }
  if (!force && wholesaleRateCache && Date.now() - wholesaleRateCache.cachedAt < WHOLESALE_RATE_CACHE_MS)
    return res.json({ ...wholesaleRateCache.data, fetchedAt: new Date(wholesaleRateCache.cachedAt).toISOString() });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response;
    try { response = await fetch("https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/5?limit=1", { signal: controller.signal, headers: { Accept: "application/json", "User-Agent": "MiOrdenGo/1.0" } }); }
    finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const quote = payload?.results?.[0]?.detalle?.[0];
    const value = Number(quote?.valor);
    if (!(value > 0) || !quote?.fecha) throw new Error("Cotización inválida");
    // updatedAt identifica el día hábil publicado; fetchedAt, cuándo se realizó la consulta.
    const data = { currency: "USD", arsPerUsd: value, buy: null, sell: value, updatedAt: `${quote.fecha}T00:00:00-03:00`, source: "Banco Central de la República Argentina", sourceLabel: "Dólar mayorista · Comunicación A 3500", sourceUrl: "https://www.bcra.gob.ar/principales-variables/", variableId: 5 };
    wholesaleRateCache = { cachedAt: Date.now(), data };
    await pool.query("INSERT INTO app_settings(key,value,updated_at) VALUES('wholesale_rate_last_good',$1,now()) ON CONFLICT(organization_id,key) DO UPDATE SET value=$1,updated_at=now()", [data]);
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
    movement.vatRate = boundedNumber(movement.vatRate, 21, 0, 100);
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
    const vat = expenseVatBreakdown(movement.amountUsd, movement.vatIncluded, movement.vatRate, movement.vatComputablePercent ?? 100);
    movement.vatRate = vat.rate; movement.vatComputablePercent = vat.computablePercent;
    movement.grossAmountUsd = vat.gross; movement.netAmountUsd = vat.net;
    movement.vatAmountUsd = vat.vat; movement.computableVatAmountUsd = vat.computableVat;
    movement.paymentStatus = ["paid", "pending"].includes(movement.paymentStatus) ? movement.paymentStatus : "paid";
    movement.paidAt = movement.paymentStatus === "paid" ? String(movement.paidAt || movement.date || "").slice(0, 10) : "";
    movement.dueDate = movement.paymentStatus === "pending" ? String(movement.dueDate || "").slice(0, 10) : "";
  }
  return movement;
};

const applyApprovedBudgetLink = async (movement) => {
  if (!movement.projectId) {
    // Los gastos generales de la empresa (viáticos corporativos, administración, etc.) no deben
    // quedar asociados al primer presupuesto aprobado que tampoco tenga proyecto convertido.
    if (movement.kind === "expense") {
      movement.budgetId = "";
      movement.budgetNumber = "";
      movement.budgetTitle = "";
      movement.purchaseOrderNumber = "";
      movement.purchaseOrderDate = "";
      movement.linkageSource = "general-expense";
    }
    return movement;
  }
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

// Los cobros pueden cancelar facturas de varios proyectos. Su imputación vive en cada partida,
// no necesariamente en el encabezado del movimiento. Se reconstruye desde la factura y, para
// registros históricos sin projectId, desde el presupuesto o el proyecto convertido.
const hydrateIncomeAllocationLinks = async (movement, db = pool) => {
  if (movement.kind !== "income" || !movement.allocations?.length) return movement;
  const invoiceIds = [...new Set(movement.allocations.map((allocation) => allocation.invoiceId).filter(Boolean))];
  const invoiceRows = invoiceIds.length ? (await db.query("SELECT id,data FROM financial_movements WHERE id=ANY($1::text[])", [invoiceIds])).rows : [];
  const invoiceById = new Map(invoiceRows.map((row) => [row.id, row.data]));
  const budgetIds = [...new Set(invoiceRows.flatMap((row) => [row.data?.budgetId, row.data?.sourceBudgetId]).filter(Boolean))];
  const budgetRows = budgetIds.length ? (await db.query("SELECT id,data FROM budgets WHERE id=ANY($1::text[])", [budgetIds])).rows : [];
  const budgetById = new Map(budgetRows.map((row) => [row.id, row.data]));
  const projectRows = budgetIds.length ? (await db.query("SELECT id,data FROM projects WHERE data->>'budgetId'=ANY($1::text[])", [budgetIds])).rows : [];
  const projectByBudget = new Map(projectRows.map((row) => [row.data?.budgetId, row.id]));
  movement.allocations = movement.allocations.map((allocation) => {
    const invoice = invoiceById.get(allocation.invoiceId);
    const budgetId = allocation.budgetId || invoice?.budgetId || invoice?.sourceBudgetId || "";
    const budget = budgetById.get(budgetId);
    const projectId = allocation.projectId || invoice?.projectId || budget?.projectId || projectByBudget.get(budgetId) || "";
    return { ...allocation, projectId, budgetId, receiptNumber: allocation.receiptNumber || invoice?.receiptNumber || invoice?.invoiceNumber || "" };
  });
  const projectIds = [...new Set(movement.allocations.map((allocation) => allocation.projectId).filter(Boolean))];
  const linkedBudgetIds = [...new Set(movement.allocations.map((allocation) => allocation.budgetId).filter(Boolean))];
  // Un encabezado común solo es correcto si todas las partidas pertenecen al mismo destino.
  movement.projectId = projectIds.length === 1 ? projectIds[0] : "";
  movement.budgetId = linkedBudgetIds.length === 1 ? linkedBudgetIds[0] : "";
  return movement;
};

const financePeriodKey = (value) => /^\d{4}-\d{2}/.test(String(value || "")) ? String(value).slice(0, 7) : "";
const financePeriodLocks = async (db = pool) => {
  const value = (await db.query("SELECT value FROM app_settings WHERE key='finance_period_locks_v1'")).rows[0]?.value;
  return Array.isArray(value?.lockedPeriods) ? value.lockedPeriods : [];
};
const assertFinancePeriodOpen = async (date, db = pool) => {
  const period = financePeriodKey(date);
  if (period && (await financePeriodLocks(db)).includes(period)) {
    const error = new Error(`El período ${period} está cerrado. Un administrador debe reabrirlo antes de modificar movimientos.`);
    error.code = "FINANCE_PERIOD_LOCKED";
    throw error;
  }
};

app.get("/api/finance-period-locks", auth, requireRole("admin", "gerente"), async (_req, res) => {
  res.json({ lockedPeriods: await financePeriodLocks() });
});

app.put("/api/finance-period-locks/:period", auth, requireRole("admin"), async (req, res) => {
  const period = financePeriodKey(req.params.period);
  if (!period || period !== req.params.period) return res.status(400).json({ error: "El período debe tener formato AAAA-MM." });
  const current = await financePeriodLocks();
  const locked = req.body?.locked !== false;
  const lockedPeriods = [...new Set(locked ? [...current, period] : current.filter((item) => item !== period))].sort();
  await pool.query("INSERT INTO app_settings(key,value,updated_at) VALUES('finance_period_locks_v1',$1,now()) ON CONFLICT(organization_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()", [{ lockedPeriods, updatedBy: req.user.id, updatedAt: new Date().toISOString() }]);
  await auditChange({ entityType: "finance_period", entityId: period, action: locked ? "close" : "reopen", user: req.user, beforeData: { locked: current.includes(period) }, afterData: { locked } });
  res.json({ lockedPeriods });
});

app.post("/api/finances", auth, requireRole("admin", "gerente"), async (req, res) => {
  if ((req.body?.kind || "expense") === "expense" && !["paid", "pending"].includes(req.body?.paymentStatus)) return res.status(400).json({ error: "Indica si el gasto está pagado o pendiente de pago." });
  if ((req.body?.kind || "expense") === "expense" && req.body?.paymentStatus === "pending" && !String(req.body?.dueDate || "").slice(0, 10)) return res.status(400).json({ error: "Indica el vencimiento del gasto pendiente." });
  const profile = await loadCompanyProfile(req.user.organizationId);
  const financeInput = (req.body?.kind === "invoice" && req.body?.vatRate == null) ? { ...(req.body || {}), vatRate: profile.pricing.vatRate } : req.body;
  let movement = await hydrateIncomeAllocationLinks(normalizeFinancialMovement(financeInput));
  movement = await applyApprovedBudgetLink(movement);
  try { await assertFinancePeriodOpen(movement.date); } catch (error) { if (error.code === "FINANCE_PERIOD_LOCKED") return res.status(409).json({ error: error.message }); throw error; }
  if (!String(movement.concept || "").trim() || movement.amount <= 0 || !movement.date) return res.status(400).json({ error: "Concepto, importe y fecha son obligatorios." });
  if (movement.currency !== "USD" && !movement.exchangeRate) return res.status(400).json({ error: "Indica el tipo de cambio para calcular el equivalente en USD." });
  if (movement.attachments.reduce((sum, item) => sum + String(item?.url || "").length, 0) > MAX_MOVEMENT_ATTACHMENT_CHARS) return res.status(413).json({ error: "Los documentos adjuntos superan el tamaño permitido. Quita alguno o reducí su peso." });
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
    movement = await externalizeFinancialAssets(movement, db, req.user.id);
    await db.query("INSERT INTO financial_movements(id,data,organization_id) VALUES($1,$2,$3)", [movement.id, movement, req.user.organizationId]);
    const updatedBudgets = movement.kind === "income" ? await syncBudgetPaymentStatuses(movementBudgetIds(movement), db, req.user) : [];
    await auditChange({ entityType: "financial_movement", entityId: movement.id, action: "create", user: req.user, afterData: { kind: movement.kind, amountUsd: movement.amountUsd, projectId: movement.projectId || "", budgetId: movement.budgetId || "" } }, db);
    await db.query("COMMIT");
    res.json({ ...movement, _updatedBudgets: updatedBudgets });
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "Ya existe un movimiento con ese identificador" });
    if (error.code === "INVALID_ASSET") return res.status(413).json({ error: error.message });
    throw error;
  } finally { db.release(); }
});

app.get("/api/finances/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const movement = (await pool.query("SELECT data FROM financial_movements WHERE id=$1 AND organization_id=$2", [req.params.id, req.user.organizationId])).rows[0]?.data;
  if (!movement) return res.status(404).json({ error: "No existe" });
  res.json(movement);
});

app.patch("/api/finances/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const current = (await pool.query("SELECT data FROM financial_movements WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!current) return res.status(404).json({ error: "No existe" });
  try { await assertFinancePeriodOpen(current.date); if (req.body?.date) await assertFinancePeriodOpen(req.body.date); } catch (error) { if (error.code === "FINANCE_PERIOD_LOCKED") return res.status(409).json({ error: error.message }); throw error; }
  const isAutoGenerated = !!(current.sourceOrderId || current.sourcePurchaseOrderId);
  const patchKeys = Object.keys(req.body || {});
  const onlyPaymentFields = patchKeys.length > 0 && patchKeys.every((key) => ["paymentStatus", "paidAt"].includes(key));
  // Los gastos generados automáticamente (desde una OT o una OC) no se editan a mano, salvo su
  // estado de pago: eso sí se necesita poder confirmarlo, y queda la fecha de pago para trazabilidad.
  if (isAutoGenerated && onlyPaymentFields) {
    const paymentStatus = req.body.paymentStatus === "pending" ? "pending" : "paid";
    const movement = { ...current, paymentStatus, paidAt: paymentStatus === "paid" ? String(req.body.paidAt || new Date().toISOString().slice(0, 10)) : "", updatedBy: req.user.id, updatedByName: req.user.name, updatedAt: new Date().toISOString() };
    await pool.query("UPDATE financial_movements SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, movement]);
    await auditChange({ entityType: "financial_movement", entityId: req.params.id, action: "payment_status", user: req.user, beforeData: { paymentStatus: current.paymentStatus, paidAt: current.paidAt || "" }, afterData: { paymentStatus, paidAt: movement.paidAt } });
    return res.json(movement);
  }
  if (current.sourceOrderId) return res.status(409).json({ error: "Este gasto se genera automáticamente desde la orden de trabajo y no se edita manualmente." });
  if (current.sourcePurchaseOrderId) return res.status(409).json({ error: "Este gasto se genera automáticamente desde la orden de compra y no se edita manualmente." });
  let movement = await hydrateIncomeAllocationLinks(normalizeFinancialMovement(req.body, current));
  movement = await applyApprovedBudgetLink(movement);
  if (movement.kind === "expense" && !["paid", "pending"].includes(req.body?.paymentStatus ?? current.paymentStatus)) return res.status(400).json({ error: "Indica si el gasto está pagado o pendiente de pago." });
  if (movement.kind === "expense" && movement.paymentStatus === "pending" && !movement.dueDate) return res.status(400).json({ error: "Indica el vencimiento del gasto pendiente." });
  movement.id = req.params.id;
  if (!String(movement.concept || "").trim() || movement.amount <= 0 || !movement.date) return res.status(400).json({ error: "Concepto, importe y fecha son obligatorios." });
  if (movement.currency !== "USD" && !movement.exchangeRate) return res.status(400).json({ error: "Indica el tipo de cambio para calcular el equivalente en USD." });
  if (movement.attachments.reduce((sum, item) => sum + String(item?.url || "").length, 0) > MAX_MOVEMENT_ATTACHMENT_CHARS) return res.status(413).json({ error: "Los documentos adjuntos superan el tamaño permitido. Quita alguno o reducí su peso." });
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
    movement = await externalizeFinancialAssets(movement, db, req.user.id);
    await db.query("UPDATE financial_movements SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, movement]);
    const retainedAssetUrls = (movement.attachments || []).map((attachment) => attachment.url).filter((value) => typeof value === "string" && value.startsWith("/api/files/"));
    await db.query("DELETE FROM file_assets WHERE entity_type='financial' AND entity_id=$1 AND NOT (('/api/files/' || id) = ANY($2::text[]))", [movement.id, retainedAssetUrls]);
    const updatedBudgets = (current.kind === "income" || movement.kind === "income") ? await syncBudgetPaymentStatuses(affectedBudgetIds, db, req.user) : [];
    await auditChange({ entityType: "financial_movement", entityId: movement.id, action: "update", user: req.user, beforeData: { kind: current.kind, amountUsd: current.amountUsd, paymentStatus: current.paymentStatus }, afterData: { kind: movement.kind, amountUsd: movement.amountUsd, paymentStatus: movement.paymentStatus } }, db);
    await db.query("COMMIT");
    res.json({ ...movement, _updatedBudgets: updatedBudgets });
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.code === "INVALID_ASSET") return res.status(413).json({ error: error.message });
    throw error;
  } finally { db.release(); }
});

app.delete("/api/finances/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const movement = (await pool.query("SELECT data FROM financial_movements WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!movement) return res.status(404).json({ error: "No existe" });
  try { await assertFinancePeriodOpen(movement.date); } catch (error) { if (error.code === "FINANCE_PERIOD_LOCKED") return res.status(409).json({ error: error.message }); throw error; }
  if (movement?.sourceBudgetId) return res.status(409).json({ error: "Esta factura se administra desde el presupuesto. Cambia su etapa para quitarla de Finanzas." });
  if (movement?.sourceOrderId) return res.status(409).json({ error: "Este gasto se genera automáticamente desde la orden de trabajo. Se actualiza o se quita solo si la OT deja de estar aprobada o vinculada a un proyecto." });
  if (movement?.sourcePurchaseOrderId) return res.status(409).json({ error: "Este gasto se genera automáticamente desde la orden de compra. Cambia su estado para quitarla de Finanzas." });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("DELETE FROM financial_movements WHERE id=$1", [req.params.id]);
    await db.query("DELETE FROM file_assets WHERE entity_type='financial' AND entity_id=$1", [req.params.id]);
    const updatedBudgets = movement?.kind === "income" ? await syncBudgetPaymentStatuses(movementBudgetIds(movement), db, req.user) : [];
    await auditChange({ entityType: "financial_movement", entityId: req.params.id, action: "delete", user: req.user, beforeData: { kind: movement?.kind, amountUsd: movement?.amountUsd, projectId: movement?.projectId || "", budgetId: movement?.budgetId || "" }, reason: String(req.body?.reason || "Eliminación solicitada desde la aplicación") }, db);
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
  const newId = `p-${crypto.randomUUID()}`;
  const assignee = body.assignee || null;                 // reasignar todas las tareas (opcional)
  if (assignee && !(await assigneeIsAllowed(assignee))) return res.status(400).json({ error: "El responsable seleccionado no admite asignación de tareas" });
  const resetStatus = body.resetStatus !== false;         // por defecto, arranca en "Por hacer"
  const allowedUsers = Array.isArray(body.allowedUsers) ? body.allowedUsers : (assignee ? [assignee] : (src.allowedUsers || []));
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const key = await uniqueProjectKey(body.key || src.key || "PRJ", db);
    const project = { ...src, id: newId, key, name: body.name || `${src.name} (copia)`, allowedUsers };
    await db.query("INSERT INTO projects(id,data,organization_id) VALUES($1,$2,$3)", [newId, project, req.user.organizationId]);
    const srcTasks = (await db.query("SELECT data FROM tasks WHERE data->>'project'=$1", [req.params.id])).rows.map((r) => r.data)
      .sort((a, b) => (parseInt(String(a.id).split("-")[1], 10) || 0) - (parseInt(String(b.id).split("-")[1], 10) || 0));
    const newTasks = [];
    let i = 1;
    for (const t of srcTasks) {
      const nt = { ...t, id: `${key}-${i}`, project: newId, color: project.color, activity: [], createdAt: new Date().toISOString() };
      if (assignee) nt.assignee = assignee;
      if (resetStatus) nt.status = "Por hacer";
      delete nt._updatedAt;
      await db.query("INSERT INTO tasks(id,data,organization_id) VALUES($1,$2,$3)", [nt.id, nt, req.user.organizationId]);
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
  const p = { ...(req.body || {}) }; if (!p.id) p.id = `sp-${crypto.randomUUID()}`;
  p.name = String(p.name || "").trim();
  if (!p.name) return res.status(400).json({ error: "El nombre del repuesto es obligatorio" });
  p.category = MATERIAL_LIST_DISCIPLINES.includes(p.category) ? p.category : "Otro";
  ["price", "cost"].forEach((k) => { if (p[k] !== undefined) p[k] = wholeMoneyValue(p[k]); });
  ["stock", "minStock"].forEach((k) => { if (p[k] !== undefined) p[k] = Number(p[k]) || 0; });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const inserted = (await db.query(
      "INSERT INTO parts(id,data,organization_id) VALUES($1,$2,$3) RETURNING data,organization_id",
      [p.id, p, req.user.organizationId],
    )).rows[0];
    if (!inserted || inserted.organization_id !== req.user.organizationId) throw new Error("El artículo no quedó asociado a la empresa activa");
    await auditChange({ entityType: "part", entityId: p.id, action: "create", user: req.user, afterData: { name: p.name, stock: p.stock, price: p.price, cost: p.cost } }, db);
    await db.query("COMMIT");
    res.status(201).json(inserted.data);
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "Ya existe un repuesto con ese identificador dentro de esta empresa" });
    throw error;
  } finally { db.release(); }
});
app.patch("/api/parts/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM parts WHERE id=$1 AND organization_id=$2", [req.params.id, req.user.organizationId]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  const patch = { ...(req.body || {}) };
  if (patch.category !== undefined) patch.category = MATERIAL_LIST_DISCIPLINES.includes(patch.category) ? patch.category : "Otro";
  ["price", "cost"].forEach((k) => { if (patch[k] !== undefined) patch[k] = wholeMoneyValue(patch[k]); });
  ["stock", "minStock"].forEach((k) => { if (patch[k] !== undefined) patch[k] = Math.max(0, Number(patch[k]) || 0); });
  const previous = rows[0].data;
  const requestedStock = patch.stock;
  delete patch.stock;
  const merged = { ...previous, ...patch, id: req.params.id };
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const updated = await db.query("UPDATE parts SET data=$2, updated_at=now() WHERE id=$1 AND organization_id=$3", [req.params.id, merged, req.user.organizationId]);
    if (!updated.rowCount) throw new Error("El artículo ya no existe en la empresa activa");
    let result = merged;
    if (requestedStock !== undefined) {
      const delta = requestedStock - (Number(previous.stock) || 0);
      if (delta) result = await adjustPartStock(req.params.id, delta, db, { movementType: "Ajuste manual", sourceType: "Inventario", sourceId: req.params.id, note: String(req.body?.stockAdjustmentReason || "Ajuste desde ficha de inventario"), userId: req.user.id });
      else result = { ...merged, stock: requestedStock };
    }
    await auditChange({ entityType: "part", entityId: req.params.id, action: "update", user: req.user, beforeData: { stock: previous.stock, price: previous.price, cost: previous.cost }, afterData: { stock: result.stock, price: result.price, cost: result.cost }, reason: String(req.body?.stockAdjustmentReason || "") }, db);
    await db.query("COMMIT");
    res.json(result);
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
});
app.delete("/api/parts/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  // Clientes y proveedores ya se protegían contra el borrado con registros vinculados; los
  // materiales no. Al borrar uno referenciado, adjustPartStock encuentra la fila vacía y sale sin
  // hacer nada: la OT se completa o la OC se recibe y el stock NO se mueve, sin error ni aviso.
  // Solo se bloquea cuando el movimiento de stock todavía está pendiente — las referencias
  // históricas ya se aplicaron y borrar el material no altera nada.
  const reference = JSON.stringify([{ partId: req.params.id }]);
  const [orders, purchases] = await Promise.all([
    pool.query("SELECT count(*)::int count FROM orders WHERE data->'materials' @> $1::jsonb AND data->>'stockDeductedAt' IS NULL AND organization_id=$2", [reference, req.user.organizationId]),
    pool.query("SELECT count(*)::int count FROM purchase_orders WHERE data->'items' @> $1::jsonb AND data->>'stockAppliedAt' IS NULL AND data->>'stage' <> 'Cancelada' AND organization_id=$2", [reference, req.user.organizationId]),
  ]);
  const pendingOrders = Number(orders.rows[0]?.count || 0);
  const pendingPurchases = Number(purchases.rows[0]?.count || 0);
  if (pendingOrders || pendingPurchases) {
    const detail = [pendingOrders ? `${pendingOrders} orden(es) de trabajo sin completar` : "", pendingPurchases ? `${pendingPurchases} orden(es) de compra sin recibir` : ""].filter(Boolean).join(" y ");
    return res.status(409).json({ error: `No se puede eliminar: el material figura en ${detail}. Al completarlas, su stock no se movería. Quitalo de esos documentos primero.` });
  }
  const movements = Number((await pool.query("SELECT count(*)::int count FROM stock_movements WHERE part_id=$1 AND organization_id=$2", [req.params.id, req.user.organizationId])).rows[0]?.count || 0);
  if (movements) return res.status(409).json({ error: `No se puede eliminar: el repuesto tiene ${movements} movimiento(s) históricos. Marcá el repuesto como inactivo para conservar la trazabilidad.` });
  const deleted = await pool.query("DELETE FROM parts WHERE id=$1 AND organization_id=$2 RETURNING id,data", [req.params.id, req.user.organizationId]);
  if (!deleted.rowCount) return res.status(404).json({ error: "No existe" });
  await auditChange({ entityType: "part", entityId: req.params.id, action: "delete", user: req.user, beforeData: { name: deleted.rows[0].data.name, stock: deleted.rows[0].data.stock } });
  res.status(204).end();
});

/* ------------------------------------------------ Órdenes (con reglas de montos por rol) ------------------------------------------------ */
const TEC_PATCH = ["signatureUrl", "signedAt", "signedBy", "noSignReason", "technicianSignatureUrl", "technicianSignedAt", "technicianSignedBy", "photos", "assetId", "equipo", "sintoma", "solucion", "category", "technical", "status", "location", "laborHours", "technicians", "contact", "materials", "suspendReason", "suspendedFromStatus", "suspendedAt", "resumedAt", "reopenReason", "reopenedAt", "recurrenceMonths", "recurrenceSpawnedId", "urgent"];
const MANAGEMENT_PATCH = ["assetId", "rate", "laborCost", "materials", "laborBillable", "status", "signatureUrl", "signedAt", "signedBy", "noSignReason", "technicianSignatureUrl", "technicianSignedAt", "technicianSignedBy", "quoteNumber", "customerPO", "tech", "techId", "assignedTechs", "assignedTechIds", "suspendReason", "suspendedFromStatus", "suspendedAt", "resumedAt", "reopenReason", "reopenedAt", "recurrenceMonths", "recurrenceSpawnedId", "urgent"];
const sanitizeAssignedTechs = (value) => Array.isArray(value) ? [...new Set(value.map((name) => String(name || "").trim()).filter(Boolean))].slice(0, 8) : [];
const sanitizeAssignedTechIds = (value) => Array.isArray(value) ? [...new Set(value.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 8) : [];

app.get("/api/orders", auth, requireOrdersAccess, async (req, res) => {
  const since = req.query.updated_since ? new Date(String(req.query.updated_since)) : null;
  if (since && !Number.isFinite(since.getTime())) return res.status(400).json({ error: "updated_since inválido" });
  const { rows } = since
    ? await pool.query("SELECT data, updated_at FROM orders WHERE updated_at>$1 AND organization_id=$2 ORDER BY updated_at", [since.toISOString(), req.user.organizationId])
    : await pool.query("SELECT data, updated_at FROM orders WHERE organization_id=$1 ORDER BY updated_at DESC", [req.user.organizationId]);
  const tec = isTec(req.user.role);
  // Un cliente corporativo ve el avance de sus proyectos, nada del negocio del proveedor. Se lo
  // excluye acá, al armar la respuesta, y no ocultando cosas en la interfaz: lo que no viaja no se
  // puede filtrar desde el navegador ni leer llamando la API a mano.
  const client = isClient(req.user.role);
  res.json(rows.filter((row) => !row.data.archivedAt && orderVisibleToUser(req.user, row.data)).map((row) => ({ ...(tec ? stripMoney(row.data) : row.data), _updatedAt: row.updated_at })));
});

app.post("/api/orders", auth, requireOrdersAccess, apiRateLimit(60), async (req, res) => {
  let o = { ...(req.body || {}) };
  const companyProfile = await loadCompanyProfile(req.user.organizationId);
  o.status = o.status || "Borrador";
  if (o.status === "En progreso") o.status = "En proceso de ejecución";
  o.assignedTechs = sanitizeAssignedTechs(o.assignedTechs);
  o.assignedTechIds = sanitizeAssignedTechIds(o.assignedTechIds);
  if (isTec(req.user.role)) {
    delete o.budgetId; delete o.budgetNumber; delete o.projectId; delete o.quoteNumber; delete o.customerPO;
    o.tech = req.user.name;
    o.techId = req.user.id;
    o.assignedTechs = [...new Set([req.user.name, ...o.assignedTechs])];
    o.assignedTechIds = [...new Set([req.user.id, ...o.assignedTechIds])];
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
  if (!o.clientId && o.client) {
    const matchedClient = (await pool.query("SELECT data FROM clients WHERE lower(trim(data->>'name'))=lower(trim($1)) LIMIT 1", [o.client])).rows[0]?.data;
    if (matchedClient) o.clientId = matchedClient.id;
  }
  await hydrateOrderAssignments(o);
  if (o.rate === undefined || o.rate === null || o.rate === "") o.rate = companyProfile.pricing.defaultHourlyRate;
  o.rate = normalizedRateValue(o.rate);
  if (o.laborCost === undefined || o.laborCost === null || o.laborCost === "") o.laborCost = companyProfile.pricing.defaultInternalHourlyCost;
  o.laborCost = wholeMoneyValue(o.laborCost);
  if (o.minimumBillableHours === undefined || o.minimumBillableHours === null || o.minimumBillableHours === "") o.minimumBillableHours = companyProfile.pricing.minimumBillableHours;
  o.technicians = Math.max(1, Math.round(Number(o.technicians) || 1));
  o.materials = await materialsFromInventory(o.materials);
  if (!o.id) {
    const year2 = String(new Date().getFullYear()).slice(-2);
    const tenantPrefix = req.user.organizationId === DEFAULT_ORGANIZATION_ID ? "" : `${String(req.user.organizationId).replace(/^org-/, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)}-`;
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
    const n = (await pool.query("SELECT count(*)::int c FROM orders WHERE id ~ $1", [`^OT-${tenantPrefix}${code}-([A-Z]{2,4}-)?(20)?${year2}-`])).rows[0].c + 1;
    // Si la orden queda vinculada a un presupuesto aprobado/facturado, el folio incorpora su número
    // como referencia directa (ej. OT-VTU-26-001-026367), para poder rastrearla sin abrirla.
    const budgetSuffix = o.budgetId ? String(o.quoteNumber || o.budgetNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    o.id = `OT-${tenantPrefix}${code}-${year2}-${String(n).padStart(3, "0")}${budgetSuffix ? `-${budgetSuffix}` : ""}`;
  }
  if (isTec(req.user.role)) {
    // El técnico nunca fija importes: la tarifa la define el servidor y Gerencia la ajusta después.
    o.rate = normalizedRateValue(companyProfile.pricing.defaultHourlyRate); o.currency = companyProfile.baseCurrency; o.laborBillable = true; o.laborCost = companyProfile.pricing.defaultInternalHourlyCost;
    if (Array.isArray(o.materials)) o.materials = o.materials.map((m) => ({ ...m, billable: true }));
    if (o.status === "Facturada") o.status = "Aprobada";
  }
  const chronologyErrors = timelineErrorsValue(o.technical);
  if (o.status !== "Borrador" && chronologyErrors.length) return res.status(400).json({ error: chronologyErrors.join(" ") });
  const businessErrors = orderBusinessErrors(o);
  if (businessErrors.length) return res.status(400).json({ error: businessErrors.join(" ") });
  o.billableHours = billableHoursValue(o);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    o = await externalizeOrderAssets(o, db, req.user.id);
    await db.query("INSERT INTO orders(id,data,organization_id) VALUES($1,$2,$3)", [o.id, o, req.user.organizationId]);
    await auditChange({ entityType: "order", entityId: o.id, action: "create", user: req.user, afterData: { status: o.status, client: o.client, projectId: o.projectId || "", assignedTechIds: o.assignedTechIds || [] } }, db);
    await db.query("COMMIT");
    res.json(isTec(req.user.role) ? stripMoney(o) : o);
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "El folio generado ya existe. Intenta guardar nuevamente." });
    if (error.code === "INVALID_ASSET") return res.status(413).json({ error: error.message });
    throw error;
  } finally { db.release(); }
});

app.patch("/api/orders/:id", auth, requireOrdersAccess, apiRateLimit(60), async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM orders WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  if (!orderVisibleToUser(req.user, rows[0].data)) return res.status(403).json({ error: "Esta orden está asignada a otro técnico" });
  let patch = req.body || {};
  if ("assignedTechs" in patch) patch.assignedTechs = sanitizeAssignedTechs(patch.assignedTechs);
  if ("assignedTechIds" in patch) patch.assignedTechIds = sanitizeAssignedTechIds(patch.assignedTechIds);
  if (isTec(req.user.role)) {
    const clean = {}; for (const k of TEC_PATCH) if (k in patch) clean[k] = patch[k];
    if (clean.status && !TECH_ORDER_STATUSES.has(clean.status)) delete clean.status;
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
  if (Array.isArray(patch.materials)) patch.materials = isTec(req.user.role) ? await materialsFromInventory(patch.materials, false, false) : patch.materials.map((material) => ({ ...material, price: wholeMoneyValue(material.price), cost: wholeMoneyValue(material.cost) }));
  const prev = rows[0].data;
  if (prev.stockDeductedAt && Array.isArray(patch.materials) && JSON.stringify(patch.materials) !== JSON.stringify(prev.materials || [])) {
    return res.status(409).json({ error: "Los materiales de una orden con stock ya aplicado no pueden cambiarse. Anulá la orden para revertir el movimiento y generá una nueva corrección trazable." });
  }
  let merged = { ...prev, ...patch };
  await hydrateOrderAssignments(merged);
  if (merged.client && (!merged.clientId || merged.client !== prev.client)) {
    const matchedClient = (await pool.query("SELECT data FROM clients WHERE lower(trim(data->>'name'))=lower(trim($1)) LIMIT 1", [merged.client])).rows[0]?.data;
    merged.clientId = matchedClient?.id || "";
  }
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
  // Orden, consumos, ledger, costo financiero y auditoría se confirman como una sola unidad.
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const locked = (await db.query("SELECT data FROM orders WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0]?.data;
    if (!locked) { await db.query("ROLLBACK"); return res.status(404).json({ error: "La orden ya no existe" }); }
    if (JSON.stringify(locked) !== JSON.stringify(prev)) { await db.query("ROLLBACK"); return res.status(409).json({ error: "La orden fue modificada por otro usuario. Recarga antes de guardar." }); }
    merged = await externalizeOrderAssets(merged, db, req.user.id);
    if (merged.status === "Completada" && prev.status !== "Completada" && !prev.stockDeductedAt) {
      for (const material of merged.materials || []) {
        if (material.billable && material.partId) await adjustPartStock(material.partId, -(Number(material.qty) || 0), db, { movementType: "Consumo", sourceType: "Orden de trabajo", sourceId: merged.id, userId: req.user.id });
      }
      merged.stockDeductedAt = new Date().toISOString();
    }
    await db.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
    const retainedAssetUrls = [merged.signatureUrl, merged.technicianSignatureUrl, ...(merged.photos || []).flatMap((photo) => [photo.url, photo.preview])].filter((value) => typeof value === "string" && value.startsWith("/api/files/"));
    await db.query("DELETE FROM file_assets WHERE entity_type='order' AND entity_id=$1 AND NOT (('/api/files/' || id) = ANY($2::text[]))", [merged.id, retainedAssetUrls]);
    if (merged.projectId || prev.projectId) await upsertOrderCostExpense(merged, db);
    await auditChange({ entityType: "order", entityId: merged.id, action: "update", user: req.user, beforeData: { status: prev.status, projectId: prev.projectId || "" }, afterData: { status: merged.status, projectId: merged.projectId || "", stockDeductedAt: merged.stockDeductedAt || "" }, reason: patch.reopenReason || patch.suspendReason || patch.technical?.timelineAdjustmentReason || "" }, db);
    await db.query("COMMIT");
    res.json(isTec(req.user.role) ? stripMoney(merged) : merged);
  } catch (error) {
    await db.query("ROLLBACK");
    if (["INSUFFICIENT_STOCK", "PART_NOT_FOUND"].includes(error.code)) return res.status(409).json({ error: error.message });
    if (error.code === "INVALID_ASSET") return res.status(413).json({ error: error.message });
    throw error;
  } finally { db.release(); }
});

app.post("/api/orders/:id/comment", auth, requireOrdersAccess, async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM orders WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  if (!orderVisibleToUser(req.user, rows[0].data)) return res.status(403).json({ error: "Esta orden está asignada a otro técnico" });
  const text = String((req.body || {}).text || "").trim();
  if (!text) return res.status(400).json({ error: "Comentario vacío" });
  const merged = { ...rows[0].data, activity: [...(rows[0].data.activity || []), { type: "comment", text, by: req.user.id, byName: req.user.name, at: new Date().toISOString() }] };
  await pool.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
  await auditChange({ entityType: "order", entityId: req.params.id, action: "comment", user: req.user, afterData: { commentAt: merged.activity.at(-1)?.at || "" } });
  res.json(isTec(req.user.role) ? stripMoney(merged) : merged);
});

app.delete("/api/orders/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const current = (await db.query("SELECT data FROM orders WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0]?.data;
    if (!current) { await db.query("ROLLBACK"); return res.status(404).json({ error: "No existe" }); }
    if (current.stockDeductedAt) {
      for (const material of current.materials || []) if (material.billable && material.partId) await adjustPartStock(material.partId, Number(material.qty) || 0, db, { movementType: "Reversión", sourceType: "Orden de trabajo anulada", sourceId: current.id, userId: req.user.id });
    }
    await db.query("DELETE FROM financial_movements WHERE data->>'sourceOrderId'=$1", [current.id]);
    const archived = { ...current, statusBeforeArchive: current.status, status: "Anulada", archivedAt: new Date().toISOString(), archivedBy: req.user.id };
    await db.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [current.id, archived]);
    await auditChange({ entityType: "order", entityId: current.id, action: "archive", user: req.user, beforeData: { status: current.status, stockDeductedAt: current.stockDeductedAt || "" }, afterData: { status: "Anulada", archivedAt: archived.archivedAt }, reason: String(req.body?.reason || "Anulación solicitada desde la aplicación") }, db);
    await db.query("COMMIT");
    res.status(204).end();
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
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
    ? await pool.query("SELECT data, updated_at FROM tasks WHERE updated_at>$1 AND organization_id=$2 ORDER BY updated_at", [since.toISOString(), req.user.organizationId])
    : await pool.query("SELECT data, updated_at FROM tasks WHERE organization_id=$1 ORDER BY updated_at DESC", [req.user.organizationId]);
  // Mismo cálculo que en /api/bootstrap: sin esto, el aviso de comentario nuevo quedaría congelado
  // en el estado que tenía al abrir la app y no se apagaría al leerlo el resto del equipo.
  const pendingCommentTaskIds = new Set(
    (await pool.query("SELECT DISTINCT link FROM notifications WHERE read=false AND link LIKE 'task:%'")).rows
      .map((row) => String(row.link).slice(5)));
  const tasks = rows.map((row) => ({ ...row.data, _updatedAt: row.updated_at, _unreadComment: pendingCommentTaskIds.has(row.data?.id) }));
  // Igual que en /api/bootstrap: técnicos (campo u oficina) y monitores solo ven tareas de los
  // proyectos que el administrador les habilitó explícitamente (allowedUsers).
  if (!isProjectScoped(req.user.role)) return res.json(tasks);
  const allowedProjectIds = new Set((await pool.query("SELECT id FROM projects WHERE data->'allowedUsers' ? $1", [req.user.id])).rows.map((row) => row.id));
  res.json(tasks.filter((t) => allowedProjectIds.has(t.project)));
});
app.post("/api/tasks", auth, requireProjectWrite, async (req, res) => {
  const t = { ...(req.body || {}) }; if (!t.id) t.id = `T-${crypto.randomUUID()}`;
  t.title = String(t.title || "").trim();
// La descripción admite formato (negrita, cursiva, listas, color) y se sanea acá: es el único  // punto por el que puede entrar, tanto del alta como de la edición.  if (t.desc !== undefined) t.desc = sanitizeRichText(t.desc);
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
  await pool.query("INSERT INTO tasks(id,data,organization_id) VALUES($1,$2,$3)", [t.id, t, req.user.organizationId]);
  await auditChange({ entityType: "task", entityId: t.id, action: "create", user: req.user, afterData: { project: t.project, status: t.status, assignee: t.assignee } });
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
  // Misma sanitización que en el alta: la edición es la otra vía por la que entra HTML.
  if (patch.desc !== undefined) patch.desc = sanitizeRichText(patch.desc);
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
  await auditChange({ entityType: "task", entityId: req.params.id, action: "update", user: req.user, beforeData: { project: prev.project, status: prev.status, assignee: prev.assignee }, afterData: { project: merged.project, status: merged.status, assignee: merged.assignee } });
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
  await auditChange({ entityType: "task", entityId: req.params.id, action: "comment", user: req.user, afterData: { commentLength: text.length } });
  // Avisa a todo el equipo del proyecto, no sólo al responsable: un comentario suele ser una
  // consulta o un hallazgo que alguien más tiene que ver, y limitarlo al responsable hacía que el
  // resto se enterara sólo si entraba a la tarea por casualidad.
  //
  // Entran: responsable, participantes, quienes tengan el proyecto asignado (allowedUsers) y la
  // administración, que ve todos los proyectos. Quedan fuera:
  //  · quien comenta, que no necesita avisarse a sí mismo;
  //  · los monitores, que son pantallas de TV y no leen notificaciones;
  //  · los clientes corporativos, porque un comentario interno puede contener discusión del equipo
  //    que no corresponde mostrarle a la empresa contratante.
  const projectRow = (await pool.query("SELECT data FROM projects WHERE id=$1", [merged.project])).rows[0];
  const candidates = new Set([
    merged.assignee,
    ...(Array.isArray(merged.participants) ? merged.participants : []),
    ...(Array.isArray(projectRow?.data?.allowedUsers) ? projectRow.data.allowedUsers : []),
  ].filter(Boolean));
  const staff = (await pool.query("SELECT id, role FROM users WHERE active=true")).rows;
  staff.forEach((user) => { if (["admin", "gerente"].includes(user.role)) candidates.add(user.id); });
  const roleById = new Map(staff.map((user) => [user.id, user.role]));
  // Menciones con @: quien es nombrado recibe aviso aunque no tenga la tarea ni el proyecto
  // asignados. Es el sentido de mencionar a alguien — convocarlo a algo donde no estaba.
  const named = new Set();
  const namesRow = (await pool.query("SELECT id, name FROM users WHERE active=true")).rows;
  namesRow.forEach((user) => {
    // Se compara sobre el texto en minúsculas para que "@augusto roldan" y "@Augusto Roldan" valgan
    // igual. El nombre completo evita que "@ana" enganche a "Ana" y a "Mariana" a la vez.
    if (text.toLowerCase().includes(`@${String(user.name).toLowerCase()}`)) named.add(user.id);
  });
  named.forEach((id) => candidates.add(id));
  const recipients = [...candidates].filter((id) => id !== req.user.id && roleById.has(id)
    && !isMonitor(roleById.get(id)) && !isClient(roleById.get(id)));
  const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  // A quien fue mencionado se le dice explícitamente: en una bandeja con varios avisos, "te mencionó"
  // separa lo que requiere su respuesta de lo que es sólo seguimiento del equipo.
  for (const id of recipients) await notify(id, `${req.user.name} ${named.has(id) ? "te mencionó" : "comentó"} en ${merged.id}: ${preview}`, "task:" + merged.id);
  res.json(merged);
});
app.delete("/api/tasks/:id", auth, requireRole("admin", "gerente", "tecnico", "tecnico_oficina"), async (req, res) => {
  // Un técnico borra sólo lo suyo: la tarea tiene que estar en un proyecto que tenga asignado y
  // además estar a su cargo. Al crear, el alta le fija assignee = él mismo, así que esto cubre
  // exactamente lo que puede generar, sin habilitarlo a borrar el trabajo de un compañero ni una
  // tarea que le bajó gerencia. Los monitores no entran acá: son de sólo visualización.
  if (isProjectScoped(req.user.role)) {
    const existing = (await pool.query("SELECT data FROM tasks WHERE id=$1", [req.params.id])).rows[0]?.data;
    if (!existing) return res.status(404).json({ error: "No existe" });
    if (!(await tecCanProject(req.user, existing.project))) return res.status(403).json({ error: "Sin acceso a ese proyecto" });
    if (existing.assignee !== req.user.id) return res.status(403).json({ error: "Sólo podés eliminar tareas que tengas a tu cargo" });
  }
  const deleted = await pool.query("DELETE FROM tasks WHERE id=$1 RETURNING data", [req.params.id]);
  if (!deleted.rowCount) return res.status(404).json({ error: "No existe" });
  await auditChange({ entityType: "task", entityId: req.params.id, action: "delete", user: req.user, beforeData: { project: deleted.rows[0].data.project, status: deleted.rows[0].data.status, assignee: deleted.rows[0].data.assignee } });
  res.status(204).end();
});

/* ------------------------------------------------ Usuarios (solo Admin) ------------------------------------------------ */
app.post("/api/users", auth, requireRole("admin"), async (req, res) => {
  const { name, email, role, color, password } = req.body || {};
  const cleanName = String(name || "").trim(); const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanName || !cleanEmail || !password) return res.status(400).json({ error: "Nombre, correo y contraseña inicial son obligatorios" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: "El correo no es válido" });
  if (role !== undefined && !VALID_ROLES.has(role)) return res.status(400).json({ error: "Rol inválido" });
  if (String(password).length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
  const id = `u-${crypto.randomUUID()}`;
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
  await auditChange({ entityType: "user", entityId: id, action: "create", user: req.user, afterData: { name: cleanName, email: cleanEmail, role: role || "tecnico", active: true } });
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
  // El nombre pasó a ser editable desde el directorio de empleados, así que se valida acá: es el
  // rótulo con el que la persona aparece en órdenes, tareas y reportes, y en blanco dejaría filas
  // anónimas imposibles de atribuir.
  // Se rechaza explícitamente en vez de descartar la foto en silencio: si el usuario eligió una
  // imagen y la respuesta viniera OK sin haberla guardado, no habría forma de entender qué pasó.
  if (req.body?.photoDataUrl && String(req.body.photoDataUrl).length > PROFILE_PHOTO_MAX_CHARS) return res.status(400).json({ error: "La foto de perfil es demasiado grande. Usá una imagen más liviana." });
  if (name !== undefined) {
    const cleanName = String(name).trim().slice(0, 80);
    if (!cleanName) return res.status(400).json({ error: "El nombre no puede quedar vacío" });
    sets.push(`name=$${i++}`); vals.push(cleanName);
  }
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
  await auditChange({ entityType: "user", entityId: req.params.id, action: "update", user: req.user, beforeData: { role: target.role, active: target.active }, afterData: { role: rows[0].role, active: rows[0].active }, reason: password ? "Incluye restablecimiento de contraseña" : "" });
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
    const assignedOrders = (await db.query("SELECT id,data FROM orders WHERE data->>'techId'=$1 OR data->'assignedTechIds' ? $1", [req.params.id])).rows;
    for (const row of assignedOrders) {
      const assignedTechIds = (row.data.assignedTechIds || []).filter((id) => id !== req.params.id);
      const order = { ...row.data, assignedTechIds, formerAssignedTechnician: target.name };
      if (order.techId === req.params.id) order.techId = "";
      await db.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [row.id, order]);
    }
    const projects = (await db.query("SELECT id,data FROM projects WHERE data->'allowedUsers' ? $1", [req.params.id])).rows;
    for (const row of projects) await db.query("UPDATE projects SET data=$2, updated_at=now() WHERE id=$1", [row.id, { ...row.data, allowedUsers: (row.data.allowedUsers || []).filter((id) => id !== req.params.id) }]);
    await db.query("DELETE FROM notifications WHERE user_id=$1", [req.params.id]);
    await auditChange({ entityType: "user", entityId: req.params.id, action: "delete", user: req.user, beforeData: { name: target.name, role: target.role, active: target.active }, reason: String(req.body?.reason || "Eliminación solicitada desde la aplicación") }, db);
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
  if (error?.code === "FINANCE_PERIOD_LOCKED") return res.status(409).json({ error: error.message });
  return res.status(500).json({ error: "Ocurrió un error interno. Intenta nuevamente." });
});

/* ------------------------------------------------ Frontend estático (SPA) ------------------------------------------------ */
const dist = path.join(__dirname, "public");
app.use(express.static(dist, {
  etag: true,
  setHeaders(res, filePath) {
    if (/[/\\]assets[/\\].*-[A-Za-z0-9_-]{8,}\./.test(filePath)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    else if (/\.(?:html|webmanifest)$/i.test(filePath)) res.setHeader("Cache-Control", "no-cache");
  },
}));
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

async function runOrganizationDailyDigest(organizationId) {
 return tenantContext.run({ organizationId }, async () => {
  const today = arDayKey();
  // El marcado es atómico y va ANTES de notificar: si dos instancias arrancan a la vez, solo una
  // gana el UPDATE y la otra sale sin mandar nada. Un resumen perdido es preferible a uno doble.
  const claimed = await pool.query(
    `INSERT INTO app_settings(key, value, updated_at) VALUES($1, $2, now())
     ON CONFLICT(organization_id,key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
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
  // Saldo abierto de una factura, en bruto: es lo que falta que entre, IVA incluido.
  const invoiceOpenBalance = (movement) => {
    const gross = Number(movement.grossAmountUsd) || ((Number(movement.amountUsd) || 0) + (Number(movement.vatAmountUsd) || 0));
    return gross - (collectedByInvoice[movement.id] || 0);
  };
  const isOpenInvoice = (movement) => movement.kind === "invoice" && movement.dueDate && invoiceOpenBalance(movement) > 0.01;
  const overdueInvoices = movements.filter((movement) => isOpenInvoice(movement) && movement.dueDate < today);
  // Aviso anticipado de cobranza: siete días antes del vencimiento pactado. Antes sólo se avisaba
  // cuando la factura ya estaba vencida, o sea cuando reclamar ya llegaba tarde. La ventana incluye
  // hoy, así que una factura que vence hoy también entra; deja de avisarse recién cuando se cobra o
  // cuando pasa a vencida y la toma el aviso de arriba.
  const invoiceDueLimit = new Date(arDate().getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const upcomingInvoices = movements.filter((movement) => isOpenInvoice(movement) && movement.dueDate >= today && movement.dueDate <= invoiceDueLimit);
  const upcomingInvoicesTotal = Math.round(upcomingInvoices.reduce((sum, movement) => sum + invoiceOpenBalance(movement), 0) * 100) / 100;
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
      if (upcomingInvoices.length) parts.push(`${upcomingInvoices.length} factura(s) por cobrar en 7 días (USD ${upcomingInvoicesTotal.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
    }
    if (!parts.length) continue; // a quien no tiene nada pendiente no se le escribe
    await notify(user.id, `Resumen de hoy: ${parts.join(" · ")}.`, null);
    sent++;
  }
  console.log(`Resumen diario ${today}: ${sent} notificación(es).`);
  return sent;
 });
}

async function runDailyDigest() {
  const organizations = (await pool.query("SELECT id FROM organizations WHERE active=true ORDER BY id")).rows;
  let sent = 0;
  for (const organization of organizations) sent += await runOrganizationDailyDigest(organization.id);
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
  .then(() => migrateLegacyDataAssets())
  .then(() => app.listen(PORT, () => { console.log(`MiOrdenGo API + web escuchando en :${PORT}`); scheduleDailyDigest(); }))
  .catch((e) => { console.error("Error iniciando la base de datos:", e); process.exit(1); });
