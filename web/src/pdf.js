import { jsPDF } from "jspdf";
import { LOGO, LOGO_RATIO } from "./logo.js";

// Ancho del logo en el PDF (mm)
const LOGO_W = 42;

const money = (n) => "$" + (Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function totals(o) {
  const labor = o.laborBillable ? (Number(o.laborHours) || 0) * (Number(o.rate) || 0) : 0;
  const mats = (o.materials || []).filter((m) => m.billable).reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.price) || 0), 0);
  return { labor, mats, total: labor + mats };
}
function costs(o) {
  const labor = (Number(o.laborHours) || 0) * (Number(o.laborCost) || 0);
  const mats = (o.materials || []).reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.cost) || 0), 0);
  return { labor, mats, total: labor + mats };
}
// Dibuja el logo arriba a la izquierda; devuelve el alto ocupado
function drawLogo(doc, M, y) {
  const w = LOGO_W, h = w * LOGO_RATIO;
  try { doc.addImage(LOGO, "PNG", M, y, w, h); } catch {}
  return h;
}

export function buildOrderReceiptPDF(order, audience = "client") {
  const doc = new jsPDF("p", "mm", "a4");
  const W = 210, M = 15;
  const internal = audience === "internal";
  const priced = internal;
  const technical = order.technical || {};
  let y = 16;
  const brk = (need = 8) => { if (y + need > 282) { doc.addPage(); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139); doc.text(`${order.id} - CONTINUACIÓN`, M, 14); doc.setDrawColor(226, 232, 240); doc.line(M, 17, W - M, 17); y = 24; } };

  /* Encabezado con logo */
  const lh = drawLogo(doc, M, y - 4);
  doc.setFontSize(11); doc.setTextColor(100, 116, 139);
  doc.text(internal ? "INFORME TÉCNICO INTERNO" : "REPORTE DE SERVICIO TÉCNICO", W - M, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`Folio: ${order.id}`, W - M, y, { align: "right" }); y += 4;
  doc.text(`Fecha: ${order.date || ""}`, W - M, y, { align: "right" });
  y = Math.max(y, (y - 10) + lh) ; // asegura espacio bajo el logo
  doc.setDrawColor(226, 232, 240); doc.line(M, y + 2, W - M, y + 2); y += 9;

  /* Datos */
  doc.setTextColor(15, 23, 42); doc.setFontSize(10);
  const kv = (k, v) => { doc.setFont("helvetica", "bold"); doc.text(k, M, y); doc.setFont("helvetica", "normal"); doc.text(String(v || "—"), M + 46, y); y += 5.5; };
  kv("Cliente:", order.client);
  kv("Sitio:", order.site);
  if (order.contact) kv("Contacto:", order.contact);
  kv("Servicio:", order.service);
  kv("Estado:", order.status);
  if (order.tech) kv("Técnico:", order.tech);
  if (order.category) kv("Clasificación:", order.category);
  if (order.location?.label && order.location.label !== order.site) kv("Ubicación:", order.location.label);
  if (technical.assetTag) kv("TAG del activo:", technical.assetTag);
  if (technical.manufacturer || technical.model) kv("Fabricante / modelo:", [technical.manufacturer, technical.model].filter(Boolean).join(" / "));
  if (technical.serial) kv("N° de serie:", technical.serial);
  y += 2;

  const section = (t) => { brk(12); doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(241, 135, 0); doc.text(t, M, y); doc.setTextColor(15, 23, 42); y += 5; };
  const para = (label, val) => {
    if (!val) return; brk(10);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.text(label + " ", M, y);
    const w = doc.getTextWidth(label + " ");
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(String(val), W - 2 * M - w);
    doc.text(lines, M + w, y); y += lines.length * 4.6 + 1.5;
  };

  /* Detalle */
  section("Detalle del trabajo");
  para("Equipo:", order.equipo);
  para("Síntoma:", order.sintoma);
  para("Diagnóstico:", technical.diagnosis);
  para("Causa raíz:", technical.rootCause);
  para("Trabajo realizado:", order.solucion);
  y += 2;

  if (technical.reportedAt || technical.arrivalAt || technical.startedAt || technical.completedAt || technical.downtimeMinutes) {
    section("Cronología del servicio");
    const stamp = (value) => value ? new Date(value).toLocaleString("es-AR") : "—";
    para("Aviso recibido:", stamp(technical.reportedAt)); para("Llegada al sitio:", stamp(technical.arrivalAt));
    para("Inicio:", stamp(technical.startedAt)); para("Finalización:", stamp(technical.completedAt));
    if (technical.downtimeMinutes) para("Tiempo de parada:", `${technical.downtimeMinutes} minutos`);
  }

  if (technical.workPermit || technical.lotoApplied || technical.ppe || technical.safetyNotes) {
    section("Seguridad");
    para("Permiso / autorización:", technical.workPermit); para("LOTO:", technical.lotoApplied ? "Aplicado" : "No informado");
    para("EPP:", technical.ppe); para("Condiciones y medidas:", technical.safetyNotes);
  }

  if (technical.deviceType || technical.firmware || technical.programVersion || technical.backupRef || technical.ioVerified || technical.alarmsVerified || technical.setpointChanges) {
    section("Registro de automatización");
    para("Dispositivo:", technical.deviceType); para("Firmware:", technical.firmware); para("Versión de programa:", technical.programVersion);
    para("Respaldo:", technical.backupRef); para("E/S verificadas:", technical.ioVerified); para("Alarmas e interlocks:", technical.alarmsVerified); para("Cambios de parámetros:", technical.setpointChanges);
  }

  if (technical.measurementsBefore || technical.measurementsAfter || technical.testsPerformed || technical.testResult || technical.finalCondition) {
    section("Verificación y puesta en servicio");
    para("Mediciones iniciales:", technical.measurementsBefore); para("Mediciones finales:", technical.measurementsAfter);
    para("Pruebas realizadas:", technical.testsPerformed); para("Resultado / aceptación:", technical.testResult); para("Estado final:", technical.finalCondition);
  }

  if (technical.recommendations || technical.pendingActions || technical.followUpDate) {
    section("Recomendaciones y pendientes");
    para("Recomendaciones:", technical.recommendations); para("Acciones pendientes:", technical.pendingActions); para("Seguimiento sugerido:", technical.followUpDate);
  }

  /* Registro fotográfico */
  const fotos = (order.photos || []).filter((p) => p && p.url);
  if (fotos.length) {
    section("Registro fotográfico");
    const gap = 5, cols = 2, frameW = (W - 2 * M - gap) / cols, frameH = 50, rowH = 61;
    for (let i = 0; i < fotos.length; i += cols) {
      brk(rowH);
      fotos.slice(i, i + cols).forEach((p, offset) => {
        const x = M + offset * (frameW + gap);
        const fmt = /^data:image\/png/i.test(p.url) ? "PNG" : "JPEG";
        doc.setFillColor(248, 250, 252); doc.setDrawColor(203, 213, 225); doc.roundedRect(x, y, frameW, frameH, 1.5, 1.5, "FD");
        try {
          const props = doc.getImageProperties(p.url);
          const scale = Math.min((frameW - 2) / props.width, (frameH - 2) / props.height);
          const drawW = props.width * scale, drawH = props.height * scale;
          doc.addImage(p.url, fmt, x + (frameW - drawW) / 2, y + (frameH - drawH) / 2, drawW, drawH, undefined, "NONE");
        } catch {}
        const stamp = p.ts ? new Date(p.ts).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(71, 85, 105);
        doc.text(`FOTO ${i + offset + 1} - ${String(p.cat || "EVIDENCIA").toUpperCase()}`, x, y + frameH + 4);
        if (stamp) { doc.setFont("helvetica", "normal"); doc.setTextColor(100, 116, 139); doc.text(stamp, x + frameW, y + frameH + 4, { align: "right" }); }
      });
      y += rowH;
    }
    doc.setTextColor(15, 23, 42);
  }

  /* Materiales */
  if ((order.materials || []).length) {
    section("Materiales y repuestos");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139);
    doc.text("Cant.", M, y); doc.text("Descripción", M + 16, y);
    if (priced) { doc.text("Costo u.", W - M - 38, y, { align: "right" }); doc.text("Venta u.", W - M, y, { align: "right" }); }
    y += 2; doc.setDrawColor(241, 245, 249); doc.line(M, y, W - M, y); y += 4;
    doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42); doc.setFontSize(9);
    (order.materials || []).forEach((m) => {
      brk(8);
      doc.text(String(m.qty || 0), M, y);
      const trace = [m.partNumber && `P/N ${m.partNumber}`, m.brand, m.model, m.serial && `S/N ${m.serial}`, internal && m.supplier && `Prov. ${m.supplier}`].filter(Boolean).join(" · ");
      const nm = doc.splitTextToSize(`${String(m.name || "—")}${trace ? `\n${trace}` : ""}`, priced ? 95 : 150);
      doc.text(nm, M + 16, y);
      if (priced) {
        doc.text(money(m.cost), W - M - 38, y, { align: "right" });
        doc.text(money(m.price), W - M, y, { align: "right" });
      }
      y += Math.max(nm.length * 4.3, 5);
    });
    y += 3;
  }

  /* Mano de obra */
  section("Mano de obra");
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  doc.text(`Horas: ${order.laborHours || 0}${order.technicians ? `    ·    Técnicos: ${order.technicians}` : ""}`, M, y); y += 5;
  if (priced) { doc.text(`Tarifa por hora: ${money(order.rate)}`, M, y); y += 5; }
  y += 2;

  /* Totales (solo con importes) */
  if (priced) {
    brk(45);
    const t = totals(order), c = costs(order), margin = t.total - c.total, pct = t.total ? Math.round((margin / t.total) * 100) : 0; const bw = 84, bx = W - M - bw;
    doc.setDrawColor(226, 232, 240); doc.setFillColor(248, 250, 252);
    doc.roundedRect(bx, y, bw, 36, 2, 2, "FD");
    doc.setFontSize(9); doc.setTextColor(71, 85, 105); doc.setFont("helvetica", "normal");
    doc.text("Mano de obra", bx + 3, y + 6); doc.text(money(t.labor), bx + bw - 3, y + 6, { align: "right" });
    doc.text("Materiales", bx + 3, y + 11.5); doc.text(money(t.mats), bx + bw - 3, y + 11.5, { align: "right" });
    doc.setDrawColor(226, 232, 240); doc.line(bx + 3, y + 14.5, bx + bw - 3, y + 14.5);
    doc.setFont("helvetica", "bold"); doc.setTextColor(15, 23, 42); doc.setFontSize(10.5);
    doc.text("TOTAL", bx + 3, y + 20); doc.text(money(t.total), bx + bw - 3, y + 20, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139);
    doc.text("Costo interno", bx + 3, y + 26); doc.text(money(c.total), bx + bw - 3, y + 26, { align: "right" });
    doc.setFont("helvetica", "bold"); doc.setTextColor(margin >= 0 ? 5 : 190, margin >= 0 ? 150 : 24, margin >= 0 ? 105 : 93);
    doc.text(`Margen (${pct}%)`, bx + 3, y + 32); doc.text(money(margin), bx + bw - 3, y + 32, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 42;
  }

  if (internal && (technical.warranty || technical.recurrence || technical.internalNotes || (order.activity || []).length)) {
    section("Gestión interna");
    para("Garantía:", technical.warranty); para("Recurrencia:", technical.recurrence); para("Notas internas:", technical.internalNotes);
    if ((order.activity || []).length) para("Trazabilidad:", (order.activity || []).map((entry) => `${entry.at ? new Date(entry.at).toLocaleString("es-AR") : ""} ${entry.byName || ""}: ${entry.text || ""}`.trim()).join("\n"));
  }

  /* Firma */
  brk(40);
  section("Conformidad del cliente");
  if (order.signatureUrl && order.signatureUrl !== "signed") {
    try { doc.addImage(order.signatureUrl, "PNG", M, y, 50, 22); } catch {}
    y += 24;
  } else { y += 4; }
  doc.setDrawColor(148, 163, 184); doc.line(M, y, M + 62, y); y += 4;
  doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  doc.text(`Firma del cliente${order.signedBy ? "  ·  " + order.signedBy : ""}`, M, y);
  if (technical.signerRole || technical.signerCompany) { y += 4.5; doc.setFontSize(8); doc.text([technical.signerRole, technical.signerCompany].filter(Boolean).join(" · "), M, y); }
  if (order.noSignReason) { y += 5; doc.setFontSize(8); doc.setTextColor(180, 83, 9); doc.text(doc.splitTextToSize(`Orden aprobada sin firma. Motivo: ${order.noSignReason}`, W - 2 * M), M, y); }

  /* Pie y numeración */
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setDrawColor(226, 232, 240); doc.line(M, 285, W - M, 285);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
    doc.text(`Generado el ${new Date().toLocaleString("es-AR")} - ${internal ? "Uso interno y confidencial" : "Reporte para cliente sin costos internos"}`, M, 290);
    doc.text(`Página ${page} de ${pages}`, W - M, 290, { align: "right" });
  }

  return doc;
}

export function clientOrderReportPDF(order) { buildOrderReceiptPDF(order, "client").save(`${order.id}_cliente.pdf`); }
export function internalOrderReportPDF(order) { buildOrderReceiptPDF(order, "internal").save(`${order.id}_interno.pdf`); }

export function monthlyReportPDF(month, monthLabel, rows, sum) {
  const doc = new jsPDF("p", "mm", "a4");
  const W = 210, M = 15;
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  let y = 16;
  let drawHead = () => {};
  const brk = (need = 8) => { if (y + need > 285) { doc.addPage(); y = 20; drawHead(); } };

  const lh = drawLogo(doc, M, y - 4);
  doc.setFontSize(11); doc.setTextColor(100, 116, 139);
  doc.text("REPORTE MENSUAL POR CLIENTE", W - M, y, { align: "right" });
  y += 6; doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(cap(monthLabel), W - M, y, { align: "right" });
  y = Math.max(y, (y - 10) + lh);
  doc.setDrawColor(226, 232, 240); doc.line(M, y + 2, W - M, y + 2); y += 9;

  doc.setFontSize(9.5); doc.setTextColor(15, 23, 42);
  doc.text(`Órdenes: ${sum.count}     ·     Clientes: ${rows.length}`, M, y); y += 5;
  doc.text(`Total: ${money(sum.total)}     ·     Facturado: ${money(sum.facturado)}     ·     Por facturar: ${money(sum.pendiente)}`, M, y); y += 8;

  const cols = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text("Cliente", M, y);
    doc.text("Órd", M + 74, y, { align: "right" });
    doc.text("Horas", M + 92, y, { align: "right" });
    doc.text("M. Obra", M + 120, y, { align: "right" });
    doc.text("Materiales", M + 150, y, { align: "right" });
    doc.text("Total", M + 180, y, { align: "right" });
    y += 2; doc.setDrawColor(226, 232, 240); doc.line(M, y, W - M, y); y += 4;
  };
  drawHead = cols; cols();

  doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42); doc.setFontSize(8.5);
  rows.forEach((r) => {
    brk(8);
    const nm = doc.splitTextToSize(String(r.client), 56);
    doc.text(nm[0] + (nm.length > 1 ? "…" : ""), M, y);
    doc.text(String(r.count), M + 74, y, { align: "right" });
    doc.text(String(r.hours), M + 92, y, { align: "right" });
    doc.text(money(r.labor), M + 120, y, { align: "right" });
    doc.text(money(r.mats), M + 150, y, { align: "right" });
    doc.text(money(r.total), M + 180, y, { align: "right" });
    y += 5.5;
    if (r.pendiente > 0) {
      doc.setTextColor(180, 83, 9); doc.setFontSize(7.5);
      doc.text(`Por facturar: ${money(r.pendiente)}`, M + 4, y - 0.5);
      doc.setTextColor(15, 23, 42); doc.setFontSize(8.5); y += 3;
    }
  });

  brk(12); doc.setDrawColor(148, 163, 184); doc.line(M, y, W - M, y); y += 5.5;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
  doc.text("TOTAL DEL MES", M, y);
  doc.text(money(sum.total), M + 180, y, { align: "right" });

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
  doc.text(`Generado el ${new Date().toLocaleString("es-MX")}`, M, 290);

  doc.save(`reporte_${month}.pdf`);
}
