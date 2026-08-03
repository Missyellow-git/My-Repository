import { Module } from '@nestjs/common';
import { FundsModule } from '../funds/funds.module';
import { HoldingsModule } from '../holdings/holdings.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [HoldingsModule, FundsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
