import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { compareQuerySchema, type CompareQuery } from '@fundlens/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Controller('funds/:id')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('analytics')
  @ApiOperation({
    summary: 'Portfolio analytics for the dashboard',
    description:
      'Total stocks, top 10, sector and market-cap allocation, gainers and losers, average and ' +
      'weight-adjusted daily change, and the Herfindahl concentration index.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'date', required: false, example: 'latest' })
  @ApiOkResponse({ description: 'Computed analytics for the resolved snapshot.' })
  async getAnalytics(@Param('id', ParseUUIDPipe) id: string, @Query('date') date = 'latest') {
    return this.analytics.getAnalytics(id, date);
  }

  @Get('sector-allocation')
  @ApiOperation({ summary: 'Sector weights with each sector’s weighted move today' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getSectorAllocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('date') date = 'latest',
  ) {
    const items = await this.analytics.getSectorAllocation(id, date);
    return { items, total: items.length };
  }

  @Get('contribution')
  @ApiOperation({
    summary: 'Weight versus movement per holding',
    description:
      "Each holding's contribution to the portfolio's implied intraday move (weight × change), " +
      'and its share of total absolute movement.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getContribution(@Param('id', ParseUUIDPipe) id: string, @Query('date') date = 'latest') {
    const items = await this.analytics.getContribution(id, date);
    return { items, total: items.length };
  }

  @Get('compare')
  @ApiOperation({
    summary: 'Compare disclosure periods, or overlap with another scheme',
    description:
      'With `from`, returns additions, exits, weight changes, sector shift and one-way turnover ' +
      'between two periods of this scheme. With `againstFundId`, returns holdings overlap against ' +
      'another scheme using the standard Σ min(weightA, weightB) measure.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'from', required: false, example: '2025-05-31' })
  @ApiQuery({ name: 'to', required: false, example: 'latest' })
  @ApiQuery({ name: 'againstFundId', required: false, format: 'uuid' })
  async compare(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(compareQuerySchema)) query: CompareQuery,
  ) {
    if (query.againstFundId) {
      return this.analytics.compareFunds(id, query.againstFundId);
    }
    if (!query.from) {
      throw new BadRequestException(
        'Provide `from` to compare two periods of this scheme, or `againstFundId` to compare with another scheme.',
      );
    }
    return this.analytics.comparePeriods(id, query.from, query.to);
  }
}
