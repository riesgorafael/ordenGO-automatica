/* Animación de entrada de las maquetas de la sección "Así se ve".

   Tres decisiones de diseño detrás de esto:

   1. Mejora progresiva. El JavaScript marca la sección como animable ANTES de observar nada; el CSS
      sólo oculta lo que está dentro de esa marca. Si este archivo no carga —red lenta, bloqueador,
      un error— las maquetas se ven igual, quietas. Nunca al revés: una animación que falla no puede
      dejar la página en blanco.

   2. Se anima al entrar en pantalla, no al cargar. Quien llega abajo del todo por un enlace directo
      vería lo de arriba animarse sin mirarlo. Con IntersectionObserver cada pieza se revela cuando
      la persona llega, que es cuando la animación significa algo.

   3. Una sola vez por elemento. Que las cosas se re-animen al subir y bajar marea y da sensación de
      inestabilidad; se deja de observar en cuanto apareció.

   El respeto por prefers-reduced-motion está en el CSS, que es donde el navegador puede aplicarlo
   incluso si este archivo nunca corre. */
(function () {
  var seccion = document.getElementById("capturas");
  if (!seccion) return;

  // Sin soporte del observador, se muestra todo sin animar en lugar de dejarlo oculto.
  if (!("IntersectionObserver" in window)) return;

  seccion.classList.add("anima");
  var piezas = seccion.querySelectorAll(".shot");

  function revelar(pieza) {
    pieza.classList.add("visible");
  }

  var observador = new IntersectionObserver(function (entradas) {
    entradas.forEach(function (entrada) {
      if (!entrada.isIntersecting) return;
      revelar(entrada.target);
      observador.unobserve(entrada.target);
    });
  }, {
    // Umbral en cero y sin margen negativo: con valores más exigentes, una maqueta alta dentro de un
    // contenedor con su propio desplazamiento podía no alcanzar nunca la proporción pedida y quedaba
    // invisible para siempre. Es preferible revelar un instante antes que no revelar.
    threshold: 0,
  });

  for (var i = 0; i < piezas.length; i++) {
    // El escalonado se calcula por posición en la fila, no por índice absoluto: con un índice
    // corrido, la última tarjeta de una lista larga tardaría más de un segundo en aparecer.
    piezas[i].style.setProperty("--retraso", (i % 3) * 90 + "ms");
    observador.observe(piezas[i]);
  }

  /* Red de seguridad. Nada de esto vale un texto que no se lee: si a los tres segundos alguna pieza
     sigue oculta —porque el observador no disparó, porque la página vive dentro de un contenedor
     raro, o por lo que sea— se muestran todas sin animación. Una entrada que no ocurre es un
     detalle; contenido invisible es un error. */
  setTimeout(function () {
    for (var j = 0; j < piezas.length; j++) {
      if (!piezas[j].classList.contains("visible")) revelar(piezas[j]);
    }
  }, 3000);
})();
