import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { FundsModule } from '../funds/funds.module';
import { HoldingsModule } from '../holdings/holdings.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { InsightsService } from './insights.service';
import { LlmService } from './llm.service';

@Module({
  imports: [HoldingsModule, AnalyticsModule, FundsModule, AuthModule],
  controllers: [AiController],
  providers: [AiService, InsightsService, LlmService],
  exports: [AiService, InsightsService],
})
export class AiModule {}
