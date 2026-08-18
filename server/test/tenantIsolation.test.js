import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(path.join(here, "..", "index.js"), "utf8");
const ganttSource = readFileSync(path.join(here, "..", "ganttRoutes.js"), "utf8");
const ganttImportSource = readFileSync(path.join(here, "..", "ganttImport.js"), "utf8");
const createOrganizationSource = readFileSync(path.join(here, "..", "createOrganization.js"), "utf8");
const webSource = readFileSync(path.join(here, "..", "..", "web", "src", "App.jsx"), "utf8");
const pdfSource = readFileSync(path.join(here, "..", "..", "web", "src", "pdf.js"), "utf8");

test("la carga inicial filtra explícitamente cada módulo por organization_id", () => {
  for (const table of [
    "users", "clients", "projects", "budgets", "financial_movements", "orders", "tasks",
    "notifications", "parts", "suppliers", "purchase_orders", "material_lists", "whiteboard_notes",
  ]) {
    assert.match(serverSource, new RegExp(`FROM ${table} WHERE organization_id=\\$1|FROM ${table} WHERE [^\"\\n]*organization_id=\\$2`), `${table} debe filtrarse por tenant`);
  }
});

test("Notas aplica tenant en lectura, escritura, edición y borrado", () => {
  assert.match(serverSource, /FROM whiteboard_notes WHERE organization_id=\$1/);
  assert.match(serverSource, /INSERT INTO whiteboard_notes\(id,data,organization_id\)/);
  assert.match(serverSource, /FROM whiteboard_notes WHERE id=\$1 AND organization_id=\$2/);
  assert.match(serverSource, /DELETE FROM whiteboard_notes WHERE id=\$1 AND organization_id=\$2/);
  assert.match(serverSource, /Una persona seleccionada no pertenece a esta empresa/);
});

test("el servidor exige RLS forzado y el Gantt también filtra por tenant", () => {
  assert.match(serverSource, /relforcerowsecurity/);
  assert.match(serverSource, /Aislamiento multiempresa inválido/);
  assert.match(serverSource, /La política RLS permitió leer otro tenant/);
  assert.match(serverSource, /SET LOCAL ROLE/);
  assert.match(ganttSource, /FROM gantt_tasks WHERE project_id = \$1 AND organization_id=\$2/);
  assert.match(ganttSource, /INSERT INTO gantt_tasks \(id, project_id, data, organization_id\)/);
});

test("las preferencias del navegador no se comparten entre empresas", () => {
  assert.match(webSource, /tenantPreferenceKey = \(base, user\).*organizationId.*user.*id/);
  assert.match(webSource, /tenantPreferenceKey\("ordengo_order_filters", me\)/);
  assert.match(webSource, /tenantPreferenceKey\("ordengo_project_filters", me\)/);
  assert.match(webSource, /tenantPreferenceKey\("ordengo_tech_task_view", me\)/);
  assert.doesNotMatch(webSource, /localStorage\.setItem\("ordengo_(?:order_filters|project_filters|tech_task_view)"/);
});

test("una organización nueva se confirma sólo si nace sin datos operativos", () => {
  assert.match(createOrganizationSource, /const emptyBusinessTables =/);
  assert.match(createOrganizationSource, /WHERE organization_id=\$1/);
  assert.match(createOrganizationSource, /Alta multiempresa inválida/);
});

test("los identificadores operativos pueden repetirse únicamente entre empresas", () => {
  assert.match(serverSource, /PRIMARY KEY\(organization_id,id\)/);
  for (const table of ["clients", "projects", "budgets", "financial_movements", "orders", "tasks", "parts", "purchase_orders", "whiteboard_notes", "gantt_tasks"]) {
    assert.match(serverSource, new RegExp(`tenantEntityTables[\\s\\S]*["']${table}["']`), `${table} debe usar clave primaria por tenant`);
  }
  assert.doesNotMatch(ganttImportSource, /ON CONFLICT \(id\)/);
  assert.match(ganttImportSource, /ON CONFLICT \(organization_id, id\)/);
});

test("el alta de inventario confirma persistencia y auditoría en la misma empresa", () => {
  assert.match(serverSource, /sp-\$\{crypto\.randomUUID\(\)\}/);
  assert.match(serverSource, /INSERT INTO parts\(id,data,organization_id\).*RETURNING data,organization_id/);
  assert.match(serverSource, /inserted\.organization_id !== req\.user\.organizationId/);
  assert.match(serverSource, /auditChange\([\s\S]*entityType: "part"[\s\S]*}, db\)/);
});

test("las migraciones históricas de arranque no recorren empresas nuevas", () => {
  assert.match(serverSource, /tenantContext\.run\(\{ organizationId: DEFAULT_ORGANIZATION_ID \}, async \(\) => \{/);
  assert.match(serverSource, /Todo lo que sigue son siembras y migraciones de compatibilidad/);
});

test("los reportes de OT usan el branding explícito del tenant y toleran adjuntos dañados", () => {
  assert.match(webSource, /downloadOrderReport\(order, projects, audience, branding\)/);
  assert.match(webSource, /internalOrderReportPDF\(order, project, branding\)/);
  assert.match(webSource, /valuedClientReportPDF\(order, project, branding\)/);
  assert.match(webSource, /clientOrderReportPDF\(order, project, branding\)/);
  assert.match(pdfSource, /const safeAsset = async/);
  assert.match(pdfSource, /Ningún adjunto aislado debe impedir generar todo el reporte/);
  assert.match(pdfSource, /return printable\._reportAssetWarnings/);
});
