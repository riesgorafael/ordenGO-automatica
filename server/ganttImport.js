// Importación de cronogramas de MS Project (.mpp / .xml) al Gantt interno de OrdenGO.
//
// Dependencia: npm i mpxj multer
//   - mpxj: puerto JS de la librería Java MPXJ. Lee .mpp binario, MS Project XML, .mpx, .planner.
//   - multer: para recibir el archivo subido por multipart/form-data.
//
// Nota: la API exacta de métodos de "mpxj" puede variar levemente entre versiones (es un puerto
// automático del árbol de clases Java). Antes de integrar, confirmar los nombres de método contra
// los tipos (.d.ts) de la versión instalada — la estructura de este archivo (leer → recorrer tareas
// → mapear campos → resolver jerarquía/dependencias → guardar) es estable independientemente de eso.

import { readProject } from "mpxj";

/**
 * Convierte un Date de MPXJ (o null) a "YYYY-MM-DD".
 */
function toDateKey(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Mapea el tipo de relación de predecesora de MS Project (0-3) a nuestro código legible.
 * MS Project: 0=FF, 1=FS, 2=SF, 3=SS (según la enumeración RelationType de MPXJ).
 */
const RELATION_TYPE_MAP = { 0: "FF", 1: "FS", 2: "SF", 3: "SS" };

/**
 * Lee un buffer de archivo .mpp/.xml y devuelve una lista plana de tareas normalizadas,
 * en el mismo orden en que aparecen en el archivo (orden de esquema/outline de MS Project).
 */
export async function parseProjectFile(buffer, filename) {
  const project = await readProject(buffer, { filename }); // mpxj detecta el formato por contenido/extensión

  const rawTasks = project.getTasks().toArray(); // ajustar según la API real: puede ser project.tasks.all()
  const idByUid = new Map(); // uid de MS Project -> id interno "GT-<proj>-<n>"

  // Primera pasada: generar IDs internos estables y guardar el mapeo.
  rawTasks.forEach((task, index) => {
    if (task.getUniqueID() === 0) return; // la tarea 0 es la "raíz" implícita del proyecto, se descarta
    idByUid.set(task.getUniqueID(), `T${index}`);
  });

  const tasks = rawTasks
    .filter((task) => task.getUniqueID() !== 0)
    .map((task) => {
      const uid = task.getUniqueID();
      const parentTask = task.getParentTask();
      const predecessors = (task.getPredecessors() || []).map((relation) => ({
        taskId: idByUid.get(relation.getTargetTask().getUniqueID()) || null,
        type: RELATION_TYPE_MAP[relation.getType()?.getValue?.() ?? relation.getType()] || "FS",
        lagDays: relation.getLag() ? Math.round(relation.getLag().getDuration()) : 0,
      })).filter((relation) => relation.taskId);

      return {
        id: idByUid.get(uid),
        sourceUid: uid,
        parentId: parentTask && parentTask.getUniqueID() !== 0 ? idByUid.get(parentTask.getUniqueID()) : null,
        wbs: task.getWBS() || "",
        name: (task.getName() || "Tarea sin nombre").trim(),
        start: toDateKey(task.getStart()),
        end: toDateKey(task.getFinish()),
        durationDays: task.getDuration() ? Math.round(task.getDuration().getDuration()) : null,
        percentComplete: Number(task.getPercentageComplete()) || 0,
        milestone: !!task.getMilestone(),
        isSummary: !!task.getSummary(),
        predecessors,
      };
    })
    // Las tareas resumen (isSummary) no tienen fechas propias fiables en algunos archivos:
    // se recalculan más abajo a partir de sus hijas para no perder consistencia visual en el Gantt.
    .filter((task) => task.start && task.end || task.isSummary);

  return recomputeSummaryDates(tasks);
}

/**
 * Las tareas resumen (grupos) deben cubrir el rango de fechas de sus hijas. Si el archivo
 * original no trae fechas confiables para el resumen, las derivamos — evita barras de Gantt
 * "resumen" que no engloban visualmente a sus tareas hijas.
 */
function recomputeSummaryDates(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
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
 * Es idempotente por sourceUid: reimportar el mismo archivo actualiza en vez de duplicar.
 */
export async function importTasksToProject(pool, projectId, tasks, sourceFilename) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Se borra la importación previa de este mismo origen para que una reimportación
    // (ej. el cronograma se actualizó en MS Project) refleje exactamente el archivo nuevo,
    // sin dejar tareas viejas huérfanas si alguna fue eliminada del archivo.
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
        `INSERT INTO gantt_tasks (id, project_id, data) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET data = $3, updated_at = now()`,
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
