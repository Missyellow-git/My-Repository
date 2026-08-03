import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ApiCallRecord {
  provider: string;
  endpoint: string;
  method?: string;
  httpStatus?: number | null;
  outcome: 'ok' | 'error' | 'timeout' | 'rate_limited' | 'cache_hit';
  latencyMs?: number;
  itemCount?: number;
  errorMessage?: string;
  requestId?: string;
}

/**
 * Audit trail for outbound third-party calls.
 *
 * Two reasons this is a table and not just a log line: market-data contracts
 * are billed and audited per call, and provider incidents are argued from
 * records rather than recollection. Writes are fire-and-forget so a logging
 * failure can never fail the user's request.
 */
@Injectable()
export class ApiLogService {
  private readonly logger = new Logger(ApiLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  record(entry: ApiCallRecord): void {
    void this.prisma.apiCallLog
      .create({
        data: {
          provider: entry.provider,
          endpoint: entry.endpoint,
          method: entry.method ?? 'GET',
          httpStatus: entry.httpStatus ?? null,
          outcome: entry.outcome,
          latencyMs: entry.latencyMs ?? null,
          itemCount: entry.itemCount ?? null,
          // Truncated: provider errors occasionally embed whole payloads.
          errorMessage: entry.errorMessage?.slice(0, 1000) ?? null,
          requestId: entry.requestId ?? null,
        },
      })
      .catch((err: Error) => this.logger.debug(`Failed to persist API call log: ${err.message}`));
  }

  /** Rolling provider health used by /health/providers and ops dashboards. */
  async recentStats(provider: string, sinceMinutes = 15) {
    const since = new Date(Date.now() - sinceMinutes * 60_000);
    const rows = await this.prisma.apiCallLog.groupBy({
      by: ['outcome'],
      where: { provider, createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { latencyMs: true },
    });

    const total = rows.reduce((s, r) => s + r._count._all, 0);
    const ok = rows.find((r) => r.outcome === 'ok')?._count._all ?? 0;
    return {
      provider,
      windowMinutes: sinceMinutes,
      total,
      successRate: total === 0 ? null : ok / total,
      avgLatencyMs: rows.find((r) => r.outcome === 'ok')?._avg.latencyMs ?? null,
      byOutcome: Object.fromEntries(rows.map((r) => [r.outcome, r._count._all])),
    };
  }
}
