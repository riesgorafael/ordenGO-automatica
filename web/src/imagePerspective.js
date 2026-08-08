// Recorte con corrección de perspectiva (mapeo de 4 esquinas arbitrarias a un rectángulo
// derecho), estilo apps de escaneo de documentos. Todo corre local con canvas — sin ninguna
// librería de visión por computadora ni servicio externo.

// Mapeo clásico "cuadrado unitario -> cuadrilátero" (Heckbert). corners = [TL, TR, BR, BL] en
// píxeles de la imagen fuente. Devuelve los coeficientes de la transformación proyectiva.
function computeSquareToQuad(corners) {
  const [p0, p1, p2, p3] = corners;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const denom = dx1 * dy2 - dx2 * dy1;
  const a13 = denom ? (dx3 * dy2 - dx2 * dy3) / denom : 0;
  const a23 = denom ? (dx1 * dy3 - dx3 * dy1) / denom : 0;
  return {
    a11: p1.x - p0.x + a13 * p1.x, a21: p3.x - p0.x + a23 * p3.x, a31: p0.x,
    a12: p1.y - p0.y + a13 * p1.y, a22: p3.y - p0.y + a23 * p3.y, a32: p0.y,
    a13, a23, a33: 1,
  };
}

const mapUnitToQuad = (m, u, v) => {
  const w = m.a13 * u + m.a23 * v + m.a33;
  return { x: (m.a11 * u + m.a21 * v + m.a31) / w, y: (m.a12 * u + m.a22 * v + m.a32) / w };
};

function sampleBilinear(data, srcW, srcH, x, y) {
  const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(y)));
  const x1 = Math.min(srcW - 1, x0 + 1), y1 = Math.min(srcH - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, x - x0)), fy = Math.min(1, Math.max(0, y - y0));
  const idx = (xx, yy) => (yy * srcW + xx) * 4;
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const v00 = data[idx(x0, y0) + c], v10 = data[idx(x1, y0) + c], v01 = data[idx(x0, y1) + c], v11 = data[idx(x1, y1) + c];
    out[c] = v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
  }
  return out;
}

// corners: 4 puntos {x,y} en píxeles de la imagen fuente, orden TL, TR, BR, BL.
export function warpPerspective(img, corners, outW, outH) {
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = img.naturalWidth; srcCanvas.height = img.naturalHeight;
  const srcCtx = srcCanvas.getContext("2d");
  srcCtx.drawImage(img, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height).data;

  const m = computeSquareToQuad(corners);
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW; outCanvas.height = outH;
  const outCtx = outCanvas.getContext("2d");
  const outImageData = outCtx.createImageData(outW, outH);
  const outData = outImageData.data;

  for (let py = 0; py < outH; py++) {
    const v = (py + 0.5) / outH;
    for (let px = 0; px < outW; px++) {
      const u = (px + 0.5) / outW;
      const { x, y } = mapUnitToQuad(m, u, v);
      const [r, g, b, a] = sampleBilinear(srcData, srcCanvas.width, srcCanvas.height, x, y);
      const outIdx = (py * outW + px) * 4;
      outData[outIdx] = r; outData[outIdx + 1] = g; outData[outIdx + 2] = b; outData[outIdx + 3] = a;
    }
  }
  outCtx.putImageData(outImageData, 0, 0);
  return outCanvas;
}

// Autodetección best-effort del contorno de una hoja/factura: asume que el documento es más
// claro que la superficie donde está apoyado (caso típico: papel blanco/claro sobre un
// escritorio, mesa o mano más oscuros). No es visión por computadora real (no hay detección de
// contornos ni líneas, solo un umbral de brillo), así que con fondos claros o muy parejos puede
// fallar — en ese caso devuelve un recorte por defecto con margen chico, y la persona ajusta las
// 4 esquinas a mano. El objetivo es que en el caso común (la mayoría de las fotos de facturas)
// las esquinas ya arranquen bien puestas y la persona solo tenga que confirmar.
export function autoDetectCorners(imageUrl) {
  return new Promise((resolve) => {
    const fallback = () => resolve([{ x: 0.04, y: 0.04 }, { x: 0.96, y: 0.04 }, { x: 0.96, y: 0.96 }, { x: 0.04, y: 0.96 }]);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = 240 / Math.max(img.naturalWidth, img.naturalHeight);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        const gray = new Float32Array(w * h);
        let sum = 0;
        for (let i = 0; i < w * h; i++) {
          const value = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
          gray[i] = value; sum += value;
        }
        const mean = sum / (w * h);
        const rowCount = new Array(h).fill(0);
        const colCount = new Array(w).fill(0);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (gray[y * w + x] > mean * 1.05) { rowCount[y]++; colCount[x]++; }
          }
        }
        const rowThreshold = w * 0.35, colThreshold = h * 0.35;
        let top = -1, bottom = -1, left = -1, right = -1;
        for (let y = 0; y < h; y++) if (rowCount[y] > rowThreshold) { if (top === -1) top = y; bottom = y; }
        for (let x = 0; x < w; x++) if (colCount[x] > colThreshold) { if (left === -1) left = x; right = x; }
        if (top === -1 || left === -1 || bottom - top < h * 0.15 || right - left < w * 0.15) return fallback();
        const area = ((right - left) * (bottom - top)) / (w * h);
        if (area > 0.98 || area < 0.08) return fallback();
        const pad = 0.015;
        const x0 = Math.max(0, left / w - pad), x1 = Math.min(1, right / w + pad);
        const y0 = Math.max(0, top / h - pad), y1 = Math.min(1, bottom / h + pad);
        resolve([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
      } catch { fallback(); }
    };
    img.onerror = fallback;
    img.src = imageUrl;
  });
}
