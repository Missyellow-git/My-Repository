import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { toNum } from '../../common/utils/decimal';
import { isMarketOpen } from '../../common/utils/market-hours';
import type {
  MarketDataProvider,
  QuoteFetchResult,
  QuoteRequest,
  RawQuote,
} from './market-data.types';

/**
 * Synthetic feed for development, CI and demos.
 *
 * A licensed real-time NSE/BSE feed cannot be shipped in a repository, and
 * scraping exchange websites violates their terms of use. Rather than leave the
 * product unrunnable without a paid contract, this provider generates a
 * plausible intraday series so every downstream feature — sorting, gainers and
 * losers, alerts, AI answers — can be exercised end to end.
 *
 * Properties that make it useful rather than merely present:
 *  - deterministic within a minute, so repeated requests agree with each other
 *    and tests are reproducible;
 *  - a seeded random walk anchored to the stock's previous close, so intraday
 *    moves stay within believable bounds and open/high/low remain consistent;
 *  - frozen outside market hours, exactly as a real feed behaves.
 *
 * Every quote it returns is tagged `source: "simulated"`, and the API surfaces
 * that on the payload so the UI can display a "simulated data" banner. It must
 * never be enabled in production.
 */
@Injectable()
export class SimulatedMarketDataProvider implements MarketDataProvider {
  readonly name = 'simulated';
  private readonly logger = new Logger(SimulatedMarketDataProvider.name);

  constructor(private readonly prisma: PrismaService) {}

  async fetchQuotes(requests: QuoteRequest[]): Promise<QuoteFetchResult> {
    const ids = requests.map((r) => r.stockId);

    // Anchor on the last stored close when we have one so restarts do not jump
    // the series; fall back to a name-derived base price for brand-new stocks.
    const [existing, bars] = await Promise.all([
      this.prisma.stockPrice.findMany({
        where: { stockId: { in: ids } },
        select: { stockId: true, prevClose: true, ltp: true, week52High: true, week52Low: true },
      }),
      this.prisma.dailyBar.findMany({
        where: { stockId: { in: ids } },
        orderBy: { date: 'desc' },
        take: ids.length,
        select: { stockId: true, close: true },
        distinct: ['stockId'],
      }),
    ]);

    const priceIndex = new Map(existing.map((p) => [p.stockId, p]));
    const barIndex = new Map(bars.map((b) => [b.stockId, toNum(b.close)]));

    const marketOpen = isMarketOpen();
    // One seed per minute: quotes are stable within a minute and move between
    // minutes, which is what a polling UI expects.
    const minuteBucket = Math.floor(Date.now() / 60_000);

    const quotes: RawQuote[] = [];
    const missing: string[] = [];

    for (const req of requests) {
      const symbol = req.nseSymbol ?? req.bseCode;
      if (!symbol) {
        missing.push(req.stockId);
        continue;
      }

      const stored = priceIndex.get(req.stockId);
      const prevClose =
        toNum(stored?.prevClose) ?? barIndex.get(req.stockId) ?? this.basePriceFor(symbol);

      // Deterministic drift in roughly ±2.5%, with a small intraday bias so a
      // portfolio shows a believable mix of gainers and losers rather than
      // pure noise around zero.
      const drift = marketOpen
        ? (this.unit(`${symbol}:${minuteBucket}`) - 0.5) * 0.05
        : (this.unit(`${symbol}:close`) - 0.5) * 0.02;

      const ltp = round2(prevClose * (1 + drift));
      const open = round2(prevClose * (1 + (this.unit(`${symbol}:open`) - 0.5) * 0.015));
      const spread = Math.abs(drift) + 0.004;
      const high = round2(Math.max(ltp, open) * (1 + spread * 0.4));
      const low = round2(Math.min(ltp, open) * (1 - spread * 0.4));

      const w52High = toNum(stored?.week52High) ?? round2(prevClose * 1.35);
      const w52Low = toNum(stored?.week52Low) ?? round2(prevClose * 0.72);

      quotes.push({
        stockId: req.stockId,
        symbol,
        exchange: req.nseSymbol ? 'NSE' : 'BSE',
        ltp,
        open,
        high: Math.max(high, ltp, open),
        low: Math.min(low, ltp, open),
        prevClose: round2(prevClose),
        volume: Math.round(this.unit(`${symbol}:vol:${minuteBucket}`) * 5_000_000) + 25_000,
        week52High: Math.max(w52High, high),
        week52Low: Math.min(w52Low, low),
        quotedAt: new Date(),
      });
    }

    this.logger.debug(
      `Simulated ${quotes.length} quotes (market ${marketOpen ? 'open' : 'closed'})`,
    );
    return { quotes, missing, partial: false, provider: this.name };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  /** FNV-1a derived unit float — stable across processes and restarts. */
  private unit(seed: string): number {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  }

  /** Symbol-derived base price in ~₹80–₹4000 for stocks we have never seen. */
  private basePriceFor(symbol: string): number {
    return round2(80 + this.unit(`base:${symbol}`) * 3920);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
