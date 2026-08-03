import type {
  AlertChannel,
  AlertType,
  Exchange,
  FundCategory,
  InstrumentType,
  MarketCapCategory,
  OptionType,
  PlanType,
  PriceQuality,
  SnapshotStatus,
} from './enums';

/** A mutual fund scheme as returned by search and detail endpoints. */
export interface FundSummary {
  id: string;
  amfiSchemeCode: string | null;
  name: string;
  amcName: string;
  category: FundCategory;
  subCategory: string | null;
  planType: PlanType;
  optionType: OptionType;
  isinGrowth: string | null;
  latestNav: number | null;
  latestNavDate: string | null;
  /** Only present on search responses; higher is a better match. */
  matchScore?: number;
}

export interface FundDetail extends FundSummary {
  benchmark: string | null;
  riskometer: string | null;
  aumCrore: number | null;
  isActive: boolean;
  latestDisclosureDate: string | null;
  /** True when the newest disclosure is older than the configured threshold. */
  disclosureStale: boolean;
}

/** Static reference data for a listed company. */
export interface StockRef {
  id: string;
  name: string;
  isin: string | null;
  nseSymbol: string | null;
  bseCode: string | null;
  sector: string | null;
  industry: string | null;
  marketCapCrore: number | null;
  marketCapCategory: MarketCapCategory;
}

/** A live (or last-known) quote for a single security. */
export interface Quote {
  stockId: string;
  exchange: Exchange;
  ltp: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  /** Absolute change against previous close, in rupees. */
  change: number | null;
  changePct: number | null;
  volume: number | null;
  week52High: number | null;
  week52Low: number | null;
  /** Simple average of the trailing 52-week daily closes. */
  week52Avg: number | null;
  quality: PriceQuality;
  /** ISO-8601 timestamp of the exchange quote, not of our fetch. */
  quotedAt: string | null;
  fetchedAt: string | null;
  source: string;
}

/**
 * One row of the dashboard: a disclosed holding joined with reference data and
 * the latest quote. `quote` is null when the instrument is not exchange traded
 * or when no mapping exists.
 */
export interface HoldingRow {
  id: string;
  instrumentName: string;
  isin: string | null;
  instrumentType: InstrumentType;
  weightPct: number;
  quantity: number | null;
  marketValueLakh: number | null;
  rank: number;
  stock: StockRef | null;
  quote: Quote | null;
  /** False when the disclosure line could not be mapped to a listed security. */
  mapped: boolean;
  /** 0–1 confidence of the name/ISIN → symbol mapping. */
  mappingConfidence: number | null;
  /** Percentage distance of LTP from the 52-week average close. */
  pctFrom52wAvg: number | null;
  /** weightPct × changePct / 100 — this holding's drag/lift on the portfolio. */
  weightedChangePct: number | null;
}

export interface PortfolioSnapshotMeta {
  id: string;
  fundId: string;
  disclosureDate: string;
  status: SnapshotStatus;
  source: string;
  sourceUrl: string | null;
  holdingsCount: number;
  equityCount: number;
  totalEquityWeightPct: number;
  importedAt: string;
  /** True when the disclosure is older than DISCLOSURE_STALE_AFTER_DAYS. */
  stale: boolean;
}

export interface HoldingsResponse {
  fund: FundSummary;
  snapshot: PortfolioSnapshotMeta;
  holdings: HoldingRow[];
  /** Names in the disclosure we could not map to a listed security. */
  unmappedInstruments: string[];
  priceCoverage: {
    requested: number;
    withQuote: number;
    stale: number;
    unavailable: number;
  };
  generatedAt: string;
}

export interface SectorAllocation {
  sector: string;
  weightPct: number;
  stockCount: number;
  /** Weight-weighted average intraday change of the sector's holdings. */
  weightedChangePct: number | null;
}

export interface MarketCapAllocation {
  category: MarketCapCategory;
  weightPct: number;
  stockCount: number;
}

export interface MoverRow {
  stockName: string;
  nseSymbol: string | null;
  weightPct: number;
  changePct: number;
  ltp: number | null;
}

/** Everything the analytics strip on the dashboard needs, in one payload. */
export interface PortfolioAnalytics {
  fundId: string;
  disclosureDate: string;
  totalInstruments: number;
  totalStocks: number;
  totalEquityWeightPct: number;
  /** Weight held in non-equity instruments (debt, cash, TREPS, units). */
  nonEquityWeightPct: number;
  top10WeightPct: number;
  top10: MoverRow[];
  highestWeighted: MoverRow | null;
  lowestWeighted: MoverRow | null;
  averageChangePct: number | null;
  /** Portfolio-weighted average change — the fund's implied intraday move. */
  weightedAverageChangePct: number | null;
  advancers: number;
  decliners: number;
  unchanged: number;
  topGainers: MoverRow[];
  topLosers: MoverRow[];
  sectorAllocation: SectorAllocation[];
  marketCapAllocation: MarketCapAllocation[];
  /** Herfindahl–Hirschman index over holding weights (0–10000). */
  concentrationHhi: number;
  priceCoverage: { withQuote: number; total: number };
  generatedAt: string;
}

export interface HoldingChange {
  instrumentName: string;
  nseSymbol: string | null;
  weightFrom: number | null;
  weightTo: number | null;
  weightDeltaPct: number;
  changeType: 'ADDED' | 'EXITED' | 'INCREASED' | 'REDUCED' | 'UNCHANGED';
}

export interface ComparisonResult {
  fundId: string;
  fundName: string;
  fromDate: string;
  toDate: string;
  added: HoldingChange[];
  exited: HoldingChange[];
  increased: HoldingChange[];
  reduced: HoldingChange[];
  unchangedCount: number;
  turnoverPct: number;
  sectorShift: Array<{ sector: string; weightFrom: number; weightTo: number; delta: number }>;
}

/** Cross-fund overlap, used by the "compare two schemes" view. */
export interface OverlapResult {
  fundA: { id: string; name: string; disclosureDate: string };
  fundB: { id: string; name: string; disclosureDate: string };
  /** Sum of min(weightA, weightB) across common holdings. */
  overlapPct: number;
  commonHoldings: Array<{
    instrumentName: string;
    nseSymbol: string | null;
    weightA: number;
    weightB: number;
  }>;
  onlyInA: number;
  onlyInB: number;
}

export interface Watchlist {
  id: string;
  name: string;
  createdAt: string;
  items: Array<{ id: string; stockId: string; stockName: string; nseSymbol: string | null }>;
}

export interface AlertRule {
  id: string;
  type: AlertType;
  channel: AlertChannel;
  fundId: string | null;
  stockId: string | null;
  /** Absolute percentage threshold; semantics depend on `type`. */
  thresholdPct: number | null;
  isActive: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  createdAt: string;
}
