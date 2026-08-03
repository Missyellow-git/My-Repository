import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AI_DISCLAIMER,
  type AiQueryInput,
  type AiQueryResponse,
  type QuerySpec,
} from '@fundlens/shared';
import { RateLimiterService } from '../../cache/rate-limiter.service';
import type { AppConfig } from '../../common/config/configuration';
import { UnsupportedQuestionException } from '../../common/errors';
import { HoldingsService } from '../holdings/holdings.service';
import { LlmService } from './llm.service';
import { parseQuestion } from './rule-parser';
import { executeQuery, labelFor } from './query-executor';

/** Shown to the user when nothing can answer their question. */
const EXAMPLE_QUESTIONS = [
  'Which stock has the highest weight in this fund?',
  'Which holdings are down more than 2% today?',
  'Show all banking stocks',
  'Which stock is the biggest gainer today?',
  'How many IT stocks are in this portfolio?',
  'Which stocks have a market cap above ₹1 lakh crore?',
  'List all small-cap companies',
  'Show only stocks trading above their 52-week average',
  "Compare today's movement with each stock's portfolio weight",
];

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly holdings: HoldingsService,
    private readonly llm: LlmService,
    private readonly rateLimiter: RateLimiterService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Answers a natural-language question about one fund's holdings.
   *
   * Resolution order — rules first, model second — is a cost, latency and
   * determinism decision, not a limitation: the phrasings users actually type
   * are handled locally in microseconds, and the model is spent on the long
   * tail. Either way the resulting spec is executed by our own code, so the
   * numbers are identical whichever path produced the plan.
   *
   * @param rateLimitKey Caller identity (user id, or IP for anonymous users).
   */
  async ask(input: AiQueryInput, rateLimitKey: string): Promise<AiQueryResponse> {
    const response = await this.holdings.getHoldings(input.fundId, {
      date: input.date,
      includeNonEquity: false,
      includeUnmapped: true,
      withPrices: true,
    });

    const warnings: string[] = [];
    if (response.snapshot.stale) {
      warnings.push(
        `The latest disclosure for this scheme is from ${response.snapshot.disclosureDate} and may not reflect current holdings.`,
      );
    }
    if (response.priceCoverage.withQuote < response.priceCoverage.requested) {
      warnings.push(
        `Live prices are unavailable for ${response.priceCoverage.requested - response.priceCoverage.withQuote} of ${response.priceCoverage.requested} holdings; those are excluded from price-based answers.`,
      );
    }
    if (response.unmappedInstruments.length > 0) {
      warnings.push(
        `${response.unmappedInstruments.length} disclosed instrument(s) could not be matched to a listed security and have no price or sector.`,
      );
    }

    // 1. Deterministic rules.
    let spec: QuerySpec | null = parseQuestion(input.question);
    let resolvedBy: AiQueryResponse['resolvedBy'] = spec ? 'rules' : 'fallback';

    // 2. Model, only for what the rules could not handle.
    if (!spec && !input.deterministicOnly && this.llm.isEnabled) {
      const decision = await this.rateLimiter.consume(
        `ai:${rateLimitKey}`,
        this.config.get('env', { infer: true }).AI_RATE_LIMIT_PER_MIN,
      );
      if (!decision.allowed) {
        throw new UnsupportedQuestionException(
          'You have reached the AI question limit for this minute. Please try again shortly, or use the table filters directly.',
          EXAMPLE_QUESTIONS,
        );
      }

      const sectors = [
        ...new Set(response.holdings.map((h) => h.stock?.sector).filter((s): s is string => !!s)),
      ];
      spec = await this.llm.planQuery(input.question, {
        fundName: response.fund.name,
        disclosureDate: response.snapshot.disclosureDate,
        holdingsCount: response.holdings.length,
        sectors,
        pricesAvailable: response.priceCoverage.withQuote > 0,
      });
      if (spec) resolvedBy = 'llm';
    }

    if (!spec) {
      throw new UnsupportedQuestionException(
        this.llm.isEnabled
          ? "That question could not be turned into a query over this fund's holdings. Try rephrasing it in terms of weight, sector, price movement or market cap."
          : 'The AI assistant is not configured on this deployment, and the question did not match a supported pattern.',
        EXAMPLE_QUESTIONS,
      );
    }

    const result = executeQuery(spec, response.holdings);
    warnings.push(...result.warnings);

    // 3. Optional commentary over the computed answer. Skipped entirely when
    // the answer is a single number — prose adds nothing to "27".
    let narrative: string | null = null;
    const worthNarrating =
      result.kind === 'rows' ? (result.rows?.length ?? 0) > 1 : result.kind === 'groups';
    if (this.llm.isEnabled && !input.deterministicOnly && worthNarrating) {
      narrative = await this.llm.narrate(
        input.question,
        this.buildFactsBlock(spec, result, response.fund.name),
      );
    }

    return {
      question: input.question,
      interpretation: spec.interpretation ?? result.factualSummary,
      spec,
      resolvedBy,
      answer: {
        kind: result.kind,
        rows: result.rows,
        groups: result.groups,
        scalar: result.scalar,
        factualSummary: result.factualSummary,
      },
      narrative,
      matchedCount: result.matchedCount,
      totalCount: result.totalCount,
      dataAsOf: {
        disclosureDate: response.snapshot.disclosureDate,
        pricesFetchedAt: response.generatedAt,
        priceQuality:
          response.priceCoverage.withQuote === 0
            ? 'UNAVAILABLE'
            : response.priceCoverage.stale > 0
              ? 'PARTIALLY_STALE'
              : 'OK',
      },
      disclaimer: AI_DISCLAIMER,
      warnings,
    };
  }

  /**
   * Renders the computed answer as plain text for the narrator.
   *
   * Deliberately verbose about *what the numbers are* and silent about what
   * they mean — the model's job is to describe this block, and anything absent
   * from it is something the model must not mention.
   */
  private buildFactsBlock(
    spec: QuerySpec,
    result: ReturnType<typeof executeQuery>,
    fundName: string,
  ): string {
    const lines: string[] = [
      `Fund: ${fundName}`,
      `Interpretation: ${spec.interpretation ?? '(none)'}`,
      `Matched ${result.matchedCount} of ${result.totalCount} holdings.`,
      result.factualSummary,
      '',
    ];

    if (result.rows?.length) {
      lines.push('Rows (name | NSE | sector | weight% | LTP | change% | mcap cr):');
      for (const row of result.rows.slice(0, 25)) {
        lines.push(
          `- ${row.instrumentName} | ${row.nseSymbol ?? '-'} | ${row.sector ?? '-'} | ${row.weightPct}% | ` +
            `${row.ltp ?? '-'} | ${row.changePct ?? '-'}% | ${row.marketCapCrore ?? '-'}`,
        );
      }
      if (result.rows.length > 25)
        lines.push(`- (${result.rows.length - 25} further rows omitted)`);
    }

    if (result.groups?.length) {
      lines.push('Groups (key | weight% | count | weighted change%):');
      for (const group of result.groups.slice(0, 25)) {
        lines.push(
          `- ${group.key} | ${group.weightPct}% | ${group.count} | ${group.weightedChangePct ?? 'n/a'}%`,
        );
      }
    }

    if (result.scalar) {
      lines.push(
        `Scalar — ${result.scalar.label}: ${result.scalar.value}${result.scalar.unit ?? ''}`,
      );
    }

    if (spec.highlightFields.length > 0) {
      lines.push(
        '',
        `Fields the user cares about: ${spec.highlightFields.map(labelFor).join(', ')}`,
      );
    }

    return lines.join('\n');
  }

  /** Advertised capabilities, used by the UI to render suggestion chips. */
  capabilities() {
    return {
      llmEnabled: this.llm.isEnabled,
      deterministicRules: true,
      exampleQuestions: EXAMPLE_QUESTIONS,
      disclaimer: AI_DISCLAIMER,
    };
  }
}
