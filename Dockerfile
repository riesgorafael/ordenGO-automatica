# ---------- Etapa 1: build del frontend ----------
FROM node:20-alpine AS web
WORKDIR /web
COPY shared /shared
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
# El frontend instala SIN --frozen-lockfile a propósito: no hay Node instalado en la máquina de
# desarrollo, así que el lockfile no se puede regenerar al agregar una dependencia y un install
# congelado fallaría. El costo es real y conviene tenerlo presente: dos builds del mismo commit
# pueden resolver versiones distintas de dependencias transitivas. En cuanto haya Node local,
# corré `pnpm install` en web/, commiteá el lockfile y devolvé --frozen-lockfile a esta línea.
# El backend (etapa 2) sí lo conserva: su lockfile está al día.
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate && pnpm install --no-frozen-lockfile
COPY web/ ./
RUN pnpm build

# ---------- Etapa 2: backend + frontend compilado ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate && pnpm install --prod --frozen-lockfile
COPY server/ ./
COPY shared /shared
# el frontend compilado se sirve como estático desde /app/public
COPY --from=web /web/dist ./public
EXPOSE 3000
CMD ["node", "index.js"]
