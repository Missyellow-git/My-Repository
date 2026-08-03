/** Stable error codes. Clients switch on these, never on message text. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  FUND_NOT_FOUND: 'FUND_NOT_FOUND',
  DISCLOSURE_NOT_FOUND: 'DISCLOSURE_NOT_FOUND',
  DISCLOSURE_STALE: 'DISCLOSURE_STALE',
  STOCK_NOT_FOUND: 'STOCK_NOT_FOUND',
  SYMBOL_MAPPING_MISSING: 'SYMBOL_MAPPING_MISSING',
  PRICE_FEED_UNAVAILABLE: 'PRICE_FEED_UNAVAILABLE',
  PRICE_FEED_DEGRADED: 'PRICE_FEED_DEGRADED',
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_QUESTION_UNSUPPORTED: 'AI_QUESTION_UNSUPPORTED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Cache key builders. Centralised so TTLs and invalidation stay in one place —
 * see docs/ARCHITECTURE.md#caching for the tiering rationale.
 */
export const CacheKeys = {
  fundSearch: (q: string, limit: number) => `fund:search:${q.toLowerCase()}:${limit}`,
  fundDetail: (id: string) => `fund:detail:${id}`,
  snapshotHoldings: (snapshotId: string) => `snapshot:holdings:${snapshotId}`,
  latestSnapshotId: (fundId: string) => `fund:latest-snapshot:${fundId}`,
  quote: (nseSymbol: string) => `quote:${nseSymbol}`,
  analytics: (snapshotId: string) => `analytics:${snapshotId}`,
  sectorAllocation: (snapshotId: string) => `sector-alloc:${snapshotId}`,
  aiInsights: (snapshotId: string, bucket: string) => `ai:insights:${snapshotId}:${bucket}`,
} as const;

export const CacheTtl = {
  /** Reference data changes at most daily. */
  FUND_SEARCH: 300,
  FUND_DETAIL: 900,
  /** Disclosures are immutable once published — cache hard. */
  SNAPSHOT_HOLDINGS: 21_600,
  LATEST_SNAPSHOT_ID: 3_600,
  /** Must stay below PRICE_STALE_AFTER_SECONDS. */
  QUOTE: 45,
  ANALYTICS: 60,
  SECTOR_ALLOCATION: 60,
  AI_INSIGHTS: 600,
} as const;

/** IST trading window for NSE/BSE equity cash segment. */
export const MARKET_HOURS_IST = {
  timezone: 'Asia/Kolkata',
  preOpenStart: { hour: 9, minute: 0 },
  open: { hour: 9, minute: 15 },
  close: { hour: 15, minute: 30 },
  /** 0 = Sunday. Exchange holidays are handled by MarketCalendarService. */
  tradingDays: [1, 2, 3, 4, 5] as const,
} as const;

export const QUEUE_NAMES = {
  SCHEME_MASTER_SYNC: 'scheme-master-sync',
  DISCLOSURE_SYNC: 'disclosure-sync',
  PRICE_REFRESH: 'price-refresh',
  STOCK_METADATA_SYNC: 'stock-metadata-sync',
  ALERT_EVALUATION: 'alert-evaluation',
} as const;

/** Weight below which a holding is treated as noise in narrative summaries. */
export const NEGLIGIBLE_WEIGHT_PCT = 0.05;

/** Herfindahl thresholds used to label concentration in insights. */
export const HHI_THRESHOLDS = { DIFFUSE: 500, MODERATE: 1000, CONCENTRATED: 1800 } as const;
