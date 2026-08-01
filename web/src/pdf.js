import { jsPDF } from "jspdf";
import { LOGO, LOGO_RATIO } from "./logo";

// Ancho del logo en el PDF (mm)
const LOGO_W = 42;

const money = (n) => "$" + (Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function totals(o) {
  const labor = o.laborBillable ? (Number(o.laborHours) || 0) * (Number(o.rate) || 0) : 0;
  const mats = (o.materials || []).filter((m) => m.billable).reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.price) || 0), 0);
  return { labor, mats, total: labor + mats };
}
// Dibuja el logo arriba a la izquierda; devuelve el alto ocupado
function drawLogo(doc, M, y) {
  const w = LOGO_W, h = w * LOGO_RATIO;
  try { doc.addImage(LOGO, "PNG", M, y, w, h); } catch {}
  return h;
}

export function orderReceiptPDF(order, ger) {
  const doc = new jsPDF("p", "mm", "a4");
  const W = 210, M = 15;
  const priced = !!ger;
  let y = 16;
  const brk = (need = 8) => { if (y + need > 285) { doc.addPage(); y = 20; } };

  /* Encabezado con logo */
  const lh = drawLogo(doc, M, y - 4);
  doc.setFontSize(11); doc.setTextColor(100, 116, 139);
  doc.text(priced ? "COMPROBANTE DE SERVICIO" : "CONSTANCIA DE TRABAJO", W - M, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`Folio: ${order.id}`, W - M, y, { align: "right" }); y += 4;
  doc.text(`Fecha: ${order.date || ""}`, W - M, y, { align: "right" });
  y = Math.max(y, (y - 10) + lh) ; // asegura espacio bajo el logo
  doc.setDrawColor(226, 232, 240); doc.line(M, y + 2, W - M, y + 2); y += 9;

  /* Datos */
  doc.setTextColor(15, 23, 42); doc.setFontSize(10);
  const kv = (k, v) => { doc.setFont("helvetica", "bold"); doc.text(k, M, y); doc.setFont("helvetica", "normal"); doc.text(String(v || "—"), M + 32, y); y += 5.5; };
  kv("Cliente:", order.client);
  kv("Sitio:", order.site);
  if (order.contact) kv("Contacto:", order.contact);
  kv("Servicio:", order.service);
  if (order.tech) kv("Técnico:", order.tech);
  y += 2;

  const section = (t) => { brk(12); doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(2, 132, 199); doc.text(t, M, y); doc.setTextColor(15, 23, 42); y += 5; };
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
  para("Trabajo realizado:", order.solucion);
  y += 2;

  /* Registro fotográfico */
  const fotos = (order.photos || []).filter((p) => p && p.url);
  if (fotos.length) {
    brk(40);
    section("Registro fotográfico");
    const gap = 4, cols = 3, iw = (W - 2 * M - gap * (cols - 1)) / cols, ih = iw * 0.75;
    let cx = M, col = 0;
    if (y + ih + 6 > 285) { doc.addPage(); y = 20; }
    fotos.forEach((p) => {
      if (col === cols) { col = 0; cx = M; y += ih + 8; if (y + ih + 6 > 285) { doc.addPage(); y = 20; } }
      const fmt = /^data:image\/png/i.test(p.url) ? "PNG" : "JPEG";
      try { doc.addImage(p.url, fmt, cx, y, iw, ih); } catch {}
      doc.setDrawColor(226, 232, 240); doc.rect(cx, y, iw, ih);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
      doc.text(String(p.cat || "").toUpperCase(), cx + 1, y + ih + 3.5);
      cx += iw + gap; col++;
    });
    y += ih + 10;
    doc.setTextColor(15, 23, 42);
  }

  /* Materiales */
  if ((order.materials || []).length) {
    section("Materiales y repuestos");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139);
    doc.text("Cant.", M, y); doc.text("Descripción", M + 16, y);
    if (priced) { doc.text("P. unit", W - M - 38, y, { align: "right" }); doc.text("Importe", W - M, y, { align: "right" }); }
    y += 2; doc.setDrawColor(241, 245, 249); doc.line(M, y, W - M, y); y += 4;
    doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42); doc.setFontSize(9);
    (order.materials || []).forEach((m) => {
      brk(8);
      doc.text(String(m.qty || 0), M, y);
      const nm = doc.splitTextToSize(String(m.name || "—"), priced ? 95 : 150);
      doc.text(nm, M + 16, y);
      if (priced) {
        doc.text(money(m.price), W - M - 38, y, { align: "right" });
        doc.text(money((m.qty || 0) * (m.price || 0)), W - M, y, { align: "right" });
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
    brk(30);
    const t = totals(order); const bw = 74, bx = W - M - bw;
    doc.setDrawColor(226, 232, 240); doc.setFillColor(248, 250, 252);
    doc.roundedRect(bx, y, bw, 23, 2, 2, "FD");
    doc.setFontSize(9); doc.setTextColor(71, 85, 105); doc.setFont("helvetica", "normal");
    doc.text("Mano de obra", bx + 3, y + 6); doc.text(money(t.labor), bx + bw - 3, y + 6, { align: "right" });
    doc.text("Materiales", bx + 3, y + 11.5); doc.text(money(t.mats), bx + bw - 3, y + 11.5, { align: "right" });
    doc.setDrawColor(226, 232, 240); doc.line(bx + 3, y + 14.5, bx + bw - 3, y + 14.5);
    doc.setFont("helvetica", "bold"); doc.setTextColor(15, 23, 42); doc.setFontSize(10.5);
    doc.text("TOTAL", bx + 3, y + 20); doc.text(money(t.total), bx + bw - 3, y + 20, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 29;
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

  /* Pie */
  doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
  doc.text(`Documento generado el ${new Date().toLocaleString("es-MX")}${priced ? "" : "  ·  Documento sin valores monetarios"}`, M, 290);

  doc.save(`${order.id}.pdf`);
}

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
