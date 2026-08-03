import { StockMapperService } from './stock-mapper.service';

/**
 * Instrument classification decides whether a disclosure line is treated as a
 * priceable equity position or as debt/cash. Getting it wrong either attaches a
 * stock price to a government bond or drops a real holding out of the table, so
 * every branch is pinned here.
 */
describe('StockMapperService.inferInstrumentType', () => {
  it.each([
    ['Treps / Reverse Repo', null, 'MONEY_MARKET'],
    ['TREPS', null, 'MONEY_MARKET'],
    ['Tri-Party Repo', null, 'MONEY_MARKET'],
    ['364 Days Treasury Bill', null, 'MONEY_MARKET'],
    ['Certificate of Deposit - Bank X', null, 'MONEY_MARKET'],
    ['Net Receivables / (Payables)', null, 'CASH'],
    ['Cash Margin - Derivatives', null, 'CASH'],
    ['7.18% Government of India 2033', null, 'DEBT'],
    ['State Development Loan 2031', null, 'DEBT'],
    ['Power Finance Corporation 7.62% NCD 2029', null, 'DEBT'],
    ['Nifty 50 Index Future', null, 'DERIVATIVE'],
    ['Embassy Office Parks REIT', null, 'REIT_INVIT'],
    ['Some Liquid Fund - Direct Growth', null, 'MUTUAL_FUND_UNIT'],
  ])('classifies "%s" as %s', (name, isin, expected) => {
    expect(StockMapperService.inferInstrumentType(name, isin as string | null)).toBe(expected);
  });

  it('treats a line with an equity ISIN as equity', () => {
    expect(StockMapperService.inferInstrumentType('Infosys Limited', 'INE009A01021')).toBe(
      'EQUITY',
    );
  });

  it('classifies a bare company name with no ISIN as OTHER rather than guessing equity', () => {
    // Being wrong here is worse than being unsure: the import pipeline reports
    // unmapped lines to the user, but a mislabelled one is invisible.
    expect(StockMapperService.inferInstrumentType('Some Unlisted Entity', null)).toBe('OTHER');
  });

  it('puts the debt pattern behind the money-market one', () => {
    // A T-Bill carries no coupon but does match the generic debt pattern via
    // its name; ordering is what keeps it in MONEY_MARKET.
    expect(StockMapperService.inferInstrumentType('182 Days Treasury Bill 2025', null)).toBe(
      'MONEY_MARKET',
    );
  });

  it('does not classify an ordinary company name containing a percent-free number as debt', () => {
    expect(StockMapperService.inferInstrumentType('3M India Limited', 'INE470A01017')).toBe(
      'EQUITY',
    );
  });
});
