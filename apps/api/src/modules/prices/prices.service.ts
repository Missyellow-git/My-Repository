import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheKeys, CacheTtl, PriceQuality, type Quote } from '@fundlens/shared';
import { CacheService } from '../../cache/cache.service';
import { RateLimiterService } from '../../cache/rate-limiter.service';
import type { AppConfig } from '../../common/config/configuration';
import { pctChange, round, toBigIntNum, toNum } from '../../common/utils/decimal';
import { isMarketOpen, isPostCloseSettlingWindow } from '../../common/utils/market-hours';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MARKET_DATA_PROVIDER,
  type MarketDataProvider,
  type QuoteRequest,
} from '../../providers/market-data/market-data.types';

export interface QuoteLookupResult {
  quotes: Map<string, Quote>;
  /** True when at least one quote is older than the staleness threshold. */
  degraded: boolean;
  fetchedAt: Date | null;
}

/**
 * Read and refresh path for live prices.
 *
 * Layering (fastest first):
 *   Redis (≤45s)  →  stock_prices table  →  provider fetch
 *
 * The dashboard read never calls the provider synchronously for a large
 * portfolio; it returns whatever it has, flagged with a quality level, and lets
 * the background refresh job catch up. That keeps p99 latency flat when the
 * vendor is slow, at the cost of a quote occasionally being a minute old —
 * which is the correct trade for a holdings dashboard, and is disclosed in the
 * UI rather than hidden.
 */
@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly rateLimiter: RateLimiterService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(MARKET_DATA_PROVIDER) private readonly provider: MarketDataProvider,
  ) {}

  private get env() {
    return this.config.get('env', { infer: true });
  }

  /**
   * Quotes for a set of stock ids, keyed by stock id.
   *
   * @param allowSyncFetch When true (small requests, e.g. an explicit
   *   /prices call) a cache miss may hit the provider inline. The dashboard
   *   passes false so a cold cache degrades rather than blocks.
   */
  async getQuotes(stockIds: string[], allowSyncFetch = false): Promise<QuoteLookupResult> {
    if (stockIds.length === 0) {
      return { quotes: new Map(), degraded: false, fetchedAt: null };
    }

    const stocks = await this.prisma.stock.findMany({
      where: { id: { in: stockIds } },
      select: { id: true, nseSymbol: true, bseCode: true },
    });

    const symbolById = new Map(stocks.map((s) => [s.id, s.nseSymbol ?? s.bseCode ?? null]));

    // 1. Redis.
    const cacheKeys = stocks
      .filter((s) => s.nseSymbol)
      .map((s) => ({ id: s.id, key: CacheKeys.quote(s.nseSymbol!) }));
    const cached = await this.cache.mget<Quote>(cacheKeys.map((k) => k.key));

    const quotes = new Map<string, Quote>();
    for (const { id, key } of cacheKeys) {
      const hit = cached.get(key);
      if (hit) quotes.set(id, hit);
    }

    // 2. Postgres for whatever Redis did not have.
    const missingIds = stockIds.filter((id) => !quotes.has(id));
    if (missingIds.length > 0) {
      const rows = await this.prisma.stockPrice.findMany({
        where: { stockId: { in: missingIds } },
      });
      const warm: Array<{ key: string; value: Quote; ttlSeconds: number }> = [];
      for (const row of rows) {
        const quote = this.toQuote(row);
        quotes.set(row.stockId, quote);
        const symbol = symbolById.get(row.stockId);
        // Only re-warm Redis with quotes that are still fresh; caching a stale
        // row would keep it alive past its own expiry window.
        if (symbol && quote.quality === PriceQuality.LIVE) {
          warm.push({ key: CacheKeys.quote(symbol), value: quote, ttlSeconds: CacheTtl.QUOTE });
        }
      }
      await this.cache.mset(warm);
    }

    // 3. Provider, only if explicitly allowed and the batch is small.
    const stillMissing = stockIds.filter((id) => !quotes.has(id));
    if (
      allowSyncFetch &&
      stillMissing.length > 0 &&
      stillMissing.length <= this.env.MARKET_DATA_BATCH_SIZE
    ) {
      const fetched = await this.refresh(stillMissing);
      for (const [id, q] of fetched) quotes.set(id, q);
    }

    let degraded = false;
    let newest: Date | null = null;
    for (const q of quotes.values()) {
      if (q.quality === PriceQuality.STALE || q.quality === PriceQuality.UNAVAILABLE)
        degraded = true;
      if (q.fetchedAt) {
        const t = new Date(q.fetchedAt);
        if (!newest || t > newest) newest = t;
      }
    }
    if (stillMissing.length > 0) degraded = true;

    return { quotes, degraded, fetchedAt: newest };
  }

  /**
   * Fetches from the provider, persists, and warms the cache.
   *
   * Respects the licensed rate limit: when no token is available the call is
   * skipped entirely rather than queued, because a queued quote that arrives
   * 30 seconds late is worth less than the next scheduled refresh.
   */
  async refresh(stockIds: string[]): Promise<Map<string, Quote>> {
    const out = new Map<string, Quote>();
    if (stockIds.length === 0) return out;

    const stocks = await this.prisma.stock.findMany({
      where: { id: { in: stockIds }, isActive: true },
      select: { id: true, nseSymbol: true, bseCode: true },
    });

    const requests: QuoteRequest[] = stocks
      .filter((s) => s.nseSymbol || s.bseCode)
      .map((s) => ({ stockId: s.id, nseSymbol: s.nseSymbol, bseCode: s.bseCode }));

    const batchSize = this.env.MARKET_DATA_BATCH_SIZE;

    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);

      const decision = await this.rateLimiter.consume(
        'market-data',
        this.env.MARKET_DATA_RATE_LIMIT_PER_MIN,
      );
      if (!decision.allowed) {
        this.logger.warn(
          `Rate limit reached for ${this.provider.name}; skipping ${requests.length - i} symbols (retry in ${decision.retryAfterMs}ms)`,
        );
        break;
      }

      try {
        const result = await this.provider.fetchQuotes(batch);
        const persisted = await this.persistQuotes(result.quotes);
        for (const [id, q] of persisted) out.set(id, q);

        if (result.missing.length > 0) {
          await this.markFetchFailures(result.missing);
        }
        if (result.partial) break;
      } catch (err) {
        this.logger.error(
          `Quote fetch failed for batch of ${batch.length}: ${(err as Error).message}`,
        );
        await this.markFetchFailures(batch.map((b) => b.stockId));
        // Stop the whole refresh: if one batch failed on transport, the rest
        // almost certainly will too, and hammering a struggling vendor is how
        // a soft failure becomes a hard ban.
        break;
      }
    }

    return out;
  }

  /** Writes quotes to Postgres and Redis. Returns the serialisable form. */
  private async persistQuotes(
    raw: Awaited<ReturnType<MarketDataProvider['fetchQuotes']>>['quotes'],
  ) {
    const out = new Map<string, Quote>();
    if (raw.length === 0) return out;

    const week52Avgs = await this.week52Averages(raw.map((q) => q.stockId));
    const now = new Date();
    const cacheEntries: Array<{ key: string; value: Quote; ttlSeconds: number }> = [];

    await this.prisma.$transaction(
      raw.map((q) => {
        const change =
          q.ltp !== null && q.prevClose !== null ? round(q.ltp - q.prevClose, 4) : null;
        const changePct = pctChange(q.ltp, q.prevClose);
        const data = {
          exchange: q.exchange,
          ltp: q.ltp,
          open: q.open,
          high: q.high,
          low: q.low,
          prevClose: q.prevClose,
          change,
          changePct,
          volume: q.volume === null ? null : BigInt(Math.round(q.volume)),
          week52High: q.week52High,
          week52Low: q.week52Low,
          week52Avg: week52Avgs.get(q.stockId) ?? null,
          quotedAt: q.quotedAt,
          fetchedAt: now,
          source: this.provider.name,
          failureCount: 0,
        };
        return this.prisma.stockPrice.upsert({
          where: { stockId: q.stockId },
          create: { stockId: q.stockId, ...data },
          update: data,
        });
      }),
    );

    for (const q of raw) {
      const change = q.ltp !== null && q.prevClose !== null ? round(q.ltp - q.prevClose, 4) : null;
      const quote: Quote = {
        stockId: q.stockId,
        exchange: q.exchange,
        ltp: q.ltp,
        open: q.open,
        high: q.high,
        low: q.low,
        prevClose: q.prevClose,
        change,
        changePct: pctChange(q.ltp, q.prevClose),
        volume: q.volume,
        week52High: q.week52High,
        week52Low: q.week52Low,
        week52Avg: week52Avgs.get(q.stockId) ?? null,
        quality: this.qualityFor(q.quotedAt ?? now, now),
        quotedAt: (q.quotedAt ?? now).toISOString(),
        fetchedAt: now.toISOString(),
        source: this.provider.name,
      };
      out.set(q.stockId, quote);
      cacheEntries.push({
        key: CacheKeys.quote(q.symbol),
        value: quote,
        ttlSeconds: CacheTtl.QUOTE,
      });
    }

    await this.cache.mset(cacheEntries);
    return out;
  }

  /**
   * 52-week average close from the daily bars.
   *
   * Computed in SQL rather than in Node because the alternative is pulling
   * ~250 rows per stock across a few hundred stocks on every refresh.
   */
  private async week52Averages(stockIds: string[]): Promise<Map<string, number>> {
    if (stockIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ stockId: string; avg: number | null }>>`
      SELECT "stockId", AVG(close)::float8 AS avg
      FROM daily_bars
      WHERE "stockId" = ANY(${stockIds}::uuid[])
        AND date >= CURRENT_DATE - INTERVAL '52 weeks'
      GROUP BY "stockId"
    `;
    return new Map(
      rows.filter((r) => r.avg !== null).map((r) => [r.stockId, round(Number(r.avg), 4)]),
    );
  }

  /** Increments the failure counter so persistent bad mappings become visible. */
  private async markFetchFailures(stockIds: string[]): Promise<void> {
    if (stockIds.length === 0) return;
    await this.prisma.stockPrice
      .updateMany({
        where: { stockId: { in: stockIds } },
        data: { failureCount: { increment: 1 } },
      })
      .catch(() => undefined);
  }

  /**
   * Quality label for a quote. This is what the UI's badge renders, and it is
   * derived from the *exchange* timestamp so a vendor returning old data
   * quickly is still reported as stale.
   */
  private qualityFor(quotedAt: Date | null, now = new Date()): PriceQuality {
    if (!quotedAt) return PriceQuality.UNAVAILABLE;
    const ageSeconds = (now.getTime() - quotedAt.getTime()) / 1000;
    const marketLive = isMarketOpen() || isPostCloseSettlingWindow();

    if (!marketLive) return PriceQuality.MARKET_CLOSED;
    if (ageSeconds <= this.env.PRICE_REFRESH_INTERVAL_SECONDS * 1.5) return PriceQuality.LIVE;
    if (ageSeconds <= this.env.PRICE_STALE_AFTER_SECONDS) return PriceQuality.DELAYED;
    return PriceQuality.STALE;
  }

  private toQuote(row: {
    stockId: string;
    exchange: string;
    ltp: unknown;
    open: unknown;
    high: unknown;
    low: unknown;
    prevClose: unknown;
    change: unknown;
    changePct: unknown;
    volume: bigint | null;
    week52High: unknown;
    week52Low: unknown;
    week52Avg: unknown;
    quotedAt: Date | null;
    fetchedAt: Date;
    source: string;
  }): Quote {
    return {
      stockId: row.stockId,
      exchange: row.exchange === 'BSE' ? 'BSE' : 'NSE',
      ltp: toNum(row.ltp as never),
      open: toNum(row.open as never),
      high: toNum(row.high as never),
      low: toNum(row.low as never),
      prevClose: toNum(row.prevClose as never),
      change: toNum(row.change as never),
      changePct: toNum(row.changePct as never),
      volume: toBigIntNum(row.volume),
      week52High: toNum(row.week52High as never),
      week52Low: toNum(row.week52Low as never),
      week52Avg: toNum(row.week52Avg as never),
      quality: this.qualityFor(row.quotedAt),
      quotedAt: row.quotedAt?.toISOString() ?? null,
      fetchedAt: row.fetchedAt.toISOString(),
      source: row.source,
    };
  }

  /** Stock ids that appear in any published snapshot — the refresh job's universe. */
  async activelyHeldStockIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ stockId: string }>>`
      SELECT DISTINCT h."stockId"
      FROM holdings h
      JOIN portfolio_snapshots s ON s.id = h."snapshotId"
      JOIN (
        SELECT "fundId", MAX("disclosureDate") AS latest
        FROM portfolio_snapshots
        WHERE status = 'PUBLISHED'
        GROUP BY "fundId"
      ) newest ON newest."fundId" = s."fundId" AND newest.latest = s."disclosureDate"
      WHERE h."stockId" IS NOT NULL AND h."instrumentType" = 'EQUITY'
    `;
    return rows.map((r) => r.stockId);
  }
}
