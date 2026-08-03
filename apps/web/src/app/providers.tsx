'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

/**
 * React Query configuration.
 *
 * Defaults are tuned for market data rather than for a CRUD app:
 *  - `staleTime` of 0 for price-bearing queries would refetch on every focus
 *    change, so individual hooks set their own; the global default is
 *    conservative and per-query intervals do the real work.
 *  - failed reads are retried twice with backoff, but 4xx responses are not
 *    retried at all — a 404 for a fund with no disclosure will never become a
 *    200, and retrying it just delays the empty state.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              const status = (error as { status?: number }).status ?? 0;
              if (status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
