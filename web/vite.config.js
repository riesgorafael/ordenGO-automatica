import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /* El service worker nombraba su caché con una constante fija, así que ningún despliegue la
       invalidaba: el activate sólo borra las cachés cuyo nombre difiere del actual, y el nombre
       nunca cambiaba. Un index.html guardado en una versión anterior podía seguir sirviéndose como
       respaldo sin conexión para siempre —incluida la página que app.miordengo.com servía antes—.
       Sellar el nombre con la fecha de compilación hace que cada despliegue estrene caché y borre
       la anterior. */
    {
      name: "sellar-version-del-service-worker",
      closeBundle() {
        const archivo = path.resolve(__dirname, "dist/sw.js");
        if (!fs.existsSync(archivo)) return;
        const version = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
        const original = fs.readFileSync(archivo, "utf8");
        const sellado = original.replace(/"ordengo-shell-v1"/, JSON.stringify("ordengo-shell-" + version));
        if (sellado === original) this.warn("No se pudo sellar la versión del service worker: no se encontró el nombre de la caché.");
        fs.writeFileSync(archivo, sellado);
      },
    },
  ],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ["recharts"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
