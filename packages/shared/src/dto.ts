import { z } from 'zod';
import { FundCategory } from './enums';

/**
 * Request contracts. The API validates every inbound payload against these
 * schemas via a global Zod pipe; the web client imports the inferred types so a
 * contract change breaks the build on both sides.
 */

export const fundSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Search needs at least 2 characters').max(120),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  category: z.nativeEnum(FundCategory).optional(),
  /** Direct plans only, regular only, or both when omitted. */
  planType: z.enum(['DIRECT', 'REGULAR']).optional(),
  /** Excludes schemes with no equity disclosure on file. */
  withHoldingsOnly: z.coerce.boolean().default(false),
});
export type FundSearchQuery = z.infer<typeof fundSearchQuerySchema>;

export const holdingsQuerySchema = z.object({
  /** `latest` or an ISO date matching a disclosure period. */
  date: z.string().default('latest'),
  includeNonEquity: z.coerce.boolean().default(false),
  includeUnmapped: z.coerce.boolean().default(true),
  withPrices: z.coerce.boolean().default(true),
});
export type HoldingsQuery = z.infer<typeof holdingsQuerySchema>;

export const pricesQuerySchema = z.object({
  /** Comma-separated NSE symbols, max 200 per request. */
  symbols: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
    )
    .refine((arr) => arr.length > 0 && arr.length <= 200, {
      message: 'Provide between 1 and 200 symbols',
    }),
});
export type PricesQuery = z.infer<typeof pricesQuerySchema>;

export const exportQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  date: z.string().default('latest'),
  includeNonEquity: z.coerce.boolean().default(true),
  withPrices: z.coerce.boolean().default(true),
});
export type ExportQuery = z.infer<typeof exportQuerySchema>;

export const compareQuerySchema = z
  .object({
    /** Period-over-period comparison for one fund. */
    from: z.string().optional(),
    to: z.string().default('latest'),
    /** Cross-fund overlap. Mutually exclusive with `from`. */
    againstFundId: z.string().uuid().optional(),
  })
  .refine((v) => !(v.from && v.againstFundId), {
    message: 'Use either `from` (period comparison) or `againstFundId` (overlap), not both',
  });
export type CompareQuery = z.infer<typeof compareQuerySchema>;

export const aiQuerySchema = z.object({
  fundId: z.string().uuid(),
  question: z.string().trim().min(3).max(500),
  date: z.string().default('latest'),
  /** Skips the LLM and uses the deterministic parser only. */
  deterministicOnly: z.boolean().default(false),
});
export type AiQueryInput = z.infer<typeof aiQuerySchema>;

export const aiInsightsQuerySchema = z.object({
  fundId: z.string().uuid(),
  date: z.string().default('latest'),
});
export type AiInsightsQuery = z.infer<typeof aiInsightsQuerySchema>;

const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');

export const registerSchema = z.object({
  email: z.string().email().max(254).toLowerCase(),
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(254).toLowerCase(),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20) });

export const favoriteSchema = z.object({ fundId: z.string().uuid() });

export const watchlistCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  stockIds: z.array(z.string().uuid()).max(200).default([]),
});
export type WatchlistCreateInput = z.infer<typeof watchlistCreateSchema>;

export const alertCreateSchema = z
  .object({
    type: z.enum(['HOLDINGS_CHANGED', 'NEW_DISCLOSURE', 'STOCK_MOVE', 'WEIGHT_THRESHOLD']),
    channel: z.enum(['EMAIL', 'IN_APP', 'WEBHOOK']).default('IN_APP'),
    fundId: z.string().uuid().optional(),
    stockId: z.string().uuid().optional(),
    thresholdPct: z.number().min(0).max(100).optional(),
  })
  .refine((v) => v.fundId || v.stockId, {
    message: 'An alert must reference a fund or a stock',
  })
  .refine((v) => !['STOCK_MOVE', 'WEIGHT_THRESHOLD'].includes(v.type) || v.thresholdPct != null, {
    message: 'thresholdPct is required for STOCK_MOVE and WEIGHT_THRESHOLD alerts',
  });
export type AlertCreateInput = z.infer<typeof alertCreateSchema>;

export const preferencesSchema = z.object({
  priceRefreshSeconds: z.number().int().min(15).max(900).optional(),
  defaultFundId: z.string().uuid().nullable().optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  emailNotifications: z.boolean().optional(),
});
export type PreferencesInput = z.infer<typeof preferencesSchema>;

/** Uniform error body returned by the global exception filter. */
export interface ApiErrorBody {
  statusCode: number;
  /** Stable, machine-readable code — see docs/API.md#error-codes. */
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
  timestamp: string;
  path: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
