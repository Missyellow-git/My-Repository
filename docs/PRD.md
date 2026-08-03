# Product Requirements Document — FundLens

**Status:** v1.0, implemented
**Owner:** Product / Engineering

---

## 1. Problem

An Indian retail investor who owns a mutual fund cannot easily answer basic questions about
what they actually own:

- Which companies does this fund hold, and how much of each?
- How are those companies trading today?
- Is the fund concentrated in a handful of names or a handful of sectors?
- What did the manager buy and sell last month?
- Do my three "diversified" funds all own the same twenty stocks?

The data exists. Every AMC publishes a month-end portfolio, and prices are available from
licensed vendors. But the disclosure is a spreadsheet on a website in the AMC's own format,
and joining it to live prices requires mapping several dozen inconsistently spelled company
names to trading symbols. No mainstream tool does this without asking the user to first
upload or reconstruct their own holdings.

## 2. Product statement

> Type a scheme name. See what it owns, priced now.

No upload. No account required. The user provides a name; the system does the rest.

## 3. Users

| Persona | Need | Primary surface |
| --- | --- | --- |
| **Retail investor** ("I own this fund, what's in it?") | Plain-language view of holdings and today's movement | Dashboard, AI assistant |
| **Advisor / distributor** | Overlap across client portfolios, concentration risk, month-on-month churn | Compare page, analytics, export |
| **Analyst / researcher** | Structured, exportable holdings with symbol mapping and history | API, CSV/Excel export, historical periods |

## 4. Scope

### In scope (v1 — all implemented)

**Discovery**
- Fuzzy search across every Indian scheme in the AMFI master, typo tolerant
- Direct/Regular and category filters; option to show only schemes with holdings on file

**Holdings**
- Latest disclosed portfolio with: stock name, NSE symbol, BSE code, ISIN, weight %,
  quantity, market value, LTP, absolute and percentage change, sector, market cap, last
  updated time
- Sort by any column; filter by sector, market-cap bucket and movement; free-text search
  within the portfolio
- Historical disclosure periods
- Non-equity lines (debt, TREPS, cash) shown on demand, never silently dropped

**Analytics**
- Total stocks held, top 10 holdings and their combined weight
- Sector allocation with a chart, plus each sector's weighted move
- Market-cap allocation (large/mid/small)
- Top gainers and losers, advance/decline breadth
- Average daily change and weight-adjusted portfolio move
- Highest and lowest weighted stock
- Herfindahl concentration index
- Per-holding contribution: weight × today's move
- Period comparison: additions, exits, weight changes, sector shift, one-way turnover
- Cross-scheme overlap

**AI assistant**
- Natural-language questions over the selected fund's holdings
- Intraday commentary distinguishing computed facts from generated narrative
- Explicit refusal for advice, predictions and out-of-dataset questions

**Platform**
- Auto-refreshing prices at a user-configurable interval, respecting provider rate limits
- Holdings refresh automatically when a new disclosure appears
- CSV and Excel export
- Optional accounts: favourites, watchlists, alerts, preferences
- REST API with OpenAPI documentation

### Explicitly out of scope for v1

| Not built | Why |
| --- | --- |
| Personal portfolio tracking (units held, XIRR, P&L) | A different product with different regulatory weight. FundLens describes funds, not user positions. |
| Buy/sell execution or any transaction path | Requires an entirely different licensing posture. |
| Investment recommendations or scoring | The AI is constrained *away* from this on purpose (§6). |
| NAV performance history and returns charts | Available from many sources; the differentiator here is the look-through, not the return series. |
| Push/email delivery of alerts | Alert rules and in-app notifications are implemented; outbound delivery needs a mail provider and per-tenant config. The notification row is written regardless, so the dispatcher slots in without rework. |

## 5. Functional requirements

| # | Requirement | Where |
| --- | --- | --- |
| FR-1 | Search any Indian scheme by partial or misspelled name | `GET /funds/search` |
| FR-2 | Resolve a scheme to its latest published disclosure | `HoldingsService.resolveSnapshot` |
| FR-3 | Extract every instrument with its disclosed weight | `DisclosureImportService` |
| FR-4 | Map each instrument to NSE/BSE symbols | `StockMapperService` |
| FR-5 | Join live prices to mapped holdings | `PricesService` |
| FR-6 | Sort, filter and search within the holdings table | `HoldingsTable` |
| FR-7 | Portfolio analytics as listed in §4 | `portfolio-analytics.ts` |
| FR-8 | Auto-refresh prices on a configurable interval within provider limits | `PriceRefreshProcessor`, `RateLimiterService` |
| FR-9 | Detect and import new monthly disclosures automatically | `DisclosureSyncProcessor` |
| FR-10 | Answer natural-language questions about the portfolio | `AiService` |
| FR-11 | Generate intraday commentary separating fact from narrative | `InsightsService` |
| FR-12 | Export holdings to CSV and Excel | `ExportService` |
| FR-13 | Compare disclosure periods and compare two schemes | `AnalyticsService` |
| FR-14 | Optional accounts with favourites, watchlists, alerts | `AuthModule`, `UsersModule`, `AlertsModule` |
| FR-15 | Maintain historical snapshots for comparison | `PortfolioSnapshot` (immutable per period) |

## 6. AI requirements and constraints

The assistant is useful only if it is trustworthy, so its architecture encodes the
constraints rather than relying on prompt discipline alone.

**Must**
- Translate questions into a closed, schema-validated query DSL that the *server* executes
- Present computed figures and generated narrative as separate, separately labelled fields
- State the disclosure date, price quality and any data gaps alongside every answer
- Fall back to a deterministic rule parser when no model is configured or the model fails
- Refuse questions the dataset cannot answer, and say why

**Must not**
- Produce any number itself. The model chooses filters; it never states a price, a weight or
  a count
- Give investment advice, recommendations, price targets or predictions
- Characterise a holding as cheap, expensive, attractive or risky
- Reach the database, or any tool other than the query DSL

The supported question set — all answered by the rule parser with no model call, all
covered by tests:

```
Which stock has the highest weight in this fund?
Which holdings are down more than 2% today?
Show all banking stocks
Which stock is the biggest gainer today?
How many IT stocks are in this portfolio?
Which stocks have a market cap above ₹1 lakh crore?
List all small-cap companies
Show only stocks trading above their 52-week average
Compare today's movement with each stock's portfolio weight
```

## 7. Non-functional requirements

| Attribute | Target | How it is met |
| --- | --- | --- |
| Dashboard load (warm cache) | p95 < 400ms | Redis-cached snapshot + quotes, one join in app code |
| Dashboard load (cold) | p95 < 1.5s | Covering index on `holdings(snapshotId, weightPct)` |
| Concurrent users | Thousands per API replica | Stateless API, all hot reads cached, no per-user work in the read path |
| Market-data spend | Bounded by contract | Distributed token bucket sized from the licensed rate; one refresh per cluster, not per replica |
| Price freshness | ≤ 60s during market hours | Repeatable BullMQ job, market-hours and holiday aware |
| Availability under provider outage | Degraded, not down | Holdings still render; quality badges show what is missing |
| Availability under Redis outage | Degraded, not down | Every cache path falls through to Postgres |
| Mobile | Fully usable | Mobile-first layout; the table scrolls in its own container, never the page |
| Accessibility | WCAG 2.1 AA intent | Direction shown by arrow *and* colour; sortable headers expose `aria-sort`; reduced-motion respected |

## 8. Success metrics

| Metric | Target |
| --- | --- |
| Search → dashboard conversion | > 70% of searches open a fund |
| Symbol mapping coverage | > 95% of equity weight mapped per disclosure |
| Questions answered without escalating to the model | > 80% |
| AI answers where a user re-asks (proxy for a bad answer) | < 10% |
| Disclosure import success rate | > 98% of attempted schemes |
| Price coverage during market hours | > 98% of mapped holdings quoted |

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| A mis-mapped company attaches the wrong price to a holding | Tiered matcher with an ambiguity margin; refuses rather than guesses; unmapped lines are shown to the user |
| A user reads month-old weights as current positions | Disclosure date and staleness stated permanently on screen and in exports |
| AI fabricates a figure | Structurally impossible: the model never emits numbers |
| Market-data overspend | Cluster-wide token bucket; fail-closed when the limiter is unreachable |
| AMC changes its workbook layout | Parser locates headers by content; weight-sum validation rejects a misparse and keeps the prior snapshot |
| Being mistaken for advice | Disclaimer on every screen, in the API payload, and in every export |
