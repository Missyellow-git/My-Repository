import {
  InstrumentType,
  MarketCapCategory,
  PriceQuality,
  type HoldingRow,
  type Quote,
  type StockRef,
} from '@fundlens/shared';

/**
 * Builders for holdings fixtures used across the unit tests.
 *
 * Kept out of the spec files so a change to HoldingRow's shape is fixed in one
 * place, and so every test starts from a realistic row rather than a minimal
 * one — most bugs in this codebase would live in the fields a hand-written
 * stub omits.
 */

let counter = 0;

export function makeStock(overrides: Partial<StockRef> = {}): StockRef {
  counter += 1;
  return {
    id: `stock-${counter}`,
    name: `Test Company ${counter} Limited`,
    isin: `INE000A0${String(counter).padStart(4, '0')}`,
    nseSymbol: `TEST${counter}`,
    bseCode: `50000${counter}`,
    sector: 'Banks',
    industry: 'Private Sector Bank',
    marketCapCrore: 50_000,
    marketCapCategory: MarketCapCategory.MID_CAP,
    ...overrides,
  };
}

export function makeQuote(overrides: Partial<Quote> = {}): Quote {
  const ltp = overrides.ltp ?? 100;
  const prevClose = overrides.prevClose ?? 100;
  return {
    stockId: overrides.stockId ?? 'stock-1',
    exchange: 'NSE',
    ltp,
    open: prevClose,
    high: Math.max(ltp, prevClose),
    low: Math.min(ltp, prevClose),
    prevClose,
    change: ltp - prevClose,
    changePct: prevClose === 0 ? null : ((ltp - prevClose) / prevClose) * 100,
    volume: 1_000_000,
    week52High: ltp * 1.3,
    week52Low: ltp * 0.7,
    week52Avg: ltp,
    quality: PriceQuality.LIVE,
    quotedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    source: 'test',
    ...overrides,
  };
}

export interface HoldingSpec {
  name?: string;
  symbol?: string;
  sector?: string;
  weightPct: number;
  /** Percentage change today. Pass null for "no quote available". */
  changePct?: number | null;
  ltp?: number;
  marketCapCrore?: number;
  marketCapCategory?: MarketCapCategory;
  instrumentType?: InstrumentType;
  /** Simulates a disclosure line we could not map to a listed security. */
  unmapped?: boolean;
  week52Avg?: number;
}

export function makeHolding(spec: HoldingSpec, rank = 1): HoldingRow {
  counter += 1;
  const instrumentType = spec.instrumentType ?? InstrumentType.EQUITY;
  const ltp = spec.ltp ?? 100;

  const stock = spec.unmapped
    ? null
    : makeStock({
        id: `stock-${counter}`,
        name: spec.name ?? `Test Company ${counter} Limited`,
        nseSymbol: spec.symbol ?? `TEST${counter}`,
        sector: spec.sector ?? 'Banks',
        marketCapCrore: spec.marketCapCrore ?? 50_000,
        marketCapCategory: spec.marketCapCategory ?? MarketCapCategory.MID_CAP,
      });

  const hasQuote = spec.changePct !== null && spec.changePct !== undefined && stock !== null;
  const changePct = spec.changePct ?? 0;

  const quote = hasQuote
    ? makeQuote({
        stockId: stock!.id,
        ltp,
        prevClose: ltp / (1 + changePct / 100),
        week52Avg: spec.week52Avg ?? ltp,
      })
    : null;

  return {
    id: `holding-${counter}`,
    instrumentName: spec.name ?? stock?.name ?? `Instrument ${counter}`,
    isin: stock?.isin ?? null,
    instrumentType,
    weightPct: spec.weightPct,
    quantity: 1000,
    marketValueLakh: spec.weightPct * 100,
    rank,
    stock,
    quote,
    mapped: stock !== null,
    mappingConfidence: stock ? 1 : null,
    pctFrom52wAvg:
      quote?.week52Avg && quote.ltp
        ? ((quote.ltp - quote.week52Avg) / quote.week52Avg) * 100
        : null,
    weightedChangePct: quote?.changePct != null ? (spec.weightPct * quote.changePct) / 100 : null,
  };
}

export function makePortfolio(specs: HoldingSpec[]): HoldingRow[] {
  return specs
    .slice()
    .sort((a, b) => b.weightPct - a.weightPct)
    .map((spec, i) => makeHolding(spec, i + 1));
}
