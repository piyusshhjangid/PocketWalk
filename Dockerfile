# PocketWalk: one Node service that also serves the built frontend (same origin).
#   docker build -t pocketwalk .
#   docker run --rm -p 3000:3000 -e TRUST_PROXY=0 -e GEMMA_PROVIDER=none pocketwalk
# Secrets (GEMINI_API_KEY, SENTRY_DSN) are passed at run time as environment variables, never baked into the image.

# ---- build: full dev dependencies, compile backend, build frontend, then drop dev dependencies ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci && npm --prefix frontend ci
COPY . .
RUN npm run build:all && npm prune --omit=dev

# ---- runtime: production dependencies + compiled output only, non-root ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/frontend/dist ./frontend/dist
USER node
EXPOSE 3000
# Liveness only (never calls a provider). Uses Node itself, so no curl/wget is needed in the image.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# `node` runs as PID 1 and handles SIGTERM itself (graceful drain), so there is no npm/shell wrapper in between.
CMD ["node", "dist/server.js"]
