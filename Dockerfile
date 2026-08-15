# ---------- Etapa 1: build del frontend ----------
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate && pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# ---------- Etapa 2: backend + frontend compilado ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate && pnpm install --prod --frozen-lockfile
COPY server/ ./
# el frontend compilado se sirve como estático desde /app/public
COPY --from=web /web/dist ./public
EXPOSE 3000
CMD ["node", "index.js"]
