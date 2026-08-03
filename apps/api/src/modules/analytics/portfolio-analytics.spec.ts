import { InstrumentType, MarketCapCategory } from '@fundlens/shared';
import { makePortfolio } from '../../test-utils/holdings.factory';
import {
  computeAnalytics,
  computeContribution,
  computeHhi,
  computeMarketCapAllocation,
  computeSectorAllocation,
} from './portfolio-analytics';

const PORTFOLIO = makePortfolio([
  {
    name: 'Alpha Bank Limited',
    symbol: 'ALPHA',
    sector: 'Banks',
    weightPct: 20,
    changePct: 2,
    ltp: 100,
    marketCapCrore: 150_000,
    marketCapCategory: MarketCapCategory.LARGE_CAP,
  },
  {
    name: 'Beta Bank Limited',
    symbol: 'BETA',
    sector: 'Banks',
    weightPct: 15,
    changePct: -1,
    ltp: 200,
    marketCapCrore: 120_000,
    marketCapCategory: MarketCapCategory.LARGE_CAP,
  },
  {
    name: 'Gamma Software Limited',
    symbol: 'GAMMA',
    sector: 'IT - Software',
    weightPct: 10,
    changePct: 3,
    ltp: 1500,
    marketCapCrore: 60_000,
    marketCapCategory: MarketCapCategory.MID_CAP,
  },
  {
    name: 'Delta Pharma Limited',
    symbol: 'DELTA',
    sector: 'Pharmaceuticals',
    weightPct: 5,
    changePct: -4,
    ltp: 800,
    marketCapCrore: 20_000,
    marketCapCategory: MarketCapCategory.SMALL_CAP,
  },
  {
    name: 'Epsilon Cements Limited',
    symbol: 'EPSILON',
    sector: 'Cement',
    weightPct: 2,
    changePct: 0,
    ltp: 400,
    marketCapCrore: 25_000,
    marketCapCategory: MarketCapCategory.SMALL_CAP,
  },
  {
    name: 'Treps / Reverse Repo',
    weightPct: 48,
    instrumentType: InstrumentType.MONEY_MARKET,
    unmapped: true,
  },
]);

describe('computeAnalytics', () => {
  const analytics = computeAnalytics('fund-1', '2025-07-31', PORTFOLIO);

  it('separates equity from non-equity weight instead of renormalising', () => {
    // The fund holds 52% equity. Reporting 100% would misstate the portfolio.
    expect(analytics.totalStocks).toBe(5);
    expect(analytics.totalEquityWeightPct).toBe(52);
    expect(analytics.nonEquityWeightPct).toBe(48);
    expect(analytics.totalInstruments).toBe(6);
  });

  it('reports the largest and smallest equity positions', () => {
    expect(analytics.highestWeighted?.nseSymbol).toBe('ALPHA');
    expect(analytics.lowestWeighted?.nseSymbol).toBe('EPSILON');
  });

  it('counts advancers, decliners and flat holdings', () => {
    expect(analytics.advancers).toBe(2);
    expect(analytics.decliners).toBe(2);
    expect(analytics.unchanged).toBe(1);
  });

  it('weights the portfolio move by disclosed weight, not by holding count', () => {
    // (20*2 + 15*-1 + 10*3 + 5*-4 + 2*0) / 52 = 35/52 = 0.673
    expect(analytics.weightedAverageChangePct).toBeCloseTo(0.673, 3);
    // The unweighted mean is a different, larger number — both are reported.
    expect(analytics.averageChangePct).toBe(0);
  });

  it('ranks gainers and losers by move, not by weight', () => {
    expect(analytics.topGainers[0].nseSymbol).toBe('GAMMA');
    expect(analytics.topLosers[0].nseSymbol).toBe('DELTA');
  });

  it('reports price coverage so partial data is visible', () => {
    expect(analytics.priceCoverage).toEqual({ withQuote: 5, total: 5 });
  });
});

describe('computeAnalytics with missing prices', () => {
  it('returns null for the portfolio move rather than implying it was flat', () => {
    const unpriced = makePortfolio([
      { name: 'A Ltd', weightPct: 60, changePct: null },
      { name: 'B Ltd', weightPct: 40, changePct: null },
    ]);
    const analytics = computeAnalytics('fund-1', '2025-07-31', unpriced);

    expect(analytics.weightedAverageChangePct).toBeNull();
    expect(analytics.averageChangePct).toBeNull();
    expect(analytics.advancers).toBe(0);
    expect(analytics.priceCoverage).toEqual({ withQuote: 0, total: 2 });
  });

  it('excludes negligible positions from the movers lists', () => {
    const portfolio = makePortfolio([
      { name: 'Big Ltd', weightPct: 90, changePct: 1 },
      // 0.01% is below NEGLIGIBLE_WEIGHT_PCT — a 30% move here is noise.
      { name: 'Dust Ltd', weightPct: 0.01, changePct: 30 },
    ]);
    const analytics = computeAnalytics('fund-1', '2025-07-31', portfolio);

    expect(analytics.topGainers.map((g) => g.stockName)).not.toContain('Dust Ltd');
    expect(analytics.topGainers[0].stockName).toBe('Big Ltd');
  });
});

describe('computeSectorAllocation', () => {
  const equity = PORTFOLIO.filter((h) => h.instrumentType === InstrumentType.EQUITY);
  const allocation = computeSectorAllocation(equity);

  it('aggregates weight per sector, largest first', () => {
    expect(allocation[0]).toMatchObject({ sector: 'Banks', weightPct: 35, stockCount: 2 });
  });

  it('computes each sector’s weighted move', () => {
    // Banks: (20*2 + 15*-1)/35 = 25/35 = 0.714
    expect(allocation[0].weightedChangePct).toBeCloseTo(0.714, 3);
  });

  it('surfaces unmapped instruments rather than dropping their weight', () => {
    const withUnmapped = computeSectorAllocation([
      ...equity,
      ...makePortfolio([{ name: 'Mystery Instrument', weightPct: 5, unmapped: true }]),
    ]);
    const total = withUnmapped.reduce((s, a) => s + a.weightPct, 0);
    expect(total).toBeCloseTo(57, 5);
    expect(withUnmapped.some((a) => a.sector === 'Unmapped')).toBe(true);
  });
});

describe('computeMarketCapAllocation', () => {
  it('buckets by AMFI category in a fixed order', () => {
    const equity = PORTFOLIO.filter((h) => h.instrumentType === InstrumentType.EQUITY);
    const allocation = computeMarketCapAllocation(equity);

    expect(allocation.map((a) => a.category)).toEqual([
      MarketCapCategory.LARGE_CAP,
      MarketCapCategory.MID_CAP,
      MarketCapCategory.SMALL_CAP,
    ]);
    expect(allocation[0].weightPct).toBe(35);
  });
});

describe('computeHhi', () => {
  it('scores a single-holding portfolio at the 10000 maximum', () => {
    expect(computeHhi(makePortfolio([{ name: 'Only Ltd', weightPct: 100, changePct: 0 }]))).toBe(
      10_000,
    );
  });

  it('scores an evenly spread portfolio low', () => {
    const even = makePortfolio(
      Array.from({ length: 50 }, (_, i) => ({ name: `Co ${i}`, weightPct: 2, changePct: 0 })),
    );
    expect(computeHhi(even)).toBeCloseTo(200, 0);
  });

  it('is computed over the equity sleeve, so a cash-heavy fund is not mislabelled', () => {
    // Two equal equity positions inside a 20% equity sleeve are just as
    // concentrated as two equal positions in a fully invested fund.
    const cashHeavy = makePortfolio([
      { name: 'A Ltd', weightPct: 10, changePct: 0 },
      { name: 'B Ltd', weightPct: 10, changePct: 0 },
    ]);
    expect(computeHhi(cashHeavy)).toBe(5_000);
  });

  it('returns 0 for an empty portfolio instead of dividing by zero', () => {
    expect(computeHhi([])).toBe(0);
  });
});

describe('computeContribution', () => {
  it('orders by absolute contribution, not by the size of the move', () => {
    const rows = computeContribution(
      PORTFOLIO.filter((h) => h.instrumentType === InstrumentType.EQUITY),
    );

    // ALPHA: 20% × +2% = 0.40 beats DELTA: 5% × -4% = -0.20, even though
    // DELTA moved twice as far.
    expect(rows[0].nseSymbol).toBe('ALPHA');
    expect(rows[0].contributionPct).toBeCloseTo(0.4, 4);
    expect(rows.find((r) => r.nseSymbol === 'DELTA')?.contributionPct).toBeCloseTo(-0.2, 4);
  });

  it('expresses each holding’s share of total absolute movement', () => {
    const rows = computeContribution(
      PORTFOLIO.filter((h) => h.instrumentType === InstrumentType.EQUITY),
    );
    const totalShare = rows.reduce((s, r) => s + (r.shareOfMovePct ?? 0), 0);
    expect(totalShare).toBeCloseTo(100, 1);
  });
});
