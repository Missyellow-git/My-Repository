import {
  NUMERIC_FIELDS,
  type AiAnswerRow,
  type AiGroupRow,
  type HoldingFilter,
  type HoldingRow,
  type QuerySpec,
  type QueryableField,
} from '@fundlens/shared';
import { round, weightedMean } from '../../common/utils/decimal';

/**
 * Executes a validated QuerySpec against an in-memory holdings array.
 *
 * This is the component that makes the AI assistant trustworthy: the model's
 * only influence is which filters and sort to apply, and every number it then
 * reports was computed here, from the same data the table renders. The model
 * cannot invent a price, miscount a sector or hallucinate a holding, because it
 * never produces figures at all.
 *
 * It is also plain synchronous code with no I/O, which means the whole
 * question-answering surface is unit-testable without a database or a network.
 */

export interface ExecutionResult {
  kind: 'rows' | 'scalar' | 'groups' | 'none';
  rows?: AiAnswerRow[];
  groups?: AiGroupRow[];
  scalar?: { label: string; value: number; unit: string | null };
  matchedCount: number;
  totalCount: number;
  factualSummary: string;
  warnings: string[];
}

/** Flat projection of a holding — the shape filters and sorts operate on. */
interface FlatHolding {
  instrumentName: string;
  nseSymbol: string | null;
  bseCode: string | null;
  sector: string | null;
  industry: string | null;
  instrumentType: string;
  marketCapCategory: string | null;
  weightPct: number;
  rank: number;
  ltp: number | null;
  changePct: number | null;
  changeAbs: number | null;
  volume: number | null;
  marketCapCrore: number | null;
  week52High: number | null;
  week52Low: number | null;
  week52Avg: number | null;
  pctFrom52wAvg: number | null;
  weightedChangePct: number | null;
}

export function flatten(holdings: HoldingRow[]): FlatHolding[] {
  return holdings.map((h) => ({
    instrumentName: h.stock?.name ?? h.instrumentName,
    nseSymbol: h.stock?.nseSymbol ?? null,
    bseCode: h.stock?.bseCode ?? null,
    sector: h.stock?.sector ?? null,
    industry: h.stock?.industry ?? null,
    instrumentType: h.instrumentType,
    marketCapCategory: h.stock?.marketCapCategory ?? null,
    weightPct: h.weightPct,
    rank: h.rank,
    ltp: h.quote?.ltp ?? null,
    changePct: h.quote?.changePct ?? null,
    changeAbs: h.quote?.change ?? null,
    volume: h.quote?.volume ?? null,
    marketCapCrore: h.stock?.marketCapCrore ?? null,
    week52High: h.quote?.week52High ?? null,
    week52Low: h.quote?.week52Low ?? null,
    week52Avg: h.quote?.week52Avg ?? null,
    pctFrom52wAvg: h.pctFrom52wAvg,
    weightedChangePct: h.weightedChangePct,
  }));
}

export function executeQuery(spec: QuerySpec, holdings: HoldingRow[]): ExecutionResult {
  const all = flatten(holdings);
  const warnings: string[] = [];

  if (spec.intent === 'unsupported') {
    return {
      kind: 'none',
      matchedCount: 0,
      totalCount: all.length,
      factualSummary: spec.reason ?? 'This question cannot be answered from the available data.',
      warnings,
    };
  }

  // A filter or sort on a price field is meaningless when no quotes arrived;
  // say so rather than returning a confidently empty table.
  const touchedFields = [
    ...spec.filters.map((f) => f.field),
    ...(spec.sort ? [spec.sort.field] : []),
    ...(spec.aggregate?.field ? [spec.aggregate.field] : []),
  ];
  const priceFields: QueryableField[] = [
    'ltp',
    'changePct',
    'changeAbs',
    'volume',
    'pctFrom52wAvg',
    'week52Avg',
  ];
  if (touchedFields.some((f) => priceFields.includes(f)) && all.every((h) => h.ltp === null)) {
    warnings.push(
      'No live prices are available right now, so price-based conditions matched nothing.',
    );
  }

  let matched = all.filter((h) => spec.filters.every((f) => matches(h, f)));

  if (spec.sort) {
    const { field, direction } = spec.sort;
    matched = [...matched].sort((a, b) => compare(a[field], b[field], direction));
  } else if (spec.intent === 'list' || spec.intent === 'rank') {
    // Sensible default: weight is the primary axis of a portfolio table.
    matched = [...matched].sort((a, b) => b.weightPct - a.weightPct);
  }

  switch (spec.intent) {
    case 'count': {
      return {
        kind: 'scalar',
        scalar: { label: 'Matching holdings', value: matched.length, unit: null },
        matchedCount: matched.length,
        totalCount: all.length,
        factualSummary: `${matched.length} of ${all.length} holdings match.`,
        warnings,
      };
    }

    case 'aggregate': {
      const agg = spec.aggregate ?? { op: 'count' as const, field: undefined };
      const result = aggregate(matched, agg.op, agg.field);
      return {
        kind: 'scalar',
        scalar: result,
        matchedCount: matched.length,
        totalCount: all.length,
        factualSummary: `${result.label}: ${formatNumber(result.value)}${result.unit ?? ''} across ${matched.length} holding${matched.length === 1 ? '' : 's'}.`,
        warnings,
      };
    }

    case 'groupBy': {
      const groups = groupBy(matched, spec.groupBy ?? 'sector');
      return {
        kind: 'groups',
        groups,
        matchedCount: matched.length,
        totalCount: all.length,
        factualSummary:
          groups.length === 0
            ? 'No holdings matched, so there is nothing to group.'
            : `${groups.length} ${labelFor(spec.groupBy ?? 'sector')} groups across ${matched.length} holdings. ` +
              `Largest: ${groups[0].key} at ${groups[0].weightPct}% of net assets.`,
        warnings,
      };
    }

    case 'rank':
    case 'list':
    default: {
      const limit = spec.limit ?? (spec.intent === 'rank' ? 5 : 50);
      const rows = matched.slice(0, limit).map(toAnswerRow);
      return {
        kind: 'rows',
        rows,
        matchedCount: matched.length,
        totalCount: all.length,
        factualSummary: summariseRows(rows, matched.length, all.length, spec),
        warnings,
      };
    }
  }
}

function matches(holding: FlatHolding, filter: HoldingFilter): boolean {
  const actual = holding[filter.field];

  switch (filter.op) {
    case 'isNull':
      return actual === null || actual === undefined;
    case 'notNull':
      return actual !== null && actual !== undefined;
    default:
      break;
  }

  // A null value fails every comparison. Notably it does NOT fail `neq`
  // vacuously either: "sector is not Banks" should not surface a holding whose
  // sector we simply do not know.
  if (actual === null || actual === undefined) return false;

  if (isNumericField(filter.field)) {
    const value = actual as number;
    if (filter.op === 'between') {
      const [lo, hi] = (filter.value as [number, number]) ?? [];
      return typeof lo === 'number' && typeof hi === 'number' && value >= lo && value <= hi;
    }
    if (filter.op === 'in') {
      return ((filter.value as number[]) ?? []).includes(value);
    }
    const target = Number(filter.value);
    if (!Number.isFinite(target)) return false;
    switch (filter.op) {
      case 'eq':
        return value === target;
      case 'neq':
        return value !== target;
      case 'gt':
        return value > target;
      case 'gte':
        return value >= target;
      case 'lt':
        return value < target;
      case 'lte':
        return value <= target;
      default:
        return false;
    }
  }

  const text = String(actual).toLowerCase();
  switch (filter.op) {
    case 'eq':
      return text === String(filter.value).toLowerCase();
    case 'neq':
      return text !== String(filter.value).toLowerCase();
    case 'contains':
      return text.includes(String(filter.value).toLowerCase());
    case 'in':
      return ((filter.value as string[]) ?? []).some((v) => String(v).toLowerCase() === text);
    default:
      return false;
  }
}

function compare(a: unknown, b: unknown, direction: 'asc' | 'desc'): number {
  // Nulls always sort last, in both directions — an unknown value is never the
  // "top" answer to a ranking question.
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;

  const result =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), 'en', { sensitivity: 'base' });

  return direction === 'asc' ? result : -result;
}

function aggregate(
  rows: FlatHolding[],
  op: 'sum' | 'avg' | 'count' | 'min' | 'max',
  field?: QueryableField,
): { label: string; value: number; unit: string | null } {
  if (op === 'count' || !field) {
    return { label: 'Count', value: rows.length, unit: null };
  }

  const values = rows
    .map((r) => r[field])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const unit = unitFor(field);
  const label = `${op.toUpperCase()} of ${labelFor(field)}`;

  if (values.length === 0) return { label, value: 0, unit };

  switch (op) {
    case 'sum':
      return {
        label,
        value: round(
          values.reduce((a, b) => a + b, 0),
          4,
        ),
        unit,
      };
    case 'avg':
      return { label, value: round(values.reduce((a, b) => a + b, 0) / values.length, 4), unit };
    case 'min':
      return { label, value: Math.min(...values), unit };
    case 'max':
      return { label, value: Math.max(...values), unit };
    default:
      return { label, value: 0, unit };
  }
}

function groupBy(
  rows: FlatHolding[],
  key: 'sector' | 'industry' | 'marketCapCategory' | 'instrumentType',
): AiGroupRow[] {
  const groups = new Map<string, FlatHolding[]>();
  for (const row of rows) {
    const value = (row[key] as string | null) ?? 'Unclassified';
    const bucket = groups.get(value);
    if (bucket) bucket.push(row);
    else groups.set(value, [row]);
  }

  return [...groups.entries()]
    .map(([k, items]) => ({
      key: k,
      weightPct: round(
        items.reduce((s, i) => s + i.weightPct, 0),
        2,
      ),
      count: items.length,
      weightedChangePct: weightedMean(
        items.map((i) => ({ weight: i.weightPct, value: i.changePct })),
        3,
      ),
    }))
    .sort((a, b) => b.weightPct - a.weightPct);
}

function toAnswerRow(h: FlatHolding): AiAnswerRow {
  return {
    instrumentName: h.instrumentName,
    nseSymbol: h.nseSymbol,
    sector: h.sector,
    weightPct: h.weightPct,
    ltp: h.ltp,
    changePct: h.changePct,
    marketCapCrore: h.marketCapCrore,
    marketCapCategory: h.marketCapCategory,
    pctFrom52wAvg: h.pctFrom52wAvg,
  };
}

/**
 * Deterministic, template-rendered description of the result set. Shown to the
 * user as the factual part of the answer, separate from any LLM narrative.
 */
function summariseRows(
  rows: AiAnswerRow[],
  matchedCount: number,
  totalCount: number,
  spec: QuerySpec,
): string {
  if (matchedCount === 0) {
    return `No holdings out of ${totalCount} match those conditions.`;
  }

  const combinedWeight = round(
    rows.reduce((s, r) => s + r.weightPct, 0),
    2,
  );
  const shown =
    rows.length < matchedCount
      ? `Showing the top ${rows.length} of ${matchedCount}`
      : `${matchedCount}`;
  const noun = matchedCount === 1 ? 'holding' : 'holdings';

  let sentence = `${shown} matching ${noun} (${combinedWeight}% of net assets in the rows shown).`;

  if (spec.sort && rows.length > 0) {
    const top = rows[0];
    const value = topValueFor(top, spec.sort.field);
    if (value !== null) {
      sentence += ` ${top.instrumentName} leads on ${labelFor(spec.sort.field)} at ${value}.`;
    }
  }
  return sentence;
}

function topValueFor(row: AiAnswerRow, field: QueryableField): string | null {
  const map: Partial<Record<QueryableField, number | null>> = {
    weightPct: row.weightPct,
    changePct: row.changePct,
    ltp: row.ltp,
    marketCapCrore: row.marketCapCrore,
    pctFrom52wAvg: row.pctFrom52wAvg,
  };
  const value = map[field];
  if (value === null || value === undefined) return null;
  return `${formatNumber(value)}${unitFor(field) ?? ''}`;
}

function isNumericField(field: QueryableField): boolean {
  return NUMERIC_FIELDS.includes(field);
}

function unitFor(field: QueryableField): string | null {
  switch (field) {
    case 'weightPct':
    case 'changePct':
    case 'pctFrom52wAvg':
    case 'weightedChangePct':
      return '%';
    case 'ltp':
    case 'changeAbs':
    case 'week52High':
    case 'week52Low':
    case 'week52Avg':
      return ' ₹';
    case 'marketCapCrore':
      return ' cr';
    default:
      return null;
  }
}

export function labelFor(field: string): string {
  const labels: Record<string, string> = {
    instrumentName: 'stock name',
    nseSymbol: 'NSE symbol',
    bseCode: 'BSE code',
    sector: 'sector',
    industry: 'industry',
    instrumentType: 'instrument type',
    marketCapCategory: 'market cap category',
    weightPct: 'portfolio weight',
    rank: 'rank',
    ltp: 'last traded price',
    changePct: "today's change",
    changeAbs: "today's change",
    volume: 'volume',
    marketCapCrore: 'market capitalisation',
    week52High: '52-week high',
    week52Low: '52-week low',
    week52Avg: '52-week average',
    pctFrom52wAvg: 'distance from 52-week average',
    weightedChangePct: 'weighted contribution',
  };
  return labels[field] ?? field;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
