# Database

PostgreSQL 16 via Prisma. Full schema: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).

---

## 1. Model map

```
Amc ──< MutualFund ──< PortfolioSnapshot ──< Holding >── Stock ──< DailyBar
                                                          │  │
                            Sector >───────────────────────┘  └──── StockPrice (1:1)
                                                          │
                                                  StockAlias

User ──< RefreshToken · UserPreference · FavoriteFund · Watchlist ──< WatchlistItem
     └──< AlertRule ──< Notification
     └──< AuditLog

ApiCallLog · SyncJobRun · MarketHoliday        (operational, unrelated)
```

---

## 2. Design decisions

### Disclosures are immutable

A new monthly filing creates a **new** `PortfolioSnapshot`; it never mutates an existing
one. This is what makes historical comparison, turnover analysis and the audit trail
possible at all, and it means `snapshot:holdings:{id}` can be cached for six hours without
an invalidation race.

A re-import of the *same* period replaces that snapshot's holdings wholesale rather than
diffing rows — a disclosure is a complete statement, and a partial update could leave a
stale position behind.

### Decimal, never Float

Every weight, price and value is `Decimal`. Weights are percentages at 4 decimal places
(`7.4213` = 7.4213%). Floating-point drift in a column that is summed across 60 rows and
compared against 100% is a correctness bug, not a rounding nicety.

Prisma returns `Decimal` objects and `BigInt` values, neither of which survives
`JSON.stringify`. Everything leaving a service passes through `common/utils/decimal.ts`, so
serialisation happens in exactly one place and rounding is explicit.

### Weights are stored as disclosed

Never renormalised. A fund holding 92% equity and 8% cash shows 92%. Renormalising to 100%
would silently misstate the portfolio, and the analytics deliberately report
`totalEquityWeightPct` and `nonEquityWeightPct` separately.

### Live prices overwrite; history appends

`StockPrice` is one row per stock, overwritten in place, fronted by Redis. `DailyBar` is
append-only and feeds the 52-week average. Two tables because the access patterns are
opposite: one is a hot single-row read, the other a 250-row aggregate.

### Unmapped holdings are stored, not dropped

`Holding.stockId` is nullable and `instrumentName` preserves the disclosure's exact
spelling. That allows re-running the mapper later without re-downloading the source file,
and it means a 4% position we could not identify still appears in the totals and is
reported to the user.

---

## 3. Indexing strategy

Every index exists to serve a query in the codebase.

| Query | Index |
| --- | --- |
| Fuzzy scheme search | `GIN (normalizedName gin_trgm_ops)` on `mutual_funds` |
| Fuzzy company match during import | `GIN (normalizedName gin_trgm_ops)` on `stocks` |
| Learned alias lookup | `GIN (normalizedAlias gin_trgm_ops)` on `stock_aliases` |
| **Latest published snapshot for a fund** (hottest query) | Partial `(fundId, disclosureDate DESC) WHERE status='PUBLISHED'` |
| **Holdings of a snapshot by weight** (dashboard read) | Covering `(snapshotId, weightPct DESC) INCLUDE (stockId, instrumentName, instrumentType, rank)` |
| "Which schemes hold this stock" | Partial `(stockId, snapshotId) WHERE stockId IS NOT NULL` |
| Actively-held stock universe for refresh | `holdings(stockId)` + snapshot partial index |
| 52-week average | `daily_bars(stockId, date DESC)` |
| Provider health dashboards | `api_call_logs(provider, createdAt DESC)` |
| Unread notification badge | Partial `(userId, createdAt DESC) WHERE readAt IS NULL` |

Three notes on the non-obvious ones:

- **The covering index** lets the dashboard's holdings read be served index-only. It is the
  difference between one index scan and a heap fetch per row on a 60-row portfolio under
  concurrent load.
- **The partial snapshot index** stays small because `PUBLISHED` is a minority of rows once
  failed and superseded snapshots accumulate.
- **Trigram, not tsvector.** Scheme names are short, highly repetitive strings that users
  routinely mistype or abbreviate ("parag parik flexi"). Trigram similarity degrades
  gracefully on typos; stemmed full-text search does not.

---

## 4. Migrations

The repository ships **one** hand-written migration:

```
prisma/migrations/99999999999999_search_indexes/migration.sql
```

It enables `pg_trgm` and creates the trigram, partial and covering indexes that Prisma's
schema language cannot express. It is timestamped far in the future so it always sorts
*after* the generated table migration, and every statement is `IF NOT EXISTS`, so it is safe
to re-run.

**On a fresh database, generate the table migration once:**

```bash
cd apps/api
npx prisma migrate dev --name init      # creates the tables from schema.prisma
npx prisma migrate status               # both migrations applied
```

Why it is generated rather than committed: Prisma's SQL output varies between client
versions, and a committed init migration drifts out of step with the schema file that is the
actual source of truth. Generating it locally guarantees the two agree. In production,
commit the generated migration from your release branch and deploy with
`prisma migrate deploy` — see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 5. Retention

| Table | Policy | Enforced by |
| --- | --- | --- |
| `api_call_logs` | 90 days | `stock-metadata-sync` nightly (sized to cover a billing dispute) |
| `refresh_tokens` | Deleted when expired, or 7 days after revocation | `AuthService.pruneExpiredTokens` |
| `daily_bars` | Retained — the 52-week average needs a rolling year, charts want more | — |
| `portfolio_snapshots` | Retained indefinitely; the product *is* the history | — |
| `audit_logs` | Retained; export and rotation belong to ops tooling, not the app | — |

---

## 6. Query patterns worth knowing

**Latest snapshot.** Cached by fund id in Redis; on a miss it is one index scan against the
partial index. The import pipeline deletes the key on republish.

**Actively-held stock universe** (`PricesService.activelyHeldStockIds`) is raw SQL: a join
against a grouped subquery of each fund's newest published `disclosureDate`. Expressing that
through the ORM would produce either N+1 queries or a substantially worse plan.

**52-week averages** are computed in SQL (`AVG(close) GROUP BY stockId` over a 52-week
window), not in Node. The alternative is pulling ~250 rows per stock across a few hundred
stocks on every refresh.

**Scheme search** blends trigram similarity with a prefix bonus and a Direct-plan bonus in a
single ranked query — the GIN index makes the `%` filter cheap and only the shortlist is
scored.

---

## 7. Seed data

`npm run db:seed` is standalone — it talks to Prisma directly rather than booting Nest, so it
works with no Redis, no market-data provider and even if the API cannot start.

It creates: 24 sectors, 56 stocks with real NSE/BSE symbols and ISINs, ~250 trading days of
synthetic daily bars per stock (so the 52-week average is populated on first boot), 3
synthetic AMCs, 4 synthetic schemes and 3 month-end disclosures each.

It is idempotent — everything upserts on a natural key. Fixture schemes are labelled
`(Sample)` and use `SAMPLE-*` scheme codes in a range AMFI does not use, so a later real
scheme-master sync can never collide with them.
