import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from '@fundlens/shared';
import type { AppConfig } from '../common/config/configuration';
import { AlertsModule } from '../modules/alerts/alerts.module';
import { AuthModule } from '../modules/auth/auth.module';
import { PricesModule } from '../modules/prices/prices.module';
import { JobRunService } from './job-run.service';
import { PriceRefreshProcessor } from './price-refresh.processor';
import { SchedulerService } from './scheduler.service';
import {
  DisclosureSyncProcessor,
  SchemeMasterProcessor,
  StockMetadataProcessor,
} from './sync.processors';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        // BullMQ gets its own connection settings rather than sharing the cache
        // client: it issues blocking commands that would stall ordinary
        // GET/SET traffic on a shared connection.
        connection: { url: config.get('env', { infer: true }).REDIS_URL },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 500,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.PRICE_REFRESH },
      { name: QUEUE_NAMES.DISCLOSURE_SYNC },
      { name: QUEUE_NAMES.SCHEME_MASTER_SYNC },
      { name: QUEUE_NAMES.STOCK_METADATA_SYNC },
    ),
    PricesModule,
    AlertsModule,
    AuthModule,
  ],
  providers: [
    JobRunService,
    SchedulerService,
    PriceRefreshProcessor,
    DisclosureSyncProcessor,
    SchemeMasterProcessor,
    StockMetadataProcessor,
  ],
  exports: [JobRunService, SchedulerService],
})
export class JobsModule {}
