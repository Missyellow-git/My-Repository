import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CacheKeys, SnapshotStatus } from '@fundlens/shared';
import { CacheService } from '../../cache/cache.service';
import { normalizeSchemeName } from '../../common/utils/text';
import { round } from '../../common/utils/decimal';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DISCLOSURE_PROVIDER,
  type DisclosureProvider,
  type RawDisclosure,
} from './disclosure.types';
import { StockMapperService } from './stock-mapper.service';

export interface ImportStats {
  disclosuresSeen: number;
  imported: number;
  skippedUnchanged: number;
  skippedUnknownScheme: number;
  failed: number;
  unmappedInstruments: number;
  warnings: string[];
  /** Snapshot ids created or refreshed, for downstream alert evaluation. */
  newSnapshotIds: string[];
}

/**
 * Turns raw disclosures into published snapshots.
 *
 * The pipeline is: resolve scheme → map instruments → validate → write
 * snapshot + holdings atomically → publish → invalidate cache.
 *
 * Two invariants it enforces, both learned from how this data actually behaves:
 *
 *  - **Re-import is idempotent.** A checksum over the normalised rows means an
 *    unchanged file is recognised and skipped, so a daily job that re-reads the
 *    same month costs one hash instead of a full rewrite (and never churns
 *    `importedAt`, which the UI shows).
 *  - **A snapshot is published only if it validates.** Weights must sum to
 *    roughly 100% and at least half the equity weight must be mapped to listed
 *    securities. A snapshot that fails is stored with status FAILED and the
 *    previous one keeps serving — showing a broken portfolio is worse than
 *    showing last month's.
 */
@Injectable()
export class DisclosureImportService {
  private readonly logger = new Logger(DisclosureImportService.name);

  /** Accepted deviation of total disclosed weight from 100%. */
  private static readonly WEIGHT_TOLERANCE_PCT = 2;
  /** Minimum share of equity weight that must map to a known security. */
  private static readonly MIN_MAPPED_EQUITY_RATIO = 0.5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: StockMapperService,
    private readonly cache: CacheService,
    @Inject(DISCLOSURE_PROVIDER) private readonly provider: DisclosureProvider,
  ) {}

  /** Entry point for the scheduled job. */
  async syncLatest(since?: Date): Promise<ImportStats> {
    const { disclosures, warnings } = await this.provider.fetchLatest(since);
    const stats = this.emptyStats();
    stats.warnings.push(...warnings);
    stats.disclosuresSeen = disclosures.length;

    for (const disclosure of disclosures) {
      try {
        const result = await this.importOne(disclosure);
        switch (result.outcome) {
          case 'imported':
            stats.imported += 1;
            stats.unmappedInstruments += result.unmappedCount;
            if (result.snapshotId) stats.newSnapshotIds.push(result.snapshotId);
            break;
          case 'unchanged':
            stats.skippedUnchanged += 1;
            break;
          case 'unknown-scheme':
            stats.skippedUnknownScheme += 1;
            stats.warnings.push(`No scheme matched "${disclosure.schemeName}"`);
            break;
          case 'invalid':
            stats.failed += 1;
            stats.warnings.push(
              `Validation failed for "${disclosure.schemeName}": ${result.reason}`,
            );
            break;
        }
      } catch (err) {
        stats.failed += 1;
        stats.warnings.push(
          `Import error for "${disclosure.schemeName}": ${(err as Error).message}`,
        );
        this.logger.error(`Import failed for ${disclosure.schemeName}`, (err as Error).stack);
      }
    }

    stats.warnings = stats.warnings.slice(0, 100);
    this.logger.log(
      `Disclosure sync: ${stats.imported} imported, ${stats.skippedUnchanged} unchanged, ` +
        `${stats.skippedUnknownScheme} unknown schemes, ${stats.failed} failed`,
    );
    return stats;
  }

  async importOne(disclosure: RawDisclosure): Promise<{
    outcome: 'imported' | 'unchanged' | 'unknown-scheme' | 'invalid';
    snapshotId?: string;
    unmappedCount: number;
    reason?: string;
  }> {
    const fund = await this.resolveFund(disclosure);
    if (!fund) return { outcome: 'unknown-scheme', unmappedCount: 0 };

    const checksum = this.checksum(disclosure);
    const existing = await this.prisma.portfolioSnapshot.findUnique({
      where: {
        fundId_disclosureDate: { fundId: fund.id, disclosureDate: disclosure.disclosureDate },
      },
      select: { id: true, checksum: true, status: true },
    });

    if (existing?.checksum === checksum && existing.status === SnapshotStatus.PUBLISHED) {
      return { outcome: 'unchanged', unmappedCount: 0 };
    }

    const totalWeight = disclosure.lines.reduce((s, l) => s + l.weightPct, 0);
    if (Math.abs(totalWeight - 100) > DisclosureImportService.WEIGHT_TOLERANCE_PCT) {
      await this.recordFailure(
        fund.id,
        disclosure,
        checksum,
        `weights sum to ${totalWeight.toFixed(2)}%`,
      );
      return {
        outcome: 'invalid',
        unmappedCount: 0,
        reason: `weights sum to ${totalWeight.toFixed(2)}%, outside tolerance`,
      };
    }

    // Map only the lines that could plausibly be listed securities; running the
    // fuzzy matcher over government bonds wastes queries and risks bad matches.
    const mappable = disclosure.lines.filter(
      (l) =>
        (l.instrumentType ?? StockMapperService.inferInstrumentType(l.instrumentName, l.isin)) ===
        'EQUITY',
    );
    const mappings = await this.mapper.mapMany(
      mappable.map((l) => ({ instrumentName: l.instrumentName, isin: l.isin })),
    );

    let mappedEquityWeight = 0;
    let totalEquityWeight = 0;
    let unmappedCount = 0;

    for (const line of mappable) {
      totalEquityWeight += line.weightPct;
      if (mappings.get(line.instrumentName)?.stockId) mappedEquityWeight += line.weightPct;
      else unmappedCount += 1;
    }

    const mappedRatio = totalEquityWeight === 0 ? 1 : mappedEquityWeight / totalEquityWeight;
    if (mappedRatio < DisclosureImportService.MIN_MAPPED_EQUITY_RATIO) {
      await this.recordFailure(
        fund.id,
        disclosure,
        checksum,
        `only ${(mappedRatio * 100).toFixed(0)}% of equity weight mapped to known securities`,
      );
      return {
        outcome: 'invalid',
        unmappedCount,
        reason: `only ${(mappedRatio * 100).toFixed(0)}% of equity weight could be mapped`,
      };
    }

    // Rank by descending weight so `rank` is meaningful without a re-sort.
    const ordered = [...disclosure.lines].sort((a, b) => b.weightPct - a.weightPct);

    const snapshotId = await this.prisma.$transaction(async (tx) => {
      const snapshot = await tx.portfolioSnapshot.upsert({
        where: {
          fundId_disclosureDate: { fundId: fund.id, disclosureDate: disclosure.disclosureDate },
        },
        create: {
          fundId: fund.id,
          disclosureDate: disclosure.disclosureDate,
          status: SnapshotStatus.PARSED,
          source: this.provider.name,
          sourceUrl: disclosure.sourceUrl ?? null,
          checksum,
          totalAumCrore: disclosure.totalAumCrore ?? null,
        },
        update: {
          status: SnapshotStatus.PARSED,
          source: this.provider.name,
          sourceUrl: disclosure.sourceUrl ?? null,
          checksum,
          totalAumCrore: disclosure.totalAumCrore ?? null,
          importedAt: new Date(),
        },
        select: { id: true },
      });

      // Replace wholesale rather than diffing rows: a disclosure is a complete
      // statement, and a partial update could leave a stale position behind.
      await tx.holding.deleteMany({ where: { snapshotId: snapshot.id } });

      await tx.holding.createMany({
        data: ordered.map((line, index) => {
          const instrumentType =
            line.instrumentType ??
            StockMapperService.inferInstrumentType(line.instrumentName, line.isin);
          const mapping =
            instrumentType === 'EQUITY' ? mappings.get(line.instrumentName) : undefined;
          return {
            snapshotId: snapshot.id,
            stockId: mapping?.stockId ?? null,
            instrumentName: line.instrumentName,
            isin: line.isin,
            instrumentType,
            quantity: line.quantity,
            marketValueLakh: line.marketValueLakh,
            weightPct: round(line.weightPct, 4),
            rank: index + 1,
            mappingConfidence: mapping?.confidence ?? null,
          };
        }),
      });

      const equityLines = ordered.filter((l) => {
        const t =
          l.instrumentType ?? StockMapperService.inferInstrumentType(l.instrumentName, l.isin);
        return t === 'EQUITY';
      });

      await tx.portfolioSnapshot.update({
        where: { id: snapshot.id },
        data: {
          status: SnapshotStatus.PUBLISHED,
          publishedAt: new Date(),
          holdingsCount: ordered.length,
          equityCount: equityLines.length,
          totalEquityWeightPct: round(
            equityLines.reduce((s, l) => s + l.weightPct, 0),
            4,
          ),
          unmappedCount,
          parseWarnings:
            unmappedCount > 0
              ? {
                  unmapped: mappable
                    .filter((l) => !mappings.get(l.instrumentName)?.stockId)
                    .map((l) => l.instrumentName)
                    .slice(0, 100),
                }
              : undefined,
        },
      });

      // Any older snapshot for this fund that is still PARSED never made it to
      // PUBLISHED; mark it superseded so it cannot be picked up by mistake.
      await tx.portfolioSnapshot.updateMany({
        where: {
          fundId: fund.id,
          status: SnapshotStatus.PARSED,
          disclosureDate: { lt: disclosure.disclosureDate },
        },
        data: { status: SnapshotStatus.SUPERSEDED },
      });

      return snapshot.id;
    });

    // Learn confirmed spellings so the next import short-circuits the fuzzy path.
    for (const line of mappable) {
      const mapping = mappings.get(line.instrumentName);
      if (
        mapping?.stockId &&
        (mapping.method === 'fuzzy-name' || mapping.method === 'exact-name')
      ) {
        await this.mapper.learnAlias(mapping.stockId, line.instrumentName);
      }
    }

    await this.invalidate(fund.id, snapshotId);

    this.logger.log(
      `Imported ${disclosure.schemeName} @ ${disclosure.disclosureDate.toISOString().slice(0, 10)}: ` +
        `${ordered.length} lines, ${unmappedCount} unmapped`,
    );

    return { outcome: 'imported', snapshotId, unmappedCount };
  }

  /**
   * Resolves a disclosure to a scheme.
   *
   * Scheme code is authoritative when present. Name matching is restricted to
   * an exact normalised match — a fuzzy scheme match would happily attach a
   * Small Cap fund's holdings to the same AMC's Mid Cap fund, and unlike a
   * mis-mapped stock that error is invisible to the user.
   */
  private async resolveFund(disclosure: RawDisclosure) {
    if (disclosure.amfiSchemeCode) {
      const byCode = await this.prisma.mutualFund.findUnique({
        where: { amfiSchemeCode: disclosure.amfiSchemeCode },
        select: { id: true, name: true },
      });
      if (byCode) return byCode;
    }

    const normalized = normalizeSchemeName(disclosure.schemeName);
    const matches = await this.prisma.mutualFund.findMany({
      where: { normalizedName: normalized, isActive: true },
      select: { id: true, name: true, planType: true },
      take: 5,
    });

    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      // Same normalised name across plans/options — prefer Direct-Growth, the
      // variant whose portfolio is identical and which users search for most.
      const direct = matches.find((m) => m.planType === 'DIRECT');
      if (direct) return direct;
      return matches[0];
    }
    return null;
  }

  private async recordFailure(
    fundId: string,
    disclosure: RawDisclosure,
    checksum: string,
    reason: string,
  ): Promise<void> {
    this.logger.warn(`Rejecting disclosure for ${disclosure.schemeName}: ${reason}`);
    await this.prisma.portfolioSnapshot.upsert({
      where: { fundId_disclosureDate: { fundId, disclosureDate: disclosure.disclosureDate } },
      create: {
        fundId,
        disclosureDate: disclosure.disclosureDate,
        status: SnapshotStatus.FAILED,
        source: this.provider.name,
        sourceUrl: disclosure.sourceUrl ?? null,
        checksum,
        parseWarnings: { reason },
      },
      // Never downgrade a PUBLISHED snapshot to FAILED: the good data we
      // already serve outranks a bad re-read of the same period.
      update: { parseWarnings: { reason }, checksum },
    });
  }

  /** Stable hash of the meaningful content, insensitive to row order. */
  private checksum(disclosure: RawDisclosure): string {
    const canonical = disclosure.lines
      .map(
        (l) => `${normalizeSchemeName(l.instrumentName)}|${l.isin ?? ''}|${round(l.weightPct, 4)}`,
      )
      .sort()
      .join('\n');
    return createHash('sha256')
      .update(`${disclosure.disclosureDate.toISOString().slice(0, 10)}\n${canonical}`)
      .digest('hex');
  }

  private async invalidate(fundId: string, snapshotId: string): Promise<void> {
    await this.cache.del(
      CacheKeys.fundDetail(fundId),
      CacheKeys.latestSnapshotId(fundId),
      CacheKeys.snapshotHoldings(snapshotId),
      CacheKeys.analytics(snapshotId),
      CacheKeys.sectorAllocation(snapshotId),
    );
    await this.cache.delByPattern(`ai:insights:${snapshotId}:*`);
  }

  private emptyStats(): ImportStats {
    return {
      disclosuresSeen: 0,
      imported: 0,
      skippedUnchanged: 0,
      skippedUnknownScheme: 0,
      failed: 0,
      unmappedInstruments: 0,
      warnings: [],
      newSnapshotIds: [],
    };
  }
}
