# syntax=docker/dockerfile:1.7
#
# FundLens web image, built from the repository root.
#
# Uses Next.js `output: 'standalone'`, which traces the exact module graph the
# server needs — the runtime layer ships a few megabytes instead of the whole
# node_modules tree.

FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci --ignore-scripts --workspace=@fundlens/web --workspace=@fundlens/shared --include-workspace-root

FROM node:22-alpine AS build
WORKDIR /app

# NEXT_PUBLIC_* values are inlined at build time, not read at runtime, so the
# API URL has to be supplied here. Deploying to a new environment therefore
# means a new build — see docs/DEPLOYMENT.md#build-time-configuration.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
ARG NEXT_PUBLIC_PRICE_REFRESH_SECONDS=60
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_PRICE_REFRESH_SECONDS=$NEXT_PUBLIC_PRICE_REFRESH_SECONDS
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN npm run build --workspace=@fundlens/shared \
 && npm run build --workspace=@fundlens/web

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache dumb-init curl \
 && addgroup -S fundlens && adduser -S fundlens -G fundlens

COPY --from=build --chown=fundlens:fundlens /app/apps/web/.next/standalone ./
COPY --from=build --chown=fundlens:fundlens /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=fundlens:fundlens /app/apps/web/public ./apps/web/public

USER fundlens

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/ || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/web/server.js"]
