'use client';

import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { api } from '@/lib/api';

const DEFAULT_REFRESH_SECONDS = Number(process.env.NEXT_PUBLIC_PRICE_REFRESH_SECONDS ?? 60);

/**
 * Data hooks for the fund dashboard.
 *
 * Polling is deliberately conservative and gated:
 *  - it stops when the tab is hidden, so a forgotten background tab does not
 *    poll the API (and the market-data quota behind it) all day;
 *  - it stops when viewing a historical disclosure period, where nothing about
 *    the response can change;
 *  - the interval is user-adjustable, because "as fast as possible" is not
 *    universally the right answer on a metered mobile connection.
 */
export function useRefreshInterval(initialSeconds = DEFAULT_REFRESH_SECONDS) {
  const [seconds, setSeconds] = React.useState(initialSeconds);
  const [paused, setPaused] = React.useState(false);
  const [visible, setVisible] = React.useState(true);

  React.useEffect(() => {
    const onVisibilityChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // `false` (not 0) is what React Query treats as "do not poll".
  const effectiveMs: number | false = paused || !visible ? false : seconds * 1000;

  return { seconds, setSeconds, paused, setPaused, isPolling: effectiveMs !== false, effectiveMs };
}

export function useFund(fundId: string) {
  return useQuery({
    queryKey: ['fund', fundId],
    queryFn: () => api.getFund(fundId),
    staleTime: 10 * 60_000,
  });
}

export function useDisclosurePeriods(fundId: string) {
  return useQuery({
    queryKey: ['fund-periods', fundId],
    queryFn: () => api.getPeriods(fundId),
    staleTime: 10 * 60_000,
  });
}

export function useHoldings(
  fundId: string,
  date: string,
  options: { includeNonEquity: boolean; refetchInterval: number | false },
) {
  return useQuery({
    queryKey: ['holdings', fundId, date, options.includeNonEquity],
    queryFn: () => api.getHoldings(fundId, { date, includeNonEquity: options.includeNonEquity }),
    // A closed period is immutable — polling it would be pure waste.
    refetchInterval: date === 'latest' ? options.refetchInterval : false,
    // Keeping the previous page's rows on screen during a refetch avoids the
    // table collapsing to a skeleton every minute.
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useAnalytics(fundId: string, date: string, refetchInterval: number | false) {
  return useQuery({
    queryKey: ['analytics', fundId, date],
    queryFn: () => api.getAnalytics(fundId, date),
    refetchInterval: date === 'latest' ? refetchInterval : false,
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useInsights(fundId: string, date: string, enabled: boolean) {
  return useQuery({
    queryKey: ['insights', fundId, date],
    queryFn: () => api.getInsights(fundId, date),
    enabled,
    // The server caches insights in 10-minute buckets; refetching faster than
    // that just returns the same payload.
    staleTime: 5 * 60_000,
    retry: false,
  });
}
