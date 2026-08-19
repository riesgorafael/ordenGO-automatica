// Exporta el Gantt a PDF dibujando vectores con jsPDF (mismo criterio que pdf.js en este proyecto):
// texto seleccionable/buscable y trazo nítido, en vez de rasterizar una captura de pantalla.
//
// El formato se inspira en el reporte nativo de MS Project: columnas Id/Nombre/Duración/Fechas
// a la izquierda, franja de mes + días en el eje de tiempo, secciones (tareas resumen) resaltadas
// con una franja gris de ancho completo, y una barra de color distinta por sección para poder
// seguir de un vistazo qué tareas pertenecen a qué etapa del proyecto.

import { jsPDF } from "jspdf";
import { LOGO, LOGO_RATIO } from "./logo";
import { drawProductMark } from "./pdf.js";

// Trunca de verdad con "…" hasta que entra en el ancho disponible — a diferencia de
// splitTextToSize(...)[0], que envuelve por palabra y puede devolver una primera línea que
// TODAVÍA excede el ancho (nombres largos sin espacios donde cortar). Cuando eso pasaba, el
// texto de la columna siguiente se dibujaba encima y los glifos superpuestos se veían como
// caracteres corruptos.
function truncateToWidth(doc, text, maxWidth) {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.getTextWidth(text.slice(0, mid) + "…") <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + "…" : "…";
}

const PAGE_W = 297, PAGE_H = 210; // A4 apaisado
const MARGIN = 10;
const ROW_H = 6.2;
// Una sola altura de encabezado para los dos lados (tabla y gráfico): antes la tabla usaba una
// franja de 4.5mm y el gráfico una de 10mm (mes + día), así que las filas arrancaban donde
// terminaba el encabezado del gráfico, dejando un hueco en blanco debajo del de la tabla.
const HEADER_TOP = 13;    // debajo del logo/título
const HEADER_H = 9;       // alto único: acomoda mes+día del lado del gráfico y el rótulo de columna del lado de la tabla
const CHART_TOP = HEADER_TOP + HEADER_H; // primera fila de datos, igual en tabla y gráfico

// Columnas de la tabla izquierda (mm).
const COL = { id: 9, name: 56, duration: 15, start: 16, end: 16 };
const LABEL_W = COL.id + COL.name + COL.duration + COL.start + COL.end;
const INDENT_PER_LEVEL = 3;

// Un solo acento de color para toda tarea normal (antes había un color distinto por sección
// y quedaba muy recargado). Resumen y avance se distinguen por tono/contraste, no por matiz.
const TASK_COLOR = { light: [219, 234, 254], strong: [37, 99, 235] }; // celeste / azul
const MILESTONE_COLOR = [241, 135, 0]; // naranja de marca, igual en todos los hitos

const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };
const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1);
const daysBetween = (a, b) => Math.round((new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0)) / 86400000);
const parseDate = (str) => new Date(`${str}T00:00:00`);
const shortDate = (str) => parseDate(str).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });

function dateRange(tasks) {
  const starts = tasks.map((t) => parseDate(t.start).getTime());
  const ends = tasks.map((t) => parseDate(t.end).getTime());
  return { min: new Date(Math.min(...starts)), max: new Date(Math.max(...ends)) };
}

/** Elige una granularidad de eje legible según cuánto abarca el cronograma completo. */
function pickTimeScale(min, max) {
  const totalDays = daysBetween(min, max) + 1;
  if (totalDays <= 45) return { unit: "day", step: 2 };
  if (totalDays <= 150) return { unit: "day", step: 7 };
  if (totalDays <= 420) return { unit: "week", step: 14 };
  return { unit: "month", step: 1 };
}

function buildTicks(min, max, scale) {
  const ticks = [];
  let cursor = new Date(min);
  const step = scale.unit === "month" ? () => { cursor = addMonths(cursor, scale.step); } : () => { cursor = addDays(cursor, scale.step); };
  while (cursor <= max) { ticks.push(new Date(cursor)); step(); }
  return ticks;
}

function buildMonthBands(min, max) {
  const bands = [];
  let cursor = startOfMonth(min);
  while (cursor <= max) {
    const next = addMonths(cursor, 1);
    bands.push({ start: cursor < min ? min : cursor, end: next < max ? next : addDays(max, 1), label: cursor.toLocaleDateString("es-AR", { month: "short", year: "2-digit" }) });
    cursor = next;
  }
  return bands;
}

function depthOf(task, byId) {
  let depth = 0, current = task;
  const seen = new Set();
  while (current.parentId && byId.has(current.parentId) && !seen.has(current.parentId)) { seen.add(current.parentId); depth++; current = byId.get(current.parentId); }
  return depth;
}
/** Numeración jerárquica tipo WBS (1, 1.1, 1.2, 2, 2.1…) para tareas que no la traen del origen. */
function buildWbsIndex(tasks) {
  const counters = new Map(); // parentId (o "root") -> próximo número a usar
  const wbsById = new Map();
  tasks.forEach((task) => {
    const parentKey = task.parentId || "root";
    const next = (counters.get(parentKey) || 0) + 1;
    counters.set(parentKey, next);
    const prefix = task.parentId ? `${wbsById.get(task.parentId) || ""}.` : "";
    wbsById.set(task.id, `${prefix}${next}`);
  });
  return wbsById;
}

export function exportGanttToPdf(tasks, { projectName = "Proyecto", fileName, branding = {} } = {}) {
  if (!tasks.length) return;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const wbsById = buildWbsIndex(tasks);
  const { min, max } = dateRange(tasks);
  const scale = pickTimeScale(min, max);
  const ticks = buildTicks(min, max, scale);
  const monthBands = buildMonthBands(min, max);
  const totalDays = Math.max(1, daysBetween(min, max) + 1);
  const chartW = PAGE_W - MARGIN * 2 - LABEL_W;
  const dayW = chartW / totalDays;
  const xForDate = (d) => MARGIN + LABEL_W + daysBetween(min, typeof d === "string" ? parseDate(d) : d) * dayW;
  const rowsPerPage = Math.floor((PAGE_H - MARGIN - CHART_TOP) / ROW_H);
  const pageCount = Math.ceil(tasks.length / rowsPerPage);

  const drawHeader = (pageIndex) => {
    let logoW = 0;
    const isAutomatica = branding.builtInCompanyLogo === "automatica";
    const companyLogo = branding.logoDataUrl || (isAutomatica ? LOGO : "");
    try { if (companyLogo) { const properties = doc.getImageProperties(companyLogo); const ratio = properties.height / properties.width || LOGO_RATIO; const h = 6.5; doc.addImage(companyLogo, undefined, MARGIN, 5.5, h / ratio, h); logoW = h / ratio + 3; } } catch {} // cabe entre el borde y HEADER_TOP sin pisar la franja gris
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(15, 23, 42);
    doc.text(`CRONOGRAMA · ${projectName.toUpperCase()}`, PAGE_W / 2, 10, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
    doc.text(`Generado ${new Date().toLocaleDateString("es-AR")}`, PAGE_W - MARGIN, 7, { align: "right" });

    // Fondo del encabezado: una sola franja (tabla + gráfico), del mismo alto en toda su extensión.
    doc.setFillColor(241, 245, 249);
    doc.rect(MARGIN, HEADER_TOP, PAGE_W - MARGIN * 2, HEADER_H, "F");

    // Encabezado de columnas de la tabla, alineado abajo de esa franja.
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.4); doc.setTextColor(71, 85, 105);
    let cx = MARGIN;
    [["Id", COL.id], ["Nombre de tarea", COL.name], ["Duración", COL.duration], ["Comienzo", COL.start], ["Fin", COL.end]].forEach(([label, w]) => {
      doc.text(label, cx + 1, HEADER_TOP + HEADER_H - 1.5);
      cx += w;
    });

    // Eje de tiempo: franja de mes arriba, ticks de día/semana debajo (o solo mes, centrado, si la escala es mensual).
    doc.setDrawColor(203, 213, 225);
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.6); doc.setTextColor(51, 65, 85);
    const monthLabelY = scale.unit === "month" ? HEADER_TOP + HEADER_H / 2 + 1.5 : HEADER_TOP + 4;
    monthBands.forEach((band) => {
      const x1 = xForDate(band.start), x2 = xForDate(band.end);
      doc.text(band.label, (x1 + x2) / 2, monthLabelY, { align: "center" });
      doc.line(x1, HEADER_TOP, x1, PAGE_H - MARGIN);
    });
    if (scale.unit !== "month") {
      doc.setFont("helvetica", "normal"); doc.setFontSize(6); doc.setTextColor(148, 163, 184);
      ticks.forEach((tick) => {
        const x = xForDate(tick);
        doc.text(String(tick.getDate()), x, HEADER_TOP + HEADER_H - 1.5, { align: "center" });
        doc.setDrawColor(226, 232, 240);
        doc.line(x, CHART_TOP, x, PAGE_H - MARGIN);
      });
    }
    doc.setDrawColor(148, 163, 184);
    doc.line(MARGIN, HEADER_TOP, PAGE_W - MARGIN, HEADER_TOP);
    doc.line(MARGIN, CHART_TOP, PAGE_W - MARGIN, CHART_TOP);
    doc.line(MARGIN + LABEL_W, HEADER_TOP, MARGIN + LABEL_W, PAGE_H - MARGIN);

    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
    doc.text(`Página ${pageIndex + 1} de ${pageCount}`, PAGE_W / 2, PAGE_H - 4, { align: "center" });
  };

  const rowY = (globalIndex) => CHART_TOP + (globalIndex % rowsPerPage) * ROW_H;

  for (let page = 0; page < pageCount; page++) {
    if (page > 0) doc.addPage();
    const pageTasks = tasks.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
    drawHeader(page);

    pageTasks.forEach((task, localIndex) => {
      const y = CHART_TOP + localIndex * ROW_H;
      // Las secciones (tareas resumen) llevan una franja gris de ancho completo para que se
      // distingan de un vistazo, igual que en el reporte nativo de MS Project.
      if (task.isSummary) { doc.setFillColor(241, 245, 249); doc.rect(MARGIN, y, PAGE_W - MARGIN * 2, ROW_H, "F"); }
      else if (localIndex % 2 === 1) { doc.setFillColor(250, 250, 251); doc.rect(MARGIN, y, PAGE_W - MARGIN * 2, ROW_H, "F"); }
    });

    // Fin de semana sombreado, por encima de las bandas de fila pero por debajo de las barras:
    // ayuda a ubicarse en el tiempo sin agregar más líneas ni color. Solo con detalle diario.
    if (scale.unit === "day") {
      doc.setFillColor(237, 241, 246);
      for (let d = new Date(min); d <= max; d = addDays(d, 1)) {
        if (d.getDay() === 0 || d.getDay() === 6) doc.rect(xForDate(d), CHART_TOP, dayW, pageTasks.length * ROW_H, "F");
      }
    }

    pageTasks.forEach((task, localIndex) => {
      const globalIndex = page * rowsPerPage + localIndex;
      const y = rowY(globalIndex);
      const depth = depthOf(task, byId);

      // --- columnas de texto ---
      doc.setFont("helvetica", task.isSummary ? "bold" : "normal");
      doc.setFontSize(6.6); doc.setTextColor(51, 65, 85);
      doc.text(truncateToWidth(doc, wbsById.get(task.id) || "", COL.id - 2), MARGIN + 1, y + ROW_H - 1.7);
      const nameX = MARGIN + COL.id + 1 + depth * INDENT_PER_LEVEL;
      const nameMaxWidth = COL.name - 1 - depth * INDENT_PER_LEVEL - 2; // deja 2mm de aire antes de "Duración"
      doc.text(truncateToWidth(doc, task.name, nameMaxWidth), nameX, y + ROW_H - 1.7);
      doc.setFont("helvetica", "normal"); doc.setTextColor(100, 116, 139);
      doc.text(`${task.durationDays ?? Math.max(1, daysBetween(task.start, task.end) + 1)} d`, MARGIN + COL.id + COL.name + 1, y + ROW_H - 1.7);
      doc.text(shortDate(task.start), MARGIN + COL.id + COL.name + COL.duration + 1, y + ROW_H - 1.7);
      doc.text(shortDate(task.end), MARGIN + COL.id + COL.name + COL.duration + COL.start + 1, y + ROW_H - 1.7);

      // --- barra / hito ---
      const x1 = xForDate(task.start), x2 = xForDate(task.end);
      const barW = Math.max(0.8, x2 - x1);
      const barY = y + 1.2, barH = ROW_H - 2.4;

      if (task.milestone) {
        const cx = x1, cy = y + ROW_H / 2, r = 1.7;
        doc.setFillColor(...MILESTONE_COLOR);
        doc.triangle(cx - r, cy, cx, cy - r, cx + r, cy, "F");
        doc.triangle(cx - r, cy, cx, cy + r, cx + r, cy, "F");
        doc.setFontSize(6.2); doc.setTextColor(...MILESTONE_COLOR);
        doc.text(shortDate(task.start).slice(0, 5), cx + r + 1, cy + 1);
      } else if (task.isSummary) {
        doc.setFillColor(51, 65, 85);
        doc.roundedRect(x1, barY, barW, barH, 0.4, 0.4, "F");
        // Puntas tipo "resumen" de MS Project (triángulos hacia abajo en los extremos).
        doc.triangle(x1, barY + barH, x1 + 1.4, barY + barH, x1, barY + barH + 1.4, "F");
        doc.triangle(x1 + barW, barY + barH, x1 + barW - 1.4, barY + barH, x1 + barW, barY + barH + 1.4, "F");
        // Nombre + duración sobre la propia barra, si entra; si no, va antes del inicio.
        doc.setFont("helvetica", "bold"); doc.setFontSize(6.4); doc.setTextColor(255, 255, 255);
        const inline = `${task.name} · ${task.durationDays ?? ""} d`;
        if (doc.getTextWidth(inline) < barW - 2) doc.text(inline, x1 + barW / 2, barY + barH - 0.7, { align: "center" });
      } else {
        doc.setFillColor(...TASK_COLOR.light);
        doc.roundedRect(x1, barY, barW, barH, 0.5, 0.5, "F");
        if (task.percentComplete > 0) {
          doc.setFillColor(...TASK_COLOR.strong);
          doc.roundedRect(x1, barY, barW * (Math.min(100, task.percentComplete) / 100), barH, 0.5, 0.5, "F");
        }
        doc.setDrawColor(...TASK_COLOR.strong);
        doc.setLineWidth(0.12);
        doc.roundedRect(x1, barY, barW, barH, 0.5, 0.5, "S");
      }
    });

    // Dependencias: conector en escuadra (fin de la predecesora → inicio de la sucesora).
    // Punteado y muy claro a propósito: con muchas dependencias este trazo puede volverse un
    // enredo visual que compite con las barras; que quede en segundo plano, no protagonista.
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.1);
    doc.setLineDashPattern([0.6, 0.5], 0);
    pageTasks.forEach((task, localIndex) => {
      const globalIndex = page * rowsPerPage + localIndex;
      (task.predecessors || []).forEach((dep) => {
        const predecessor = byId.get(dep.taskId);
        if (!predecessor) return;
        const predecessorGlobalIndex = tasks.indexOf(predecessor);
        if (predecessorGlobalIndex < page * rowsPerPage || predecessorGlobalIndex >= (page + 1) * rowsPerPage) return; // no cruza páginas
        const py = rowY(predecessorGlobalIndex) + ROW_H / 2;
        const y = rowY(globalIndex) + ROW_H / 2;
        const px = xForDate(predecessor.end);
        const x1 = xForDate(task.start);
        const midX = px + Math.max(1, (x1 - px) / 2);
        doc.line(px, py, midX, py);
        doc.line(midX, py, midX, y);
        doc.line(midX, y, x1, y);
      });
    });
    doc.setLineDashPattern([], 0); // vuelve a trazo sólido antes de la próxima página (encabezado, grillas)
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    try { drawProductMark(doc, PAGE_W / 2 - 8, PAGE_H - 8, 3.6); } catch {}
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.6); doc.setTextColor(14, 165, 197);
    doc.text("MiOrdenGo", PAGE_W / 2 - 3, PAGE_H - 5.2);
  }
  doc.save(fileName || `Gantt_${projectName.replace(/[^A-Za-z0-9]+/g, "_")}.pdf`);
}
