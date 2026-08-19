// Importación de cronogramas de MS Project al Gantt interno de MiOrdenGo.
//
// IMPORTANTE — cambio de enfoque: la primera versión de este archivo asumía un paquete npm
// llamado "mpxj" para leer el binario .mpp directamente. Ese paquete no existe en el registro
// de npm (fue un error mío, no verificado) y rompió el build. Este archivo parsea en cambio el
// formato **MS Project XML** (Archivo > Guardar como > XML dentro de MS Project), que es un
// esquema de Microsoft documentado y estable desde Project 2003 — no requiere ninguna librería
// de terceros dudosa, solo un parser XML genérico y real: xml2js.
//
// El soporte de .mpp binario directo (sin pasar por XML) requeriría la librería Java MPXJ real
// corriendo como proceso aparte (con un JRE en la imagen Docker) — es un cambio de infraestructura
// más grande que dejo pendiente hasta que se confirme que hace falta.

import { parseStringPromise } from "xml2js";

const RELATION_TYPE_MAP = { 0: "FF", 1: "FS", 2: "SF", 3: "SS" };

// xml2js devuelve todo como arrays de strings (por el modo por defecto); estos helpers
// leen el primer valor de un campo y lo tipan.
const first = (node, key) => (node?.[key] ? node[key][0] : undefined);
const text = (node, key) => { const v = first(node, key); return typeof v === "string" ? v : undefined; };
const num = (node, key) => { const v = text(node, key); return v !== undefined ? Number(v) : undefined; };
const bool = (node, key) => text(node, key) === "1" || text(node, key) === "true";

/**
 * MS Project XML representa la duración como un ISO 8601 duration (ej. "PT40H0M0S" = 40 horas).
 * La convertimos a días asumiendo jornadas de 8 horas, que es la convención estándar de Project.
 */
function durationToDays(iso) {
  if (!iso) return null;
  const match = /P(?:(\d+)D)?T?(?:(\d+)H)?/.exec(iso);
  if (!match) return null;
  const days = Number(match[1] || 0), hours = Number(match[2] || 0);
  return Math.round((days + hours / 8) * 10) / 10;
}

function toDateKey(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Parsea un buffer de MS Project XML y devuelve una lista plana de tareas normalizadas.
 */
export async function parseProjectFile(buffer, filename) {
  if (!/\.xml$/i.test(filename)) {
    throw new Error("Por ahora solo se admite el formato XML de MS Project. En MS Project: Archivo > Guardar como > tipo 'XML de Project'.");
  }
  const xml = await parseStringPromise(buffer.toString("utf-8"), { explicitArray: true, ignoreAttrs: true });
  const root = xml.Project;
  if (!root) throw new Error("El archivo no tiene el formato esperado de XML de MS Project (falta el nodo <Project>).");

  const rawTasks = (root.Tasks?.[0]?.Task || []).filter((task) => text(task, "UID") !== "0");
  const idByUid = new Map();
  rawTasks.forEach((task, index) => idByUid.set(text(task, "UID"), `T${index}`));

  const tasks = rawTasks.map((task) => {
    const uid = text(task, "UID");
    const outlineLevel = num(task, "OutlineLevel") || 1;
    const predecessors = (task.PredecessorLink || []).map((link) => ({
      taskId: idByUid.get(text(link, "PredecessorUID")) || null,
      type: RELATION_TYPE_MAP[num(link, "Type") ?? 1] || "FS",
      lagDays: num(link, "LinkLag") ? Math.round(num(link, "LinkLag") / (num(link, "LagFormat") === 7 ? 480 : 1)) : 0,
    })).filter((relation) => relation.taskId);

    return {
      id: idByUid.get(uid),
      sourceUid: uid,
      outlineLevel,
      wbs: text(task, "WBS") || "",
      name: (text(task, "Name") || "Tarea sin nombre").trim(),
      start: toDateKey(text(task, "Start")),
      end: toDateKey(text(task, "Finish")),
      durationDays: durationToDays(text(task, "Duration")),
      percentComplete: num(task, "PercentComplete") || 0,
      milestone: bool(task, "Milestone"),
      isSummary: bool(task, "Summary"),
      predecessors,
    };
  });

  // La jerarquía en MS Project XML es implícita por OutlineLevel (no trae parentId directo):
  // el padre de una tarea es la tarea anterior en el archivo con OutlineLevel menor.
  const withParents = tasks.map((task, index) => {
    if (task.outlineLevel <= 1) return { ...task, parentId: null };
    for (let i = index - 1; i >= 0; i--) {
      if (tasks[i].outlineLevel < task.outlineLevel) return { ...task, parentId: tasks[i].id };
    }
    return { ...task, parentId: null };
  });

  return recomputeSummaryDates(withParents.filter((t) => (t.start && t.end) || t.isSummary));
}

/**
 * Las tareas resumen deben cubrir el rango de fechas de sus hijas, por si el archivo original
 * no trae fechas confiables para el resumen.
 */
function recomputeSummaryDates(tasks) {
  const childrenOf = (id) => tasks.filter((t) => t.parentId === id);
  const resolve = (task) => {
    if (!task.isSummary) return task;
    const children = childrenOf(task.id).map(resolve);
    if (!children.length) return task;
    const starts = children.map((c) => c.start).filter(Boolean).sort();
    const ends = children.map((c) => c.end).filter(Boolean).sort();
    return { ...task, start: task.start || starts[0], end: task.end || ends[ends.length - 1] };
  };
  return tasks.map(resolve).filter((t) => t.start && t.end);
}

/**
 * Inserta (o reemplaza) las tareas de un proyecto en la tabla gantt_tasks.
 * Es idempotente por archivo de origen: reimportar el mismo archivo actualiza en vez de duplicar.
 */
export async function importTasksToProject(pool, projectId, tasks, sourceFilename) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM gantt_tasks WHERE project_id = $1 AND data->>'importedFrom' = $2",
      [projectId, sourceFilename]
    );
    const importedAt = new Date().toISOString();
    for (const task of tasks) {
      const id = `GT-${projectId}-${task.id}`;
      const data = {
        ...task,
        id,
        projectId,
        parentId: task.parentId ? `GT-${projectId}-${task.parentId}` : null,
        predecessors: task.predecessors.map((p) => ({ ...p, taskId: `GT-${projectId}-${p.taskId}` })),
        importedFrom: sourceFilename,
        importedAt,
      };
      await client.query(
        `INSERT INTO gantt_tasks (id, project_id, data, organization_id)
         VALUES ($1, $2, $3, current_setting('app.organization_id'))
         ON CONFLICT (organization_id, id) DO UPDATE SET data = $3, updated_at = now()`,
        [id, projectId, data]
      );
    }
    await client.query("COMMIT");
    return tasks.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
