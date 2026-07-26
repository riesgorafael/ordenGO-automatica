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
app.use(cors());
app.use(express.json({ limit: "12mb" }));

/* ------------------------------------------------ DB init + seed ------------------------------------------------ */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id text PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL,
      password_hash text NOT NULL, role text NOT NULL DEFAULT 'tecnico',
      color text DEFAULT '#0ea5e9', active boolean DEFAULT true, created_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS clients ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS projects( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS orders  ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS tasks   ( id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
  `);

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@empresa.com").toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || "admin1234";
  const demoPass = process.env.DEMO_PASSWORD || "ordengo123";

  if ((await pool.query("SELECT count(*)::int n FROM users")).rows[0].n === 0) {
    const seed = [
      { id: "u1", name: "Administrador", email: adminEmail, role: "admin", color: "#6366f1", pass: adminPass },
      { id: "u2", name: "Ana Gómez", email: "ana@empresa.com", role: "gerente", color: "#0ea5e9", pass: demoPass },
      { id: "u3", name: "Luis Mora", email: "luis@empresa.com", role: "tecnico", color: "#10b981", pass: demoPass },
      { id: "u4", name: "María Ruiz", email: "maria@empresa.com", role: "tecnico", color: "#f59e0b", pass: demoPass },
    ];
    for (const u of seed)
      await pool.query("INSERT INTO users(id,name,email,password_hash,role,color) VALUES($1,$2,$3,$4,$5,$6)",
        [u.id, u.name, u.email.toLowerCase(), bcrypt.hashSync(u.pass, 10), u.role, u.color]);
    console.log("→ Usuarios sembrados. Admin:", adminEmail);
  }

  if ((await pool.query("SELECT count(*)::int n FROM clients")).rows[0].n === 0) {
    const clients = [
      { id: "c1", name: "Lácteos del Valle", site: "Planta Norte, Nave 2" },
      { id: "c2", name: "Embotelladora Andina", site: "Línea de llenado 3" },
      { id: "c3", name: "Cárnicos Premium", site: "Sala de máquinas" },
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
      { id: "OT-2026-014", client: "Embotelladora Andina", site: "Línea de llenado 3", contact: "Ing. Salazar", service: "Mantenimiento correctivo", date: "2026-07-15", equipo: "Variador de frecuencia banda 3", sintoma: "Sobrecorriente intermitente", solucion: "Reemplazo de ventilador de disipador.", category: "Sobrecalentamiento", photos: [], signatureUrl: null, signedBy: "", laborHours: 3.5, technicians: 1, rate: 850, laborBillable: true, materials: [{ name: "Ventilador disipador VFD", qty: 1, price: 1200, billable: true }], status: "Completada", tech: "Luis Mora" },
    ];
    for (const o of orders) await pool.query("INSERT INTO orders(id,data) VALUES($1,$2)", [o.id, o]);
    console.log("→ Datos de demostración sembrados.");
  }
}

/* ------------------------------------------------ Helpers ------------------------------------------------ */
const pubUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, color: u.color, active: u.active });
function stripMoney(o) {
  const x = { ...o }; delete x.rate; delete x.laborBillable;
  if (Array.isArray(x.materials)) x.materials = x.materials.map((m) => { const y = { ...m }; delete y.price; delete y.billable; return y; });
  return x;
}
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: "Sin token" });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); } catch { res.status(401).json({ error: "Token inválido" }); }
}
const requireRole = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: "No autorizado" });

/* ------------------------------------------------ Auth ------------------------------------------------ */
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [String(email || "").toLowerCase()]);
  const u = rows[0];
  if (!u || !u.active || !bcrypt.compareSync(password || "", u.password_hash))
    return res.status(401).json({ error: "Correo o contraseña inválidos" });
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
  await pool.query("UPDATE users SET password_hash=$2 WHERE id=$1", [u.id, bcrypt.hashSync(next, 10)]);
  res.json({ ok: true });
});

/* ------------------------------------------------ Bootstrap (carga inicial) ------------------------------------------------ */
app.get("/api/bootstrap", auth, async (req, res) => {
  const tec = req.user.role === "tecnico";
  const [me, u, cl, pr, or, ta] = await Promise.all([
    pool.query("SELECT * FROM users WHERE id=$1", [req.user.id]),
    pool.query("SELECT * FROM users ORDER BY created_at"),
    pool.query("SELECT data FROM clients"),
    pool.query("SELECT data FROM projects"),
    pool.query("SELECT data FROM orders ORDER BY updated_at DESC"),
    pool.query("SELECT data FROM tasks ORDER BY updated_at DESC"),
  ]);
  res.json({
    me: pubUser(me.rows[0]),
    users: u.rows.map(pubUser),
    clients: cl.rows.map((r) => r.data),
    projects: pr.rows.map((r) => r.data),
    orders: or.rows.map((r) => (tec ? stripMoney(r.data) : r.data)),
    tasks: ta.rows.map((r) => r.data),
  });
});

/* ------------------------------------------------ Clientes ------------------------------------------------ */
app.post("/api/clients", auth, async (req, res) => {
  const c = req.body || {}; if (!c.id) c.id = "c" + Date.now();
  await pool.query("INSERT INTO clients(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2", [c.id, c]);
  res.json(c);
});

/* ------------------------------------------------ Proyectos ------------------------------------------------ */
app.post("/api/projects", auth, requireRole("admin", "gerente"), async (req, res) => {
  const p = req.body || {}; if (!p.id) p.id = "p" + Date.now();
  await pool.query("INSERT INTO projects(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2", [p.id, p]);
  res.json(p);
});

/* ------------------------------------------------ Órdenes (con reglas de montos por rol) ------------------------------------------------ */
const TEC_PATCH = ["signatureUrl", "signedBy", "photos", "equipo", "sintoma", "solucion", "category", "status", "location", "laborHours", "technicians", "contact"];

app.post("/api/orders", auth, async (req, res) => {
  let o = { ...(req.body || {}) };
  if (!o.id) o.id = "OT-" + Date.now();
  if (req.user.role === "tecnico") {
    o.rate = Number(o.rate) || 0; o.laborBillable = true;
    if (Array.isArray(o.materials)) o.materials = o.materials.map((m) => ({ ...m, price: 0, billable: true }));
    if (o.status === "Facturada") o.status = "Aprobada";
  }
  await pool.query("INSERT INTO orders(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2, updated_at=now()", [o.id, o]);
  res.json(req.user.role === "tecnico" ? stripMoney(o) : o);
});

app.patch("/api/orders/:id", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM orders WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  let patch = req.body || {};
  if (req.user.role === "tecnico") {
    const clean = {}; for (const k of TEC_PATCH) if (k in patch) clean[k] = patch[k];
    if (clean.status === "Facturada") delete clean.status;
    patch = clean;
  }
  const merged = { ...rows[0].data, ...patch };
  await pool.query("UPDATE orders SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
  res.json(req.user.role === "tecnico" ? stripMoney(merged) : merged);
});

/* ------------------------------------------------ Tareas ------------------------------------------------ */
app.post("/api/tasks", auth, async (req, res) => {
  const t = { ...(req.body || {}) }; if (!t.id) t.id = "T-" + Date.now();
  await pool.query("INSERT INTO tasks(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2, updated_at=now()", [t.id, t]);
  res.json(t);
});
app.patch("/api/tasks/:id", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT data FROM tasks WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "No existe" });
  const merged = { ...rows[0].data, ...(req.body || {}) };
  await pool.query("UPDATE tasks SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
  res.json(merged);
});
app.delete("/api/tasks/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM tasks WHERE id=$1", [req.params.id]); res.status(204).end();
});

/* ------------------------------------------------ Usuarios (solo Admin) ------------------------------------------------ */
app.post("/api/users", auth, requireRole("admin"), async (req, res) => {
  const { name, email, role, color, password } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: "Faltan nombre o correo" });
  const id = "u" + Date.now();
  const hash = bcrypt.hashSync(password || process.env.DEMO_PASSWORD || "ordengo123", 10);
  try {
    await pool.query("INSERT INTO users(id,name,email,password_hash,role,color,active) VALUES($1,$2,$3,$4,$5,$6,true)",
      [id, name, email.toLowerCase(), hash, role || "tecnico", color || "#0ea5e9"]);
  } catch { return res.status(400).json({ error: "Ese correo ya está registrado" }); }
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
  if (password) { sets.push(`password_hash=$${i++}`); vals.push(bcrypt.hashSync(password, 10)); }
  if (!sets.length) return res.status(400).json({ error: "Nada que actualizar" });
  vals.push(req.params.id);
  await pool.query(`UPDATE users SET ${sets.join(",")} WHERE id=$${i}`, vals);
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
