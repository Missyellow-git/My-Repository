import { Module } from '@nestjs/common';
import { FundsModule } from '../funds/funds.module';
import { PricesModule } from '../prices/prices.module';
import { HoldingsController } from './holdings.controller';
import { HoldingsService } from './holdings.service';

@Module({
  imports: [FundsModule, PricesModule],
  controllers: [HoldingsController],
  providers: [HoldingsService],
  exports: [HoldingsService],
})
export class HoldingsModule {}
