import { Injectable } from '@nestjs/common';
import {
  AI_DISCLAIMER,
  CacheKeys,
  CacheTtl,
  HHI_THRESHOLDS,
  type AiInsightsResponse,
  type PortfolioAnalytics,
} from '@fundlens/shared';
import { CacheService } from '../../cache/cache.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { FundsService } from '../funds/funds.service';
import { HoldingsService } from '../holdings/holdings.service';
import { LlmService } from './llm.service';

/**
 * Intraday portfolio commentary.
 *
 * The response is split into `facts` (computed, reproducible, always present)
 * and `insights` (model-written prose, may be absent). The UI renders them in
 * visually distinct blocks with an "AI-generated" label on the second — a user
 * must never have to guess which part of the panel is arithmetic and which is
 * a language model's summary of it.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly holdings: HoldingsService,
    private readonly funds: FundsService,
    private readonly llm: LlmService,
    private readonly cache: CacheService,
  ) {}

  async getInsights(fundId: string, date: string): Promise<AiInsightsResponse> {
    const [fund, snapshot] = await Promise.all([
      this.funds.getSummary(fundId),
      this.holdings.resolveSnapshot(fundId, date),
    ]);

    // Bucketed by 10-minute window so a popular fund reuses one generation
    // across all its viewers without ever showing commentary that contradicts
    // the numbers displayed beside it.
    const bucket = String(Math.floor(Date.now() / (CacheTtl.AI_INSIGHTS * 1000)));

    return this.cache.getOrSet(
      CacheKeys.aiInsights(snapshot.id, bucket),
      CacheTtl.AI_INSIGHTS,
      async () => {
        const analytics = await this.analytics.getAnalytics(fundId, date);
        const facts = this.buildFacts(analytics, snapshot.stale, snapshot.disclosureDate);

        const warnings: string[] = [];
        if (snapshot.stale) {
          warnings.push(
            `Holdings are from the ${snapshot.disclosureDate} disclosure and may not reflect current positions.`,
          );
        }
        if (analytics.priceCoverage.withQuote === 0) {
          warnings.push(
            'No live prices are available, so all commentary is limited to disclosed weights.',
          );
        } else if (analytics.priceCoverage.withQuote < analytics.priceCoverage.total) {
          warnings.push(
            `Live prices cover ${analytics.priceCoverage.withQuote} of ${analytics.priceCoverage.total} equity holdings.`,
          );
        }

        const insights = await this.llm.writeInsights(
          this.renderFactsBlock(fund.name, facts, analytics),
        );

        return {
          fundId,
          fundName: fund.name,
          facts,
          insights: insights ?? this.templateInsights(analytics, snapshot.stale),
          generatedBy: insights ? 'llm' : 'template',
          dataAsOf: {
            disclosureDate: snapshot.disclosureDate,
            pricesFetchedAt: analytics.generatedAt,
          },
          disclaimer: AI_DISCLAIMER,
          warnings,
        } satisfies AiInsightsResponse;
      },
    );
  }

  /** Every entry here is arithmetic over disclosed data — no interpretation. */
  private buildFacts(
    a: PortfolioAnalytics,
    stale: boolean,
    disclosureDate: string,
  ): AiInsightsResponse['facts'] {
    const facts: AiInsightsResponse['facts'] = [
      {
        label: 'Disclosure period',
        value: disclosureDate,
        detail: stale ? 'Past the freshness threshold' : 'Current',
      },
      {
        label: 'Equity holdings',
        value: String(a.totalStocks),
        detail: `${a.totalEquityWeightPct}% of net assets`,
      },
      {
        label: 'Non-equity weight',
        value: `${a.nonEquityWeightPct}%`,
        detail: 'Debt, money market and cash',
      },
      {
        label: 'Top 10 concentration',
        value: `${a.top10WeightPct}%`,
        detail: 'Share of net assets in the ten largest positions',
      },
    ];

    if (a.highestWeighted) {
      facts.push({
        label: 'Largest holding',
        value: `${a.highestWeighted.stockName} — ${a.highestWeighted.weightPct}%`,
        detail: a.highestWeighted.nseSymbol ?? undefined,
      });
    }
    if (a.lowestWeighted) {
      facts.push({
        label: 'Smallest holding',
        value: `${a.lowestWeighted.stockName} — ${a.lowestWeighted.weightPct}%`,
        detail: a.lowestWeighted.nseSymbol ?? undefined,
      });
    }

    facts.push({
      label: 'Concentration (HHI)',
      value: String(a.concentrationHhi),
      detail: describeHhi(a.concentrationHhi),
    });

    if (a.priceCoverage.withQuote > 0) {
      facts.push(
        {
          label: 'Breadth today',
          value: `${a.advancers} up / ${a.decliners} down / ${a.unchanged} flat`,
          detail: `Across ${a.priceCoverage.withQuote} priced holdings`,
        },
        {
          label: 'Weighted portfolio move',
          value:
            a.weightedAverageChangePct === null
              ? 'Not available'
              : `${a.weightedAverageChangePct}%`,
          detail: "Each holding's change scaled by its disclosed weight",
        },
        {
          label: 'Average holding move',
          value: a.averageChangePct === null ? 'Not available' : `${a.averageChangePct}%`,
          detail: 'Unweighted mean across priced holdings',
        },
      );

      if (a.topGainers.length > 0) {
        facts.push({
          label: 'Largest gain today',
          value: `${a.topGainers[0].stockName} +${a.topGainers[0].changePct}%`,
          detail: `${a.topGainers[0].weightPct}% of net assets`,
        });
      }
      if (a.topLosers.length > 0) {
        facts.push({
          label: 'Largest fall today',
          value: `${a.topLosers[0].stockName} ${a.topLosers[0].changePct}%`,
          detail: `${a.topLosers[0].weightPct}% of net assets`,
        });
      }
    }

    const topSector = a.sectorAllocation[0];
    if (topSector) {
      facts.push({
        label: 'Largest sector',
        value: `${topSector.sector} — ${topSector.weightPct}%`,
        detail: `${topSector.stockCount} holding${topSector.stockCount === 1 ? '' : 's'}`,
      });
    }

    return facts;
  }

  private renderFactsBlock(
    fundName: string,
    facts: AiInsightsResponse['facts'],
    a: PortfolioAnalytics,
  ): string {
    const lines = [
      `Fund: ${fundName}`,
      '',
      ...facts.map((f) => `- ${f.label}: ${f.value}${f.detail ? ` (${f.detail})` : ''}`),
      '',
      'Sector weights and their weighted moves today:',
      ...a.sectorAllocation
        .slice(0, 12)
        .map(
          (s) =>
            `- ${s.sector}: ${s.weightPct}% across ${s.stockCount}, weighted move ${s.weightedChangePct ?? 'n/a'}%`,
        ),
      '',
      'Market cap split:',
      ...a.marketCapAllocation.map(
        (m) => `- ${m.category}: ${m.weightPct}% across ${m.stockCount}`,
      ),
      '',
      'Top gainers today:',
      ...a.topGainers.map((g) => `- ${g.stockName} ${g.changePct}% (weight ${g.weightPct}%)`),
      '',
      'Top losers today:',
      ...a.topLosers.map((l) => `- ${l.stockName} ${l.changePct}% (weight ${l.weightPct}%)`),
    ];
    return lines.join('\n');
  }

  /**
   * Deterministic commentary used when the model is unavailable or disabled.
   * Reports the same shape as the LLM path so the UI needs no special case —
   * `generatedBy` tells the client which it received.
   */
  private templateInsights(
    a: PortfolioAnalytics,
    stale: boolean,
  ): Array<{ heading: string; body: string }> {
    const sections: Array<{ heading: string; body: string }> = [];

    if (a.priceCoverage.withQuote > 0) {
      const direction =
        a.weightedAverageChangePct === null
          ? 'flat'
          : a.weightedAverageChangePct > 0
            ? 'higher'
            : a.weightedAverageChangePct < 0
              ? 'lower'
              : 'flat';
      sections.push({
        heading: "Today's movement",
        body:
          `${a.advancers} of ${a.priceCoverage.withQuote} priced holdings are up, ${a.decliners} are down and ` +
          `${a.unchanged} are unchanged. Weighted by disclosed portfolio weight, the holdings are ${direction} ` +
          `${a.weightedAverageChangePct === null ? '' : `by ${Math.abs(a.weightedAverageChangePct)}% `}` +
          `on the day. The unweighted average move is ${a.averageChangePct ?? 'not available'}%.`,
      });
    } else {
      sections.push({
        heading: 'Price data unavailable',
        body:
          'No live prices are available for this portfolio right now, so only disclosed weights are shown. ' +
          'Holdings, sector allocation and concentration figures below remain accurate as of the disclosure date.',
      });
    }

    const topSectors = a.sectorAllocation.slice(0, 3);
    if (topSectors.length > 0) {
      sections.push({
        heading: 'Sector exposure',
        body:
          `The three largest sector exposures are ${topSectors
            .map((s) => `${s.sector} (${s.weightPct}%)`)
            .join(
              ', ',
            )}, together ${topSectors.reduce((sum, s) => sum + s.weightPct, 0).toFixed(2)}% of net assets. ` +
          (topSectors[0].weightedChangePct !== null
            ? `${topSectors[0].sector} holdings are moving ${topSectors[0].weightedChangePct}% on a weighted basis today.`
            : ''),
      });
    }

    sections.push({
      heading: 'Concentration',
      body:
        `The ten largest positions account for ${a.top10WeightPct}% of net assets across ${a.totalStocks} equity holdings. ` +
        `The Herfindahl index over holding weights is ${a.concentrationHhi}, which is ${describeHhi(a.concentrationHhi).toLowerCase()}.` +
        (a.highestWeighted
          ? ` The largest single position is ${a.highestWeighted.stockName} at ${a.highestWeighted.weightPct}%.`
          : ''),
    });

    if (stale) {
      sections.push({
        heading: 'Data freshness',
        body:
          `These holdings come from the ${a.disclosureDate} disclosure, which is past the freshness threshold ` +
          'configured for this deployment. The fund may have traded since. Prices shown are current; weights are not.',
      });
    }

    return sections;
  }
}

function describeHhi(hhi: number): string {
  if (hhi < HHI_THRESHOLDS.DIFFUSE) return 'Widely diversified';
  if (hhi < HHI_THRESHOLDS.MODERATE) return 'Moderately diversified';
  if (hhi < HHI_THRESHOLDS.CONCENTRATED) return 'Moderately concentrated';
  return 'Highly concentrated';
}
