import { z } from 'zod';

/**
 * The AI assistant never queries the database directly and never invents
 * numbers. It translates a natural-language question into this small, closed
 * DSL, which the backend validates with Zod and then executes deterministically
 * against the already-loaded holdings array.
 *
 * Consequences of that design, which the product depends on:
 *  - every figure the assistant shows is computed by our code, not the model;
 *  - a malformed or malicious model response fails validation and falls back to
 *    the rule-based parser instead of reaching data;
 *  - the same DSL is used by the deterministic parser, so behaviour is
 *    identical whether or not an LLM is configured.
 */

export const QUERYABLE_FIELDS = [
  'instrumentName',
  'nseSymbol',
  'bseCode',
  'sector',
  'industry',
  'instrumentType',
  'marketCapCategory',
  'weightPct',
  'rank',
  'ltp',
  'changePct',
  'changeAbs',
  'volume',
  'marketCapCrore',
  'week52High',
  'week52Low',
  'week52Avg',
  'pctFrom52wAvg',
  'weightedChangePct',
] as const;

export type QueryableField = (typeof QUERYABLE_FIELDS)[number];

export const NUMERIC_FIELDS: readonly QueryableField[] = [
  'weightPct',
  'rank',
  'ltp',
  'changePct',
  'changeAbs',
  'volume',
  'marketCapCrore',
  'week52High',
  'week52Low',
  'week52Avg',
  'pctFrom52wAvg',
  'weightedChangePct',
];

export const filterOperatorSchema = z.enum([
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
]);
export type FilterOperator = z.infer<typeof filterOperatorSchema>;

export const filterSchema = z.object({
  field: z.enum(QUERYABLE_FIELDS),
  op: filterOperatorSchema,
  /**
   * `between` takes a two-element numeric tuple, `in` takes an array,
   * `isNull`/`notNull` take nothing. Everything else takes a scalar.
   */
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])
    .optional(),
});
export type HoldingFilter = z.infer<typeof filterSchema>;

export const sortSchema = z.object({
  field: z.enum(QUERYABLE_FIELDS),
  direction: z.enum(['asc', 'desc']).default('desc'),
});

export const aggregateSchema = z.object({
  op: z.enum(['sum', 'avg', 'count', 'min', 'max']),
  field: z.enum(QUERYABLE_FIELDS).optional(),
});

export const querySpecSchema = z.object({
  /**
   * `list`      — return matching rows
   * `count`     — return how many rows match
   * `aggregate` — return a single number over matching rows
   * `groupBy`   — return per-group weight/count rollups
   * `rank`      — return the top/bottom N by a field
   * `unsupported` — the question is out of scope for the dataset
   */
  intent: z.enum(['list', 'count', 'aggregate', 'groupBy', 'rank', 'unsupported']),
  filters: z.array(filterSchema).max(8).default([]),
  sort: sortSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
  aggregate: aggregateSchema.optional(),
  groupBy: z.enum(['sector', 'industry', 'marketCapCategory', 'instrumentType']).optional(),
  /** Columns the UI should emphasise when rendering the answer table. */
  highlightFields: z.array(z.enum(QUERYABLE_FIELDS)).max(6).default([]),
  /** Model's own restatement of the question. Never used for computation. */
  interpretation: z.string().max(400).optional(),
  /** Populated when `intent === 'unsupported'`. */
  reason: z.string().max(400).optional(),
});

export type QuerySpec = z.infer<typeof querySpecSchema>;

/** A row of the assistant's answer table. Values are always computed locally. */
export interface AiAnswerRow {
  instrumentName: string;
  nseSymbol: string | null;
  sector: string | null;
  weightPct: number;
  ltp: number | null;
  changePct: number | null;
  marketCapCrore: number | null;
  marketCapCategory: string | null;
  pctFrom52wAvg: number | null;
}

export interface AiGroupRow {
  key: string;
  weightPct: number;
  count: number;
  weightedChangePct: number | null;
}

/**
 * The assistant's response envelope.
 *
 * `facts` and `narrative` are kept in separate fields on purpose: the UI labels
 * the narrative as model-generated commentary, and the compliance disclaimer is
 * carried on the payload rather than being left to the client to remember.
 */
export interface AiQueryResponse {
  question: string;
  interpretation: string;
  spec: QuerySpec;
  /** How the spec was produced. Shown in the UI as a provenance badge. */
  resolvedBy: 'llm' | 'rules' | 'fallback';
  answer: {
    kind: 'rows' | 'scalar' | 'groups' | 'none';
    rows?: AiAnswerRow[];
    groups?: AiGroupRow[];
    scalar?: { label: string; value: number; unit: string | null };
    /** Deterministic, template-rendered sentence describing `answer`. */
    factualSummary: string;
  };
  /** Model-written commentary. Absent when the LLM is disabled or failed. */
  narrative: string | null;
  matchedCount: number;
  totalCount: number;
  dataAsOf: {
    disclosureDate: string;
    pricesFetchedAt: string | null;
    priceQuality: string;
  };
  disclaimer: string;
  warnings: string[];
}

export interface AiInsightsResponse {
  fundId: string;
  fundName: string;
  /** Machine-computed statements. Every one is reproducible from the data. */
  facts: Array<{ label: string; value: string; detail?: string }>;
  /** LLM narrative sections. Null when AI is disabled. */
  insights: Array<{ heading: string; body: string }> | null;
  generatedBy: 'llm' | 'template';
  dataAsOf: { disclosureDate: string; pricesFetchedAt: string | null };
  disclaimer: string;
  warnings: string[];
}

export const AI_DISCLAIMER =
  'Portfolio holdings are taken from the scheme’s latest disclosed monthly ' +
  'disclosure and may not reflect current positions. Prices are provided for ' +
  'information only. Figures in the answer are computed from this data; any ' +
  'narrative commentary is AI-generated and may contain errors. This is not ' +
  'investment advice and is not personalised to your circumstances.';
