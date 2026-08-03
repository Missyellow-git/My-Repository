import { Module } from '@nestjs/common';
import { HoldingsModule } from '../holdings/holdings.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [HoldingsModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
