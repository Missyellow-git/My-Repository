import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QUERYABLE_FIELDS, querySpecSchema, type QuerySpec } from '@fundlens/shared';
import type { AppConfig } from '../../common/config/configuration';
import { ApiLogService } from '../../providers/api-log.service';

/**
 * Anthropic client wrapper.
 *
 * Scope is deliberately narrow. The model does exactly two jobs:
 *
 *   1. translate a question into a QuerySpec (structured, schema-validated,
 *      executed by our own code);
 *   2. write prose *about numbers we computed and hand it*.
 *
 * It is never given database access, never asked to do arithmetic, and its
 * output is never rendered as fact without the deterministic figures beside it.
 * That boundary is what lets the product show AI commentary on financial data
 * without risking a fabricated price or holding.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private client: Anthropic | null = null;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly apiLog: ApiLogService,
  ) {}

  private get env() {
    return this.config.get('env', { infer: true });
  }

  get isEnabled(): boolean {
    return this.env.AI_ENABLED && !!this.env.ANTHROPIC_API_KEY;
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: this.env.ANTHROPIC_API_KEY,
        timeout: this.env.AI_TIMEOUT_MS,
        maxRetries: 1,
      });
    }
    return this.client;
  }

  /**
   * Question → QuerySpec.
   *
   * Structured output is obtained with a forced tool call rather than by asking
   * for JSON in prose: the schema is enforced by the API, and the result is
   * validated again with Zod on our side because a syntactically valid tool
   * call can still carry a field name we do not support.
   */
  async planQuery(question: string, context: QueryContext): Promise<QuerySpec | null> {
    if (!this.isEnabled) return null;

    const started = Date.now();
    try {
      const response = await this.getClient().messages.create({
        model: this.env.ANTHROPIC_MODEL,
        max_tokens: this.env.AI_MAX_TOKENS,
        system: buildPlannerSystemPrompt(context),
        tools: [QUERY_TOOL],
        tool_choice: { type: 'tool', name: QUERY_TOOL.name },
        messages: [{ role: 'user', content: question }],
      });

      this.apiLog.record({
        provider: 'anthropic',
        endpoint: 'messages.create:plan',
        outcome: 'ok',
        latencyMs: Date.now() - started,
        itemCount: response.usage.input_tokens + response.usage.output_tokens,
      });

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (!toolUse) {
        this.logger.warn('Planner returned no tool_use block');
        return null;
      }

      const parsed = querySpecSchema.safeParse(toolUse.input);
      if (!parsed.success) {
        // Not an error worth surfacing: the caller falls back to rules, and the
        // log line is what tells us the prompt needs work.
        this.logger.warn(`Planner produced an invalid spec: ${parsed.error.issues[0]?.message}`);
        return null;
      }
      return parsed.data;
    } catch (err) {
      this.apiLog.record({
        provider: 'anthropic',
        endpoint: 'messages.create:plan',
        outcome: (err as Error).name === 'AbortError' ? 'timeout' : 'error',
        latencyMs: Date.now() - started,
        errorMessage: (err as Error).message,
      });
      this.logger.error(`Query planning failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Writes commentary on an answer that has already been computed.
   *
   * The prompt hands over the finished figures and forbids new ones. Returns
   * null on any failure — narrative is an enhancement, and the factual answer
   * ships without it rather than the whole response failing.
   */
  async narrate(question: string, factsBlock: string): Promise<string | null> {
    if (!this.isEnabled) return null;

    const started = Date.now();
    try {
      const response = await this.getClient().messages.create({
        model: this.env.ANTHROPIC_MODEL,
        max_tokens: 400,
        system: NARRATOR_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Question: ${question}\n\nComputed results:\n${factsBlock}\n\nWrite the commentary.`,
          },
        ],
      });

      this.apiLog.record({
        provider: 'anthropic',
        endpoint: 'messages.create:narrate',
        outcome: 'ok',
        latencyMs: Date.now() - started,
        itemCount: response.usage.input_tokens + response.usage.output_tokens,
      });

      return extractText(response) || null;
    } catch (err) {
      this.apiLog.record({
        provider: 'anthropic',
        endpoint: 'messages.create:narrate',
        outcome: 'error',
        latencyMs: Date.now() - started,
        errorMessage: (err as Error).message,
      });
      this.logger.warn(`Narration failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Multi-section daily commentary for the insights endpoint. */
  async writeInsights(
    factsBlock: string,
  ): Promise<Array<{ heading: string; body: string }> | null> {
    if (!this.isEnabled) return null;

    const started = Date.now();
    try {
      const response = await this.getClient().messages.create({
        model: this.env.ANTHROPIC_MODEL,
        max_tokens: this.env.AI_MAX_TOKENS,
        system: INSIGHTS_SYSTEM_PROMPT,
        tools: [INSIGHTS_TOOL],
        tool_choice: { type: 'tool', name: INSIGHTS_TOOL.name },
        messages: [{ role: 'user', content: `Computed portfolio facts:\n${factsBlock}` }],
      });

      this.apiLog.record({
        provider: 'anthropic',
        endpoint: 'messages.create:insights',
        outcome: 'ok',
        latencyMs: Date.now() - started,
        itemCount: response.usage.input_tokens + response.usage.output_tokens,
      });

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      const sections = (toolUse?.input as { sections?: Array<{ heading: string; body: string }> })
        ?.sections;
      if (!Array.isArray(sections)) return null;

      return sections
        .filter((s) => typeof s?.heading === 'string' && typeof s?.body === 'string')
        .slice(0, 5)
        .map((s) => ({ heading: s.heading.slice(0, 80), body: s.body.slice(0, 1200) }));
    } catch (err) {
      this.apiLog.record({
        provider: 'anthropic',
        endpoint: 'messages.create:insights',
        outcome: 'error',
        latencyMs: Date.now() - started,
        errorMessage: (err as Error).message,
      });
      this.logger.warn(`Insight generation failed: ${(err as Error).message}`);
      return null;
    }
  }
}

export interface QueryContext {
  fundName: string;
  disclosureDate: string;
  holdingsCount: number;
  sectors: string[];
  pricesAvailable: boolean;
}

const QUERY_TOOL: Anthropic.Tool = {
  name: 'query_holdings',
  description:
    "Translate the user question into a structured query over the fund's disclosed holdings. " +
    'You do not answer the question yourself and you never state figures — the application ' +
    'executes this query and computes every number.',
  input_schema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: ['list', 'count', 'aggregate', 'groupBy', 'rank', 'unsupported'],
        description:
          'list = return matching rows; count = how many match; aggregate = one number over matches; ' +
          'groupBy = per-group rollup; rank = top/bottom N by a field; unsupported = the data cannot answer this.',
      },
      filters: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: [...QUERYABLE_FIELDS] },
            op: {
              type: 'string',
              enum: [
                'eq',
                'neq',
                'gt',
                'gte',
                'lt',
                'lte',
                'between',
                'contains',
                'in',
                'isNull',
                'notNull',
              ],
            },
            value: {
              description:
                'Scalar for comparisons, [min,max] for between, array for in, omitted for isNull/notNull.',
            },
          },
          required: ['field', 'op'],
        },
      },
      sort: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: [...QUERYABLE_FIELDS] },
          direction: { type: 'string', enum: ['asc', 'desc'] },
        },
        required: ['field'],
      },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
      aggregate: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max'] },
          field: { type: 'string', enum: [...QUERYABLE_FIELDS] },
        },
        required: ['op'],
      },
      groupBy: {
        type: 'string',
        enum: ['sector', 'industry', 'marketCapCategory', 'instrumentType'],
      },
      highlightFields: {
        type: 'array',
        maxItems: 6,
        items: { type: 'string', enum: [...QUERYABLE_FIELDS] },
      },
      interpretation: {
        type: 'string',
        maxLength: 400,
        description: 'One sentence restating the question.',
      },
      reason: {
        type: 'string',
        maxLength: 400,
        description: 'Required when intent is unsupported.',
      },
    },
    required: ['intent'],
  },
};

const INSIGHTS_TOOL: Anthropic.Tool = {
  name: 'write_insights',
  description: 'Return 2–4 short commentary sections about the supplied portfolio facts.',
  input_schema: {
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            heading: { type: 'string', maxLength: 80 },
            body: { type: 'string', maxLength: 1200 },
          },
          required: ['heading', 'body'],
        },
      },
    },
    required: ['sections'],
  },
};

function buildPlannerSystemPrompt(context: QueryContext): string {
  return [
    'You translate questions about an Indian mutual fund portfolio into a structured query.',
    '',
    `Fund: ${context.fundName}`,
    `Disclosure period: ${context.disclosureDate} (holdings as disclosed on that date)`,
    `Instruments in the portfolio: ${context.holdingsCount}`,
    `Sectors present: ${context.sectors.slice(0, 40).join(', ') || 'none recorded'}`,
    `Live prices available: ${context.pricesAvailable ? 'yes' : 'no'}`,
    '',
    'Rules:',
    '- Call query_holdings exactly once. Never answer in prose.',
    '- Never state or estimate any number. The application computes all figures.',
    '- Percentages (weightPct, changePct, pctFrom52wAvg) are already in percent: 2% is 2, not 0.02.',
    '- marketCapCrore is in crore. ₹1 lakh crore = 100000. ₹50,000 crore = 50000.',
    '- Match sectors with `contains` on the `sector` field using a distinctive substring',
    '  (e.g. "bank", "pharma"), because sector labels vary in wording.',
    '- Use `notNull` on a price field when the question is only meaningful for priced holdings.',
    '- If the question asks for advice, a recommendation, a prediction, or data we do not hold',
    '  (fund manager views, past NAV returns, analyst targets), set intent to "unsupported"',
    '  and explain briefly in `reason`.',
  ].join('\n');
}

const NARRATOR_SYSTEM_PROMPT = [
  'You write brief commentary on Indian mutual fund portfolio data for a dashboard.',
  '',
  'Absolute rules:',
  '- Every figure has already been computed and is given to you. Use only those figures.',
  '- Never introduce a number, price, percentage, ticker or company that is not in the input.',
  '- Never give investment advice, recommendations, price targets or predictions.',
  '- Never tell the user to buy, sell, hold, book profits or average down.',
  '- Do not describe a move as good, bad, cheap, expensive or an opportunity.',
  '',
  'Style: 2–4 sentences, plain English, factual and neutral. Describe what the numbers show',
  '(concentration, sector tilt, breadth of the move) without judging it. No preamble, no',
  'headings, no bullet points, no disclaimer — the application adds its own.',
].join('\n');

const INSIGHTS_SYSTEM_PROMPT = [
  "You summarise how an Indian mutual fund's disclosed holdings are behaving during the",
  'trading day, for a dashboard panel. All facts are supplied; you organise and explain them.',
  '',
  "Produce 2–4 sections. Useful angles: breadth of today's move, which sectors are driving it,",
  'how concentrated the portfolio is, and where the disclosed data is limited (stale disclosure,',
  'missing prices, unmapped instruments).',
  '',
  'Absolute rules:',
  '- Use only the supplied figures. Never invent or extrapolate a number.',
  '- No investment advice, recommendations, outlooks or predictions of any kind.',
  '- No value judgements ("attractive", "overvalued", "risky bet"). Describe, do not appraise.',
  '- Where the data is stale or incomplete, say so plainly in the relevant section.',
  '- Headings under 60 characters; bodies 2–4 sentences.',
].join('\n');

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text.trim())
    .join('\n\n')
    .trim();
}
