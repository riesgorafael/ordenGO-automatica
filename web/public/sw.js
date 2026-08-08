const CACHE = "ordengo-shell-v1";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).pathname.startsWith("/api/")) return;
  event.respondWith(fetch(request).then((response) => {
    // clone() tiene que llamarse ANTES de devolver la respuesta: "return response" entrega el
    // body a quien pidió el fetch (ej. el worker de Tesseract/pdf.js leyendo un .wasm), y si esa
    // lectura termina antes que "caches.open(...).then(...)" (muy probable, es una promesa
    // encadenada aparte, no esperada), el clone llegaba tarde con el body ya consumido —
    // "Response body is already used". Clonando ya mismo, sincrónico, se evita la carrera.
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  }).catch(() => caches.match(request).then((cached) => cached || caches.match("/"))));
});
