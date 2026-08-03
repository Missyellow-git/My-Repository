# Architecture

## 1. Shape of the system

```
                    ┌──────────────────────────────┐
   Browser  ───────►│  Next.js 14 (App Router)     │
                    │  TanStack Query, Tailwind    │
                    └──────────────┬───────────────┘
                                   │ REST + JSON, typed by @fundlens/shared
                    ┌──────────────▼───────────────┐
                    │  NestJS API (stateless, xN)  │
                    │  ┌────────────────────────┐  │
                    │  │ funds · holdings ·     │  │
                    │  │ prices · analytics ·   │  │
                    │  │ ai · export · auth     │  │
                    │  └───────────┬────────────┘  │
                    └──────┬───────┼───────┬───────┘
                           │       │       │
              ┌────────────▼─┐ ┌───▼────┐ ┌▼─────────────────────┐
              │ PostgreSQL 16│ │ Redis 7│ │ Provider adapters    │
              │ (Prisma)     │ │ cache  │ │ · market data        │
              │              │ │ queues │ │ · disclosures        │
              └──────────────┘ │ locks  │ │ · AMFI scheme master │
                               └───┬────┘ │ · Anthropic          │
                                   │      └──────────────────────┘
                        ┌──────────▼──────────┐
                        │ BullMQ workers      │
                        │ price refresh 60s   │
                        │ disclosure sync 03h │
                        │ scheme master 22:30 │
                        │ metadata + bars 02h │
                        └─────────────────────┘
```

Three workspaces: `packages/shared` (types, DTO schemas, the AI query DSL, cache keys),
`apps/api`, `apps/web`. Both apps import the shared package, so a payload change breaks the
build on both sides rather than surfacing as `undefined` in a table cell.

---

## 2. The central design decision: split the read path

A holdings row is two things glued together:

- **the disclosed position** — changes once a month, immutable once published;
- **the price** — changes every few seconds.

Caching the joined result would force one TTL onto both and be wrong for one of them. So
they are fetched, cached and invalidated separately, and joined per request in application
code:

```
GET /funds/:id/holdings
  ├─ loadStatic(fundId, date)      → Redis 6h  (snapshot is immutable)
  │    miss → Postgres, one indexed query
  └─ prices.getQuotes(stockIds)    → Redis 45s
       miss → stock_prices table
       miss → provider (only when explicitly allowed)
  └─ join in memory, compute derived fields, attach coverage metadata
```

Two consequences worth stating:

**The dashboard read never calls the price vendor synchronously.** `allowSyncFetch` is
`false` for the holdings path. A cold cache degrades the freshness badge; it does not add a
vendor round trip to the user's page load. The background refresh job catches up within a
minute. That keeps p99 flat when the vendor is slow — the correct trade for a holdings
dashboard, and one the UI discloses rather than hides.

**Analytics are cached at the same 60s as prices**, not longer. Serving analytics computed
from prices older than the prices displayed beside them would be internally inconsistent.

---

## 3. Provider adapters

Every external dependency sits behind an interface bound by a DI token. Nothing in the
domain layer imports a concrete provider.

| Token | Interface | Implementations |
| --- | --- | --- |
| `MARKET_DATA_PROVIDER` | `fetchQuotes`, `healthCheck` | `SimulatedMarketDataProvider`, `HttpMarketDataProvider` |
| `DISCLOSURE_PROVIDER` | `fetchLatest` | `FixtureDisclosureProvider`, `AmcDisclosureProvider` |

Switching from the simulated feed to a licensed vendor is two environment variables. See
[DATA-SOURCES.md](DATA-SOURCES.md) for what is and is not bundled, and why.

### Disclosure ingestion

```
provider.fetchLatest(since)
  → resolveFund()            scheme code, else exact normalised name (never fuzzy)
  → checksum vs stored       unchanged? stop here
  → validate weight sum      |Σw − 100| ≤ 2, else FAILED, previous snapshot keeps serving
  → mapMany()                ISIN → alias → exact name → trigram+token fuzzy
  → validate mapping ratio   ≥50% of equity weight mapped, else FAILED
  → transaction: upsert snapshot, replace holdings, publish, supersede stragglers
  → learnAlias()             confirmed spellings short-circuit the next import
  → invalidate caches
```

Scheme resolution is **exact-only on names**. A fuzzy scheme match would happily attach a
Small Cap fund's holdings to the same AMC's Mid Cap fund, and unlike a mis-mapped stock that
error is invisible to the user.

Instrument mapping is tiered and refuses to guess: a fuzzy match must clear 0.72 *and* beat
the runner-up by 0.08, otherwise the line stays unmapped and is reported. Showing a hole is
correct; attaching a 4% position to a similarly named company is not.

---

## 4. Caching

| Key | TTL | Invalidated by |
| --- | --- | --- |
| `fund:search:{q}:{limit}:…` | 5 min | scheme master sync (pattern delete) |
| `fund:detail:{id}` | 15 min | scheme master sync, disclosure import |
| `fund:latest-snapshot:{id}` | 1 h | disclosure import |
| `snapshot:holdings:{id}` | 6 h | disclosure import (republish only) |
| `quote:{nseSymbol}` | 45 s | natural expiry (< staleness threshold, enforced at boot) |
| `analytics:{snapshotId}` | 60 s | natural expiry |
| `ai:insights:{snapshotId}:{bucket}` | 10 min | bucketed key rotates itself |

Rules the code enforces:

- **Redis is an optimisation, never a dependency.** `enableOfflineQueue: false`, every
  method catches and degrades to a miss. A Redis outage is slower, not broken.
- **Only fresh quotes are re-warmed into Redis** from Postgres. Caching a stale row would
  keep it alive past its own expiry window.
- **`SCAN`, never `KEYS`** for pattern deletes. `KEYS` blocks the Redis event loop across
  the whole keyspace — on a warm cache that is a multi-second stall for every in-flight
  request.
- **The refresh interval must be below the staleness threshold**, checked in
  `configuration.ts` at boot. Otherwise the UI would show a "live" badge over data the
  system itself considers stale.

---

## 5. Rate limiting and provider spend

Market-data licences are priced and enforced **per account**, not per process. Counting in
memory would let N replicas each spend the full quota and breach the contract.

`RateLimiterService` is a Redis-backed token bucket implemented as a single Lua script, so
check-and-consume is atomic across replicas. It **fails closed**: if Redis is unreachable
the call is denied and cached quotes are served, because exceeding a licensed rate has
contractual consequences while a briefly stale price does not.

The price-refresh job additionally takes a 55-second Redis lock, so exactly one replica
refreshes per cycle. The short TTL means a replica dying mid-refresh costs one cycle rather
than stalling the schedule.

---

## 6. Background jobs

BullMQ repeatable jobs, registered in Redis rather than in an in-process cron — a
process-local cron fires N times per interval on N replicas.

| Job | Cadence | Notes |
| --- | --- | --- |
| `price-refresh` | every 60s | Skips outside market hours and exchange holidays; evaluates price alerts immediately after, using the prices it just stored |
| `disclosure-sync` | 03:00 IST | Incremental from the last successful run; 30-minute lock |
| `scheme-master-sync` | 22:30 IST | AMFI import; flushes search and detail caches |
| `stock-metadata-sync` | 02:00 IST | Closes daily bars (feeds the 52-week average), reclassifies market-cap buckets, prunes expired tokens and 90-day-old provider logs |

Registration is idempotent — stale repeatable definitions are removed first, so changing an
interval does not leave the old schedule running alongside the new one.

Every job wraps itself in `JobRunService.track`, which writes a `sync_job_runs` row with
status, duration and counters. Scheduled work that fails silently is how a data product goes
quietly wrong.

---

## 7. The AI subsystem

```
question
   │
   ├─► parseQuestion()          deterministic rules, ~0ms, no cost
   │      hit → QuerySpec
   │      miss ↓
   ├─► LlmService.planQuery()   forced tool call, Zod-validated
   │      invalid or failed → UnsupportedQuestionException with examples
   │
   ├─► executeQuery(spec, holdings)      ← every number is computed HERE
   │
   └─► LlmService.narrate(computedFacts) optional prose over finished figures
```

Rules first, model second, is a cost, latency and determinism decision — the phrasings users
actually type are handled locally in microseconds, and the model is spent on the long tail.
Either path produces the same schema, executed by the same code, so answers are identical
whichever planned them.

**The model never emits a figure.** It selects filters, a sort and a limit from a closed
field list. `executeQuery` is pure synchronous code with no I/O, which is also why the whole
question-answering surface is unit-testable without a database.

Null handling in the executor is the subtle part: a holding with no quote fails *every*
comparison, including `neq`. "Sector is not Banks" must not surface a holding whose sector we
simply do not know, and nulls sort last in both directions so an unknown is never "the top
answer".

---

## 8. Error handling

One global filter turns exceptions into HTTP responses, enforcing two rules:

1. **Internal details never reach the client.** Prisma messages leak schema and sometimes
   data; they are logged in full and replaced with a generic body.
2. **Every response carries the request id**, so a user-reported error maps to an exact log
   line without guessing.

Errors carry a stable `code` (`FUND_NOT_FOUND`, `DISCLOSURE_STALE`,
`PRICE_FEED_UNAVAILABLE`, …). Clients branch on the code; message text is free to change.

Degradation is graded rather than binary:

| Failure | Behaviour |
| --- | --- |
| Price vendor down | Holdings render; `quote: null`, coverage reports the gap, badges show `UNAVAILABLE` |
| Vendor rate limited | Cached quotes served, marked `DELAYED`/`STALE`; refresh skipped, not queued |
| Redis down | All reads fall through to Postgres; rate-limited calls fail closed |
| No disclosure for a scheme | `DISCLOSURE_NOT_FOUND`, distinct from `FUND_NOT_FOUND` |
| Disclosure parse fails validation | Snapshot marked `FAILED`; previous snapshot keeps serving |
| LLM down or unconfigured | Rule parser answers; narrative omitted; `resolvedBy` says which |

---

## 9. Authentication

Accounts are optional — search, holdings, analytics and the assistant all work signed out.

- Access tokens: JWT, 15 minutes, verified against the DB on each request so a deactivated
  account loses access immediately rather than at token expiry.
- Refresh tokens: opaque 256-bit random values stored as SHA-256 hashes. A database leak
  cannot be replayed into live sessions. Rotation on every use revokes the presented token,
  so theft becomes a detectable double-use.
- Login failures are indistinguishable between "no such user" and "wrong password", and both
  paths perform a bcrypt comparison so timing does not leak either.
- `OptionalJwtAuthGuard` identifies a caller when a token is present without requiring one —
  used on the AI endpoint so a signed-in user gets their own rate-limit budget instead of
  sharing one per IP.

**Known trade-off:** the web client stores the access token in `localStorage`. That is
acceptable here because accounts hold only favourites and watchlists and the app is a pure
SPA against a cross-origin API. A deployment that puts anything sensitive behind an account
should move to httpOnly `SameSite` cookies with a same-site API origin.

---

## 10. Scaling

**Read path.** Stateless API replicas behind a load balancer. Every hot read is
cache-first; the uncached path is a single indexed query. Session state lives in Redis
(rate limits, locks) and Postgres (refresh tokens), so replicas are interchangeable.

**Write path.** Almost nothing. Disclosure imports are monthly per scheme; price writes are
one bulk upsert per refresh cycle for the whole cluster.

**The database.** `holdings` is the growth table: instruments × schemes × months. Index-only
scans are served by the covering index on `(snapshotId, weightPct DESC)`. When history
outgrows a single node, `portfolio_snapshots` and `holdings` partition cleanly by
`disclosureDate` — reads are always scoped to one snapshot.

**Where it would break first, and the fix:**

1. *Fan-out on a popular fund at market open.* Many replicas miss the same cold analytics
   key simultaneously. Fix: single-flight around `analytics:*`, or pre-warm the top N funds
   in the refresh job.
2. *Market-data quota, not compute.* More users cost nothing extra — the refresh job's
   universe is the set of *held* stocks, not the set of viewers. Scaling users is free;
   scaling *schemes with disclosures* is what raises the quota bill.
3. *Search under a very long tail of typos.* Trigram search is fast but not free. Fix:
   materialise a search view, or move to a dedicated search index.

---

## 11. Security

- Environment validated once at boot; the process refuses to start on a bad value, and
  refuses placeholder JWT secrets in production
- Secrets read from the environment only, never logged; helmet on all responses
- Zod validation on every inbound payload, with coercion, so handlers receive typed data
- Global throttling plus tighter per-endpoint budgets on auth (5–10/min) and AI (20/min)
- Parameterised queries throughout; the two raw SQL queries take bound parameters
- CSV injection defence on export — a company name beginning with `=` is prefixed so Excel
  does not execute it as a formula
- Ownership always enforced in the `WHERE` clause, never inferred from a path parameter, so
  guessing an id yields a 404 rather than someone else's data
- `audit_logs` records registration, login success and failure, and refresh rejection;
  `api_call_logs` records every outbound third-party call for billing and incident evidence
- Containers run as a non-root user with `dumb-init` as PID 1 so SIGTERM reaches Node and
  shutdown hooks actually drain connections
