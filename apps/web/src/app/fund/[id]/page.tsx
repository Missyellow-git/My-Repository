'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { api, ApiError } from '@/lib/api';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Select,
  Skeleton,
} from '@/components/ui';
import { AiAssistant } from '@/components/dashboard/ai-assistant';
import {
  ConcentrationPanel,
  MoversPanel,
  SectorChart,
  StatCards,
} from '@/components/dashboard/analytics-panels';
import { DataStatusBar } from '@/components/dashboard/data-status-bar';
import { HoldingsTable } from '@/components/dashboard/holdings-table';
import { InsightsPanel } from '@/components/dashboard/insights-panel';
import {
  useAnalytics,
  useDisclosurePeriods,
  useFund,
  useHoldings,
  useInsights,
  useRefreshInterval,
} from '@/hooks/use-fund-data';
import { formatCurrency, formatDate } from '@/lib/utils';

export default function FundDashboardPage({ params }: { params: { id: string } }) {
  const fundId = params.id;
  const queryClient = useQueryClient();

  const [date, setDate] = React.useState('latest');
  const [includeNonEquity, setIncludeNonEquity] = React.useState(false);
  const [highlightSymbols, setHighlightSymbols] = React.useState<string[]>([]);

  const { seconds, setSeconds, paused, setPaused, effectiveMs } = useRefreshInterval();

  const fund = useFund(fundId);
  const periods = useDisclosurePeriods(fundId);
  const holdings = useHoldings(fundId, date, { includeNonEquity, refetchInterval: effectiveMs });
  const analytics = useAnalytics(fundId, date, effectiveMs);
  const insights = useInsights(fundId, date, holdings.isSuccess);

  const refreshNow = () => {
    void queryClient.invalidateQueries({ queryKey: ['holdings', fundId] });
    void queryClient.invalidateQueries({ queryKey: ['analytics', fundId] });
  };

  if (fund.isError || holdings.isError) {
    return <ErrorState error={(fund.error ?? holdings.error) as ApiError} />;
  }

  return (
    <div className="container space-y-5 py-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/">
            <ArrowLeft className="h-3.5 w-3.5" /> Search another scheme
          </Link>
        </Button>

        {fund.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : (
          fund.data && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">{fund.data.name}</h1>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{fund.data.amcName}</span>
                  {fund.data.subCategory && (
                    <Badge variant="secondary">{fund.data.subCategory}</Badge>
                  )}
                  {fund.data.latestNav !== null && (
                    <span className="tabular">
                      NAV {formatCurrency(fund.data.latestNav)} ·{' '}
                      {formatDate(fund.data.latestNavDate)}
                    </span>
                  )}
                  {fund.data.benchmark && <span>vs {fund.data.benchmark}</span>}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Select
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  aria-label="Disclosure period"
                  className="h-9"
                >
                  <option value="latest">Latest disclosure</option>
                  {(periods.data?.items ?? []).slice(1).map((period) => (
                    <option key={period.snapshotId} value={period.disclosureDate}>
                      {formatDate(period.disclosureDate)}
                    </option>
                  ))}
                </Select>

                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={includeNonEquity}
                    onChange={(e) => setIncludeNonEquity(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-input"
                  />
                  Show debt &amp; cash
                </label>
              </div>
            </div>
          )
        )}
      </div>

      {date !== 'latest' && (
        <Alert variant="info">
          <AlertDescription>
            Viewing the {formatDate(date)} disclosure. Live prices are not applied to historical
            periods — pairing today&apos;s price with a six-month-old weight would be misleading.
          </AlertDescription>
        </Alert>
      )}

      {holdings.isLoading && !holdings.data ? (
        <LoadingState />
      ) : (
        holdings.data && (
          <>
            <DataStatusBar
              data={holdings.data}
              isFetching={holdings.isFetching}
              refreshSeconds={seconds}
              onRefreshSecondsChange={setSeconds}
              paused={paused}
              onPausedChange={setPaused}
              onRefreshNow={refreshNow}
              exportUrl={(format) => api.exportUrl(fundId, format, date)}
            />

            {analytics.data && <StatCards analytics={analytics.data} />}

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                {analytics.data && <SectorChart analytics={analytics.data} />}
                {analytics.data && <MoversPanel analytics={analytics.data} />}
              </div>
              <div className="space-y-4">
                {analytics.data && <ConcentrationPanel analytics={analytics.data} />}
                <InsightsPanel insights={insights.data} isLoading={insights.isLoading} />
              </div>
            </div>

            <AiAssistant fundId={fundId} date={date} onHighlight={setHighlightSymbols} />

            <Card>
              <CardContent className="p-4">
                <HoldingsTable
                  holdings={holdings.data.holdings}
                  highlightSymbols={highlightSymbols}
                />
              </CardContent>
            </Card>

            {holdings.data.unmappedInstruments.length > 0 && (
              <Alert variant="warning">
                <AlertTitle>Some disclosed instruments could not be matched</AlertTitle>
                <AlertDescription>
                  <p className="mb-1">
                    These lines appear in the disclosure but were not matched to a listed security,
                    so they have no price, sector or market cap. Their weight is still counted in
                    the totals above.
                  </p>
                  <p className="text-xs">{holdings.data.unmappedInstruments.join(' · ')}</p>
                </AlertDescription>
              </Alert>
            )}
          </>
        )
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-14 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function ErrorState({ error }: { error: ApiError }) {
  // Two failures dominate here and need different words: a scheme that exists
  // but has no disclosure yet, and a scheme id that does not resolve at all.
  const isMissingDisclosure = error?.code === 'DISCLOSURE_NOT_FOUND';

  return (
    <div className="container py-16">
      <Alert variant={isMissingDisclosure ? 'warning' : 'danger'} className="mx-auto max-w-2xl">
        <AlertTitle>
          {isMissingDisclosure ? 'No portfolio disclosure yet' : 'Could not load this scheme'}
        </AlertTitle>
        <AlertDescription>
          <p>{error?.message ?? 'Something went wrong.'}</p>
          {error?.requestId && (
            <p className="mt-2 text-xs">
              Reference: <code className="tabular">{error.requestId}</code>
            </p>
          )}
          <Button variant="outline" size="sm" asChild className="mt-3">
            <Link href="/">Search for another scheme</Link>
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
