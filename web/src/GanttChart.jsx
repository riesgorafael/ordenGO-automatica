// Diagrama de Gantt interactivo para un proyecto, con importación desde MS Project.
// Por ahora se admite el formato XML de MS Project (Archivo > Guardar como > "XML de Project"),
// no el binario .mpp directo — ver la nota en server/ganttImport.js.
//
// Dependencia adicional: npm i gantt-task-react
// Esa librería trae su propio CSS: import "gantt-task-react/dist/index.css"; (ya incluido abajo).

import { useEffect, useMemo, useRef, useState } from "react";
import { Gantt, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { Upload, Download, Loader2, AlertTriangle, Plus, Trash2, X, CheckSquare } from "lucide-react";
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

const GANTT_CHECK_COL_W = 26;

// Encabezado de la tabla lateral en español (el original de la librería trae "Name/From/To"
// fijos en inglés — no depende del prop "locale", que solo traduce nombres de mes/día).
function GanttTaskListHeader({ headerHeight, fontFamily, fontSize }) {
  return (
    <div className="flex items-center border-b border-slate-200 bg-slate-50" style={{ height: headerHeight, fontFamily, fontSize }}>
      <div style={{ width: GANTT_CHECK_COL_W }} />
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
// El checkbox de la izquierda es para elegir qué tareas convertir en tareas de proyecto (Kanban);
// una tarea ya convertida (linkedTaskId) queda marcada con un check verde y no se puede reelegir.
function GanttTaskListTable({ rowHeight, fontFamily, fontSize, tasks, selectedTaskId, setSelectedTask, onEditTask, selectedForConversion, onToggleSelect }) {
  const depthOf = (task) => { let d = 0, current = task; while (current.project) { const parent = tasks.find((t) => t.id === current.project); if (!parent) break; d++; current = parent; } return d; };
  const shortDate = (date) => date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  return (
    <div style={{ fontFamily, fontSize }}>
      {tasks.map((task, index) => {
        const depth = depthOf(task);
        const isSummary = task.type === "project";
        const converted = !!task.linkedTaskId;
        return (
          <div key={task.id} onClick={() => { setSelectedTask(task.id); onEditTask?.(task.id); }} className={`flex cursor-pointer items-center border-b border-slate-100 ${task.id === selectedTaskId ? "bg-brand-50" : index % 2 ? "bg-slate-50/60" : "bg-white"} hover:bg-brand-50/60`} style={{ height: rowHeight }}>
            <div className="flex shrink-0 items-center justify-center" style={{ width: GANTT_CHECK_COL_W }} onClick={(e) => e.stopPropagation()}>
              {converted
                ? <span title="Ya convertida en tarea de proyecto" className="grid h-4 w-4 place-items-center rounded-full bg-emerald-100 text-emerald-600">✓</span>
                : <input type="checkbox" checked={selectedForConversion?.has(task.id) || false} onChange={() => onToggleSelect?.(task.id)} />}
            </div>
            <div className={`truncate px-3 ${isSummary ? "font-semibold text-slate-800" : "text-slate-600"}`} style={{ width: GANTT_NAME_COL_W, paddingLeft: `${12 + depth * 14}px` }} title={task.name}>{task.name}</div>
            <div className="truncate px-2 text-[11px] text-slate-500" style={{ width: GANTT_DATE_COL_W }} title={shortDate(task.start)}>{shortDate(task.start)}</div>
            <div className="truncate px-2 text-[11px] text-slate-500" style={{ width: GANTT_DATE_COL_W }} title={shortDate(task.end)}>{shortDate(task.end)}</div>
          </div>
        );
      })}
    </div>
  );
}

const GANTT_PRIORITIES = ["Baja", "Media", "Alta", "Urgente"];

function GanttConvertModal({ tasks, users, onClose, onConfirm }) {
  const [assignee, setAssignee] = useState(users[0]?.id || "");
  const [priority, setPriority] = useState("Media");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setSaving(true); setError("");
    try { await onConfirm({ assignee, priority }); onClose(); }
    catch (e) { setError(e.message || "No se pudieron crear las tareas."); setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="mobile-dialog mobile-sheet-content w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-semibold text-slate-900">Convertir en tarea{tasks.length > 1 ? "s" : ""} de proyecto</h3><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <p className="mb-3 text-xs text-slate-500">Se {tasks.length > 1 ? "crean" : "crea"} en el tablero Kanban de Proyectos, con vencimiento igual al fin planificado en el Gantt.</p>
        <div className="mb-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
          {tasks.map((t) => <div key={t.id} className="truncate text-xs text-slate-700">• {t.name} <span className="text-slate-400">({t.end})</span></div>)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Responsable</span>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="u-input">{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </label>
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Prioridad</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="u-input">{GANTT_PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
        </div>
        {error && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={submit} disabled={saving || !assignee} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Crear {tasks.length} tarea{tasks.length > 1 ? "s" : ""}</button>
        </div>
      </div>
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

export default function GanttChart({ projectId, projectName, users = [], toast, onConvertToTask }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [viewMode, setViewMode] = useState(ViewMode.Week);
  const [error, setError] = useState("");
  // Mismo corte que el breakpoint "sm" de Tailwind (640px), para deshabilitar Día/Mes en celular.
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const onChange = (e) => setIsMobile(e.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  // undefined = modal cerrado; "new" = creando; cualquier otro string = id de la tarea a editar.
  const [editingTaskId, setEditingTaskId] = useState(undefined);
  const [selectedForConversion, setSelectedForConversion] = useState(() => new Set());
  const [convertOpen, setConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  // Al tildar una tarea resumen (ej. "Comisionamiento"), se agrupan automáticamente todas sus
  // subtareas (recursivo, no solo las hijas directas) para convertirlas juntas de una sola vez.
  const toggleSelectForConversion = (id) => setSelectedForConversion((current) => {
    const next = new Set(current);
    const task = tasks.find((t) => t.id === id);
    const idsToToggle = task?.isSummary ? [...descendantIds(id, tasks)] : [id];
    const turningOn = !next.has(id);
    idsToToggle.forEach((tid) => {
      const t = tasks.find((x) => x.id === tid);
      if (t && !t.linkedTaskId) { turningOn ? next.add(tid) : next.delete(tid); }
    });
    return next;
  });
  const fileInputRef = useRef(null);
  const containerRef = useRef(null);
  const panRef = useRef(null); // { pointerId, startX, scrollLeft, moved }
  const [panning, setPanning] = useState(false);

  // "Arrastrar para desplazar" (como un mapa): funciona igual con mouse y con el dedo en el
  // celular porque Pointer Events unifica ambos. Se ignora si el arrastre empezó sobre una barra
  // de tarea (esa ya tiene su propio arrastre para reprogramar fechas) o sobre un control de la
  // tabla lateral (checkbox, fila clickeable, etc.).
  // Registrado en fase de CAPTURA (no burbuja): la librería del Gantt tiene sus propios manejadores
  // sobre el SVG (tooltip al pasar el mouse, arrastre de barra) que llaman stopPropagation, así que
  // un listener normal en el contenedor nunca llegaba a dispararse ahí adentro — solo funcionaba
  // fuera del gráfico (ej. la barra de scroll nativa). La captura se ejecuta antes de que la
  // librería pueda bloquearla. Recién se "roba" el puntero (setPointerCapture) cuando el gesto
  // resulta ser un arrastre de verdad (superó el umbral), no en cada toque: así un clic simple
  // sobre una barra sigue abriendo su tooltip/edición normalmente.
  const handlePanPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return; // solo click izquierdo / touch
    if (event.target.closest('[class*="barWrapper"], input, select, button, a, label')) return;
    const el = containerRef.current;
    if (!el) return;
    panRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scrollLeft: el.scrollLeft, moved: false, captured: false };
  };
  const handlePanPointerMove = (event) => {
    const state = panRef.current;
    const el = containerRef.current;
    if (!state || !el || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    if (!state.moved && Math.abs(dx) < 4) return;
    if (!state.moved) { state.moved = true; setPanning(true); el.setPointerCapture?.(event.pointerId); state.captured = true; }
    event.preventDefault();
    event.stopPropagation(); // a partir de acá es un arrastre nuestro, no un clic de la librería
    el.scrollLeft = state.scrollLeft - dx;
  };
  const endPan = (event) => {
    const state = panRef.current;
    if (state && event) containerRef.current?.releasePointerCapture?.(event.pointerId);
    panRef.current = null;
    setPanning(false);
  };
  // La librería instancia TaskListTable con un set fijo de props (no admite props extra propias),
  // así que para poder abrir el modal de edición y manejar la selección al hacer click en una fila
  // envolvemos el componente una sola vez (useMemo con deps vacías) y accedemos al estado "en vivo"
  // a través de referencias — así el wrapper no se recrea en cada render (rompería el layout de la
  // librería) pero igual siempre ve el valor más reciente, no una copia vieja del primer render.
  const selectedForConversionRef = useRef(selectedForConversion);
  selectedForConversionRef.current = selectedForConversion;
  const toggleSelectForConversionRef = useRef(toggleSelectForConversion);
  toggleSelectForConversionRef.current = toggleSelectForConversion;
  const TaskListTableWithEdit = useMemo(() => {
    return (props) => <GanttTaskListTable {...props} onEditTask={(id) => setEditingTaskId(id)} selectedForConversion={selectedForConversionRef.current} onToggleSelect={(id) => toggleSelectForConversionRef.current(id)} />;
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

  // Convierte las tareas del Gantt seleccionadas en tareas reales del tablero Kanban de Proyectos.
  // Cada una queda marcada con "linkedTaskId" para no poder convertirla dos veces por error. Si la
  // tarea cuelga de una sección (tarea resumen, ej. "Comisionamiento"), ese nombre viaja como
  // "sectionName" para que quede en la descripción — trazabilidad de a qué etapa pertenece.
  const handleConvert = async ({ assignee, priority }) => {
    if (!onConvertToTask) return;
    setConverting(true);
    try {
      const selected = tasks.filter((t) => selectedForConversion.has(t.id) && !t.linkedTaskId);
      for (const ganttTask of selected) {
        const sectionName = ganttTask.parentId ? tasks.find((t) => t.id === ganttTask.parentId)?.name : null;
        const created = await onConvertToTask(ganttTask, { assignee, priority, sectionName });
        await api.updateGanttTask(ganttTask.id, { linkedTaskId: created.id });
        setTasks((current) => current.map((t) => (t.id === ganttTask.id ? { ...t, linkedTaskId: created.id } : t)));
      }
      toast?.(`${selected.length} tarea(s) creada(s) en el tablero de Proyectos`, "success");
      setSelectedForConversion(new Set());
    } finally { setConverting(false); }
  };

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ganttTasks = tasks.map((t) => toGanttTaskShape(t, byId));
  const editingTask = editingTaskId && editingTaskId !== "new" ? tasks.find((t) => t.id === editingTaskId) : null;

  return (
    <div className="space-y-3">
      {/* Fila 1: título + selector de escala. Fila 2: acciones — separadas a propósito para que
          en pantallas angostas no todo se apile en una sola columna gigante de botones. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Cronograma (Gantt)</h3>
          <p className="text-[11px] text-slate-500">{tasks.length} tarea(s) · {projectName}</p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
          {[["Día", ViewMode.Day], ["Semana", ViewMode.Week], ["Mes", ViewMode.Month]].map(([label, mode]) => {
            // "Día" y "Mes" quedan deshabilitados en celular: con columnas tan angostas esas
            // escalas son casi ilegibles ahí; "Semana" es la que realmente sirve en esa pantalla.
            const disabledOnMobile = isMobile && mode !== ViewMode.Week;
            return (
              <button key={label} onClick={() => setViewMode(mode)} disabled={disabledOnMobile} title={disabledOnMobile ? "Solo disponible en pantallas más grandes" : undefined} className={`rounded-md px-2 py-1.5 font-medium sm:px-2.5 ${viewMode === mode ? "bg-brand-500 text-white" : disabledOnMobile ? "text-slate-300" : "text-slate-600"} disabled:cursor-not-allowed`}>{label}</button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {selectedForConversion.size > 0 && (
          <button onClick={() => setConvertOpen(true)} title="Convertir en tarea(s) de proyecto" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 sm:px-3 sm:text-sm">
            <CheckSquare className="h-4 w-4" /> Convertir ({selectedForConversion.size})
          </button>
        )}
        <button onClick={() => fileInputRef.current?.click()} disabled={importing} title="Importar XML de MS Project" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:px-3 sm:text-sm">
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} <span className="hidden sm:inline">Importar XML</span>
        </button>
        <input ref={fileInputRef} type="file" accept=".xml" className="hidden" onChange={(e) => handleImport(e.target.files?.[0])} />
        <button onClick={() => setEditingTaskId("new")} title="Nueva tarea" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 sm:px-3 sm:text-sm">
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nueva tarea</span>
        </button>
        <button onClick={() => exportGanttToPdf(tasks, { projectName })} disabled={!tasks.length} title="Exportar PDF" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-2.5 py-2 text-xs font-medium text-white hover:bg-brand-400 disabled:opacity-50 sm:px-3 sm:text-sm">
          <Download className="h-4 w-4" /> <span className="hidden sm:inline">Exportar PDF</span>
        </button>
      </div>

      {error && <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      <div
        ref={containerRef}
        className={`overflow-x-auto rounded-xl border border-slate-200 bg-white ${panning ? "cursor-grabbing select-none" : "cursor-grab"}`}
        style={{ touchAction: "pan-y" }}
        onPointerDownCapture={handlePanPointerDown}
        onPointerMoveCapture={handlePanPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
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

      {convertOpen && (
        <GanttConvertModal
          tasks={tasks.filter((t) => selectedForConversion.has(t.id))}
          users={users}
          onClose={() => setConvertOpen(false)}
          onConfirm={handleConvert}
        />
      )}
    </div>
  );
}
