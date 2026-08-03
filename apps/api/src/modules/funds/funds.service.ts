import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CacheKeys,
  CacheTtl,
  SnapshotStatus,
  type FundDetail,
  type FundSearchQuery,
  type FundSummary,
} from '@fundlens/shared';
import { CacheService } from '../../cache/cache.service';
import type { AppConfig } from '../../common/config/configuration';
import { FundNotFoundException } from '../../common/errors';
import { toNum } from '../../common/utils/decimal';
import { daysBetween } from '../../common/utils/market-hours';
import { normalizeSchemeName } from '../../common/utils/text';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FundsService {
  private readonly logger = new Logger(FundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Scheme search.
   *
   * Ranking blends three signals, because none alone gives a good result:
   *  - trigram similarity on the normalised name (handles typos and
   *    abbreviations — "parag parik flexi" still finds the fund);
   *  - a prefix bonus, so typing the start of a name ranks it above a fund
   *    that merely contains the words;
   *  - a Direct-plan bonus, because Direct/Growth is what a user searching by
   *    scheme name almost always wants, and every plan of a scheme shares the
   *    same portfolio.
   *
   * All of it runs in one indexed query — the trigram GIN index makes the
   * `%` filter cheap, and only the shortlist is scored.
   */
  async search(query: FundSearchQuery): Promise<FundSummary[]> {
    const normalized = normalizeSchemeName(query.q);
    if (normalized.length < 2) return [];

    const cacheKey = `${CacheKeys.fundSearch(normalized, query.limit)}:${query.category ?? 'all'}:${query.planType ?? 'all'}:${query.withHoldingsOnly}`;

    return this.cache.getOrSet(cacheKey, CacheTtl.FUND_SEARCH, async () => {
      const rows = await this.prisma.$queryRaw<
        Array<{
          id: string;
          amfiSchemeCode: string | null;
          name: string;
          amcName: string;
          category: string;
          subCategory: string | null;
          planType: string;
          optionType: string;
          isinGrowth: string | null;
          latestNav: unknown;
          latestNavDate: Date | null;
          score: number;
        }>
      >`
        SELECT
          f.id,
          f."amfiSchemeCode",
          f.name,
          a.name AS "amcName",
          f.category,
          f."subCategory",
          f."planType",
          f."optionType",
          f."isinGrowth",
          f."latestNav",
          f."latestNavDate",
          (
            similarity(f."normalizedName", ${normalized})
            + CASE WHEN f."normalizedName" LIKE ${normalized + '%'} THEN 0.30 ELSE 0 END
            + CASE WHEN f."planType" = 'DIRECT' THEN 0.05 ELSE 0 END
            + CASE WHEN f."optionType" = 'GROWTH' THEN 0.02 ELSE 0 END
          ) AS score
        FROM mutual_funds f
        JOIN amcs a ON a.id = f."amcId"
        WHERE f."isActive" = true
          AND (f."normalizedName" % ${normalized} OR f."normalizedName" LIKE ${'%' + normalized + '%'})
          AND (${query.category ?? null}::text IS NULL OR f.category = ${query.category ?? null})
          AND (${query.planType ?? null}::text IS NULL OR f."planType" = ${query.planType ?? null})
          AND (
            ${!query.withHoldingsOnly}
            OR EXISTS (
              SELECT 1 FROM portfolio_snapshots s
              WHERE s."fundId" = f.id AND s.status = 'PUBLISHED'
            )
          )
        ORDER BY score DESC, f.name ASC
        LIMIT ${query.limit}
      `;

      return rows.map((r) => ({
        id: r.id,
        amfiSchemeCode: r.amfiSchemeCode,
        name: r.name,
        amcName: r.amcName,
        category: r.category as FundSummary['category'],
        subCategory: r.subCategory,
        planType: r.planType as FundSummary['planType'],
        optionType: r.optionType as FundSummary['optionType'],
        isinGrowth: r.isinGrowth,
        latestNav: toNum(r.latestNav as never),
        latestNavDate: r.latestNavDate?.toISOString().slice(0, 10) ?? null,
        matchScore: Math.round(Number(r.score) * 1000) / 1000,
      }));
    });
  }

  async getById(fundId: string): Promise<FundDetail> {
    const cached = await this.cache.get<FundDetail>(CacheKeys.fundDetail(fundId));
    if (cached) return cached;

    const fund = await this.prisma.mutualFund.findUnique({
      where: { id: fundId },
      include: {
        amc: { select: { name: true } },
        snapshots: {
          where: { status: SnapshotStatus.PUBLISHED },
          orderBy: { disclosureDate: 'desc' },
          take: 1,
          select: { disclosureDate: true },
        },
      },
    });

    if (!fund) throw new FundNotFoundException(fundId);

    const latestDisclosure = fund.snapshots[0]?.disclosureDate ?? null;
    const staleAfterDays = this.config.get('env', { infer: true }).DISCLOSURE_STALE_AFTER_DAYS;

    const detail: FundDetail = {
      id: fund.id,
      amfiSchemeCode: fund.amfiSchemeCode,
      name: fund.name,
      amcName: fund.amc.name,
      category: fund.category as FundDetail['category'],
      subCategory: fund.subCategory,
      planType: fund.planType as FundDetail['planType'],
      optionType: fund.optionType as FundDetail['optionType'],
      isinGrowth: fund.isinGrowth,
      latestNav: toNum(fund.latestNav),
      latestNavDate: fund.latestNavDate?.toISOString().slice(0, 10) ?? null,
      benchmark: fund.benchmark,
      riskometer: fund.riskometer,
      aumCrore: toNum(fund.aumCrore),
      isActive: fund.isActive,
      latestDisclosureDate: latestDisclosure?.toISOString().slice(0, 10) ?? null,
      disclosureStale: latestDisclosure
        ? daysBetween(new Date(), latestDisclosure) > staleAfterDays
        : false,
    };

    await this.cache.set(CacheKeys.fundDetail(fundId), detail, CacheTtl.FUND_DETAIL);
    return detail;
  }

  /** Summary projection used when embedding a fund in another payload. */
  async getSummary(fundId: string): Promise<FundSummary> {
    const detail = await this.getById(fundId);
    const { benchmark: _b, riskometer: _r, aumCrore: _a, ...summary } = detail;
    return summary;
  }

  /** Disclosure periods available for a scheme, newest first. */
  async listDisclosurePeriods(fundId: string) {
    const snapshots = await this.prisma.portfolioSnapshot.findMany({
      where: { fundId, status: SnapshotStatus.PUBLISHED },
      orderBy: { disclosureDate: 'desc' },
      select: {
        id: true,
        disclosureDate: true,
        holdingsCount: true,
        equityCount: true,
        totalEquityWeightPct: true,
        importedAt: true,
        source: true,
      },
    });

    if (snapshots.length === 0) {
      // Distinguish "no such fund" from "fund exists, nothing disclosed yet" —
      // the UI shows very different things for the two.
      const exists = await this.prisma.mutualFund.count({ where: { id: fundId } });
      if (exists === 0) throw new FundNotFoundException(fundId);
    }

    return snapshots.map((s) => ({
      snapshotId: s.id,
      disclosureDate: s.disclosureDate.toISOString().slice(0, 10),
      holdingsCount: s.holdingsCount,
      equityCount: s.equityCount,
      totalEquityWeightPct: toNum(s.totalEquityWeightPct) ?? 0,
      importedAt: s.importedAt.toISOString(),
      source: s.source,
    }));
  }
}
