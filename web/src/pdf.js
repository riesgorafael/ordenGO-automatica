import { jsPDF } from "jspdf";
import { LOGO, LOGO_RATIO } from "./logo.js";

// Ancho del logo en el PDF (mm)
const LOGO_W = 42;

const money = (n) => "USD " + (Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatDate = (value) => {
  if (!value) return "—";
  const plain = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (plain) return `${plain[3]}/${plain[2]}/${plain[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
};
const formatStamp = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};
const billedHours = (o) => {
  if (o.billableHours !== undefined && o.billableHours !== null && o.billableHours !== "") return Math.max(0, Number(o.billableHours) || 0);
  const effective = Math.max(0, Number(o.laborHours) || 0), waiting = Math.max(0, Number(o.technical?.billableWaitMinutes) || 0) / 60;
  const arrival = o.technical?.arrivalAt ? new Date(o.technical.arrivalAt).getTime() : NaN;
  const end = o.technical?.completedAt ? new Date(o.technical.completedAt).getTime() : Date.now();
  const onSite = Number.isFinite(arrival) && Number.isFinite(end) ? Math.max(0, end - arrival) : 0;
  return onSite > 0 && onSite < 3600000 ? 2 : Math.round((effective + waiting) * 100) / 100;
};
function totals(o) {
  const hours = billedHours(o);
  const labor = o.laborBillable ? hours * (Number(o.technicians) || 1) * (Number(o.rate) || 0) : 0;
  const mats = (o.materials || []).filter((m) => m.billable).reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.price) || 0), 0);
  return { labor, mats, total: labor + mats, hours };
}
function costs(o) {
  const actualHours = (Number(o.laborHours) || 0) + (Math.max(0, Number(o.technical?.billableWaitMinutes) || 0) / 60);
  const labor = actualHours * (Number(o.technicians) || 1) * (Number(o.laborCost) || 0);
  const mats = (o.materials || []).reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.cost) || 0), 0);
  return { labor, mats, total: labor + mats };
}
// Dibuja el logo arriba a la izquierda; devuelve el alto ocupado
function drawLogo(doc, M, y) {
  const w = LOGO_W, h = w * LOGO_RATIO;
  try { doc.addImage(LOGO, "PNG", M, y, w, h); } catch {}
  return h;
}

function drawServiceSummaryPage(doc, order, valued = false) {
  const W = 210, M = 15, technical = order.technical || {}, t = totals(order);
  drawLogo(doc, M, 12);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(100, 116, 139);
  ["CUIT: 20-35196020-6", "Bv. Ovidio Lagos 160 - Venado Tuerto (Santa Fe)", "Tel.: +54 3462 596041", "www.automatica-arg.com.ar"].forEach((line, index) => doc.text(line, M, 30 + index * 3.8));
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
  doc.text(valued ? "CONSTANCIA DE SERVICIO VALORIZADA" : "CONSTANCIA DE SERVICIO", W - M, 16, { align: "right" });
  doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
  doc.text(`Orden de trabajo: ${order.id || "—"}`, W - M, 23, { align: "right" });
  doc.text(`Fecha: ${formatDate(order.date)}`, W - M, 28, { align: "right" });
  doc.setDrawColor(203, 213, 225); doc.line(M, 49, W - M, 49);

  const heading = (text, y) => { doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(241, 135, 0); doc.text(text, M, y); };
  const field = (label, value, x, y, width = 70) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.2); doc.setTextColor(71, 85, 105); doc.text(`${label}:`, x, y);
    doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42);
    const lines = doc.splitTextToSize(String(value || "—"), width);
    doc.text(lines.slice(0, 2), x + 31, y);
  };

  heading("Cliente y servicio", 58);
  field("Cliente", order.client, M, 66, 62); field("OT asociada", order.id, 110, 66, 52);
  field("Sitio", order.site, M, 73, 62); field("Presupuesto", order.quoteNumber, 110, 73, 52);
  field("Contacto", order.contact, M, 80, 62); field("Orden de compra", order.customerPO, 110, 80, 52);
  field("Servicio", order.service, M, 87, 62); field("Técnico", order.tech, 110, 87, 52);
  field("Equipo", order.equipo, M, 94, 62); field("TAG", technical.assetTag, 110, 94, 52);

  heading("Detalle del servicio", 106);
  doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240); doc.roundedRect(M, 111, W - 2 * M, 39, 2, 2, "FD");
  const summaryLine = (label, value, y) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105); doc.text(`${label}:`, M + 4, y);
    doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42);
    doc.text(doc.splitTextToSize(String(value || "—"), 139).slice(0, 2), M + 34, y);
  };
  summaryLine("Solicitud", order.sintoma, 118);
  summaryLine("Trabajo", order.solucion, 129);
  summaryLine("Resultado", [technical.finalCondition, technical.testResult].filter(Boolean).join(" - "), 140);

  let observationsY = 161;
  if (valued) {
    heading("Resumen valorizado - USD", 160);
    const rows = [["Mano de obra", `${t.hours} h x ${order.technicians || 1} técnico(s)`, t.labor], ["Materiales y repuestos", `${(order.materials || []).length} ítem(s)`, t.mats]];
    doc.setFontSize(8.5); doc.setDrawColor(226, 232, 240);
    rows.forEach(([label, detail, amount], index) => {
      const rowY = 168 + index * 8; doc.setFont("helvetica", "bold"); doc.setTextColor(15, 23, 42); doc.text(label, M, rowY);
      doc.setFont("helvetica", "normal"); doc.setTextColor(100, 116, 139); doc.text(detail, M + 48, rowY);
      doc.setTextColor(15, 23, 42); doc.text(money(amount), W - M, rowY, { align: "right" }); doc.line(M, rowY + 3, W - M, rowY + 3);
    });
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text("TOTAL", M, 187); doc.text(money(t.total), W - M, 187, { align: "right" });
    observationsY = 198;
  }

  heading("Observaciones y compromisos", observationsY);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42);
  const observations = [technical.recommendations, technical.pendingActions].filter(Boolean).join("  ");
  doc.text(doc.splitTextToSize(observations || "Sin observaciones adicionales.", W - 2 * M).slice(0, valued ? 6 : 10), M, observationsY + 7);

  const signatureY = 245;
  if (order.signatureUrl && order.signatureUrl !== "signed") { try { doc.addImage(order.signatureUrl, "PNG", M + 8, signatureY - 23, 44, 20); } catch {} }
  if (order.technicianSignatureUrl) { try { doc.addImage(order.technicianSignatureUrl, "PNG", W - M - 58, signatureY - 23, 44, 20); } catch {} }
  doc.setDrawColor(100, 116, 139); doc.line(M, signatureY, M + 72, signatureY); doc.line(W - M - 72, signatureY, W - M, signatureY);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(71, 85, 105);
  doc.text("CONFORMIDAD DEL CLIENTE", M + 36, signatureY + 5, { align: "center" }); doc.text("RESPONSABLE AUTOMÁTICA ARG", W - M - 36, signatureY + 5, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
  doc.text(order.signedBy || "Nombre y firma", M + 36, signatureY + 10, { align: "center" });
  doc.text([technical.signerRole, technical.signerCompany].filter(Boolean).join(" - ") || "Cargo / empresa", M + 36, signatureY + 14, { align: "center" });
  doc.text(order.technicianSignedBy || order.tech || "Técnico responsable", W - M - 36, signatureY + 10, { align: "center" });
  doc.text(order.signedAt ? `Conformidad: ${formatStamp(order.signedAt)}` : "Fecha y hora", M + 36, signatureY + 18, { align: "center" });
  doc.text(`Firma: ${formatStamp(order.technicianSignedAt || technical.completedAt || order.createdAt)}`, W - M - 36, signatureY + 14, { align: "center" });
}

export function buildOrderReceiptPDF(order, audience = "client") {
  const doc = new jsPDF("p", "mm", "a4");
  const W = 210, M = 15;
  const internal = audience === "internal";
  const valued = audience === "valued";
  const priced = internal;
  const showSales = internal || valued;
  const technical = order.technical || {};
  let y = 16;
  if (!internal) { drawServiceSummaryPage(doc, order, valued); doc.addPage(); }
  const brk = (need = 8) => { if (y + need > 282) { doc.addPage(); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139); doc.text(`${order.id} - CONTINUACIÓN`, M, 14); doc.setDrawColor(226, 232, 240); doc.line(M, 17, W - M, 17); y = 24; } };

  /* Encabezado con logo */
  const lh = drawLogo(doc, M, y - 4);
  doc.setFontSize(11); doc.setTextColor(100, 116, 139);
  doc.text(internal ? "INFORME TÉCNICO INTERNO" : "ANEXO TÉCNICO DE SERVICIO", W - M, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`Folio: ${order.id}`, W - M, y, { align: "right" }); y += 4;
  doc.text(`Fecha: ${formatDate(order.date)}`, W - M, y, { align: "right" });
  y = Math.max(y, (y - 10) + lh) ; // asegura espacio bajo el logo
  doc.setDrawColor(226, 232, 240); doc.line(M, y + 2, W - M, y + 2); y += 9;

  /* Datos */
  doc.setTextColor(15, 23, 42); doc.setFontSize(10);
  const kv = (k, v) => { doc.setFont("helvetica", "bold"); doc.text(k, M, y); doc.setFont("helvetica", "normal"); doc.text(String(v || "—"), M + 46, y); y += 5.5; };
  kv("Cliente:", order.client);
  kv("Sitio:", order.site);
  if (order.contact && (internal || String(order.contact).trim().toLowerCase() !== String(order.signedBy || "").trim().toLowerCase())) kv("Solicitante / contacto:", order.contact);
  kv("Servicio:", order.service);
  if (internal) kv("Estado de la orden:", order.status);
  if (internal && order.quoteNumber) kv("Presupuesto:", order.quoteNumber);
  if (internal && order.customerPO) kv("Orden de compra:", order.customerPO);
  if (order.tech) kv("Técnico:", order.tech);
  if (internal && order.category) kv("Clasificación:", order.category);
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
    doc.text(lines, M + w, y); y += lines.length * 4.6 + 2.2;
  };

  /* Detalle */
  section("Detalle del trabajo");
  para("Equipo:", order.equipo);
  para("Síntoma:", order.sintoma);
  para("Diagnóstico:", technical.diagnosis);
  para("Causa raíz:", technical.rootCause);
  para("Trabajo realizado:", order.solucion);
  y += 2;

  if (internal && (technical.reportedAt || technical.arrivalAt || technical.startedAt || technical.completedAt || technical.downtimeMinutes)) {
    section("Cronología del servicio");
    const duration = (milliseconds) => { const minutes = Math.max(0, Math.round(milliseconds / 60000)); return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`; };
    const sessions = Array.isArray(technical.workSessions) ? technical.workSessions : [];
    const effectiveMs = sessions.length ? sessions.reduce((total, session) => total + Math.max(0, new Date(session.end || technical.completedAt || Date.now()) - new Date(session.start)), 0) : (technical.startedAt ? Math.max(0, new Date(technical.completedAt || Date.now()) - new Date(technical.startedAt)) : 0);
    para("Aviso registrado:", formatStamp(technical.reportedAt)); para("Llegada al sitio:", formatStamp(technical.arrivalAt));
    para("Inicio de intervención:", formatStamp(technical.startedAt)); para("Finalización:", formatStamp(technical.completedAt));
    if (technical.reportedAt && technical.arrivalAt && new Date(technical.arrivalAt) - new Date(technical.reportedAt) >= 60000) para("Tiempo de respuesta:", duration(new Date(technical.arrivalAt) - new Date(technical.reportedAt)));
    if (effectiveMs) para("Tiempo efectivo de intervención:", duration(effectiveMs));
    if (technical.arrivalAt && technical.completedAt) para("Tiempo total en planta:", duration(new Date(technical.completedAt) - new Date(technical.arrivalAt)));
    if (technical.billableWaitMinutes) para("Espera por condiciones del sitio:", `${technical.billableWaitMinutes} minutos${technical.billableWaitReason ? ` - ${technical.billableWaitReason}` : ""}`);
    if (technical.downtimeMinutes) para("Parada productiva informada:", `${technical.downtimeMinutes} minutos`);
  }

  if (technical.deviceType || technical.firmware || technical.programVersion || technical.backupRef || technical.ioVerified || technical.alarmsVerified) {
    section("Registro de automatización");
    para("Dispositivo:", technical.deviceType); para("Firmware:", technical.firmware); para("Versión de programa:", technical.programVersion);
    para("Respaldo:", technical.backupRef); para("E/S verificadas:", technical.ioVerified); para("Alarmas e interlocks:", technical.alarmsVerified);
  }

  if (technical.installationScope || technical.requiredDocuments || technical.mountingWiring || technical.commissioning || technical.trainingProvided) {
    section("Registro de instalación");
    para("Alcance:", technical.installationScope); para("Documentación:", technical.requiredDocuments); para("Montaje y conexionado:", technical.mountingWiring);
    para("Puesta en marcha:", technical.commissioning); para("Capacitación:", technical.trainingProvided);
  }

  if (technical.preventiveChecklist || technical.cleaningAdjustments || technical.wearFindings) {
    section("Mantenimiento preventivo");
    para("Inspección / checklist:", technical.preventiveChecklist); para("Limpieza y ajustes:", technical.cleaningAdjustments); para("Desgaste y hallazgos:", technical.wearFindings);
  }

  if (order.service === "Garantía" && (technical.warrantyReference || technical.warrantyDecision || technical.warranty)) {
    section("Validación de garantía"); para("Referencia:", technical.warrantyReference); para("Dictamen:", technical.warrantyDecision); para("Cobertura y vigencia:", technical.warranty);
  }

  if (technical.emergencyPriority || technical.productionImpact || technical.temporaryRestoration) {
    section("Atención de emergencia"); para("Criticidad:", technical.emergencyPriority); para("Impacto productivo:", technical.productionImpact); para("Restablecimiento temporal:", technical.temporaryRestoration);
  }

  if (technical.measurementsBefore || technical.setpointChanges || technical.measurementsAfter || technical.testsPerformed || technical.testResult || technical.finalCondition) {
    brk(42); section("Parámetros, verificación y puesta en servicio");
    para("Condición / valor inicial:", technical.measurementsBefore); para("Cambio aplicado:", technical.setpointChanges); para("Condición / valor final:", technical.measurementsAfter);
    para("Prueba funcional:", technical.testsPerformed); para("Criterio / resultado:", technical.testResult); para("Condición final del activo:", technical.finalCondition);
  }

  if (technical.recommendations || technical.pendingActions || technical.followUpDate) {
    brk(30); section("Recomendaciones y compromisos");
    para("Recomendación técnica:", technical.recommendations); para("Acción pendiente:", technical.pendingActions); para("Fecha de seguimiento:", formatDate(technical.followUpDate));
  }

  /* Registro fotográfico */
  const fotos = (order.photos || []).filter((p) => p && p.url && p.kind !== "document");
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
        const stamp = p.ts ? formatStamp(p.ts) : "";
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(71, 85, 105);
        doc.text(`IMAGEN ${i + offset + 1} - ${String(p.cat || "EVIDENCIA").toUpperCase()}`, x, y + frameH + 4);
        if (stamp) { doc.setFont("helvetica", "normal"); doc.setTextColor(100, 116, 139); doc.text(stamp, x + frameW, y + frameH + 4, { align: "right" }); }
      });
      y += rowH;
    }
    doc.setTextColor(15, 23, 42);
  }

  /* Documentos adjuntos (PDF, Excel, CSV) */
  const documentos = (order.photos || []).filter((p) => p && p.kind === "document");
  if (documentos.length) {
    brk(14); section("Documentos adjuntos");
    documentos.forEach((docItem) => para(`${docItem.cat ? docItem.cat[0].toUpperCase() + docItem.cat.slice(1) : "Adjunto"}:`, docItem.name || "Documento"));
  }

  /* Materiales */
  if ((order.materials || []).length) {
    section("Materiales y repuestos");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139);
    doc.text("Cant.", M, y); doc.text("Descripción", M + 16, y);
    if (internal) { doc.text("Costo u.", W - M - 38, y, { align: "right" }); doc.text("Venta u.", W - M, y, { align: "right" }); }
    else if (valued) { doc.text("P. unit.", W - M - 38, y, { align: "right" }); doc.text("Subtotal", W - M, y, { align: "right" }); }
    y += 2; doc.setDrawColor(241, 245, 249); doc.line(M, y, W - M, y); y += 4;
    doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42); doc.setFontSize(9);
    (order.materials || []).forEach((m) => {
      brk(8);
      doc.text(String(m.qty || 0), M, y);
      const trace = [m.partNumber && `P/N ${m.partNumber}`, m.brand, m.model, m.serial && `S/N ${m.serial}`, internal && m.supplier && `Prov. ${m.supplier}`].filter(Boolean).join(" · ");
      const nm = doc.splitTextToSize(`${String(m.name || "—")}${trace ? `\n${trace}` : ""}`, internal ? 95 : showSales ? 105 : 150);
      doc.text(nm, M + 16, y);
      if (internal) {
        doc.text(money(m.cost), W - M - 38, y, { align: "right" });
        doc.text(money(m.price), W - M, y, { align: "right" });
      } else if (valued) {
        doc.text(money(m.price), W - M - 38, y, { align: "right" });
        doc.text(money((Number(m.qty) || 0) * (Number(m.price) || 0)), W - M, y, { align: "right" });
      }
      y += Math.max(nm.length * 4.3, 5);
    });
    y += 3;
  }

  /* Mano de obra */
  if (internal) {
    section("Mano de obra y facturación");
    const chargedHours = billedHours(order), actualWithWait = (Number(order.laborHours) || 0) + (Math.max(0, Number(order.technical?.billableWaitMinutes) || 0) / 60);
    para("Horas facturables:", `${chargedHours} h${chargedHours > actualWithWait ? " (mínimo de servicio aplicado)" : ""}`);
    para("Técnicos en planta:", order.technicians || 1);
    para("Tarifa por hora y por técnico:", money(order.rate));
    para("Cálculo:", `${chargedHours} h x ${order.technicians || 1} técnico(s) = ${chargedHours * (Number(order.technicians) || 1)} horas-técnico`);
  }

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

  if (internal && (technical.recurrence || technical.internalDisposition || technical.internalOwner || technical.internalNotes || (order.activity || []).length)) {
    section("Gestión interna");
    para("Recurrencia:", technical.recurrence); para("Próxima acción:", technical.internalDisposition); para("Responsable:", technical.internalOwner); para("Notas internas:", technical.internalNotes);
    if ((order.activity || []).length) para("Trazabilidad:", (order.activity || []).map((entry) => `${entry.at ? new Date(entry.at).toLocaleString("es-AR") : ""} ${entry.byName || ""}: ${entry.text || ""}`.trim()).join("\n"));
  }

  /* Firmas: en reportes para cliente ya están en la constancia de la primera página. */
  if (internal) {
    brk(48);
    section("Firmas y conformidad");
    if (order.signatureUrl && order.signatureUrl !== "signed") {
      try { doc.addImage(order.signatureUrl, "PNG", M, y, 50, 22); } catch {}
    }
    if (order.technicianSignatureUrl) {
      try { doc.addImage(order.technicianSignatureUrl, "PNG", W - M - 62, y, 50, 22); } catch {}
    }
    y += 24;
    doc.setDrawColor(148, 163, 184); doc.line(M, y, M + 62, y); doc.line(W - M - 62, y, W - M, y); y += 4;
    doc.setFontSize(9); doc.setTextColor(71, 85, 105);
    doc.text(`Firma del cliente${order.signedBy ? "  ·  " + order.signedBy : ""}`, M, y);
    doc.text("Firma del técnico", W - M, y, { align: "right" });
    doc.setFontSize(8); doc.text(order.technicianSignedBy || order.tech || "Técnico responsable", W - M, y + 4.5, { align: "right" });
    if (order.technicianSignedAt) doc.text(`Registrada: ${formatStamp(order.technicianSignedAt)}`, W - M, y + 9, { align: "right" });
    if (technical.signerRole || technical.signerCompany) { y += 4.5; doc.setFontSize(8); doc.text([technical.signerRole, technical.signerCompany].filter(Boolean).join(" · "), M, y); }
    if (order.signedAt) { y += 4.5; doc.setFontSize(8); doc.text(`Conformidad registrada: ${formatStamp(order.signedAt)}`, M, y); }
    if (order.noSignReason) { y += 5; doc.setFontSize(8); doc.setTextColor(180, 83, 9); doc.text(doc.splitTextToSize(`Orden aprobada sin firma. Motivo: ${order.noSignReason}`, W - 2 * M), M, y); }
  }

  /* Pie y numeración */
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setDrawColor(226, 232, 240); doc.line(M, 285, W - M, 285);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
    doc.text(`Generado el ${formatStamp(new Date())} - ${internal ? "Uso interno y confidencial" : valued ? "Constancia valorizada para el Cliente" : "Reporte para el Cliente"}`, M, 290);
    doc.text(`Página ${page} de ${pages}`, W - M, 290, { align: "right" });
  }

  return doc;
}

export function clientOrderReportPDF(order) { buildOrderReceiptPDF(order, "client").save(`${order.id}_cliente.pdf`); }
export function valuedClientReportPDF(order) { buildOrderReceiptPDF(order, "valued").save(`${order.id}_cliente_valorizado.pdf`); }
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
    doc.text("Horas-téc.", M + 92, y, { align: "right" });
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

const nativeMoney = (amount, currency) => `${currency === "USD" ? "USD " : currency === "ARS" ? "ARS " : "EUR "}${(Number(amount) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CURRENCY_NAME = { USD: "DÓLARES", ARS: "PESOS ARGENTINOS", EUR: "EUROS" };

export function purchaseOrderReportPDF(po, supplier, project) {
  const doc = new jsPDF("p", "mm", "a4");
  const W = 210, M = 15;
  let y = 20;
  let drawHead = () => {};
  const brk = (need = 8) => { if (y + need > 275) { doc.addPage(); y = 20; drawHead(); } };

  drawLogo(doc, M, 12);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(100, 116, 139);
  ["CUIT: 20-35196020-6", "Bv. Ovidio Lagos 160 - Venado Tuerto (Santa Fe)", "Tel.: +54 3462 596041", "www.automatica-arg.com.ar"].forEach((line, index) => doc.text(line, M, 30 + index * 3.8));
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
  doc.text("ORDEN DE COMPRA", W - M, 16, { align: "right" });
  doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
  doc.text(`N.º: ${po.number || po.id || "—"}`, W - M, 23, { align: "right" });
  doc.text(`Fecha: ${formatDate(po.createdAt)}`, W - M, 28, { align: "right" });
  doc.setDrawColor(203, 213, 225); doc.line(M, 49, W - M, 49);

  const heading = (text, atY) => { doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(241, 135, 0); doc.text(text, M, atY); };
  const field = (label, value, x, atY, width = 60) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.2); doc.setTextColor(71, 85, 105); doc.text(`${label}:`, x, atY);
    doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42);
    const lines = doc.splitTextToSize(String(value || "—"), width);
    doc.text(lines.slice(0, 2), x + 28, atY);
  };

  heading("DATOS PROVEEDOR", 58);
  field("R. Social", po.supplierName, M, 66, 58); field("CUIT", supplier?.cuit, 110, 66, 53);
  field("Dirección", supplier?.address, M, 73, 58); field("Atención", supplier?.contactName || supplier?.contact, 110, 73, 53);
  field("Localidad", supplier?.locality, M, 80, 58); field("Condición", supplier?.ivaCondition, 110, 80, 53);
  field("Teléfono", supplier?.phone, M, 87, 58); field("Presup. N.º", po.supplierQuoteNumber, 110, 87, 53);
  field("Email", supplier?.email, M, 94, 58);

  y = 106;
  heading("DETALLE", y); y += 8;
  const cols = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text("Descripción", M, y);
    doc.text("Cantidad", M + 88, y, { align: "right" });
    doc.text("P. Unitario", M + 118, y, { align: "right" });
    doc.text("IVA %", M + 136, y, { align: "right" });
    doc.text("P. Total", W - M, y, { align: "right" });
    y += 2; doc.setDrawColor(226, 232, 240); doc.line(M, y, W - M, y); y += 4.5;
  };
  drawHead = cols; cols();

  doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42); doc.setFontSize(8.2);
  const items = po.items || [];
  items.forEach((item) => {
    brk(8);
    const desc = doc.splitTextToSize(`${item.sku ? item.sku + " - " : ""}${item.description || "—"}`, 82);
    doc.text(desc[0] + (desc.length > 1 ? "…" : ""), M, y);
    doc.text(String(item.qty || 0), M + 88, y, { align: "right" });
    doc.text(nativeMoney(item.unitPrice, item.currency), M + 118, y, { align: "right" });
    doc.text(`${item.vatRate || 0}%`, M + 136, y, { align: "right" });
    doc.text(nativeMoney(item.grossAmount, item.currency), W - M, y, { align: "right" });
    y += 5.5;
  });

  brk(28); doc.setDrawColor(148, 163, 184); doc.line(M, y, W - M, y); y += 6;
  const currencies = [...new Set(items.map((item) => item.currency || "USD"))];
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
  if (currencies.length === 1) doc.text(`Moneda: ${CURRENCY_NAME[currencies[0]] || currencies[0]}`, M, y);
  doc.text("Neto:", M + 118, y, { align: "right" }); doc.text(money(po.netAmountUsd), W - M, y, { align: "right" }); y += 5.5;
  doc.text("IVA:", M + 118, y, { align: "right" }); doc.text(money(po.vatAmountUsd), W - M, y, { align: "right" }); y += 4;

  y += 3; doc.setFillColor(241, 245, 249); doc.rect(M, y - 5, W - 2 * M, 9, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(15, 23, 42);
  doc.text("Total", M + 4, y + 1); doc.text(money(po.grossAmountUsd), W - M - 4, y + 1, { align: "right" }); y += 12;

  if (po.notes) {
    brk(20); heading("Notas", y); y += 7;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42);
    const lines = doc.splitTextToSize(po.notes, W - 2 * M);
    doc.text(lines, M, y); y += lines.length * 4.2 + 4;
  }

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
  doc.text(`Generado el ${new Date().toLocaleString("es-AR")}`, M, 290);

  doc.save(`${po.number || po.id}_orden_de_compra.pdf`);
}

export function materialListReportPDF(ml, project) {
  const doc = new jsPDF("p", "mm", "a4");
  const W = 210, M = 15;
  let y = 20;
  let drawHead = () => {};
  const brk = (need = 8) => { if (y + need > 275) { doc.addPage(); y = 20; drawHead(); } };

  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(15, 23, 42);
  doc.text(String(ml.client || "Cliente").toUpperCase(), M, 16);
  doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  doc.text(`Listado de Materiales ${ml.discipline || ""}`.trim(), M, 22);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
  doc.text("Desarrollo Automatización", W - M, 15, { align: "right" });
  doc.setFont("helvetica", "bold"); doc.text(ml.number || ml.id || "—", W - M, 19.5, { align: "right" });
  doc.setDrawColor(203, 213, 225); doc.line(M, 24, W - M, 24);

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.8); doc.setTextColor(71, 85, 105);
  doc.text(`Versión: ${ml.version || "1.0"}`, M, 30);
  doc.text(`Planta: ${ml.site || "—"}`, M, 34.5);
  doc.text(`Proyecto: ${ml.projectName || project?.name || "—"}`, M, 39);
  doc.text("Fecha de actualización:", W - M, 30, { align: "right" });
  doc.setFont("helvetica", "bold"); doc.text(formatDate(ml._updatedAt || ml.updatedAt || ml.createdAt), W - M, 34.5, { align: "right" });

  y = 46;
  doc.setFillColor(30, 41, 59); doc.rect(M, y - 5, W - 2 * M, 7, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
  doc.text(`LISTADO DE MATERIALES ${(ml.discipline || "").toUpperCase()}`.trim(), M + 2, y);
  y += 6;

  if ((ml.notes || []).length) {
    doc.setFillColor(254, 249, 231); doc.setDrawColor(253, 224, 71);
    const noteLines = ml.notes.map((note) => doc.splitTextToSize(note, W - 2 * M - 10));
    const totalLines = noteLines.reduce((sum, lines) => sum + lines.length, 0) + ml.notes.length * 1.2;
    const boxHeight = totalLines * 3.6 + 6;
    brk(boxHeight + 10);
    doc.rect(M, y, W - 2 * M, boxHeight, "FD");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(120, 90, 10);
    doc.text("NOTAS IMPORTANTES", M + 3, y + 4.5);
    let noteY = y + 9;
    doc.setFont("helvetica", "normal"); doc.setTextColor(71, 85, 105); doc.setFontSize(6.6);
    noteLines.forEach((lines, index) => {
      doc.text(`${index + 1}.`, M + 3, noteY);
      doc.text(lines, M + 8, noteY);
      noteY += lines.length * 3.6 + 2;
    });
    y += boxHeight + 6;
  }

  brk(14);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(241, 135, 0);
  doc.text("1. LISTADO GENERAL", M, y); y += 7;

  const colX = { item: M, ref: M + 11, desc: M + 34, brand: M + 92, qty: M + 122, unit: M + 127, matUnit: M + 150, subUnit: M + 172, sub: W - M };
  const cols = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.8); doc.setTextColor(100, 116, 139);
    doc.text("Item", colX.item, y);
    doc.text("Ref.", colX.ref, y);
    doc.text("Descripción", colX.desc, y);
    doc.text("Marca", colX.brand, y);
    doc.text("Cant.", colX.qty, y, { align: "right" });
    doc.text("Ud.", colX.unit, y);
    doc.text("Mat. Unit.", colX.matUnit, y, { align: "right" });
    doc.text("Subt. Unit.", colX.subUnit, y, { align: "right" });
    doc.text("Subtotal", colX.sub, y, { align: "right" });
    y += 2; doc.setDrawColor(226, 232, 240); doc.line(M, y, W - M, y); y += 4.5;
  };
  drawHead = cols; cols();

  const sections = ml.sections || [];
  sections.forEach((section) => {
    brk(11);
    doc.setFillColor(220, 252, 231); doc.rect(M, y - 4, W - 2 * M, 6, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(6, 95, 70);
    doc.text(section.title, M + 2, y);
    y += 6.5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(15, 23, 42);
    (section.items || []).forEach((item, index) => {
      brk(7);
      doc.text(`${section.code}.${String(index).padStart(2, "0")}`, colX.item, y);
      doc.text(String(item.ref || "—"), colX.ref, y);
      const desc = doc.splitTextToSize(item.description || "—", 56);
      doc.text(desc[0] + (desc.length > 1 ? "…" : ""), colX.desc, y);
      doc.text(String(item.brand || "—"), colX.brand, y);
      doc.text(String(item.qty || 0), colX.qty, y, { align: "right" });
      doc.text(String(item.unit || "un"), colX.unit, y);
      y += 6;
    });
  });

  brk(14); doc.setDrawColor(148, 163, 184); doc.line(M, y, W - M, y); y += 2;
  doc.setFillColor(241, 245, 249); doc.rect(M, y, W - 2 * M, 8, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42);
  doc.text("Total de Materiales", M + 3, y + 5.3);
  y += 14;

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
  doc.text(`Generado el ${new Date().toLocaleString("es-AR")}`, M, 290);

  doc.save(`${ml.number || ml.id}_listado_de_materiales.pdf`);
}
