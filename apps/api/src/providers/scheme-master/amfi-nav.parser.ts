import { detectOptionType, detectPlanType, normalizeSchemeName } from '../../common/utils/text';

/**
 * Parser for AMFI's public NAVAll.txt scheme master.
 *
 * The file is a semicolon-delimited dump interleaved with two kinds of
 * unstructured lines:
 *
 *   Open Ended Schemes(Equity Scheme - Large Cap Fund)   ← category header
 *   Aditya Birla Sun Life Mutual Fund                    ← AMC header
 *   119551;INF209K01YM2;INF209K01YN0;ABSL Frontline Equity Fund - Direct - Growth;512.34;31-Jul-2025
 *
 * The two header kinds are distinguishable only by shape, which is why the
 * parser tracks state rather than mapping lines independently. Rows inherit the
 * most recent headers seen above them.
 */

export interface ParsedScheme {
  amfiSchemeCode: string;
  isinGrowth: string | null;
  isinDivReinv: string | null;
  schemeName: string;
  normalizedName: string;
  nav: number | null;
  navDate: Date | null;
  amcName: string;
  category: 'EQUITY' | 'DEBT' | 'HYBRID' | 'SOLUTION_ORIENTED' | 'OTHER';
  subCategory: string | null;
  planType: 'DIRECT' | 'REGULAR' | 'UNKNOWN';
  optionType: 'GROWTH' | 'IDCW' | 'UNKNOWN';
}

export interface ParseResult {
  schemes: ParsedScheme[];
  warnings: string[];
}

const HEADER_PREFIX = 'Scheme Code';
const CATEGORY_RE = /^(Open|Close|Interval)[\w\s]*Schemes?\s*\((.+)\)\s*$/i;

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export function parseAmfiNavAll(content: string): ParseResult {
  const warnings: string[] = [];
  const schemes: ParsedScheme[] = [];
  const seenCodes = new Set<string>();

  let currentCategory: ParsedScheme['category'] = 'OTHER';
  let currentSubCategory: string | null = null;
  let currentAmc = 'Unknown AMC';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith(HEADER_PREFIX)) continue;

    if (!line.includes(';')) {
      const categoryMatch = CATEGORY_RE.exec(line);
      if (categoryMatch) {
        const label = categoryMatch[2].trim();
        currentSubCategory = normalizeSubCategory(label);
        currentCategory = classifyCategory(label);
      } else {
        // Not a category header and not a data row → it is the AMC name.
        currentAmc = line;
      }
      continue;
    }

    const parts = line.split(';');
    if (parts.length < 6) {
      warnings.push(`Skipped malformed row (${parts.length} fields): ${line.slice(0, 80)}`);
      continue;
    }

    const [code, isinA, isinB, name, navRaw, dateRaw] = parts.map((p) => p.trim());
    if (!code || !name) {
      warnings.push(`Skipped row with missing code or name: ${line.slice(0, 80)}`);
      continue;
    }
    // AMFI occasionally repeats a scheme code across category blocks; the first
    // occurrence wins so a re-run cannot flip a scheme's category at random.
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);

    const nav = parseNav(navRaw);
    schemes.push({
      amfiSchemeCode: code,
      isinGrowth: cleanIsin(isinA),
      isinDivReinv: cleanIsin(isinB),
      schemeName: name,
      normalizedName: normalizeSchemeName(name),
      nav,
      navDate: parseAmfiDate(dateRaw),
      amcName: currentAmc,
      category: currentCategory,
      subCategory: currentSubCategory,
      planType: detectPlanType(name),
      optionType: detectOptionType(name),
    });
  }

  if (schemes.length === 0) {
    warnings.push('No schemes parsed — the source format may have changed.');
  }

  return { schemes, warnings };
}

/** AMFI writes "N.A." and "-" for suspended or newly launched schemes. */
function parseNav(raw: string): number | null {
  if (!raw || /^n\.?a\.?$/i.test(raw) || raw === '-') return null;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanIsin(raw: string): string | null {
  const v = raw?.trim();
  if (!v || v === '-' || /^n\.?a\.?$/i.test(v)) return null;
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(v) ? v : null;
}

/** Parses AMFI's `DD-Mon-YYYY` format without pulling in a date library. */
export function parseAmfiDate(raw: string): Date | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw?.trim() ?? '');
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  const d = new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function classifyCategory(label: string): ParsedScheme['category'] {
  const l = label.toLowerCase();
  if (l.includes('equity scheme')) return 'EQUITY';
  if (l.includes('debt scheme')) return 'DEBT';
  if (l.includes('hybrid scheme')) return 'HYBRID';
  if (l.includes('solution oriented')) return 'SOLUTION_ORIENTED';
  // Index funds, ETFs, FoFs and gold funds land here; they are equity-like for
  // search purposes but are not SEBI equity schemes, so they stay OTHER.
  return 'OTHER';
}

/** "Equity Scheme - Large Cap Fund" → "Large Cap Fund". */
function normalizeSubCategory(label: string): string | null {
  const parts = label.split(' - ');
  return (parts.length > 1 ? parts.slice(1).join(' - ') : label).trim() || null;
}
