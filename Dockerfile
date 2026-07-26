# ---------- Etapa 1: build del frontend ----------
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---------- Etapa 2: backend + frontend compilado ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/ ./
# el frontend compilado se sirve como estático desde /app/public
COPY --from=web /web/dist ./public
EXPOSE 3000
CMD ["node", "index.js"]
