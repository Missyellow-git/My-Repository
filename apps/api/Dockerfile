# syntax=docker/dockerfile:1.7
#
# FundLens API image.
#
# Multi-stage so the runtime layer carries no compiler, no dev dependencies and
# no source. The build context is the repository root (not apps/api) because
# the API depends on the @fundlens/shared workspace package.

# ---------------------------------------------------------------------------
# Stage 1 — install workspace dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Only the manifests, so a source-only change reuses this layer's npm install.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# `--ignore-scripts` keeps a compromised transitive package from executing
# during install; Prisma's client is generated explicitly in the next stage.
RUN npm ci --ignore-scripts --workspace=@fundlens/api --workspace=@fundlens/shared --include-workspace-root

# ---------------------------------------------------------------------------
# Stage 2 — build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN npm run build --workspace=@fundlens/shared \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build --workspace=@fundlens/api

# Drop dev dependencies before they are copied into the runtime stage.
RUN npm prune --omit=dev --workspace=@fundlens/api --workspace=@fundlens/shared --include-workspace-root

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Keeps V8's heap under the container limit so the OOM killer is not the thing
# that discovers the ceiling.
ENV NODE_OPTIONS=--max-old-space-size=768

# dumb-init gives us correct PID 1 signal handling, so SIGTERM reaches Node and
# Nest's shutdown hooks actually run (draining Prisma and BullMQ connections).
RUN apk add --no-cache dumb-init curl \
 && addgroup -S fundlens && adduser -S fundlens -G fundlens

COPY --from=build --chown=fundlens:fundlens /app/node_modules ./node_modules
COPY --from=build --chown=fundlens:fundlens /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=fundlens:fundlens /app/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=fundlens:fundlens /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=fundlens:fundlens /app/apps/api/package.json ./apps/api/
# Migrations and the seed ship with the image so `migrate deploy` can run as a
# release step from this exact artefact.
COPY --from=build --chown=fundlens:fundlens /app/apps/api/prisma ./apps/api/prisma

USER fundlens
WORKDIR /app/apps/api

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
