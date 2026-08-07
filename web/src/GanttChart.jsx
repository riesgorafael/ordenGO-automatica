// Diagrama de Gantt interactivo para un proyecto, con importación desde MS Project.
// Por ahora se admite el formato XML de MS Project (Archivo > Guardar como > "XML de Project"),
// no el binario .mpp directo — ver la nota en server/ganttImport.js.
//
// Dependencia adicional: npm i gantt-task-react
// Esa librería trae su propio CSS: import "gantt-task-react/dist/index.css"; (ya incluido abajo).

import { useEffect, useRef, useState } from "react";
import { Gantt, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { Upload, Download, Loader2, ZoomIn, ZoomOut, AlertTriangle } from "lucide-react";
import { api } from "./api";
import { exportGanttToPdf } from "./ganttPdf";

// gantt-task-react espera fechas como Date y una forma de tarea propia; mapeamos desde
// nuestro modelo (gantt_tasks.data) a ese formato en el borde del componente, sin tocar
// la forma que viaja al servidor.
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
  const fileInputRef = useRef(null);
  const containerRef = useRef(null);

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

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ganttTasks = tasks.map((t) => toGanttTaskShape(t, byId));

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
            Sin cronograma todavía. Importá un archivo XML de MS Project para empezar (Archivo &gt; Guardar como &gt; "XML de Project" dentro de MS Project).
          </div>
        ) : (
          <Gantt
            tasks={ganttTasks}
            viewMode={viewMode}
            onDateChange={handleDateChange}
            onProgressChange={handleProgressChange}
            onClick={() => {}}
            listCellWidth="220px"
            columnWidth={viewMode === ViewMode.Month ? 300 : viewMode === ViewMode.Week ? 250 : 65}
          />
        )}
      </div>
    </div>
  );
}
