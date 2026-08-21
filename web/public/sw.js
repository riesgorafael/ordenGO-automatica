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

// ---------------------------------------------------------------------------------------------
// Notificaciones push. El navegador despierta al service worker aunque la aplicación esté cerrada;
// por eso el aviso se muestra desde acá y no desde la página.
self.addEventListener("push", (event) => {
  // El servidor manda JSON, pero si algo llegara como texto plano se muestra igual en lugar de
  // descartar la notificación en silencio.
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { body: event.data ? event.data.text() : "" }; }
  const title = payload.title || "MiOrdenGo";
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || "",
    icon: "/branding/ordengo-mark-192.png",
    badge: "/branding/ordengo-mark-192.png",
    // tag agrupa: varios avisos de la misma tarea reemplazan al anterior en lugar de apilarse.
    tag: payload.tag || undefined,
    data: { url: payload.url || "/" },
  }));
});

// Al tocar la notificación se reutiliza la pestaña abierta si la hay, en lugar de abrir una nueva
// cada vez y dejar al usuario con cinco copias de la aplicación.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if (client.url.includes(self.location.origin)) return client.focus().then(() => client.navigate(target));
    }
    return self.clients.openWindow(target);
  }));
});
