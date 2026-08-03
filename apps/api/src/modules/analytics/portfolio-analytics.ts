import {
  InstrumentType,
  MarketCapCategory,
  NEGLIGIBLE_WEIGHT_PCT,
  type HoldingRow,
  type MarketCapAllocation,
  type MoverRow,
  type PortfolioAnalytics,
  type SectorAllocation,
} from '@fundlens/shared';
import { mean, round, sum, weightedMean } from '../../common/utils/decimal';

/**
 * Pure portfolio maths.
 *
 * Deliberately free of Prisma, Nest and Redis so the numbers on the dashboard
 * can be unit-tested directly against fixed inputs — these figures are the
 * product, and a regression here is not something to discover in production.
 *
 * Conventions applied throughout:
 *  - weights are percentages of net assets as disclosed, never renormalised
 *    silently. A fund holding 92% equity shows 92%, not 100%;
 *  - a metric with no measurable input is `null`, never `0`. "We don't know"
 *    and "it didn't move" are different statements and the UI renders them
 *    differently.
 */

const UNCHANGED_EPSILON = 0.005;

export function computeAnalytics(
  fundId: string,
  disclosureDate: string,
  holdings: HoldingRow[],
): PortfolioAnalytics {
  const equity = holdings.filter((h) => h.instrumentType === InstrumentType.EQUITY);
  const nonEquity = holdings.filter((h) => h.instrumentType !== InstrumentType.EQUITY);

  const byWeight = [...equity].sort((a, b) => b.weightPct - a.weightPct);
  const priced = equity.filter((h) => h.quote?.changePct != null);

  const top10 = byWeight.slice(0, 10).map(toMover);

  // Only holdings big enough to matter are eligible to be called out as the
  // day's movers; a 0.02% position moving 9% is noise, not a story.
  const material = priced.filter((h) => h.weightPct >= NEGLIGIBLE_WEIGHT_PCT);
  const byChange = [...material].sort(
    (a, b) => (b.quote!.changePct as number) - (a.quote!.changePct as number),
  );

  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  for (const h of priced) {
    const change = h.quote!.changePct as number;
    if (change > UNCHANGED_EPSILON) advancers += 1;
    else if (change < -UNCHANGED_EPSILON) decliners += 1;
    else unchanged += 1;
  }

  return {
    fundId,
    disclosureDate,
    totalInstruments: holdings.length,
    totalStocks: equity.length,
    totalEquityWeightPct: sum(
      equity.map((h) => h.weightPct),
      2,
    ),
    nonEquityWeightPct: sum(
      nonEquity.map((h) => h.weightPct),
      2,
    ),
    top10WeightPct: sum(
      byWeight.slice(0, 10).map((h) => h.weightPct),
      2,
    ),
    top10,
    highestWeighted: byWeight.length > 0 ? toMover(byWeight[0]) : null,
    lowestWeighted: byWeight.length > 0 ? toMover(byWeight[byWeight.length - 1]) : null,
    averageChangePct: mean(
      priced.map((h) => h.quote!.changePct),
      2,
    ),
    weightedAverageChangePct: weightedMean(
      equity.map((h) => ({ weight: h.weightPct, value: h.quote?.changePct ?? null })),
      3,
    ),
    advancers,
    decliners,
    unchanged,
    topGainers: byChange.slice(0, 5).map(toMover),
    topLosers: byChange.slice(-5).reverse().map(toMover),
    sectorAllocation: computeSectorAllocation(equity),
    marketCapAllocation: computeMarketCapAllocation(equity),
    concentrationHhi: computeHhi(equity),
    priceCoverage: { withQuote: priced.length, total: equity.length },
    generatedAt: new Date().toISOString(),
  };
}

export function computeSectorAllocation(equity: HoldingRow[]): SectorAllocation[] {
  const groups = new Map<string, HoldingRow[]>();
  for (const h of equity) {
    // Unmapped instruments still carry weight and must appear, or the chart
    // silently understates the portfolio.
    const key = h.stock?.sector ?? (h.mapped ? 'Unclassified' : 'Unmapped');
    const bucket = groups.get(key);
    if (bucket) bucket.push(h);
    else groups.set(key, [h]);
  }

  return [...groups.entries()]
    .map(([sector, rows]) => ({
      sector,
      weightPct: sum(
        rows.map((r) => r.weightPct),
        2,
      ),
      stockCount: rows.length,
      weightedChangePct: weightedMean(
        rows.map((r) => ({ weight: r.weightPct, value: r.quote?.changePct ?? null })),
        3,
      ),
    }))
    .sort((a, b) => b.weightPct - a.weightPct);
}

export function computeMarketCapAllocation(equity: HoldingRow[]): MarketCapAllocation[] {
  const order: MarketCapCategory[] = [
    MarketCapCategory.LARGE_CAP,
    MarketCapCategory.MID_CAP,
    MarketCapCategory.SMALL_CAP,
    MarketCapCategory.UNCLASSIFIED,
  ];
  const groups = new Map<MarketCapCategory, HoldingRow[]>();

  for (const h of equity) {
    const key = h.stock?.marketCapCategory ?? MarketCapCategory.UNCLASSIFIED;
    const bucket = groups.get(key);
    if (bucket) bucket.push(h);
    else groups.set(key, [h]);
  }

  return order
    .filter((c) => groups.has(c))
    .map((category) => ({
      category,
      weightPct: sum(
        groups.get(category)!.map((r) => r.weightPct),
        2,
      ),
      stockCount: groups.get(category)!.length,
    }));
}

/**
 * Herfindahl–Hirschman index over holding weights, on the conventional 0–10000
 * scale (sum of squared percentage shares). Shares are taken over the *equity*
 * sleeve so that a fund holding 30% cash is not scored as concentrated purely
 * because its equity book is small.
 */
export function computeHhi(equity: HoldingRow[]): number {
  const total = equity.reduce((s, h) => s + h.weightPct, 0);
  if (total <= 0) return 0;
  return round(
    equity.reduce((acc, h) => {
      const share = (h.weightPct / total) * 100;
      return acc + share * share;
    }, 0),
    1,
  );
}

/**
 * Weight-vs-move table: how much each holding actually contributed to the
 * portfolio's implied intraday move, as opposed to how much it moved on its own.
 * This is what makes "compare today's movement with each stock's weight"
 * answerable with a number rather than an impression.
 */
export function computeContribution(equity: HoldingRow[]): Array<{
  instrumentName: string;
  nseSymbol: string | null;
  weightPct: number;
  changePct: number;
  contributionPct: number;
  /** Share of the portfolio's total absolute movement attributable to this holding. */
  shareOfMovePct: number | null;
}> {
  const rows = equity
    .filter((h) => h.quote?.changePct != null)
    .map((h) => ({
      instrumentName: h.stock?.name ?? h.instrumentName,
      nseSymbol: h.stock?.nseSymbol ?? null,
      weightPct: h.weightPct,
      changePct: h.quote!.changePct as number,
      contributionPct: round((h.weightPct * (h.quote!.changePct as number)) / 100, 4),
    }));

  const totalAbs = rows.reduce((s, r) => s + Math.abs(r.contributionPct), 0);

  return rows
    .map((r) => ({
      ...r,
      shareOfMovePct:
        totalAbs === 0 ? null : round((Math.abs(r.contributionPct) / totalAbs) * 100, 2),
    }))
    .sort((a, b) => Math.abs(b.contributionPct) - Math.abs(a.contributionPct));
}

function toMover(h: HoldingRow): MoverRow {
  return {
    stockName: h.stock?.name ?? h.instrumentName,
    nseSymbol: h.stock?.nseSymbol ?? null,
    weightPct: h.weightPct,
    changePct: h.quote?.changePct ?? 0,
    ltp: h.quote?.ltp ?? null,
  };
}
