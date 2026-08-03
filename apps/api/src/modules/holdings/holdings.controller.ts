import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { holdingsQuerySchema, type HoldingsQuery } from '@fundlens/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { HoldingsService } from './holdings.service';

@ApiTags('holdings')
@Controller('funds/:id')
export class HoldingsController {
  constructor(private readonly holdings: HoldingsService) {}

  @Get('holdings')
  @ApiOperation({
    summary: 'Latest (or historical) portfolio holdings with live prices',
    description:
      'Returns disclosed holdings joined with the latest known quote for each mapped security. ' +
      '`snapshot.stale` flags a disclosure past the freshness threshold, `priceCoverage` reports how ' +
      'many holdings actually have a usable quote, and `unmappedInstruments` lists disclosure lines ' +
      'we could not match to a listed security. Clients should surface all three rather than ' +
      'presenting the table as uniformly live.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'Holdings, snapshot metadata and price coverage.' })
  async getHoldings(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(holdingsQuerySchema)) query: HoldingsQuery,
  ) {
    return this.holdings.getHoldings(id, query);
  }

  @Get('holdings/:date')
  @ApiOperation({
    summary: 'Holdings for a specific disclosure period',
    description:
      '`date` is an ISO date returned by GET /funds/:id/periods, or the literal `latest`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'date', example: '2025-07-31' })
  async getHistoricalHoldings(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('date') date: string,
    @Query(new ZodValidationPipe(holdingsQuerySchema)) query: HoldingsQuery,
  ) {
    // Historical periods default to no prices: today's quote against a
    // six-month-old weight is a misleading pairing unless explicitly requested.
    return this.holdings.getHoldings(id, {
      ...query,
      date,
      withPrices: query.withPrices && date === 'latest',
    });
  }
}
