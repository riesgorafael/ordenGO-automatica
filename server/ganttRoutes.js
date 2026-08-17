// Rutas Express para el Gantt de proyecto. Se registran desde server/index.js con:
//   import { registerGanttRoutes } from "./ganttRoutes.js";
//   registerGanttRoutes(app, pool, { auth, requireRole });
//
// Dependencia adicional: npm i multer

import multer from "multer";
import { parseProjectFile, importTasksToProject } from "./ganttImport.js";

const upload = multer({
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB: un XML con miles de tareas puede pesar varios MB
  // Por ahora solo XML de MS Project (Archivo > Guardar como > XML). El .mpp binario requeriría
  // la librería Java MPXJ corriendo aparte (con un JRE en la imagen); queda pendiente si hace falta.
  fileFilter: (req, file, cb) => {
    const ok = /\.xml$/i.test(file.originalname);
    cb(ok ? null : new Error("Por ahora solo se admite XML de MS Project (.xml)"), ok);
  },
});

export function registerGanttRoutes(app, pool, { auth, requireRole, tecCanProject }) {
  // Importar un cronograma de MS Project a un proyecto existente.
  app.post(
    "/api/projects/:id/import-mpp",
    auth,
    requireRole("admin", "gerente"),
    upload.single("file"),
    async (req, res) => {
      const project = (await pool.query("SELECT id FROM projects WHERE id=$1", [req.params.id])).rows[0];
      if (!project) return res.status(404).json({ error: "El proyecto no existe" });
      if (!req.file) return res.status(400).json({ error: "Adjuntá un archivo XML de MS Project" });

      let tasks;
      try {
        tasks = await parseProjectFile(req.file.buffer, req.file.originalname);
      } catch (error) {
        console.error("Error al leer el archivo de MS Project:", error);
        return res.status(400).json({ error: "No se pudo leer el archivo. Verificá que no esté dañado ni protegido con contraseña." });
      }
      if (!tasks.length) return res.status(400).json({ error: "El archivo no tiene tareas para importar." });

      const count = await importTasksToProject(pool, req.params.id, tasks, req.file.originalname);
      res.json({ imported: count, source: req.file.originalname });
    }
  );

  // Leer las tareas del Gantt de un proyecto (para renderizar el diagrama).
  app.get("/api/projects/:id/gantt-tasks", auth, async (req, res) => {
    if (!(await tecCanProject(req.user, req.params.id))) return res.status(403).json({ error: "Sin acceso a ese proyecto" });
    const { rows } = await pool.query(
      "SELECT data FROM gantt_tasks WHERE project_id = $1 ORDER BY data->>'wbs'",
      [req.params.id]
    );
    res.json(rows.map((row) => row.data));
  });

  // Crear una tarea a mano directamente en el Gantt (sin pasar por una importación).
  app.post("/api/projects/:id/gantt-tasks", auth, requireRole("admin", "gerente"), async (req, res) => {
    const projectId = req.params.id;
    const project = (await pool.query("SELECT id FROM projects WHERE id=$1", [projectId])).rows[0];
    if (!project) return res.status(404).json({ error: "El proyecto no existe" });
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name) return res.status(400).json({ error: "El nombre de la tarea es obligatorio" });
    if (!body.start || !body.end) return res.status(400).json({ error: "Indicá fecha de inicio y de fin" });
    if (new Date(body.end) < new Date(body.start)) return res.status(400).json({ error: "La fecha de fin no puede ser anterior a la de inicio" });

    if (body.parentId) {
      const parent = (await pool.query("SELECT 1 FROM gantt_tasks WHERE id=$1 AND project_id=$2", [body.parentId, projectId])).rows[0];
      if (!parent) return res.status(400).json({ error: "La tarea padre seleccionada no existe en este proyecto" });
    }
    const predecessors = Array.isArray(body.predecessors) ? body.predecessors.filter((p) => p?.taskId) : [];
    for (const dep of predecessors) {
      const exists = (await pool.query("SELECT 1 FROM gantt_tasks WHERE id=$1 AND project_id=$2", [dep.taskId, projectId])).rows[0];
      if (!exists) return res.status(400).json({ error: `La tarea predecesora ${dep.taskId} no existe en este proyecto` });
    }

    const id = `GT-${projectId}-M${Date.now()}`;
    const durationDays = Math.max(1, Math.round((new Date(body.end) - new Date(body.start)) / 86400000) + 1);
    const data = {
      id, projectId,
      name, start: body.start, end: body.end, durationDays,
      percentComplete: Math.min(100, Math.max(0, Number(body.percentComplete) || 0)),
      milestone: !!body.milestone,
      isSummary: !!body.isSummary,
      parentId: body.parentId || null,
      predecessors: predecessors.map((p) => ({ taskId: p.taskId, type: ["FS", "SS", "FF", "SF"].includes(p.type) ? p.type : "FS", lagDays: Number(p.lagDays) || 0 })),
      wbs: "",
      createdManually: true,
      createdAt: new Date().toISOString(),
    };
    await pool.query("INSERT INTO gantt_tasks (id, project_id, data) VALUES ($1, $2, $3)", [id, projectId, data]);
    res.json(data);
  });

  // Reprogramar (arrastre), editar % de avance, o corregir cualquier otro campo de una tarea.
  app.patch("/api/gantt-tasks/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
    const current = (await pool.query("SELECT data, project_id FROM gantt_tasks WHERE id=$1", [req.params.id])).rows[0];
    if (!current) return res.status(404).json({ error: "No existe" });
    const patch = req.body || {};
    if (patch.start && patch.end && new Date(patch.end) < new Date(patch.start)) return res.status(400).json({ error: "La fecha de fin no puede ser anterior a la de inicio" });
    if (patch.parentId === req.params.id) return res.status(400).json({ error: "Una tarea no puede ser su propia tarea padre" });
    const allowed = ["start", "end", "percentComplete", "name", "milestone", "isSummary", "parentId", "predecessors", "durationDays", "linkedTaskId"];
    const merged = { ...current.data };
    for (const key of allowed) if (key in patch) merged[key] = patch[key];
    if (!merged.start || !merged.end || new Date(merged.end) < new Date(merged.start)) return res.status(400).json({ error: "La fecha de fin no puede ser anterior a la de inicio" });
    if (merged.parentId) {
      const parent = (await pool.query("SELECT 1 FROM gantt_tasks WHERE id=$1 AND project_id=$2", [merged.parentId, current.project_id])).rows[0];
      if (!parent) return res.status(400).json({ error: "La tarea padre no existe en este proyecto" });
    }
    merged.predecessors = Array.isArray(merged.predecessors) ? merged.predecessors.filter((dependency) => dependency?.taskId).map((dependency) => ({ taskId: String(dependency.taskId), type: ["FS", "SS", "FF", "SF"].includes(dependency.type) ? dependency.type : "FS", lagDays: Number(dependency.lagDays) || 0 })) : [];
    if (merged.predecessors.some((dependency) => dependency.taskId === req.params.id)) return res.status(400).json({ error: "Una tarea no puede depender de sí misma" });
    for (const dependency of merged.predecessors) {
      const exists = (await pool.query("SELECT 1 FROM gantt_tasks WHERE id=$1 AND project_id=$2", [dependency.taskId, current.project_id])).rows[0];
      if (!exists) return res.status(400).json({ error: `La tarea predecesora ${dependency.taskId} no existe en este proyecto` });
    }
    const projectTasks = (await pool.query("SELECT id,data FROM gantt_tasks WHERE project_id=$1", [current.project_id])).rows.map((row) => [row.id, row.id === req.params.id ? merged : row.data]);
    const graph = new Map(projectTasks.map(([id, data]) => [id, [data.parentId, ...(Array.isArray(data.predecessors) ? data.predecessors.map((dependency) => dependency.taskId) : [])].filter(Boolean)]));
    const visiting = new Set(); const visited = new Set();
    const hasCycle = (id) => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const dependencyId of graph.get(id) || []) if (graph.has(dependencyId) && hasCycle(dependencyId)) return true;
      visiting.delete(id); visited.add(id); return false;
    };
    if ([...graph.keys()].some((id) => hasCycle(id))) return res.status(409).json({ error: "La relación genera un ciclo entre tareas. Revisa padre y predecesoras." });
    if (patch.start || patch.end) merged.durationDays = Math.max(1, Math.round((new Date(merged.end) - new Date(merged.start)) / 86400000) + 1);
    await pool.query("UPDATE gantt_tasks SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
    res.json(merged);
  });

  // Eliminar una tarea puntual: sus hijas pasan a colgar del padre de la eliminada (no quedan
  // huérfanas) y se la quita de la lista de predecesoras de quien dependía de ella.
  app.delete("/api/gantt-tasks/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
    const row = (await pool.query("SELECT data, project_id FROM gantt_tasks WHERE id=$1", [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: "No existe" });
    const { rows: siblings } = await pool.query("SELECT id, data FROM gantt_tasks WHERE project_id=$1", [row.project_id]);
    for (const sibling of siblings) {
      let changed = false;
      const data = { ...sibling.data };
      if (data.parentId === req.params.id) { data.parentId = row.data.parentId || null; changed = true; }
      if (Array.isArray(data.predecessors) && data.predecessors.some((p) => p.taskId === req.params.id)) {
        data.predecessors = data.predecessors.filter((p) => p.taskId !== req.params.id);
        changed = true;
      }
      if (changed) await pool.query("UPDATE gantt_tasks SET data=$2, updated_at=now() WHERE id=$1", [sibling.id, data]);
    }
    await pool.query("DELETE FROM gantt_tasks WHERE id=$1", [req.params.id]);
    res.status(204).end();
  });

  app.delete("/api/projects/:id/gantt-tasks", auth, requireRole("admin", "gerente"), async (req, res) => {
    await pool.query("DELETE FROM gantt_tasks WHERE project_id=$1", [req.params.id]);
    res.status(204).end();
  });
}
