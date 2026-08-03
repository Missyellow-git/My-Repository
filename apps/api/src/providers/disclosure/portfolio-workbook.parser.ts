import { Workbook, type Row, type Worksheet } from 'exceljs';
import { StockMapperService } from './stock-mapper.service';
import type { DisclosureLine, RawDisclosure } from './disclosure.types';

/**
 * Generic parser for AMC monthly-portfolio workbooks.
 *
 * There is no standard layout. What is reliably true across AMCs is:
 *  - one worksheet per scheme, or one sheet holding several scheme blocks;
 *  - a header row containing recognisable words ("Name of the Instrument",
 *    "ISIN", "Quantity", "Market value", "% to Net Assets");
 *  - data rows below it until a blank run or a "Total" line;
 *  - section headers ("Equity & Equity related", "Debt Instruments") that
 *    classify the rows beneath them.
 *
 * So rather than hard-coding cell coordinates — which break whenever an AMC
 * adds a logo row — this parser locates the header row by content, builds a
 * column map from it, and reads until the block ends. Per-AMC quirks are
 * handled by the small `ParseOptions` overrides instead of by forked parsers.
 */

export interface ParseOptions {
  /** Sheet name or index; omit to scan every sheet. */
  sheet?: string | number;
  /** Extra header synonyms for a stubborn AMC template. */
  headerSynonyms?: Partial<Record<ColumnKey, string[]>>;
  /** Scheme name when the workbook does not print one. */
  schemeNameOverride?: string;
  disclosureDate?: Date;
  sourceUrl?: string;
}

export interface WorkbookParseResult {
  disclosures: RawDisclosure[];
  warnings: string[];
}

type ColumnKey = 'name' | 'isin' | 'industry' | 'quantity' | 'marketValue' | 'weight';

const HEADER_SYNONYMS: Record<ColumnKey, string[]> = {
  name: [
    'name of the instrument',
    'name of instrument',
    'instrument name',
    'company name',
    'security name',
    'particulars',
  ],
  isin: ['isin'],
  industry: ['industry', 'sector', 'industry / rating', 'rating / industry', 'industry+/rating'],
  quantity: ['quantity', 'qty', 'no. of shares', 'number of shares', 'units'],
  marketValue: [
    'market value',
    'market value (rs. in lakhs)',
    'market/fair value',
    'amount',
    'value',
  ],
  weight: [
    '% to net assets',
    '% of net assets',
    '% to nav',
    'percentage of net assets',
    '% to net asset',
  ],
};

/** Section headers that reclassify the rows beneath them. */
const SECTION_PATTERNS: Array<{ re: RegExp; type: string }> = [
  { re: /equity\s*(&|and)?\s*equity\s*related|listed\s*\/?\s*awaiting/i, type: 'EQUITY' },
  {
    re: /debt\s*instrument|bonds?\s*(&|and)?\s*ncd|government\s*securit|corporate\s*debt/i,
    type: 'DEBT',
  },
  {
    re: /money\s*market|treps|cash\s*(&|and)?\s*cash\s*equivalent|treasury\s*bill/i,
    type: 'MONEY_MARKET',
  },
  { re: /derivative|futures?\s*(&|and)?\s*options?/i, type: 'DERIVATIVE' },
  { re: /reit|invit/i, type: 'REIT_INVIT' },
  { re: /mutual\s*fund\s*units?|units?\s*of\s*(mutual\s*fund|etf)/i, type: 'MUTUAL_FUND_UNIT' },
];

const TERMINATORS = /^(grand\s*)?total|^net\s*assets?|^notes?:/i;

export async function parsePortfolioWorkbook(
  buffer: Buffer,
  options: ParseOptions = {},
): Promise<WorkbookParseResult> {
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const warnings: string[] = [];
  const disclosures: RawDisclosure[] = [];

  const sheets: Worksheet[] =
    options.sheet === undefined
      ? workbook.worksheets
      : [
          typeof options.sheet === 'number'
            ? workbook.worksheets[options.sheet]
            : workbook.getWorksheet(options.sheet),
        ].filter((s): s is Worksheet => !!s);

  if (sheets.length === 0) {
    return { disclosures, warnings: ['No worksheets found in workbook'] };
  }

  for (const sheet of sheets) {
    const parsed = parseSheet(sheet, options, warnings);
    if (parsed) disclosures.push(parsed);
  }

  if (disclosures.length === 0) {
    warnings.push('No parsable portfolio table found — the workbook layout may be unsupported.');
  }

  return { disclosures, warnings };
}

function parseSheet(
  sheet: Worksheet,
  options: ParseOptions,
  warnings: string[],
): RawDisclosure | null {
  const synonyms = mergeSynonyms(options.headerSynonyms);
  const header = findHeaderRow(sheet, synonyms);
  if (!header) return null;

  const { rowNumber, columns } = header;
  if (columns.name === undefined || columns.weight === undefined) {
    warnings.push(`Sheet "${sheet.name}": header found but no name/weight column; skipped.`);
    return null;
  }

  const schemeName =
    options.schemeNameOverride ?? findSchemeName(sheet, rowNumber) ?? sheet.name.trim();
  const disclosureDate = options.disclosureDate ?? findDisclosureDate(sheet, rowNumber);
  if (!disclosureDate) {
    warnings.push(`Sheet "${sheet.name}": no disclosure date found; skipped.`);
    return null;
  }

  const lines: DisclosureLine[] = [];
  let currentSection: string | null = null;
  let blankRun = 0;

  for (let r = rowNumber + 1; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const nameCell = cellText(row, columns.name);

    if (!nameCell) {
      blankRun += 1;
      // Two blank rows almost always mean the table ended; one is often just
      // spacing between sections.
      if (blankRun >= 2 && lines.length > 0) break;
      continue;
    }
    blankRun = 0;

    if (TERMINATORS.test(nameCell)) continue;

    const weightRaw = numberAt(row, columns.weight);
    const isinRaw = columns.isin === undefined ? null : cellText(row, columns.isin);

    // A row with a name but no weight and no ISIN is a section header.
    if (weightRaw === null && !isinRaw) {
      const section = SECTION_PATTERNS.find((p) => p.re.test(nameCell));
      if (section) currentSection = section.type;
      continue;
    }
    if (weightRaw === null) continue;

    const isin = isinRaw && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isinRaw) ? isinRaw : null;

    lines.push({
      instrumentName: nameCell,
      isin,
      industry: columns.industry === undefined ? null : cellText(row, columns.industry) || null,
      quantity: columns.quantity === undefined ? null : numberAt(row, columns.quantity),
      marketValueLakh:
        columns.marketValue === undefined ? null : numberAt(row, columns.marketValue),
      weightPct: weightRaw,
      instrumentType: currentSection ?? StockMapperService.inferInstrumentType(nameCell, isin),
    });
  }

  if (lines.length === 0) {
    warnings.push(`Sheet "${sheet.name}": header matched but no data rows parsed.`);
    return null;
  }

  const totalWeight = lines.reduce((s, l) => s + l.weightPct, 0);
  // Real disclosures land within about a point of 100 after rounding. A wider
  // miss means we mis-read a column and the snapshot must not be published.
  if (Math.abs(totalWeight - 100) > 2) {
    warnings.push(
      `Sheet "${sheet.name}": weights sum to ${totalWeight.toFixed(2)}%, outside the 98–102% tolerance.`,
    );
  }

  return {
    schemeName,
    disclosureDate,
    sourceUrl: options.sourceUrl ?? null,
    lines,
  };
}

function mergeSynonyms(extra?: ParseOptions['headerSynonyms']): Record<ColumnKey, string[]> {
  const merged = { ...HEADER_SYNONYMS };
  if (!extra) return merged;
  for (const [key, values] of Object.entries(extra) as Array<[ColumnKey, string[]]>) {
    merged[key] = [...merged[key], ...values.map((v) => v.toLowerCase())];
  }
  return merged;
}

function findHeaderRow(
  sheet: Worksheet,
  synonyms: Record<ColumnKey, string[]>,
): { rowNumber: number; columns: Partial<Record<ColumnKey, number>> } | null {
  // Scan only the top of the sheet: AMC preambles are long but not unbounded,
  // and scanning the whole sheet risks matching a stray word in the data.
  const limit = Math.min(sheet.rowCount, 40);

  for (let r = 1; r <= limit; r += 1) {
    const row = sheet.getRow(r);
    const columns: Partial<Record<ColumnKey, number>> = {};

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = String(cell.value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      if (!text) return;
      for (const [key, options] of Object.entries(synonyms) as Array<[ColumnKey, string[]]>) {
        if (columns[key] !== undefined) continue;
        if (options.some((syn) => text === syn || text.includes(syn))) {
          columns[key] = colNumber;
        }
      }
    });

    if (columns.name !== undefined && columns.weight !== undefined) {
      return { rowNumber: r, columns };
    }
  }
  return null;
}

/** Scheme names sit in a merged title cell above the table. */
function findSchemeName(sheet: Worksheet, headerRow: number): string | null {
  for (let r = Math.max(1, headerRow - 8); r < headerRow; r += 1) {
    const text = rowText(sheet.getRow(r));
    if (/fund|scheme|plan/i.test(text) && text.length > 8 && text.length < 200) {
      return text.replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}

/** Matches "as on 31st July, 2025", "31-07-2025", "31/07/2025", "July 31, 2025". */
function findDisclosureDate(sheet: Worksheet, headerRow: number): Date | null {
  for (let r = 1; r < headerRow; r += 1) {
    const row = sheet.getRow(r);

    // A real date cell is the most trustworthy source when present.
    let found: Date | null = null;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (!found && cell.value instanceof Date) found = cell.value;
    });
    if (found) return found;

    const parsed = parseDateFromText(rowText(row));
    if (parsed) return parsed;
  }
  return null;
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

export function parseDateFromText(text: string): Date | null {
  const t = text.toLowerCase();

  const numeric = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(t);
  if (numeric) {
    // Indian disclosures are day-first without exception.
    const d = new Date(Date.UTC(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1])));
    if (!Number.isNaN(d.getTime())) return d;
  }

  const dayFirst = /(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-z]+)\,?\s+(\d{4})/.exec(t);
  if (dayFirst) {
    const month = MONTH_NAMES.findIndex((m) => m.startsWith(dayFirst[2].slice(0, 3)));
    if (month >= 0) return new Date(Date.UTC(Number(dayFirst[3]), month, Number(dayFirst[1])));
  }

  const monthFirst = /([a-z]+)\s+(\d{1,2})\,?\s+(\d{4})/.exec(t);
  if (monthFirst) {
    const month = MONTH_NAMES.findIndex((m) => m.startsWith(monthFirst[1].slice(0, 3)));
    if (month >= 0) return new Date(Date.UTC(Number(monthFirst[3]), month, Number(monthFirst[2])));
  }

  return null;
}

function cellText(row: Row, col: number): string {
  const value = row.getCell(col).value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'richText' in value) {
    return (value.richText as Array<{ text: string }>)
      .map((p) => p.text)
      .join('')
      .trim();
  }
  if (typeof value === 'object' && 'result' in value) {
    return String((value as { result: unknown }).result ?? '').trim();
  }
  return String(value).trim();
}

function numberAt(row: Row, col: number): number | null {
  const raw = row.getCell(col).value;
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'object' && 'result' in raw) {
    const n = Number((raw as { result: unknown }).result);
    return Number.isFinite(n) ? n : null;
  }
  // Strip thousands separators, percent signs, and the parenthesised negatives
  // some AMCs use for net payables.
  const text = String(raw).trim();
  const negative = /^\(.*\)$/.test(text);
  const n = Number(text.replace(/[(),%\s]/g, '').replace(/[^\d.\-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function rowText(row: Row): string {
  const parts: string[] = [];
  row.eachCell({ includeEmpty: false }, (cell) => {
    const v = cell.value;
    if (v !== null && v !== undefined) parts.push(String(v));
  });
  return parts.join(' ');
}
