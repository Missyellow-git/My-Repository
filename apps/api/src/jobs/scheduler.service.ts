import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from '@fundlens/shared';
import { Queue } from 'bullmq';
import type { AppConfig } from '../common/config/configuration';

/**
 * Registers repeatable jobs with BullMQ.
 *
 * Scheduling lives in Redis rather than in an in-process cron for one reason:
 * with several API replicas, a process-local cron fires N times per interval.
 * BullMQ's repeatable jobs are deduplicated by key across the whole cluster,
 * so each tick produces exactly one job no matter how many replicas exist.
 *
 * Registration is idempotent — stale repeatable definitions from a previous
 * configuration are removed first, so changing an interval in the environment
 * does not leave the old schedule running alongside the new one.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.PRICE_REFRESH) private readonly priceQueue: Queue,
    @InjectQueue(QUEUE_NAMES.DISCLOSURE_SYNC) private readonly disclosureQueue: Queue,
    @InjectQueue(QUEUE_NAMES.SCHEME_MASTER_SYNC) private readonly schemeQueue: Queue,
    @InjectQueue(QUEUE_NAMES.STOCK_METADATA_SYNC) private readonly metadataQueue: Queue,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = this.config.get('env', { infer: true });

    if (!env.ENABLE_BACKGROUND_JOBS) {
      this.logger.warn('Background jobs are disabled (ENABLE_BACKGROUND_JOBS=false)');
      return;
    }

    await this.register(this.priceQueue, 'price-refresh', {
      every: env.PRICE_REFRESH_INTERVAL_SECONDS * 1000,
    });

    await this.register(this.disclosureQueue, 'disclosure-sync', {
      pattern: env.DISCLOSURE_SYNC_CRON,
      tz: 'Asia/Kolkata',
    });

    await this.register(this.schemeQueue, 'scheme-master-sync', {
      pattern: env.SCHEME_MASTER_SYNC_CRON,
      tz: 'Asia/Kolkata',
    });

    // After the close and after the disclosure window, so it sees the day's
    // final prices when it writes daily bars.
    await this.register(this.metadataQueue, 'stock-metadata-sync', {
      pattern: '0 0 2 * * *',
      tz: 'Asia/Kolkata',
    });

    this.logger.log('Repeatable jobs registered');
  }

  private async register(
    queue: Queue,
    jobName: string,
    repeat: { every?: number; pattern?: string; tz?: string },
  ): Promise<void> {
    try {
      for (const existing of await queue.getRepeatableJobs()) {
        if (existing.name === jobName) {
          await queue.removeRepeatableByKey(existing.key);
        }
      }

      await queue.add(
        jobName,
        {},
        {
          repeat,
          // Keep enough history to diagnose a failure without letting Redis
          // grow unbounded on a minute-by-minute job.
          removeOnComplete: 100,
          removeOnFail: 500,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      );
    } catch (err) {
      // A scheduling failure must not stop the API from serving reads.
      this.logger.error(`Failed to register ${jobName}: ${(err as Error).message}`);
    }
  }

  /** Manual trigger used by the admin endpoints and by the seeder. */
  async triggerNow(
    queueName: (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES],
    data: Record<string, unknown> = {},
  ): Promise<string | undefined> {
    const queues: Record<string, Queue> = {
      [QUEUE_NAMES.PRICE_REFRESH]: this.priceQueue,
      [QUEUE_NAMES.DISCLOSURE_SYNC]: this.disclosureQueue,
      [QUEUE_NAMES.SCHEME_MASTER_SYNC]: this.schemeQueue,
      [QUEUE_NAMES.STOCK_METADATA_SYNC]: this.metadataQueue,
    };
    const job = await queues[queueName]?.add(`${queueName}-manual`, data, { attempts: 1 });
    return job?.id;
  }
}
