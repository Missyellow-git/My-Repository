import type {
  AiInsightsResponse,
  AiQueryResponse,
  ApiErrorBody,
  ComparisonResult,
  FundDetail,
  FundSummary,
  HoldingsResponse,
  OverlapResult,
  PortfolioAnalytics,
  SectorAllocation,
} from '@fundlens/shared';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

/**
 * Typed API client.
 *
 * Response types are imported from @fundlens/shared, the same package the
 * NestJS controllers return — a breaking change to a payload fails the web
 * build rather than surfacing as `undefined` in a table cell at runtime.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends RequestInit {
  /** Aborts the request after this many ms. */
  timeoutMs?: number;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 15_000, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
        ...authHeader(),
      },
    });

    if (!response.ok) {
      // The API always returns a structured error body; fall back only if the
      // failure happened before our handler ran (proxy 502, for example).
      const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(
        response.status,
        body?.code ?? 'UNKNOWN',
        body?.message ?? `Request failed with status ${response.status}`,
        body?.details,
        body?.requestId,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new ApiError(504, 'TIMEOUT', 'The request took too long. Please try again.');
    }
    throw new ApiError(0, 'NETWORK', 'Could not reach the FundLens API. Check your connection.');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Token storage.
 *
 * localStorage is a deliberate, documented trade-off for this build: accounts
 * are optional and hold only favourites and watchlists, and the app is a pure
 * SPA against a cross-origin API. A deployment that adds anything sensitive to
 * an account should move to httpOnly, SameSite cookies with a same-site API
 * origin — see docs/ARCHITECTURE.md#authentication.
 */
const TOKEN_KEY = 'fundlens.accessToken';

export function setAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

function authHeader(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export const api = {
  searchFunds: (q: string, options: { limit?: number; withHoldingsOnly?: boolean } = {}) =>
    request<{ items: FundSummary[]; total: number; query: string }>(
      `/funds/search${qs({ q, limit: options.limit ?? 20, withHoldingsOnly: options.withHoldingsOnly })}`,
    ),

  getFund: (id: string) => request<FundDetail>(`/funds/${id}`),

  getPeriods: (id: string) =>
    request<{
      items: Array<{
        snapshotId: string;
        disclosureDate: string;
        holdingsCount: number;
        equityCount: number;
        totalEquityWeightPct: number;
        importedAt: string;
        source: string;
      }>;
      total: number;
    }>(`/funds/${id}/periods`),

  getHoldings: (
    id: string,
    options: { date?: string; includeNonEquity?: boolean; withPrices?: boolean } = {},
  ) =>
    request<HoldingsResponse>(
      `/funds/${id}/holdings${qs({
        date: options.date ?? 'latest',
        includeNonEquity: options.includeNonEquity ?? false,
        withPrices: options.withPrices ?? true,
      })}`,
    ),

  getAnalytics: (id: string, date = 'latest') =>
    request<PortfolioAnalytics>(`/funds/${id}/analytics${qs({ date })}`),

  getSectorAllocation: (id: string, date = 'latest') =>
    request<{ items: SectorAllocation[] }>(`/funds/${id}/sector-allocation${qs({ date })}`),

  comparePeriods: (id: string, from: string, to = 'latest') =>
    request<ComparisonResult>(`/funds/${id}/compare${qs({ from, to })}`),

  compareFunds: (id: string, againstFundId: string) =>
    request<OverlapResult>(`/funds/${id}/compare${qs({ againstFundId })}`),

  askAi: (fundId: string, question: string, date = 'latest') =>
    request<AiQueryResponse>('/ai/query', {
      method: 'POST',
      body: JSON.stringify({ fundId, question, date }),
      // Model calls are slower than data reads; a 15s cap would cut off a
      // legitimately slow answer.
      timeoutMs: 30_000,
    }),

  getInsights: (fundId: string, date = 'latest') =>
    request<AiInsightsResponse>(`/ai/insights${qs({ fundId, date })}`),

  getAiCapabilities: () =>
    request<{ llmEnabled: boolean; exampleQuestions: string[]; disclaimer: string }>(
      '/ai/capabilities',
    ),

  /** Export is a file download, so it bypasses the JSON client entirely. */
  exportUrl: (id: string, format: 'csv' | 'xlsx', date = 'latest') =>
    `${BASE_URL}/funds/${id}/export${qs({ format, date })}`,

  login: (email: string, password: string) =>
    request<{ user: { id: string; email: string }; accessToken: string; refreshToken: string }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    ),

  register: (email: string, password: string, displayName?: string) =>
    request<{ user: { id: string; email: string }; accessToken: string; refreshToken: string }>(
      '/auth/register',
      { method: 'POST', body: JSON.stringify({ email, password, displayName }) },
    ),

  listFavorites: () =>
    request<Array<{ id: string; addedAt: string; fund: FundSummary }>>('/me/favorites'),

  addFavorite: (fundId: string) =>
    request<{ id: string }>('/me/favorites', { method: 'POST', body: JSON.stringify({ fundId }) }),

  removeFavorite: (fundId: string) =>
    request<void>(`/me/favorites/${fundId}`, { method: 'DELETE' }),
};
