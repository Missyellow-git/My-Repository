import { Injectable } from '@nestjs/common';
import {
  CacheKeys,
  CacheTtl,
  InstrumentType,
  type ComparisonResult,
  type HoldingChange,
  type OverlapResult,
  type PortfolioAnalytics,
  type SectorAllocation,
} from '@fundlens/shared';
import { CacheService } from '../../cache/cache.service';
import { round } from '../../common/utils/decimal';
import { FundsService } from '../funds/funds.service';
import { HoldingsService } from '../holdings/holdings.service';
import {
  computeAnalytics,
  computeContribution,
  computeSectorAllocation,
} from './portfolio-analytics';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly holdings: HoldingsService,
    private readonly funds: FundsService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Analytics are cached for 60s — matching the price refresh interval — rather
   * than recomputed per request. On a popular scheme this collapses hundreds of
   * identical computations into one without ever serving numbers older than the
   * prices they were derived from.
   */
  async getAnalytics(fundId: string, date: string): Promise<PortfolioAnalytics> {
    const snapshot = await this.holdings.resolveSnapshot(fundId, date);

    return this.cache.getOrSet(CacheKeys.analytics(snapshot.id), CacheTtl.ANALYTICS, async () => {
      const response = await this.holdings.getHoldings(fundId, {
        date,
        includeNonEquity: true,
        includeUnmapped: true,
        withPrices: true,
      });
      return computeAnalytics(fundId, snapshot.disclosureDate, response.holdings);
    });
  }

  async getSectorAllocation(fundId: string, date: string): Promise<SectorAllocation[]> {
    const snapshot = await this.holdings.resolveSnapshot(fundId, date);

    return this.cache.getOrSet(
      CacheKeys.sectorAllocation(snapshot.id),
      CacheTtl.SECTOR_ALLOCATION,
      async () => {
        const response = await this.holdings.getHoldings(fundId, {
          date,
          includeNonEquity: false,
          includeUnmapped: true,
          withPrices: true,
        });
        return computeSectorAllocation(response.holdings);
      },
    );
  }

  async getContribution(fundId: string, date: string) {
    const response = await this.holdings.getHoldings(fundId, {
      date,
      includeNonEquity: false,
      includeUnmapped: true,
      withPrices: true,
    });
    return computeContribution(response.holdings);
  }

  /**
   * Period-over-period comparison for one scheme.
   *
   * Positions are keyed by ISIN when available and by instrument name
   * otherwise. That matters because an AMC can change how it spells a company
   * between two filings; keying on the printed name alone would report the same
   * position as one exit plus one addition and inflate turnover.
   */
  async comparePeriods(
    fundId: string,
    fromDate: string,
    toDate: string,
  ): Promise<ComparisonResult> {
    const [fund, from, to] = await Promise.all([
      this.funds.getSummary(fundId),
      this.holdings.getHoldings(fundId, {
        date: fromDate,
        includeNonEquity: true,
        includeUnmapped: true,
        withPrices: false,
      }),
      this.holdings.getHoldings(fundId, {
        date: toDate,
        includeNonEquity: true,
        includeUnmapped: true,
        withPrices: false,
      }),
    ]);

    const keyOf = (h: {
      isin: string | null;
      instrumentName: string;
      stock: { id: string } | null;
    }) => h.stock?.id ?? h.isin ?? h.instrumentName.toLowerCase();

    const fromMap = new Map(from.holdings.map((h) => [keyOf(h), h]));
    const toMap = new Map(to.holdings.map((h) => [keyOf(h), h]));

    const added: HoldingChange[] = [];
    const exited: HoldingChange[] = [];
    const increased: HoldingChange[] = [];
    const reduced: HoldingChange[] = [];
    let unchangedCount = 0;

    for (const [key, current] of toMap) {
      const previous = fromMap.get(key);
      const change: HoldingChange = {
        instrumentName: current.stock?.name ?? current.instrumentName,
        nseSymbol: current.stock?.nseSymbol ?? null,
        weightFrom: previous?.weightPct ?? null,
        weightTo: current.weightPct,
        weightDeltaPct: round(current.weightPct - (previous?.weightPct ?? 0), 4),
        changeType: 'UNCHANGED',
      };

      if (!previous) {
        added.push({ ...change, changeType: 'ADDED' });
      } else if (Math.abs(change.weightDeltaPct) < 0.01) {
        // Below a basis point of net assets is rounding in the source document,
        // not a portfolio manager's decision.
        unchangedCount += 1;
      } else if (change.weightDeltaPct > 0) {
        increased.push({ ...change, changeType: 'INCREASED' });
      } else {
        reduced.push({ ...change, changeType: 'REDUCED' });
      }
    }

    for (const [key, previous] of fromMap) {
      if (toMap.has(key)) continue;
      exited.push({
        instrumentName: previous.stock?.name ?? previous.instrumentName,
        nseSymbol: previous.stock?.nseSymbol ?? null,
        weightFrom: previous.weightPct,
        weightTo: null,
        weightDeltaPct: round(-previous.weightPct, 4),
        changeType: 'EXITED',
      });
    }

    // One-way turnover: half the summed absolute weight change, the standard
    // convention — a switch out of A into B is one trade, not two.
    const turnoverPct = round(
      [...added, ...exited, ...increased, ...reduced].reduce(
        (s, c) => s + Math.abs(c.weightDeltaPct),
        0,
      ) / 2,
      2,
    );

    return {
      fundId,
      fundName: fund.name,
      fromDate: from.snapshot.disclosureDate,
      toDate: to.snapshot.disclosureDate,
      added: added.sort((a, b) => b.weightDeltaPct - a.weightDeltaPct),
      exited: exited.sort((a, b) => (b.weightFrom ?? 0) - (a.weightFrom ?? 0)),
      increased: increased.sort((a, b) => b.weightDeltaPct - a.weightDeltaPct),
      reduced: reduced.sort((a, b) => a.weightDeltaPct - b.weightDeltaPct),
      unchangedCount,
      turnoverPct,
      sectorShift: this.sectorShift(from.holdings, to.holdings),
    };
  }

  /**
   * Overlap between two schemes, using the standard minimum-weight measure:
   * Σ min(weight in A, weight in B). Two funds sharing every name at identical
   * weights score 100; disjoint portfolios score 0.
   */
  async compareFunds(fundIdA: string, fundIdB: string): Promise<OverlapResult> {
    const [a, b] = await Promise.all([
      this.holdings.getHoldings(fundIdA, {
        date: 'latest',
        includeNonEquity: false,
        includeUnmapped: true,
        withPrices: false,
      }),
      this.holdings.getHoldings(fundIdB, {
        date: 'latest',
        includeNonEquity: false,
        includeUnmapped: true,
        withPrices: false,
      }),
    ]);

    const keyOf = (h: {
      isin: string | null;
      instrumentName: string;
      stock: { id: string } | null;
    }) => h.stock?.id ?? h.isin ?? h.instrumentName.toLowerCase();

    const bMap = new Map(b.holdings.map((h) => [keyOf(h), h]));
    const common: OverlapResult['commonHoldings'] = [];
    let overlap = 0;

    for (const holding of a.holdings) {
      const match = bMap.get(keyOf(holding));
      if (!match) continue;
      overlap += Math.min(holding.weightPct, match.weightPct);
      common.push({
        instrumentName: holding.stock?.name ?? holding.instrumentName,
        nseSymbol: holding.stock?.nseSymbol ?? null,
        weightA: holding.weightPct,
        weightB: match.weightPct,
      });
    }

    common.sort((x, y) => Math.min(y.weightA, y.weightB) - Math.min(x.weightA, x.weightB));

    return {
      fundA: { id: fundIdA, name: a.fund.name, disclosureDate: a.snapshot.disclosureDate },
      fundB: { id: fundIdB, name: b.fund.name, disclosureDate: b.snapshot.disclosureDate },
      overlapPct: round(overlap, 2),
      commonHoldings: common,
      onlyInA: a.holdings.length - common.length,
      onlyInB: b.holdings.length - common.length,
    };
  }

  private sectorShift(
    from: Parameters<typeof computeSectorAllocation>[0],
    to: Parameters<typeof computeSectorAllocation>[0],
  ) {
    const equityOnly = (rows: typeof from) =>
      rows.filter((r) => r.instrumentType === InstrumentType.EQUITY);
    const fromAlloc = new Map(
      computeSectorAllocation(equityOnly(from)).map((s) => [s.sector, s.weightPct]),
    );
    const toAlloc = new Map(
      computeSectorAllocation(equityOnly(to)).map((s) => [s.sector, s.weightPct]),
    );

    return [...new Set([...fromAlloc.keys(), ...toAlloc.keys()])]
      .map((sector) => {
        const weightFrom = fromAlloc.get(sector) ?? 0;
        const weightTo = toAlloc.get(sector) ?? 0;
        return { sector, weightFrom, weightTo, delta: round(weightTo - weightFrom, 2) };
      })
      .filter((s) => Math.abs(s.delta) >= 0.01)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }
}
