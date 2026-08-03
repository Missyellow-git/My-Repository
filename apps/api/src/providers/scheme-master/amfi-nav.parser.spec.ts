import { parseAmfiNavAll, parseAmfiDate } from './amfi-nav.parser';

/**
 * A faithful slice of AMFI's NAVAll.txt, including the parts that break naive
 * parsers: the header line, category headers, bare AMC names, "N.A." NAVs,
 * missing ISINs, and a scheme code repeated across two category blocks.
 */
const SAMPLE = `Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date

Open Ended Schemes(Equity Scheme - Large Cap Fund)

Northstar Asset Management
100001;INF209K01AB1;INF209K01AC9;Northstar Large Cap Fund - Direct Plan - Growth;512.3456;31-Jul-2025
100002;INF209K01AD7;-;Northstar Large Cap Fund - Regular Plan - IDCW;98.1200;31-Jul-2025

Open Ended Schemes(Debt Scheme - Liquid Fund)

Meridian Mutual Fund
200001;INF109K01XY2;INF109K01XZ9;Meridian Liquid Fund - Direct Plan - Growth;N.A.;31-Jul-2025
200002;INVALIDISIN;;Meridian Liquid Fund - Regular Plan - Growth;1,024.5000;31-Jul-2025

Open Ended Schemes(Hybrid Scheme - Balanced Advantage Fund)

Sentinel AMC
300001;INF999K01PQ3;INF999K01PR1;Sentinel Balanced Advantage Fund - Direct Plan - Growth;39.7215;31-Jul-2025
malformed;row;only;three
100001;INF209K01AB1;INF209K01AC9;Northstar Large Cap Fund - Direct Plan - Growth;512.3456;31-Jul-2025
`;

describe('parseAmfiNavAll', () => {
  const { schemes, warnings } = parseAmfiNavAll(SAMPLE);

  it('parses every well-formed row', () => {
    // Five distinct schemes: the malformed line and the repeated code are skipped.
    expect(schemes).toHaveLength(5);
  });

  it('attributes each scheme to the AMC header above it, not the file’s first AMC', () => {
    expect(schemes.find((s) => s.amfiSchemeCode === '100001')?.amcName).toBe(
      'Northstar Asset Management',
    );
    expect(schemes.find((s) => s.amfiSchemeCode === '200001')?.amcName).toBe(
      'Meridian Mutual Fund',
    );
    expect(schemes.find((s) => s.amfiSchemeCode === '300001')?.amcName).toBe('Sentinel AMC');
  });

  it('classifies category and sub-category from the block header', () => {
    expect(schemes.find((s) => s.amfiSchemeCode === '100001')).toMatchObject({
      category: 'EQUITY',
      subCategory: 'Large Cap Fund',
    });
    expect(schemes.find((s) => s.amfiSchemeCode === '200001')).toMatchObject({
      category: 'DEBT',
      subCategory: 'Liquid Fund',
    });
    expect(schemes.find((s) => s.amfiSchemeCode === '300001')?.category).toBe('HYBRID');
  });

  it('derives plan and option from the scheme name', () => {
    expect(schemes.find((s) => s.amfiSchemeCode === '100001')).toMatchObject({
      planType: 'DIRECT',
      optionType: 'GROWTH',
    });
    expect(schemes.find((s) => s.amfiSchemeCode === '100002')).toMatchObject({
      planType: 'REGULAR',
      optionType: 'IDCW',
    });
  });

  it('treats "N.A." as an absent NAV rather than as zero', () => {
    // A zero NAV would render as ₹0.00 in the UI and look like a collapsed fund.
    expect(schemes.find((s) => s.amfiSchemeCode === '200001')?.nav).toBeNull();
  });

  it('strips thousands separators from NAV values', () => {
    expect(schemes.find((s) => s.amfiSchemeCode === '200002')?.nav).toBe(1024.5);
  });

  it('rejects malformed ISINs instead of storing them', () => {
    const scheme = schemes.find((s) => s.amfiSchemeCode === '200002');
    expect(scheme?.isinGrowth).toBeNull();
    expect(scheme?.isinDivReinv).toBeNull();
  });

  it('treats "-" as an absent ISIN', () => {
    expect(schemes.find((s) => s.amfiSchemeCode === '100002')?.isinDivReinv).toBeNull();
  });

  it('keeps only the first occurrence of a repeated scheme code', () => {
    expect(schemes.filter((s) => s.amfiSchemeCode === '100001')).toHaveLength(1);
  });

  it('records a warning for the malformed row rather than throwing', () => {
    expect(warnings.some((w) => w.includes('malformed'))).toBe(true);
  });

  it('normalises the scheme name for search', () => {
    expect(schemes.find((s) => s.amfiSchemeCode === '100001')?.normalizedName).toBe(
      'northstar large cap direct growth',
    );
  });

  it('warns loudly when nothing parses, so a format change is visible', () => {
    const empty = parseAmfiNavAll('completely unexpected content\n');
    expect(empty.schemes).toHaveLength(0);
    expect(empty.warnings.join(' ')).toMatch(/format may have changed/i);
  });
});

describe('parseAmfiDate', () => {
  it('parses AMFI’s DD-Mon-YYYY format as UTC', () => {
    const date = parseAmfiDate('31-Jul-2025');
    expect(date?.toISOString().slice(0, 10)).toBe('2025-07-31');
  });

  it('returns null for anything else', () => {
    expect(parseAmfiDate('2025-07-31')).toBeNull();
    expect(parseAmfiDate('31-Jly-2025')).toBeNull();
    expect(parseAmfiDate('')).toBeNull();
  });
});
