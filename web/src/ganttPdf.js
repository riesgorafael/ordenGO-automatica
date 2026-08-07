// Exporta el Gantt a PDF dibujando vectores con jsPDF (mismo criterio que pdf.js en este proyecto),
// en vez de rasterizar una captura de pantalla con html2canvas: el resultado es más nítido, más
// liviano, y el texto sigue siendo seleccionable/buscable dentro del PDF.

import { jsPDF } from "jspdf";

const PAGE_W = 297, PAGE_H = 210; // A4 apaisado: un Gantt es naturalmente más ancho que alto
const MARGIN = 12;
const ROW_H = 6.5;
const LABEL_W = 60; // columna izquierda con el nombre de cada tarea

function dateRange(tasks) {
  const starts = tasks.map((t) => new Date(`${t.start}T00:00:00`).getTime());
  const ends = tasks.map((t) => new Date(`${t.end}T00:00:00`).getTime());
  return { min: new Date(Math.min(...starts)), max: new Date(Math.max(...ends)) };
}

function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function daysBetween(a, b) { return Math.round((b.setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0)) / 86400000); }

export function exportGanttToPdf(tasks, { projectName = "Proyecto", fileName } = {}) {
  if (!tasks.length) return;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const { min, max } = dateRange(tasks);
  const totalDays = Math.max(1, daysBetween(min, max) + 1);
  const chartW = PAGE_W - MARGIN * 2 - LABEL_W;
  const dayW = chartW / totalDays;
  const xForDate = (dateStr) => MARGIN + LABEL_W + daysBetween(min, new Date(`${dateStr}T00:00:00`)) * dayW;

  const rowsPerPage = Math.floor((PAGE_H - MARGIN * 2 - 16) / ROW_H);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const drawHeader = (pageTasks, isFirstPage) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
    if (isFirstPage) doc.text(`Cronograma · ${projectName}`, MARGIN, 10);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
    doc.text(`Generado ${new Date().toLocaleDateString("es-AR")}`, PAGE_W - MARGIN, 10, { align: "right" });

    // Escala de tiempo: una marca por semana para no saturar el eje.
    doc.setDrawColor(226, 232, 240);
    let cursor = new Date(min);
    let weekIndex = 0;
    while (cursor <= max) {
      const x = xForDate(cursor.toISOString().slice(0, 10));
      doc.line(x, 14, x, PAGE_H - MARGIN);
      doc.setFontSize(6.5); doc.setTextColor(148, 163, 184);
      doc.text(cursor.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }), x + 0.5, 13);
      cursor = addDays(cursor, 7);
      weekIndex++;
    }
    doc.setDrawColor(203, 213, 225);
    doc.line(MARGIN, 14, PAGE_W - MARGIN, 14);
  };

  for (let page = 0; page * rowsPerPage < tasks.length; page++) {
    if (page > 0) doc.addPage();
    const pageTasks = tasks.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
    drawHeader(pageTasks, page === 0);

    pageTasks.forEach((task, index) => {
      const y = 18 + index * ROW_H;

      // Nombre de la tarea (columna izquierda), con sangría según jerarquía.
      const depth = (() => { let d = 0, current = task; while (current.parentId && byId.has(current.parentId)) { d++; current = byId.get(current.parentId); } return d; })();
      doc.setFont("helvetica", task.isSummary ? "bold" : "normal");
      doc.setFontSize(7); doc.setTextColor(30, 41, 59);
      const label = doc.splitTextToSize(task.name, LABEL_W - depth * 3 - 2)[0];
      doc.text(label, MARGIN + depth * 3, y + ROW_H - 2);

      // Barra de la tarea.
      const x1 = xForDate(task.start), x2 = xForDate(task.end);
      const barW = Math.max(1, x2 - x1);
      if (task.milestone) {
        doc.setFillColor(241, 135, 0);
        doc.triangle(x1, y + 1, x1 + 2, y + ROW_H / 2, x1, y + ROW_H - 1, "F");
      } else {
        doc.setFillColor(task.isSummary ? 100 : 186, task.isSummary ? 116 : 230, task.isSummary ? 139 : 253);
        doc.roundedRect(x1, y + 1, barW, ROW_H - 2, 0.6, 0.6, "F");
        if (task.percentComplete > 0) {
          doc.setFillColor(2, 132, 199);
          doc.roundedRect(x1, y + 1, barW * (Math.min(100, task.percentComplete) / 100), ROW_H - 2, 0.6, 0.6, "F");
        }
      }

      // Flechas de dependencia (línea simple predecesora → esta tarea).
      doc.setDrawColor(148, 163, 184);
      (task.predecessors || []).forEach((dep) => {
        const predecessor = byId.get(dep.taskId);
        if (!predecessor) return;
        const predecessorIndex = tasks.indexOf(predecessor);
        if (predecessorIndex < page * rowsPerPage || predecessorIndex >= (page + 1) * rowsPerPage) return; // no cruza páginas
        const py = 18 + (predecessorIndex - page * rowsPerPage) * ROW_H + ROW_H / 2;
        const px = xForDate(predecessor.end);
        doc.line(px, py, x1, y + ROW_H / 2);
      });
    });
  }

  doc.save(fileName || `Gantt_${projectName.replace(/[^A-Za-z0-9]+/g, "_")}.pdf`);
}
