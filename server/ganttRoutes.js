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

export function registerGanttRoutes(app, pool, { auth, requireRole }) {
  // Importar un cronograma de MS Project a un proyecto existente.
  app.post(
    "/api/projects/:id/import-mpp",
    auth,
    requireRole("admin", "gerente"),
    upload.single("file"),
    async (req, res) => {
      const project = (await pool.query("SELECT id FROM projects WHERE id=$1", [req.params.id])).rows[0];
      if (!project) return res.status(404).json({ error: "El proyecto no existe" });
      if (!req.file) return res.status(400).json({ error: "Adjuntá un archivo .mpp, .xml o .mpx" });

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
    const { rows } = await pool.query(
      "SELECT data FROM gantt_tasks WHERE project_id = $1 ORDER BY data->>'wbs'",
      [req.params.id]
    );
    res.json(rows.map((row) => row.data));
  });

  // Reprogramar una tarea a mano (arrastre en el Gantt) o editar % de avance.
  app.patch("/api/gantt-tasks/:id", auth, requireRole("admin", "gerente"), async (req, res) => {
    const current = (await pool.query("SELECT data FROM gantt_tasks WHERE id=$1", [req.params.id])).rows[0]?.data;
    if (!current) return res.status(404).json({ error: "No existe" });
    const patch = req.body || {};
    const allowed = ["start", "end", "percentComplete", "name"]; // superficie de edición manual acotada
    const merged = { ...current };
    for (const key of allowed) if (key in patch) merged[key] = patch[key];
    await pool.query("UPDATE gantt_tasks SET data=$2, updated_at=now() WHERE id=$1", [req.params.id, merged]);
    res.json(merged);
  });

  app.delete("/api/projects/:id/gantt-tasks", auth, requireRole("admin", "gerente"), async (req, res) => {
    await pool.query("DELETE FROM gantt_tasks WHERE project_id=$1", [req.params.id]);
    res.status(204).end();
  });
}
