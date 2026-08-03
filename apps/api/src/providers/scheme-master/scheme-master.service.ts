import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../common/config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiLogService } from '../api-log.service';
import { parseAmfiNavAll, type ParsedScheme } from './amfi-nav.parser';

export interface SchemeSyncStats {
  fetched: number;
  created: number;
  updated: number;
  amcsCreated: number;
  skipped: number;
  warnings: string[];
}

/**
 * Imports the AMFI scheme master — the authoritative, publicly published list
 * of every Indian mutual fund scheme with its NAV.
 *
 * This is what makes "search for any Indian mutual fund" true rather than
 * aspirational: the fund universe comes from AMFI, not from a hand-maintained
 * list. Holdings for those schemes still require a disclosure adapter (see
 * providers/disclosure), so a scheme can exist in search with no portfolio yet —
 * which the API reports explicitly instead of pretending the fund is unknown.
 */
@Injectable()
export class SchemeMasterService {
  private readonly logger = new Logger(SchemeMasterService.name);
  private static readonly UPSERT_CHUNK = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly apiLog: ApiLogService,
  ) {}

  async sync(): Promise<SchemeSyncStats> {
    const url = this.config.get('env', { infer: true }).AMFI_NAV_ALL_URL;
    const started = Date.now();

    let content: string;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { accept: 'text/plain', 'user-agent': 'FundLens/1.0 (scheme-master-sync)' },
        });
        if (!res.ok) throw new Error(`AMFI responded ${res.status}`);
        content = await res.text();
      } finally {
        clearTimeout(timer);
      }
      this.apiLog.record({
        provider: 'amfi',
        endpoint: '/spages/NAVAll.txt',
        outcome: 'ok',
        httpStatus: 200,
        latencyMs: Date.now() - started,
      });
    } catch (err) {
      this.apiLog.record({
        provider: 'amfi',
        endpoint: '/spages/NAVAll.txt',
        outcome: (err as Error).name === 'AbortError' ? 'timeout' : 'error',
        latencyMs: Date.now() - started,
        errorMessage: (err as Error).message,
      });
      throw err;
    }

    const { schemes, warnings } = parseAmfiNavAll(content);
    this.logger.log(`Parsed ${schemes.length} schemes from AMFI (${warnings.length} warnings)`);

    return this.persist(schemes, warnings);
  }

  /** Exposed separately so tests and the seeder can import without network I/O. */
  async persist(schemes: ParsedScheme[], warnings: string[] = []): Promise<SchemeSyncStats> {
    const stats: SchemeSyncStats = {
      fetched: schemes.length,
      created: 0,
      updated: 0,
      amcsCreated: 0,
      skipped: 0,
      // Warnings are capped: a format change can produce tens of thousands of
      // them, and the job-run row should stay readable.
      warnings: warnings.slice(0, 50),
    };

    const amcIds = new Map<string, string>();
    for (const amcName of new Set(schemes.map((s) => s.amcName))) {
      const existing = await this.prisma.amc.findUnique({ where: { name: amcName } });
      if (existing) {
        amcIds.set(amcName, existing.id);
      } else {
        const created = await this.prisma.amc.create({ data: { name: amcName } });
        amcIds.set(amcName, created.id);
        stats.amcsCreated += 1;
      }
    }

    for (let i = 0; i < schemes.length; i += SchemeMasterService.UPSERT_CHUNK) {
      const chunk = schemes.slice(i, i + SchemeMasterService.UPSERT_CHUNK);
      const results = await this.prisma.$transaction(
        chunk.map((s) => {
          const amcId = amcIds.get(s.amcName)!;
          // ISINs are unique in the schema but AMFI sometimes repeats one
          // across a merged scheme; storing null is safer than failing the
          // whole chunk on a vendor-side data error.
          const shared = {
            amcId,
            name: s.schemeName,
            normalizedName: s.normalizedName,
            category: s.category,
            subCategory: s.subCategory,
            planType: s.planType,
            optionType: s.optionType,
            latestNav: s.nav,
            latestNavDate: s.navDate,
            isActive: true,
          };
          return this.prisma.mutualFund.upsert({
            where: { amfiSchemeCode: s.amfiSchemeCode },
            create: {
              amfiSchemeCode: s.amfiSchemeCode,
              isinGrowth: s.isinGrowth,
              isinDivReinv: s.isinDivReinv,
              ...shared,
            },
            // ISINs are intentionally not updated: they never change for a live
            // scheme, and rewriting them risks a unique-constraint collision
            // against a scheme that legitimately owns the value.
            update: shared,
            select: { id: true, createdAt: true, updatedAt: true },
          });
        }),
      );

      for (const r of results) {
        if (r.createdAt.getTime() === r.updatedAt.getTime()) stats.created += 1;
        else stats.updated += 1;
      }
    }

    this.logger.log(
      `Scheme master sync complete: ${stats.created} created, ${stats.updated} updated, ${stats.amcsCreated} new AMCs`,
    );
    return stats;
  }
}
