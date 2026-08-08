// OCR de comprobantes 100% client-side con Tesseract.js: corre en el navegador (WebAssembly),
// no requiere API key ni servicio pago de terceros. A cambio de eso, es un OCR genérico (no un
// extractor de documentos entrenado) — por eso el parseo de campos es best-effort vía regex sobre
// el texto crudo reconocido, y el formulario de carga siempre pide revisión manual antes de guardar.
import { createWorker } from "tesseract.js";

let workerPromise = null;
function getWorker() {
  if (!workerPromise) workerPromise = createWorker("spa");
  return workerPromise;
}

async function extractText(imageDataUrl) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageDataUrl);
  return data.text || "";
}

// Formato AR: "11.591.800,00" -> 11591800.00
const parseArNumber = (raw) => {
  const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function parseAmount(text) {
  const patterns = [/importe\s*total\D{0,15}\$?\s*([\d.,]+)/i, /total\D{0,15}\$?\s*([\d.,]+)/i];
  for (const re of patterns) {
    const m = text.match(re);
    const amount = m && parseArNumber(m[1]);
    if (amount) return amount;
  }
  return null;
}

function parseDate(text) {
  const dateRe = /(\d{2})[\/\-](\d{2})[\/\-](\d{4})/g;
  const matches = [...text.matchAll(dateRe)];
  if (!matches.length) return "";
  const emissionIdx = text.toLowerCase().indexOf("emisi");
  const near = emissionIdx !== -1
    ? matches.find((m) => Math.abs(m.index - emissionIdx) < 60)
    : null;
  const [, d, mo, y] = near || matches[0];
  return `${y}-${mo}-${d}`;
}

function parseReceiptNumber(text) {
  const pos = text.match(/punto\s*de\s*venta\s*:?\s*(\d+)/i);
  const comp = text.match(/comp\.?\s*nro\.?\s*:?\s*(\d+)/i);
  if (pos && comp) return `${pos[1].padStart(5, "0")}-${comp[1].padStart(8, "0")}`;
  return comp ? comp[1] : "";
}

function guessSupplier(text) {
  const razonSocial = text.match(/raz[oó]n\s*social\s*:?\s*([^\n]+)/i);
  if (razonSocial) return razonSocial[1].trim();
  const line = text.split("\n").map((l) => l.trim())
    .find((l) => l.length > 4 && !/factura|cuit|fecha|iva|importe|original|duplicado/i.test(l));
  return line || "";
}

const hasVat = (text) => /iva\s*(21|27|10[.,]5)\s*%/i.test(text);

// Devuelve null en cada campo que no pudo inferir con confianza — el llamador solo debe
// sobrescribir lo que el usuario no cargó a mano, nunca pisar un dato ya escrito.
export async function parseReceiptImage(imageDataUrl) {
  const text = await extractText(imageDataUrl);
  return {
    amount: parseAmount(text),
    date: parseDate(text),
    supplier: guessSupplier(text),
    receiptNumber: parseReceiptNumber(text),
    vatIncluded: hasVat(text),
    rawText: text,
  };
}
