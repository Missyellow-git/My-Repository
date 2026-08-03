import { STOCK_MASTER } from '../../scheme-master/fixtures/stock-master';

/**
 * Development fixtures for the disclosure pipeline.
 *
 * These are SYNTHETIC schemes managed by SYNTHETIC AMCs. That is deliberate:
 * attaching invented holdings to a real scheme name would produce a screen
 * that looks authoritative and is not. Real scheme names enter the system only
 * through the AMFI scheme-master sync, and real holdings only through a
 * configured AMC/data-provider disclosure adapter.
 *
 * The fixture generator produces three consecutive month-end disclosures per
 * scheme so that the historical-comparison and turnover features have
 * something meaningful to work against in development.
 */

export interface FixtureFund {
  amcName: string;
  amcShortName: string;
  schemeName: string;
  category: 'EQUITY' | 'HYBRID' | 'DEBT';
  subCategory: string;
  benchmark: string;
  riskometer: string;
  aumCrore: number;
  nav: number;
  /** Latest-period equity holdings as [nseSymbol, weightPct]. */
  equity: Array<[string, number]>;
  /** Non-equity lines: [instrumentName, instrumentType, weightPct]. */
  other: Array<[string, string, number]>;
}

export const FIXTURE_FUNDS: FixtureFund[] = [
  {
    amcName: 'Northstar Asset Management (Sample)',
    amcShortName: 'Northstar',
    schemeName: 'Northstar Flexi Cap Fund - Direct Plan - Growth',
    category: 'EQUITY',
    subCategory: 'Flexi Cap Fund',
    benchmark: 'NIFTY 500 TRI',
    riskometer: 'Very High',
    aumCrore: 18_450,
    nav: 87.4312,
    equity: [
      ['HDFCBANK', 8.42],
      ['ICICIBANK', 7.11],
      ['INFY', 6.05],
      ['RELIANCE', 5.63],
      ['TCS', 4.88],
      ['BHARTIARTL', 4.21],
      ['LT', 3.94],
      ['AXISBANK', 3.42],
      ['ITC', 3.18],
      ['SUNPHARMA', 2.96],
      ['MARUTI', 2.74],
      ['M&M', 2.61],
      ['HCLTECH', 2.44],
      ['TITAN', 2.29],
      ['ULTRACEMCO', 2.15],
      ['BAJFINANCE', 2.08],
      ['KOTAKBANK', 1.97],
      ['NTPC', 1.84],
      ['CIPLA', 1.72],
      ['POWERGRID', 1.61],
      ['CHOLAFIN', 1.48],
      ['PERSISTENT', 1.36],
      ['COFORGE', 1.22],
      ['APOLLOHOSP', 1.14],
      ['DMART', 1.03],
      ['CUMMINSIND', 0.94],
      ['FEDERALBNK', 0.88],
      ['SBILIFE', 0.81],
      ['NAVINFLUOR', 0.72],
      ['BRIGADE', 0.64],
    ],
    other: [
      ['Treps / Reverse Repo', 'MONEY_MARKET', 3.42],
      ['Net Receivables / (Payables)', 'CASH', 1.11],
    ],
  },
  {
    amcName: 'Meridian Mutual Fund (Sample)',
    amcShortName: 'Meridian',
    schemeName: 'Meridian Small Cap Fund - Direct Plan - Growth',
    category: 'EQUITY',
    subCategory: 'Small Cap Fund',
    benchmark: 'NIFTY Smallcap 250 TRI',
    riskometer: 'Very High',
    aumCrore: 9_820,
    nav: 143.9078,
    equity: [
      ['CUB', 4.32],
      ['CRAFTSMAN', 4.08],
      ['VIJAYA', 3.87],
      ['BALRAMCHIN', 3.64],
      ['FINEORG', 3.51],
      ['KAJARIACER', 3.38],
      ['VGUARD', 3.22],
      ['ZENSARTECH', 3.11],
      ['CYIENT', 2.98],
      ['RATNAMANI', 2.86],
      ['SUNDRMFAST', 2.74],
      ['CARBORUNIV', 2.63],
      ['KPRMILL', 2.52],
      ['BRIGADE', 2.41],
      ['NAVINFLUOR', 2.34],
      ['SUVENPHAR', 2.21],
      ['APARINDS', 2.12],
      ['MUTHOOTFIN', 2.04],
      ['CAMS', 1.96],
      ['PERSISTENT', 1.84],
      ['COFORGE', 1.72],
      ['CHOLAFIN', 1.61],
      ['FEDERALBNK', 1.48],
      ['TECHM', 1.32],
    ],
    other: [
      ['Treps / Reverse Repo', 'MONEY_MARKET', 6.84],
      ['Net Receivables / (Payables)', 'CASH', 0.94],
    ],
  },
  {
    amcName: 'Sentinel AMC (Sample)',
    amcShortName: 'Sentinel',
    schemeName: 'Sentinel Large Cap Fund - Direct Plan - Growth',
    category: 'EQUITY',
    subCategory: 'Large Cap Fund',
    benchmark: 'NIFTY 100 TRI',
    riskometer: 'Very High',
    aumCrore: 26_310,
    nav: 62.1845,
    equity: [
      ['HDFCBANK', 9.64],
      ['RELIANCE', 8.71],
      ['ICICIBANK', 7.92],
      ['INFY', 6.44],
      ['TCS', 5.81],
      ['BHARTIARTL', 5.02],
      ['ITC', 4.36],
      ['LT', 4.11],
      ['SBIN', 3.68],
      ['AXISBANK', 3.24],
      ['HINDUNILVR', 3.02],
      ['SUNPHARMA', 2.88],
      ['MARUTI', 2.71],
      ['KOTAKBANK', 2.54],
      ['NTPC', 2.36],
      ['M&M', 2.22],
      ['TITAN', 2.05],
      ['ULTRACEMCO', 1.92],
      ['BAJFINANCE', 1.78],
      ['POWERGRID', 1.64],
      ['NESTLEIND', 1.51],
      ['HCLTECH', 1.42],
      ['TATASTEEL', 1.28],
      ['COALINDIA', 1.14],
      ['HDFCLIFE', 1.02],
    ],
    other: [
      ['Treps / Reverse Repo', 'MONEY_MARKET', 2.18],
      ['Net Receivables / (Payables)', 'CASH', 0.4],
    ],
  },
  {
    amcName: 'Northstar Asset Management (Sample)',
    amcShortName: 'Northstar',
    schemeName: 'Northstar Balanced Advantage Fund - Direct Plan - Growth',
    category: 'HYBRID',
    subCategory: 'Balanced Advantage Fund',
    benchmark: 'NIFTY 50 Hybrid Composite Debt 50:50 Index',
    riskometer: 'High',
    aumCrore: 14_070,
    nav: 39.7215,
    equity: [
      ['HDFCBANK', 5.12],
      ['ICICIBANK', 4.63],
      ['RELIANCE', 4.21],
      ['INFY', 3.74],
      ['TCS', 3.32],
      ['BHARTIARTL', 2.88],
      ['ITC', 2.61],
      ['LT', 2.34],
      ['SBIN', 2.11],
      ['MARUTI', 1.92],
      ['SUNPHARMA', 1.74],
      ['NTPC', 1.58],
      ['KOTAKBANK', 1.41],
      ['HINDUNILVR', 1.28],
      ['TITAN', 1.12],
      ['AXISBANK', 0.98],
      ['ULTRACEMCO', 0.86],
      ['HCLTECH', 0.74],
    ],
    other: [
      ['7.18% Government of India 2033', 'DEBT', 12.44],
      ['7.26% Government of India 2032', 'DEBT', 9.81],
      ['HDFC Bank Limited 7.85% NCD 2027', 'DEBT', 6.32],
      ['Power Finance Corporation 7.62% NCD 2029', 'DEBT', 5.18],
      ['REC Limited 7.55% NCD 2028', 'DEBT', 4.02],
      ['364 Days Treasury Bill', 'MONEY_MARKET', 3.44],
      ['Treps / Reverse Repo', 'MONEY_MARKET', 8.12],
      ['Net Receivables / (Payables)', 'CASH', 1.08],
    ],
  },
];

export interface FixtureHoldingLine {
  instrumentName: string;
  isin: string | null;
  instrumentType: string;
  weightPct: number;
  quantity: number | null;
  marketValueLakh: number | null;
}

export interface FixtureDisclosure {
  schemeName: string;
  disclosureDate: Date;
  lines: FixtureHoldingLine[];
}

const SYMBOL_INDEX = new Map(STOCK_MASTER.map((s) => [s.nseSymbol, s]));

/**
 * Deterministic pseudo-random in [0,1) derived from a string seed, so that
 * repeated seeding produces byte-identical fixtures. Using Math.random() here
 * would make snapshot checksums churn and defeat the re-import short circuit.
 */
function seededUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

/** Last calendar day of the month `monthsAgo` months before `from`. */
function monthEnd(from: Date, monthsAgo: number): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - monthsAgo + 1, 0));
}

/**
 * Builds `periods` month-end disclosures for a fund. The most recent period is
 * the fund's declared holdings; earlier periods are derived by nudging weights
 * and dropping the tail, which yields realistic additions/exits when the two
 * periods are diffed.
 */
export function buildFixtureDisclosures(
  fund: FixtureFund,
  periods = 3,
  asOf = new Date(),
): FixtureDisclosure[] {
  const out: FixtureDisclosure[] = [];

  for (let p = 0; p < periods; p += 1) {
    const disclosureDate = monthEnd(asOf, p);
    const key = `${fund.schemeName}:${disclosureDate.toISOString()}`;

    // Older periods hold progressively fewer of the tail names, which shows up
    // as "ADDED" positions when comparing an older period to a newer one.
    const dropTail = p === 0 ? 0 : p * 2;
    const equity = fund.equity.slice(0, fund.equity.length - dropTail);

    const raw = equity.map(([symbol, weight], i) => {
      // Deterministic drift of up to ±12% of the weight per period back.
      const drift = p === 0 ? 0 : (seededUnit(`${key}:${symbol}:${i}`) - 0.5) * 0.24 * p;
      return { symbol, weight: Math.max(0.05, weight * (1 + drift)) };
    });

    const otherWeight = fund.other.reduce((s, [, , w]) => s + w, 0);
    const rawEquityWeight = raw.reduce((s, r) => s + r.weight, 0);
    // Re-normalise equity so equity + non-equity lands on 100% exactly, the
    // same invariant a real disclosure satisfies.
    const targetEquityWeight = 100 - otherWeight;
    const scale = targetEquityWeight / rawEquityWeight;

    const lines: FixtureHoldingLine[] = raw.map(({ symbol, weight }) => {
      const stock = SYMBOL_INDEX.get(symbol);
      const weightPct = round4(weight * scale);
      const marketValueLakh = round4((fund.aumCrore * 100 * weightPct) / 100);
      return {
        instrumentName: stock?.name ?? symbol,
        isin: stock?.isin ?? null,
        instrumentType: 'EQUITY',
        weightPct,
        quantity: stock ? Math.round((marketValueLakh * 100_000) / stock.refPrice) : null,
        marketValueLakh,
      };
    });

    for (const [name, type, weight] of fund.other) {
      lines.push({
        instrumentName: name,
        isin: null,
        instrumentType: type,
        weightPct: round4(weight),
        quantity: null,
        marketValueLakh: round4(fund.aumCrore * 100 * (weight / 100)),
      });
    }

    out.push({ schemeName: fund.schemeName, disclosureDate, lines });
  }

  return out;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
