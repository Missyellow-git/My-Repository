# API reference

Base URL: `/api/v1` · Interactive docs (non-production): `/api/docs` · Probes are unversioned
at `/health`.

Every response is JSON. Every error uses the envelope in §8. Every request and response
carries an `x-request-id` header.

---

## 1. Funds

### `GET /funds/search`

Fuzzy search across the AMFI scheme master.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `q` | string | — | Required, 2–120 chars |
| `limit` | int | 20 | Max 50 |
| `category` | enum | — | `EQUITY` `DEBT` `HYBRID` `SOLUTION_ORIENTED` `OTHER` |
| `planType` | enum | — | `DIRECT` `REGULAR` |
| `withHoldingsOnly` | bool | false | Only schemes with a published disclosure |

```json
{
  "items": [{
    "id": "3f0c…", "amfiSchemeCode": "119551",
    "name": "Northstar Flexi Cap Fund - Direct Plan - Growth",
    "amcName": "Northstar Asset Management (Sample)",
    "category": "EQUITY", "subCategory": "Flexi Cap Fund",
    "planType": "DIRECT", "optionType": "GROWTH",
    "latestNav": 87.4312, "latestNavDate": "2025-07-31",
    "matchScore": 1.284
  }],
  "total": 1, "query": "flexi cap"
}
```

A scheme can appear here before its holdings exist. Use `withHoldingsOnly=true` when the
next step requires a portfolio.

### `GET /funds/:id`

Scheme detail. Adds `benchmark`, `riskometer`, `aumCrore`, `latestDisclosureDate` and
`disclosureStale`.

### `GET /funds/:id/periods`

Available disclosure periods, newest first. Any returned `disclosureDate` is valid as the
`date` parameter elsewhere.

---

## 2. Holdings

### `GET /funds/:id/holdings`

The dashboard's primary read.

| Param | Type | Default |
| --- | --- | --- |
| `date` | ISO date or `latest` | `latest` |
| `includeNonEquity` | bool | false |
| `includeUnmapped` | bool | true |
| `withPrices` | bool | true |

```json
{
  "fund": { "id": "3f0c…", "name": "…", "amcName": "…" },
  "snapshot": {
    "id": "9a1b…", "disclosureDate": "2025-07-31", "status": "PUBLISHED",
    "source": "fixture", "holdingsCount": 32, "equityCount": 30,
    "totalEquityWeightPct": 95.47, "importedAt": "2025-08-02T03:00:12.000Z",
    "stale": false
  },
  "holdings": [{
    "id": "c4e2…", "instrumentName": "HDFC Bank Limited", "isin": "INE040A01034",
    "instrumentType": "EQUITY", "weightPct": 8.42, "quantity": 1043210,
    "marketValueLakh": 155349.0, "rank": 1,
    "stock": {
      "id": "aa11…", "name": "HDFC Bank Limited", "nseSymbol": "HDFCBANK",
      "bseCode": "500180", "sector": "Banks", "industry": "Private Sector Bank",
      "marketCapCrore": 1280000, "marketCapCategory": "LARGE_CAP"
    },
    "quote": {
      "ltp": 1684.35, "prevClose": 1668.10, "change": 16.25, "changePct": 0.9742,
      "week52High": 1791.0, "week52Low": 1402.5, "week52Avg": 1612.4,
      "quality": "LIVE", "quotedAt": "2025-08-04T09:52:11.000Z", "source": "simulated"
    },
    "mapped": true, "mappingConfidence": 1,
    "pctFrom52wAvg": 4.4623, "weightedChangePct": 0.082
  }],
  "unmappedInstruments": [],
  "priceCoverage": { "requested": 30, "withQuote": 30, "stale": 0, "unavailable": 0 },
  "generatedAt": "2025-08-04T09:52:14.000Z"
}
```

**Clients must render three things rather than treating the table as uniformly live:**
`snapshot.stale`, `priceCoverage`, and each row's `quote.quality`
(`LIVE` `DELAYED` `STALE` `MARKET_CLOSED` `UNAVAILABLE`).

### `GET /funds/:id/holdings/:date`

Same payload for a specific period. **Live prices are not applied to historical periods** —
pairing today's price with a six-month-old weight would be misleading, so the API declines.

---

## 3. Analytics

### `GET /funds/:id/analytics?date=latest`

```json
{
  "totalInstruments": 32, "totalStocks": 30,
  "totalEquityWeightPct": 95.47, "nonEquityWeightPct": 4.53,
  "top10WeightPct": 44.66, "top10": [ … ],
  "highestWeighted": { "stockName": "HDFC Bank Limited", "weightPct": 8.42, … },
  "lowestWeighted": { … },
  "averageChangePct": 0.31, "weightedAverageChangePct": 0.4127,
  "advancers": 19, "decliners": 10, "unchanged": 1,
  "topGainers": [ … ], "topLosers": [ … ],
  "sectorAllocation": [{ "sector": "Banks", "weightPct": 23.28, "stockCount": 5,
                         "weightedChangePct": 0.612 }],
  "marketCapAllocation": [{ "category": "LARGE_CAP", "weightPct": 61.2, "stockCount": 14 }],
  "concentrationHhi": 412.7,
  "priceCoverage": { "withQuote": 30, "total": 30 }
}
```

`averageChangePct` and `weightedAverageChangePct` are `null`, never `0`, when nothing is
measurable — "we don't know" and "it didn't move" are different statements.

### `GET /funds/:id/sector-allocation?date=latest`

Sector weights with each sector's weight-adjusted move.

### `GET /funds/:id/contribution?date=latest`

Per holding: `weightPct`, `changePct`, `contributionPct` (weight × change ÷ 100) and
`shareOfMovePct`. This is the endpoint behind *"compare today's movement with each stock's
portfolio weight"*.

### `GET /funds/:id/compare`

Two modes, mutually exclusive:

- `?from=2025-05-31&to=latest` — period comparison: `added`, `exited`, `increased`,
  `reduced`, `unchangedCount`, `sectorShift`, `turnoverPct` (one-way, the standard
  convention).
- `?againstFundId=<uuid>` — cross-scheme overlap: `overlapPct` as Σ min(weightA, weightB),
  plus the shared holdings.

Positions are keyed by stock id, then ISIN, then name — an AMC that respells a company
between filings must not register as one exit plus one addition.

---

## 4. Prices

### `GET /prices?symbols=INFY,TCS,HDFCBANK`

Up to 200 NSE symbols. Returns quotes keyed by symbol, `unknownSymbols` for anything we
cannot resolve, plus `degraded` and `fetchedAt`. Unlike the holdings path, this endpoint may
fetch from the provider synchronously for small requests.

---

## 5. AI

### `POST /ai/query`

```json
{ "fundId": "3f0c…", "question": "Which holdings are down more than 2% today?",
  "date": "latest", "deterministicOnly": false }
```

```json
{
  "question": "Which holdings are down more than 2% today?",
  "interpretation": "Holdings down more than 2% today.",
  "spec": { "intent": "list", "filters": [ { "field": "changePct", "op": "lt", "value": -2 } ],
            "sort": { "field": "changePct", "direction": "asc" } },
  "resolvedBy": "rules",
  "answer": {
    "kind": "rows",
    "rows": [ { "instrumentName": "…", "nseSymbol": "…", "weightPct": 2.96,
                "ltp": 1742.1, "changePct": -3.12, … } ],
    "factualSummary": "3 matching holdings (6.41% of net assets in the rows shown). …"
  },
  "narrative": "Three of the fund's holdings are down more than 2% …",
  "matchedCount": 3, "totalCount": 30,
  "dataAsOf": { "disclosureDate": "2025-07-31", "pricesFetchedAt": "…", "priceQuality": "OK" },
  "disclaimer": "Portfolio holdings are taken from …",
  "warnings": []
}
```

Contract points that matter:

- **`answer` is computed by the server.** The model only produces `spec`. It cannot state a
  price, miscount a sector or invent a holding.
- **`narrative` is model-written** and must be labelled as such in any UI. It is `null` when
  the LLM is disabled, failed, or the answer is a single number.
- **`resolvedBy`** is `rules` (deterministic parser), `llm` (model planned it) or `fallback`.
- `deterministicOnly: true` skips the model entirely.
- Rate limit: 20/min per authenticated user, or per IP when anonymous.

Unanswerable questions return **422 `AI_QUESTION_UNSUPPORTED`** with example questions in
`details.examples` — including anything asking for advice or a prediction.

### `GET /ai/insights?fundId=…&date=latest`

`facts` (computed, reproducible, always present) and `insights` (prose sections) as separate
fields, with `generatedBy: "llm" | "template"`. The template path is used when the model is
unavailable, so the endpoint never fails just because the LLM is down.

### `GET /ai/capabilities`

`llmEnabled`, the example question set, and the disclaimer. Used to render suggestion chips.

---

## 6. Export

### `GET /funds/:id/export?format=csv|xlsx&date=latest`

Streams a download. Both formats open with a provenance block — scheme, AMC, disclosure
date, staleness, generation time, price coverage, unmapped count and the data note — because
a spreadsheet outlives the page it came from. The Excel workbook adds an "About this export"
sheet and an "Unmapped instruments" sheet when relevant.

CSV cells beginning `=`, `+`, `-` or `@` are prefixed with `'` so Excel does not execute a
company name as a formula.

---

## 7. Accounts (optional)

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/auth/register` | 5/min |
| `POST` | `/auth/login` | 10/min |
| `POST` | `/auth/refresh` | Rotates; the presented token is revoked |
| `POST` | `/auth/logout` | Revokes a refresh token |
| `GET` | `/auth/me` | Bearer |
| `GET POST DELETE` | `/me/favorites` | Saved schemes |
| `GET PATCH` | `/me/preferences` | Refresh interval, theme, default scheme |
| `GET POST DELETE` | `/me/watchlists` | Plus `/:id/items/:stockId` |
| `GET POST` | `/me/notifications` | Plus `/read` |
| `GET POST PATCH DELETE` | `/me/alerts` | `NEW_DISCLOSURE`, `HOLDINGS_CHANGED`, `STOCK_MOVE`, `WEIGHT_THRESHOLD` |

`STOCK_MOVE` fires symmetrically — a 5% alert triggers on −5% too — and every rule has a
cooldown (default 60 min) so a stock oscillating around a threshold does not generate a
notification per evaluation cycle.

---

## 8. Errors

```json
{
  "statusCode": 404,
  "code": "DISCLOSURE_NOT_FOUND",
  "message": "This scheme has no published portfolio disclosure yet. …",
  "details": { "fundId": "3f0c…", "date": "latest" },
  "requestId": "0f8c2a1e-…",
  "timestamp": "2025-08-04T09:52:14.000Z",
  "path": "/api/v1/funds/3f0c…/holdings"
}
```

Branch on `code`; message text may change.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | `details` lists `{ field, message }` |
| `UNAUTHORIZED` / `FORBIDDEN` | 401 / 403 | Missing/invalid token; not your resource |
| `FUND_NOT_FOUND` | 404 | No such scheme |
| `DISCLOSURE_NOT_FOUND` | 404 | Scheme exists, no portfolio on file — **distinct from the above** |
| `DISCLOSURE_STALE` | 409 | Newest disclosure past the freshness threshold (only where acting on stale data would be wrong) |
| `CONFLICT` | 409 | Duplicate resource |
| `AI_QUESTION_UNSUPPORTED` | 422 | Out of scope; `details.examples` suggests alternatives |
| `RATE_LIMITED` / `PROVIDER_RATE_LIMITED` | 429 | Caller throttled / vendor quota reached |
| `PRICE_FEED_UNAVAILABLE` / `AI_UNAVAILABLE` | 503 | Degraded dependency; holdings still render |
| `PROVIDER_TIMEOUT` | 504 | Upstream timed out |
| `INTERNAL` | 500 | Logged with `requestId`; details never returned |

---

## 9. Rate limits

| Scope | Limit |
| --- | --- |
| Global (per IP) | 120 / 60s, configurable |
| `POST /auth/register` | 5 / 60s |
| `POST /auth/login` | 10 / 60s |
| `POST /ai/query` | 20 / 60s per user, or per IP if anonymous |
| Outbound market data | `MARKET_DATA_RATE_LIMIT_PER_MIN`, shared cluster-wide |

---

## 10. Health

| Path | Purpose |
| --- | --- |
| `GET /health` | Liveness. No dependencies — never wire a restart probe to a third party |
| `GET /health/ready` | Readiness. Postgres and Redis; Redis alone reports `degraded: true`, not unready |
| `GET /health/providers` | Operational detail: provider success rates, latencies, cache hit rate |
