import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES } from '@fundlens/shared';
import type { Job } from 'bullmq';
import { CacheService } from '../cache/cache.service';
import { MarketCalendarService } from '../modules/prices/market-calendar.service';
import { PricesService } from '../modules/prices/prices.service';
import { AlertsService } from '../modules/alerts/alerts.service';
import { JobRunService } from './job-run.service';

export interface PriceRefreshJobData {
  /** Refresh only these stocks; omit to refresh every actively held stock. */
  stockIds?: string[];
  /** Runs even outside market hours. Used by the manual admin trigger. */
  force?: boolean;
}

/**
 * Keeps quotes warm for every stock held in a current disclosure.
 *
 * Two properties make this safe to run every minute across a horizontally
 * scaled deployment:
 *
 *  - a Redis lock ensures exactly one replica refreshes at a time, so N pods do
 *    not multiply the provider bill by N;
 *  - it skips entirely outside market hours. Polling a static feed all night
 *    burns quota to learn nothing, and the UI already labels closed-market
 *    quotes correctly.
 */
@Processor(QUEUE_NAMES.PRICE_REFRESH, { concurrency: 1 })
export class PriceRefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(PriceRefreshProcessor.name);

  constructor(
    private readonly prices: PricesService,
    private readonly calendar: MarketCalendarService,
    private readonly alerts: AlertsService,
    private readonly cache: CacheService,
    private readonly jobRuns: JobRunService,
  ) {
    super();
  }

  async process(job: Job<PriceRefreshJobData>): Promise<Record<string, unknown>> {
    const { stockIds, force } = job.data ?? {};

    if (!force && !(await this.calendar.shouldRefreshPrices())) {
      return { skipped: true, reason: 'market closed' };
    }

    // Short TTL: if a replica dies mid-refresh the lock clears before the next
    // scheduled tick, so one crash costs one cycle rather than stalling forever.
    const lock = await this.cache.acquireLock('price-refresh', 55);
    if (!lock) {
      this.logger.debug('Another replica holds the price-refresh lock; skipping');
      return { skipped: true, reason: 'lock held elsewhere' };
    }

    try {
      return await this.jobRuns.track('price-refresh', async () => {
        const targets = stockIds?.length ? stockIds : await this.prices.activelyHeldStockIds();
        if (targets.length === 0) return { refreshed: 0, targets: 0 };

        const refreshed = await this.prices.refresh(targets);

        // Alerts are evaluated straight after a refresh so a notification is
        // based on the prices we just stored, not on the previous cycle's.
        const alertStats = await this.alerts.evaluatePriceAlerts().catch((err: Error) => {
          this.logger.warn(`Alert evaluation failed: ${err.message}`);
          return { rulesEvaluated: 0, notificationsCreated: 0, skippedInCooldown: 0 };
        });

        return {
          targets: targets.length,
          refreshed: refreshed.size,
          alertsEvaluated: alertStats.rulesEvaluated,
          notifications: alertStats.notificationsCreated,
        };
      });
    } finally {
      await this.cache.releaseLock('price-refresh', lock);
    }
  }
}
