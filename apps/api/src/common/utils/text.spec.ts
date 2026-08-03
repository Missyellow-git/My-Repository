import {
  detectOptionType,
  detectPlanType,
  escapeLike,
  normalizeName,
  normalizeSchemeName,
  prettifyInstrumentName,
  similarity,
} from './text';

describe('normalizeName', () => {
  it('collapses the corporate-suffix spellings that disclosures disagree on', () => {
    const forms = ['HDFC Bank Limited', 'HDFC BANK LTD.', 'Hdfc Bank Ltd', 'HDFC  Bank   Limited '];
    const normalized = forms.map(normalizeName);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('hdfc bank');
  });

  it('treats & and "and" as the same token', () => {
    expect(normalizeName('Mahindra & Mahindra Ltd')).toBe(
      normalizeName('Mahindra and Mahindra Limited'),
    );
  });

  it('strips punctuation that varies between sources', () => {
    expect(normalizeName('K.P.R. Mill Limited')).toBe('k p r mill');
    expect(normalizeName('Bajaj-Auto Ltd.')).toBe('bajaj auto');
  });

  it('does not merge genuinely different companies', () => {
    expect(normalizeName('Tata Steel Limited')).not.toBe(
      normalizeName('Tata Steel Long Products Limited'),
    );
  });
});

describe('normalizeSchemeName', () => {
  it('drops boilerplate scheme words so plan variants align', () => {
    expect(normalizeSchemeName('Northstar Flexi Cap Fund - Direct Plan - Growth')).toBe(
      'northstar flexi cap direct growth',
    );
  });

  it('keeps the distinguishing part of the name', () => {
    const small = normalizeSchemeName('Meridian Small Cap Fund - Direct Plan - Growth');
    const mid = normalizeSchemeName('Meridian Mid Cap Fund - Direct Plan - Growth');
    expect(small).not.toBe(mid);
  });
});

describe('plan and option detection', () => {
  it.each([
    ['ABC Fund - Direct Plan - Growth', 'DIRECT', 'GROWTH'],
    ['ABC Fund - Regular Plan - IDCW', 'REGULAR', 'IDCW'],
    ['ABC Fund - Dividend Payout', 'UNKNOWN', 'IDCW'],
    ['ABC Fund', 'UNKNOWN', 'UNKNOWN'],
  ])('classifies %s', (name, plan, option) => {
    expect(detectPlanType(name)).toBe(plan);
    expect(detectOptionType(name)).toBe(option);
  });
});

describe('similarity', () => {
  it('scores an exact match at 1', () => {
    expect(similarity('Infosys Limited', 'Infosys Ltd')).toBe(1);
  });

  it('scores a dropped qualifier below 1 but well above zero', () => {
    const score = similarity('Bajaj Finance Limited', 'Bajaj Finance');
    expect(score).toBe(1); // "Limited" is a stripped suffix, not a token
    expect(similarity('Tata Steel', 'Tata Steel Long Products')).toBeGreaterThan(0.4);
    expect(similarity('Tata Steel', 'Tata Steel Long Products')).toBeLessThan(1);
  });

  it('scores unrelated companies low', () => {
    expect(similarity('Infosys Limited', 'Britannia Industries Limited')).toBeLessThan(0.3);
  });

  it('is symmetric', () => {
    expect(similarity('A B C', 'A B')).toBe(similarity('A B', 'A B C'));
  });

  it('handles empty input without throwing', () => {
    expect(similarity('', 'Infosys')).toBe(0);
    expect(similarity('Ltd', 'Limited')).toBe(0);
  });
});

describe('escapeLike', () => {
  it('neutralises LIKE wildcards in user input', () => {
    expect(escapeLike('100% equity')).toBe('100\\% equity');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
  });
});

describe('prettifyInstrumentName', () => {
  it('title-cases shouted names while preserving short acronyms', () => {
    expect(prettifyInstrumentName('RELIANCE INDUSTRIES LIMITED')).toBe(
      'Reliance Industries Limited',
    );
    expect(prettifyInstrumentName('ITC LIMITED')).toBe('ITC Limited');
  });

  it('leaves already-cased names alone', () => {
    expect(prettifyInstrumentName('Reliance Industries Limited')).toBe(
      'Reliance Industries Limited',
    );
  });
});
