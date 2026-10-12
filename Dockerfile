# One image serves both the API and the web admin UI (same origin, so the
# browser needs no CORS setup and there's only one container to run).

# 1. Build the web admin UI into static files
FROM node:24-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Screenshot-scanner pixel code shared with the backend; the frontend
# imports it as ../shared (i.e. /shared from /web).
COPY shared /shared
RUN npm run build

# 2. Backend runtime
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/src ./src
# Same scanner code, for the phone's screen scans (src/routes/scan.js).
COPY shared ./shared
# The backend creates the tables from this itself if the database is empty
# (see src/migrate.js), so the Postgres container doesn't need it mounted.
COPY db/init.sql ./db/init.sql
COPY --from=web /web/dist ./public

RUN mkdir -p /app/uploads

EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4001/health || exit 1

CMD ["node", "src/index.js"]
