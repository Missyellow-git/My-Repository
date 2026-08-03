/**
 * Market-data provider contract.
 *
 * The rest of the application depends only on this interface, so switching from
 * the simulated feed to a licensed vendor is a configuration change plus one
 * adapter — no service, controller or UI code moves.
 */

export const MARKET_DATA_PROVIDER = Symbol('MARKET_DATA_PROVIDER');

export interface QuoteRequest {
  /** Internal stock id, echoed back so callers can join without a lookup. */
  stockId: string;
  nseSymbol: string | null;
  bseCode: string | null;
}

export interface RawQuote {
  stockId: string;
  symbol: string;
  exchange: 'NSE' | 'BSE';
  ltp: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  week52High: number | null;
  week52Low: number | null;
  /** Exchange timestamp of the quote, not our receipt time. */
  quotedAt: Date | null;
}

export interface QuoteFetchResult {
  quotes: RawQuote[];
  /** Symbols the provider had no data for. Drives SYMBOL_MAPPING_MISSING. */
  missing: string[];
  /** True when the batch was cut short by the rate limiter. */
  partial: boolean;
  provider: string;
}

export interface MarketDataProvider {
  readonly name: string;
  /**
   * Fetches quotes for up to `MARKET_DATA_BATCH_SIZE` securities. Implementations
   * must never throw for individual missing symbols — those belong in `missing`
   * — and must reject only on transport/auth failures the caller should retry.
   */
  fetchQuotes(requests: QuoteRequest[]): Promise<QuoteFetchResult>;
  /** Cheap connectivity probe for the readiness endpoint. */
  healthCheck(): Promise<boolean>;
}
