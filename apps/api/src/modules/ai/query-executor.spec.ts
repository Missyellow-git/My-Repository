import { MarketCapCategory, querySpecSchema, type QuerySpec } from '@fundlens/shared';
import { makePortfolio } from '../../test-utils/holdings.factory';
import { executeQuery } from './query-executor';
import { parseQuestion } from './rule-parser';

const PORTFOLIO = makePortfolio([
  {
    name: 'Alpha Bank Limited',
    symbol: 'ALPHA',
    sector: 'Banks',
    weightPct: 20,
    changePct: 2.5,
    ltp: 100,
    marketCapCrore: 150_000,
    marketCapCategory: MarketCapCategory.LARGE_CAP,
    week52Avg: 90,
  },
  {
    name: 'Beta Bank Limited',
    symbol: 'BETA',
    sector: 'Banks',
    weightPct: 15,
    changePct: -2.5,
    ltp: 200,
    marketCapCrore: 120_000,
    marketCapCategory: MarketCapCategory.LARGE_CAP,
    week52Avg: 220,
  },
  {
    name: 'Gamma Software Limited',
    symbol: 'GAMMA',
    sector: 'IT - Software',
    weightPct: 12,
    changePct: 4,
    ltp: 1500,
    marketCapCrore: 60_000,
    marketCapCategory: MarketCapCategory.MID_CAP,
    week52Avg: 1400,
  },
  {
    name: 'Delta Pharma Limited',
    symbol: 'DELTA',
    sector: 'Pharmaceuticals',
    weightPct: 8,
    changePct: -5,
    ltp: 800,
    marketCapCrore: 20_000,
    marketCapCategory: MarketCapCategory.SMALL_CAP,
    week52Avg: 850,
  },
  // No quote — exercises the "unknown" versus "zero" distinction throughout.
  {
    name: 'Epsilon Unlisted Holdings',
    symbol: 'EPSILON',
    sector: 'Cement',
    weightPct: 5,
    changePct: null,
    marketCapCrore: 8_000,
    marketCapCategory: MarketCapCategory.SMALL_CAP,
  },
]);

function spec(partial: Partial<QuerySpec> & Pick<QuerySpec, 'intent'>): QuerySpec {
  return querySpecSchema.parse({ filters: [], highlightFields: [], ...partial });
}

describe('executeQuery — filtering', () => {
  it('applies numeric comparisons', () => {
    const result = executeQuery(
      spec({ intent: 'list', filters: [{ field: 'changePct', op: 'lt', value: -2 }] }),
      PORTFOLIO,
    );
    expect(result.rows?.map((r) => r.nseSymbol)).toEqual(['BETA', 'DELTA']);
  });

  it('applies substring matching to text fields, case-insensitively', () => {
    const result = executeQuery(
      spec({ intent: 'list', filters: [{ field: 'sector', op: 'contains', value: 'BANK' }] }),
      PORTFOLIO,
    );
    expect(result.matchedCount).toBe(2);
  });

  it('excludes holdings with no value rather than counting them as zero', () => {
    // EPSILON has no quote. It must not appear in "down more than 1%" just
    // because null compares falsely against everything.
    const down = executeQuery(
      spec({ intent: 'list', filters: [{ field: 'changePct', op: 'lt', value: -1 }] }),
      PORTFOLIO,
    );
    expect(down.rows?.map((r) => r.nseSymbol)).not.toContain('EPSILON');

    // And it must not appear in "not down" either — we do not know.
    const notEqual = executeQuery(
      spec({ intent: 'list', filters: [{ field: 'changePct', op: 'neq', value: -2.5 }] }),
      PORTFOLIO,
    );
    expect(notEqual.rows?.map((r) => r.nseSymbol)).not.toContain('EPSILON');
  });

  it('supports isNull / notNull for talking about missing data explicitly', () => {
    const missing = executeQuery(
      spec({ intent: 'count', filters: [{ field: 'changePct', op: 'isNull' }] }),
      PORTFOLIO,
    );
    expect(missing.scalar?.value).toBe(1);
  });

  it('supports between and in', () => {
    const between = executeQuery(
      spec({ intent: 'list', filters: [{ field: 'weightPct', op: 'between', value: [8, 15] }] }),
      PORTFOLIO,
    );
    expect(between.matchedCount).toBe(3);

    const inList = executeQuery(
      spec({
        intent: 'list',
        filters: [{ field: 'nseSymbol', op: 'in', value: ['ALPHA', 'DELTA'] }],
      }),
      PORTFOLIO,
    );
    expect(inList.matchedCount).toBe(2);
  });

  it('applies multiple filters conjunctively', () => {
    const result = executeQuery(
      spec({
        intent: 'list',
        filters: [
          { field: 'sector', op: 'contains', value: 'bank' },
          { field: 'changePct', op: 'gt', value: 0 },
        ],
      }),
      PORTFOLIO,
    );
    expect(result.rows?.map((r) => r.nseSymbol)).toEqual(['ALPHA']);
  });
});

describe('executeQuery — sorting and ranking', () => {
  it('sorts descending by default and honours limit', () => {
    const result = executeQuery(
      spec({ intent: 'rank', sort: { field: 'changePct', direction: 'desc' }, limit: 2 }),
      PORTFOLIO,
    );
    expect(result.rows?.map((r) => r.nseSymbol)).toEqual(['GAMMA', 'ALPHA']);
    // matchedCount reports the full match set, not the truncated page.
    expect(result.matchedCount).toBe(5);
  });

  it('sorts nulls last in both directions, so an unknown is never "the top"', () => {
    const asc = executeQuery(
      spec({ intent: 'list', sort: { field: 'changePct', direction: 'asc' } }),
      PORTFOLIO,
    );
    const desc = executeQuery(
      spec({ intent: 'list', sort: { field: 'changePct', direction: 'desc' } }),
      PORTFOLIO,
    );
    expect(asc.rows?.at(-1)?.nseSymbol).toBe('EPSILON');
    expect(desc.rows?.at(-1)?.nseSymbol).toBe('EPSILON');
  });

  it('defaults to weight ordering when no sort is given', () => {
    const result = executeQuery(spec({ intent: 'list' }), PORTFOLIO);
    expect(result.rows?.[0].nseSymbol).toBe('ALPHA');
  });
});

describe('executeQuery — aggregation and grouping', () => {
  it('sums a numeric field over the matched rows', () => {
    const result = executeQuery(
      spec({ intent: 'aggregate', aggregate: { op: 'sum', field: 'weightPct' } }),
      PORTFOLIO,
    );
    expect(result.scalar?.value).toBe(60);
    expect(result.scalar?.unit).toBe('%');
  });

  it('averages only over rows that have a value', () => {
    const result = executeQuery(
      spec({ intent: 'aggregate', aggregate: { op: 'avg', field: 'changePct' } }),
      PORTFOLIO,
    );
    // (2.5 - 2.5 + 4 - 5) / 4 = -0.25 — the unpriced holding is not a zero.
    expect(result.scalar?.value).toBeCloseTo(-0.25, 4);
  });

  it('groups by sector with weight, count and weighted move', () => {
    const result = executeQuery(spec({ intent: 'groupBy', groupBy: 'sector' }), PORTFOLIO);
    expect(result.kind).toBe('groups');
    expect(result.groups?.[0]).toMatchObject({ key: 'Banks', weightPct: 35, count: 2 });
    // (20*2.5 + 15*-2.5) / 35 = 12.5/35 = 0.357
    expect(result.groups?.[0].weightedChangePct).toBeCloseTo(0.357, 3);
  });
});

describe('executeQuery — honesty about data gaps', () => {
  it('warns when a price condition is asked of a portfolio with no prices', () => {
    const unpriced = makePortfolio([{ name: 'A Ltd', weightPct: 100, changePct: null }]);
    const result = executeQuery(
      spec({ intent: 'list', filters: [{ field: 'changePct', op: 'gt', value: 0 }] }),
      unpriced,
    );
    expect(result.matchedCount).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/no live prices/i);
  });

  it('returns the model’s stated reason for an unsupported question', () => {
    const result = executeQuery(
      spec({ intent: 'unsupported', reason: 'Past NAV returns are not held in this dataset.' }),
      PORTFOLIO,
    );
    expect(result.kind).toBe('none');
    expect(result.factualSummary).toBe('Past NAV returns are not held in this dataset.');
  });

  it('states plainly when nothing matched', () => {
    const result = executeQuery(
      spec({ intent: 'list', filters: [{ field: 'weightPct', op: 'gt', value: 99 }] }),
      PORTFOLIO,
    );
    expect(result.factualSummary).toMatch(/No holdings out of 5 match/);
  });
});

describe('rule parser + executor, end to end', () => {
  it.each([
    ['Which stock has the highest weight in this fund?', ['ALPHA']],
    ['Which stock is the biggest gainer today?', ['GAMMA']],
    // The rule sorts decliners weakest-first, so the order differs from a
    // plain weight-ordered filter over the same set.
    ['Which holdings are down more than 2% today?', ['DELTA', 'BETA']],
    ['Show all banking stocks', ['ALPHA', 'BETA']],
    ['Show only stocks trading above their 52-week average', ['ALPHA', 'GAMMA']],
  ])('answers "%s" without any model call', (question, expected) => {
    const parsed = parseQuestion(question);
    expect(parsed).not.toBeNull();
    const result = executeQuery(parsed!, PORTFOLIO);
    expect(result.rows?.map((r) => r.nseSymbol)).toEqual(expected);
  });

  it('counts IT holdings', () => {
    const parsed = parseQuestion('How many IT stocks are in this portfolio?');
    const result = executeQuery(parsed!, PORTFOLIO);
    expect(result.scalar?.value).toBe(1);
  });

  it('filters by market cap in Indian notation', () => {
    const parsed = parseQuestion('Which stocks have a market cap above ₹1 lakh crore?');
    const result = executeQuery(parsed!, PORTFOLIO);
    expect(result.rows?.map((r) => r.nseSymbol)).toEqual(['ALPHA', 'BETA']);
  });

  it('ranks holdings by their weighted contribution to the day’s move', () => {
    const parsed = parseQuestion("Compare today's movement with each stock's portfolio weight");
    const result = executeQuery(parsed!, PORTFOLIO);
    // GAMMA moved further (+4% vs +2.5%) but ALPHA contributes more
    // (20 × 2.5 = 0.50 vs 12 × 4 = 0.48) — which is the point of the question.
    expect(result.rows?.[0].nseSymbol).toBe('ALPHA');
    expect(result.rows?.[1].nseSymbol).toBe('GAMMA');
  });
});
