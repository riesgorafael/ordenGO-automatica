import express from "express";
import cors from "cors";
import pkg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || "cambia-esto-en-produccion";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.disable("x-powered-by");
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
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()");
  next();
});
app.use(express.json({ limit: "12mb" }));

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
function loginRateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = loginAttempts.get(key);
  const entry = !current || now - current.startedAt > LOGIN_WINDOW_MS ? { count: 0, startedAt: now } : current;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) return res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos e inténtalo nuevamente." });
  entry.count += 1;
  loginAttempts.set(key, entry);
  req.loginAttemptKey = key;
  next();
}

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
    CREATE TABLE IF NOT EXISTS app_settings ( key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now());
  `);
  // Migración idempotente para instalaciones existentes
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS mustchangepassword boolean DEFAULT false;");

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@empresa.com").toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || "admin1234";
  const demoPass = process.env.DEMO_PASSWORD || "ordengo123";
  const monitorEmail = (process.env.MONITOR_EMAIL || "monitor.oficina@empresa.com").toLowerCase();
  const monitorPass = process.env.MONITOR_PASSWORD || demoPass;

  if ((await pool.query("SELECT count(*)::int n FROM users")).rows[0].n === 0) {
    const seed = [
      { id: "u1", name: "Administrador", email: adminEmail, role: "admin", color: "#6366f1", pass: adminPass },
      { id: "u2", name: "Ana Gómez", email: "ana@empresa.com", role: "gerente", color: "#0ea5e9", pass: demoPass },
      { id: "u3", name: "Luis Mora", email: "luis@empresa.com", role: "tecnico", color: "#10b981", pass: demoPass },
      { id: "u4", name: "María Ruiz", email: "maria@empresa.com", role: "tecnico", color: "#f59e0b", pass: demoPass },
      { id: "u-monitor-oficina", name: "Monitor Oficina", email: monitorEmail, role: "monitor_oficina", color: "#14b8a6", pass: monitorPass },
    ];
    for (const u of seed)
      await pool.query("INSERT INTO users(id,name,email,password_hash,role,color) VALUES($1,$2,$3,$4,$5,$6)",
        [u.id, u.name, u.email.toLowerCase(), bcrypt.hashSync(u.pass, 10), u.role, u.color]);
    console.log("→ Usuarios sembrados. Admin:", adminEmail);
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

    const tasks = [
      { id: "AUT-1", project: "p1", title: "Programar PLC de línea de llenado", assignee: "u3", status: "En progreso", priority: "Alta", type: "Tarea", due: "2026-07-25", desc: "Lógica de arranque/paro y enclavamientos." },
      { id: "AUT-2", project: "p1", title: "Diseñar HMI de operador", assignee: "u4", status: "Por hacer", priority: "Media", type: "Historia", due: "2026-07-30", desc: "Pantallas de proceso y alarmas." },
      { id: "SCADA-2", project: "p2", title: "Configurar servidor OPC UA", assignee: "u3", status: "En progreso", priority: "Alta", type: "Tarea", due: "2026-07-28", desc: "Conexión con PLCs Siemens y Rockwell." },
      { id: "MANT-2", project: "p3", title: "Calibrar instrumentos de campo", assignee: "u4", status: "Por hacer", priority: "Alta", type: "Tarea", due: "2026-07-24", desc: "Presión, temperatura y flujo." },
    ];
    for (const t of tasks) await pool.query("INSERT INTO tasks(id,data) VALUES($1,$2)", [t.id, t]);

    const orders = [
      { id: "OT-2026-014", client: "Embotelladora Andina", site: "Línea de llenado 3", contact: "Ing. Salazar", service: "Mantenimiento correctivo", date: "2026-07-15", equipo: "Variador de frecuencia banda 3", sintoma: "Sobrecorriente intermitente", solucion: "Reemplazo de ventilador de disipador.", category: "Sobrecalentamiento", photos: [], signatureUrl: null, signedBy: "", laborHours: 3.5, technicians: 1, rate: 50, laborBillable: true, materials: [{ name: "Ventilador disipador VFD", qty: 1, price: 1200, billable: true }], status: "Completada", tech: "Luis Mora" },
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
}

/* ------------------------------------------------ Helpers ------------------------------------------------ */
const pubUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, color: u.color, active: u.active, mustChangePassword: u.mustchangepassword || false });
const wholeMoneyValue = (value) => Math.max(0, Math.round(Number(value) || 0));
const normalizedRateValue = (value) => { const rate = wholeMoneyValue(value); return !rate || rate === 850 ? 50 : rate; };
const billableHoursValue = (order, now = Date.now()) => {
  const effective = Math.max(0, Number(order?.laborHours) || 0);
  const waiting = Math.max(0, Number(order?.technical?.billableWaitMinutes) || 0) / 60;
  const arrival = order?.technical?.arrivalAt ? new Date(order.technical.arrivalAt).getTime() : NaN;
  const end = order?.technical?.completedAt ? new Date(order.technical.completedAt).getTime() : now;
  const onSiteMs = Number.isFinite(arrival) && Number.isFinite(end) ? Math.max(0, end - arrival) : 0;
  return onSiteMs > 0 && onSiteMs < 3600000 ? 2 : Math.round((effective + waiting) * 100) / 100;
};
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
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: "Sin token" });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); } catch { res.status(401).json({ error: "Token inválido" }); }
}
const requireRole = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: "No autorizado" });
// Roles "técnicos" (campo u oficina): nunca ven importes ni el estado "Facturada"
const isTec = (r) => r === "tecnico" || r === "tecnico_oficina";
const isMonitor = (r) => r === "monitor_oficina";
const isProjectScoped = (r) => isTec(r) || isMonitor(r);
const requireOrdersAccess = (req, res, next) => (req.user.role === "tecnico_oficina" || isMonitor(req.user.role)) ? res.status(403).json({ error: "Este perfil no tiene acceso a órdenes de trabajo" }) : next();
const requireProjectWrite = (req, res, next) => isMonitor(req.user.role) ? res.status(403).json({ error: "Monitor Oficina tiene acceso de solo visualización" }) : next();
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

/* ------------------------------------------------ Auth ------------------------------------------------ */
app.post("/api/auth/login", loginRateLimit, async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [String(email || "").toLowerCase()]);
  const u = rows[0];
  if (!u || !u.active || !bcrypt.compareSync(password || "", u.password_hash))
    return res.status(401).json({ error: "Correo o contraseña inválidos" });
  loginAttempts.delete(req.loginAttemptKey);
  const token = jwt.sign({ id: u.id, role: u.role, name: u.name }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: pubUser(u) });
});

/* Cada usuario cambia su propia contraseña */
app.post("/api/me/password", auth, async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 6) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres" });
  const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [req.user.id]);
  const u = rows[0];
  if (!u || !bcrypt.compareSync(current || "", u.password_hash)) return res.status(400).json({ error: "La contraseña actual es incorrecta" });
  await pool.query("UPDATE users SET password_hash=$2, mustchangepassword=false WHERE id=$1", [u.id, bcrypt.hashSync(next, 10)]);
  res.json({ ok: true });
});

/* ------------------------------------------------ Bootstrap (carga inicial) ------------------------------------------------ */
app.get("/api/bootstrap", auth, async (req, res) => {
  const tec = isTec(req.user.role);
  const [me, u, cl, pr, bu, fi, or, ta, no, pa] = await Promise.all([
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
  ]);
  const partOut = (p) => tec ? { id: p.id, name: p.name, unit: p.unit } : p;
  const allProjects = pr.rows.map((r) => r.data);
  // Técnicos y monitores solo ven los proyectos que el administrador les habilitó.
  const scoped = isProjectScoped(req.user.role);
  const canSeeProject = (p) => !scoped || (Array.isArray(p.allowedUsers) && p.allowedUsers.includes(req.user.id));
  const visibleProjects = allProjects.filter(canSeeProject);
  const allowedProjectIds = new Set(visibleProjects.map((p) => p.id));
  res.json({
    me: pubUser(me.rows[0]),
    users: u.rows.map(pubUser),
    clients: cl.rows.map((r) => r.data),
    projects: visibleProjects,
    budgets: tec || isMonitor(req.user.role) ? [] : bu.rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })),
    finances: tec || isMonitor(req.user.role) ? [] : fi.rows.map((r) => {
      const { attachmentUrl, ...summary } = r.data;
      return { ...summary, hasAttachment: Boolean(attachmentUrl), _updatedAt: r.updated_at };
    }),
    orders: (req.user.role === "tecnico_oficina" || isMonitor(req.user.role)) ? [] : or.rows.map((r) => ({ ...(tec ? stripMoney(r.data) : r.data), _updatedAt: r.updated_at })),
    tasks: ta.rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })).filter((t) => !scoped || allowedProjectIds.has(t.project)),
    notifications: no.rows.map((n) => ({ id: n.id, text: n.text, link: n.link, read: n.read, at: n.created_at })),
    parts: pa.rows.map((r) => partOut(r.data)),
  });
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

/* ------------------------------------------------ Clientes ------------------------------------------------ */
app.post("/api/clients", auth, requireProjectWrite, async (req, res) => {
  const c = { ...(req.body || {}) };
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
  await pool.query("INSERT INTO clients(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2", [c.id, c]);
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
  await pool.query("UPDATE clients SET data=$2 WHERE id=$1", [req.params.id, merged]);
  res.json(merged);
});
app.delete("/api/clients/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  await pool.query("DELETE FROM clients WHERE id=$1", [req.params.id]);
  res.status(204).end();
});

/* ------------------------------------------------ Proyectos ------------------------------------------------ */
app.post("/api/projects", auth, requireRole("admin", "gerente"), async (req, res) => {
  const p = req.body || {}; if (!p.id) p.id = "p" + Date.now();
  if (!Array.isArray(p.allowedUsers)) {
    const monitors = (await pool.query("SELECT id FROM users WHERE active=true AND role='monitor_oficina'")).rows.map((row) => row.id);
    p.allowedUsers = monitors;
  }
  await pool.query("INSERT INTO projects(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2", [p.id, p]);
  res.json(p);
});
app.patch("/api/projects/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM projects WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  const merged = { ...rows[0].data, ...(req.body || {}), id: req.params.id };
  await pool.query("UPDATE projects SET data=$2 WHERE id=$1", [req.params.id, merged]);
  res.json(merged);
});
app.delete("/api/projects/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  // Elimina el proyecto y sus tareas asociadas
  await pool.query("DELETE FROM tasks WHERE data->>'project' = $1", [req.params.id]);
  await pool.query("DELETE FROM projects WHERE id=$1", [req.params.id]);
  res.status(204).end();
});

/* ------------------------------------------------ Presupuestos ------------------------------------------------ */
const BUDGET_STAGES = ["Borrador", "En preparación", "Enviado", "En seguimiento", "Aprobado", "Rechazado"];
const normalizeBudget = (input, previous = {}) => {
  const budget = { ...previous, ...(input || {}) };
  delete budget._updatedAt;
  budget.currency = "USD";
  budget.stage = BUDGET_STAGES.includes(budget.stage) ? budget.stage : "Borrador";
  budget.probability = Math.min(100, Math.max(0, Math.round(Number(budget.probability) || 0)));
  budget.durationDays = Math.max(0, Math.round(Number(budget.durationDays) || 0));
  budget.teamSize = Math.max(1, Math.round(Number(budget.teamSize) || 1));
  budget.items = Array.isArray(budget.items) ? budget.items.map((item) => ({
    ...item,
    qty: Math.max(0, Number(item.qty) || 0),
    unitPrice: Math.max(0, Number(item.unitPrice) || 0),
    unitCost: Math.max(0, Number(item.unitCost) || 0),
  })) : [];
  budget.amount = Math.round(budget.items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0) * 100) / 100;
  budget.estimatedCost = Math.round(budget.items.reduce((sum, item) => sum + item.qty * item.unitCost, 0) * 100) / 100;
  return budget;
};

app.post("/api/budgets", auth, requireRole("admin", "gerente"), async (req, res) => {
  const budget = normalizeBudget(req.body);
  if (!String(budget.client || "").trim() || !String(budget.title || "").trim()) return res.status(400).json({ error: "Cliente y nombre del presupuesto son obligatorios." });
  if (!budget.id) {
    const year = new Date().getFullYear();
    const rows = (await pool.query("SELECT id FROM budgets WHERE id LIKE $1", [`PRES-${year}-%`])).rows;
    const next = Math.max(0, ...rows.map((row) => Number(String(row.id).split("-").pop()) || 0)) + 1;
    budget.id = `PRES-${year}-${String(next).padStart(3, "0")}`;
  }
  budget.createdAt = budget.createdAt || new Date().toISOString();
  budget.activity = [...(budget.activity || []), { type: "created", text: "Presupuesto creado", by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  await pool.query("INSERT INTO budgets(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2, updated_at=now()", [budget.id, budget]);
  res.json(budget);
});

app.patch("/api/budgets/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const current = (await pool.query("SELECT data FROM budgets WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!current) return res.status(404).json({ error: "No existe" });
  const budget = normalizeBudget(req.body, current);
  budget.id = req.params.id;
  const changes = [];
  if (budget.stage !== current.stage) changes.push(`Estado: ${current.stage} → ${budget.stage}`);
  if (budget.nextFollowUp !== current.nextFollowUp || budget.nextAction !== current.nextAction) changes.push("Seguimiento actualizado");
  if (!changes.length) changes.push("Presupuesto actualizado");
  budget.activity = [...(current.activity || []), { type: "update", text: changes.join(" · "), by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  if (budget.stage === "Enviado" && !budget.sentAt) budget.sentAt = new Date().toISOString();
  if (budget.stage === "Aprobado" && !budget.approvedAt) budget.approvedAt = new Date().toISOString();
  await pool.query("UPDATE budgets SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, budget]);
  if (budget.stage === "Aprobado" && budget.projectId) {
    const project = (await pool.query("SELECT data FROM projects WHERE id=$1", [budget.projectId])).rows[0]?.data;
    if (project) {
      const linkedProject = { ...project, budgetId: budget.id, clientId: budget.clientId || project.clientId || "", client: budget.client || project.client || "", site: budget.site || project.site || "" };
      await pool.query("UPDATE projects SET data=$2, updated_at=now() WHERE id=$1", [budget.projectId, linkedProject]);
      const financeLink = JSON.stringify({ budgetId: budget.id, budgetTitle: budget.title || "", clientId: linkedProject.clientId, clientName: linkedProject.client, linkageSource: "approved-project-budget", linkedAt: new Date().toISOString() });
      await pool.query("UPDATE financial_movements SET data=data || $2::jsonb, updated_at=now() WHERE data->>'kind'='expense' AND data->>'projectId'=$1", [budget.projectId, financeLink]);
    }
  }
  res.json(budget);
});

app.delete("/api/budgets/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  await pool.query("DELETE FROM budgets WHERE id=$1", [req.params.id]);
  res.status(204).end();
});

app.post("/api/budgets/:id/convert", auth, requireRole("admin", "gerente"), async (req, res) => {
  const budget = (await pool.query("SELECT data FROM budgets WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!budget) return res.status(404).json({ error: "No existe" });
  if (budget.projectId) {
    const existing = (await pool.query("SELECT data FROM projects WHERE id=$1", [budget.projectId])).rows[0]?.data;
    return res.json({ budget, project: existing });
  }
  const projectId = "p" + Date.now();
  const rawKey = String(req.body?.key || budget.title || "PRJ").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const key = rawKey || "PRJ";
  const monitors = (await pool.query("SELECT id FROM users WHERE active=true AND role='monitor_oficina'")).rows.map((row) => row.id);
  const project = { id: projectId, key, name: budget.title, color: req.body?.color || "#F18700", allowedUsers: monitors, budgetId: budget.id, clientId: budget.clientId || "", client: budget.client, site: budget.site || "", plannedStart: budget.plannedStart || "", plannedEnd: budget.plannedEnd || "", estimatedAmount: budget.amount, currency: "USD" };
  await pool.query("INSERT INTO projects(id,data) VALUES($1,$2)", [projectId, project]);
  const updated = { ...budget, stage: "Aprobado", probability: 100, projectId, approvedAt: budget.approvedAt || new Date().toISOString(), activity: [...(budget.activity || []), { type: "converted", text: `Convertido en proyecto ${key}`, by: req.user.id, byName: req.user.name, at: new Date().toISOString() }] };
  await pool.query("UPDATE budgets SET data=$2, updated_at=now() WHERE id=$1", [budget.id, updated]);
  res.json({ budget: updated, project });
});

/* ------------------------------------------------ Finanzas ------------------------------------------------ */
const FINANCE_KINDS = ["expense", "income"];
const FINANCE_CURRENCIES = ["ARS", "USD", "EUR"];
let bnaRateCache = null;
app.get("/api/exchange-rates/bna", auth, requireRole("admin", "gerente"), async (_req, res) => {
  if (bnaRateCache && Date.now() - bnaRateCache.cachedAt < 15 * 60 * 1000) return res.json(bnaRateCache.data);
  try {
    const response = await fetch("https://monedapi.ar/api/v2/usd/bna", { headers: { Accept: "application/json", "User-Agent": "OrdenGO/1.0" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const quote = await response.json();
    const sell = Number(quote.sell);
    if (!(sell > 0)) throw new Error("Cotización inválida");
    const data = { currency: "USD", arsPerUsd: sell, buy: Number(quote.buy) || null, sell, updatedAt: quote.updatedAt || new Date().toISOString(), source: "Banco de la Nación Argentina", sourceUrl: "https://www.bna.com.ar/Personas" };
    bnaRateCache = { cachedAt: Date.now(), data };
    res.json(data);
  } catch (error) {
    if (bnaRateCache?.data) return res.json({ ...bnaRateCache.data, stale: true });
    res.status(503).json({ error: "No fue posible obtener la cotización vendedor del dólar BNA. Intenta nuevamente." });
  }
});
const normalizeFinancialMovement = (input, previous = {}) => {
  const movement = { ...previous, ...(input || {}) };
  delete movement._updatedAt;
  movement.kind = FINANCE_KINDS.includes(movement.kind) ? movement.kind : "expense";
  movement.currency = FINANCE_CURRENCIES.includes(movement.currency) ? movement.currency : "USD";
  movement.amount = Math.max(0, Number(movement.amount) || 0);
  movement.exchangeRate = movement.currency === "USD" ? 1 : Math.max(0, Number(movement.exchangeRate) || 0);
  movement.amountUsd = movement.currency === "USD" ? movement.amount : movement.exchangeRate > 0 ? movement.amount / movement.exchangeRate : 0;
  movement.amountUsd = Math.round(movement.amountUsd * 1000000) / 1000000;
  return movement;
};

const applyApprovedBudgetLink = async (movement) => {
  if (movement.kind !== "expense" || !movement.projectId) return movement;
  const project = (await pool.query("SELECT data FROM projects WHERE id=$1", [movement.projectId])).rows[0]?.data;
  if (!project) return movement;
  let budget = null;
  if (project.budgetId) budget = (await pool.query("SELECT data FROM budgets WHERE id=$1", [project.budgetId])).rows[0]?.data || null;
  if (!budget || budget.stage !== "Aprobado") budget = (await pool.query("SELECT data FROM budgets WHERE data->>'projectId'=$1 AND data->>'stage'='Aprobado' ORDER BY updated_at DESC LIMIT 1", [movement.projectId])).rows[0]?.data || null;
  movement.clientId = project.clientId || budget?.clientId || movement.clientId || "";
  movement.clientName = project.client || budget?.client || movement.clientName || "";
  if (budget?.stage === "Aprobado") {
    movement.budgetId = budget.id;
    movement.budgetTitle = budget.title || "";
    movement.linkageSource = "approved-project-budget";
    movement.linkedAt = movement.linkedAt || new Date().toISOString();
  } else {
    movement.budgetId = "";
    movement.budgetTitle = "";
    movement.linkageSource = "project-without-approved-budget";
  }
  return movement;
};

app.post("/api/finances", auth, requireRole("admin", "gerente"), async (req, res) => {
  const movement = await applyApprovedBudgetLink(normalizeFinancialMovement(req.body));
  if (!String(movement.concept || "").trim() || movement.amount <= 0 || !movement.date) return res.status(400).json({ error: "Concepto, importe y fecha son obligatorios." });
  if (movement.currency !== "USD" && !movement.exchangeRate) return res.status(400).json({ error: "Indica el tipo de cambio para calcular el equivalente en USD." });
  if (!movement.id) {
    const year = new Date().getFullYear();
    const rows = (await pool.query("SELECT id FROM financial_movements WHERE id LIKE $1", [`MOV-${year}-%`])).rows;
    const next = Math.max(0, ...rows.map((row) => Number(String(row.id).split("-").pop()) || 0)) + 1;
    movement.id = `MOV-${year}-${String(next).padStart(4, "0")}`;
  }
  movement.createdAt = movement.createdAt || new Date().toISOString();
  movement.createdBy = movement.createdBy || req.user.id;
  movement.createdByName = movement.createdByName || req.user.name;
  await pool.query("INSERT INTO financial_movements(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2, updated_at=now()", [movement.id, movement]);
  res.json(movement);
});

app.get("/api/finances/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const movement = (await pool.query("SELECT data FROM financial_movements WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!movement) return res.status(404).json({ error: "No existe" });
  res.json(movement);
});

app.patch("/api/finances/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const current = (await pool.query("SELECT data FROM financial_movements WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!current) return res.status(404).json({ error: "No existe" });
  const movement = await applyApprovedBudgetLink(normalizeFinancialMovement(req.body, current));
  movement.id = req.params.id;
  if (!String(movement.concept || "").trim() || movement.amount <= 0 || !movement.date) return res.status(400).json({ error: "Concepto, importe y fecha son obligatorios." });
  if (movement.currency !== "USD" && !movement.exchangeRate) return res.status(400).json({ error: "Indica el tipo de cambio para calcular el equivalente en USD." });
  movement.updatedBy = req.user.id; movement.updatedByName = req.user.name; movement.updatedAt = new Date().toISOString();
  await pool.query("UPDATE financial_movements SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, movement]);
  res.json(movement);
});

app.delete("/api/finances/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  await pool.query("DELETE FROM financial_movements WHERE id=$1", [req.params.id]);
  res.status(204).end();
});
// Duplica un proyecto con todas sus tareas; permite renombrar, cambiar clave, accesos y reasignar
app.post("/api/projects/:id/duplicate", auth, requireRole("admin", "gerente"), async (req, res) => {
  const src = (await pool.query("SELECT data FROM projects WHERE id=$1", [req.params.id])).rows[0]?.data;
  if (!src) return res.status(404).json({ error: "No existe" });
  const body = req.body || {};
  const key = (String(body.key || src.key || "PRJ").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)) || "PRJ";
  const newId = "p" + Date.now();
  const assignee = body.assignee || null;                 // reasignar todas las tareas (opcional)
  if (assignee && !(await assigneeIsAllowed(assignee))) return res.status(400).json({ error: "El responsable seleccionado no admite asignación de tareas" });
  const resetStatus = body.resetStatus !== false;         // por defecto, arranca en "Por hacer"
  const allowedUsers = Array.isArray(body.allowedUsers) ? body.allowedUsers : (assignee ? [assignee] : (src.allowedUsers || []));
  const project = { ...src, id: newId, key, name: body.name || `${src.name} (copia)`, allowedUsers };
  await pool.query("INSERT INTO projects(id,data) VALUES($1,$2)", [newId, project]);
  // Copiar tareas del origen, en orden, renumerando por la nueva clave
  const srcTasks = (await pool.query("SELECT data FROM tasks")).rows.map((r) => r.data)
    .filter((t) => t.project === req.params.id)
    .sort((a, b) => (parseInt(String(a.id).split("-")[1], 10) || 0) - (parseInt(String(b.id).split("-")[1], 10) || 0));
  const newTasks = [];
  let i = 1;
  for (const t of srcTasks) {
    const nt = { ...t, id: `${key}-${i}`, project: newId, activity: [], createdAt: new Date().toISOString() };
    if (assignee) nt.assignee = assignee;
    if (resetStatus) nt.status = "Por hacer";
    delete nt._updatedAt;
    await pool.query("INSERT INTO tasks(id,data) VALUES($1,$2)", [nt.id, nt]);
    newTasks.push(nt); i++;
  }
  if (assignee) await notify(assignee, `Se te asignó el proyecto ${project.name} (${newTasks.length} tareas)`, null);
  res.json({ project, tasks: newTasks });
});

/* ------------------------------------------------ Repuestos / Inventario ------------------------------------------------ */
app.post("/api/parts", auth, requireRole("admin", "gerente"), async (req, res) => {
  const p = { ...(req.body || {}) }; if (!p.id) p.id = "sp" + Date.now();
  ["price", "cost"].forEach((k) => { if (p[k] !== undefined) p[k] = wholeMoneyValue(p[k]); });
  ["stock", "minStock"].forEach((k) => { if (p[k] !== undefined) p[k] = Number(p[k]) || 0; });
  await pool.query("INSERT INTO parts(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2, updated_at=now()", [p.id, p]);
  res.json(p);
});
app.patch("/api/parts/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM parts WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  const patch = { ...(req.body || {}) };
  ["price", "cost"].forEach((k) => { if (patch[k] !== undefined) patch[k] = wholeMoneyValue(patch[k]); });
  ["stock", "minStock"].forEach((k) => { if (patch[k] !== undefined) patch[k] = Number(patch[k]) || 0; });
  const merged = { ...rows[0].data, ...patch, id: req.params.id };
  await pool.query("UPDATE parts SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
  res.json(merged);
});
app.delete("/api/parts/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
  await pool.query("DELETE FROM parts WHERE id=$1", [req.params.id]);
  res.status(204).end();
});

/* ------------------------------------------------ Órdenes (con reglas de montos por rol) ------------------------------------------------ */
const TEC_PATCH = ["signatureUrl", "signedAt", "signedBy", "noSignReason", "technicianSignatureUrl", "technicianSignedAt", "technicianSignedBy", "photos", "equipo", "sintoma", "solucion", "category", "technical", "status", "location", "laborHours", "technicians", "contact", "quoteNumber", "customerPO"];
const MANAGEMENT_PATCH = ["rate", "laborCost", "materials", "laborBillable", "status", "signatureUrl", "signedAt", "signedBy", "noSignReason", "technicianSignatureUrl", "technicianSignedAt", "technicianSignedBy", "quoteNumber", "customerPO"];

app.post("/api/orders", auth, requireOrdersAccess, async (req, res) => {
  let o = { ...(req.body || {}) };
  o.currency = "USD";
  if (o.rate === undefined || o.rate === null || o.rate === "") o.rate = Number(process.env.DEFAULT_RATE) || 50;
  o.rate = normalizedRateValue(o.rate);
  o.laborCost = wholeMoneyValue(o.laborCost);
  o.materials = await materialsFromInventory(o.materials);
  if (!o.id) {
    const year = new Date().getFullYear();
    const cl = (await pool.query("SELECT data FROM clients")).rows.map((r) => r.data)
      .find((x) => (x.name || "").trim().toLowerCase() === String(o.client || "").trim().toLowerCase());
    const code = (cl && cl.code) ? cl.code : "GEN";
    const n = (await pool.query("SELECT count(*)::int c FROM orders WHERE id LIKE $1", [`OT-${code}-${year}-%`])).rows[0].c + 1;
    o.id = `OT-${code}-${year}-${String(n).padStart(3, "0")}`;
  }
  if (isTec(req.user.role)) {
    // El técnico nunca fija importes: la tarifa la define el servidor y Gerencia la ajusta después.
    o.rate = normalizedRateValue(process.env.DEFAULT_RATE || 50); o.currency = "USD"; o.laborBillable = true; o.laborCost = 0;
    if (Array.isArray(o.materials)) o.materials = o.materials.map((m) => ({ ...m, billable: true }));
    if (o.status === "Facturada") o.status = "Aprobada";
  }
  const chronologyErrors = timelineErrorsValue(o.technical);
  if (o.status !== "Borrador" && chronologyErrors.length) return res.status(400).json({ error: chronologyErrors.join(" ") });
  if (["Completada", "Aprobada", "Facturada"].includes(o.status) && !o.technicianSignatureUrl) return res.status(400).json({ error: "La firma del técnico responsable es obligatoria para completar la orden." });
  o.billableHours = billableHoursValue(o);
  await pool.query("INSERT INTO orders(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2, updated_at=now()", [o.id, o]);
  res.json(isTec(req.user.role) ? stripMoney(o) : o);
});

app.patch("/api/orders/:id", auth, requireOrdersAccess, async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM orders WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  let patch = req.body || {};
  if (isTec(req.user.role)) {
    const clean = {}; for (const k of TEC_PATCH) if (k in patch) clean[k] = patch[k];
    if (clean.status === "Facturada") delete clean.status;
    patch = clean;
  } else if (req.user.role === "gerente") {
    const clean = {}; for (const k of MANAGEMENT_PATCH) if (k in patch) clean[k] = patch[k];
    patch = clean;
  }
  if ("rate" in patch) patch.rate = normalizedRateValue(patch.rate);
  if ("laborCost" in patch) patch.laborCost = wholeMoneyValue(patch.laborCost);
  if (Array.isArray(patch.materials)) patch.materials = patch.materials.map((material) => ({ ...material, price: wholeMoneyValue(material.price), cost: wholeMoneyValue(material.cost) }));
  const prev = rows[0].data;
  const merged = { ...prev, ...patch };
  merged.currency = "USD";
  const chronologyErrors = timelineErrorsValue(merged.technical);
  if (("technical" in patch || "status" in patch) && merged.status !== "Borrador" && chronologyErrors.length) return res.status(400).json({ error: chronologyErrors.join(" ") });
  if (patch.status && ["Completada", "Aprobada", "Facturada"].includes(merged.status) && !merged.technicianSignatureUrl) return res.status(400).json({ error: "La firma del técnico responsable es obligatoria para completar la orden." });
  merged.billableHours = billableHoursValue(merged);
  if (req.user.role === "admin" && patch.technical?.timelineAdjustmentReason && patch.technical.timelineAdjustmentReason !== prev.technical?.timelineAdjustmentReason) {
    merged.activity = [...(prev.activity || []), { type: "timeline", text: `Corrigió la cronología: ${patch.technical.timelineAdjustmentReason}`, by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  } else if (patch.status && patch.status !== prev.status) {
    merged.activity = [...(prev.activity || []), { type: "status", text: `Cambió el estado a ${patch.status}`, by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  } else if (req.user.role === "admin" && Object.keys(patch).length) {
    merged.activity = [...(prev.activity || []), { type: "edit", text: "Actualizó los datos de la orden", by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  }
  await pool.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
  res.json(isTec(req.user.role) ? stripMoney(merged) : merged);
});

app.post("/api/orders/:id/comment", auth, requireOrdersAccess, async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM orders WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
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
app.post("/api/tasks", auth, requireProjectWrite, async (req, res) => {
  const t = { ...(req.body || {}) }; if (!t.id) t.id = "T-" + Date.now();
  if (!(await tecCanProject(req.user, t.project))) return res.status(403).json({ error: "Sin acceso a ese proyecto" });
  if (!(await assigneeIsAllowed(t.assignee))) return res.status(400).json({ error: "Monitor Oficina no puede ser responsable de tareas" });
  const existing = (await pool.query("SELECT data FROM tasks WHERE id=$1", [t.id])).rows[0]?.data;
  await pool.query("INSERT INTO tasks(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2, updated_at=now()", [t.id, t]);
  // Notifica al responsable si es una asignación nueva (a otra persona)
  if (t.assignee && t.assignee !== req.user.id && (!existing || existing.assignee !== t.assignee))
    await notify(t.assignee, `Te asignaron la tarea ${t.id}: ${t.title}`, "task:" + t.id);
  res.json(t);
});
app.patch("/api/tasks/:id", auth, requireProjectWrite, async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM tasks WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  const prev = rows[0].data; const patch = req.body || {};
  if (!(await tecCanProject(req.user, prev.project))) return res.status(403).json({ error: "Sin acceso a ese proyecto" });
  if (patch.assignee !== undefined && !(await assigneeIsAllowed(patch.assignee))) return res.status(400).json({ error: "Monitor Oficina no puede ser responsable de tareas" });
  const merged = { ...prev, ...patch };
  if (patch.status && patch.status !== prev.status)
    merged.activity = [...(prev.activity || []), { type: "status", text: `Estado: ${patch.status}`, by: req.user.id, byName: req.user.name, at: new Date().toISOString() }];
  await pool.query("UPDATE tasks SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
  if (patch.assignee && patch.assignee !== prev.assignee && patch.assignee !== req.user.id)
    await notify(patch.assignee, `Te asignaron la tarea ${merged.id}: ${merged.title}`, "task:" + merged.id);
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
  if (!name || !email) return res.status(400).json({ error: "Faltan nombre o correo" });
  const id = "u" + Date.now();
  const hash = bcrypt.hashSync(password || process.env.DEMO_PASSWORD || "ordengo123", 10);
  try {
    await pool.query("INSERT INTO users(id,name,email,password_hash,role,color,active,mustchangepassword) VALUES($1,$2,$3,$4,$5,$6,true,true)",
      [id, name, email.toLowerCase(), hash, role || "tecnico", color || "#0ea5e9"]);
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
  const sets = [], vals = []; let i = 1;
  if (role !== undefined) { sets.push(`role=$${i++}`); vals.push(role); }
  if (active !== undefined) { sets.push(`active=$${i++}`); vals.push(active); }
  if (name !== undefined) { sets.push(`name=$${i++}`); vals.push(name); }
  if (color !== undefined) { sets.push(`color=$${i++}`); vals.push(color); }
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    sets.push(`password_hash=$${i++}`); vals.push(bcrypt.hashSync(password, 10));
    sets.push("mustchangepassword=true");
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
  await pool.query("DELETE FROM users WHERE id=$1", [req.params.id]); res.status(204).end();
});

/* ------------------------------------------------ Proxy IA (clave del lado servidor) ------------------------------------------------ */
app.post("/api/ai/analyze", auth, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(501).json({ error: "IA no configurada" });
  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: "Falta la imagen" });
  const prompt =
`Eres un técnico de automatización industrial. Analiza la imagen del equipo o trabajo y devuelve SOLO JSON válido (sin markdown):
{"equipo":"","category":"","description":"","confidence":0}
- equipo: nombre corto del componente. - category: etiqueta corta. - description: 1-2 frases en español. - confidence: 0 a 1.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5", max_tokens: 1000,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: prompt }] }],
      }),
    });
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    let c = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const s = c.indexOf("{"), e = c.lastIndexOf("}"); if (s !== -1 && e !== -1) c = c.slice(s, e + 1);
    res.json(JSON.parse(c));
  } catch { res.status(502).json({ error: "No se pudo analizar la imagen" }); }
});

/* ------------------------------------------------ Frontend estático (SPA) ------------------------------------------------ */
const dist = path.join(__dirname, "public");
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

/* ------------------------------------------------ Arranque ------------------------------------------------ */
const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`OrdenGO API + web escuchando en :${PORT}`)))
  .catch((e) => { console.error("Error iniciando la base de datos:", e); process.exit(1); });
