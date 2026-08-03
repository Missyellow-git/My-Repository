import { extractIndianAmountCrore, parseQuestion } from './rule-parser';

/**
 * These cover the exact questions the product promises the assistant can
 * answer. They must all resolve without an LLM — that is what makes the
 * feature work in CI, in development and on deployments with no API key.
 */
describe('parseQuestion — the documented question set', () => {
  it('Which stock has the highest weight in this fund?', () => {
    const spec = parseQuestion('Which stock has the highest weight in this fund?');
    expect(spec).toMatchObject({
      intent: 'rank',
      sort: { field: 'weightPct', direction: 'desc' },
      limit: 1,
    });
  });

  it('Which holdings are down more than 2% today?', () => {
    const spec = parseQuestion('Which holdings are down more than 2% today?');
    expect(spec?.intent).toBe('list');
    expect(spec?.filters).toContainEqual({ field: 'changePct', op: 'lt', value: -2 });
  });

  it('Show all banking stocks', () => {
    const spec = parseQuestion('Show all banking stocks');
    expect(spec?.intent).toBe('list');
    expect(spec?.filters).toContainEqual({ field: 'sector', op: 'contains', value: 'bank' });
  });

  it('Which stock is the biggest gainer today?', () => {
    const spec = parseQuestion('Which stock is the biggest gainer today?');
    expect(spec).toMatchObject({
      intent: 'rank',
      sort: { field: 'changePct', direction: 'desc' },
      limit: 1,
    });
  });

  it('How many IT stocks are in this portfolio?', () => {
    const spec = parseQuestion('How many IT stocks are in this portfolio?');
    expect(spec?.intent).toBe('count');
    expect(spec?.filters).toContainEqual({ field: 'sector', op: 'contains', value: 'it -' });
  });

  it('Which stocks have a market cap above ₹1 lakh crore?', () => {
    const spec = parseQuestion('Which stocks have a market cap above ₹1 lakh crore?');
    expect(spec?.intent).toBe('list');
    expect(spec?.filters).toContainEqual({ field: 'marketCapCrore', op: 'gt', value: 100_000 });
  });

  it('List all small-cap companies', () => {
    const spec = parseQuestion('List all small-cap companies');
    expect(spec?.filters).toContainEqual({
      field: 'marketCapCategory',
      op: 'eq',
      value: 'SMALL_CAP',
    });
  });

  it('Show only stocks trading above their 52-week average', () => {
    const spec = parseQuestion('Show only stocks trading above their 52-week average');
    expect(spec?.filters).toContainEqual({ field: 'pctFrom52wAvg', op: 'gt', value: 0 });
  });

  it("Compare today's movement with each stock's portfolio weight", () => {
    const spec = parseQuestion("Compare today's movement with each stock's portfolio weight");
    expect(spec).toMatchObject({
      intent: 'list',
      sort: { field: 'weightedChangePct', direction: 'desc' },
    });
    expect(spec?.highlightFields).toEqual(expect.arrayContaining(['weightPct', 'changePct']));
  });
});

describe('parseQuestion — direction and threshold handling', () => {
  it('flips the comparison for "up more than"', () => {
    const spec = parseQuestion('Which stocks are up more than 3% today?');
    expect(spec?.filters).toContainEqual({ field: 'changePct', op: 'gt', value: 3 });
  });

  it('handles "down less than 1%" as a bounded, not an open, condition', () => {
    const spec = parseQuestion('Show holdings down less than 1% today');
    expect(spec?.filters).toContainEqual({ field: 'changePct', op: 'gt', value: -1 });
  });

  it('reads a top-N count out of the question', () => {
    expect(parseQuestion('Show me the top 10 holdings')?.limit).toBe(10);
    expect(parseQuestion('top 3 gainers today')?.limit).toBe(3);
  });

  it('clamps an absurd N instead of accepting it', () => {
    expect(parseQuestion('top 999 holdings')?.limit).toBe(200);
  });

  it('reads "below" as the inverse market-cap condition', () => {
    const spec = parseQuestion('Which stocks have a market cap below 20000 crore?');
    expect(spec?.filters).toContainEqual({ field: 'marketCapCrore', op: 'lt', value: 20_000 });
  });

  it('distinguishes losers from gainers', () => {
    expect(parseQuestion('biggest loser today')?.sort).toEqual({
      field: 'changePct',
      direction: 'asc',
    });
    expect(parseQuestion('top gainers')?.sort).toEqual({ field: 'changePct', direction: 'desc' });
  });

  it('groups by sector when asked for an allocation breakdown', () => {
    expect(parseQuestion('Show me the sector allocation')).toMatchObject({
      intent: 'groupBy',
      groupBy: 'sector',
    });
  });

  it('counts equity holdings for "how many stocks"', () => {
    const spec = parseQuestion('How many stocks are in this portfolio?');
    expect(spec?.intent).toBe('count');
    expect(spec?.filters).toContainEqual({ field: 'instrumentType', op: 'eq', value: 'EQUITY' });
  });
});

describe('parseQuestion — escalation to the model', () => {
  it('returns null for questions outside the rule set', () => {
    // These are not failures: they are the cases the LLM exists to cover.
    expect(parseQuestion('Should I invest in this fund?')).toBeNull();
    expect(parseQuestion("What is the fund manager's outlook for next quarter?")).toBeNull();
    expect(parseQuestion('hi')).toBeNull();
  });

  it('does not mistake filler words for a company name lookup', () => {
    expect(parseQuestion('show me the fund')).toBeNull();
    expect(parseQuestion('show me everything about all of the holdings in here please')).toBeNull();
  });

  it('does resolve a plausible company lookup', () => {
    const spec = parseQuestion('Show Infosys');
    expect(spec?.filters).toContainEqual({
      field: 'instrumentName',
      op: 'contains',
      value: 'Infosys',
    });
  });
});

describe('extractIndianAmountCrore', () => {
  it.each([
    ['market cap above ₹1 lakh crore', 100_000],
    ['above 2 lakh crore', 200_000],
    ['more than 50,000 crore', 50_000],
    ['above 5000cr', 5_000],
    ['over 3 thousand crore', 3_000],
  ])('parses "%s"', (text, expected) => {
    expect(extractIndianAmountCrore(text)).toBe(expected);
  });

  it('returns null when there is no amount', () => {
    expect(extractIndianAmountCrore('largest market cap')).toBeNull();
  });
});
