/**
 * Text normalisation used for scheme and company matching.
 *
 * Disclosure files, the AMFI master and our own stock master all spell the same
 * company differently ("HDFC Bank Ltd.", "HDFC BANK LIMITED", "Hdfc Bank Ltd").
 * Everything is funnelled through `normalizeName` before it is stored or
 * compared, and the normalised form is what the trigram indexes are built on.
 */

/** Corporate suffixes that carry no discriminating information. */
const COMPANY_SUFFIXES = [
  'limited',
  'ltd',
  'private',
  'pvt',
  'public',
  'company',
  'co',
  'corporation',
  'corp',
  'incorporated',
  'inc',
  'plc',
  'llp',
];

/** Tokens common to nearly every scheme name; dropped from scheme matching. */
const SCHEME_NOISE = ['fund', 'scheme', 'plan', 'option', 'mutual'];

export function normalizeName(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      // & → and so "Mahindra & Mahindra" and "Mahindra and Mahindra" collapse.
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0 && !COMPANY_SUFFIXES.includes(t))
      .join(' ')
      .trim()
  );
}

/**
 * Scheme-name normalisation. Keeps plan/option words out of the comparison but
 * preserves them in the stored display name, because "Direct" vs "Regular" is
 * a real distinction we track in a dedicated column.
 */
export function normalizeSchemeName(input: string): string {
  return normalizeName(input)
    .split(' ')
    .filter((t) => !SCHEME_NOISE.includes(t))
    .join(' ')
    .trim();
}

/** Detects the plan type from a raw AMFI scheme name. */
export function detectPlanType(schemeName: string): 'DIRECT' | 'REGULAR' | 'UNKNOWN' {
  const s = schemeName.toLowerCase();
  if (/\bdirect\b/.test(s)) return 'DIRECT';
  if (/\bregular\b/.test(s)) return 'REGULAR';
  return 'UNKNOWN';
}

export function detectOptionType(schemeName: string): 'GROWTH' | 'IDCW' | 'UNKNOWN' {
  const s = schemeName.toLowerCase();
  if (/\bgrowth\b/.test(s)) return 'GROWTH';
  if (/\b(idcw|dividend|payout|reinvest)\b/.test(s)) return 'IDCW';
  return 'UNKNOWN';
}

/**
 * Token-set Dice coefficient in [0,1].
 *
 * Chosen over Levenshtein because disclosure names differ by whole tokens
 * (dropped "Limited", inserted "India") far more often than by characters, and
 * because it is symmetric and cheap enough to run over a few thousand
 * candidates during import.
 */
export function similarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection += 1;
  return (2 * intersection) / (ta.size + tb.size);
}

/** Escapes a user string for safe use inside a SQL LIKE/ILIKE pattern. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Title-cases an ALL CAPS instrument name for display without mangling acronyms. */
export function prettifyInstrumentName(input: string): string {
  if (input !== input.toUpperCase()) return input.trim();
  return input
    .toLowerCase()
    .split(/\s+/)
    .map((w) =>
      w.length <= 3 && /^[a-z]+$/.test(w)
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ')
    .trim();
}
