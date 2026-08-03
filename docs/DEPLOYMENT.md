# Deployment

---

## 1. Images

Both Dockerfiles build from the **repository root**, because each app depends on the
`@fundlens/shared` workspace.

```bash
docker build -f apps/api/Dockerfile -t fundlens-api:$(git rev-parse --short HEAD) .
docker build -f apps/web/Dockerfile -t fundlens-web:$(git rev-parse --short HEAD) \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com/api/v1 .
```

Both are multi-stage: the runtime layer carries no compiler, no dev dependencies and no
source. Both run as a non-root user with `dumb-init` as PID 1 — without correct PID 1 signal
handling, SIGTERM never reaches Node and Nest's shutdown hooks never drain the Prisma and
BullMQ connections.

The API image ships `prisma/` so `migrate deploy` can run as a release step **from the exact
artefact being deployed**, not from a developer's checkout.

### Build-time configuration

`NEXT_PUBLIC_*` values are **inlined at build time**, not read at runtime. The web image is
therefore environment-specific: deploying to staging and production means two builds. This
is a Next.js constraint, called out here because it surprises people who expect to swap an
env var on the running container.

---

## 2. Configuration

Everything comes from the environment and is validated once at boot. The process **refuses
to start** on a missing or malformed value — a mistyped rate limit must fail at deploy time,
not silently at 2am under load.

Production-only rules enforced in `configuration.ts`:

- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` must not contain `change-me`
- `ANTHROPIC_API_KEY` is required when `AI_ENABLED=true`
- `MARKET_DATA_BASE_URL` is required when `MARKET_DATA_PROVIDER=http`
- `PRICE_REFRESH_INTERVAL_SECONDS` must be below `PRICE_STALE_AFTER_SECONDS`

Secrets belong in a secret manager (AWS Secrets Manager, GCP Secret Manager, Vault), injected
as environment variables at start. Never in the image, never in the repository. Nothing in
`configuration.ts` is logged, and the logger redacts keys ending in
`SECRET`/`KEY`/`TOKEN`/`PASSWORD`.

Generate secrets with:

```bash
openssl rand -base64 48
```

---

## 3. Release procedure

```bash
# 1. Migrate, using the image you are about to deploy.
docker run --rm -e DATABASE_URL="$DATABASE_URL" fundlens-api:$SHA \
  npx prisma migrate deploy --schema prisma/schema.prisma

# 2. Roll the API (rolling update; readiness gates traffic).
kubectl set image deploy/fundlens-api api=fundlens-api:$SHA

# 3. Roll the web app.
kubectl set image deploy/fundlens-web web=fundlens-web:$SHA
```

**Migrations run before the new code, and must be backward compatible with the old code** —
during a rolling update both versions are live. Additive changes only in one release; drop
columns in a later one.

**First deployment to a fresh database** additionally needs the generated table migration.
Run `npx prisma migrate dev --name init` locally, commit the result, then deploy — see
[DATABASE.md#migrations](DATABASE.md#migrations) for why it is generated rather than shipped.

---

## 4. Topology

```
              ┌──────────────┐
   Internet ──►  CDN / WAF   │
              └──┬────────┬──┘
                 │        │
        ┌────────▼──┐  ┌──▼──────────┐
        │ web (xN)  │  │ api (xN)    │  stateless, HPA on CPU + p95 latency
        └───────────┘  └──┬───────┬──┘
                          │       │
              ┌───────────▼─┐  ┌──▼──────────────┐
              │ Postgres 16 │  │ Redis 7         │
              │ primary +   │  │ cache + queues  │
              │ read replica│  │ AOF on          │
              └─────────────┘  └─────────────────┘
```

**Sizing to start:** 2–3 API replicas (0.5 vCPU / 1GB each), 2 web replicas (0.25 vCPU /
512MB), Postgres 2 vCPU / 8GB with 100GB storage, Redis 1GB with `allkeys-lru`.

**Background jobs.** Every API replica runs the BullMQ workers, and that is safe — repeatable
jobs are deduplicated cluster-wide by Redis, and the price refresh additionally takes a
55-second lock so exactly one replica refreshes per cycle. To separate them, run a deployment
with `ENABLE_BACKGROUND_JOBS=false` for the API tier and `true` for a single worker tier.

**Redis persistence.** The cache is disposable but the BullMQ queues are not — losing them
loses the repeatable-job registry until the next boot re-registers it. Enable AOF in
production; the compose file disables it deliberately for local development.

---

## 5. Probes

| Probe | Path | Rationale |
| --- | --- | --- |
| Liveness | `GET /health` | No dependencies. Wiring a restart probe to a third-party price feed turns a vendor outage into a crash loop |
| Readiness | `GET /health/ready` | Postgres and Redis. Redis alone reports `degraded: true` and stays ready — every cache path falls through to Postgres |

```yaml
livenessProbe:
  httpGet: { path: /health, port: 4000 }
  initialDelaySeconds: 20
  periodSeconds: 30
readinessProbe:
  httpGet: { path: /health/ready, port: 4000 }
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3
```

Set `terminationGracePeriodSeconds: 30` so in-flight requests and job handlers finish.

---

## 6. CI/CD

`.github/workflows/ci.yml`, four jobs:

| Job | Does |
| --- | --- |
| `quality` | Install → build shared → generate Prisma client → format check → typecheck → unit tests → upload coverage |
| `build` | Builds API and web bundles |
| `integration` | Real Postgres + Redis: migrate, seed, boot the API, smoke every public endpoint |
| `docker` | Builds both images with GHA layer cache |

Concurrency is grouped by ref with `cancel-in-progress`, so a new push supersedes the run in
flight.

**To add deployment**, append a job gated on `github.ref == 'refs/heads/main'` that pushes
the images to your registry and runs §3. Deploy credentials belong in GitHub Environments
with required reviewers, not in repository secrets.

---

## 7. Observability

**Logs.** Structured, one line per event, with `requestId` on every request-scoped line and
in every error response — a user-reported error maps to an exact log line without guessing.
Queries slower than 200ms are logged with their SQL.

**Provider audit.** `api_call_logs` records every outbound third-party call: provider,
endpoint, HTTP status, outcome, latency, item count. Market-data contracts are billed and
audited per call, and provider incidents are argued from records rather than recollection.
`GET /health/providers` surfaces rolling success rates and latencies.

**Job runs.** `sync_job_runs` records every scheduled execution with status, duration and
counters.

**Alert on:**

| Signal | Threshold |
| --- | --- |
| No successful `price-refresh` during market hours | > 5 minutes |
| No successful `scheme-master-sync` | > 36 hours |
| Market-data success rate | < 95% over 15 minutes |
| 5xx rate | > 1% over 5 minutes |
| p95 `/funds/:id/holdings` | > 1s |
| Cache hit rate | < 70% |
| Disclosure snapshots with status `FAILED` | any, in the last 24h |

---

## 8. Runbook

**Prices are stale across the board.** Check `/health/providers`. If `successRate` is low the
vendor is failing — holdings still render, and quality badges already tell users. If it is
`rate_limited`, `MARKET_DATA_RATE_LIMIT_PER_MIN` is above the contract or the universe of
held stocks has grown past the quota. If the provider is fine, check `sync_job_runs` for
`price-refresh` and whether the Redis lock is stuck (it expires in 55s; a permanently held
lock means Redis is unreachable and the limiter is failing closed by design).

**A scheme shows no holdings.** Expected when the scheme is in the AMFI master but no
disclosure has been ingested — the API returns `DISCLOSURE_NOT_FOUND` and the UI says so.
Confirm with `GET /funds/:id/periods`. If a period should exist, check `sync_job_runs` for
`disclosure-sync` and look for a `FAILED` snapshot; `parseWarnings` carries the reason.

**A disclosure imported but half the holdings are unmapped.** The stock master is missing
those companies, or their names changed. Add them to `stocks`, then re-run the import — the
alias table will learn the spellings and subsequent imports resolve at tier 2. Note the
import refuses to publish below 50% mapped equity weight, so a very bad parse never reaches
users.

**Redis is down.** The app degrades: all reads fall through to Postgres, rate-limited
outbound calls fail closed (cached quotes serve), and background jobs stop scheduling.
Restore Redis; repeatable jobs re-register on the next API boot.

**Rolling back.** Redeploy the previous image tag. Do **not** roll migrations back
automatically — write a forward migration instead. Because disclosures are immutable and
prices are overwritten in place, application rollback is safe on its own.
