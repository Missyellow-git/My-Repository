'use client';

import { Download, Pause, Play, RefreshCw } from 'lucide-react';
import * as React from 'react';
import type { HoldingsResponse } from '@fundlens/shared';
import { Badge, Button, Select } from '@/components/ui';
import { cn, formatDate, relativeTime } from '@/lib/utils';

interface Props {
  data: HoldingsResponse;
  isFetching: boolean;
  refreshSeconds: number;
  onRefreshSecondsChange: (seconds: number) => void;
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  onRefreshNow: () => void;
  exportUrl: (format: 'csv' | 'xlsx') => string;
}

/**
 * The provenance strip that sits above the table.
 *
 * This is the most important non-obvious component in the UI. The product joins
 * month-old disclosed weights to live prices, and a user who does not see that
 * distinction will misread everything below it. So the disclosure date, its
 * staleness, price coverage and the refresh cadence are stated permanently and
 * prominently — not behind a tooltip.
 */
export function DataStatusBar({
  data,
  isFetching,
  refreshSeconds,
  onRefreshSecondsChange,
  paused,
  onPausedChange,
  onRefreshNow,
  exportUrl,
}: Props) {
  const { snapshot, priceCoverage } = data;
  const missingPrices = priceCoverage.requested - priceCoverage.withQuote;

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={snapshot.stale ? 'warning' : 'secondary'}>
          Holdings as disclosed {formatDate(snapshot.disclosureDate)}
        </Badge>

        {snapshot.stale && (
          <span className="text-amber-700 dark:text-amber-400">
            Past the freshness threshold — positions may have changed since.
          </span>
        )}

        <span className="text-muted-foreground">
          {priceCoverage.withQuote}/{priceCoverage.requested} priced
          {missingPrices > 0 && ` · ${missingPrices} without a quote`}
          {priceCoverage.stale > 0 && ` · ${priceCoverage.stale} stale`}
        </span>

        {data.unmappedInstruments.length > 0 && (
          <Badge variant="warning" title={data.unmappedInstruments.slice(0, 20).join(', ')}>
            {data.unmappedInstruments.length} unmapped
          </Badge>
        )}

        <span className="text-muted-foreground">Prices {relativeTime(data.generatedAt)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(refreshSeconds)}
          onChange={(e) => onRefreshSecondsChange(Number(e.target.value))}
          aria-label="Price refresh interval"
          className="h-8 text-xs"
        >
          <option value="30">Every 30s</option>
          <option value="60">Every 60s</option>
          <option value="120">Every 2m</option>
          <option value="300">Every 5m</option>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onPausedChange(!paused)}
          aria-label={paused ? 'Resume automatic refresh' : 'Pause automatic refresh'}
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{paused ? 'Resume' : 'Pause'}</span>
        </Button>

        <Button variant="outline" size="sm" onClick={onRefreshNow} disabled={isFetching}>
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>

        <Button variant="outline" size="sm" asChild>
          <a href={exportUrl('csv')} download>
            <Download className="h-3.5 w-3.5" />
            CSV
          </a>
        </Button>

        <Button variant="outline" size="sm" asChild>
          <a href={exportUrl('xlsx')} download>
            <Download className="h-3.5 w-3.5" />
            Excel
          </a>
        </Button>
      </div>
    </div>
  );
}
