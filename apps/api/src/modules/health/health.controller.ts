import { Controller, Get, Inject } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiLogService } from '../../providers/api-log.service';
import {
  MARKET_DATA_PROVIDER,
  type MarketDataProvider,
} from '../../providers/market-data/market-data.types';

/**
 * Health endpoints, split by what an orchestrator actually needs:
 *
 *  - `/health`      liveness. Cheap, no dependencies. A failure here means the
 *                   process is wedged and should be restarted.
 *  - `/health/ready` readiness. Checks Postgres and Redis. A failure removes
 *                   the pod from the load balancer without killing it.
 *  - `/health/providers` operational detail for dashboards, not for probes.
 *
 * The distinction matters: wiring a restart probe to a check that includes a
 * third-party price feed turns a vendor outage into a crash loop.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly apiLog: ApiLogService,
    @Inject(MARKET_DATA_PROVIDER) private readonly marketData: MarketDataProvider,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — database and cache connectivity' })
  async ready() {
    const [database, redis] = await Promise.all([this.prisma.ping(), this.cache.ping()]);
    // Redis being down degrades performance but not correctness, so it does not
    // fail readiness on its own — every cache path falls through to Postgres.
    const status = database ? 'ok' : 'unavailable';
    return {
      status,
      checks: { database, redis },
      degraded: database && !redis,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('providers')
  @ApiExcludeEndpoint()
  async providers() {
    const [marketDataUp, marketDataStats, anthropicStats, amfiStats] = await Promise.all([
      this.marketData.healthCheck(),
      this.apiLog.recentStats(this.marketData.name),
      this.apiLog.recentStats('anthropic'),
      this.apiLog.recentStats('amfi', 24 * 60),
    ]);

    return {
      marketData: { name: this.marketData.name, reachable: marketDataUp, ...marketDataStats },
      anthropic: anthropicStats,
      amfi: amfiStats,
      cache: this.cache.stats(),
      timestamp: new Date().toISOString(),
    };
  }
}
