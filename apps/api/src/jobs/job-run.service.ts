import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Records every background job execution.
 *
 * Scheduled work that fails silently is the classic way a data product goes
 * quietly wrong: prices stop refreshing, disclosures stop importing, and the
 * dashboard keeps rendering yesterday's numbers as though nothing happened.
 * Every job wraps itself in `track`, so `sync_job_runs` always answers "when
 * did this last succeed, and what did it do".
 */
@Injectable()
export class JobRunService {
  private readonly logger = new Logger(JobRunService.name);

  constructor(private readonly prisma: PrismaService) {}

  async track<T extends Record<string, unknown>>(
    jobName: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const run = await this.prisma.syncJobRun.create({ data: { jobName } });
    const started = Date.now();

    try {
      const stats = await work();
      await this.prisma.syncJobRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          stats: { ...stats, durationMs: Date.now() - started } as never,
        },
      });
      this.logger.log(`${jobName} finished in ${Date.now() - started}ms`);
      return stats;
    } catch (err) {
      await this.prisma.syncJobRun
        .update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            error: (err as Error).message.slice(0, 2000),
            stats: { durationMs: Date.now() - started } as never,
          },
        })
        .catch(() => undefined);
      this.logger.error(
        `${jobName} failed after ${Date.now() - started}ms: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async lastSuccessfulRun(jobName: string): Promise<Date | null> {
    const run = await this.prisma.syncJobRun.findFirst({
      where: { jobName, status: 'SUCCEEDED' },
      orderBy: { startedAt: 'desc' },
      select: { finishedAt: true },
    });
    return run?.finishedAt ?? null;
  }
}
