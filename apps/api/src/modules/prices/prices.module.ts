import { Module } from '@nestjs/common';
import { MarketCalendarService } from './market-calendar.service';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';

@Module({
  controllers: [PricesController],
  providers: [PricesService, MarketCalendarService],
  exports: [PricesService, MarketCalendarService],
})
export class PricesModule {}
