# Testing strategy

```bash
npm run test              # 127 unit tests
npm run test:cov          # with coverage
npm run typecheck         # src, specs, and the seed script
```

---

## 1. What is tested, and why those things

The test suite targets the code where a bug is **silent and expensive**: portfolio maths,
data parsing, symbol mapping, and the query engine behind the AI. A wrong weighted average
does not throw — it renders as a plausible number on a financial dashboard.

Everything under test is deliberately **pure**. `portfolio-analytics.ts`, `query-executor.ts`,
`rule-parser.ts`, `amfi-nav.parser.ts` and the text/decimal utilities have no Prisma, no
Nest and no I/O, which is what makes them testable at all — and is why they were designed
that way rather than as service methods.

| Suite | Tests | Guards against |
| --- | --- | --- |
| `portfolio-analytics.spec.ts` | 18 | Wrong weighted averages, renormalised weights, HHI errors, movers dominated by dust positions |
| `query-executor.spec.ts` | 22 | Filter/sort errors, null mishandling, wrong aggregates — the numbers the AI reports |
| `rule-parser.spec.ts` | 27 | Every documented question failing to parse; direction and threshold inversions |
| `amfi-nav.parser.spec.ts` | 13 | A scheme-master format change silently importing garbage |
| `text.spec.ts` | 17 | Company-name normalisation collapsing distinct companies, or failing to collapse the same one |
| `decimal.spec.ts` | 12 | Null-vs-zero confusion, `-0`, division by zero |
| `stock-mapper.spec.ts` | 18 | A government bond classified as equity, or vice versa |

`test-utils/holdings.factory.ts` builds realistic rows so tests start from a full portfolio
rather than a minimal stub — most bugs here live in the fields a hand-written stub omits.

---

## 2. Cases the suite deliberately pins

These are the assertions worth reading, because each encodes a decision:

**Unknown ≠ zero.** A portfolio with no prices reports `weightedAverageChangePct: null`, not
`0`. A holding with no quote is excluded from `changePct < -1` *and* from
`changePct != -2.5` — "sector is not Banks" must not surface a holding whose sector we do
not know.

**Weights are not renormalised.** A fund holding 52% equity and 48% cash reports exactly
that; the equity sleeve does not silently become 100%.

**Dust positions cannot be movers.** A 0.01% holding that moves 30% does not appear in top
gainers.

**Contribution ≠ move.** A holding up 2.5% at 20% weight outranks one up 4% at 12% weight.

**HHI is computed over the equity sleeve**, so a cash-heavy fund is not mislabelled as
concentrated.

**The documented question set answers with no LLM.** All nine example questions resolve
through `parseQuestion` and produce correct rows through `executeQuery`. If an LLM were
required for them, the feature would be untestable and unavailable offline.

**`-0` is impossible.** `round(-0.0001, 2)` returns `0`, not `-0` — which would serialise as
`-0` and render as "−0.00%", reading as a loss where there was none. *This test found a real
bug in the implementation during development.*

---

## 3. Integration coverage (CI)

The `integration` job in `.github/workflows/ci.yml` runs against real Postgres and Redis
services and exercises the paths unit tests cannot:

1. `prisma migrate dev` on an empty database, then `migrate status`
2. `db:seed` — the full seed, including daily bars
3. Boot the built API and wait for `/health`
4. Smoke the public surface end to end:
   - `/health` and `/health/ready` (asserting `database: true`)
   - scheme search returns the seeded fixtures and yields a fund id
   - holdings carry rows, a `disclosureDate` and `priceCoverage`
   - analytics return a sector allocation and a non-zero stock count
   - **`POST /ai/query` answers with `resolvedBy: "rules"`** with `AI_ENABLED=false` —
     proving the assistant works with no model configured
   - CSV export streams

Background jobs are disabled in that job (`ENABLE_BACKGROUND_JOBS=false`) so the smoke test
is deterministic and CI never reaches out to AMFI.

---

## 4. What is not tested, honestly

| Not covered | Why, and what compensates |
| --- | --- |
| Nest controller wiring | The CI smoke test hits every public endpoint against a real server, which catches wiring faults more cheaply than mocked controller specs |
| Prisma queries against a real DB | Migrations and seed run in CI; the two raw SQL queries are exercised by the smoke test |
| The HTTP market-data adapter against a live vendor | Requires a paid contract. `mapVendorQuote` is a pure function and is the only part that varies — it is the natural next unit test when a vendor is chosen |
| LLM output quality | Non-deterministic by nature. Mitigated architecturally: model output is schema-validated and cannot produce figures, so a bad response degrades to "unsupported question", not to a wrong number |
| Frontend component tests | The build type-checks every prop against `@fundlens/shared`. Playwright over the seeded stack is the right next step and is not present |
| Load and soak testing | No performance regression gate exists. The targets in the PRD are design intent, not measured results |

Being explicit about this matters more than a coverage badge: the gaps above are the honest
state of the repository, not oversights.

---

## 5. Adding tests

Unit tests sit beside their subject as `*.spec.ts` (`jest.rootDir` is `src`). Prefer testing
a pure function over mocking a service; if something needs heavy mocking to test, that is
usually a signal the logic should be extracted — which is how `portfolio-analytics.ts` and
`query-executor.ts` came to be separate from their services.
