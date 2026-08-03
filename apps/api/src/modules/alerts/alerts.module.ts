import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PricesModule } from '../prices/prices.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  imports: [AuthModule, PricesModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
