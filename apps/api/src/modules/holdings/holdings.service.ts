import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CacheKeys,
  CacheTtl,
  InstrumentType,
  PriceQuality,
  SnapshotStatus,
  type HoldingRow,
  type HoldingsQuery,
  type HoldingsResponse,
  type PortfolioSnapshotMeta,
  type Quote,
  type StockRef,
} from '@fundlens/shared';
import { CacheService } from '../../cache/cache.service';
import type { AppConfig } from '../../common/config/configuration';
import { DisclosureNotFoundException, FundNotFoundException } from '../../common/errors';
import { pctChange, round, roundOrNull, toNum } from '../../common/utils/decimal';
import { daysBetween } from '../../common/utils/market-hours';
import { PrismaService } from '../../prisma/prisma.service';
import { FundsService } from '../funds/funds.service';
import { PricesService } from '../prices/prices.service';

/** Holdings without price data — the cacheable half of the response. */
interface StaticHoldings {
  snapshot: PortfolioSnapshotMeta;
  rows: Array<Omit<HoldingRow, 'quote' | 'pctFrom52wAvg' | 'weightedChangePct'>>;
  unmappedInstruments: string[];
}

@Injectable()
export class HoldingsService {
  private readonly logger = new Logger(HoldingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly prices: PricesService,
    private readonly funds: FundsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * The dashboard's primary read.
   *
   * Disclosed holdings and live prices are fetched and cached separately, then
   * joined per request. That split matters: holdings change once a month and
   * can be cached for hours, prices change every minute and cannot. Caching the
   * joined result would force us to pick one TTL and be wrong for one of them.
   */
  async getHoldings(fundId: string, query: HoldingsQuery): Promise<HoldingsResponse> {
    const [fund, statik] = await Promise.all([
      this.funds.getSummary(fundId),
      this.loadStatic(fundId, query.date),
    ]);

    let rows = statik.rows;
    if (!query.includeNonEquity) {
      rows = rows.filter((r) => r.instrumentType === InstrumentType.EQUITY);
    }
    if (!query.includeUnmapped) {
      rows = rows.filter((r) => r.mapped);
    }

    const stockIds = rows.map((r) => r.stock?.id).filter((id): id is string => !!id);

    let quotes = new Map<string, Quote>();
    let fetchedAt: Date | null = null;
    if (query.withPrices && stockIds.length > 0) {
      // allowSyncFetch=false: a cold cache degrades the badge, it does not
      // block the page behind a vendor round trip.
      const result = await this.prices.getQuotes(stockIds, false);
      quotes = result.quotes;
      fetchedAt = result.fetchedAt;
    }

    const holdings: HoldingRow[] = rows.map((row) => {
      const quote = row.stock ? (quotes.get(row.stock.id) ?? null) : null;
      return {
        ...row,
        quote,
        pctFrom52wAvg: quote ? pctChange(quote.ltp, quote.week52Avg) : null,
        weightedChangePct:
          quote?.changePct != null ? round((row.weightPct * quote.changePct) / 100, 4) : null,
      };
    });

    let withQuote = 0;
    let stale = 0;
    for (const h of holdings) {
      if (!h.quote) continue;
      if (h.quote.quality === PriceQuality.UNAVAILABLE) continue;
      withQuote += 1;
      if (h.quote.quality === PriceQuality.STALE) stale += 1;
    }

    return {
      fund,
      snapshot: statik.snapshot,
      holdings,
      unmappedInstruments: statik.unmappedInstruments,
      priceCoverage: {
        requested: stockIds.length,
        withQuote,
        stale,
        unavailable: stockIds.length - withQuote,
      },
      generatedAt: (fetchedAt ?? new Date()).toISOString(),
    };
  }

  /**
   * Static (price-free) holdings for a snapshot, cached hard.
   *
   * Published disclosures are immutable, so a 6-hour TTL is safe; the import
   * pipeline explicitly invalidates this key when it republishes a period.
   */
  async loadStatic(fundId: string, date: string): Promise<StaticHoldings> {
    const snapshot = await this.resolveSnapshot(fundId, date);

    return this.cache.getOrSet(
      CacheKeys.snapshotHoldings(snapshot.id),
      CacheTtl.SNAPSHOT_HOLDINGS,
      async () => {
        const holdings = await this.prisma.holding.findMany({
          where: { snapshotId: snapshot.id },
          orderBy: { weightPct: 'desc' },
          include: {
            stock: {
              include: { sector: { select: { name: true } } },
            },
          },
        });

        const rows = holdings.map((h) => {
          const stock: StockRef | null = h.stock
            ? {
                id: h.stock.id,
                name: h.stock.name,
                isin: h.stock.isin,
                nseSymbol: h.stock.nseSymbol,
                bseCode: h.stock.bseCode,
                sector: h.stock.sector?.name ?? null,
                industry: h.stock.industry,
                marketCapCrore: toNum(h.stock.marketCapCrore),
                marketCapCategory: h.stock.marketCapCategory as StockRef['marketCapCategory'],
              }
            : null;

          return {
            id: h.id,
            instrumentName: h.instrumentName,
            isin: h.isin,
            instrumentType: h.instrumentType as InstrumentType,
            weightPct: toNum(h.weightPct) ?? 0,
            quantity: toNum(h.quantity),
            marketValueLakh: toNum(h.marketValueLakh),
            rank: h.rank,
            stock,
            mapped: stock !== null,
            mappingConfidence: roundOrNull(toNum(h.mappingConfidence), 3),
          };
        });

        const unmappedInstruments = rows
          .filter((r) => !r.mapped && r.instrumentType === InstrumentType.EQUITY)
          .map((r) => r.instrumentName);

        return { snapshot, rows, unmappedInstruments } satisfies StaticHoldings;
      },
    );
  }

  /**
   * Resolves `latest` or an ISO date to a published snapshot.
   *
   * `latest` is cached by fund id because it is looked up on every dashboard
   * load and every AI question; the import pipeline invalidates it.
   */
  async resolveSnapshot(fundId: string, date: string): Promise<PortfolioSnapshotMeta> {
    const staleAfterDays = this.config.get('env', { infer: true }).DISCLOSURE_STALE_AFTER_DAYS;

    const snapshot =
      date === 'latest'
        ? await this.findLatest(fundId)
        : await this.prisma.portfolioSnapshot.findFirst({
            where: {
              fundId,
              status: SnapshotStatus.PUBLISHED,
              disclosureDate: this.parseDate(fundId, date),
            },
          });

    if (!snapshot) {
      const fundExists = await this.prisma.mutualFund.count({ where: { id: fundId } });
      if (fundExists === 0) throw new FundNotFoundException(fundId);
      throw new DisclosureNotFoundException(fundId, date);
    }

    return {
      id: snapshot.id,
      fundId: snapshot.fundId,
      disclosureDate: snapshot.disclosureDate.toISOString().slice(0, 10),
      status: snapshot.status as SnapshotStatus,
      source: snapshot.source,
      sourceUrl: snapshot.sourceUrl,
      holdingsCount: snapshot.holdingsCount,
      equityCount: snapshot.equityCount,
      totalEquityWeightPct: toNum(snapshot.totalEquityWeightPct) ?? 0,
      importedAt: snapshot.importedAt.toISOString(),
      stale: daysBetween(new Date(), snapshot.disclosureDate) > staleAfterDays,
    };
  }

  private async findLatest(fundId: string) {
    const cachedId = await this.cache.get<string>(CacheKeys.latestSnapshotId(fundId));
    if (cachedId) {
      const byId = await this.prisma.portfolioSnapshot.findUnique({ where: { id: cachedId } });
      if (byId?.status === SnapshotStatus.PUBLISHED) return byId;
    }

    const snapshot = await this.prisma.portfolioSnapshot.findFirst({
      where: { fundId, status: SnapshotStatus.PUBLISHED },
      orderBy: { disclosureDate: 'desc' },
    });

    if (snapshot) {
      await this.cache.set(
        CacheKeys.latestSnapshotId(fundId),
        snapshot.id,
        CacheTtl.LATEST_SNAPSHOT_ID,
      );
    }
    return snapshot;
  }

  private parseDate(fundId: string, date: string): Date {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new DisclosureNotFoundException(fundId, date);
    return parsed;
  }
}
