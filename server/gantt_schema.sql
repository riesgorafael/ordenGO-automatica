-- Propuesta de esquema para el Gantt de proyecto (importado desde MS Project o creado a mano).
-- No reemplaza la tabla "tasks" (Kanban); es un modelo distinto (fechas, duración, jerarquía,
-- dependencias) que convive con el tablero de tareas actual. Se referencian entre sí por projectId.

CREATE TABLE IF NOT EXISTS gantt_tasks (
  id text PRIMARY KEY,                 -- ej. "GT-VTU2-014"
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data jsonb NOT NULL,                 -- ver forma abajo
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gantt_tasks_project_idx ON gantt_tasks (project_id);

-- Forma de "data" (jsonb) por tarea:
-- {
--   "id": "GT-VTU2-014",
--   "projectId": "p8",
--   "sourceUid": 14,                  // UID original de MS Project, para reimportar sin duplicar
--   "wbs": "1.2.3",                   // jerarquía (Work Breakdown Structure)
--   "parentId": "GT-VTU2-010",        // null si es tarea raíz
--   "name": "Programación PLC línea A",
--   "start": "2026-09-01",
--   "end": "2026-09-05",
--   "durationDays": 5,
--   "percentComplete": 40,
--   "milestone": false,
--   "isSummary": false,               // true = tarea resumen (agrupa hijas, no se edita duración a mano)
--   "predecessors": [                 // dependencias, en formato similar a MS Project
--     { "taskId": "GT-VTU2-013", "type": "FS", "lagDays": 0 }
--     // FS = Finish-to-Start, SS = Start-to-Start, FF = Finish-to-Finish, SF = Start-to-Finish
--   ],
--   "assignee": "u3",                 // opcional, referencia a users.id
--   "importedFrom": "OT-2026-Cronograma.mpp",
--   "importedAt": "2026-08-14T12:00:00.000Z"
-- }
