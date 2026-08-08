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

// Escala de grises + estiramiento de contraste ADAPTATIVO (por percentiles del histograma real
// de la foto, no un factor fijo) — el mismo tipo de "limpieza" que hacen apps de escaneo como
// CamScanner antes de aplicar OCR, pero corriendo local con canvas, sin subir la foto a ningún
// servicio de terceros. Un factor de contraste fijo (como antes) sobrecorrige fotos ya bien
// iluminadas y no alcanza para las muy oscuras; estirar entre el percentil 2 y 98 reales de cada
// foto se adapta a la iluminación real de cada captura.
// De paso se mide la calidad de la foto (oscura / quemada de luz / borrosa) para poder avisarle
// al usuario CUÁL de esas tres cosas está afectando la lectura, en vez de un genérico "revisá los
// datos" — es lo que pidió: verificar iluminación y nitidez, no solo intentar leer igual.
function enhanceForOcr(imageDataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.width, h = img.height, n = w * h;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const gray = new Uint8ClampedArray(n);
      const histogram = new Array(256).fill(0);
      let sum = 0;
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const g = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
        gray[i] = g;
        histogram[Math.round(g)]++;
        sum += g;
      }
      const meanBrightness = sum / n;

      const loTarget = n * 0.02, hiTarget = n * 0.98;
      let cum = 0, lo = 0, hi = 255;
      for (let v = 0; v < 256; v++) { cum += histogram[v]; if (cum >= loTarget) { lo = v; break; } }
      cum = 0;
      for (let v = 0; v < 256; v++) { cum += histogram[v]; if (cum >= hiTarget) { hi = v; break; } }
      if (hi <= lo) hi = lo + 1;
      const range = hi - lo;

      // Nitidez: promedio de diferencia entre píxeles horizontales vecinos. Una foto enfocada
      // tiene bordes marcados (diferencias grandes); una borrosa, transiciones suaves (diferencias
      // chicas). Es un proxy simple, no una medición de nitidez "real", pero alcanza para avisar.
      let gradSum = 0;
      for (let y = 0; y < h; y++) {
        const rowStart = y * w;
        for (let x = 0; x < w - 1; x++) gradSum += Math.abs(gray[rowStart + x + 1] - gray[rowStart + x]);
      }
      const avgGradient = gradSum / (n - h);

      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const adjusted = Math.min(255, Math.max(0, ((gray[i] - lo) / range) * 255));
        data[p] = data[p + 1] = data[p + 2] = adjusted;
      }
      ctx.putImageData(imageData, 0, 0);
      resolve({
        dataUrl: canvas.toDataURL("image/jpeg", 0.92),
        quality: { dark: meanBrightness < 70, bright: meanBrightness > 195, blurry: avgGradient < 4.5 },
      });
    };
    img.onerror = () => resolve({ dataUrl: imageDataUrl, quality: { dark: false, bright: false, blurry: false } });
    img.src = imageDataUrl;
  });
}

async function extractText(imageDataUrl) {
  const worker = await getWorker();
  const { dataUrl: enhanced, quality } = await enhanceForOcr(imageDataUrl);
  const { data } = await worker.recognize(enhanced);
  return { text: data.text || "", quality };
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
  const { text, quality } = await extractText(imageDataUrl);
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
    quality,
  };
}
