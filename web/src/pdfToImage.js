// Renderiza la primera página de un PDF a una imagen, para poder correrle el mismo OCR local
// (Tesseract.js) que ya se usa con las fotos de comprobantes. Usa pdf.js (pdfjs-dist) — corre
// 100% en el navegador, sin servicio externo ni API key, igual que el resto del pipeline de OCR.
//
// Nota: solo se procesa la PRIMERA página. La gran mayoría de facturas/tickets entran en una sola
// página; si en algún caso real llega un PDF de varias páginas con datos en la página 2+, avisar
// para extender esto (recorrer todas las páginas y concatenar el texto reconocido).
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;

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
