# System Architecture — AI Carousel Generator SaaS

**Document version:** 1.0
**Date:** 2026-08-02
**Owner:** Engineering (Architecture)
**Status:** Proposed — for engineering review
**Companion document:** [PRD — AI Carousel Generator](./PRD-AI-Carousel-Generator.md)

---

## Table of Contents

1. [Architectural Drivers](#1-architectural-drivers)
2. [System Context](#2-system-context)
3. [Container View & Repository Layout](#3-container-view--repository-layout)
4. [Frontend Architecture](#4-frontend-architecture)
5. [Backend Architecture (NestJS)](#5-backend-architecture-nestjs)
6. [API Layer](#6-api-layer)
7. [Database Layer (PostgreSQL)](#7-database-layer-postgresql)
8. [AI Layer](#8-ai-layer)
9. [Rendering Pipeline](#9-rendering-pipeline)
10. [Background Jobs (Redis + BullMQ)](#10-background-jobs-redis--bullmq)
11. [Caching Strategy](#11-caching-strategy)
12. [Storage Layer (AWS S3)](#12-storage-layer-aws-s3)
13. [Security Architecture](#13-security-architecture)
14. [Scalability](#14-scalability)
15. [Observability](#15-observability)
16. [Deployment & Environments](#16-deployment--environments)
17. [Cost Optimization](#17-cost-optimization)
18. [Architecture Decision Records](#18-architecture-decision-records)
19. [Failure Modes & Degradation](#19-failure-modes--degradation)
20. [Appendices](#20-appendices)

---

## 1. Architectural Drivers

Architecture is the set of decisions that are expensive to reverse. These seven constraints drive every decision in this document; everything else is an implementation detail that can change later.

| # | Driver | Requirement | Architectural consequence |
|---|---|---|---|
| D1 | **Long-running, expensive, failure-prone work** | Generation 20–60s, export 5–30s, both dependent on third-party APIs | No synchronous request/response for core work. Everything is a durable job with idempotency, retries, and streamed progress. |
| D2 | **Preview must equal export, pixel for pixel** | A carousel that looks different after download destroys trust irrecoverably | One template definition, two render targets. Shared package consumed by both browser and headless Chromium. Never two implementations. |
| D3 | **Multi-tenant with hard isolation** | Agencies hold competitor brands in adjacent workspaces | Tenancy enforced at the database layer (RLS), not only in application code. Defense in depth. |
| D4 | **Variable, vendor-controlled unit cost** | Model pricing and availability change without notice | Provider-agnostic AI gateway with routing, failover, and per-call cost accounting from day one. No SDK calls in business logic. |
| D5 | **Spiky, bimodal load** | Idle nights, then an agency batches 200 carousels at 09:00 | Queue-based load levelling, separate worker pools with independent autoscaling, per-tenant fairness controls. |
| D6 | **Money must be exactly right** | Credits are the product's currency; double-charging or free generation both kill the business | Append-only ledger, atomic reserve→commit/refund, idempotent webhooks, no derived balance mutated in place. |
| D7 | **Small team, high delivery velocity** | 2–4 engineers must own all of this | Managed services over self-hosted, monorepo with shared types, boring proven technology, one language end to end. |

**Explicit non-goals for v1:** microservice decomposition beyond the three deployables below, multi-region active-active, event sourcing, Kubernetes, real-time collaborative editing (CRDT).

---

## 2. System Context

```
                            ┌─────────────────────────────┐
                            │        End Users            │
                            │ Creators · SMMs · Teams     │
                            └──────────────┬──────────────┘
                                           │ HTTPS
                            ┌──────────────▼──────────────┐
                            │   AI Carousel Generator     │
                            │        (this system)        │
                            └──┬────┬────┬────┬────┬───┬──┘
        ┌──────────────────────┘    │    │    │    │   └──────────────────┐
        │              ┌────────────┘    │    │    └──────┐               │
┌───────▼──────┐ ┌─────▼──────┐ ┌────────▼───┐ ┌──▼────────────┐ ┌────────▼───────┐
│ Clerk        │ │ LLM        │ │ Image gen  │ │ Stripe        │ │ Social APIs    │
│ (identity,   │ │ providers  │ │ OpenAI     │ │ (billing,     │ │ LinkedIn · IG  │
│  orgs, JWKS) │ │ OpenAI ·   │ │ Images ·   │ │  webhooks)    │ │ Facebook · X   │
│              │ │ Claude ·   │ │ FLUX       │ │               │ │ (Phase 2)      │
│              │ │ Gemini     │ │            │ │               │ │                │
└──────────────┘ └────────────┘ └────────────┘ └───────────────┘ └────────────────┘
        │                                              │
┌───────▼──────┐                              ┌────────▼───────┐
│ AWS          │                              │ Observability  │
│ S3 · CF ·    │                              │ Sentry ·       │
│ KMS · SES    │                              │ OTel · PostHog │
└──────────────┘                              └────────────────┘
```

**Trust boundaries.** Three matter, and each gets explicit treatment later:
1. **Browser ↔ API** — untrusted client; every authorization decision is server-side (§13.2).
2. **System ↔ LLM providers** — user content leaves our boundary; zero-retention contracts, no secrets in prompts (§13.7).
3. **System ↔ user-supplied URLs/files** — imported content is *data, never instructions*; SSRF and prompt-injection defense (§13.6, §13.7).

---

## 3. Container View & Repository Layout

### 3.1 Deployable units

Three deployables. This is the smallest number that still separates the three genuinely different runtime profiles: edge-latency web, request-serving API, and heavy batch compute.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. WEB (Next.js 15, App Router, TypeScript, TailwindCSS)                     │
│    Vercel · Edge middleware · RSC · SSG marketing pages                      │
│    Also serves the internal /render route consumed by the render worker      │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ REST + SSE (Clerk JWT bearer)
┌───────────────────────────────▼─────────────────────────────────────────────┐
│ 2. API (NestJS, Node 22, Fastify adapter)                                    │
│    AWS ECS Fargate (ARM64) · 2–20 tasks · stateless · behind ALB             │
│    Modules: auth · workspace · project · generation · export · billing ·     │
│             ai-gateway · storage · publish · admin · webhooks                │
│    Responsibilities: authz, validation, quota, persistence, job enqueue      │
│    Never: model calls in the request path, rendering, long-running work      │
└──────┬──────────────────┬───────────────────────┬───────────────────────────┘
       │                  │                       │
┌──────▼───────┐ ┌────────▼─────────┐  ┌──────────▼──────────────────────────┐
│ PostgreSQL   │ │ Redis (ElastiCache)│ │ 3. WORKERS (NestJS standalone app) │
│ RDS Multi-AZ │ │ · BullMQ queues    │ │    ECS Fargate, 2 pools:           │
│ + replica    │ │ · cache            │ │    a) ai-worker   (IO-bound)       │
│ PgBouncer    │ │ · rate limits      │ │    b) render-worker (CPU/RAM-bound,│
│ RLS enforced │ │ · idempotency keys │ │       Playwright + Chromium)       │
└──────────────┘ └────────────────────┘ │    KEDA-style queue-depth scaling  │
                                        └────────────┬───────────────────────┘
                                                     │
                                        ┌────────────▼───────────────────────┐
                                        │ S3 (private) + CloudFront (OAC)    │
                                        │ uploads · renders · exports        │
                                        └────────────────────────────────────┘
```

**Why the API and workers share one NestJS codebase but deploy separately.** They share the same modules, entities, and providers — a worker is `NestFactory.createApplicationContext()` instead of `NestFactory.create()`. One codebase means no duplicated domain logic or drifting types; separate deployment means a batch of 200 renders cannot starve the API of CPU, and each scales on its own signal.

**Why the render target lives in the Next.js app.** The render worker needs to execute the exact React template components the user saw in the editor (D2). Rather than duplicating a React runtime inside the worker, the worker drives headless Chromium against an internal Next.js route (`/render/:jobId`). The templates package is imported by exactly one renderer. Full flow in §9.

### 3.2 Monorepo layout

```
carousel-platform/
├─ apps/
│  ├─ web/                     # Next.js — marketing, app shell, editor, /render route
│  ├─ api/                     # NestJS HTTP application
│  └─ workers/                 # NestJS standalone — BullMQ consumers (ai + render)
├─ packages/
│  ├─ templates/               # ★ React slide templates + layout/auto-fit engine
│  │                           #   consumed by web (preview), web /render (export)
│  ├─ contracts/               # Zod schemas + inferred TS types (API + AI I/O)
│  ├─ db/                      # Drizzle schema, migrations, RLS policies, seeds
│  ├─ ai-core/                 # Provider adapters, router, prompt registry, evals
│  ├─ platform-specs/          # ★ Versioned per-platform dimension/limit config
│  ├─ ui/                      # shadcn/ui-based shared component library
│  └─ observability/           # OTel setup, logger, trace propagation helpers
├─ infra/
│  ├─ terraform/               # VPC, RDS, ElastiCache, ECS, S3, CloudFront, KMS
│  └─ docker/                  # Dockerfiles (api, workers, render base w/ Chromium)
└─ turbo.json, pnpm-workspace.yaml
```

pnpm workspaces + Turborepo. Type safety runs end to end: a change to a Zod contract in `packages/contracts` breaks the build in `apps/web`, `apps/api`, and `apps/workers` simultaneously — which is exactly what you want.

---

## 4. Frontend Architecture

### 4.1 Rendering strategy per surface

Next.js gives four rendering modes. Using the wrong one is the most common Next.js architecture mistake, so the mapping is explicit:

| Surface | Mode | Rationale |
|---|---|---|
| Marketing, pricing, blog, template gallery | **SSG + ISR** (revalidate 3600) | SEO is a primary acquisition channel; content changes rarely |
| Public share/review link `/s/:token` | **SSR, cached at CDN** (`s-maxage=60`) | Must reflect current state; high read fan-out from a single client link |
| App shell, library, settings | **RSC + streaming** | Authenticated, personalized; fetch on the server, ship less JS |
| Editor `/editor/:projectId` | **Client component island** | Highly interactive, local optimistic state; RSC has nothing to offer here |
| `/render/:jobId` (internal) | **Client, no-store, deterministic** | Consumed only by the render worker; never indexed, never cached |

### 4.2 Component and state architecture

```
apps/web/src/
├─ app/
│  ├─ (marketing)/             # SSG segment
│  ├─ (app)/
│  │  ├─ layout.tsx            # Clerk provider, workspace context, nav
│  │  ├─ dashboard/page.tsx    # RSC — library grid
│  │  ├─ generate/page.tsx     # Prompt surface + SSE stream consumer
│  │  └─ editor/[id]/page.tsx  # RSC shell → hydrates <EditorClient>
│  ├─ render/[jobId]/page.tsx  # ★ deterministic export surface
│  └─ api/                     # BFF only: SSE proxy, Clerk webhook relay
├─ components/
│  ├─ editor/                  # SlideStrip, SlideCanvas, Inspector, Toolbar
│  ├─ generate/                # PromptComposer, StreamingOutline, ProgressRail
│  └─ ui/                      # re-exports from packages/ui
├─ hooks/                      # useGenerationStream, useAutosave, useCredits
└─ lib/                        # api client (typed), analytics, flags
```

**State management — three tiers, deliberately separated:**

| Tier | Technology | Owns |
|---|---|---|
| Server state | TanStack Query | Projects, library, brand kits, credit balance. Cache keys namespaced by `workspaceId` so switching workspaces cannot serve stale cross-tenant data. |
| Editor document state | Zustand + Immer | The in-flight slide document, selection, undo/redo stack (50 steps, patch-based). Local-first; the editor must feel instant. |
| Ephemeral UI state | React `useState` | Modals, popovers, hover. Never lifted into a store. |

**Autosave.** Debounced 1.5s, `PATCH /projects/:id` with `If-Match: <version>`. On `409 Conflict` the client refetches, replays local patches, and surfaces a non-blocking "synced" indicator. Optimistic concurrency, not locking — a single-user editor with multi-tab risk, not a collaboration problem.

### 4.3 The live preview ↔ export guarantee

The editor renders `<SlideRenderer spec={slide} template={t} theme={th} ratio={r} />` from `packages/templates`. The `/render` route renders **the same component with the same props**. The only differences are environment-level and controlled:

| Concern | Editor | `/render` |
|---|---|---|
| Scale | CSS `transform: scale()` to fit viewport | Fixed 1:1 at target pixel dimensions, `deviceScaleFactor: 2` |
| Fonts | Preloaded, `document.fonts.ready` awaited | Same fonts, self-hosted, plus explicit readiness gate |
| Images | May stream in | All decoded before `__RENDER_READY__` is set |
| Animation | Transitions enabled | `prefers-reduced-motion` forced; all transitions disabled |

Any visual difference between these two is a **P0 defect class**, not a cosmetic bug. Visual regression tests in CI diff editor-captured and worker-captured output for every template × ratio × theme combination.

### 4.4 Streaming generation UX

Generation is 20–60s. A spinner for 60s reads as a hang. The client consumes SSE and reveals progressively:

```
POST /v1/generations              → 202 { generationId, streamUrl }
GET  /v1/generations/:id/stream   → SSE
  event: status   { phase: "planning" }
  event: outline  { angle, slides: [{ role, headline }] }      ~4s   ← first paint
  event: slide    { index: 0, content: {...} }                 ~9s
  event: slide    { index: 1, content: {...} }                 ...
  event: rendered { index: 0, previewUrl }                     ~14s
  event: done     { projectId, creditsCharged }
  event: error    { code, message, retryable, creditsCharged: 0 }
```

The client reconnects with `Last-Event-ID` on drop. If the tab closes, the job completes server-side and appears in the library — the SSE stream is a *view* of the job, never its driver (D1).

### 4.5 Performance budget

| Metric | Budget | How it is held |
|---|---|---|
| LCP (marketing) | ≤1.5s | SSG + CDN, no client JS above the fold |
| LCP (app shell) | ≤2.0s on 4G | RSC, route-level code splitting |
| Editor JS bundle | ≤250KB gzipped | Templates lazy-loaded per family; heavy deps (crop, color picker) dynamically imported |
| Keystroke → repaint | ≤100ms | Local state only; no network in the edit path |
| CLS | <0.05 | Fixed aspect-ratio boxes for every slide surface |

Enforced by `@next/bundle-analyzer` size checks and Lighthouse CI as blocking gates.

---

## 5. Backend Architecture (NestJS)

### 5.1 Module structure

NestJS modules map to bounded contexts. Cross-module access goes through exported services, never through another module's repository — this is what keeps a modular monolith from decaying into a mud ball.

```
apps/api/src/
├─ main.ts                      # Fastify adapter, helmet, CORS, OTel bootstrap
├─ app.module.ts
├─ common/
│  ├─ guards/                   # ClerkAuthGuard, WorkspaceGuard, RolesGuard, PlanGuard
│  ├─ interceptors/             # Tracing, Logging, Serialization, Idempotency
│  ├─ filters/                  # GlobalExceptionFilter → RFC 7807 problem+json
│  ├─ pipes/                    # ZodValidationPipe (contracts package)
│  └─ decorators/               # @CurrentUser() @CurrentWorkspace() @RequirePlan()
├─ modules/
│  ├─ auth/                     # Clerk JWKS verification, session → principal
│  ├─ workspace/                # Workspaces, members, roles, brand kits
│  ├─ project/                  # Carousels, slides, versions, library
│  ├─ generation/               # Orchestration entry, SSE hub, generation records
│  ├─ ai-gateway/               # ★ Provider routing, prompts, schema validation
│  ├─ render/                   # Export job creation, artifact resolution
│  ├─ storage/                  # S3 presign, upload validation, lifecycle
│  ├─ billing/                  # Stripe, plans, credit ledger, entitlements
│  ├─ publish/                  # Phase 2: social accounts, scheduling
│  ├─ webhooks/                 # Clerk, Stripe, provider callbacks (signature-verified)
│  ├─ admin/                    # Support tooling, impersonation (audited)
│  └─ health/                   # /healthz /readyz /metrics
└─ queues/                      # BullMQ Queue producers (shared with workers app)
```

### 5.2 Layering rules

```
Controller  → validates transport, never contains business logic
   ↓
Guard/Interceptor → authn, authz, quota, idempotency, tracing
   ↓
Service     → business logic, transactions, domain invariants
   ↓
Repository  → Drizzle queries, always workspace-scoped
   ↓
PostgreSQL  → RLS as the final backstop
```

Two rules with no exceptions:
1. **A service never calls an external API directly.** All outbound calls go through a dedicated provider (`AiGatewayService`, `StripeService`, `S3Service`) so retries, timeouts, circuit breaking, and cost logging exist in exactly one place per integration.
2. **A controller never starts work that exceeds 2s.** It enqueues and returns `202`.

### 5.3 Request pipeline

```
Request
  → Fastify (body limit 10MB, request-id)
  → TracingInterceptor        (OTel span, traceId into async context)
  → ClerkAuthGuard            (verify JWT via cached JWKS → principal)
  → WorkspaceGuard            (resolve workspace, assert membership, load role+plan)
  → RolesGuard / PlanGuard    (@Roles('admin') / @RequirePlan('pro'))
  → RateLimitGuard            (Redis sliding window: ip / user / workspace)
  → IdempotencyInterceptor    (mutations: replay cached response for repeated key)
  → ZodValidationPipe         (contracts package — same schema the client uses)
  → Controller → Service      (tx with SET LOCAL app.workspace_id for RLS)
  → SerializationInterceptor  (strip internals, never leak other tenants' ids)
  → Response
```

### 5.4 Transaction and consistency model

Single Postgres instance, so transactions do the heavy lifting. The one genuinely hard case is **credit accounting spanning a database write and an asynchronous job** (D6). Solved with reserve → commit/refund plus the transactional outbox:

```ts
// generation.service.ts — simplified
async startGeneration(ws: Workspace, dto: GenerateDto): Promise<GenerationHandle> {
  return this.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.workspace_id = ${ws.id}`);

    // 1. Atomic reservation. Row lock serialises concurrent spends per workspace.
    const balance = await tx
      .select({ v: sql<number>`coalesce(sum(delta), 0)` })
      .from(creditLedger)
      .where(eq(creditLedger.workspaceId, ws.id))
      .for('update');                                  // serialise on the ledger rows

    const cost = estimateCredits(dto);
    if (balance.v < cost) throw new InsufficientCreditsException(cost, balance.v);

    const [reservation] = await tx.insert(creditLedger).values({
      workspaceId: ws.id, delta: -cost, reason: 'generation_reserved',
      refId: dto.idempotencyKey, status: 'reserved',
    }).returning();

    // 2. Domain rows
    const [project]    = await tx.insert(projects).values({ ... }).returning();
    const [generation] = await tx.insert(generations).values({
      projectId: project.id, reservationId: reservation.id, status: 'queued',
      promptVersion: this.prompts.currentVersion,
    }).returning();

    // 3. Transactional outbox — NOT a direct queue.add()
    await tx.insert(outbox).values({
      topic: 'generation.requested',
      payload: { generationId: generation.id, workspaceId: ws.id, input: dto },
      dedupeKey: `gen:${generation.id}`,
    });

    return { generationId: generation.id, projectId: project.id };
  });
}
```

**Why the outbox.** `queue.add()` inside a transaction is a distributed-write bug waiting to happen: the transaction can roll back after the job is enqueued (worker processes a generation for a project that does not exist), or the process can die after commit but before enqueue (user charged, nothing happens). The outbox makes the enqueue part of the same atomic commit; a relay polls `outbox` every 500ms (with `FOR UPDATE SKIP LOCKED`) and pushes to BullMQ with `jobId = dedupeKey`, which BullMQ deduplicates. At-least-once delivery, exactly-once effect.

On worker completion the reservation is settled: `status='committed'` on success, or a compensating `+cost` entry with `reason='generation_refunded'` on failure. **Failed generations are never charged** (PRD §11.1), and because the ledger is append-only, every dispute is reconstructable.

---

## 6. API Layer

### 6.1 Design conventions

| Concern | Decision |
|---|---|
| Style | REST, resource-oriented, JSON. Not GraphQL — the client's access patterns are known and narrow; GraphQL's cost (N+1 risk, query allowlisting, caching complexity) buys nothing here. |
| Versioning | URI prefix `/v1/`. Additive changes only within a version; breaking changes mint `/v2` with a 6-month overlap. |
| Auth | `Authorization: Bearer <clerk_session_jwt>`; workspace via `X-Workspace-Id` header, validated against membership on every request. |
| Errors | RFC 7807 `application/problem+json` with a stable machine-readable `code`. |
| Idempotency | `Idempotency-Key` required on all `POST` that spend credits or money; response cached in Redis for 24h. |
| Pagination | Cursor-based (opaque, encodes `created_at,id`). Offset pagination is banned — it breaks under concurrent inserts. |
| Concurrency | `ETag`/`If-Match` on project mutations. |
| Contracts | Zod schemas in `packages/contracts` are the single source of truth; OpenAPI 3.1 is generated from them, never hand-written. |
| Long work | `202 Accepted` + job resource + SSE stream. |

### 6.2 Core endpoints

| Method | Path | Purpose | Notes |
|---|---|---|---|
| `POST` | `/v1/generations` | Start a carousel generation | Idempotent; `202` + `generationId`; charges credits on reserve |
| `GET` | `/v1/generations/:id` | Job status + result | Poll fallback when SSE unavailable |
| `GET` | `/v1/generations/:id/stream` | SSE progress stream | `Last-Event-ID` resumable |
| `POST` | `/v1/generations/:id/cancel` | Cancel in-flight | Refunds reservation if not yet committed |
| `GET` | `/v1/projects` | Library, cursor-paginated | Filter by platform, brand kit, tag |
| `GET` | `/v1/projects/:id` | Full project + slides | `ETag` returned |
| `PATCH` | `/v1/projects/:id` | Autosave edits | `If-Match` required; writes a version snapshot |
| `POST` | `/v1/projects/:id/slides/:i/regenerate` | Single-slide regeneration with steering | 0.2 credits |
| `POST` | `/v1/projects/:id/versions/:v/restore` | Restore a version | New version, never destructive |
| `POST` | `/v1/projects/:id/exports` | Create export job | Body: `{ platform, format, ratio, theme }` |
| `GET` | `/v1/exports/:id` | Export status + signed artifact URL | URL TTL 15 min |
| `POST` | `/v1/uploads/presign` | Presigned S3 PUT for user images | MIME + size constrained server-side |
| `GET` | `/v1/workspaces/:id/credits` | Balance + ledger page | Derived from ledger, never a stored counter |
| `POST` | `/v1/brand-kits` · `/v1/brand-kits/:id/extract` | Brand kit CRUD; extract from URL | Extraction is a job |
| `POST` | `/v1/publish` | Phase 2 — publish/schedule | Requires connected social account |
| `POST` | `/v1/webhooks/stripe` · `/clerk` | Signed inbound webhooks | Signature verified; idempotent by event id |

### 6.3 SSE at scale

SSE holds a connection per active generation. With 2,000 concurrent generations that is 2,000 open connections — trivial for Fastify (event-loop bound, not thread bound), but it constrains deployment:

- ALB idle timeout raised to 120s; heartbeat comment frame every 15s keeps intermediaries from closing the stream.
- Progress events are published to **Redis Pub/Sub** by workers and fanned out by whichever API task holds the client connection. Any task can serve any stream — the API stays stateless (§14.1).
- Deploys drain gracefully: `SIGTERM` → stop accepting new connections → send `event: reconnect` → 20s grace → exit. Clients reconnect to a new task and resume by `Last-Event-ID`.
- Hard cap 5 concurrent streams per user; excess falls back to polling.

---

## 7. Database Layer (PostgreSQL)

### 7.1 Topology

| Component | Configuration | Rationale |
|---|---|---|
| Primary | RDS PostgreSQL 16, Multi-AZ, `db.r7g.large` (ARM) at launch | Multi-AZ gives automatic failover; ARM is ~20% cheaper per unit performance |
| Read replica | 1× same class, added when read load justifies it | Library/analytics reads only. **Never** for read-after-write paths — replica lag creates "I saved but it reverted" bugs |
| Pooling | PgBouncer (transaction mode), 25 server connections per pool | Fargate tasks × Node pools would otherwise exhaust `max_connections` |
| Migrations | Drizzle Kit, expand→migrate→contract, forward-only | Compatible with rolling deploys where old and new code run simultaneously |
| Backups | Automated daily + PITR (5-min granularity), 30-day retention, quarterly restore drill | RPO ≤5 min, RTO ≤1h |
| Extensions | `pgcrypto`, `pg_stat_statements`, `pg_trgm` (library search), `pgvector` (Phase 2 voice/template embeddings) | — |

**PgBouncer transaction mode and RLS interact correctly** because `SET LOCAL` is transaction-scoped — the setting cannot leak to the next tenant borrowing that server connection. Session-level `SET` would be a critical cross-tenant bug. This is a subtle, high-consequence detail and is enforced by a lint rule plus an integration test that asserts leakage is impossible.

### 7.2 Schema (core tables)

```sql
-- ─── Tenancy ────────────────────────────────────────────────────────────────
CREATE TABLE workspaces (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id        TEXT UNIQUE,                    -- NULL for personal workspaces
  name                TEXT NOT NULL,
  plan                plan_tier NOT NULL DEFAULT 'free',
  stripe_customer_id  TEXT UNIQUE,
  credit_reset_at     TIMESTAMPTZ NOT NULL,
  settings            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE TABLE workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         member_role NOT NULL DEFAULT 'editor',
  PRIMARY KEY (workspace_id, user_id)
);

-- ─── Content ────────────────────────────────────────────────────────────────
CREATE TABLE projects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  source_type      source_type NOT NULL,              -- prompt|paste|url|file|remix
  source_input     JSONB NOT NULL,
  platform_targets TEXT[] NOT NULL DEFAULT '{}',
  template_family  TEXT NOT NULL,
  template_version INT  NOT NULL,                     -- pinned: old projects re-render identically
  theme            TEXT NOT NULL,
  brand_kit_id     UUID REFERENCES brand_kits(id) ON DELETE SET NULL,
  version          INT  NOT NULL DEFAULT 1,           -- optimistic concurrency (If-Match)
  status           project_status NOT NULL DEFAULT 'draft',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX ON projects (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ON projects USING gin (title gin_trgm_ops);

CREATE TABLE slides (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,                         -- denormalised for RLS + index locality
  idx          INT  NOT NULL,
  role         slide_role NOT NULL,                   -- cover|list|quote|stat|image|cta|outro
  content      JSONB NOT NULL,                        -- typed per role in packages/contracts
  layout_id    TEXT NOT NULL,
  image_asset_id UUID REFERENCES assets(id),
  overrides    JSONB NOT NULL DEFAULT '{}',           -- user edits that survive regeneration
  flags        TEXT[] NOT NULL DEFAULT '{}',          -- 'verify_claim','text_clamped'
  content_hash TEXT NOT NULL,                         -- ★ render cache key input
  UNIQUE (project_id, idx)
);

-- ─── Money (append-only) ────────────────────────────────────────────────────
CREATE TABLE credit_ledger (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  delta        NUMERIC(10,2) NOT NULL,                -- negative = spend
  reason       TEXT NOT NULL,
  ref_id       TEXT,                                  -- idempotency key / generation id
  status       ledger_status NOT NULL DEFAULT 'committed',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON credit_ledger (workspace_id, ref_id) WHERE ref_id IS NOT NULL;
CREATE INDEX ON credit_ledger (workspace_id, created_at DESC);
-- No UPDATE/DELETE grants. Corrections are compensating rows.

-- ─── AI observability (partitioned) ─────────────────────────────────────────
CREATE TABLE generations (
  id             UUID NOT NULL DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL,
  project_id     UUID NOT NULL,
  reservation_id BIGINT REFERENCES credit_ledger(id),
  provider       TEXT, model TEXT, prompt_version TEXT NOT NULL,
  tokens_in      INT, tokens_out INT, cached_tokens INT,
  cost_usd       NUMERIC(10,6),
  latency_ms     INT,
  status         generation_status NOT NULL,
  safety_flags   TEXT[] DEFAULT '{}',
  error_code     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);   -- monthly partitions, detach after 12 months

-- ─── Reliability ────────────────────────────────────────────────────────────
CREATE TABLE outbox (
  id          BIGSERIAL PRIMARY KEY,
  topic       TEXT NOT NULL,
  payload     JSONB NOT NULL,
  dedupe_key  TEXT UNIQUE NOT NULL,
  published_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON outbox (created_at) WHERE published_at IS NULL;
```

Additional tables follow the same patterns: `users`, `brand_kits`, `brand_voice_profiles`, `assets`, `project_versions`, `export_jobs`, `publish_jobs`, `social_accounts` (KMS-encrypted tokens), `audit_log` (partitioned).

### 7.3 Row-Level Security

RLS is the backstop for D3 — it makes the *worst realistic bug* (a repository method where someone forgot the `workspace_id` predicate) return zero rows instead of another tenant's data.

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON projects
  USING       (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK  (workspace_id = current_setting('app.workspace_id', true)::uuid);
```

- The application connects as a **non-superuser, non-owner** role — `FORCE ROW LEVEL SECURITY` closes the table-owner bypass.
- Every request-scoped transaction begins with `SET LOCAL app.workspace_id`; a Nest interceptor does this centrally so no developer has to remember.
- Background workers set the same variable from the job payload. A job without a `workspaceId` is rejected at the queue boundary.
- Migrations and the admin console use a separate elevated role, used only in explicitly audited code paths.
- **Test enforcement:** an integration suite creates two workspaces and asserts that every repository method, invoked with tenant B's context against tenant A's ids, returns empty. New tables without an RLS policy fail a CI schema lint.

### 7.4 JSONB usage policy

`slides.content`, `source_input`, and `settings` are JSONB — the shape varies by slide role and evolves weekly with the AI pipeline. Modelling that relationally would mean a migration per template change.

The rule that keeps this from becoming schemaless mush: **JSONB is validated at the application boundary by the Zod schema in `packages/contracts`, and anything queried or aggregated gets promoted to a real column.** `content_hash`, `role`, and `flags` are columns precisely because they are queried. Business-critical data (money, entitlements, identity) is never JSONB.

---

## 8. AI Layer

The most volatile part of the system: three LLM vendors, two image vendors, weekly prompt changes, and pricing that moves under you (D4). It is isolated behind one module so that volatility cannot leak into the domain.

### 8.1 Structure

```
packages/ai-core/
├─ providers/
│  ├─ openai.adapter.ts      # Chat + structured outputs + Images API
│  ├─ anthropic.adapter.ts   # Claude — messages, tool-use schema, prompt caching
│  ├─ google.adapter.ts      # Gemini — responseSchema, long-context intake
│  ├─ flux.adapter.ts        # FLUX image generation (BFL/Replicate/fal)
│  └─ provider.interface.ts  # ★ the only contract the domain knows about
├─ router/
│  ├─ policy.ts              # task → ordered candidate models
│  ├─ router.service.ts      # selection, failover, circuit breaker, budget guard
│  └─ circuit-breaker.ts
├─ prompts/
│  ├─ registry.ts            # versioned, immutable once shipped
│  └─ v3/{plan,copy,caption,safety,brand-voice}.ts
├─ schemas/                  # Zod → JSON Schema for structured outputs
├─ pipeline/                 # the 10-stage orchestration (§8.4)
└─ evals/                    # golden set + scorers, run in CI
```

**The provider interface is deliberately narrow.** Anything vendor-specific (Claude's tool-use blocks, Gemini's `responseSchema`, OpenAI's structured outputs) is normalized inside the adapter:

```ts
export interface LlmProvider {
  readonly id: 'openai' | 'anthropic' | 'google';
  complete<T>(req: {
    model: string;
    system: string;
    messages: Message[];
    schema?: JsonSchema;         // adapter maps to each vendor's native mechanism
    maxTokens: number;
    temperature: number;
    cacheablePrefix?: string;    // vendor prompt-caching hint
    signal: AbortSignal;
  }): Promise<LlmResult<T>>;     // { data, usage, costUsd, latencyMs, raw }
  stream(req): AsyncIterable<LlmDelta>;
}
```

Business logic depends on `LlmProvider`, never on a vendor SDK. Swapping a provider is an adapter + a policy-table row.

### 8.2 Model routing policy

Different sub-tasks have wildly different quality sensitivity and cost. Routing everything to a frontier model is the single largest avoidable cost in this category of product (§17).

| Task | Quality sensitivity | Primary | Fallback 1 | Fallback 2 | Typical tokens |
|---|---|---|---|---|---|
| **Narrative planning** (angle, slide roles, hook strategy) | **Critical** — determines whether the deck is any good | Claude (frontier tier) | OpenAI (frontier) | Gemini (pro tier) | 1.5k in / 0.8k out |
| **Slide copywriting** (constraint-bound, parallelized) | **High** | Claude (frontier) | OpenAI (frontier) | Gemini (pro) | 2k in / 2k out |
| **Long-source intake** (20k-char article → brief) | Medium | Gemini (long-context, cheap per token) | Claude | — | 20k in / 1k out |
| **Captions & hashtags** | Low | OpenAI (small/fast) | Gemini (flash tier) | — | 1k in / 0.4k out |
| **Inline edits** (shorten, rephrase, fix tone) | Low | OpenAI (small/fast) | Claude (fast tier) | — | 0.4k in / 0.2k out |
| **Classification** (intent, language, content type) | Low | OpenAI (small/fast) | — | — | 0.3k in / 0.05k out |
| **Safety pre/post-check** | High (but cheap models suffice) | Provider moderation endpoint + small model | Second small model | — | — |
| **Brand-voice extraction** (one-off per workspace) | High | Claude (frontier) | OpenAI (frontier) | — | 6k in / 1k out |
| **Image generation — photographic** | Medium | FLUX (cost-efficient at quality) | OpenAI Images | — | — |
| **Image generation — text-in-image / precise instruction** | High | OpenAI Images | FLUX | — | — |

Concrete model identifiers are **not hardcoded anywhere** — they live in a runtime config table (`model_policy`) so a vendor deprecation or price change is a config edit and a canary, not a deploy. Each policy row carries `{ task, rank, provider, model, maxCostUsd, timeoutMs, enabled }`.

**Router behavior on each call:**
1. Select highest-ranked enabled candidate whose circuit is closed.
2. Enforce a per-call cost ceiling (estimated from token budget); abort if exceeded.
3. On retryable failure (5xx, timeout, rate limit) → jittered exponential backoff, 2 attempts.
4. On persistent failure → next candidate. Log the degradation.
5. Circuit breaker per `(provider, model)`: open after 5 failures in 60s, half-open probe after 30s.
6. Every call writes a `generations` row: provider, model, tokens (including cached), cost, latency, prompt version.

**Failover is quality-aware, not blind.** Falling back from a frontier planner to a small model would produce a bad carousel silently — worse than an honest error. Fallback candidates are only ever peers in quality class; if all peers are down, the job fails cleanly, the credit is refunded, and the user sees a retry CTA (§19).

### 8.3 Structured output — the reliability keystone

Free-text LLM output cannot drive a deterministic layout engine. Every generation stage returns **schema-validated JSON**, using each vendor's native constrained-output mechanism, with the schema derived from the same Zod definitions the API and frontend use.

```ts
export const SlidePlanSchema = z.object({
  angle: z.string().max(200),
  hookVariants: z.array(z.string().max(90)).length(3),
  slides: z.array(z.object({
    role: z.enum(['cover','list','quote','stat','image','cta','outro']),
    headline: z.string().max(64),        // ← budgets come from the template, not guesswork
    body:     z.string().max(180).optional(),
    emphasis: z.string().max(24).optional(),
    imageHint: z.string().max(120).optional(),
    claimsFactualData: z.boolean(),      // drives the "verify before publishing" chip
  })).min(3).max(20),
});
```

The character budgets are **injected into the prompt from the selected template's slot definitions** (§9.2). The model is told the exact constraint it must satisfy, which is what makes overflow rare rather than routine — and the auto-fit cascade catches the remainder deterministically.

**Validation ladder on parse failure:** (1) retry once with the validation error appended as a repair instruction; (2) retry with the next-ranked model; (3) fall back to a simpler template contract with looser slots; (4) fail the job, refund the credit. Users never see a malformed slide.

### 8.4 Generation pipeline

```
                 ┌──────────────────────────────────────────────────────┐
 job: generation │  ai-worker                                           │
 ────────────────▶                                                      │
                 │ 1  Intake normalize    URL fetch (SSRF-guarded) /    │
                 │                        file parse / language detect  │
                 │ 2  Safety pre-check    moderation + policy classifier│──▶ block
                 │ 3  PLAN                frontier model, JSON schema   │  (refund)
                 │                        ──▶ SSE: outline               │
                 │ 4  COPY (parallel)     slide groups, budget-bound    │
                 │                        ──▶ SSE: slide × N            │
                 │ 5  Validate            Zod; repair ladder            │
                 │ 6  Layout assign       role → layout, deterministic  │
                 │ 7  Auto-fit + contrast deterministic engine (§9.2)   │
                 │ 8  Captions            cheap model, per platform     │
                 │ 9  Safety post-check   output classifier + claim flag│
                 │ 10 Persist + enqueue   slides, content_hash,         │
                 │                        render jobs (child flow)      │
                 └───────────────────────┬──────────────────────────────┘
                                         │ BullMQ FlowProducer
                                 ┌───────▼────────┐
                                 │ render-worker  │ ──▶ SSE: rendered
                                 └────────────────┘
```

Stages 3 and 4 dominate latency; stage 4 is parallelized across slide groups (3 concurrent calls for an 8-slide deck) which cuts wall-clock roughly in half. Stage 3's output streams to the client at ~4s, so perceived latency is a fraction of the 20–60s total (§4.4).

### 8.5 Prompt registry and evaluation

- Prompts are **code**, versioned in git, immutable once shipped, addressed as `plan@v3.2`. Every `generations` row stores the exact version — any output is reproducible and any regression is bisectable.
- Rollback is a config flag flip (≤5 min), not a deploy.
- **Golden-set evaluation** of ≥200 prompts runs in CI on every prompt or policy change, scoring structure validity, hook strength, copy quality, brand adherence, safety, and cost. Merge is blocked on regression against the current baseline.
- Production sampling: 2% of generations are scored by an LLM judge; user thumbs-down events feed the eval corpus. This is the loop that turns "the AI feels worse this week" from a vibe into a number.

### 8.6 Image generation

| Aspect | Design |
|---|---|
| Providers | FLUX (default — better cost/quality for photographic and abstract backgrounds), OpenAI Images (when the prompt requires precise instruction-following or legible in-image text) |
| Invocation | Always asynchronous, its own BullMQ queue and worker pool (5–60s latencies would otherwise block generation) |
| Prompt construction | Slide `imageHint` + brand palette + style preset, passed through a template — never raw user text |
| Safety | Provider filters + our own pre-filter on the constructed prompt; a blocked image degrades to a curated stock/gradient background rather than failing the deck |
| Post-processing | Sharp: resize to slot dimensions, smart crop to focal point, WebP + JPEG variants, strip EXIF |
| Cost control | Metered separately at 0.5 credits/image; hard per-workspace daily ceiling |
| Caching | Content-hash on the normalized prompt + style + dimensions; identical requests reuse the stored asset |

---

## 9. Rendering Pipeline

This is the component that makes the product feel professional rather than "AI-generated," and it is where D2 is won or lost.

### 9.1 Flow

```
export job (BullMQ) ──▶ render-worker (Fargate, 2 vCPU / 4 GB, Playwright+Chromium)
   │
   ├─ 1. Compute render key: sha256(slideContent + templateId + templateVersion
   │                                + theme + brandKitVersion + ratio + scale)
   ├─ 2. Cache lookup: S3 HEAD on renders/<key>.png ─── hit ──▶ return URL (≈40% of calls)
   ├─ 3. Miss → mint short-lived signed render token (JWT, 60s, scoped to jobId)
   ├─ 4. browser.newContext({ viewport: {W,H}, deviceScaleFactor: 2 })
   ├─ 5. page.goto(`${WEB_URL}/render/${jobId}?token=…`, { waitUntil:'networkidle' })
   ├─ 6. await page.waitForFunction(() => window.__RENDER_READY__ === true)
   │        (set after document.fonts.ready + all images decoded + layout settled)
   ├─ 7. per slide: element.screenshot({ type:'png' })      → PNG @2×
   │        or for LinkedIn: page.pdf({ width, height, printBackground:true })
   ├─ 8. Sharp: optional JPEG/WebP transcode, quality tuning, metadata strip
   ├─ 9. Watermark composite (server-side only, free tier)
   ├─ 10. S3 putObject (content-hash key) → CloudFront URL
   └─ 11. Publish progress to Redis Pub/Sub → SSE → client
```

**Browser lifecycle.** One Chromium instance per worker process, reused across jobs; a fresh `BrowserContext` per job for isolation. The browser is recycled every 100 jobs or 30 minutes to bound memory creep. Container flags that matter: `--disable-dev-shm-usage` with `shm_size: 1gb` (Chromium crashes on Fargate's default 64MB `/dev/shm`), `--font-render-hinting=none` and `--force-color-profile=srgb` for deterministic, host-independent output.

**Network isolation.** The render context blocks all outbound requests except the Next.js origin and the CloudFront asset domain. A template that could fetch an arbitrary URL would be an SSRF pivot into the VPC (§13.6). Fonts are self-hosted and preloaded — a Google Fonts request at render time would make output non-deterministic and add a hard external dependency to every export.

### 9.2 Layout & auto-fit engine (`packages/templates`)

Pure TypeScript, no I/O, fully unit-testable — the highest-value test surface in the codebase.

Each template slot declares its constraints:

```ts
export const coverSlot: SlotSpec = {
  id: 'headline',
  maxChars: 64,
  font: { family: 'Inter', weight: 800, sizeRange: [44, 72], lineHeightRange: [1.05, 1.2] },
  maxLines: 3,
  overflow: 'cascade',
  minContrast: 4.5,          // WCAG AA enforced at render time
};
```

**The auto-fit cascade** (PRD TR-R02), applied deterministically in order:

1. Text fits the budget → render as designed.
2. Step font size down within `sizeRange` (binary search on measured height).
3. Tighten line-height/tracking within allowed bounds.
4. Clamp to `maxLines` with ellipsis **and set the `text_clamped` flag** so the slide is visibly marked for review.
5. Request an AI shortening pass (cheap model, ≤2s) and re-run from step 1.

Silent truncation that destroys meaning is prohibited. Step 4 is always visible to the user.

**Contrast enforcement:** the engine computes the effective background (solid, gradient, or image mean luminance in the text region) and, if contrast falls below 4.5:1, applies the template's declared remedy — scrim overlay, text-color inversion, or accent swap. No generated slide ships below AA (PRD FR-D05).

**Ratio reflow, never scaling.** Switching 4:5 → 1:1 re-runs the whole layout at the new dimensions. Bitmap scaling would produce the stretched, amateur look this product exists to eliminate.

### 9.3 Determinism and testing

| Guarantee | Mechanism |
|---|---|
| Same input ⇒ same bytes | Pinned fonts, no network, fixed DPR, disabled animation, pinned Chromium version in the base image |
| Template updates never mutate old projects | `projects.template_version` pinned; old versions retained and renderable |
| No visual regressions | CI renders every template × ratio × theme, pixel-diffs against golden images (0.1% tolerance), blocks merge on diff |
| No overflow | 500-deck corpus asserted defect-free on every engine change |

---

## 10. Background Jobs (Redis + BullMQ)

### 10.1 Queue topology

| Queue | Worker pool | Concurrency/worker | Priority | Retries | Timeout |
|---|---|---|---|---|---|
| `generation` | ai-worker | 8 (IO-bound) | plan-tiered | 2 | 120s |
| `slide-regenerate` | ai-worker | 12 | high | 2 | 30s |
| `image-generate` | ai-worker | 4 | low | 2 | 90s |
| `render` | render-worker | 2 (CPU/RAM-bound) | plan-tiered | 3 | 60s |
| `export` | render-worker | 2 | plan-tiered | 3 | 120s |
| `import-url` | ai-worker | 10 | normal | 2 | 20s |
| `brand-extract` | ai-worker | 4 | normal | 2 | 45s |
| `publish` | ai-worker | 6 | high | 5 (long backoff) | 60s |
| `email` | ai-worker | 20 | low | 5 | 15s |
| `maintenance` | ai-worker | 2 | low | 1 | 300s |

Concurrency differs by an order of magnitude between pools because the work differs: an AI job is 40s of waiting on a socket (cheap to multiplex), a render job is 8s of pegged CPU and ~500MB of Chromium (multiplexing it just makes everything slower).

### 10.2 Job patterns

**Batch generation via flows.** A 20-carousel agency batch is a BullMQ `FlowProducer` tree — parent `batch` job with 20 `generation` children, each of which spawns `render` children. The parent completes only when all descendants do, giving a single progress surface and one notification.

```ts
await flow.add({
  name: 'batch', queueName: 'generation',
  data: { batchId, workspaceId },
  children: topics.map((t, i) => ({
    name: 'generate', queueName: 'generation',
    data: { workspaceId, topic: t, idx: i },
    opts: { jobId: `gen:${batchId}:${i}`, attempts: 2, backoff: { type: 'exponential', delay: 2000 } },
  })),
});
```

**Idempotency.** Every job carries a deterministic `jobId` (`gen:<generationId>`, `render:<renderKey>`). BullMQ rejects duplicates, so outbox at-least-once delivery yields exactly-once effect. Handlers are additionally written to be safe to re-run: they check for an existing completed artifact before doing work.

**Per-tenant fairness (D5).** BullMQ's group rate limiting caps concurrent jobs per `workspaceId` (Free 1, Creator 2, Pro 4, Team 8, Agency 16). Without this, one agency's 200-item batch would occupy every worker and every other customer would see minutes of queue wait. Priority is plan-tiered on top so paid work jumps free work.

**Retries and the DLQ.** Exponential backoff with jitter. Non-retryable failures (content policy, invalid input, insufficient credits) are marked `unrecoverable` and fail immediately — retrying a policy refusal three times just burns money and delays the user's error message. Exhausted jobs land in a dead-letter queue with full context; a DLQ depth >0 pages on-call. Every terminal failure triggers credit refund via a compensating ledger entry.

**Graceful shutdown.** `SIGTERM` → `worker.close()` stops fetching new jobs → in-flight jobs get 60s (render) / 120s (generation) to finish → unfinished jobs return to the queue. ECS `stopTimeout` is set above these values so the platform does not `SIGKILL` mid-job.

### 10.3 Redis configuration

| Concern | Decision |
|---|---|
| Deployment | ElastiCache Redis 7, cluster-mode disabled, primary + replica, Multi-AZ, automatic failover |
| Separation | **Two logical databases (or two instances at scale): DB 0 = BullMQ, DB 1 = cache.** Never share. A cache eviction storm must not evict queue state. |
| Eviction | Queue DB: `noeviction` (losing a job is data loss). Cache DB: `allkeys-lru`. |
| Persistence | AOF `everysec` on the queue instance |
| Sizing | `cache.r7g.large` at launch; queue memory ≈ 2KB/job × peak depth |
| Monitoring | Queue depth, wait time p95, active/failed/delayed counts per queue → dashboards + alerts |

---

## 11. Caching Strategy

Six layers, each with a clear invalidation story. A cache without a documented invalidation rule is a future incident.

| # | Layer | Contents | TTL | Invalidation |
|---|---|---|---|---|
| 1 | **CloudFront CDN** | Static assets, marketing pages, rendered slide images | 1y (immutable, content-hashed) | Never — new content, new key |
| 2 | **Next.js ISR / RSC cache** | Marketing, template gallery, public share pages | 60s–1h | Tag-based `revalidateTag()` on publish |
| 3 | **HTTP / TanStack Query** | `GET` responses, `ETag` + `stale-while-revalidate` | 30s–5m | Query-key invalidation on mutation |
| 4 | **Redis application cache** | Hot entities and computed values (below) | 30s–24h | Explicit delete on write; versioned keys |
| 5 | **★ Render cache (S3)** | Rendered slide PNG/JPEG/PDF by content hash | Permanent (lifecycle-managed) | Content-addressed — a change means a new key |
| 6 | **LLM prompt cache** | Vendor-side caching of stable system/instruction prefixes | Vendor-managed | Prefix change |

### 11.1 Redis cache keys

```
ws:{id}:entitlements        → plan, limits, features            TTL 5m   (del on plan change)
ws:{id}:credits             → derived balance                   TTL 30s  (del on ledger write)
ws:{id}:brandkits           → list                              TTL 10m
user:{id}:memberships       → workspace list + roles            TTL 5m   (del on Clerk webhook)
jwks:clerk                  → signing keys                      TTL 1h
tpl:{family}:{version}      → compiled template metadata        TTL 24h  (immutable)
idem:{key}                  → cached mutation response          TTL 24h
rl:{scope}:{id}:{window}    → sliding-window counters           TTL = window
sse:{generationId}          → Pub/Sub channel (not a cache)     —
lock:{resource}             → distributed lock (Redlock-lite)   TTL 30s
```

Key conventions: always namespaced by tenant, always explicitly TTL'd, never storing anything that is expensive to lose. Cache is an optimization, never a source of truth — every read path must work correctly with Redis cold.

### 11.2 The render cache is the highest-leverage cache in the system

Users regenerate one slide, change a theme, or export the same deck for a second platform. Content-hash keying means only genuinely changed slides re-render:

| Scenario | Slides re-rendered (of 8) |
|---|---|
| Edit one headline | 1 |
| Change theme (light → dark) | 8 (theme is in the hash) |
| Export same deck to a second ratio | 8 (ratio is in the hash) |
| Re-export unchanged deck | 0 |
| Change brand logo | 8 (brand-kit version is in the hash) |

Measured on realistic usage this cuts render compute ~40% — directly reducing the Fargate bill and p95 export latency (§17).

### 11.3 Stampede protection

Popular cache keys (entitlements, JWKS, template metadata) use single-flight: the first miss takes a short Redis lock and recomputes; concurrent readers wait on the lock or serve slightly stale data. Without this, a cold start under load turns one expensive query into hundreds simultaneously.

---

## 12. Storage Layer (AWS S3)

### 12.1 Bucket layout

| Bucket | Contents | Access | Lifecycle |
|---|---|---|---|
| `cg-uploads-{env}` | User images, logos, imported files | Private; presigned PUT in, presigned GET out | Intelligent-Tiering after 30d |
| `cg-renders-{env}` | Content-hash-keyed slide renders (cache) | Private; served via CloudFront OAC | Delete after 90d (regenerable) |
| `cg-exports-{env}` | Final ZIP/PDF deliverables | Private; presigned GET, 15-min TTL | Paid 90d → Glacier IR; free 7d → delete |
| `cg-assets-{env}` | Fonts, template static assets, stock cache | Public via CloudFront | Immutable, 1y cache |
| `cg-backups-{env}` | DB exports, DR artifacts | Private, versioned, Object Lock | Glacier Deep Archive after 30d |

**Key structure:** `{workspaceId}/{projectId}/{contentHash}.{ext}` — tenant-prefixed (enables per-tenant lifecycle rules, cost attribution, and a clean bulk-delete path for GDPR erasure) and content-addressed (free deduplication, safe infinite caching).

### 12.2 Access control

- All buckets: **Block Public Access on**, SSE-KMS encryption, TLS-only bucket policy.
- Uploads use **presigned POST with server-enforced conditions** — content-length range, allowed MIME types, key prefix locked to the caller's workspace. The client never receives credentials that let it write outside its own prefix.
- Uploaded images are re-encoded with Sharp before use: this strips EXIF (privacy) and neutralizes polyglot/malformed-image attacks. The original is never served to other users.
- Delivery via CloudFront with **Origin Access Control**; private artifacts use signed URLs (15 min) or signed cookies for share links.
- Cross-tenant access is structurally impossible: the presign path derives the key prefix from the authenticated principal's workspace, never from client input.

---

## 13. Security Architecture

### 13.1 Threat model summary

| Threat | Control |
|---|---|
| Cross-tenant data access | RLS + workspace guard + tenant-prefixed S3 keys + isolation test suite (§7.3) |
| Stolen/replayed session token | Short-lived Clerk JWTs, JWKS rotation, `aud`/`azp` verification, revocation via webhook |
| Credit/billing manipulation | Server-side entitlement checks, append-only ledger, Stripe webhook signature verification, idempotency |
| SSRF via URL import | Allowlist scheme, DNS resolution + private-range rejection, redirect re-validation, egress proxy |
| Prompt injection via imported content | Structural data/instruction separation, output schema validation, no tool access from generation path |
| Malicious file upload | MIME sniffing, size caps, Sharp re-encode, no execution path, private bucket |
| Abuse / cost exhaustion | Layered rate limits, per-workspace daily spend ceiling, anomaly alerts, disposable-email blocking |
| Secret leakage | AWS Secrets Manager, no secrets in env files or client bundles, CI secret scanning |
| Social token compromise (Ph. 2) | KMS envelope encryption, minimal scopes, per-workspace data keys, user-revocable |
| Insider access | Audited impersonation with reason, least-privilege IAM, no production DB access by default |

### 13.2 Authentication and authorization

**Clerk** is the identity provider (Auth.js is the documented fallback if Clerk pricing or feature fit changes — the `auth` module isolates the dependency behind a `PrincipalResolver` interface).

```
Browser ──▶ Clerk hosted UI ──▶ session JWT (short-lived, refreshed silently)
   │
   └─▶ Next.js middleware: route protection, redirect unauthenticated
   └─▶ API: Authorization: Bearer <jwt>
          ClerkAuthGuard → verify signature against cached JWKS (Redis, 1h)
                         → verify iss / aud / azp / exp
                         → map clerk_user_id → users.id
          WorkspaceGuard → resolve X-Workspace-Id → assert membership → attach role+plan
```

- **Clerk Organizations map to workspaces**, so team membership and invitations are managed in Clerk and mirrored into Postgres via signed webhooks (`organization.*`, `user.*`). Postgres remains the authorization source of truth for API decisions — an outage at the identity provider must not fail open.
- Authorization is **RBAC evaluated server-side on every request**. Roles: `owner`, `admin`, `editor`, `viewer`. Client-side role checks exist only to hide UI, never to protect data.
- Plan entitlements (`@RequirePlan('pro')`) are checked from cached entitlements with a DB fallback. Feature gating is never trusted from the client.
- Service-to-service (worker → API, render worker → `/render`) uses short-lived signed JWTs with narrow audience claims, not shared static API keys.

### 13.3 Input validation

Every request body, query, and param is parsed by a Zod schema from `packages/contracts` — the same schema the client validates against. Unknown keys are stripped, not ignored. Numeric bounds, string lengths, and enum membership are all declared, so malformed input fails at the boundary with a `400`, never deeper in the stack.

### 13.4 Rate limiting

| Scope | Limit | Purpose |
|---|---|---|
| IP (anonymous generate) | 1 / 24h + 20 req/min | Free-tier abuse (PRD FR-A02) |
| User | 300 req/min | Runaway client / scripted abuse |
| Workspace — generation | Plan-tiered (Free 5/day … Agency 500/day) | Cost control |
| Workspace — concurrent jobs | Plan-tiered 1–16 | Fairness (§10.2) |
| Workspace — daily AI spend | Hard USD ceiling per plan | Cost blast radius (D4) |
| Auth endpoints | 10 / 15 min per IP+identifier | Credential stuffing |
| Webhooks | Signature required; unsigned dropped before parsing | Forgery |

Sliding-window counters in Redis; `429` with `Retry-After`. AWS WAF sits in front of the ALB with managed rule sets plus a bot-control rule on signup.

### 13.5 Data protection

- **In transit:** TLS 1.3 everywhere, HSTS with preload, TLS enforced inside the VPC for RDS and ElastiCache.
- **At rest:** RDS and ElastiCache encrypted with KMS CMKs; S3 SSE-KMS; automated key rotation.
- **Application-level:** social OAuth tokens use envelope encryption — a per-workspace data key wrapped by a KMS CMK, so compromising the database alone yields nothing usable.
- **PII minimization:** we store email and name; no payment data ever touches our systems (Stripe Checkout is hosted).
- **Erasure:** GDPR deletion is a job that removes DB rows (cascades), deletes the S3 `{workspaceId}/` prefix, purges analytics identifiers, and revokes provider-side data where contracts allow — completing within 30 days with an audit record.
- **Vendor terms:** zero-retention or ≤30-day retention configured with all model vendors; user content is not used for third-party training (PRD NFR-C03). This is a contractual claim and must remain true.

### 13.6 SSRF defense (URL import)

URL import fetches an arbitrary user-supplied address from inside our VPC — one of the highest-risk features in the product.

1. Scheme allowlist: `https` only.
2. Resolve DNS **first**, reject any address in private/link-local/loopback/metadata ranges (including IPv6 and IPv4-mapped forms).
3. **Pin the connection to the validated IP** to close the DNS-rebinding window between check and connect.
4. Follow at most 3 redirects, re-validating every hop.
5. 10s timeout, 5MB response cap, `text/html` and `text/plain` only.
6. Fetching runs in the worker (never the API), through a **dedicated egress path with no IAM role**, so a successful pivot reaches no AWS credentials — the EC2/ECS metadata endpoint is explicitly unreachable.

### 13.7 Prompt injection defense

Imported page content and uploaded files are attacker-controlled text flowing into a model. Controls:

- **Structural separation:** untrusted content is passed in a clearly delimited, explicitly labelled block; system instructions state that its content is data to summarize and that instructions inside it must be ignored.
- **No capability at risk:** the generation path has no tools, no database access, no ability to make network calls, and no secrets in context. The worst achievable outcome of a successful injection is a bad carousel — not data exfiltration or privileged action.
- **Schema-constrained output:** the model can only emit conforming JSON; free-form injected output cannot become an executable instruction downstream.
- **Output safety classification** runs after generation regardless of input provenance.
- The `/render` surface treats all slide content as **text, never HTML** — no `dangerouslySetInnerHTML` anywhere in `packages/templates` — so injected markup cannot execute during rendering.

### 13.8 Compliance and process

SOC 2 Type II readiness by month 18; annual third-party penetration test; CI gates for dependency CVEs (block on critical), container scanning, secret scanning, and SAST; documented incident response with a 72-hour breach notification runbook; public subprocessor list maintained.

---

## 14. Scalability

### 14.1 Statelessness

Every API task is interchangeable: no in-memory sessions (Clerk JWTs), no sticky routing (SSE state lives in Redis Pub/Sub), no local disk (S3), no in-process job state (BullMQ). This is what makes horizontal scaling and zero-downtime deploys trivial rather than an ongoing source of incidents.

### 14.2 Scaling dimensions

| Tier | Scaling signal | Range | Notes |
|---|---|---|---|
| Web (Vercel) | Automatic | — | Serverless/edge; effectively unbounded for our traffic class |
| API (Fargate) | CPU >60% **or** ALB requests/target | 2 → 20 | Scale out fast (60s), in slow (300s) to avoid flapping |
| ai-worker | **Queue depth** on `generation` + `slide-regenerate` | 2 → 30 | Target: depth/worker < 5 |
| render-worker | **Queue depth** on `render` + `export` | 2 → 40 | Memory-heavy; scale on depth, not CPU |
| Postgres | Vertical first, then read replicas | r7g.large → r7g.4xlarge | Sharding is not needed within the 3-year plan |
| Redis | Vertical, then cluster mode | r7g.large → cluster | Queue and cache split before clustering |

**Queue-depth autoscaling is the important one.** CPU-based scaling reacts *after* users are already waiting; queue depth is a leading indicator. Depth and wait-time p95 are published as CloudWatch metrics by a small publisher task, and ECS Application Auto Scaling target-tracks them (equivalent to KEDA's `ScaledObject` on ECS).

### 14.3 Capacity model

Worked example at **10,000 MAU** (PRD launch-scale target):

```
Generations/month     ≈ 34,000   (9.5k free × ~2.5 + 500 paid × ~20)
Peak-hour share       ≈ 12%      (weekday 09:00–11:00 concentration)
Peak generations/hour ≈ 1,100    (34,000 / 22 working days × 0.12 × ~2 peak factor)
                      ≈ 0.3 /s

ai-worker:     40s avg × 0.3/s = 12 concurrent jobs → 2 workers @ 8 concurrency  (headroom 33%)
render-worker: 8 slides × 1.2s = 10s CPU/carousel; ×0.3/s = 3 concurrent
               → 2 workers @ 2 concurrency (with ~40% render-cache hit rate)
API:           ~120 rps peak (incl. autosave + polling) → 3 tasks @ 1 vCPU
Postgres:      ~800 writes/min, ~4k reads/min → r7g.large is >10× headroom
```

At **100,000 MAU** the same model gives roughly 20 ai-workers, 20 render-workers, 8 API tasks, `r7g.2xlarge` Postgres with one read replica, and Redis split into separate queue and cache instances — **no architectural change**, only configuration. That is the test this design is meant to pass.

### 14.4 Known bottlenecks and their responses

| Bottleneck | Symptom | Response |
|---|---|---|
| LLM provider rate limits | 429s, generation latency spike | Router failover across three vendors; per-provider token-bucket shaping; queue backpressure |
| Render CPU | `render` queue depth climbing | Scale render pool; raise cache hit rate; consider pre-warmed browser pool |
| Postgres connections | Connection exhaustion under scale-out | PgBouncer (already in path); cap per-task pool size at 10 |
| Postgres write hotspot on `credit_ledger` | Lock contention on high-volume workspaces | Per-workspace row locking already isolates tenants; periodic rollup snapshot table if a single workspace becomes hot |
| Redis memory (queue) | Evictions = job loss | `noeviction` on queue DB, alarm at 70% memory, completed-job retention capped (`removeOnComplete: 1000`) |
| SSE connection count | ALB/target saturation | Cheap on Fastify; cap 5 per user; poll fallback |

---

## 15. Observability

Without this, none of the SLOs in the PRD are measurable and cost regressions are invisible until the invoice.

| Pillar | Tooling | What it must capture |
|---|---|---|
| Tracing | OpenTelemetry → vendor backend | One trace ID spanning browser → API → outbox → BullMQ → worker → provider call → S3. Trace ID propagated in job payloads — without it, distributed debugging is guesswork. |
| Metrics | CloudWatch + Prometheus-format app metrics | Generation success rate, p50/p95 latency by stage, queue depth and wait, render cache hit rate, **cost per generation**, credit consumption anomalies, layout defect rate |
| Logs | Structured JSON, pino → CloudWatch | `traceId`, `workspaceId`, `userId`, `generationId` on every line. Never log prompt content, model output, or PII. |
| Errors | Sentry (web + api + workers) | Source-mapped, release-tagged, grouped by fingerprint |
| Product analytics | PostHog | Funnels and retention for the PRD metrics; activation event = generate + export |
| AI quality | `generations` table + eval harness | Prompt version, model, cost, tokens, safety flags — every call, no exceptions |

**Paging alerts (from PRD §16.8):** generation success <95% over 15 min · export success <98% · p95 generation >120s · provider error rate >10% · **cost per generation >$0.20** · queue wait >60s · DLQ depth >0 · RDS CPU >80% · Redis memory >70%.

---

## 16. Deployment & Environments

### 16.1 Environments

| Env | Web | API/Workers | Data | Purpose |
|---|---|---|---|---|
| Local | `next dev` | Docker Compose (Postgres, Redis, LocalStack) | Seeded | Development |
| Preview | Vercel preview per PR | Shared staging API | Staging DB | Design/PM review of every PR |
| Staging | Vercel | Fargate (1 task/pool) | Own RDS + Redis, synthetic data | Integration, load tests, migration rehearsal |
| Production | Vercel | Fargate (autoscaled, Multi-AZ) | RDS Multi-AZ + replica, ElastiCache Multi-AZ | — |

Production secrets live in AWS Secrets Manager, injected at task start; no human has standing production database access — break-glass is a time-boxed, audited role assumption.

### 16.2 CI/CD

```
PR opened
 ├─ typecheck · eslint · prettier                          (~1 min)
 ├─ unit tests (Vitest) — layout engine, billing, guards    (~2 min)
 ├─ contract tests — Zod schemas ↔ OpenAPI                  (~30 s)
 ├─ integration tests (Testcontainers: Postgres + Redis)    (~4 min)
 │    incl. ★ tenant-isolation suite (RLS) — blocking
 ├─ visual regression — templates × ratios × themes         (~5 min)
 ├─ ★ AI eval suite — 200-prompt golden set, non-regressive (~8 min, nightly full)
 ├─ security — CVE scan, secret scan, SAST                  (~2 min)
 └─ Vercel preview deploy + ephemeral API stack

merge to main
 ├─ build + push images (multi-arch ARM64) to ECR
 ├─ DB migration (expand phase only — always backward compatible)
 ├─ ECS rolling deploy: API → workers, health-gated
 ├─ smoke tests against production (synthetic generation + export)
 └─ auto-rollback on health check or error-rate regression
```

**Migration discipline (expand → migrate → contract).** During a rolling deploy, old and new code run simultaneously; a migration that drops or renames a column in the same release breaks the old tasks. So: release N adds the new column and dual-writes; release N+1 backfills and switches reads; release N+2 drops the old column. Slower, and the only approach that survives zero-downtime deploys.

**Feature flags** (with a kill-switch per AI provider, per template family, and per queue) let risky changes ship dark and be disabled in seconds without a deploy — which is also the rollback mechanism for prompt regressions (§8.5).

### 16.3 Disaster recovery

| Scenario | RTO | RPO | Procedure |
|---|---|---|---|
| AZ failure | ~2 min | 0 | RDS/ElastiCache Multi-AZ automatic failover; Fargate reschedules |
| Accidental data deletion | 1h | 5 min | RDS PITR restore to a new instance, verify, cut over |
| Region failure | 8h | 24h | Documented rebuild from IaC + cross-region backups (accepted: no warm standby in v1) |
| Redis loss | 15 min | jobs in flight | Queue AOF-persisted; outbox relay replays unpublished rows — no user work is lost |
| Provider outage | 0 | 0 | Router failover; editor and export remain fully functional (§19) |

Quarterly restore drills are mandatory; an untested backup is not a backup.

---

## 17. Cost Optimization

### 17.1 Cost per carousel (target: ≤$0.12, PRD NFR-CO1)

| Component | Naive | Optimized | Technique |
|---|---|---|---|
| Planning call (frontier) | $0.045 | $0.028 | Prompt caching on the stable system prefix; tightened output budget |
| Copy calls (frontier) | $0.060 | $0.030 | Batch slides per call instead of one call per slide; cached prefix |
| Captions/classification | $0.012 | $0.002 | Routed to small/fast models (§8.2) |
| Long-source intake | $0.020 | $0.006 | Routed to cheap long-context model; pre-truncate to relevant sections |
| Render compute | $0.008 | $0.005 | ARM Fargate + Spot; ~40% render-cache hit rate |
| Storage | $0.002 | $0.0006 | Lifecycle to Intelligent-Tiering/Glacier; renders deleted at 90d |
| CDN egress | $0.001 | $0.0004 | WebP transcode, long cache TTLs, compression |
| **Total** | **$0.148** | **$0.072** | **~51% reduction** |

An optional AI image adds $0.01–$0.04 depending on provider — hence separate metering at 0.5 credits/image.

### 17.2 The four techniques that matter most

1. **Model tiering (≈45% of AI spend).** Routing captions, classification, and inline edits to small models costs nothing in quality and cuts spend nearly in half. The discipline is to *measure* which tasks are quality-sensitive rather than defaulting everything to frontier models.
2. **Prompt caching (≈25%).** System instructions, template slot definitions, and brand-voice context are stable across calls and constitute the majority of input tokens. Structuring prompts so the stable prefix comes first makes them cacheable by the vendor at a large discount — and also cuts latency.
3. **Render cache (≈40% of render compute).** Content-hash keying (§11.2).
4. **Batching copy generation.** One call producing 4 slides instead of 4 calls producing 1 each removes 3× the repeated system-prompt input tokens and 3× the per-call latency overhead.

### 17.3 Infrastructure cost at 10,000 MAU

| Item | Configuration | Est. $/month |
|---|---|---|
| Vercel | Pro + bandwidth | 60 |
| ECS Fargate — API | 3 × 1 vCPU / 2 GB, ARM, Savings Plan | 65 |
| ECS Fargate — ai-worker | avg 2 × 0.5 vCPU / 1 GB | 25 |
| ECS Fargate — render-worker | avg 2 × 2 vCPU / 4 GB, **Spot** | 70 |
| RDS PostgreSQL | r7g.large Multi-AZ, reserved | 210 |
| ElastiCache Redis | r7g.large, Multi-AZ | 130 |
| S3 + CloudFront | ~600 GB stored, ~400 GB egress | 55 |
| NAT Gateway | (or VPC endpoints — see below) | 35 |
| Observability | Sentry + OTel backend + PostHog | 120 |
| Clerk / Stripe (fixed) | — | 60 |
| **Infrastructure subtotal** | | **≈ $830** |
| **AI spend** | 34,000 generations × $0.072 | **≈ $2,450** |
| **Total COGS** | | **≈ $3,280** |

Against ~$14K MRR at that scale (500 paying × ~$28), that is **≈77% gross margin** — at the PRD's ≥78% target, with the render cache and tiering doing most of the work. The sensitivity is clear: **free-tier generation volume is the margin risk**, which is exactly why credits are capped at 5/month on Free and why the daily spend ceiling exists.

### 17.4 Ongoing cost controls

| Control | Mechanism |
|---|---|
| Per-generation cost ceiling | Router aborts and fails cleanly (uncharged) above a threshold |
| Per-workspace daily spend cap | Hard stop; alerts before the wall |
| Cost regression alarm | Page when rolling cost/generation exceeds $0.20 |
| Spot for render workers | ~65% cheaper; interruption-safe because jobs are idempotent and requeue |
| ARM64 everywhere | ~20% better price/performance on Fargate and RDS |
| Savings Plans / Reserved Instances | After 3 months of stable baseline — not before |
| VPC endpoints for S3/ECR | Removes NAT data-processing charges, which quietly become significant at render volume |
| S3 lifecycle | Renders deleted at 90d (regenerable); exports tiered by plan |
| Log sampling | 100% errors, 10% info in production |
| Monthly cost review | Cost per generation, per workspace, and per plan tier reviewed against the model |

---

## 18. Architecture Decision Records

| ADR | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| 001 | Modular monolith (NestJS), three deployables | Microservices | A 2–4 person team cannot operate a distributed system. Module boundaries are enforced in code; extraction stays cheap if ever needed. |
| 002 | Postgres for everything relational | Mongo, DynamoDB | Relational data with strong transactional needs (billing). JSONB covers the flexible parts without giving up ACID. |
| 003 | BullMQ on Redis | SQS, Temporal, Inngest | Redis is already required; BullMQ gives flows, priorities, group rate limiting, and delays in one library. Revisit Temporal if workflows become genuinely long-lived and multi-step. |
| 004 | Transactional outbox for job enqueue | Direct `queue.add()` | Eliminates the dual-write failure that either loses jobs or charges for work never done (D6). |
| 005 | Render via headless Chromium against the Next.js app | Canvas/Satori/server-side image libs | Only approach that guarantees preview ≡ export with a single template implementation (D2). Cost is CPU, mitigated by caching. |
| 006 | RLS in addition to app-layer scoping | App-layer only | The realistic bug is a forgotten `WHERE workspace_id`. RLS turns a breach into an empty result set (D3). |
| 007 | Provider-agnostic AI gateway from day one | Direct SDK calls, add abstraction later | Retrofitting an abstraction across a codebase already coupled to one vendor is expensive; the interface cost now is one file (D4). |
| 008 | Clerk for identity | Build auth, Auth.js from the start | Orgs/invitations/MFA out of the box; auth is undifferentiated work. `PrincipalResolver` keeps Auth.js as a documented exit. |
| 009 | REST + SSE | GraphQL, WebSockets | Known access patterns; SSE is simpler than WebSockets for one-directional progress and works through every proxy. |
| 010 | Separate ai-worker and render-worker pools | One pool | Radically different resource profiles and scaling signals; sharing means one starves the other (D5). |
| 011 | Content-hash render caching | Time-based or no caching | Largest single lever on render cost and export latency. |
| 012 | Vercel for web, AWS for API/workers | All-AWS, all-Vercel | Vercel is materially better for Next.js; long-running Chromium and BullMQ workers need real containers. The split costs one CORS boundary. |

---

## 19. Failure Modes & Degradation

The product must degrade along its value chain, never fail wholesale. Explicit behavior for each dependency:

| Failure | Blast radius | Behavior |
|---|---|---|
| One LLM provider down | Generation only | Router fails over to a quality-peer provider; user sees nothing. Logged as degradation. |
| **All** LLM providers down | New generation only | Editor, library, and export stay fully functional. Generation returns a clear, honest error; **no credit charged**; retry CTA. |
| Image provider down | Image slides | Degrade to curated stock/gradient background; deck completes. |
| Redis down | Queues + cache | API serves cached-cold (DB fallback) reads and stays up for browsing/editing; new jobs are held in the outbox and drain automatically on recovery. **No work is lost.** |
| Postgres primary down | Everything writeable | Multi-AZ failover ~1–2 min. Read-only degraded mode serves library and cached data. |
| S3 unavailable | Export delivery | Renders retry with backoff; already-delivered CloudFront URLs keep working. |
| Render workers saturated | Export latency | Queue absorbs the spike; user sees an honest position/ETA rather than a spinner. Autoscaling responds within ~90s. |
| Clerk outage | New logins | Existing sessions continue until JWT expiry (verification uses cached JWKS). New sign-ins fail with a status message. |
| Stripe webhook delay | Plan upgrades | Checkout succeeds; entitlement applies on webhook arrival. A reconciliation job sweeps every 15 min to catch missed events. |
| Poison job | One queue | 3 attempts → DLQ → page. Credit refunded automatically. |

The recurring principle: **never charge for work not delivered, never lose user content, and always tell the truth about what failed.**

---

## 20. Appendices

### 20.A End-to-end sequence — "generate a carousel"

```
Browser        Next.js        API (NestJS)      Postgres    Outbox/BullMQ   ai-worker    render-worker    S3
  │ prompt         │               │                │            │              │              │           │
  ├───POST /v1/generations (Bearer JWT, Idempotency-Key)─────────▶│            │              │           │
  │               │               ├─ verify JWT (JWKS cache)      │            │              │           │
  │               │               ├─ WorkspaceGuard (role+plan)   │            │              │           │
  │               │               ├─ BEGIN; SET LOCAL app.workspace_id         │              │           │
  │               │               ├─ reserve credits (FOR UPDATE) ▶            │              │           │
  │               │               ├─ insert project, generation  ▶│            │              │           │
  │               │               ├─ insert outbox row           ▶│            │              │           │
  │               │               └─ COMMIT                       │            │              │           │
  │◀──202 { generationId, streamUrl }──────────────────────────────            │              │           │
  ├───GET /stream (SSE)───────────▶│  subscribe redis: sse:{id}   │            │              │           │
  │               │               │                │  relay ──enqueue──▶       │              │           │
  │               │               │                │            │  ├─ safety pre-check        │           │
  │               │               │                │            │  ├─ PLAN (Claude, schema)   │           │
  │◀══ event: outline ═════════════════════════════════════════════┤              │           │
  │               │               │                │            │  ├─ COPY ×3 parallel        │           │
  │◀══ event: slide × N ═══════════════════════════════════════════┤              │           │
  │               │               │                │            │  ├─ validate + auto-fit     │           │
  │               │               │                │            │  ├─ captions (small model)  │           │
  │               │               │                │            │  ├─ safety post-check       │           │
  │               │               │                │◀─ persist slides + content_hash          │           │
  │               │               │                │            │  └─ flow: child render jobs ▶           │
  │               │               │                │            │              │  ├ cache lookup ────────▶│
  │               │               │                │            │              │  ├ Chromium → /render    │
  │               │               │                │            │              │  ├ screenshot @2×        │
  │               │               │                │            │              │  └ putObject ──────────▶│
  │◀══ event: rendered (previewUrl × N) ═══════════════════════════════════════════┤                     │
  │               │               │                │◀─ commit reservation (status='committed')            │
  │◀══ event: done { projectId } ══════════════════════════════════════════════════┤                     │
```

### 20.B Technology summary

| Concern | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript 5, TailwindCSS, shadcn/ui, TanStack Query, Zustand |
| Backend | NestJS 11 (Fastify adapter), Node 22, TypeScript |
| Validation | Zod (`packages/contracts`) → generated OpenAPI 3.1 |
| Database | PostgreSQL 16 (RDS Multi-AZ), Drizzle ORM, PgBouncer, RLS |
| Queue | Redis 7 (ElastiCache) + BullMQ (flows, groups, priorities) |
| Storage | AWS S3 (5 buckets) + CloudFront (OAC) |
| Auth | Clerk (Organizations = workspaces); Auth.js as documented fallback |
| Payments | Stripe (Checkout, Billing, Portal, Tax) |
| AI — text | OpenAI · Anthropic Claude · Google Gemini, behind a routing gateway |
| AI — images | OpenAI Images · FLUX |
| Rendering | Playwright + Chromium (pinned), Sharp |
| Compute | AWS ECS Fargate (ARM64; Spot for render workers), Vercel for web |
| IaC | Terraform |
| CI/CD | GitHub Actions, ECR, rolling deploys with auto-rollback |
| Observability | OpenTelemetry, CloudWatch, Sentry, PostHog |
| Email | AWS SES (transactional) |

### 20.C Glossary

| Term | Meaning |
|---|---|
| **Auto-fit cascade** | Deterministic 5-step sequence guaranteeing text fits its slot without silent meaning loss (§9.2) |
| **Content hash** | SHA-256 of everything affecting a slide's pixels; the render cache key (§11.2) |
| **Outbox** | Table written inside the business transaction and relayed to BullMQ, making enqueue atomic with the state change (§5.4) |
| **Quality-peer failover** | Fallback only to models in the same quality class; never silently downgrade output quality (§8.2) |
| **Reserve → commit/refund** | Two-phase credit accounting so failed work is never charged (§5.4) |
| **RLS** | PostgreSQL Row-Level Security; the backstop for tenant isolation (§7.3) |
| **Render key / render cache** | Content-addressed S3 cache of rendered slides (§11.2) |

---

*End of document.*
