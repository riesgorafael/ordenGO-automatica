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
// OJO: esta función replica billableLaborHours de App.jsx. Están duplicadas a propósito para que
// pdf.js no dependa del bundle de la app, pero cualquier cambio en la regla de facturación tiene
// que hacerse en las DOS o el PDF le factura al cliente un importe distinto del que se ve en
// pantalla. El mínimo sale del contrato del cliente (minimumBillableHours) cuando la orden lo trae.
const billedHours = (o) => {
  if (o.billableHours !== undefined && o.billableHours !== null && o.billableHours !== "") return Math.max(0, Number(o.billableHours) || 0);
  const effective = Math.max(0, Number(o.laborHours) || 0), waiting = Math.max(0, Number(o.technical?.billableWaitMinutes) || 0) / 60;
  const arrival = o.technical?.arrivalAt ? new Date(o.technical.arrivalAt).getTime() : NaN;
  const end = o.technical?.completedAt ? new Date(o.technical.completedAt).getTime() : Date.now();
  const onSite = Number.isFinite(arrival) && Number.isFinite(end) ? Math.max(0, end - arrival) : 0;
  const minimum = Number(o.minimumBillableHours) > 0 ? Number(o.minimumBillableHours) : 2;
  return onSite > 0 && onSite < 3600000 ? minimum : Math.round((effective + waiting) * 100) / 100;
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

function drawServiceSummaryPage(doc, order, valued = false, project = null) {
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
  field("Cliente", order.client, M, 66, 62); field("Proyecto vinculado", project ? `${project.key} · ${project.name}` : "Sin proyecto", 110, 66, 52);
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

export function buildOrderReceiptPDF(order, audience = "client", project = null) {
  const doc = new jsPDF("p", "mm", "a4");
  const W = 210, M = 15;
  const internal = audience === "internal";
  const valued = audience === "valued";
  const priced = internal;
  const showSales = internal || valued;
  const technical = order.technical || {};
  let y = 16;
  if (!internal) { drawServiceSummaryPage(doc, order, valued, project); doc.addPage(); }
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
    if (!val) return;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
    const w = doc.getTextWidth(label + " ");
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(String(val), W - 2 * M - w);
    // Cada línea se chequea contra el borde de página por separado: un valor largo (ej. la
    // trazabilidad completa de una orden con muchas entradas) puede medir varias veces el alto
    // disponible, y validar el bloque entero una sola vez antes de imprimir dejaba el resto de las
    // líneas escribiéndose fuera de la página, superpuestas con el pie o el encabezado siguiente.
    lines.forEach((line, index) => {
      brk(6);
      if (index === 0) { doc.setFont("helvetica", "bold"); doc.text(label + " ", M, y); doc.setFont("helvetica", "normal"); }
      doc.text(line, M + w, y);
      y += 4.6;
    });
    y += 2.2;
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
    const pauses = sessions.filter((session) => session.pauseReason);
    if (pauses.length) para("Pausas registradas:", pauses.map((session) => `${formatStamp(session.end)} - ${duration(Math.max(0, new Date(session.end) - new Date(session.start)))} - ${session.pauseCategory || "Otro"}: ${session.pauseReason}`).join("\n"));
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
    para("Cálculo:", `${chargedHours} h x ${order.technicians || 1} técnico(s) = ${(chargedHours * (Number(order.technicians) || 1)).toFixed(2)} horas-técnico`);
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

export function clientOrderReportPDF(order, project = null) { buildOrderReceiptPDF(order, "client", project).save(`${order.id}_cliente.pdf`); }
export function valuedClientReportPDF(order, project = null) { buildOrderReceiptPDF(order, "valued", project).save(`${order.id}_cliente_valorizado.pdf`); }
export function internalOrderReportPDF(order, project = null) { buildOrderReceiptPDF(order, "internal", project).save(`${order.id}_interno.pdf`); }

export function monthlyReportPDF(month, monthLabel, rows, sum) {
  const doc = new jsPDF("p", "mm", "a4");
  const W = 210, M = 15;
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  let y = 16;
  let drawHead = () => {};
  const brk = (need = 8) => { if (y + need > 285) { doc.addPage(); y = 20; drawHead(); } };

  const lh = drawLogo(doc, M, y - 4);
  doc.setFontSize(11); doc.setTextColor(100, 116, 139);
  doc.text(String(month).length <= 4 ? "REPORTE ANUAL POR CLIENTE" : "REPORTE MENSUAL POR CLIENTE", W - M, y, { align: "right" });
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
    doc.text(String(Math.round((Number(r.hours) || 0) * 100) / 100), M + 92, y, { align: "right" });
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
  field("Teléfono", supplier?.phone, M, 87, 58); field("Cotiz. proveedor N.º", po.supplierQuoteNumber, 110, 87, 53);
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

export function materialListReportPDF(ml, project, client) {
  const doc = new jsPDF("p", "mm", "a4");
  const W = 210, M = 12;
  const CW = W - 2 * M;
  let y = 10;
  let drawHead = () => {};
  const brk = (need = 8) => { if (y + need > 283) { doc.addPage(); y = 10; drawHead(); } };
  const line = (x0, yy, x1) => doc.line(x0, yy, x1, yy);
  const vline = (x, y0, y1) => doc.line(x, y0, x, y1);
  const drawFitImage = (dataUrl, x, boxY, boxW, boxH) => {
    try {
      const fmt = /^data:image\/png/i.test(dataUrl) ? "PNG" : /^data:image\/webp/i.test(dataUrl) ? "WEBP" : "JPEG";
      const props = doc.getImageProperties(dataUrl);
      const scale = Math.min(boxW / props.width, boxH / props.height);
      const drawW = props.width * scale, drawH = props.height * scale;
      doc.addImage(dataUrl, fmt, x + (boxW - drawW) / 2, boxY + (boxH - drawH) / 2, drawW, drawH);
      return true;
    } catch { return false; }
  };

  /* ---------- Encabezado: logo | razón social + título | datos del documento ---------- */
  const headH = 20, logoColW = 34, docColW = 44, midColW = CW - logoColW - docColW;
  doc.setDrawColor(90, 90, 90); doc.setLineWidth(0.3);
  doc.rect(M, y, CW, headH);
  vline(M + logoColW, y, y + headH);
  vline(M + logoColW + midColW, y, y + headH);
  line(M + logoColW, y + headH / 2, M + logoColW + midColW);

  const audience = ml.audience === "interno" ? "interno" : "cliente";
  const logoSource = audience === "interno" ? LOGO : client?.logoDataUrl;
  if (logoSource) drawFitImage(logoSource, M + 1.5, y + 1.5, logoColW - 3, headH - 3);

  const midX = M + logoColW + midColW / 2;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(15, 23, 42);
  doc.text(String(audience === "interno" ? "AUTOMATICA ARG" : ml.client || "Cliente sin asignar").toUpperCase(), midX, y + headH / 2 - 3, { align: "center" });
  doc.setFontSize(9);
  doc.text("Listado de Materiales I&C", midX, y + headH / 2 + 5.5, { align: "center" });

  const docColX = M + logoColW + midColW;
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(71, 85, 105);
  doc.text("Desarrollo Automatización", docColX + docColW / 2, y + headH / 2 - 2, { align: "center" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.2); doc.setTextColor(15, 23, 42);
  doc.text(ml.number || ml.id || "—", docColX + docColW / 2, y + headH / 2 + 3.5, { align: "center" });
  y += headH + 4;

  /* ---------- Versión / Planta / Proyecto — Fecha de actualización ---------- */
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.4); doc.setTextColor(71, 85, 105);
  doc.text(`Versión: ${ml.version || "1.0"}`, M, y);
  doc.text(`Planta: ${ml.site || "—"}`, M, y + 4);
  doc.text(`Proyecto: ${ml.projectName || project?.name || "—"}`, M, y + 8);
  doc.text("Fecha de actualización:", W - M, y, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.text(formatDate(ml._updatedAt || ml.updatedAt || ml.createdAt), W - M, y + 4, { align: "right" });
  y += 13;

  /* ---------- Banner de disciplina ---------- */
  doc.setFillColor(64, 64, 64); doc.rect(M, y, CW, 6.5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
  doc.text(`LISTADO DE MATERIALES ${(ml.discipline || "").toUpperCase()}`.trim(), M + CW / 2, y + 4.3, { align: "center" });
  y += 6.5;

  /* ---------- Notas importantes ---------- */
  if ((ml.notes || []).length) {
    const numColW = 8, textColW = CW - numColW;
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.4);
    const noteLines = ml.notes.map((note) => doc.splitTextToSize(note, textColW - 4));
    const rowHeights = noteLines.map((lines) => Math.max(7, lines.length * 3.3 + 3));
    const headerH = 5;
    const boxHeight = headerH + rowHeights.reduce((sum, h) => sum + h, 0);
    brk(boxHeight + 8);
    const boxTop = y;
    doc.setFillColor(216, 216, 216); doc.setDrawColor(90, 90, 90); doc.setLineWidth(0.25);
    doc.rect(M, boxTop, CW, headerH, "FD");
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.8); doc.setTextColor(15, 23, 42);
    doc.text("NOTAS IMPORTANTES", M + 2, boxTop + 3.6);
    let rowY = boxTop + headerH;
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.4); doc.setTextColor(71, 85, 105);
    noteLines.forEach((lines, index) => {
      const rowH = rowHeights[index];
      doc.rect(M, rowY, numColW, rowH); doc.rect(M + numColW, rowY, textColW, rowH);
      doc.text(String(index + 1), M + numColW / 2, rowY + rowH / 2 + 1, { align: "center" });
      doc.text(lines, M + numColW + 2, rowY + 3.6);
      rowY += rowH;
    });
    y = boxTop + boxHeight + 5;
  }

  /* ---------- Título de sección ---------- */
  brk(12);
  doc.setFillColor(216, 216, 216); doc.setDrawColor(90, 90, 90); doc.setLineWidth(0.25);
  doc.rect(M, y, CW, 5.5, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(15, 23, 42);
  doc.text("1. LISTADO GENERAL", M + 2, y + 3.8);
  y += 5.5;

  /* ---------- Tabla de materiales ---------- */
  // Límites de columna (mm desde M): Item | Ref. | Descripción | Marca | Cant. | Ud. | Material Unit. | Subtotal Unit. | Subtotal
  const cx = [0, 9, 29, 87, 111, 121, 130, 150, 170, CW].map((offset) => M + offset);
  const headerLabels = [
    { text: "Item", align: "left" }, { text: "Ref.", align: "left" }, { text: "Descripción", align: "left" },
    { text: "Marca", align: "left" }, { text: "Cant.", align: "right" }, { text: "Ud.", align: "left" },
    { text: "Material Unitario", align: "right" }, { text: "Subtotal Unitario", align: "right" }, { text: "Subtotal", align: "right" },
  ];
  const cellText = (index, text, textY, opts = {}) => {
    const align = headerLabels[index].align;
    const pad = 1.3;
    const x = align === "right" ? cx[index + 1] - pad : cx[index] + pad;
    doc.text(text, x, textY, { align, ...opts });
  };
  const tableHeader = () => {
    doc.setFillColor(255, 255, 255); doc.setDrawColor(90, 90, 90); doc.setLineWidth(0.25);
    doc.rect(M, y, CW, 6, "S");
    cx.slice(1, -1).forEach((x) => vline(x, y, y + 6));
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.4); doc.setTextColor(15, 23, 42);
    headerLabels.forEach((label, index) => cellText(index, label.text, y + 4));
    y += 6;
  };
  drawHead = tableHeader; tableHeader();

  const sections = ml.sections || [];
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(15, 23, 42);
  sections.forEach((section) => {
    brk(9);
    doc.setFillColor(221, 216, 195); doc.setDrawColor(90, 90, 90); doc.setLineWidth(0.25);
    doc.rect(M, y, CW, 5, "FD");
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.8); doc.setTextColor(15, 23, 42);
    doc.text(section.title, M + 2, y + 3.4);
    y += 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(15, 23, 42);
    (section.items || []).forEach((item, index) => {
      const descLines = doc.splitTextToSize(item.description || "—", cx[3] - cx[2] - 2.6);
      const brandLines = doc.splitTextToSize(item.brand || "—", cx[4] - cx[3] - 2.6);
      const lines = Math.max(1, descLines.length, brandLines.length, 2);
      const rowH = Math.max(7, lines * 3.1 + 1.5);
      brk(rowH + 2);
      doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.2);
      doc.rect(M, y, CW, rowH, "S");
      cx.slice(1, -1).forEach((x) => vline(x, y, y + rowH));
      const midY = y + (rowH < 9 ? rowH / 2 + 2 : 4);
      cellText(0, `${section.code}.${String(index).padStart(2, "0")}`, midY);
      cellText(1, String(item.ref || "—"), midY);
      doc.text(descLines, cx[2] + 1.3, midY);
      doc.text(brandLines, cx[3] + 1.3, midY);
      cellText(4, String(item.qty || 0), midY);
      cellText(5, String(item.unit || "un"), midY);
      y += rowH;
    });
  });

  brk(9);
  doc.setDrawColor(90, 90, 90); doc.setLineWidth(0.25);
  doc.setFillColor(216, 216, 216);
  doc.rect(M, y, CW, 8, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(15, 23, 42);
  doc.text("Total de Materiales", M + 3, y + 5.3);
  y += 8;

  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
  doc.text(`Generado el ${new Date().toLocaleString("es-AR")}`, M, 293);

  doc.save(`${ml.number || ml.id}_listado_de_materiales.pdf`);
}

// Presupuesto en dos formatos: "cliente" (solo venta: cantidad, unidad, precio de venta, total —
// costo interno y margen quedan afuera, son datos de uso exclusivo interno) e "interno" (agrega
// costo, margen por línea y el resumen de margen bruto, para uso de administración/gerencia).
export function budgetReportPDF(budget, client, audience = "cliente") {
  const internal = audience === "interno";
  const doc = new jsPDF("p", "mm", "a4");
  const W = 210, M = 15;
  let y = 20;
  let drawHead = () => {};
  const brk = (need = 8) => { if (y + need > 275) { doc.addPage(); y = 20; drawHead(); } };

  drawLogo(doc, M, 12);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(100, 116, 139);
  ["CUIT: 20-35196020-6", "Bv. Ovidio Lagos 160 - Venado Tuerto (Santa Fe)", "Tel.: +54 3462 596041", "www.automatica-arg.com.ar"].forEach((line, index) => doc.text(line, M, 30 + index * 3.8));
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
  doc.text(internal ? "PRESUPUESTO · USO INTERNO" : "PRESUPUESTO", W - M, 16, { align: "right" });
  doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
  doc.text(`N.º: ${budget.number || budget.id || "—"}`, W - M, 23, { align: "right" });
  doc.text(`Fecha: ${formatDate(budget.createdAt || new Date())}`, W - M, 28, { align: "right" });
  doc.setDrawColor(203, 213, 225); doc.line(M, 49, W - M, 49);

  const heading = (text, atY) => { doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(241, 135, 0); doc.text(text, M, atY); };
  const field = (label, value, x, atY, width = 60) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.2); doc.setTextColor(71, 85, 105); doc.text(`${label}:`, x, atY);
    doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42);
    const lines = doc.splitTextToSize(String(value || "—"), width);
    doc.text(lines.slice(0, 2), x + 28, atY);
  };

  heading("DATOS DEL CLIENTE", 58);
  field("Cliente", budget.client, M, 66, 58); field("CUIT", client?.cuit, 110, 66, 53);
  field("Planta", budget.site, M, 73, 58); field("Condición", client?.ivaCondition, 110, 73, 53);
  field("Atención", budget.contact, M, 80, 58); field("Servicio", budget.service, 110, 80, 53);
  field("Proyecto", budget.title, M, 87, 118);
  if (internal) { field("Etapa", budget.stage, M, 94, 58); field("Probabilidad", `${budget.probability || 0}%`, 110, 94, 53); }

  y = internal ? 106 : 99;
  heading("ALCANCE", y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(15, 23, 42);
  const scopeLines = doc.splitTextToSize(budget.scope || "Según detalle técnico acordado con el cliente.", W - 2 * M);
  doc.text(scopeLines, M, y); y += scopeLines.length * 4 + 6;

  brk(14);
  heading("DETALLE", y); y += 8;
  const cols = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text("Concepto", M, y);
    doc.text("Cant.", M + (internal ? 78 : 108), y, { align: "right" });
    doc.text("Un.", M + (internal ? 90 : 124), y, { align: "right" });
    if (internal) { doc.text("Costo/u", M + 112, y, { align: "right" }); doc.text("Venta/u", M + 134, y, { align: "right" }); doc.text("Margen", M + 156, y, { align: "right" }); }
    else doc.text("P. Unitario", M + 152, y, { align: "right" });
    doc.text("Total", W - M, y, { align: "right" });
    y += 2; doc.setDrawColor(226, 232, 240); doc.line(M, y, W - M, y); y += 4.5;
  };
  drawHead = cols; cols();

  doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42); doc.setFontSize(8.2);
  const items = budget.items || [];
  items.forEach((item) => {
    brk(8);
    const qty = Number(item.qty) || 0, unitPrice = Number(item.unitPrice) || 0, unitCost = Number(item.unitCost) || 0;
    const lineSale = qty * unitPrice, lineCost = qty * unitCost;
    const desc = doc.splitTextToSize(item.description || "—", internal ? 68 : 100);
    doc.text(desc[0] + (desc.length > 1 ? "…" : ""), M, y);
    doc.text(String(item.qty || 0), M + (internal ? 78 : 108), y, { align: "right" });
    doc.text(String(item.unit || "u"), M + (internal ? 90 : 124), y, { align: "right" });
    if (internal) {
      doc.text(money(unitCost), M + 112, y, { align: "right" });
      doc.text(money(unitPrice), M + 134, y, { align: "right" });
      doc.setTextColor(lineSale - lineCost >= 0 ? 5 : 190, lineSale - lineCost >= 0 ? 150 : 30, lineSale - lineCost >= 0 ? 105 : 30);
      doc.text(money(lineSale - lineCost), M + 156, y, { align: "right" });
      doc.setTextColor(15, 23, 42);
    } else doc.text(money(unitPrice), M + 152, y, { align: "right" });
    doc.text(money(lineSale), W - M, y, { align: "right" });
    y += 5.5;
  });

  brk(20); doc.setDrawColor(148, 163, 184); doc.line(M, y, W - M, y); y += 6;
  const total = items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.unitPrice) || 0), 0);
  if (internal) {
    const totalCost = items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.unitCost) || 0), 0);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
    doc.text("Costo interno:", M + 134, y, { align: "right" }); doc.text(money(totalCost), W - M, y, { align: "right" }); y += 5.5;
    doc.text("Margen bruto:", M + 134, y, { align: "right" }); doc.text(`${money(total - totalCost)} · ${total > 0 ? Math.round(((total - totalCost) / total) * 100) : 0}%`, W - M, y, { align: "right" }); y += 4;
  }
  y += 3; doc.setFillColor(241, 245, 249); doc.rect(M, y - 5, W - 2 * M, 9, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(15, 23, 42);
  doc.text("Total", M + 4, y + 1); doc.text(money(total), W - M - 4, y + 1, { align: "right" }); y += 12;

  brk(16);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(71, 85, 105);
  doc.text(`Validez de la oferta: ${budget.validUntil ? formatDate(budget.validUntil) : "A convenir"}`, M, y); y += 5;
  if (budget.plannedStart) { doc.text(`Plazo estimado de ejecución: ${budget.durationDays || 0} día(s) hábil(es)`, M, y); y += 5; }

  if (budget.assumptions || budget.exclusions || (internal && budget.risks)) {
    brk(20); y += 2;
    if (budget.assumptions) { heading("Supuestos y condiciones", y); y += 6; doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(15, 23, 42); const lines = doc.splitTextToSize(budget.assumptions, W - 2 * M); doc.text(lines, M, y); y += lines.length * 4 + 4; }
    if (budget.exclusions) { brk(14); heading("Exclusiones", y); y += 6; doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(15, 23, 42); const lines = doc.splitTextToSize(budget.exclusions, W - 2 * M); doc.text(lines, M, y); y += lines.length * 4 + 4; }
    if (internal && budget.risks) { brk(14); heading("Riesgos técnicos", y); y += 6; doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(15, 23, 42); const lines = doc.splitTextToSize(budget.risks, W - 2 * M); doc.text(lines, M, y); y += lines.length * 4 + 4; }
  }

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
  doc.text(`Generado el ${new Date().toLocaleString("es-AR")}`, M, 290);

  doc.save(`${budget.number || budget.id}_presupuesto${internal ? "_interno" : ""}.pdf`);
}

// Resumen ejecutivo del Panel de dirección: los gráficos de Recharts son SVG/canvas en vivo, no
// algo que jsPDF pueda incrustar directamente, así que el PDF reconstruye los mismos números como
// tablas — el resumen que un gerente se llevaría de una reunión, no un calco pixel a pixel del panel.
export function dashboardReportPDF(periodLabel, kpis, topClients, mix, tech, aging) {
  const doc = new jsPDF("p", "mm", "a4");
  const W = 210, M = 15;
  let y = 20;
  let drawHead = () => {};
  const brk = (need = 8) => { if (y + need > 275) { doc.addPage(); y = 20; drawHead(); } };

  drawLogo(doc, M, 12);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
  doc.text("PANEL DE DIRECCIÓN", W - M, 16, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
  doc.text(`Período: ${periodLabel}`, W - M, 23, { align: "right" });
  doc.setDrawColor(203, 213, 225); doc.line(M, 32, W - M, 32);
  y = 42;

  const heading = (text, atY) => { doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(241, 135, 0); doc.text(text, M, atY); };
  // Recorta al ancho real de la columna, medido con la fuente activa: sin esto un nombre largo se
  // superponía con la columna del importe.
  const fit = (text, maxWidth) => {
    const str = String(text ?? "—");
    if (!maxWidth || doc.getTextWidth(str) <= maxWidth) return str;
    let lo = 0, hi = str.length;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (doc.getTextWidth(str.slice(0, mid) + "…") <= maxWidth) lo = mid; else hi = mid - 1; }
    return str.slice(0, lo) + "…";
  };
  const table = (rows, cols) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    cols.forEach((c) => doc.text(c.label, M + c.x, y, { align: c.align || "left" }));
    y += 2; doc.setDrawColor(226, 232, 240); doc.line(M, y, W - M, y); y += 4.5;
    doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42); doc.setFontSize(8.2);
    rows.forEach((row) => { brk(7); cols.forEach((c) => doc.text(fit(c.value(row), c.maxWidth), M + c.x, y, { align: c.align || "left" })); y += 5.5; });
    y += 4;
  };

  heading("INDICADORES CLAVE", y); y += 8;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42);
  kpis.forEach((kpi) => { doc.setFont("helvetica", "bold"); doc.text(kpi.label + ":", M, y); doc.setFont("helvetica", "normal"); doc.text(String(kpi.value), M + 55, y); y += 5.5; });
  y += 4;

  // fullName cuando existe: el `name` viene recortado para el eje del gráfico en pantalla, pero acá
  // la columna tiene 145 mm y no hace falta abreviar.
  if (topClients?.length) { brk(20); heading("TOP CLIENTES DEL PERÍODO", y); y += 8; table(topClients, [{ label: "Cliente", x: 0, maxWidth: 140, value: (r) => r.fullName || r.name }, { label: "Facturado", x: 150, align: "right", value: (r) => money(r.value) }]); }
  if (mix?.length) { brk(20); heading("MIX DE SERVICIOS", y); y += 8; table(mix, [{ label: "Servicio", x: 0, maxWidth: 140, value: (r) => r.name }, { label: "Monto", x: 150, align: "right", value: (r) => money(r.value) }]); }
  if (tech?.length) { brk(20); heading("PRODUCTIVIDAD POR TÉCNICO", y); y += 8; table(tech, [{ label: "Técnico", x: 0, maxWidth: 92, value: (r) => r.name }, { label: "Horas", x: 100, align: "right", value: (r) => r.horas }, { label: "Órdenes", x: 150, align: "right", value: (r) => r.ordenes }]); }
  if (aging?.length) { brk(20); heading("AGING DE COBRANZAS PENDIENTES", y); y += 8; table(aging, [{ label: "Rango", x: 0, value: (r) => r.name }, { label: "Monto", x: 150, align: "right", value: (r) => money(r.value) }]); }

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
  doc.text(`Generado el ${new Date().toLocaleString("es-AR")}`, M, 290);

  doc.save(`panel_direccion_${periodLabel.replace(/\s+/g, "_")}.pdf`);
}

// Resumen financiero mensual. Antes era una lista plana de "etiqueta: valor" sin ningún gráfico:
// para leerlo había que ya saber qué se estaba mirando. Ahora replica lo que se ve en pantalla —
// indicadores destacados, evolución de 12 meses, costos, antigüedad de deuda y alertas — y declara
// al pie con qué cotización y con qué criterios se calculó cada cosa.
export function financeReportPDF({
  period, periodLabel, generatedBy = "", currencyLabel = "USD", rateNote = "", fmt = money,
  headline = [], kpis = [], trend = [], costs = [], aging = [], openInvoices = [],
  suppliers = [], insights = [], notes = [],
}) {
  const doc = new jsPDF("p", "mm", "a4");
  const W = 210, M = 15, CW = W - 2 * M;
  const stamp = new Date().toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  let y = 20;
  const drawHead = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text("RESUMEN FINANCIERO", M, 14);
    doc.setFont("helvetica", "normal"); doc.text(periodLabel || period, W - M, 14, { align: "right" });
    doc.setDrawColor(226, 232, 240); doc.line(M, 17, W - M, 17);
    y = 26;
  };
  const brk = (need = 8) => { if (y + need > 272) { doc.addPage(); drawHead(); return true; } return false; };
  const heading = (text) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(241, 135, 0);
    doc.text(text, M, y);
    doc.setDrawColor(241, 135, 0); doc.setLineWidth(0.4); doc.line(M, y + 1.6, M + doc.getTextWidth(text), y + 1.6); doc.setLineWidth(0.2);
    y += 7;
  };
  const caption = (text) => {
    doc.setFont("helvetica", "italic"); doc.setFontSize(6.8); doc.setTextColor(148, 163, 184);
    doc.splitTextToSize(text, CW).forEach((line) => { doc.text(line, M, y); y += 3.2; });
    doc.setFont("helvetica", "normal"); y += 1.5;
  };
  const fit = (text, maxWidth) => {
    const str = String(text ?? "—");
    if (!maxWidth || doc.getTextWidth(str) <= maxWidth) return str;
    let lo = 0, hi = str.length;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (doc.getTextWidth(str.slice(0, mid) + "…") <= maxWidth) lo = mid; else hi = mid - 1; }
    return str.slice(0, lo) + "…";
  };
  // Con importes chicos, redondear a entero producía marcas de eje repetidas ("0,1,1,2,2") para
  // los cortes 0 / 0,5 / 1 / 1,5 / 2. Se conserva un decimal mientras el rango sea menor a 10.
  const compact = (value) => {
    const abs = Math.abs(value);
    if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (abs >= 1000) return `${Math.round(value / 1000)}k`;
    if (abs >= 10 || value === 0) return String(Math.round(value));
    return value.toFixed(1);
  };
  // Barras horizontales con su valor al costado: el mismo formato para costos y proveedores.
  // `total` es el universo REAL, no la suma de las filas mostradas: si se listan los 8 costos más
  // grandes de 12, los porcentajes tienen que seguir siendo sobre el gasto completo. Calcularlos
  // sobre el subconjunto hacía que 8 categorías sumaran 100% y pareciera que ahí estaba todo.
  const barList = (rows, color, emptyText, total = 0, hiddenCount = 0, hiddenLabel = "") => {
    if (!rows.length) { doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(148, 163, 184); doc.text(emptyText, M, y); y += 8; return; }
    const labelW = 62, valueW = 30, barMax = CW - labelW - valueW;
    const max = Math.max(...rows.map((row) => Math.abs(row.value))) || 1;
    const universe = Math.abs(total) > 0 ? Math.abs(total) : (rows.reduce((sum, row) => sum + Math.abs(row.value), 0) || 1);
    rows.forEach((row) => {
      brk(8);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(15, 23, 42);
      doc.text(fit(row.name, labelW - 2), M, y + 2.7);
      const width = (Math.abs(row.value) / max) * barMax;
      doc.setFillColor(...hexRgb(row.value < 0 ? "#e11d48" : color));
      if (width > 0.3) doc.roundedRect(M + labelW, y, width, 3.6, 0.8, 0.8, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.2); doc.setTextColor(15, 23, 42);
      doc.text(fmt(row.value), W - M, y + 2.7, { align: "right" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(6);
      doc.setTextColor(148, 163, 184);
      doc.text(`${Math.round((Math.abs(row.value) / universe) * 100)}%`, M + labelW + barMax + 2, y + 2.7);
      y += 6;
    });
    // El recorte se declara: sin esto, ver 8 filas sugiere que no hay más.
    if (hiddenCount > 0) {
      const shown = rows.reduce((sum, row) => sum + Math.abs(row.value), 0);
      doc.setFont("helvetica", "italic"); doc.setFontSize(6.4); doc.setTextColor(148, 163, 184);
      doc.text(`+ ${hiddenCount} ${hiddenLabel} más, por ${fmt(Math.max(0, universe - shown))} (${Math.round(Math.max(0, universe - shown) / universe * 100)}%), no listados.`, M, y + 1.5);
      doc.setFont("helvetica", "normal");
      y += 5;
    }
    y += 2;
  };

  /* ---------- Portada ---------- */
  drawLogo(doc, M, 12);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
  doc.text("RESUMEN FINANCIERO", W - M, 16, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  doc.text(periodLabel || formatDate(`${period}-01`), W - M, 22.5, { align: "right" });
  doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
  doc.text(`Valores en ${currencyLabel} · Corte ${stamp}${generatedBy ? ` · ${generatedBy}` : ""}`, W - M, 27.5, { align: "right" });
  doc.setDrawColor(203, 213, 225); doc.line(M, 33, W - M, 33);
  y = 41;

  /* ---------- Indicadores destacados ---------- */
  heading("RESULTADO DEL PERÍODO");
  const heroW = (CW - 4) / 2;
  headline.slice(0, 2).forEach((card, index) => {
    const hx = M + index * (heroW + 4);
    doc.setFillColor(250, 251, 252); doc.setDrawColor(226, 232, 240);
    doc.roundedRect(hx, y, heroW, 24, 2, 2, "FD");
    doc.setFillColor(...hexRgb(card.positive ? "#10b981" : "#e11d48"));
    doc.rect(hx, y + 2, 1.4, 20, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
    doc.text(card.label, hx + 5, y + 6.5);
    doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...hexRgb(card.positive ? "#047857" : "#be123c"));
    doc.text(fit(card.value, heroW - 10), hx + 5, y + 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.4); doc.setTextColor(148, 163, 184);
    doc.text(fit(card.hint || "", heroW - 10), hx + 5, y + 20.5);
  });
  y += 30;

  /* ---------- Indicadores del mes ---------- */
  const cardW = (CW - 2 * 3) / 3, cardH = 16;
  kpis.forEach((kpi, index) => {
    const col = index % 3, row = Math.floor(index / 3);
    const cx = M + col * (cardW + 3), cy = y + row * (cardH + 3);
    doc.setFillColor(250, 251, 252); doc.setDrawColor(226, 232, 240);
    doc.roundedRect(cx, cy, cardW, cardH, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.4); doc.setTextColor(100, 116, 139);
    doc.text(fit(kpi.label, cardW - 6), cx + 3.5, cy + 5);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(15, 23, 42);
    doc.text(fit(kpi.value, cardW - 6), cx + 3.5, cy + 11);
    if (kpi.hint) { doc.setFont("helvetica", "normal"); doc.setFontSize(5.8); doc.setTextColor(148, 163, 184); doc.text(fit(kpi.hint, cardW - 6), cx + 3.5, cy + 14.4); }
  });
  y += Math.ceil(kpis.length / 3) * (cardH + 3) + 5;

  /* ---------- Evolución 12 meses ---------- */
  if (trend.length) {
    brk(62);
    heading("EVOLUCIÓN FINANCIERA · 12 MESES");
    // Paleta Okabe-Ito (segura para daltonismo) y deliberadamente SIN verde/ámbar/rojo: esos tres
    // quedan reservados para estado y riesgo. Antes, ámbar era "IVA" acá y "31-60 días de atraso"
    // doce centímetros más abajo — el mismo color con dos significados opuestos en una hoja.
    const C_NETO = "#0072B2", C_IVA = "#56B4E9", C_EGRESO = "#6B7280", C_COBRADO = "#CC79A7";
    const chartH = 40, axisW = 15;
    const plotX = M + axisW, plotW = CW - axisW, plotBottom = y + chartH;
    // El tope contempla la barra apilada (facturado + IVA), que es la más alta del gráfico.
    const peak = Math.max(1, ...trend.map((point) => Math.max((Number(point.Facturado) || 0) + (Number(point.IVA) || 0), Number(point.Egresos) || 0, Number(point.Cobrado) || 0)));
    const axisMax = niceCeil(peak);
    doc.setFontSize(5.8);
    for (let i = 0; i <= 4; i++) {
      const gy = plotBottom - (chartH * i) / 4;
      doc.setDrawColor(i === 0 ? 203 : 236, i === 0 ? 213 : 240, i === 0 ? 225 : 245);
      doc.line(plotX, gy, plotX + plotW, gy);
      doc.setTextColor(148, 163, 184);
      // La unidad va en cada marca: un eje sin moneda se presta a leer mal la escala.
      doc.text(`${currencyLabel} ${compact((axisMax * i) / 4)}`, plotX - 1.5, gy + 1, { align: "right" });
    }
    const slot = plotW / trend.length, barW = Math.min(4, (slot - 3) / 2);
    const points = [];
    trend.forEach((point, index) => {
      const center = plotX + slot * index + slot / 2;
      const leftX = center - barW - 0.6, rightX = center + 0.6;
      // Facturado e IVA se APILAN: juntos componen el total facturado con IVA. Enfrentado va el
      // egreso. Así la comparación que el gráfico sugiere (ingreso devengado vs. costo) es válida.
      const neto = Number(point.Facturado) || 0, iva = Number(point.IVA) || 0;
      const netoH = (neto / axisMax) * chartH, ivaH = (iva / axisMax) * chartH;
      if (netoH > 0.25) { doc.setFillColor(...hexRgb(C_NETO)); doc.rect(leftX, plotBottom - netoH, barW, netoH, "F"); }
      if (ivaH > 0.25) { doc.setFillColor(...hexRgb(C_IVA)); doc.rect(leftX, plotBottom - netoH - ivaH, barW, ivaH, "F"); }
      const egreso = Number(point.Egresos) || 0;
      const egresoH = (egreso / axisMax) * chartH;
      if (egresoH > 0.25) { doc.setFillColor(...hexRgb(C_EGRESO)); doc.rect(rightX, plotBottom - egresoH, barW, egresoH, "F"); }
      points.push({ x: center, value: Number(point.Cobrado) || 0 });
      doc.setFont("helvetica", "normal"); doc.setFontSize(5.6); doc.setTextColor(100, 116, 139);
      doc.text(point.name, center, plotBottom + 3.6, { align: "center" });
    });
    // Cobrado va como LÍNEA, no como barra: es caja, otra base de medición. Mezclarlo entre las
    // barras devengadas invitaba a restarlo del facturado, que son magnitudes distintas.
    doc.setDrawColor(...hexRgb(C_COBRADO)); doc.setLineWidth(0.6);
    points.forEach((point, index) => {
      const py = plotBottom - (point.value / axisMax) * chartH;
      if (index > 0) { const prev = points[index - 1]; doc.line(prev.x, plotBottom - (prev.value / axisMax) * chartH, point.x, py); }
    });
    doc.setLineWidth(0.2); doc.setFillColor(...hexRgb(C_COBRADO));
    points.forEach((point) => { if (point.value > 0) doc.circle(point.x, plotBottom - (point.value / axisMax) * chartH, 0.7, "F"); });
    y = plotBottom + 8;
    const legend = [{ label: "Facturado neto", color: C_NETO }, { label: "IVA facturado", color: C_IVA }, { label: "Egresos", color: C_EGRESO }, { label: "Cobrado (caja)", color: C_COBRADO, line: true }];
    legend.forEach((item, index) => {
      const lx = M + index * 44;
      if (item.line) { doc.setDrawColor(...hexRgb(item.color)); doc.setLineWidth(0.6); doc.line(lx, y + 1.5, lx + 4, y + 1.5); doc.setLineWidth(0.2); doc.setFillColor(...hexRgb(item.color)); doc.circle(lx + 2, y + 1.5, 0.7, "F"); }
      else { doc.setFillColor(...hexRgb(item.color)); doc.rect(lx, y, 3, 3, "F"); }
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.4); doc.setTextColor(100, 116, 139);
      doc.text(item.label, lx + 5.5, y + 2.5);
    });
    y += 8;
    caption(`Barra izquierda: facturación del mes, con el IVA apilado sobre el neto. Barra derecha: egresos incurridos. La línea es lo efectivamente cobrado — va aparte porque mide caja, no devengado, y su distancia respecto de la barra de facturación muestra el desfasaje entre facturar y cobrar. Importes en ${currencyLabel}.`);
  }

  /* ---------- Costos ---------- */
  brk(30);
  heading("DISTRIBUCIÓN DE COSTOS POR CATEGORÍA");
  barList(costs.rows || costs, "#0072B2", "Sin egresos registrados en el período.", costs.total, costs.hidden, "categoría(s)");

  /* ---------- Antigüedad de la deuda ---------- */
  if (aging.some((bucket) => bucket.value > 0)) {
    brk(40);
    heading("ANTIGÜEDAD DE LA DEUDA");
    const totalAging = aging.reduce((sum, bucket) => sum + bucket.value, 0) || 1;
    let cursor = M;
    aging.forEach((bucket) => {
      const width = (bucket.value / totalAging) * CW;
      if (width > 0.3) { doc.setFillColor(...hexRgb(bucket.color)); doc.rect(cursor, y, width, 5, "F"); }
      cursor += width;
    });
    y += 8;
    aging.filter((bucket) => bucket.value > 0).forEach((bucket) => {
      brk(6);
      doc.setFillColor(...hexRgb(bucket.color)); doc.rect(M, y - 2, 2.6, 2.6, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(71, 85, 105);
      doc.text(bucket.label, M + 4.5, y);
      doc.setTextColor(148, 163, 184); doc.text(`${bucket.count} factura(s)`, M + 34, y);
      doc.setFont("helvetica", "bold"); doc.setTextColor(15, 23, 42);
      doc.text(fmt(bucket.value), W - M, y, { align: "right" });
      y += 5;
    });
    if (openInvoices.length) {
      y += 2;
      doc.setFont("helvetica", "bold"); doc.setFontSize(6.6); doc.setTextColor(100, 116, 139);
      doc.text("FACTURAS CON MAYOR ATRASO", M, y); y += 4;
      openInvoices.slice(0, 6).forEach((invoice) => {
        brk(6);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(15, 23, 42);
        doc.text(fit(invoice.number, 46), M, y);
        doc.setTextColor(100, 116, 139); doc.text(fit(invoice.client, 62), M + 48, y);
        doc.setTextColor(invoice.days > 90 ? 225 : 100, invoice.days > 90 ? 29 : 116, invoice.days > 90 ? 72 : 139);
        doc.text(`${invoice.days} d`, M + 116, y);
        doc.setFont("helvetica", "bold"); doc.setTextColor(15, 23, 42);
        doc.text(fmt(invoice.balance), W - M, y, { align: "right" });
        y += 4.8;
      });
    }
    y += 3;
    caption("Saldo en bruto (con IVA), que es lo que paga el cliente. Los cobros se imputan por la factura indicada en cada partida; los que no tienen factura vinculada se aplican a las más antiguas del mismo cliente.");
  }

  /* ---------- Proveedores ---------- */
  const supplierRows = suppliers.rows || suppliers;
  if (supplierRows.length) {
    brk(30);
    heading("CONCENTRACIÓN POR PROVEEDOR");
    barList(supplierRows, "#CC79A7", "Sin gastos asociados a proveedores.", suppliers.total, suppliers.hidden, "proveedor(es)");
  }

  /* ---------- Alertas ---------- */
  if (insights.length) {
    brk(24);
    heading("ALERTAS E INTERPRETACIÓN");
    const toneColor = { rose: "#e11d48", amber: "#f59e0b", violet: "#8b5cf6", emerald: "#10b981", slate: "#94a3b8" };
    insights.forEach((insight) => {
      brk(12);
      doc.setFillColor(...hexRgb(toneColor[insight.tone] || "#94a3b8"));
      doc.circle(M + 1.2, y - 0.9, 1.2, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.8); doc.setTextColor(15, 23, 42);
      doc.text(insight.title, M + 4.5, y); y += 3.8;
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(71, 85, 105);
      doc.splitTextToSize(insight.text, CW - 4.5).forEach((line) => { brk(6); doc.text(line, M + 4.5, y); y += 3.4; });
      y += 2.5;
    });
  }

  /* ---------- Notas ---------- */
  brk(18);
  heading("NOTAS METODOLÓGICAS");
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(100, 116, 139);
  [...(rateNote ? [rateNote] : []), ...notes].forEach((note) => {
    doc.splitTextToSize(`•  ${note}`, CW).forEach((line, index) => { brk(5); doc.text(line, M + (index ? 2.6 : 0), y); y += 3.3; });
  });

  /* ---------- Pie ---------- */
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(226, 232, 240); doc.line(M, 285, W - M, 285);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(148, 163, 184);
    doc.text(fit(`${periodLabel || period}  ·  Valores en ${currencyLabel}  ·  Corte ${stamp}`, CW - 25), M, 289);
    doc.text(`Página ${page} de ${pages}`, W - M, 289, { align: "right" });
  }

  doc.save(`finanzas_${period}.pdf`);
}

const hexRgb = (hex) => {
  const raw = String(hex || "").replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = parseInt(full, 16);
  return Number.isNaN(n) || full.length !== 6 ? [148, 163, 184] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
// Redondea el tope del eje a un valor "redondo" (1, 2, 5, 10, 20, 50…) para que las marcas de la
// grilla caigan en números enteros legibles en vez de decimales arbitrarios.
const niceCeil = (value) => {
  if (!(value > 0)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const scaled = value / base;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * base;
};

// Reporte de estado de proyecto para dirección: resumen ejecutivo, gráficos con sus valores
// impresos, cronograma y recomendaciones derivadas por reglas explícitas. Todo sale de las tareas
// cargadas — no hay estimaciones ni datos inventados, y cada criterio queda documentado al final.
export function projectStatusReportPDF({
  projectLabel, generatedBy = "", verdict, progress, kpis = [], byStatus = [], workload = [],
  schedule = [], scheduleNote = "", risks = [], riskNote = "", achievements = [], achievementsNote = "",
  timeline = [], upcoming = [], upcomingTotal = 0, overdueList = [], overdueTotal = 0,
  completionTrend = [], trendCoverage = null, recommendations = [], notes = [],
}) {
  const doc = new jsPDF("p", "mm", "a4");
  const W = 210, M = 15, CW = W - 2 * M;
  const stamp = new Date().toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  let y = 20;
  const drawHead = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text("REPORTE DE ESTADO DE PROYECTO", M, 14);
    doc.setFont("helvetica", "normal");
    doc.text(projectLabel, W - M, 14, { align: "right" });
    doc.setDrawColor(226, 232, 240); doc.line(M, 17, W - M, 17);
    y = 26;
  };
  const brk = (need = 8) => { if (y + need > 272) { doc.addPage(); drawHead(); return true; } return false; };

  const heading = (text) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(241, 135, 0);
    doc.text(text, M, y);
    doc.setDrawColor(241, 135, 0); doc.setLineWidth(0.4); doc.line(M, y + 1.6, M + doc.getTextWidth(text), y + 1.6); doc.setLineWidth(0.2);
    y += 7;
  };
  // El estilo se vuelve a aplicar en cada línea porque un salto de página redibuja el encabezado
  // y deja la fuente en negrita: sin esto, la línea siguiente al corte saldría con otro formato.
  const caption = (text) => {
    const lines = (() => { doc.setFont("helvetica", "italic"); doc.setFontSize(6.8); return doc.splitTextToSize(text, CW); })();
    lines.forEach((line) => {
      brk(5);
      doc.setFont("helvetica", "italic"); doc.setFontSize(6.8); doc.setTextColor(148, 163, 184);
      doc.text(line, M, y); y += 3.2;
    });
    doc.setFont("helvetica", "normal");
    y += 1.5;
  };
  // Trunca al ancho real disponible (medido con la fuente activa) en vez de un límite fijo de
  // caracteres: así aprovecha todo el ancho de columna y no corta el texto antes de tiempo.
  const fit = (text, maxWidth) => {
    const str = String(text ?? "—");
    if (!maxWidth || doc.getTextWidth(str) <= maxWidth) return str;
    let lo = 0, hi = str.length;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (doc.getTextWidth(str.slice(0, mid) + "…") <= maxWidth) lo = mid; else hi = mid - 1; }
    return str.slice(0, lo) + "…";
  };
  // Semáforo corporativo: un único mapa de color para riesgos, indicadores y estado general, para
  // que "rojo" signifique siempre lo mismo en todo el documento.
  const LIGHT = { verde: "#10b981", ambar: "#f59e0b", rojo: "#e11d48", neutro: "#94a3b8" };
  const onWhite = (hex, weight) => hexRgb(hex).map((c) => Math.round(255 - (255 - c) * weight));
  const dot = (cx, cy, hex, r = 1.3) => { doc.setFillColor(...hexRgb(hex)); doc.circle(cx, cy, r, "F"); };

  const table = (rows, cols, emptyText) => {
    if (!rows.length) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(148, 163, 184);
      doc.text(emptyText, M, y); y += 8; return;
    }
    const header = () => {
      doc.setFillColor(241, 245, 249); doc.rect(M, y - 3.6, CW, 5.6, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.4); doc.setTextColor(71, 85, 105);
      cols.forEach((c) => doc.text(c.label, M + c.x, y, { align: c.align || "left" }));
      y += 5;
    };
    header();
    rows.forEach((row, index) => {
      if (brk(9)) header();
      if (index % 2 === 1) { doc.setFillColor(250, 251, 252); doc.rect(M, y - 3.4, CW, 5.4, "F"); }
      if (row._flag) { doc.setFillColor(...hexRgb(row._flag)); doc.rect(M - 1.6, y - 3.4, 1, 5.4, "F"); }
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(15, 23, 42);
      cols.forEach((c) => {
        if (c.dot) { dot(M + c.x + 1.3, y - 1, c.dot(row)); return; }
        if (c.color) doc.setTextColor(...hexRgb(c.color(row))); else doc.setTextColor(15, 23, 42);
        if (c.bold?.(row)) doc.setFont("helvetica", "bold"); else doc.setFont("helvetica", "normal");
        doc.text(fit(c.value(row), c.maxWidth), M + c.x, y, { align: c.align || "left" });
      });
      y += 5.4;
    });
    doc.setDrawColor(226, 232, 240); doc.line(M, y - 3.2, W - M, y - 3.2);
    y += 2;
  };

  /* ---------- Portada ---------- */
  drawLogo(doc, M, 12);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
  doc.text("REPORTE DE ESTADO DE PROYECTO", W - M, 16, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  doc.text(fit(projectLabel, 120), W - M, 22.5, { align: "right" });
  doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
  doc.text(`Corte de datos: ${stamp}${generatedBy ? ` · Emitido por ${generatedBy}` : ""}`, W - M, 27.5, { align: "right" });
  doc.setDrawColor(203, 213, 225); doc.line(M, 33, W - M, 33);
  y = 42;

  /* ---------- Estado general: semáforo y veredicto ---------- */
  heading("RESUMEN EJECUTIVO");
  if (verdict) {
    const vc = LIGHT[verdict.level] || LIGHT.neutro;
    doc.setFillColor(...onWhite(vc, 0.08)); doc.setDrawColor(...onWhite(vc, 0.45));
    doc.roundedRect(M, y, CW, 15, 2, 2, "FD");
    doc.setFillColor(...hexRgb(vc)); doc.roundedRect(M + 1.4, y + 1.8, 1.6, 11.4, 0.8, 0.8, "F");
    dot(M + 9, y + 5.2, vc, 2);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(15, 23, 42);
    doc.text(verdict.title, M + 13.5, y + 6);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(71, 85, 105);
    doc.text(fit(verdict.text, CW - 17), M + 13.5, y + 11);
    y += 19;
  }

  /* ---------- Indicadores clave ---------- */
  const cardW = (CW - 2 * 3) / 3, cardH = 17;
  kpis.forEach((kpi, index) => {
    const col = index % 3, row = Math.floor(index / 3);
    const cx = M + col * (cardW + 3), cy = y + row * (cardH + 3);
    doc.setFillColor(250, 251, 252); doc.setDrawColor(226, 232, 240);
    doc.roundedRect(cx, cy, cardW, cardH, 1.5, 1.5, "FD");
    doc.setFillColor(...hexRgb(kpi.accent || "#F18700"));
    doc.rect(cx, cy + 1.5, 1.2, cardH - 3, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(100, 116, 139);
    doc.text(fit(kpi.label, cardW - 8), cx + 4, cy + 5);
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
    doc.text(String(kpi.value), cx + 4, cy + 11.8);
    if (kpi.hint) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.2); doc.setTextColor(148, 163, 184);
      doc.text(fit(kpi.hint, cardW - 8), cx + 4, cy + 15);
    }
  });
  y += Math.ceil(kpis.length / 3) * (cardH + 3) + 3;

  /* ---------- Avance general: bloque protagonista ---------- */
  // En vez de una barra de un solo color con el % al costado, el avance se muestra como la
  // composición completa del trabajo: cada tramo es un estado del tablero, así se lee de un vistazo
  // no solo cuánto se completó sino cuánto está en curso y cuánto ni siquiera arrancó.
  const pct = Math.max(0, Math.min(100, Math.round(progress?.pct || 0)));
  const pctColor = LIGHT[verdict?.level] || LIGHT.neutro;
  const stackTotal = byStatus.reduce((sum, s) => sum + s.value, 0);
  const heroH = stackTotal ? 34 : 24;
  brk(heroH + 6);
  doc.setFillColor(250, 251, 252); doc.setDrawColor(226, 232, 240);
  doc.roundedRect(M, y, CW, heroH, 2, 2, "FD");

  const heroPad = 6;
  doc.setFont("helvetica", "bold"); doc.setFontSize(6.4); doc.setTextColor(148, 163, 184);
  doc.text("AVANCE GENERAL", M + heroPad, y + 7);
  doc.setFont("helvetica", "bold"); doc.setFontSize(30); doc.setTextColor(...hexRgb(pctColor));
  doc.text(`${pct}%`, M + heroPad, y + 22);
  const pctW = doc.getTextWidth(`${pct}%`);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
  doc.text(`${progress?.done || 0} de ${progress?.total || 0} tareas`, M + heroPad, y + 28);

  const stackX = M + heroPad + Math.max(pctW + 10, 42), stackW = W - M - heroPad - stackX;
  if (stackTotal) {
    const barY = y + 11, barH = 9;
    // Los tramos se dibujan de "Hecho" hacia "Por hacer": el avance crece de izquierda a derecha.
    const segments = [...byStatus].reverse().filter((s) => s.value > 0);
    const gap = 1;
    let cursor = stackX;
    segments.forEach((segment) => {
      const segW = (segment.value / stackTotal) * stackW;
      const drawW = Math.max(1, segW - gap);
      doc.setFillColor(...hexRgb(segment.color));
      doc.roundedRect(cursor, barY, drawW, barH, 1.2, 1.2, "F");
      // El número va dentro del tramo cuando entra; si es angosto, queda solo en la leyenda.
      if (drawW >= 7) {
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.4); doc.setTextColor(255, 255, 255);
        doc.text(String(segment.value), cursor + drawW / 2, barY + 6, { align: "center" });
      }
      cursor += segW;
    });
    // Leyenda: nombre, cantidad y porcentaje de cada estado, repartida a lo ancho de la barra.
    const legendSlot = stackW / segments.length;
    segments.forEach((segment, index) => {
      const lx = stackX + legendSlot * index;
      dot(lx + 1, y + 25.5, segment.color, 1.1);
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.2); doc.setTextColor(71, 85, 105);
      doc.text(fit(segment.name, legendSlot - 5), lx + 3.4, y + 26.4);
      doc.setFont("helvetica", "bold"); doc.setFontSize(6.2); doc.setTextColor(15, 23, 42);
      doc.text(`${segment.value} · ${Math.round((segment.value / stackTotal) * 100)}%`, lx + 3.4, y + 30.2);
    });
  }
  y += heroH + 3;
  caption(stackTotal
    ? `El porcentaje es la proporción de tareas en estado Hecho sobre las ${stackTotal} del alcance. La barra descompone ese total por estado del tablero, de lo terminado (izquierda) a lo no iniciado (derecha).`
    : "Sin tareas cargadas en el alcance del reporte.");

  /* ---------- Cumplimiento de plazos: planificado vs. cumplido en fecha ---------- */
  if (schedule.length) {
    brk(28 + schedule.length * 10);
    heading("CUMPLIMIENTO DE PLAZOS POR MES");
    const labelW = 18, valueW = 30, barMax = CW - labelW - valueW;
    const axisMax = niceCeil(Math.max(...schedule.map((s) => s.planned)));
    schedule.forEach((row) => {
      brk(12);
      doc.setFont("helvetica", "bold"); doc.setFontSize(6.8); doc.setTextColor(71, 85, 105);
      doc.text(row.name, M, y + 4);
      const plannedW = (row.planned / axisMax) * barMax, metW = (row.met / axisMax) * barMax;
      doc.setFillColor(203, 213, 225);
      if (plannedW > 0.3) doc.rect(M + labelW, y, plannedW, 3.1, "F");
      doc.setFillColor(...hexRgb(row.met === row.planned ? LIGHT.verde : row.met === 0 ? LIGHT.rojo : LIGHT.ambar));
      if (metW > 0.3) doc.rect(M + labelW, y + 4, metW, 3.1, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.2); doc.setTextColor(100, 116, 139);
      doc.text(`${row.planned} planificada(s)`, M + labelW + barMax + 2, y + 2.5);
      // El estado del mes se nombra, no solo se colorea.
      const monthPct = row.planned ? Math.round((row.met / row.planned) * 100) : 0;
      const monthLevel = row.met === row.planned ? LIGHT.verde : row.met === 0 ? LIGHT.rojo : LIGHT.ambar;
      const monthLabel = row.met === row.planned ? "En plazo" : row.met === 0 ? "Sin cierres" : "Desviación";
      doc.setFont("helvetica", "bold"); doc.setTextColor(...hexRgb(monthLevel));
      doc.text(`${monthLabel} · ${monthPct}%`, M + labelW + barMax + 2, y + 6.5);
      y += 10;
    });
    y += 1;
    doc.setFillColor(203, 213, 225); doc.rect(M, y, 3, 3, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(100, 116, 139);
    doc.text("Planificado (tareas con vencimiento en el mes)", M + 4.5, y + 2.5);
    doc.setFillColor(...hexRgb(LIGHT.verde)); doc.rect(M + 78, y, 3, 3, "F");
    doc.text("Completado en fecha o antes", M + 82.5, y + 2.5);
    y += 8;
    caption(scheduleNote || "Compara, para cada mes, cuántas tareas tenían vencimiento y cuántas se completaron dentro de ese plazo.");
  }

  /* ---------- Carga y cumplimiento por responsable ---------- */
  brk(30 + workload.length * 6);
  heading("CARGA Y CUMPLIMIENTO POR RESPONSABLE");
  if (!workload.length) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(148, 163, 184);
    doc.text("No hay tareas pendientes asignadas.", M, y); y += 8;
  } else {
    const labelW = 42, valueW = 26, barMax = CW - labelW - valueW;
    const maxTotal = niceCeil(Math.max(...workload.map((r) => r.total)));
    doc.setFontSize(7.2);
    workload.forEach((row) => {
      brk(8);
      doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42);
      doc.text(fit(row.name, labelW - 2), M, y + 2.6);
      const onTime = Math.max(0, row.total - row.overdue);
      const onTimeW = (onTime / maxTotal) * barMax, overdueW = (row.overdue / maxTotal) * barMax;
      if (onTimeW > 0.3) { doc.setFillColor(14, 165, 233); doc.rect(M + labelW, y, onTimeW, 3.8, "F"); }
      if (overdueW > 0.3) { doc.setFillColor(225, 29, 72); doc.rect(M + labelW + onTimeW, y, overdueW, 3.8, "F"); }
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.2); doc.setTextColor(15, 23, 42);
      doc.text(String(row.total), M + labelW + barMax + 6, y + 2.8, { align: "right" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.8);
      doc.setTextColor(row.overdue > 0 ? 225 : 148, row.overdue > 0 ? 29 : 163, row.overdue > 0 ? 72 : 184);
      doc.text(row.overdue > 0 ? `${row.overdue} vencida(s)` : "al día", M + labelW + barMax + 8, y + 2.8);
      doc.setFontSize(7.2);
      y += 6;
    });
    y += 1;
    doc.setFillColor(14, 165, 233); doc.rect(M, y, 3, 3, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(100, 116, 139);
    doc.text("Pendientes en plazo", M + 4.5, y + 2.5);
    doc.setFillColor(225, 29, 72); doc.rect(M + 42, y, 3, 3, "F");
    doc.text("Pendientes vencidas", M + 46.5, y + 2.5);
    y += 8;
    caption("Tareas pendientes (excluye las marcadas como Hecho) de las que cada persona es responsable. El largo total de la barra es la carga; el tramo rojo, la parte ya vencida.");
  }

  /* ---------- Riesgos y desvíos ---------- */
  brk(34);
  heading("RIESGOS Y DESVÍOS");
  table(risks, [
    { label: "", x: 0, dot: (r) => LIGHT[r.level] || LIGHT.neutro },
    // La severidad va como texto además del color: impreso en blanco y negro, o para alguien con
    // daltonismo, el punto de color solo no comunica nada.
    { label: "Severidad", x: 5, maxWidth: 14, value: (r) => r.severityLabel, color: (r) => LIGHT[r.level] || LIGHT.neutro, bold: (r) => r.level === "rojo" },
    { label: "Tarea", x: 21, maxWidth: 59, value: (r) => r.title },
    { label: "Responsable", x: 82, maxWidth: 22, value: (r) => r.assignee },
    { label: "Impacto", x: 106, maxWidth: 13, value: (r) => r.impact },
    { label: "Probabilidad", x: 121, maxWidth: 21, value: (r) => r.probability },
    { label: "Situación", x: 180, align: "right", maxWidth: 26, value: (r) => r.reason, color: (r) => LIGHT[r.level] || LIGHT.neutro },
  ], "Sin riesgos detectados: ninguna tarea pendiente está vencida, estancada ni con vencimiento inminente.");
  caption(riskNote || "Riesgos derivados automáticamente de los datos del tablero. Impacto = prioridad de la tarea. Probabilidad = cercanía al vencimiento y actividad reciente. No es un registro de riesgos curado manualmente.");

  /* ---------- Logros del período ---------- */
  brk(30);
  heading("LOGROS DEL PERÍODO");
  table(achievements, [
    { label: "Tarea completada", x: 0, maxWidth: 96, value: (r) => r.title },
    { label: "Responsable", x: 100, maxWidth: 34, value: (r) => r.assignee },
    { label: "Cierre", x: 180, align: "right", value: (r) => r.closed, color: () => LIGHT.verde },
  ], "No se registraron cierres de tareas en los últimos 30 días.");
  if (achievements.length) caption(achievementsNote || "Tareas marcadas como Hecho en los últimos 30 días, según la fecha del cambio de estado.");

  /* ---------- Cronograma de vencimientos ---------- */
  if (timeline.length) {
    brk(28 + timeline.length * 5.4);
    heading("CRONOGRAMA DE VENCIMIENTOS");
    const labelW = 74, trackX = M + labelW, trackW = CW - labelW - 28;
    const times = timeline.map((t) => t.dueTime);
    const minT = Math.min(...times, Date.now()), maxT = Math.max(...times, Date.now());
    const span = Math.max(1, maxT - minT);
    const posOf = (time) => trackX + ((time - minT) / span) * trackW;
    const todayX = posOf(Date.now());
    doc.setDrawColor(226, 232, 240); doc.line(trackX, y - 1, trackX + trackW, y - 1);
    doc.setDrawColor(241, 135, 0); doc.setLineDashPattern([1, 1], 0);
    doc.line(todayX, y - 1, todayX, y + timeline.length * 5.4 + 1);
    doc.setLineDashPattern([], 0);
    doc.setFont("helvetica", "bold"); doc.setFontSize(6); doc.setTextColor(241, 135, 0);
    doc.text("HOY", todayX, y - 2.5, { align: "center" });
    timeline.forEach((item) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(15, 23, 42);
      doc.text(fit(item.title, labelW - 3), M, y + 2.6);
      const px = posOf(item.dueTime);
      const barStart = item.overdue ? px : Math.min(px, todayX);
      const barEnd = item.overdue ? todayX : px;
      const barW = Math.max(1.2, Math.abs(barEnd - barStart));
      doc.setFillColor(...hexRgb(item.color));
      doc.roundedRect(Math.min(barStart, barEnd), y, barW, 3.2, 0.6, 0.6, "F");
      doc.setFontSize(6.2); doc.setTextColor(100, 116, 139);
      doc.text(item.dueLabel, trackX + trackW + 2, y + 2.5);
      y += 5.4;
    });
    y += 2;
    // Leyenda con el significado de cada color, para no depender solo del tono de la barra.
    [["Vencida", LIGHT.rojo], ["Por vencer", LIGHT.ambar], ["En plazo", "#0ea5e9"]].forEach(([label, color], index) => {
      const lx = M + index * 32;
      doc.setFillColor(...hexRgb(color)); doc.rect(lx, y, 3, 3, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(100, 116, 139);
      doc.text(label, lx + 4.5, y + 2.5);
    });
    y += 7;
    caption("Distancia entre hoy y la fecha límite de cada tarea pendiente, ordenadas por vencimiento. Las barras rojas se extienden hacia atrás: son tareas cuya fecha ya pasó.");
  }

  /* ---------- Próximos pasos ---------- */
  brk(30);
  heading("PRÓXIMOS PASOS");
  table(upcoming, [
    { label: "Tarea", x: 0, maxWidth: 70, value: (r) => r.title },
    { label: "Responsable", x: 73, maxWidth: 24, value: (r) => r.assignee },
    { label: "Prioridad", x: 99, maxWidth: 16, value: (r) => r.priority },
    // Etiqueta explícita del plazo: sin esto la urgencia se leía únicamente por el color ámbar.
    { label: "Plazo", x: 117, maxWidth: 20, value: (r) => r.plazoLabel, color: (r) => (r.soon ? LIGHT.ambar : LIGHT.verde), bold: (r) => r.soon },
    { label: "Estado", x: 139, maxWidth: 20, value: (r) => r.status },
    { label: "Vence", x: 180, align: "right", value: (r) => r.due, bold: (r) => r.soon },
  ], "No hay tareas pendientes cargadas.");
  if (upcomingTotal > upcoming.length) caption(`Se listan las ${upcoming.length} próximas por fecha de vencimiento, de ${upcomingTotal} tarea(s) pendientes en total. "Por vencer" marca las que caen dentro de los próximos 4 días.`);
  else if (upcoming.length) caption('Ordenadas por fecha de vencimiento y prioridad. "Por vencer" marca las que caen dentro de los próximos 4 días.');

  /* ---------- Tareas vencidas ---------- */
  brk(30);
  heading("TAREAS VENCIDAS");
  table(overdueList, [
    { label: "Tarea", x: 0, maxWidth: 84, value: (r) => r.title },
    { label: "Responsable", x: 88, maxWidth: 30, value: (r) => r.assignee },
    { label: "Prioridad", x: 121, maxWidth: 20, value: (r) => r.priority },
    { label: "Estado", x: 143, maxWidth: 22, value: (r) => r.status },
    { label: "Atraso", x: 180, align: "right", value: (r) => r.due, color: () => "#e11d48", bold: () => true },
  ], "No hay tareas vencidas. Todas las tareas pendientes están dentro de plazo.");
  if (overdueTotal > overdueList.length) caption(`Se listan las ${overdueList.length} de mayor atraso, de ${overdueTotal} tarea(s) vencidas en total.`);

  /* ---------- Tendencia de cierre ---------- */
  if (completionTrend.length >= 2) {
    brk(52);
    heading("TENDENCIA: TAREAS COMPLETADAS POR MES");
    const chartH = 30, axisW = 9;
    const plotX = M + axisW, plotW = CW - axisW, plotBottom = y + chartH;
    const axisMax = niceCeil(Math.max(...completionTrend.map((p) => p.value)));
    doc.setFontSize(6.4);
    for (let i = 0; i <= 2; i++) {
      const gy = plotBottom - (chartH * i) / 2;
      doc.setDrawColor(i === 0 ? 203 : 233, i === 0 ? 213 : 238, i === 0 ? 225 : 244);
      doc.line(plotX, gy, plotX + plotW, gy);
      doc.setTextColor(148, 163, 184);
      doc.text(String(Math.round((axisMax * i) / 2)), plotX - 1.5, gy + 1, { align: "right" });
    }
    const slot = plotW / completionTrend.length, barW = Math.min(14, slot * 0.5);
    completionTrend.forEach((point, index) => {
      const bx = plotX + slot * index + (slot - barW) / 2;
      const bh = (point.value / axisMax) * chartH;
      if (bh > 0.3) { doc.setFillColor(16, 185, 129); doc.roundedRect(bx, plotBottom - bh, barW, bh, 0.6, 0.6, "F"); }
      doc.setFont("helvetica", "bold"); doc.setFontSize(6.8); doc.setTextColor(15, 23, 42);
      doc.text(String(point.value), bx + barW / 2, plotBottom - bh - 1.6, { align: "center" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.2); doc.setTextColor(100, 116, 139);
      doc.text(point.name, bx + barW / 2, plotBottom + 3.8, { align: "center" });
    });
    y = plotBottom + 9;
    caption(trendCoverage || "Tareas marcadas como Hecho en cada mes, según la fecha registrada en su historial de cambios de estado.");
  }

  /* ---------- Recomendaciones ---------- */
  if (recommendations.length) {
    brk(24);
    heading("PUNTOS DE ATENCIÓN");
    recommendations.forEach((item) => {
      brk(12);
      doc.setFillColor(...hexRgb(item.color));
      doc.circle(M + 1.2, y - 0.9, 1.2, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.8); doc.setTextColor(15, 23, 42);
      doc.text(item.title, M + 4.5, y);
      y += 3.8;
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(71, 85, 105);
      doc.splitTextToSize(item.text, CW - 4.5).forEach((line) => {
        brk(6);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(71, 85, 105);
        doc.text(line, M + 4.5, y); y += 3.4;
      });
      y += 2.5;
    });
  }

  /* ---------- Notas metodológicas ---------- */
  if (notes.length) {
    brk(16 + notes.length * 4);
    heading("NOTAS METODOLÓGICAS");
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(100, 116, 139);
    notes.forEach((note) => {
      doc.splitTextToSize(`•  ${note}`, CW).forEach((line, index) => {
        brk(5);
        doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(100, 116, 139);
        doc.text(line, M + (index ? 2.6 : 0), y); y += 3.3;
      });
    });
  }

  /* ---------- Pie de página en todas las hojas ---------- */
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(226, 232, 240); doc.line(M, 285, W - M, 285);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(148, 163, 184);
    doc.text(fit(`${projectLabel}  ·  Corte de datos ${stamp}`, CW - 25), M, 289);
    doc.text(`Página ${page} de ${pages}`, W - M, 289, { align: "right" });
  }

  doc.save(`reporte_estado_${projectLabel.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.pdf`);
}
