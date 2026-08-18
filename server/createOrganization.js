import pkg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const { Pool } = pkg;
const args = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const [key, ...value] = entry.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));
const slug = String(args.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
const name = String(args.name || "").trim().slice(0, 120);
const email = String(args["admin-email"] || "").trim().toLowerCase();
const adminName = String(args["admin-name"] || "Administrador").trim().slice(0, 100);
const password = String(process.env.ORG_ADMIN_PASSWORD || "");
const emptyCompanyProfile = {
  locale: "es-AR", timezone: "America/Buenos_Aires", baseCurrency: "USD",
  pricing: { defaultHourlyRate: 0, defaultInternalHourlyCost: 0, minimumBillableHours: 0, targetMargin: 0, vatRate: 0 },
  laborRoles: [{ name: "Técnico", cost: 0 }],
  features: { panel: true, budgets: true, finances: true, orders: true, projects: true, whiteboard: true, materialLists: true, clients: true, purchaseOrders: true, inventory: true, team: true, reports: true },
};

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL es obligatorio");
if (!slug || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Uso: --slug=empresa --name=\"Empresa SRL\" --admin-email=admin@empresa.com --admin-name=\"Nombre\"");
if (password.length < 8) throw new Error("Define ORG_ADMIN_PASSWORD con al menos 8 caracteres");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
try {
  await db.query("BEGIN");
  const organizationId = `org-${slug}`;
  await db.query("INSERT INTO organizations(id,slug,name,profile) VALUES($1,$2,$3,$4)", [organizationId, slug, name, emptyCompanyProfile]);
  await db.query(
    "INSERT INTO app_settings(organization_id,key,value) VALUES($1,'branding_v1',$2)",
    [organizationId, {
      appName: "OrdenGO", subtitle: "Gestión de servicios", companyName: name, companyLegalName: name,
      companyCuit: "", companyIvaCondition: "", companyAddress: "", companyPhone: "", companyEmail: "", companyWebsite: "",
      theme: "ordengo", primaryColor: "#0EA5C5", headerColor: "#0B315F", logoDataUrl: "",
    }],
  );
  await db.query(
    "INSERT INTO users(id,name,email,password_hash,role,color,active,mustchangepassword,organization_id) VALUES($1,$2,$3,$4,'admin','#0ea5e9',true,true,$5)",
    [`u-${crypto.randomUUID()}`, adminName, email, bcrypt.hashSync(password, 10), organizationId],
  );
  // Una empresa nueva debe nacer sin información operativa. Esta comprobación evita confirmar
  // el alta si una migración, trigger o valor por defecto llegara a copiar datos de otro tenant.
  const emptyBusinessTables = [
    "clients", "projects", "budgets", "financial_movements", "orders", "tasks", "notifications",
    "parts", "suppliers", "purchase_orders", "material_lists", "whiteboard_notes", "stock_movements",
    "audit_log", "file_assets", "gantt_tasks",
  ];
  for (const table of emptyBusinessTables) {
    const { rows: [{ count }] } = await db.query(`SELECT count(*)::int AS count FROM ${table} WHERE organization_id=$1`, [organizationId]);
    if (count !== 0) throw new Error(`Alta multiempresa inválida: ${table} contiene ${count} registro(s)`);
  }
  const { rows: [{ users: adminCount }] } = await db.query("SELECT count(*)::int AS users FROM users WHERE organization_id=$1", [organizationId]);
  if (adminCount !== 1) throw new Error(`Alta multiempresa inválida: se esperaban 1 administrador y se encontraron ${adminCount}`);
  await db.query("COMMIT");
  console.log(`Organización creada: ${name} (${slug}). El administrador deberá cambiar su contraseña al ingresar.`);
} catch (error) {
  await db.query("ROLLBACK");
  if (error.code === "23505") throw new Error("Ya existe una organización con ese slug o un usuario con ese correo");
  throw error;
} finally {
  db.release();
  await pool.end();
}
