# Data sources

This document is deliberately first in the reading order. The single most important thing
to understand about FundLens is **where each number on the screen comes from, and how
current it is.**

---

## The three inputs

| Input | Status in this repository | Refresh cadence |
| --- | --- | --- |
| **Scheme master** (every Indian MF scheme + NAV) | **Live.** AMFI's public `NAVAll.txt` is parsed and imported by a working scheduled job. | Daily, 22:30 IST |
| **Portfolio disclosures** (month-end holdings) | **Adapter, registry empty.** Parser and pipeline implemented; the source must be chosen by the operator. Development uses synthetic fixtures. | Daily scan, 03:00 IST |
| **Market prices** (NSE/BSE quotes) | **Adapter, simulated by default.** A generic licensed-vendor adapter is implemented. | Every 60s during market hours |

---

## 1. Scheme master — AMFI (real, working)

AMFI publishes a complete, free, machine-readable list of every scheme with its latest NAV
at `https://www.amfiindia.com/spages/NAVAll.txt`.

`SchemeMasterService` fetches and imports it on a schedule. The parser
(`amfi-nav.parser.ts`) handles the file's real-world messiness: interleaved category and
AMC headers, `N.A.` NAVs, absent ISINs, thousands separators, and scheme codes repeated
across category blocks. It is covered by unit tests against a representative fixture.

This is what makes the product's core promise honest: the searchable universe is *every*
Indian mutual fund scheme, not a curated list.

**Consequence to be aware of:** a scheme can be searchable before its holdings exist in the
system. The API distinguishes these cases explicitly — `FUND_NOT_FOUND` versus
`DISCLOSURE_NOT_FOUND` — and the UI says "no portfolio disclosure yet" rather than
pretending the fund is unknown.

---

## 2. Portfolio disclosures — three supported routes

SEBI requires every AMC to publish a month-end portfolio statement. It does **not** require
a common format or a predictable URL. In practice AMCs publish XLS/XLSX (occasionally PDF)
files with different column headers, different section labels, and different layouts.

FundLens implements the hard part — parsing, mapping, validation, snapshotting, diffing —
and leaves the sourcing decision to the operator, because that decision carries terms-of-use
obligations that differ per AMC and per jurisdiction.

### Route A — a licensed mutual fund data vendor (recommended for production)

One contract, one format, names and ISINs already normalised. Implement `DisclosureProvider`
(three methods, see `disclosure.types.ts`) against the vendor's API and register it in
`disclosure.module.ts`. Everything downstream is unchanged.

### Route B — direct AMC downloads

Register an adapter in `providers/disclosure/amc-adapters.ts`:

```ts
hdfc: {
  key: 'hdfc',
  amcName: 'HDFC Mutual Fund',
  minRequestIntervalMs: 2_000,          // be a good citizen
  async resolveDisclosureUrls(monthEnd) { /* return the workbook URLs */ },
  parseOptions: { headerSynonyms: { weight: ['% to nav'] } },
},
```

Then set `DISCLOSURE_PROVIDER=amc`. The registry ships **empty on purpose**: adding an
adapter is a code change so it goes through review and lands in version control, rather than
being a runtime setting that silently starts hitting someone else's servers.

The generic workbook parser (`portfolio-workbook.parser.ts`) locates the header row by
content rather than by coordinates, so it survives an AMC adding a logo row, and it
recognises section headers ("Equity & Equity Related", "Debt Instruments", "Money Market")
to classify the rows beneath them.

### Route C — administrative upload

`AmcDisclosureProvider.parseUploadedWorkbook()` runs a manually supplied workbook through
the identical parse-and-import path. Useful for backfills and for AMCs with no stable URL.

### Development default — synthetic fixtures

`DISCLOSURE_PROVIDER=fixture` generates three month-end disclosures for four **synthetic**
schemes run by **synthetic** AMCs, all labelled `(Sample)`.

They are synthetic deliberately. Attaching invented holdings to a real scheme name would
produce a screen that looks authoritative and is not — which is precisely the failure mode
this product exists to avoid. Real scheme names enter only through the AMFI sync; real
holdings only through a configured adapter.

---

## 3. Market prices — licensed vendor or simulated

Real-time NSE/BSE quotes are licensed data. They cannot be redistributed in a repository,
and scraping the exchange websites violates their terms of use and produces an
undeployable product.

### Production: `MARKET_DATA_PROVIDER=http`

`HttpMarketDataProvider` targets the shape essentially every Indian vendor exposes:

```
GET {MARKET_DATA_BASE_URL}/quotes?symbols=INFY,TCS,HDFCBANK
→ { "data": [ { "symbol": "INFY", "last_price": 1880.4, ... } ] }
```

`mapVendorQuote()` is the only place vendor field names appear, and it already accepts the
common naming conventions (`last_price` / `lastPrice` / `ltp`, `prev_close` / `prevClose`,
…). Most integrations need no code change at all; an unusual vendor needs an override of
that one method.

Set the licensed rate in `MARKET_DATA_RATE_LIMIT_PER_MIN`. The distributed token bucket is
sized from it, so N API replicas share one quota rather than each spending the full amount.

### Default: `MARKET_DATA_PROVIDER=simulated`

A deterministic synthetic feed: a seeded random walk anchored to each stock's last known
close, stable within each minute, frozen outside market hours. Every quote it produces is
tagged `source: "simulated"` and that tag travels all the way to the API response.

Running it with `NODE_ENV=production` logs an explicit error at boot. It must never serve
real users.

---

## How freshness is surfaced, not hidden

The product joins **month-old disclosed weights** to **live prices**. A user who does not
understand that pairing will misread the entire screen, so it is stated everywhere:

- `snapshot.disclosureDate` and `snapshot.stale` on every holdings response
- `priceCoverage` — how many holdings actually have a usable quote, and how many are stale
- `quote.quality` per row: `LIVE` / `DELAYED` / `STALE` / `MARKET_CLOSED` / `UNAVAILABLE`
- `unmappedInstruments` — disclosure lines with no matched security, shown rather than dropped
- A permanent status strip above the table, not a tooltip
- A provenance block at the top of every CSV and Excel export, because a spreadsheet
  outlives the page it came from

Historical periods do not receive live prices at all. Pairing today's price with a
six-month-old weight would be actively misleading, so the API declines to do it and the UI
explains why.

---

## Data quality rules enforced at import

A disclosure is only published if it passes:

1. **Weights sum to 100% ± 2%** — a wider miss means a column was misread.
2. **At least 50% of equity weight maps to a known security** — below that, the mapping is
   too poor to render.
3. **Checksum differs from the stored snapshot** — otherwise the import is a no-op, so a
   daily job re-reading an unchanged month costs one hash.

A snapshot that fails is stored with status `FAILED` and **the previous snapshot keeps
serving**. Showing last month's verified portfolio beats showing this month's broken one.
