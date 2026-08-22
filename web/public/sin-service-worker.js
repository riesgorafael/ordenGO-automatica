/* La web comercial no usa service worker. Este script quita cualquiera que haya quedado registrado
   en el dominio de cuando aquí se servía la aplicación: ese worker seguía controlando el sitio y
   devolvía el armazón cacheado de la aplicación, que sin su JavaScript se ve como una página en
   blanco.

   Va en un archivo aparte y no como script incrustado porque la política de seguridad del sitio
   sólo admite scripts propios, sin código dentro del HTML. */
(function () {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistrations().then(function (registros) {
    if (!registros.length) return;
    Promise.all(registros.map(function (r) { return r.unregister(); }))
      .then(function () {
        if (!window.caches) return null;
        return caches.keys().then(function (nombres) {
          return Promise.all(nombres.map(function (n) { return caches.delete(n); }));
        });
      })
      .then(function () {
        // Una sola recarga, y sólo si había algo que quitar: sin la marca, la página entraría en un
        // ciclo de recargas cada vez que se abre.
        if (sessionStorage.getItem("og_sw_limpiado")) return;
        sessionStorage.setItem("og_sw_limpiado", "1");
        location.reload();
      })
      .catch(function () { /* si falla, la página se ve igual: el servidor devuelve el HTML correcto */ });
  }).catch(function () {});
})();
