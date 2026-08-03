import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { pricesQuerySchema, type Quote } from '@fundlens/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { PricesService } from './prices.service';

@ApiTags('prices')
@Controller('prices')
export class PricesController {
  constructor(
    private readonly prices: PricesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Live quotes by NSE symbol',
    description:
      'Returns the latest known quote for each symbol. Quotes carry a `quality` field ' +
      '(LIVE / DELAYED / STALE / MARKET_CLOSED / UNAVAILABLE) — clients must render that state ' +
      'rather than presenting every number as real time.',
  })
  @ApiQuery({ name: 'symbols', example: 'INFY,TCS,HDFCBANK' })
  @ApiOkResponse({
    description: 'Quotes keyed by NSE symbol, plus any symbols we could not resolve.',
  })
  async getQuotes(@Query(new ZodValidationPipe(pricesQuerySchema)) query: { symbols: string[] }) {
    const stocks = await this.prisma.stock.findMany({
      where: { nseSymbol: { in: query.symbols } },
      select: { id: true, nseSymbol: true },
    });

    const bySymbol = new Map(stocks.map((s) => [s.nseSymbol!, s.id]));
    // Small, explicit request — a synchronous provider fetch is acceptable here.
    const { quotes, degraded, fetchedAt } = await this.prices.getQuotes(
      stocks.map((s) => s.id),
      true,
    );

    const data: Record<string, Quote | null> = {};
    const unknownSymbols: string[] = [];
    for (const symbol of query.symbols) {
      const stockId = bySymbol.get(symbol);
      if (!stockId) {
        unknownSymbols.push(symbol);
        continue;
      }
      data[symbol] = quotes.get(stockId) ?? null;
    }

    return {
      quotes: data,
      unknownSymbols,
      degraded,
      fetchedAt: fetchedAt?.toISOString() ?? null,
    };
  }
}
