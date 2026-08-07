// Diagrama de Gantt interactivo para un proyecto, con importación desde MS Project.
// Por ahora se admite el formato XML de MS Project (Archivo > Guardar como > "XML de Project"),
// no el binario .mpp directo — ver la nota en server/ganttImport.js.
//
// Dependencia adicional: npm i gantt-task-react
// Esa librería trae su propio CSS: import "gantt-task-react/dist/index.css"; (ya incluido abajo).

import { useEffect, useMemo, useRef, useState } from "react";
import { Gantt, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { Upload, Download, Loader2, AlertTriangle, Plus, Trash2, X } from "lucide-react";
import { api } from "./api";
import { exportGanttToPdf } from "./ganttPdf";

const DEPENDENCY_TYPES = [
  ["FS", "Fin → Inicio (la predecesora termina antes de que esta empiece)"],
  ["SS", "Inicio → Inicio (empiezan juntas)"],
  ["FF", "Fin → Fin (terminan juntas)"],
  ["SF", "Inicio → Fin (esta termina cuando la predecesora empieza)"],
];

/** IDs de una tarea y todos sus descendientes — para no permitir elegirla como su propio padre. */
function descendantIds(taskId, tasks) {
  const ids = new Set([taskId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const task of tasks) {
      if (task.parentId && ids.has(task.parentId) && !ids.has(task.id)) { ids.add(task.id); grew = true; }
    }
  }
  return ids;
}

function GanttTaskModal({ task, tasks, onClose, onSave, onDelete }) {
  const editing = !!task?.id;
  const [form, setForm] = useState(() => ({
    name: task?.name || "", start: task?.start || "", end: task?.end || "",
    percentComplete: task?.percentComplete || 0, milestone: !!task?.milestone, isSummary: !!task?.isSummary,
    parentId: task?.parentId || "", predecessors: task?.predecessors || [],
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [depTaskId, setDepTaskId] = useState(""); const [depType, setDepType] = useState("FS"); const [depLag, setDepLag] = useState(0);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const excludedAsParent = editing ? descendantIds(task.id, tasks) : new Set();
  const parentOptions = tasks.filter((t) => !excludedAsParent.has(t.id));
  const predecessorOptions = tasks.filter((t) => t.id !== task?.id && !(form.predecessors || []).some((p) => p.taskId === t.id));

  const addPredecessor = () => {
    if (!depTaskId) return;
    set({ predecessors: [...(form.predecessors || []), { taskId: depTaskId, type: depType, lagDays: Number(depLag) || 0 }] });
    setDepTaskId(""); setDepType("FS"); setDepLag(0);
  };
  const removePredecessor = (taskId) => set({ predecessors: (form.predecessors || []).filter((p) => p.taskId !== taskId) });

  const save = async () => {
    setError("");
    if (!form.name.trim()) { setError("El nombre es obligatorio."); return; }
    if (!form.start || !form.end) { setError("Indicá fecha de inicio y de fin."); return; }
    if (form.end < form.start) { setError("La fecha de fin no puede ser anterior a la de inicio."); return; }
    setSaving(true);
    try {
      await onSave({ ...form, parentId: form.parentId || null });
      onClose();
    } catch (e) { setError(e.message || "No se pudo guardar la tarea."); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!editing) return;
    setSaving(true);
    try { await onDelete(task.id); onClose(); }
    catch (e) { setError(e.message || "No se pudo eliminar la tarea."); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-semibold text-slate-900">{editing ? "Editar tarea del Gantt" : "Nueva tarea del Gantt"}</h3><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="space-y-3">
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Nombre de la tarea" className="u-input text-sm font-medium" />
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Inicio *</span><input type="date" value={form.start} onChange={(e) => set({ start: e.target.value })} className="u-input" /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Fin *</span><input type="date" value={form.end} onChange={(e) => set({ end: e.target.value })} className="u-input" /></label>
          </div>
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Avance (%)</span><input type="number" min="0" max="100" value={form.percentComplete} onChange={(e) => set({ percentComplete: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} className="u-input" /></label>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={form.milestone} onChange={(e) => set({ milestone: e.target.checked })} /> Es un hito</label>
            <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={form.isSummary} onChange={(e) => set({ isSummary: e.target.checked })} /> Es una tarea resumen (agrupa otras)</label>
          </div>
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Tarea padre (jerarquía, opcional)</span>
            <select value={form.parentId} onChange={(e) => set({ parentId: e.target.value })} className="u-input">
              <option value="">Sin tarea padre (nivel raíz)</option>
              {parentOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <div>
            <span className="mb-1 block text-[11px] font-medium text-slate-500">Predecesoras (dependencias)</span>
            {(form.predecessors || []).length > 0 && (
              <div className="mb-2 space-y-1.5">
                {form.predecessors.map((dep) => {
                  const depTask = tasks.find((t) => t.id === dep.taskId);
                  return (
                    <div key={dep.taskId} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate">{depTask?.name || dep.taskId}</span>
                      <span className="shrink-0 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 ring-1 ring-slate-200">{dep.type}{dep.lagDays ? ` +${dep.lagDays}d` : ""}</span>
                      <button type="button" onClick={() => removePredecessor(dep.taskId)} aria-label="Quitar dependencia" className="shrink-0 text-slate-400 hover:text-rose-500"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              <select value={depTaskId} onChange={(e) => setDepTaskId(e.target.value)} className="u-input min-w-0 flex-1">
                <option value="">Elegir tarea predecesora…</option>
                {predecessorOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={depType} onChange={(e) => setDepType(e.target.value)} title="Tipo de dependencia" className="u-input w-auto">
                {DEPENDENCY_TYPES.map(([code, label]) => <option key={code} value={code} title={label}>{code}</option>)}
              </select>
              <input type="number" min="0" value={depLag} onChange={(e) => setDepLag(e.target.value)} title="Días de demora (lag)" placeholder="Días" className="u-input w-20" />
              <button type="button" onClick={addPredecessor} disabled={!depTaskId} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Agregar</button>
            </div>
            <p className="mt-1 text-[10px] text-slate-400">{DEPENDENCY_TYPES.find(([code]) => code === depType)?.[1]}</p>
          </div>
        </div>
        {error && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
        <div className="mt-5 flex gap-2">
          {editing && <button onClick={remove} disabled={saving} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>}
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={save} disabled={saving} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</button>
        </div>
      </div>
    </div>
  );
}

// gantt-task-react espera fechas como Date y una forma de tarea propia; mapeamos desde
// nuestro modelo (gantt_tasks.data) a ese formato en el borde del componente, sin tocar
// la forma que viaja al servidor.
// La librería mide el ancho real que ocupa esto en el DOM (no fuerza 3 columnas iguales), así
// que en vez de repartir "rowWidth" por igual entre las 3 columnas (el bug: una fecha corta
// quedaba con el mismo ancho que el nombre de la tarea, y el nombre se cortaba) se define un
// ancho fijo bien distinto por columna: mucho más espacio para el nombre que para las fechas.
const GANTT_NAME_COL_W = 260;
const GANTT_DATE_COL_W = 84;

// Encabezado de la tabla lateral en español (el original de la librería trae "Name/From/To"
// fijos en inglés — no depende del prop "locale", que solo traduce nombres de mes/día).
function GanttTaskListHeader({ headerHeight, fontFamily, fontSize }) {
  return (
    <div className="flex items-center border-b border-slate-200 bg-slate-50" style={{ height: headerHeight, fontFamily, fontSize }}>
      <div className="truncate px-3 font-semibold text-slate-500" style={{ width: GANTT_NAME_COL_W }}>Tarea</div>
      <div className="truncate px-2 font-semibold text-slate-500" style={{ width: GANTT_DATE_COL_W }}>Inicio</div>
      <div className="truncate px-2 font-semibold text-slate-500" style={{ width: GANTT_DATE_COL_W }}>Fin</div>
    </div>
  );
}

// Tabla lateral en español, con fechas cortas (el formato por defecto de la librería es muy
// verboso: "martes, 1 de septiembre de 2026") y jerarquía marcada con sangría + negrita en
// las tareas resumen, para que se note de un vistazo qué agrupa a qué. El nombre completo queda
// disponible como tooltip nativo (title) para los casos que ni con más espacio entran en una línea.
function GanttTaskListTable({ rowHeight, fontFamily, fontSize, tasks, selectedTaskId, setSelectedTask, onEditTask }) {
  const depthOf = (task) => { let d = 0, current = task; while (current.project) { const parent = tasks.find((t) => t.id === current.project); if (!parent) break; d++; current = parent; } return d; };
  const shortDate = (date) => date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  return (
    <div style={{ fontFamily, fontSize }}>
      {tasks.map((task, index) => {
        const depth = depthOf(task);
        const isSummary = task.type === "project";
        return (
          <div key={task.id} onClick={() => { setSelectedTask(task.id); onEditTask?.(task.id); }} className={`flex cursor-pointer items-center border-b border-slate-100 ${task.id === selectedTaskId ? "bg-brand-50" : index % 2 ? "bg-slate-50/60" : "bg-white"} hover:bg-brand-50/60`} style={{ height: rowHeight }}>
            <div className={`truncate px-3 ${isSummary ? "font-semibold text-slate-800" : "text-slate-600"}`} style={{ width: GANTT_NAME_COL_W, paddingLeft: `${12 + depth * 14}px` }} title={task.name}>{task.name}</div>
            <div className="truncate px-2 text-[11px] text-slate-500" style={{ width: GANTT_DATE_COL_W }} title={shortDate(task.start)}>{shortDate(task.start)}</div>
            <div className="truncate px-2 text-[11px] text-slate-500" style={{ width: GANTT_DATE_COL_W }} title={shortDate(task.end)}>{shortDate(task.end)}</div>
          </div>
        );
      })}
    </div>
  );
}

function toGanttTaskShape(task, byId) {
  return {
    id: task.id,
    name: task.milestone ? `◆ ${task.name}` : task.name,
    start: new Date(`${task.start}T00:00:00`),
    end: new Date(`${task.end}T00:00:00`),
    progress: task.percentComplete || 0,
    type: task.milestone ? "milestone" : task.isSummary ? "project" : "task",
    project: task.parentId || undefined,
    dependencies: (task.predecessors || []).map((p) => p.taskId).filter((id) => byId.has(id)),
    isDisabled: false,
    styles: task.isSummary
      ? { backgroundColor: "#94a3b8", progressColor: "#475569" }
      : task.milestone
        ? { backgroundColor: "#f18700", progressColor: "#f18700" }
        : { backgroundColor: "#bae6fd", progressColor: "#0284c7" },
  };
}

export default function GanttChart({ projectId, projectName, toast }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [viewMode, setViewMode] = useState(ViewMode.Week);
  const [error, setError] = useState("");
  // undefined = modal cerrado; "new" = creando; cualquier otro string = id de la tarea a editar.
  const [editingTaskId, setEditingTaskId] = useState(undefined);
  const fileInputRef = useRef(null);
  const containerRef = useRef(null);
  // La librería instancia TaskListTable con un set fijo de props (no admite props extra propias),
  // así que para poder abrir el modal de edición al hacer click en una fila envolvemos el
  // componente una sola vez (useMemo con deps vacías) y le inyectamos el handler por clausura.
  const TaskListTableWithEdit = useMemo(() => {
    return (props) => <GanttTaskListTable {...props} onEditTask={(id) => setEditingTaskId(id)} />;
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.ganttTasks(projectId);
      setTasks(rows);
      setError("");
    } catch (e) {
      setError(e.message || "No se pudieron cargar las tareas del Gantt.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [projectId]);

  const handleImport = async (file) => {
    if (!file) return;
    setImporting(true);
    setError("");
    try {
      const result = await api.importMpp(projectId, file);
      toast?.(`Se importaron ${result.imported} tarea(s) desde ${result.source}`, "success");
      await load();
    } catch (e) {
      setError(e.message || "No se pudo importar el archivo.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Arrastrar una barra en el Gantt reprograma la tarea (persistimos start/end al soltar).
  const handleDateChange = async (ganttTask) => {
    const start = ganttTask.start.toISOString().slice(0, 10);
    const end = ganttTask.end.toISOString().slice(0, 10);
    setTasks((current) => current.map((t) => (t.id === ganttTask.id ? { ...t, start, end } : t)));
    try { await api.updateGanttTask(ganttTask.id, { start, end }); }
    catch (e) { toast?.("No se pudo guardar el nuevo cronograma: " + e.message, "error"); await load(); }
  };

  const handleProgressChange = async (ganttTask) => {
    setTasks((current) => current.map((t) => (t.id === ganttTask.id ? { ...t, percentComplete: ganttTask.progress } : t)));
    try { await api.updateGanttTask(ganttTask.id, { percentComplete: ganttTask.progress }); }
    catch (e) { toast?.("No se pudo guardar el avance: " + e.message, "error"); await load(); }
  };

  const handleModalSave = async (form) => {
    if (editingTaskId && editingTaskId !== "new") {
      const updated = await api.updateGanttTask(editingTaskId, form);
      setTasks((current) => current.map((t) => (t.id === editingTaskId ? updated : t)));
    } else {
      const created = await api.createGanttTask(projectId, form);
      setTasks((current) => [...current, created]);
    }
  };
  const handleModalDelete = async (id) => {
    await api.deleteGanttTask(id);
    await load(); // recarga: el servidor puede haber reasignado el padre de las tareas hijas
  };

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ganttTasks = tasks.map((t) => toGanttTaskShape(t, byId));
  const editingTask = editingTaskId && editingTaskId !== "new" ? tasks.find((t) => t.id === editingTaskId) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Cronograma (Gantt)</h3>
          <p className="text-[11px] text-slate-500">{tasks.length} tarea(s) · {projectName}</p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
          {[["Día", ViewMode.Day], ["Semana", ViewMode.Week], ["Mes", ViewMode.Month]].map(([label, mode]) => (
            <button key={label} onClick={() => setViewMode(mode)} className={`rounded-md px-2.5 py-1.5 font-medium ${viewMode === mode ? "bg-brand-500 text-white" : "text-slate-600"}`}>{label}</button>
          ))}
        </div>
        <button onClick={() => fileInputRef.current?.click()} disabled={importing} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Importar XML de MS Project
        </button>
        <input ref={fileInputRef} type="file" accept=".xml" className="hidden" onChange={(e) => handleImport(e.target.files?.[0])} />
        <button onClick={() => setEditingTaskId("new")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
          <Plus className="h-4 w-4" /> Nueva tarea
        </button>
        <button onClick={() => exportGanttToPdf(tasks, { projectName })} disabled={!tasks.length} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50">
          <Download className="h-4 w-4" /> Exportar PDF
        </button>
      </div>

      {error && <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      <div ref={containerRef} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="grid h-64 place-items-center text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : ganttTasks.length === 0 ? (
          <div className="grid h-64 place-items-center px-4 text-center text-sm text-slate-400">
            Sin cronograma todavía. Importá un archivo XML de MS Project, o creá tareas a mano con "Nueva tarea".
          </div>
        ) : (
          <Gantt
            tasks={ganttTasks}
            viewMode={viewMode}
            locale="es-AR"
            onDateChange={handleDateChange}
            onProgressChange={handleProgressChange}
            onClick={(ganttTask) => setEditingTaskId(ganttTask.id)}
            TaskListHeader={GanttTaskListHeader}
            TaskListTable={TaskListTableWithEdit}
            listCellWidth="180px"
            columnWidth={viewMode === ViewMode.Month ? 300 : viewMode === ViewMode.Week ? 250 : 65}
          />
        )}
      </div>

      {editingTaskId && (
        <GanttTaskModal
          task={editingTask}
          tasks={tasks}
          onClose={() => setEditingTaskId(undefined)}
          onSave={handleModalSave}
          onDelete={handleModalDelete}
        />
      )}
    </div>
  );
}
