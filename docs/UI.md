# UI — wireframes, component hierarchy, interaction rules

Next.js 14 App Router, Tailwind, shadcn/ui-style primitives (Radix behaviour + classes we
own), Recharts, TanStack Query.

---

## 1. Routes

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | Static | Landing + scheme search |
| `/fund/[id]` | Client | The dashboard |
| `/compare` | Client | Cross-scheme overlap |

The dashboard is client-rendered rather than server-rendered. It is behind no auth wall, has
no SEO value, and every panel polls — server-rendering it would produce a snapshot that is
stale by the time it paints, then immediately refetch.

---

## 2. Wireframes

### `/` — search

```
┌──────────────────────────────────────────────────────────────┐
│  FundLens  portfolio X-ray          Search  Compare   ☾      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│        See what your mutual fund actually owns               │
│        Search any Indian scheme and get its latest           │
│        disclosed portfolio with live market prices.          │
│                                                              │
│   ┌────────────────────────────────────────────────────┐    │
│   │ 🔍  Search any mutual fund scheme…            ⟳    │    │
│   ├────────────────────────────────────────────────────┤    │
│   │ Northstar Flexi Cap Fund - Direct - Growth         │◄─ ↑↓ Enter
│   │ Northstar AMC · Flexi Cap Fund · NAV ₹87.43        │    │
│   │ ────────────────────────────────────────────────── │    │
│   │ Sentinel Large Cap Fund - Direct - Growth          │    │
│   └────────────────────────────────────────────────────┘    │
│                                                              │
│   Holdings come from published monthly disclosures and       │
│   may lag current positions.                                 │
│                                                              │
│   ┌──────────────────┐  ┌──────────────────┐                │
│   │ Every holding,   │  │ Analytics that   │   … 4 feature   │
│   │ priced live      │  │ answer a question│      cards      │
│   └──────────────────┘  └──────────────────┘                │
└──────────────────────────────────────────────────────────────┘
```

### `/fund/[id]` — dashboard

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Search another scheme                                                  │
│ Northstar Flexi Cap Fund - Direct Plan - Growth                          │
│ Northstar AMC · [Flexi Cap] · NAV ₹87.43 · 31 Jul 2025  [Latest ▾] ☐debt│
├──────────────────────────────────────────────────────────────────────────┤
│ ⓘ  Holdings as disclosed 31 Jul 2025 · 30/30 priced · Prices 12s ago     │  ← DataStatusBar
│                              [Every 60s ▾] [⏸] [⟳] [CSV] [Excel]         │     (always visible)
├──────────────────────────────────────────────────────────────────────────┤
│ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐                 │
│ │ EQUITY    │ │ TOP 10    │ │ WEIGHTED  │ │ BREADTH   │                 │  ← StatCards
│ │ 30        │ │ 44.66%    │ │ +0.41%    │ │ 19 / 10   │                 │
│ │ 95.5% NAV │ │ HHI 413   │ │ weighted  │ │ up / down │                 │
│ └───────────┘ └───────────┘ └───────────┘ └───────────┘                 │
├────────────────────────────────────────────┬─────────────────────────────┤
│ Sector allocation                          │ Concentration & market cap  │
│    ╭────╮   Banks        5  23.28%  +0.61% │  Large cap  14   61.2% ███  │
│   │ ◕  │   IT-Software  4  15.10%  −0.22% │  Mid cap     9   24.1% ██   │
│    ╰────╯   Petroleum    1   5.63%  +1.04% │  Small cap   7   10.2% █    │
│                                            ├─────────────────────────────┤
│ ┌─────────────────┐ ┌────────────────────┐ │ Portfolio insights  [AI]    │
│ │ ▲ Top gainers   │ │ ▼ Top losers       │ │ Disclosure   31 Jul 2025    │
│ │ Gamma  +4.02%   │ │ Delta   −5.10%     │ │ Top 10       44.66%         │
│ └─────────────────┘ └────────────────────┘ │ ── generated commentary ──  │
├────────────────────────────────────────────┴─────────────────────────────┤
│ 🤖 Ask about this portfolio                                              │
│ [Which holdings are down more than 2% today?              ] [Ask]        │
│  ( chips: highest weight · biggest gainer · banking stocks )             │
│  ┌───────────────────────────────────────────────────────────────┐      │
│  │ [matched a built-in rule]  Holdings down more than 2% today.  │      │
│  │ 3 matching holdings (6.41% of net assets).                    │      │  ← computed
│  │ Delta Pharma   8.00%  ₹800.00  −5.10%   ₹20,000 cr            │      │
│  ├───────────────────────────────────────────────────────────────┤      │
│  │ ✦ AI commentary (dashed border, muted)                        │      │  ← generated
│  └───────────────────────────────────────────────────────────────┘      │
├──────────────────────────────────────────────────────────────────────────┤
│ [🔍 Find a stock] [All sectors ▾] [All caps ▾] [Any movement ▾] [Clear]  │
│ Showing 30 of 30 holdings                                                │
│ ┌──┬───────────────┬─────────┬────────┬───────┬────────┬───────┬──────┐ │
│ │# │ Stock        ⇅│ Symbols │ Sector⇅│Weight⇅│ Price ⇅│Change⇅│Mcap ⇅│ │
│ │1 │ HDFC Bank    │HDFCBANK │ Banks  │ 8.42% │1,684.35│▲+0.97%│1.28L │ │
│ │2 │ ICICI Bank   │ICICIBANK│ Banks  │ 7.11% │1,269.90│▼−0.42%│  890K│ │
│ └──┴──────────────┴─────────┴────────┴───────┴────────┴───────┴──────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

Mobile collapses to one column; the table drops Symbols → Sector → Market cap → Updated at
`md`/`lg`/`xl`, keeping name, weight, price and change at every width. The table scrolls
inside its own container so the page never scrolls sideways.

---

## 3. Component hierarchy

```
RootLayout
├── Providers                       QueryClient (retry policy, no 4xx retries)
├── SiteHeader                      nav + theme toggle (OS default, explicit choice sticks)
├── {page}
│   ├── HomePage
│   │   └── FundSearch              debounced combobox, ↑↓/Enter/Esc, aria-activedescendant
│   ├── FundDashboardPage
│   │   ├── DataStatusBar           disclosure date · staleness · coverage · refresh · export
│   │   ├── StatCards               4 headline tiles
│   │   ├── SectorChart             Recharts donut + scrollable legend list
│   │   ├── MoversPanel             MoverList ×2
│   │   ├── ConcentrationPanel      market-cap bars + concentration badges
│   │   ├── InsightsPanel           facts <dl> | generated sections (labelled)
│   │   ├── AiAssistant
│   │   │   └── AnswerBlock         provenance badge · computed answer · narrative · warnings
│   │   └── HoldingsTable
│   │       ├── filter bar          search · sector · market cap · movement
│   │       └── HoldingTableRow     PriceQualityBadge
│   └── ComparePage
│       ├── FundPicker ×2
│       └── OverlapResultView
└── SiteFooter                      permanent data note + not-advice disclaimer
```

Primitives live in `components/ui/index.tsx`: `Button`, `Card`, `Input`, `Badge`, `Table`,
`Alert`, `Select`, `Skeleton`.

---

## 4. Interaction rules

**Polling is gated three ways.** It stops when the tab is hidden (a forgotten background tab
must not poll the API and the market-data quota behind it all day), stops on historical
periods (nothing can change), and is user-adjustable 30s–5m with an explicit pause. "As fast
as possible" is not universally right on a metered mobile connection.

**Refetch does not clear the table.** `placeholderData: (previous) => previous` keeps rows on
screen during a refetch, so the dashboard does not collapse to a skeleton every minute.

**Sorting, filtering and search are client-side.** A disclosed portfolio is at most a few
hundred rows and the full set is already in memory for the analytics panels. A round trip
per sort would add latency for no benefit. The state is shaped to move server-side unchanged
if that assumption ever breaks.

**Unknown is not zero.** A holding without a quote shows `—`, is excluded from movement
filters entirely, and sorts last in both directions. It is never rendered as a flat 0.00%.

**The AI panel mirrors the API's split.** Computed answer in a solid block; narrative in a
dashed, muted block labelled "AI commentary"; a badge saying whether a rule or the model
planned the query; warnings shown inline, not hidden.

---

## 5. Accessibility

- **Direction is never colour alone.** Every change value carries ▲/▼ plus a sign.
- Both gain and loss hues clear 4.5:1 against the card background in light and dark.
- Sortable headers are real `<button>`s exposing `aria-sort`; the search combobox implements
  `role="combobox"` with `aria-expanded`/`aria-controls` and full keyboard navigation.
- Every icon-only control has an `aria-label`; decorative icons are `aria-hidden`.
- `prefers-reduced-motion` disables the price-flash animation.
- Numeric columns use tabular figures so values do not shift horizontally on each refresh.

---

## 6. Theming

Design tokens are CSS custom properties in `globals.css`; Tailwind references them, so light
and dark swap by changing variables rather than duplicating utility classes. Market
semantics (`--gain`, `--loss`, `--flat`) are tokens too, so no component hard-codes a colour
and the palette stays adjustable for accessibility.
