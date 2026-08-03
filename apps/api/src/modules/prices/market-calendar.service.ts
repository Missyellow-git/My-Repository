import { Injectable, Logger } from '@nestjs/common';
import {
  isMarketOpen,
  isPostCloseSettlingWindow,
  isTradingDay,
  toDateKey,
} from '../../common/utils/market-hours';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Exchange-holiday aware session state.
 *
 * The holiday list is cached in memory for an hour: it changes at most once a
 * year, and the price scheduler consults it every minute. Reading it from
 * Postgres on every tick would be a pointless query, and hard-coding it would
 * guarantee it goes stale.
 */
@Injectable()
export class MarketCalendarService {
  private readonly logger = new Logger(MarketCalendarService.name);
  private holidays: Set<string> = new Set();
  private loadedAt = 0;

  private static readonly TTL_MS = 3_600_000;

  constructor(private readonly prisma: PrismaService) {}

  private async holidayKeys(): Promise<ReadonlySet<string>> {
    if (Date.now() - this.loadedAt < MarketCalendarService.TTL_MS) return this.holidays;

    try {
      const rows = await this.prisma.marketHoliday.findMany({
        where: { date: { gte: new Date(Date.now() - 86_400_000) } },
        select: { date: true },
      });
      this.holidays = new Set(rows.map((r) => toDateKey(r.date)));
      this.loadedAt = Date.now();
    } catch (err) {
      // Keep the previous list rather than treating every day as a holiday —
      // over-fetching quotes is a far smaller failure than going dark.
      this.logger.warn(`Could not refresh holiday calendar: ${(err as Error).message}`);
    }
    return this.holidays;
  }

  async isTradingDay(date = new Date()): Promise<boolean> {
    return isTradingDay(date, await this.holidayKeys());
  }

  async isOpen(date = new Date()): Promise<boolean> {
    return isMarketOpen(date, await this.holidayKeys());
  }

  /** True while quotes are still worth refreshing (session or settling window). */
  async shouldRefreshPrices(date = new Date()): Promise<boolean> {
    const keys = await this.holidayKeys();
    return isMarketOpen(date, keys) || isPostCloseSettlingWindow(date, keys);
  }
}
