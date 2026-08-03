import { querySpecSchema, type HoldingFilter, type QuerySpec } from '@fundlens/shared';

/**
 * Deterministic natural-language → QuerySpec parser.
 *
 * This is not a fallback bolted on for when the LLM is down — it is the primary
 * path, and the LLM is consulted only for questions it cannot handle. Three
 * reasons that ordering is right for this product:
 *
 *  - the common questions are narrow and repetitive ("biggest gainer",
 *    "banking stocks", "down more than 2%"), and rules answer them in
 *    microseconds with no per-query cost and no variance;
 *  - it works with no API key, so the assistant is a real feature in
 *    development, in CI and for self-hosted deployments;
 *  - it is exhaustively unit-testable, which an LLM is not.
 *
 * Every rule below maps to a phrasing users actually type. When nothing
 * matches, `parseQuestion` returns null and AiService escalates to the model.
 */

interface Rule {
  name: string;
  test: RegExp;
  build: (match: RegExpExecArray, question: string) => QuerySpec | null;
}

/** Sector keyword → the substring matched against sector/industry text. */
const SECTOR_KEYWORDS: Array<{ pattern: RegExp; needle: string; label: string }> = [
  { pattern: /\b(bank|banking|psu bank|private bank)\b/i, needle: 'bank', label: 'banking' },
  { pattern: /\b(it|tech|technology|software)\b/i, needle: 'it -', label: 'IT' },
  {
    pattern: /\b(pharma|pharmaceutical|drug)\b/i,
    needle: 'pharmaceutical',
    label: 'pharmaceuticals',
  },
  { pattern: /\b(healthcare|hospital)\b/i, needle: 'healthcare', label: 'healthcare' },
  { pattern: /\b(auto|automobile|automotive)\b/i, needle: 'auto', label: 'automobile' },
  { pattern: /\b(fmcg|consumer goods|staples)\b/i, needle: 'fmcg', label: 'FMCG' },
  { pattern: /\b(cement)\b/i, needle: 'cement', label: 'cement' },
  { pattern: /\b(metal|steel|mining)\b/i, needle: 'metal', label: 'metals' },
  { pattern: /\b(power|utility|utilities)\b/i, needle: 'power', label: 'power' },
  { pattern: /\b(chemical|specialty chemical)\b/i, needle: 'chemical', label: 'chemicals' },
  { pattern: /\b(telecom|telecommunication)\b/i, needle: 'telecom', label: 'telecom' },
  { pattern: /\b(finance|nbfc|financial)\b/i, needle: 'finance', label: 'finance' },
  { pattern: /\b(insurance)\b/i, needle: 'insurance', label: 'insurance' },
  { pattern: /\b(realty|real estate)\b/i, needle: 'realty', label: 'realty' },
  { pattern: /\b(oil|gas|petroleum|energy)\b/i, needle: 'petroleum', label: 'oil & gas' },
  { pattern: /\b(retail|retailing)\b/i, needle: 'retail', label: 'retail' },
  {
    pattern: /\b(construction|infra|infrastructure)\b/i,
    needle: 'construction',
    label: 'construction',
  },
];

/**
 * Words that make a captured phrase a description of the portfolio rather than
 * a company name. "show me the fund" must not become a name search for "fund".
 */
const GENERIC_NOUNS = new Set([
  'all',
  'the',
  'me',
  'my',
  'this',
  'that',
  'it',
  'stock',
  'stocks',
  'holding',
  'holdings',
  'portfolio',
  'fund',
  'scheme',
  'company',
  'companies',
  'everything',
  'anything',
  'here',
  'please',
  'data',
  'table',
  'list',
]);

const RULES: Rule[] = [
  // "Which stock has the highest/largest weight?" / "top holding"
  {
    name: 'highest-weight',
    test: /\b(highest|largest|biggest|top|maximum|max)\b.*\b(weight|weightage|allocation|holding|position)\b/i,
    build: (_m, q) =>
      spec({
        intent: 'rank',
        sort: { field: 'weightPct', direction: 'desc' },
        limit: extractCount(q) ?? 1,
        highlightFields: ['weightPct'],
        interpretation: `Holdings ranked by portfolio weight, highest first.`,
      }),
  },

  // "lowest weight" / "smallest position"
  {
    name: 'lowest-weight',
    test: /\b(lowest|smallest|least|minimum|min)\b.*\b(weight|weightage|allocation|holding|position)\b/i,
    build: (_m, q) =>
      spec({
        intent: 'rank',
        sort: { field: 'weightPct', direction: 'asc' },
        limit: extractCount(q) ?? 1,
        highlightFields: ['weightPct'],
        interpretation: 'Holdings ranked by portfolio weight, lowest first.',
      }),
  },

  // "top 10 holdings"
  {
    name: 'top-n-holdings',
    test: /\btop\s+(\d{1,3})\b/i,
    build: (m) =>
      spec({
        intent: 'rank',
        sort: { field: 'weightPct', direction: 'desc' },
        limit: clamp(Number(m[1]), 1, 200),
        highlightFields: ['weightPct'],
        interpretation: `Top ${m[1]} holdings by portfolio weight.`,
      }),
  },

  // "biggest gainer today" / "top losers"
  {
    name: 'movers',
    test: /\b(gainer|loser|advanc|declin|riser|faller)\w*\b/i,
    build: (_m, q) => {
      const losing = /\b(loser|declin|faller|worst)\w*\b/i.test(q);
      return spec({
        intent: 'rank',
        filters: [{ field: 'changePct', op: 'notNull' }],
        sort: { field: 'changePct', direction: losing ? 'asc' : 'desc' },
        limit: extractCount(q) ?? 1,
        highlightFields: ['changePct', 'weightPct'],
        interpretation: losing
          ? "Holdings ranked by today's change, weakest first."
          : "Holdings ranked by today's change, strongest first.",
      });
    },
  },

  // "down more than 2% today" / "up over 3%"
  {
    name: 'move-threshold',
    test: /\b(down|up|fallen|gained|lost|risen|declined)\b[^%]{0,30}?(\d+(?:\.\d+)?)\s*%/i,
    build: (m, q) => {
      const magnitude = Number(m[2]);
      const isDown = /\b(down|fallen|lost|declined)\b/i.test(m[1]);
      // "more than 2%" vs "less than 2%" flips the comparison direction.
      const atMost = /\b(less than|under|below|within)\b/i.test(q) && !/\bmore than\b/i.test(q);
      const field = 'changePct' as const;

      const filter: HoldingFilter = isDown
        ? { field, op: atMost ? 'gt' : 'lt', value: -magnitude }
        : { field, op: atMost ? 'lt' : 'gt', value: magnitude };

      return spec({
        intent: 'list',
        filters: [filter, { field, op: 'notNull' }],
        sort: { field, direction: isDown ? 'asc' : 'desc' },
        highlightFields: ['changePct', 'weightPct'],
        interpretation: `Holdings ${isDown ? 'down' : 'up'} ${atMost ? 'less' : 'more'} than ${magnitude}% today.`,
      });
    },
  },

  // "market cap above ₹1 lakh crore"
  {
    name: 'market-cap-threshold',
    test: /\bmarket\s*cap\w*\b/i,
    build: (_m, q) => {
      const amount = extractIndianAmountCrore(q);
      if (amount === null) return null;
      const below = /\b(below|under|less than|smaller than|lower than)\b/i.test(q);
      return spec({
        intent: 'list',
        filters: [{ field: 'marketCapCrore', op: below ? 'lt' : 'gt', value: amount }],
        sort: { field: 'marketCapCrore', direction: 'desc' },
        highlightFields: ['marketCapCrore', 'weightPct'],
        interpretation: `Holdings with market capitalisation ${below ? 'below' : 'above'} ₹${formatCrore(amount)} crore.`,
      });
    },
  },

  // "list all small-cap companies"
  {
    name: 'market-cap-category',
    test: /\b(large|mid|small)[\s-]?cap\b/i,
    build: (m, q) => {
      const bucket = m[1].toLowerCase();
      const category =
        bucket === 'large' ? 'LARGE_CAP' : bucket === 'mid' ? 'MID_CAP' : 'SMALL_CAP';
      const counting = isCountQuestion(q);
      return spec({
        intent: counting ? 'count' : 'list',
        filters: [{ field: 'marketCapCategory', op: 'eq', value: category }],
        sort: { field: 'weightPct', direction: 'desc' },
        highlightFields: ['marketCapCategory', 'weightPct'],
        interpretation: `${bucket}-cap holdings in the portfolio.`,
      });
    },
  },

  // "trading above their 52-week average"
  {
    name: 'above-52w-average',
    test: /\b52[\s-]?week\b.*\b(average|avg)\b|\b(average|avg)\b.*\b52[\s-]?week\b/i,
    build: (_m, q) => {
      const below = /\b(below|under|less than)\b/i.test(q);
      return spec({
        intent: 'list',
        filters: [{ field: 'pctFrom52wAvg', op: below ? 'lt' : 'gt', value: 0 }],
        sort: { field: 'pctFrom52wAvg', direction: below ? 'asc' : 'desc' },
        highlightFields: ['pctFrom52wAvg', 'ltp', 'weightPct'],
        interpretation: `Holdings trading ${below ? 'below' : 'above'} their 52-week average close.`,
      });
    },
  },

  // "compare today's movement with portfolio weight"
  {
    name: 'weight-vs-move',
    test: /\bcompare\b.*\b(movement|move|change|performance)\b.*\b(weight|weightage|allocation)\b|\b(weight|weightage)\b.*\bvs\.?\b.*\b(move|change|performance)\b/i,
    build: () =>
      spec({
        intent: 'list',
        filters: [{ field: 'changePct', op: 'notNull' }],
        sort: { field: 'weightedChangePct', direction: 'desc' },
        highlightFields: ['weightPct', 'changePct', 'weightedChangePct'],
        interpretation:
          "Holdings ordered by their weighted contribution to the portfolio's move today (weight × change).",
      }),
  },

  // "sector allocation" / "break down by sector"
  {
    name: 'group-by-sector',
    test: /\b(sector|industry)\b.*\b(allocation|breakdown|break down|split|distribution|exposure|wise)\b|\b(allocation|breakdown|split)\b.*\b(sector|industry)\b/i,
    build: (_m, q) =>
      spec({
        intent: 'groupBy',
        groupBy: /\bindustry\b/i.test(q) ? 'industry' : 'sector',
        highlightFields: ['weightPct'],
        interpretation: 'Portfolio weight grouped by sector.',
      }),
  },

  // "how many IT stocks" / "show all banking stocks"
  {
    name: 'sector-filter',
    test: new RegExp(SECTOR_KEYWORDS.map((s) => s.pattern.source).join('|'), 'i'),
    build: (_m, q) => {
      const sector = SECTOR_KEYWORDS.find((s) => s.pattern.test(q));
      if (!sector) return null;
      const counting = isCountQuestion(q);
      return spec({
        intent: counting ? 'count' : 'list',
        filters: [{ field: 'sector', op: 'contains', value: sector.needle }],
        sort: { field: 'weightPct', direction: 'desc' },
        highlightFields: ['sector', 'weightPct', 'changePct'],
        interpretation: counting
          ? `Count of ${sector.label} holdings.`
          : `${sector.label.charAt(0).toUpperCase()}${sector.label.slice(1)} holdings, largest weight first.`,
      });
    },
  },

  // "how many stocks are in this portfolio"
  {
    name: 'total-count',
    test: /\bhow many\b.*\b(stock|holding|compan|scrip|position)\w*\b/i,
    build: () =>
      spec({
        intent: 'count',
        filters: [{ field: 'instrumentType', op: 'eq', value: 'EQUITY' }],
        interpretation: 'Number of equity holdings in the portfolio.',
      }),
  },

  // "total weight of the top holdings" style aggregate
  {
    name: 'aggregate-weight',
    test: /\b(total|combined|sum of)\b.*\b(weight|weightage|allocation|exposure)\b/i,
    build: () =>
      spec({
        intent: 'aggregate',
        aggregate: { op: 'sum', field: 'weightPct' },
        filters: [{ field: 'instrumentType', op: 'eq', value: 'EQUITY' }],
        interpretation: 'Total equity weight across the portfolio.',
      }),
  },

  // "average change today"
  {
    name: 'aggregate-change',
    test: /\b(average|avg|mean)\b.*\b(change|move|movement|return|performance)\b/i,
    build: () =>
      spec({
        intent: 'aggregate',
        aggregate: { op: 'avg', field: 'changePct' },
        filters: [{ field: 'changePct', op: 'notNull' }],
        interpretation: 'Average intraday change across holdings with a live price.',
      }),
  },

  // Free-text lookup: "show me Infosys"
  {
    name: 'name-search',
    test: /\b(show|find|search|look up|get|is)\b\s+(?:me\s+)?["']?([A-Za-z][A-Za-z&.\s-]{2,40}?)["']?\s*(?:\?|$)/i,
    build: (m) => {
      // Reject phrases that are clearly not company names, otherwise this rule
      // swallows questions the other rules or the LLM should handle.
      const term = m[2]
        .trim()
        .replace(/^(all|the|only|any|some)\s+/i, '')
        .trim();
      const tokens = term.toLowerCase().split(/\s+/).filter(Boolean);
      if (tokens.length === 0 || tokens.length > 4) return null;
      if (tokens.every((t) => GENERIC_NOUNS.has(t))) return null;
      return spec({
        intent: 'list',
        filters: [{ field: 'instrumentName', op: 'contains', value: term }],
        highlightFields: ['weightPct', 'ltp', 'changePct'],
        interpretation: `Holdings whose name contains "${term}".`,
      });
    },
  },
];

/**
 * Attempts to answer without the model. Returns null when no rule applies, at
 * which point AiService escalates to the LLM (or reports the question as
 * unsupported when AI is disabled).
 */
export function parseQuestion(question: string): QuerySpec | null {
  const normalized = question.trim().replace(/\s+/g, ' ');
  if (normalized.length < 3) return null;

  for (const rule of RULES) {
    const match = rule.test.exec(normalized);
    if (!match) continue;
    const built = rule.build(match, normalized);
    if (built) return built;
  }
  return null;
}

/** Rules that matched, for observability and for the /ai/capabilities endpoint. */
export function ruleNames(): string[] {
  return RULES.map((r) => r.name);
}

function spec(partial: Partial<QuerySpec> & Pick<QuerySpec, 'intent'>): QuerySpec {
  // Parsed through the same schema the LLM output goes through, so both paths
  // are guaranteed to produce a structurally valid spec.
  return querySpecSchema.parse({ filters: [], highlightFields: [], ...partial });
}

function isCountQuestion(q: string): boolean {
  return /\b(how many|count|number of)\b/i.test(q);
}

/** "top 5", "first 3", "5 biggest" → 5. */
function extractCount(q: string): number | null {
  const m =
    /\b(?:top|first|bottom|last)\s+(\d{1,3})\b/i.exec(q) ??
    /\b(\d{1,3})\s+(?:biggest|largest|top|worst)\b/i.exec(q);
  return m ? clamp(Number(m[1]), 1, 200) : null;
}

/**
 * Parses an Indian-notation money amount into crore.
 *
 * Handles "₹1 lakh crore" (= 100,000 crore), "50,000 crore", "2 lakh crore",
 * "₹5000cr". Indian users write these constantly and a parser that only
 * understands "100000" would fail the most natural phrasing of the question.
 */
export function extractIndianAmountCrore(text: string): number | null {
  const t = text.toLowerCase().replace(/,/g, '');

  const lakhCrore = /(\d+(?:\.\d+)?)\s*lakh\s*crore/.exec(t);
  if (lakhCrore) return Number(lakhCrore[1]) * 100_000;

  const thousandCrore = /(\d+(?:\.\d+)?)\s*thousand\s*crore/.exec(t);
  if (thousandCrore) return Number(thousandCrore[1]) * 1_000;

  const crore = /(\d+(?:\.\d+)?)\s*(?:crore|cr)\b/.exec(t);
  if (crore) return Number(crore[1]);

  const lakh = /(\d+(?:\.\d+)?)\s*lakh\b/.exec(t);
  if (lakh) return Number(lakh[1]) / 100; // 1 lakh = 0.01 crore

  const bare = /₹\s*(\d+(?:\.\d+)?)/.exec(t);
  if (bare) return Number(bare[1]);

  return null;
}

function formatCrore(value: number): string {
  if (value >= 100_000) return `${value / 100_000} lakh`;
  return value.toLocaleString('en-IN');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
