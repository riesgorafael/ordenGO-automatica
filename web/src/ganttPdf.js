// Exporta el Gantt a PDF dibujando vectores con jsPDF (mismo criterio que pdf.js en este proyecto):
// texto seleccionable/buscable y trazo nítido, en vez de rasterizar una captura de pantalla.

import { jsPDF } from "jspdf";

const PAGE_W = 297, PAGE_H = 210; // A4 apaisado
const MARGIN = 12;
const ROW_H = 6;
const HEADER_Y = 22; // alto reservado para título + eje de tiempo
const LABEL_W = 62; // columna izquierda con el nombre de cada tarea
const INDENT_PER_LEVEL = 3.2;

const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };
const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1);
const daysBetween = (a, b) => Math.round((new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0)) / 86400000);
const parseDate = (str) => new Date(`${str}T00:00:00`);

function dateRange(tasks) {
  const starts = tasks.map((t) => parseDate(t.start).getTime());
  const ends = tasks.map((t) => parseDate(t.end).getTime());
  return { min: new Date(Math.min(...starts)), max: new Date(Math.max(...ends)) };
}

/** Elige una granularidad de eje legible según cuánto abarca el cronograma completo. */
function pickTimeScale(min, max) {
  const totalDays = daysBetween(min, max) + 1;
  if (totalDays <= 45) return { unit: "day", step: 7, labelFmt: (d) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) };
  if (totalDays <= 150) return { unit: "week", step: 14, labelFmt: (d) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) };
  if (totalDays <= 420) return { unit: "month", step: 1, labelFmt: (d) => d.toLocaleDateString("es-AR", { month: "short", year: "2-digit" }) };
  return { unit: "month", step: 3, labelFmt: (d) => d.toLocaleDateString("es-AR", { month: "short", year: "2-digit" }) };
}

function buildTicks(min, max, scale) {
  const ticks = [];
  if (scale.unit === "month") {
    let cursor = startOfMonth(min);
    while (cursor <= max) { ticks.push(new Date(cursor)); cursor = addMonths(cursor, scale.step); }
  } else {
    let cursor = new Date(min);
    while (cursor <= max) { ticks.push(new Date(cursor)); cursor = addDays(cursor, scale.step); }
  }
  return ticks;
}

/** Profundidad de una tarea según su cadena de parentId (0 = raíz). */
function depthOf(task, byId) {
  let depth = 0, current = task;
  const seen = new Set();
  while (current.parentId && byId.has(current.parentId) && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    depth++;
    current = byId.get(current.parentId);
  }
  return depth;
}

export function exportGanttToPdf(tasks, { projectName = "Proyecto", fileName } = {}) {
  if (!tasks.length) return;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const { min, max } = dateRange(tasks);
  const scale = pickTimeScale(min, max);
  const ticks = buildTicks(min, max, scale);
  const totalDays = Math.max(1, daysBetween(min, max) + 1);
  const chartW = PAGE_W - MARGIN * 2 - LABEL_W;
  const dayW = chartW / totalDays;
  const xForDate = (dateStr) => MARGIN + LABEL_W + daysBetween(min, typeof dateStr === "string" ? parseDate(dateStr) : dateStr) * dayW;
  const rowsPerPage = Math.floor((PAGE_H - MARGIN - HEADER_Y) / ROW_H);
  const pageCount = Math.ceil(tasks.length / rowsPerPage);

  const drawHeader = (pageIndex) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
    doc.text(`Cronograma · ${projectName}`, MARGIN, 10);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
    doc.text(`Generado ${new Date().toLocaleDateString("es-AR")} · Página ${pageIndex + 1} de ${pageCount}`, PAGE_W - MARGIN, 10, { align: "right" });

    // Leyenda
    const legend = [["#94a3b8", "Resumen"], ["#0284c7", "Tarea"], ["#f18700", "Hito"]];
    let lx = MARGIN;
    doc.setFontSize(6.8);
    legend.forEach(([color, label]) => {
      doc.setFillColor(color);
      doc.roundedRect(lx, 13.2, 3, 2.2, 0.4, 0.4, "F");
      doc.setTextColor(71, 85, 105);
      doc.text(label, lx + 4, 15);
      lx += doc.getTextWidth(label) + 9;
    });

    // Eje de tiempo
    doc.setDrawColor(226, 232, 240);
    ticks.forEach((tick) => {
      const x = xForDate(tick);
      doc.line(x, HEADER_Y, x, PAGE_H - MARGIN);
      doc.setFontSize(6.3); doc.setTextColor(148, 163, 184);
      doc.text(scale.labelFmt(tick), x + 0.5, HEADER_Y - 1.5);
    });
    doc.setDrawColor(203, 213, 225);
    doc.line(MARGIN, HEADER_Y, PAGE_W - MARGIN, HEADER_Y);
    doc.line(MARGIN + LABEL_W, 12, MARGIN + LABEL_W, PAGE_H - MARGIN);
  };

  const rowY = (globalIndex) => HEADER_Y + (globalIndex % rowsPerPage) * ROW_H;

  for (let page = 0; page < pageCount; page++) {
    if (page > 0) doc.addPage();
    drawHeader(page);
    const pageTasks = tasks.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

    // Bandas alternadas para que se puedan seguir las filas con la vista.
    pageTasks.forEach((task, localIndex) => {
      if (localIndex % 2 === 1) { doc.setFillColor(248, 250, 252); doc.rect(MARGIN, HEADER_Y + localIndex * ROW_H, PAGE_W - MARGIN * 2, ROW_H, "F"); }
    });

    pageTasks.forEach((task, localIndex) => {
      const globalIndex = page * rowsPerPage + localIndex;
      const y = rowY(globalIndex);
      const depth = depthOf(task, byId);

      doc.setFont("helvetica", task.isSummary ? "bold" : "normal");
      doc.setFontSize(6.8); doc.setTextColor(30, 41, 59);
      const label = doc.splitTextToSize(task.name, LABEL_W - depth * INDENT_PER_LEVEL - 3)[0];
      doc.text(label, MARGIN + 1.5 + depth * INDENT_PER_LEVEL, y + ROW_H - 1.8);

      const x1 = xForDate(task.start), x2 = xForDate(task.end);
      const barW = Math.max(0.8, x2 - x1);
      const barY = y + 1.1, barH = ROW_H - 2.2;

      if (task.milestone) {
        const cx = x1, cy = y + ROW_H / 2, r = 1.6;
        doc.setFillColor(241, 135, 0);
        doc.triangle(cx - r, cy, cx, cy - r, cx + r, cy, "F");
        doc.triangle(cx - r, cy, cx, cy + r, cx + r, cy, "F");
      } else if (task.isSummary) {
        doc.setFillColor(71, 85, 105);
        doc.rect(x1, barY, barW, barH, "F");
        // Puntas tipo "resumen" de MS Project (pequeños triángulos hacia abajo en los extremos).
        doc.triangle(x1, barY + barH, x1 + 1.6, barY + barH, x1, barY + barH + 1.6, "F");
        doc.triangle(x1 + barW, barY + barH, x1 + barW - 1.6, barY + barH, x1 + barW, barY + barH + 1.6, "F");
      } else {
        doc.setFillColor(191, 219, 254);
        doc.roundedRect(x1, barY, barW, barH, 0.5, 0.5, "F");
        if (task.percentComplete > 0) {
          doc.setFillColor(2, 132, 199);
          doc.roundedRect(x1, barY, barW * (Math.min(100, task.percentComplete) / 100), barH, 0.5, 0.5, "F");
        }
        doc.setDrawColor(148, 163, 184);
        doc.roundedRect(x1, barY, barW, barH, 0.5, 0.5, "S");
      }
    });

    // Dependencias: conector en escuadra (fin de la predecesora → inicio de la sucesora),
    // no una línea diagonal directa — así no cruza el resto de las barras en zigzag.
    doc.setDrawColor(180, 190, 202);
    doc.setLineWidth(0.15);
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
  }

  doc.save(fileName || `Gantt_${projectName.replace(/[^A-Za-z0-9]+/g, "_")}.pdf`);
}
