import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES } from '@fundlens/shared';
import type { Job } from 'bullmq';
import { CacheService } from '../cache/cache.service';
import { toNum } from '../common/utils/decimal';
import { toDateKey } from '../common/utils/market-hours';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../modules/alerts/alerts.service';
import { AuthService } from '../modules/auth/auth.service';
import { DisclosureImportService } from '../providers/disclosure/disclosure-import.service';
import { SchemeMasterService } from '../providers/scheme-master/scheme-master.service';
import { classifyMarketCap } from '../providers/scheme-master/fixtures/stock-master';
import { JobRunService } from './job-run.service';

/** Imports the AMFI scheme master and refreshes NAVs. */
@Processor(QUEUE_NAMES.SCHEME_MASTER_SYNC, { concurrency: 1 })
export class SchemeMasterProcessor extends WorkerHost {
  constructor(
    private readonly schemeMaster: SchemeMasterService,
    private readonly cache: CacheService,
    private readonly jobRuns: JobRunService,
  ) {
    super();
  }

  async process(): Promise<Record<string, unknown>> {
    return this.jobRuns.track('scheme-master-sync', async () => {
      const stats = await this.schemeMaster.sync();
      // NAVs and scheme metadata just changed; search results and fund detail
      // payloads embed both, so their caches must go.
      await this.cache.delByPattern('fund:search:*');
      await this.cache.delByPattern('fund:detail:*');
      return { ...stats, warnings: stats.warnings.length };
    });
  }
}

/** Pulls new monthly portfolio disclosures and publishes snapshots. */
@Processor(QUEUE_NAMES.DISCLOSURE_SYNC, { concurrency: 1 })
export class DisclosureSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(DisclosureSyncProcessor.name);

  constructor(
    private readonly importer: DisclosureImportService,
    private readonly alerts: AlertsService,
    private readonly cache: CacheService,
    private readonly jobRuns: JobRunService,
  ) {
    super();
  }

  async process(job: Job<{ since?: string; full?: boolean }>): Promise<Record<string, unknown>> {
    // Disclosure imports are long and write-heavy; two replicas racing on the
    // same period would duplicate work and fight over the same snapshot rows.
    const lock = await this.cache.acquireLock('disclosure-sync', 1800);
    if (!lock) return { skipped: true, reason: 'lock held elsewhere' };

    try {
      return await this.jobRuns.track('disclosure-sync', async () => {
        // Incremental by default: only look for periods newer than the last
        // successful run, unless explicitly asked for a full re-scan.
        const lastRun = job.data?.full
          ? null
          : await this.jobRuns.lastSuccessfulRun('disclosure-sync');
        const since = job.data?.since ? new Date(job.data.since) : (lastRun ?? undefined);

        const stats = await this.importer.syncLatest(since);

        if (stats.newSnapshotIds.length > 0) {
          const alertStats = await this.alerts
            .evaluateDisclosureAlerts(stats.newSnapshotIds)
            .catch((err: Error) => {
              this.logger.warn(`Disclosure alert evaluation failed: ${err.message}`);
              return { rulesEvaluated: 0, notificationsCreated: 0, skippedInCooldown: 0 };
            });
          return {
            ...stats,
            warnings: stats.warnings.length,
            newSnapshotIds: stats.newSnapshotIds.length,
            notifications: alertStats.notificationsCreated,
          };
        }

        return { ...stats, warnings: stats.warnings.length, newSnapshotIds: 0 };
      });
    } finally {
      await this.cache.releaseLock('disclosure-sync', lock);
    }
  }
}

/**
 * Nightly stock housekeeping: closes the day's bar and refreshes derived
 * reference data.
 */
@Processor(QUEUE_NAMES.STOCK_METADATA_SYNC, { concurrency: 1 })
export class StockMetadataProcessor extends WorkerHost {
  private readonly logger = new Logger(StockMetadataProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly jobRuns: JobRunService,
  ) {
    super();
  }

  async process(): Promise<Record<string, unknown>> {
    return this.jobRuns.track('stock-metadata-sync', async () => {
      const barsWritten = await this.closeDailyBars();
      const reclassified = await this.reclassifyMarketCaps();
      const tokensPruned = await this.auth.pruneExpiredTokens();
      const logsPruned = await this.pruneApiLogs();

      return { barsWritten, reclassified, tokensPruned, logsPruned };
    });
  }

  /**
   * Persists today's close as a daily bar, which is what the 52-week average is
   * computed from. Idempotent per stock per date, so a retry cannot double-write.
   */
  private async closeDailyBars(): Promise<number> {
    const prices = await this.prisma.stockPrice.findMany({
      where: { ltp: { not: null } },
      select: {
        stockId: true,
        ltp: true,
        open: true,
        high: true,
        low: true,
        volume: true,
        quotedAt: true,
      },
    });

    const today = new Date(`${toDateKey(new Date())}T00:00:00.000Z`);
    let written = 0;

    for (const price of prices) {
      const close = toNum(price.ltp);
      if (close === null) continue;
      await this.prisma.dailyBar
        .upsert({
          where: { stockId_date: { stockId: price.stockId, date: today } },
          create: {
            stockId: price.stockId,
            date: today,
            open: price.open,
            high: price.high,
            low: price.low,
            close,
            volume: price.volume,
          },
          update: { close, high: price.high, low: price.low, volume: price.volume },
        })
        .then(() => {
          written += 1;
        })
        .catch((err: Error) => this.logger.debug(`Daily bar write failed: ${err.message}`));
    }

    return written;
  }

  /**
   * Recomputes the market-cap bucket from the stored capitalisation.
   *
   * In production this should be replaced by AMFI's published half-yearly
   * large/mid/small classification list, which is definitional rather than
   * derived — the threshold approach here is an approximation, and is labelled
   * as such wherever it surfaces.
   */
  private async reclassifyMarketCaps(): Promise<number> {
    const stocks = await this.prisma.stock.findMany({
      where: { marketCapCrore: { not: null } },
      select: { id: true, marketCapCrore: true, marketCapCategory: true },
    });

    let changed = 0;
    for (const stock of stocks) {
      const cap = toNum(stock.marketCapCrore);
      if (cap === null) continue;
      const category = classifyMarketCap(cap);
      if (category === stock.marketCapCategory) continue;
      await this.prisma.stock.update({
        where: { id: stock.id },
        data: { marketCapCategory: category, metadataUpdatedAt: new Date() },
      });
      changed += 1;
    }
    return changed;
  }

  /** 90-day retention on provider call logs, sized to cover a billing dispute. */
  private async pruneApiLogs(): Promise<number> {
    const cutoff = new Date(Date.now() - 90 * 86_400_000);
    const result = await this.prisma.apiCallLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
