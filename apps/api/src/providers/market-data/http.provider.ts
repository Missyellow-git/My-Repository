import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../common/config/configuration';
import { ProviderTimeoutException } from '../../common/errors';
import { ApiLogService } from '../api-log.service';
import type {
  MarketDataProvider,
  QuoteFetchResult,
  QuoteRequest,
  RawQuote,
} from './market-data.types';

/**
 * Adapter for a licensed REST market-data vendor.
 *
 * It targets the shape virtually every Indian vendor exposes — a batch quote
 * endpoint keyed by NSE symbol, authenticated with a header API key:
 *
 *   GET {BASE_URL}/quotes?symbols=INFY,TCS,HDFCBANK
 *   → { "data": [ { "symbol": "INFY", "last_price": 1880.4, ... } ] }
 *
 * `mapVendorQuote` is the only place vendor field names appear. Pointing this
 * at a different vendor means editing that one function (or subclassing and
 * overriding it), which is deliberately the smallest possible surface.
 *
 * What this class does NOT do, on purpose:
 *  - it does not scrape NSE/BSE websites. Their terms prohibit it, the payloads
 *    are unstable, and the resulting product would be undeployable;
 *  - it does not retry internally. Retries belong to the BullMQ job that calls
 *    it, where backoff is observable and bounded.
 */
@Injectable()
export class HttpMarketDataProvider implements MarketDataProvider {
  readonly name = 'http';
  private readonly logger = new Logger(HttpMarketDataProvider.name);

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly apiLog: ApiLogService,
  ) {}

  private get env() {
    return this.config.get('env', { infer: true });
  }

  async fetchQuotes(requests: QuoteRequest[]): Promise<QuoteFetchResult> {
    const symbolToStockId = new Map<string, string>();
    for (const r of requests) {
      if (r.nseSymbol) symbolToStockId.set(r.nseSymbol.toUpperCase(), r.stockId);
    }

    const symbols = [...symbolToStockId.keys()];
    if (symbols.length === 0) {
      return {
        quotes: [],
        missing: requests.map((r) => r.stockId),
        partial: false,
        provider: this.name,
      };
    }

    const url = `${this.env.MARKET_DATA_BASE_URL!.replace(/\/$/, '')}/quotes?symbols=${encodeURIComponent(symbols.join(','))}`;
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.env.MARKET_DATA_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(this.env.MARKET_DATA_API_KEY
            ? { [this.env.MARKET_DATA_API_KEY_HEADER]: this.env.MARKET_DATA_API_KEY }
            : {}),
        },
      });

      const latencyMs = Date.now() - started;

      if (response.status === 429) {
        this.apiLog.record({
          provider: this.name,
          endpoint: '/quotes',
          httpStatus: 429,
          outcome: 'rate_limited',
          latencyMs,
          itemCount: symbols.length,
        });
        // Surfaced as a partial result rather than an exception: the caller
        // keeps its cached quotes and marks them delayed.
        return { quotes: [], missing: [], partial: true, provider: this.name };
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.apiLog.record({
          provider: this.name,
          endpoint: '/quotes',
          httpStatus: response.status,
          outcome: 'error',
          latencyMs,
          itemCount: symbols.length,
          errorMessage: body.slice(0, 500),
        });
        throw new Error(`Market data provider returned ${response.status}`);
      }

      const payload = (await response.json()) as { data?: unknown[] };
      const rows = Array.isArray(payload.data) ? payload.data : [];

      const quotes: RawQuote[] = [];
      const seen = new Set<string>();

      for (const row of rows) {
        const mapped = this.mapVendorQuote(row as Record<string, unknown>, symbolToStockId);
        if (mapped) {
          quotes.push(mapped);
          seen.add(mapped.symbol);
        }
      }

      const missing = symbols.filter((s) => !seen.has(s)).map((s) => symbolToStockId.get(s)!);

      this.apiLog.record({
        provider: this.name,
        endpoint: '/quotes',
        httpStatus: response.status,
        outcome: 'ok',
        latencyMs,
        itemCount: quotes.length,
      });

      if (missing.length > 0) {
        this.logger.warn(`Provider had no data for ${missing.length}/${symbols.length} symbols`);
      }

      return { quotes, missing, partial: false, provider: this.name };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const isAbort = (err as Error).name === 'AbortError';
      this.apiLog.record({
        provider: this.name,
        endpoint: '/quotes',
        outcome: isAbort ? 'timeout' : 'error',
        latencyMs,
        itemCount: symbols.length,
        errorMessage: (err as Error).message,
      });
      if (isAbort) throw new ProviderTimeoutException(this.name, this.env.MARKET_DATA_TIMEOUT_MS);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.env.MARKET_DATA_BASE_URL) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const res = await fetch(`${this.env.MARKET_DATA_BASE_URL.replace(/\/$/, '')}/health`, {
        signal: controller.signal,
        headers: this.env.MARKET_DATA_API_KEY
          ? { [this.env.MARKET_DATA_API_KEY_HEADER]: this.env.MARKET_DATA_API_KEY }
          : {},
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Vendor payload → internal quote. Accepts the handful of field-name
   * conventions Indian vendors use so most integrations need no edit at all.
   */
  protected mapVendorQuote(
    row: Record<string, unknown>,
    symbolToStockId: Map<string, string>,
  ): RawQuote | null {
    const symbol = String(
      row.symbol ?? row.tradingSymbol ?? row.trading_symbol ?? '',
    ).toUpperCase();
    const stockId = symbolToStockId.get(symbol);
    if (!stockId) return null;

    const num = (...keys: string[]): number | null => {
      for (const k of keys) {
        const v = row[k];
        if (v === null || v === undefined || v === '') continue;
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return null;
    };

    const ts = row.timestamp ?? row.last_trade_time ?? row.lastTradeTime;
    const quotedAt = ts ? new Date(String(ts)) : null;

    return {
      stockId,
      symbol,
      exchange: String(row.exchange ?? 'NSE').toUpperCase() === 'BSE' ? 'BSE' : 'NSE',
      ltp: num('last_price', 'lastPrice', 'ltp', 'close'),
      open: num('open', 'openPrice'),
      high: num('high', 'dayHigh', 'day_high'),
      low: num('low', 'dayLow', 'day_low'),
      prevClose: num('prev_close', 'prevClose', 'previousClose'),
      volume: num('volume', 'totalTradedVolume', 'total_traded_volume'),
      week52High: num('week_52_high', 'yearHigh', 'week52High'),
      week52Low: num('week_52_low', 'yearLow', 'week52Low'),
      quotedAt: quotedAt && !Number.isNaN(quotedAt.getTime()) ? quotedAt : null,
    };
  }
}
