// Renderiza la primera página de un PDF a una imagen, para poder correrle el mismo OCR local
// (Tesseract.js) que ya se usa con las fotos de comprobantes. Usa pdf.js (pdfjs-dist) — corre
// 100% en el navegador, sin servicio externo ni API key, igual que el resto del pipeline de OCR.
//
// Nota: solo se procesa la PRIMERA página. La gran mayoría de facturas/tickets entran en una sola
// página; si en algún caso real llega un PDF de varias páginas con datos en la página 2+, avisar
// para extender esto (recorrer todas las páginas y concatenar el texto reconocido).
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;

// Extrae el texto embebido del PDF, sin pasar por OCR. Sirve para los PDF generados por sistema
// (avisos de pago, liquidaciones): el texto ya está adentro, reconocerlo con OCR sería reintroducir
// errores en un dato exacto. Devuelve "" si el PDF es un escaneo sin capa de texto.
export async function pdfExtractText(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const content = await (await pdf.getPage(number)).getTextContent();
    // pdf.js entrega fragmentos sueltos con su posición; se reagrupan por coordenada Y para
    // reconstruir las filas de la tabla, que es lo que después se parsea.
    const rows = new Map();
    content.items.forEach((item) => {
      if (!item.str?.trim()) return;
      const y = Math.round(item.transform[5]);
      const key = [...rows.keys()].find((existing) => Math.abs(existing - y) <= 2) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: item.transform[4], text: item.str });
    });
    [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([, items]) => pages.push(items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim()));
  }
  return pages.join("\n");
}

export async function pdfFirstPageToImage(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  // Escala 2x: suficiente resolución para que el OCR lea bien el texto sin generar una imagen
  // enorme innecesariamente pesada.
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.92);
}
