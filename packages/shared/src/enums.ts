/**
 * Enumerations shared across the API and the web client.
 *
 * These are declared as `const` objects (plus a matching union type) rather
 * than TypeScript `enum`s so the values survive JSON serialisation and can be
 * consumed by both the NestJS backend and the Next.js frontend without any
 * runtime interop shims.
 */

export const PlanType = {
  DIRECT: 'DIRECT',
  REGULAR: 'REGULAR',
  UNKNOWN: 'UNKNOWN',
} as const;
export type PlanType = (typeof PlanType)[keyof typeof PlanType];

export const OptionType = {
  GROWTH: 'GROWTH',
  IDCW: 'IDCW',
  UNKNOWN: 'UNKNOWN',
} as const;
export type OptionType = (typeof OptionType)[keyof typeof OptionType];

/** Broad SEBI scheme categorisation used for search facets. */
export const FundCategory = {
  EQUITY: 'EQUITY',
  DEBT: 'DEBT',
  HYBRID: 'HYBRID',
  SOLUTION_ORIENTED: 'SOLUTION_ORIENTED',
  OTHER: 'OTHER',
} as const;
export type FundCategory = (typeof FundCategory)[keyof typeof FundCategory];

/** Instrument classes that can appear in a monthly portfolio disclosure. */
export const InstrumentType = {
  EQUITY: 'EQUITY',
  DEBT: 'DEBT',
  MONEY_MARKET: 'MONEY_MARKET',
  DERIVATIVE: 'DERIVATIVE',
  REIT_INVIT: 'REIT_INVIT',
  MUTUAL_FUND_UNIT: 'MUTUAL_FUND_UNIT',
  CASH: 'CASH',
  OTHER: 'OTHER',
} as const;
export type InstrumentType = (typeof InstrumentType)[keyof typeof InstrumentType];

/** SEBI market-capitalisation buckets (AMFI half-yearly classification). */
export const MarketCapCategory = {
  LARGE_CAP: 'LARGE_CAP',
  MID_CAP: 'MID_CAP',
  SMALL_CAP: 'SMALL_CAP',
  UNCLASSIFIED: 'UNCLASSIFIED',
} as const;
export type MarketCapCategory = (typeof MarketCapCategory)[keyof typeof MarketCapCategory];

export const Exchange = {
  NSE: 'NSE',
  BSE: 'BSE',
} as const;
export type Exchange = (typeof Exchange)[keyof typeof Exchange];

/** Lifecycle of an ingested portfolio disclosure. */
export const SnapshotStatus = {
  PENDING: 'PENDING',
  PARSED: 'PARSED',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
  SUPERSEDED: 'SUPERSEDED',
} as const;
export type SnapshotStatus = (typeof SnapshotStatus)[keyof typeof SnapshotStatus];

/** Why a price quote may not be trustworthy. Surfaced to the UI verbatim. */
export const PriceQuality = {
  LIVE: 'LIVE',
  DELAYED: 'DELAYED',
  STALE: 'STALE',
  MARKET_CLOSED: 'MARKET_CLOSED',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;
export type PriceQuality = (typeof PriceQuality)[keyof typeof PriceQuality];

export const AlertType = {
  HOLDINGS_CHANGED: 'HOLDINGS_CHANGED',
  NEW_DISCLOSURE: 'NEW_DISCLOSURE',
  STOCK_MOVE: 'STOCK_MOVE',
  WEIGHT_THRESHOLD: 'WEIGHT_THRESHOLD',
} as const;
export type AlertType = (typeof AlertType)[keyof typeof AlertType];

export const AlertChannel = {
  EMAIL: 'EMAIL',
  IN_APP: 'IN_APP',
  WEBHOOK: 'WEBHOOK',
} as const;
export type AlertChannel = (typeof AlertChannel)[keyof typeof AlertChannel];

export const UserRole = {
  USER: 'USER',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
