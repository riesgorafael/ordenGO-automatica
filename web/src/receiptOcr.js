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

// Escala de grises + realce de contraste: el mismo tipo de "limpieza" que hacen apps de escaneo
// como CamScanner antes de aplicar OCR, pero corriendo local con canvas — sin subir la foto a
// ningún servicio de terceros. Ayuda especialmente con fotos de celular con sombras o poca luz.
function enhanceForOcr(imageDataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const contrast = 1.35;
      for (let i = 0; i < data.length; i += 4) {
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        const adjusted = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));
        data[i] = data[i + 1] = data[i + 2] = adjusted;
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => resolve(imageDataUrl);
    img.src = imageDataUrl;
  });
}

async function extractText(imageDataUrl) {
  const worker = await getWorker();
  const enhanced = await enhanceForOcr(imageDataUrl);
  const { data } = await worker.recognize(enhanced);
  return data.text || "";
}

// Formato AR: "11.591.800,00" -> 11591800.00
const parseArNumber = (raw) => {
  const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function parseAmount(text) {
  const patterns = [/importe\s*total\D{0,20}\$?\s*([\d.,]+)/i, /total\s*a\s*pagar\D{0,20}\$?\s*([\d.,]+)/i, /\btotal\b\D{0,20}\$?\s*([\d.,]+)/i];
  for (const re of patterns) {
    const m = text.match(re);
    const amount = m && parseArNumber(m[1]);
    if (amount) return amount;
  }
  // Si no encontramos ninguna etiqueta "Total", el número con formato de monto más grande de
  // toda la factura suele ser el total (es casi siempre el importe más alto del comprobante).
  const allAmounts = [...text.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})/g)].map((m) => parseArNumber(m[1])).filter((n) => n > 0);
  return allAmounts.length ? Math.max(...allAmounts) : null;
}

function parseCurrency(text) {
  if (/\bUSD\b|U\$S/i.test(text)) return "USD";
  if (/\bEUR\b|€/i.test(text)) return "EUR";
  return "ARS";
}

// Busca la primera línea de detalle en la tabla de ítems (código + descripción) para sugerir un
// concepto, ej. "APPL  Revest mas materiales varios" → "Revest mas materiales varios".
function parseConcept(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const headerIdx = lines.findIndex((line) => /producto\s*\/?\s*servicio|descripci[oó]n/i.test(line));
  if (headerIdx === -1) return "";
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/importe|subtotal|iva|cantidad|alicuota|total/i.test(line)) continue;
    const cleaned = line.replace(/^[A-Z0-9]{2,8}\s+/, "").replace(/[\d.,]+\s*(unidades?|u\.|kg|hs?)?\s*$/i, "").trim();
    if (cleaned.length > 4) return cleaned;
  }
  return "";
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

// En una factura AFIP el receptor (a quién se le factura) se identifica con la combinación
// "Apellido y Nombre / Razón Social", a diferencia del emisor que solo dice "Razón Social". El
// CUIT del receptor suele aparecer justo antes de esa etiqueta, en la misma línea o cerca.
function parseReceptor(text) {
  const sameLine = text.match(/cuit\s*:?\s*([\d.\-]{10,14})[^\n]{0,60}apellido\s*y\s*nombre\s*\/?\s*raz[oó]n\s*social\s*:?\s*([^\n]+)/i);
  if (sameLine) return { cuit: sameLine[1].replace(/\D/g, ""), name: sameLine[2].trim() };
  const labelIdx = text.search(/apellido\s*y\s*nombre/i);
  if (labelIdx === -1) return { cuit: "", name: "" };
  const before = text.slice(Math.max(0, labelIdx - 60), labelIdx);
  const cuitMatch = before.match(/(\d{2}[.\-]?\d{8}[.\-]?\d)(?!.*\d{2}[.\-]?\d{8}[.\-]?\d)/);
  const nameMatch = text.slice(labelIdx).match(/raz[oó]n\s*social\s*:?\s*([^\n]+)/i);
  return { cuit: cuitMatch ? cuitMatch[1].replace(/\D/g, "") : "", name: nameMatch ? nameMatch[1].trim() : "" };
}

// Devuelve vacío/null en cada campo que no pudo inferir con confianza — el llamador solo debe
// sobrescribir lo que el usuario no cargó a mano, nunca pisar un dato ya escrito.
export async function parseReceiptImage(imageDataUrl) {
  const text = await extractText(imageDataUrl);
  const receptor = parseReceptor(text);
  return {
    amount: parseAmount(text),
    currency: parseCurrency(text),
    concept: parseConcept(text),
    date: parseDate(text),
    supplier: guessSupplier(text),
    receiptNumber: parseReceiptNumber(text),
    vatIncluded: hasVat(text),
    receptorCuit: receptor.cuit,
    receptorName: receptor.name,
    rawText: text,
  };
}
