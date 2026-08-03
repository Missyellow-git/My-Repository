import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { fundSearchQuerySchema, type FundSearchQuery } from '@fundlens/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { FundsService } from './funds.service';

@ApiTags('funds')
@Controller('funds')
export class FundsController {
  constructor(private readonly funds: FundsService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search mutual fund schemes',
    description:
      'Fuzzy search across the AMFI scheme master. Tolerates typos and partial names. ' +
      'Pass `withHoldingsOnly=true` to restrict results to schemes that have a published ' +
      'portfolio disclosure — a scheme can be searchable before its holdings have been ingested.',
  })
  @ApiOkResponse({ description: 'Ranked scheme matches, best first.' })
  async search(@Query(new ZodValidationPipe(fundSearchQuerySchema)) query: FundSearchQuery) {
    const items = await this.funds.search(query);
    return { items, total: items.length, query: query.q };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Scheme detail, including latest disclosure date and staleness' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getFund(@Param('id', ParseUUIDPipe) id: string) {
    return this.funds.getById(id);
  }

  @Get(':id/periods')
  @ApiOperation({
    summary: 'Available disclosure periods',
    description:
      'Newest first. Use any returned `disclosureDate` as the `date` parameter elsewhere.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getPeriods(@Param('id', ParseUUIDPipe) id: string) {
    const items = await this.funds.listDisclosurePeriods(id);
    return { items, total: items.length };
  }
}
