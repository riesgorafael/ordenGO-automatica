# OrdenGO Suite — Proyecto full-stack

Aplicación de **órdenes de campo + seguimiento de proyectos** para empresas de automatización.

- **Frontend:** React + Vite + Tailwind (se compila y lo sirve el backend).
- **Backend:** Node/Express + PostgreSQL, con login real (JWT + contraseñas cifradas).
- **IA:** proxy a Anthropic con tu clave del lado del servidor (nunca en el navegador).
- **Roles:** Administrador, Gerencia y Técnico de campo. Los montos **no** se envían a los técnicos (se filtran en el servidor).

---

## Estructura

```
ordengo/
├─ docker-compose.yml      # app + base de datos, todo junto
├─ Dockerfile              # compila el frontend y lo sirve desde el backend
├─ .env.example            # variables de entorno (copiar a .env)
├─ server/                 # backend Node/Express + API
│  ├─ index.js
│  └─ package.json
└─ web/                    # frontend React/Vite
   ├─ src/ (App.jsx, api.js, main.jsx, index.css)
   ├─ index.html
   ├─ vite.config.js
   └─ package.json
```

---

## Subir el proyecto a GitHub (primer commit)

Desde la carpeta `ordengo/`:

```bash
git init
git add .
git commit -m "OrdenGO Suite: versión inicial full-stack"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/ordengo.git
git push -u origin main
```

**Antes de hacer push, verifica que el archivo `.env` NO se suba** (está en `.gitignore`).
Solo debe subirse `.env.example`. Para comprobarlo:

```bash
git status            # .env no debe aparecer en la lista
git ls-files | grep .env   # solo debe mostrar .env.example
```

Si por error ya lo agregaste: `git rm --cached .env` y vuelve a commitear.
Los secretos reales (claves, contraseñas, API key) se cargan luego como variables de entorno en el servidor, nunca en el repositorio.

---

## Opción A — Probarlo en tu computadora (Docker)

Requiere Docker instalado.

```bash
cp .env.example .env      # y edita las claves
docker compose up --build
```

Abre **http://localhost:3000**.
Entra con el admin que pusiste en `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`).
Usuarios de demo: `ana@empresa.com`, `luis@empresa.com`, `maria@empresa.com` (contraseña = `DEMO_PASSWORD`).

Para desarrollo con recarga en caliente (dos terminales):

```bash
# terminal 1 (backend). Necesita una PostgreSQL corriendo y DATABASE_URL.
cd server && npm install && DATABASE_URL=postgres://... JWT_SECRET=dev npm start

# terminal 2 (frontend)
cd web && npm install && npm run dev
```

---

## Opción B — Desplegar en DonWeb con EasyPanel (recomendado)

Sube este proyecto a un repositorio de GitHub y luego, en tu Cloud Server con EasyPanel:

### 1. Crear la base de datos
- En EasyPanel: **+ Create Service → PostgreSQL**.
- Ponle un nombre (p. ej. `ordengo-db`) y una contraseña.
- Copia la **cadena de conexión interna** que te da EasyPanel (algo como `postgres://postgres:CLAVE@ordengo-db:5432/postgres`).

### 2. Crear la aplicación
- **+ Create Service → App**.
- Fuente: **GitHub** → elige tu repositorio.
- Método de build: **Dockerfile** (ya está incluido en la raíz).
- Puerto interno: **3000**.

### 3. Variables de entorno de la App
En la pestaña **Environment** de la app, agrega:

```
DATABASE_URL = (la cadena de conexión del paso 1)
JWT_SECRET = (una cadena larga y aleatoria)
ADMIN_EMAIL = tucorreo@empresa.com
ADMIN_PASSWORD = (tu clave de administrador)
DEMO_PASSWORD = (clave inicial para empleados)
ANTHROPIC_API_KEY = (tu clave de Anthropic, opcional)
ANTHROPIC_MODEL = claude-sonnet-5
PORT = 3000
```

### 4. Dominio y SSL
- En **Domains**, agrega tu dominio o usa el subdominio que da EasyPanel.
- Activa **SSL** (Let's Encrypt) con un clic.

### 5. Deploy
- Presiona **Deploy**. EasyPanel construye la imagen y levanta la app.
- La primera vez, el backend crea las tablas y el usuario administrador automáticamente.
- Entra a tu dominio e inicia sesión con `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

> Con cada `git push` a tu repo, EasyPanel puede redeployar automáticamente.

---

## Notas de seguridad (para producción real)

- **Cambia** `JWT_SECRET`, `ADMIN_PASSWORD` y `DEMO_PASSWORD` por valores propios y fuertes.
- Pídele a cada empleado que cambie su contraseña inicial: cada usuario puede hacerlo desde el botón de la **llave (🔑)** en el encabezado. El admin también puede reasignar contraseñas desde **Equipo**.
- La clave de Anthropic vive solo en el servidor; el navegador nunca la ve.
- Los montos (tarifas, precios, totales) se filtran en el backend para el rol Técnico: aunque alguien inspeccione la red, no los recibe.

## Qué se puede agregar después
- Recuperación de contraseña por correo (el cambio de contraseña por el propio usuario ya está incluido).
- Integración con facturación electrónica fiscal (el comprobante PDF por orden y el reporte mensual por cliente ya están incluidos).
- Comentarios/actividad por orden y por tarea; vínculo entre una orden de campo y una tarea de proyecto.
- Comentarios/actividad por orden y por tarea.
- Vínculo entre una orden de campo y una tarea de proyecto.
