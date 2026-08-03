import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CacheModule } from './cache/cache.module';
import { configuration, type AppConfig } from './common/config/configuration';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdMiddleware } from './common/interceptors/request-id.middleware';
import { JobsModule } from './jobs/jobs.module';
import { AiModule } from './modules/ai/ai.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { ExportModule } from './modules/export/export.module';
import { FundsModule } from './modules/funds/funds.module';
import { HealthModule } from './modules/health/health.module';
import { HoldingsModule } from './modules/holdings/holdings.module';
import { PricesModule } from './modules/prices/prices.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { DisclosureModule } from './providers/disclosure/disclosure.module';
import { MarketDataModule } from './providers/market-data/market-data.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // The whole environment is validated once in `configuration()`; caching
      // avoids re-running that on every ConfigService.get.
      cache: true,
      expandVariables: true,
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const env = config.get('env', { infer: true });
        return [{ ttl: env.THROTTLE_TTL_SECONDS * 1_000, limit: env.THROTTLE_LIMIT }];
      },
    }),

    // Infrastructure.
    PrismaModule,
    CacheModule,

    // Provider adapters (global — every module resolves them by token).
    MarketDataModule,
    DisclosureModule,

    // Domain.
    FundsModule,
    HoldingsModule,
    PricesModule,
    AnalyticsModule,
    AiModule,
    ExportModule,
    AuthModule,
    UsersModule,
    AlertsModule,
    HealthModule,

    // Background workers.
    JobsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
