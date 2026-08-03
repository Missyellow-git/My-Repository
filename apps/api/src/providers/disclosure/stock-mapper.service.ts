import { Injectable, Logger } from '@nestjs/common';
import { normalizeName, similarity } from '../../common/utils/text';
import { PrismaService } from '../../prisma/prisma.service';

export interface MappingResult {
  stockId: string | null;
  confidence: number;
  /** How the match was made — recorded so bad heuristics can be audited. */
  method: 'isin' | 'alias' | 'exact-name' | 'fuzzy-name' | 'none';
  matchedName?: string;
}

/**
 * Maps a disclosure line to a listed security.
 *
 * This is the single hardest correctness problem in the product: AMCs print
 * "Bajaj Finance Ltd.", "Bajaj Finance Limited" and "BAJAJ FINANCE LTD" for the
 * same company, sometimes with the ISIN and sometimes without, and a wrong
 * match attaches a live price to the wrong holding.
 *
 * The strategy is strictly tiered, most reliable first, and it refuses to guess:
 *
 *   1. ISIN            — exact identifier, confidence 1.00
 *   2. Learned alias   — a previously confirmed spelling, confidence 0.95
 *   3. Exact normalised name                        confidence 0.90
 *   4. Trigram + token-set similarity above 0.72    confidence = the score
 *   5. Otherwise unmapped
 *
 * An unmapped line is preserved verbatim in the snapshot and reported to the
 * client as `unmappedInstruments`. Showing a hole is correct; silently dropping
 * a 4% position, or attaching it to a similarly named company, is not.
 */
@Injectable()
export class StockMapperService {
  private readonly logger = new Logger(StockMapperService.name);

  /** Below this, a fuzzy name match is rejected outright. */
  private static readonly FUZZY_FLOOR = 0.72;
  /** A fuzzy match must beat the runner-up by this margin to be accepted. */
  private static readonly AMBIGUITY_MARGIN = 0.08;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Maps many lines at once. Batched deliberately: a 60-line disclosure would
   * otherwise issue 60 round trips per tier.
   */
  async mapMany(
    lines: Array<{ instrumentName: string; isin: string | null }>,
  ): Promise<Map<string, MappingResult>> {
    const out = new Map<string, MappingResult>();
    if (lines.length === 0) return out;

    const isins = [...new Set(lines.map((l) => l.isin).filter((i): i is string => !!i))];
    const normalized = new Map(
      lines.map((l) => [l.instrumentName, normalizeName(l.instrumentName)]),
    );
    const normalizedValues = [...new Set(normalized.values())];

    const [byIsin, byAlias, byName] = await Promise.all([
      isins.length
        ? this.prisma.stock.findMany({
            where: { isin: { in: isins } },
            select: { id: true, isin: true, name: true },
          })
        : Promise.resolve([]),
      normalizedValues.length
        ? this.prisma.stockAlias.findMany({
            where: { normalizedAlias: { in: normalizedValues } },
            select: { stockId: true, normalizedAlias: true },
          })
        : Promise.resolve([]),
      normalizedValues.length
        ? this.prisma.stock.findMany({
            where: { normalizedName: { in: normalizedValues } },
            select: { id: true, normalizedName: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const isinIndex = new Map(byIsin.map((s) => [s.isin!, s]));
    const aliasIndex = new Map(byAlias.map((a) => [a.normalizedAlias, a.stockId]));
    const nameIndex = new Map(byName.map((s) => [s.normalizedName, s]));

    const needsFuzzy: Array<{ key: string; normalized: string }> = [];

    for (const line of lines) {
      const key = line.instrumentName;
      const norm = normalized.get(key)!;

      if (line.isin && isinIndex.has(line.isin)) {
        const hit = isinIndex.get(line.isin)!;
        out.set(key, { stockId: hit.id, confidence: 1, method: 'isin', matchedName: hit.name });
        continue;
      }
      if (aliasIndex.has(norm)) {
        out.set(key, { stockId: aliasIndex.get(norm)!, confidence: 0.95, method: 'alias' });
        continue;
      }
      if (nameIndex.has(norm)) {
        const hit = nameIndex.get(norm)!;
        out.set(key, {
          stockId: hit.id,
          confidence: 0.9,
          method: 'exact-name',
          matchedName: hit.name,
        });
        continue;
      }
      needsFuzzy.push({ key, normalized: norm });
    }

    for (const { key, normalized: norm } of needsFuzzy) {
      out.set(key, await this.fuzzyMatch(norm));
    }

    return out;
  }

  /**
   * Trigram-shortlisted, token-set-scored fuzzy match.
   *
   * Postgres `similarity()` narrows thousands of stocks to a handful cheaply
   * (it uses the GIN trigram index); the final decision uses the token-set
   * score from text.ts, which handles dropped/added whole words better than
   * trigrams do. Requiring a margin over the runner-up prevents "Tata Steel"
   * from being resolved when both "Tata Steel" and "Tata Steel Long Products"
   * score similarly.
   */
  private async fuzzyMatch(normalizedName: string): Promise<MappingResult> {
    if (normalizedName.length < 3) return { stockId: null, confidence: 0, method: 'none' };

    const candidates = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; normalizedName: string; sim: number }>
    >`
      SELECT id, name, "normalizedName", similarity("normalizedName", ${normalizedName}) AS sim
      FROM stocks
      WHERE "isActive" = true
        AND "normalizedName" % ${normalizedName}
      ORDER BY sim DESC
      LIMIT 5
    `;

    if (candidates.length === 0) return { stockId: null, confidence: 0, method: 'none' };

    const scored = candidates
      .map((c) => ({ ...c, score: similarity(c.normalizedName, normalizedName) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const runnerUp = scored[1];

    if (best.score < StockMapperService.FUZZY_FLOOR) {
      return { stockId: null, confidence: best.score, method: 'none' };
    }
    if (runnerUp && best.score - runnerUp.score < StockMapperService.AMBIGUITY_MARGIN) {
      this.logger.warn(
        `Ambiguous mapping for "${normalizedName}": "${best.name}" (${best.score.toFixed(2)}) vs "${runnerUp.name}" (${runnerUp.score.toFixed(2)}) — left unmapped`,
      );
      return { stockId: null, confidence: best.score, method: 'none' };
    }

    return {
      stockId: best.id,
      confidence: Math.round(best.score * 1000) / 1000,
      method: 'fuzzy-name',
      matchedName: best.name,
    };
  }

  /**
   * Records a confirmed spelling so the next import resolves it at tier 2.
   * The alias table is what stops the fuzzy path from growing unboundedly
   * expensive as the number of tracked schemes rises.
   */
  async learnAlias(
    stockId: string,
    alias: string,
    source: 'auto' | 'manual' = 'auto',
  ): Promise<void> {
    const normalizedAlias = normalizeName(alias);
    if (!normalizedAlias) return;
    await this.prisma.stockAlias
      .upsert({
        where: { normalizedAlias },
        create: { stockId, alias, normalizedAlias, source },
        update: {},
      })
      .catch((err: Error) => this.logger.debug(`Alias learn skipped: ${err.message}`));
  }

  /**
   * Classifies a disclosure line that carries no explicit instrument type.
   * Ordered so the most specific patterns win — a "364 Days Treasury Bill" is
   * money market, not debt, and TREPS is neither.
   */
  static inferInstrumentType(instrumentName: string, isin: string | null): string {
    const n = instrumentName.toLowerCase();

    if (/(treps|reverse repo|tri[- ]?party)/.test(n)) return 'MONEY_MARKET';
    if (/(net receivable|net payable|cash margin|bank balance|current asset)/.test(n))
      return 'CASH';
    if (/(treasury bill|t-bill|certificate of deposit|commercial paper)/.test(n))
      return 'MONEY_MARKET';
    if (/(future|option|call\b|put\b)/.test(n)) return 'DERIVATIVE';
    if (/(reit|invit)/.test(n)) return 'REIT_INVIT';
    if (/(mutual fund|etf|index fund|liquid fund)/.test(n)) return 'MUTUAL_FUND_UNIT';
    if (
      /(government of india|state development loan|\bsdl\b|\bg-?sec\b|\bncd\b|debenture|bond|\d+(\.\d+)?%)/.test(
        n,
      )
    ) {
      return 'DEBT';
    }
    // Fall back to the ISIN issuer prefix. Indian ISINs encode the issuer
    // class: INF is a mutual fund unit, IN0/IN9 are government securities, and
    // INE is a company. Corporate debentures also carry an INE prefix, but the
    // name patterns above ("NCD", "debenture", a coupon rate) have already
    // claimed those — which is why this check runs last rather than first.
    if (isin) {
      if (isin.startsWith('INF')) return 'MUTUAL_FUND_UNIT';
      if (/^IN[09]/.test(isin)) return 'DEBT';
      if (isin.startsWith('INE')) return 'EQUITY';
    }
    // No name signal and no ISIN: refuse to guess. Unmapped lines are reported
    // to the user; a wrongly labelled one would be invisible.
    return 'OTHER';
  }
}
