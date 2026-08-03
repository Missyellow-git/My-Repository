# FundLens

**Live portfolio X-ray for Indian mutual fund schemes.**

Search any Indian mutual fund by name and instantly see its latest disclosed portfolio —
every stock, its weight, its NSE/BSE symbols, and its current market price — with sector
analytics, concentration metrics, month-on-month change tracking, and a natural-language
assistant that answers questions about the portfolio.

Users never upload anything. They type a scheme name; the system resolves it, fetches the
latest disclosure, maps every instrument to a listed security, joins market prices, and
renders the dashboard.

---

## Contents

| Document | What it covers |
| --- | --- |
| [docs/PRD.md](docs/PRD.md) | Product requirements, personas, scope, success metrics |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, caching, scaling, trade-offs |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema, indexing strategy, migrations, query patterns |
| [docs/API.md](docs/API.md) | Endpoint reference, error codes, rate limits |
| [docs/UI.md](docs/UI.md) | Wireframes, component hierarchy, interaction and a11y notes |
| [docs/TESTING.md](docs/TESTING.md) | Testing strategy and what is deliberately not tested |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker, CI/CD, production rollout, runbook |
| [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) | **Read this first** — where data comes from, and what is not shipped |

---

## Read this before evaluating the running app

This repository contains a complete, working implementation. Two data sources are
**pluggable adapters rather than bundled feeds**, and this is a legal and licensing
constraint, not an incomplete feature:

1. **Real-time NSE/BSE prices require a licensed market-data vendor.** Exchange feeds
   cannot be redistributed in a public repository, and scraping the exchanges' websites
   violates their terms of use. The `http` provider adapter is written and ready
   (`apps/api/src/providers/market-data/http.provider.ts`); point it at your vendor with
   two environment variables. Out of the box the app runs a **clearly labelled simulated
   feed** so every downstream feature is fully exercisable.

2. **Portfolio disclosures need a source decision.** Every AMC publishes month-end
   portfolios, but in per-AMC formats at per-AMC URLs under per-AMC terms. The generic
   workbook parser and the AMC adapter registry are implemented; the registry ships empty
   so that nothing starts fetching a third party's servers the moment you run
   `docker compose up`. Development uses clearly-labelled synthetic sample schemes.

The **AMFI scheme master is real and public**, and the sync job against it is live — that
is what makes "search any Indian mutual fund" true rather than aspirational.

See [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) for the full picture and for how to wire
production sources.

---

## Quick start

### With Docker (everything, one command)

```bash
cp .env.example .env
# Generate real secrets — the API refuses to start in production with placeholders.
sed -i "s|change-me-access-secret-at-least-32-chars-long|$(openssl rand -base64 48)|" .env
sed -i "s|change-me-refresh-secret-at-least-32-chars-long|$(openssl rand -base64 48)|" .env

docker compose up -d --build
```

- Web app → <http://localhost:3000>
- API docs (Swagger) → <http://localhost:4000/api/docs>
- Health → <http://localhost:4000/health>

The `migrate` service applies migrations and seeds sample data before the API starts.

### Local development

```bash
npm install
npm run build:shared                 # the shared contracts package builds first

# Postgres + Redis only
docker compose up -d postgres redis

cd apps/api
cp ../../.env.example .env
npx prisma migrate dev --name init   # generates the table migration from schema.prisma
npm run db:seed

cd ../..
npm run dev                          # API on :4000, web on :3000
```

`prisma migrate dev --name init` is required once on a fresh database: the repository
ships the hand-written search-index migration (trigram indexes, partial and covering
indexes) but generates the table migration locally so it matches your Prisma version. See
[docs/DATABASE.md#migrations](docs/DATABASE.md#migrations).

---

## What is implemented

**Search and holdings**
- Fuzzy scheme search over the AMFI master (trigram similarity, typo tolerant)
- Latest and historical disclosed holdings, joined with live quotes
- Every disclosure line mapped to a listed security via a tiered ISIN → alias → exact →
  fuzzy matcher that refuses to guess when ambiguous
- Sortable, filterable, searchable holdings table (weight, sector, price, change, market cap)

**Analytics**
- Total stocks, top 10 concentration, highest/lowest weighted holding
- Sector and market-cap allocation with per-sector weighted moves
- Top gainers and losers, advance/decline breadth
- Average and weight-adjusted daily change, Herfindahl concentration index
- Per-holding contribution (weight × move) — "compare today's movement with weight"
- Period-over-period comparison: additions, exits, weight changes, sector shift, turnover
- Cross-scheme overlap using Σ min(weightA, weightB)

**AI assistant**
- Deterministic rule parser handles the common question set with no LLM and no cost
- Anthropic-backed planner for the long tail, emitting a schema-validated query DSL
- **The model never produces figures.** It selects filters; the server computes every number
- Factual answer and AI narrative are separate fields, separately labelled in the UI
- Intraday insights with computed facts alongside generated commentary

**Platform**
- Redis caching with per-entity TTLs and explicit invalidation on import
- Distributed token-bucket rate limiting sized to your market-data licence
- BullMQ background jobs: price refresh (market-hours aware), disclosure sync, scheme
  master sync, nightly metadata and daily-bar close
- JWT auth with rotating hashed refresh tokens; favourites, watchlists, alerts, preferences
- CSV and Excel export with a provenance header block
- Structured errors with stable codes, request-id correlation, provider call audit log
- 127 unit tests over the maths, parsers, mappers and query engine

---

## Repository layout

```
apps/
  api/                  NestJS backend
    prisma/             schema, migrations, seed
    src/
      common/           config, errors, pipes, utils (text, decimal, market hours)
      cache/            Redis client, cache-aside service, token-bucket limiter
      providers/        market-data, disclosure and scheme-master adapters
      modules/          funds, holdings, prices, analytics, ai, export, auth, users, alerts
      jobs/             BullMQ processors and the cluster-wide scheduler
  web/                  Next.js 14 App Router dashboard
    src/
      app/              routes: /, /fund/[id], /compare
      components/       ui primitives, dashboard panels, layout
      hooks/            data hooks with visibility-aware polling
      lib/              typed API client, formatters
packages/
  shared/               types, DTO schemas, the AI query DSL — imported by both apps
docs/                   PRD, architecture, database, API, UI, testing, deployment
```

---

## Commands

```bash
npm run dev              # API + web in watch mode
npm run build            # shared → api → web
npm run test             # unit tests
npm run typecheck        # all workspaces, including scripts and specs
npm run format           # prettier
npm run db:migrate       # prisma migrate dev
npm run db:seed          # sample schemes, stocks and disclosures
npm run docker:up        # full stack
```

---

## Licence and disclaimer

FundLens is not a registered investment adviser. Nothing it produces is investment advice
or a recommendation. Holdings are historical disclosures, prices may be delayed, and AI
commentary is labelled as generated and may contain errors — the product states all three
on every screen rather than in a footnote.
