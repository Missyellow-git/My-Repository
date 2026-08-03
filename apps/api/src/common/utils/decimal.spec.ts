import { mean, pctChange, round, sum, weightedMean } from './decimal';

describe('round', () => {
  it('rounds half away from zero symmetrically', () => {
    expect(round(2.345, 2)).toBe(2.35);
    expect(round(-2.345, 2)).toBe(-2.35);
  });

  it('never produces negative zero', () => {
    expect(Object.is(round(-0.0001, 2), 0)).toBe(true);
  });
});

describe('pctChange', () => {
  it('computes percentage change against the previous close', () => {
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(90, 100)).toBe(-10);
  });

  it('returns null rather than Infinity when the base is zero or missing', () => {
    expect(pctChange(110, 0)).toBeNull();
    expect(pctChange(110, null)).toBeNull();
    expect(pctChange(null, 100)).toBeNull();
  });
});

describe('weightedMean', () => {
  it('weights each value by its portfolio weight', () => {
    // 10% at +5% and 90% at -1% → 0.1*5 + 0.9*(-1) = -0.4
    expect(
      weightedMean([
        { weight: 10, value: 5 },
        { weight: 90, value: -1 },
      ]),
    ).toBe(-0.4);
  });

  it('ignores holdings with no measurable value instead of treating them as zero', () => {
    // The unpriced 90% must not drag the answer toward zero.
    expect(
      weightedMean([
        { weight: 10, value: 5 },
        { weight: 90, value: null },
      ]),
    ).toBe(5);
  });

  it('returns null when nothing is measurable', () => {
    // "We don't know" is not the same as "it didn't move" — the UI renders
    // these differently, so the distinction has to survive the maths.
    expect(weightedMean([{ weight: 100, value: null }])).toBeNull();
    expect(weightedMean([])).toBeNull();
  });

  it('ignores non-positive weights', () => {
    expect(
      weightedMean([
        { weight: 0, value: 999 },
        { weight: 50, value: 2 },
      ]),
    ).toBe(2);
  });
});

describe('mean', () => {
  it('averages only the present values', () => {
    expect(mean([1, null, 3])).toBe(2);
  });

  it('returns null for an all-null input', () => {
    expect(mean([null, null])).toBeNull();
  });
});

describe('sum', () => {
  it('treats nulls as zero, since a missing weight contributes nothing', () => {
    expect(sum([1.5, null, 2.25])).toBe(3.75);
  });
});
