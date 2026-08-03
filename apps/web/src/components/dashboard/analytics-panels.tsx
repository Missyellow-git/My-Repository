'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import * as React from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { HHI_THRESHOLDS, type MoverRow, type PortfolioAnalytics } from '@fundlens/shared';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';
import { changeClass, chartColor, cn, formatCurrency, formatPercent } from '@/lib/utils';

/** Headline figures. Each tile states what it measures, not just a number. */
export function StatCards({ analytics }: { analytics: PortfolioAnalytics }) {
  const tiles = [
    {
      label: 'Equity holdings',
      value: String(analytics.totalStocks),
      detail: `${formatPercent(analytics.totalEquityWeightPct)} of net assets`,
    },
    {
      label: 'Top 10 concentration',
      value: formatPercent(analytics.top10WeightPct),
      detail: `HHI ${analytics.concentrationHhi} · ${describeHhi(analytics.concentrationHhi)}`,
    },
    {
      label: 'Weighted move today',
      value:
        analytics.weightedAverageChangePct === null
          ? '—'
          : formatPercent(analytics.weightedAverageChangePct, 2, true),
      detail: 'Each holding scaled by its disclosed weight',
      tone: analytics.weightedAverageChangePct,
    },
    {
      label: 'Breadth',
      value: `${analytics.advancers} / ${analytics.decliners}`,
      detail: `up / down · ${analytics.unchanged} flat`,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label}>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {tile.label}
            </p>
            <p
              className={cn(
                'tabular mt-1.5 text-2xl font-semibold',
                tile.tone !== undefined && changeClass(tile.tone),
              )}
            >
              {tile.value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{tile.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Sector allocation donut.
 *
 * Slices below 2% are folded into "Other": a dozen 0.3% wedges are unreadable
 * and their labels collide. The full breakdown remains available in the legend
 * list beside the chart, so nothing is actually hidden.
 */
export function SectorChart({ analytics }: { analytics: PortfolioAnalytics }) {
  const { slices, rest } = React.useMemo(() => {
    const sorted = [...analytics.sectorAllocation].sort((a, b) => b.weightPct - a.weightPct);
    const major = sorted.filter((s) => s.weightPct >= 2);
    const minor = sorted.filter((s) => s.weightPct < 2);
    const otherWeight = minor.reduce((sum, s) => sum + s.weightPct, 0);

    return {
      slices: [
        ...major.map((s) => ({ name: s.sector, value: s.weightPct })),
        ...(otherWeight > 0
          ? [
              {
                name: `Other (${minor.length} sectors)`,
                value: Math.round(otherWeight * 100) / 100,
              },
            ]
          : []),
      ],
      rest: sorted,
    };
  }, [analytics.sectorAllocation]);

  if (slices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sector allocation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No sector data for this disclosure.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sector allocation</CardTitle>
        <CardDescription>
          Share of net assets, with each sector&apos;s weighted move today
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={1}
                strokeWidth={0}
              >
                {slices.map((slice, index) => (
                  <Cell key={slice.name} fill={chartColor(index)} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [formatPercent(value), name]}
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '0.5rem',
                  fontSize: '0.8rem',
                }}
              />
              <Legend
                verticalAlign="bottom"
                height={24}
                formatter={(value: string) => (
                  <span className="text-xs text-muted-foreground">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {rest.map((sector, index) => (
            <li key={sector.sector} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: chartColor(index) }}
                aria-hidden
              />
              <span className="flex-1 truncate">{sector.sector}</span>
              <span className="tabular text-xs text-muted-foreground">{sector.stockCount}</span>
              <span className="tabular w-14 text-right font-medium">
                {formatPercent(sector.weightPct)}
              </span>
              <span
                className={cn(
                  'tabular w-16 text-right text-xs',
                  changeClass(sector.weightedChangePct),
                )}
              >
                {sector.weightedChangePct === null
                  ? '—'
                  : formatPercent(sector.weightedChangePct, 2, true)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function MoversPanel({ analytics }: { analytics: PortfolioAnalytics }) {
  if (analytics.priceCoverage.withQuote === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s movers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No live prices are available for this portfolio right now, so gainers and losers cannot
            be shown. Holdings and weights below are unaffected.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <MoverList title="Top gainers" rows={analytics.topGainers} direction="up" />
      <MoverList title="Top losers" rows={analytics.topLosers} direction="down" />
    </div>
  );
}

function MoverList({
  title,
  rows,
  direction,
}: {
  title: string;
  rows: MoverRow[];
  direction: 'up' | 'down';
}) {
  const Icon = direction === 'up' ? ArrowUp : ArrowDown;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon
            className={cn('h-4 w-4', direction === 'up' ? 'text-gain' : 'text-loss')}
            aria-hidden
          />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing to show.</p>}
        {rows.map((row) => (
          <div
            key={`${row.stockName}-${row.nseSymbol}`}
            className="flex items-baseline gap-2 text-sm"
          >
            <span className="flex-1 truncate">{row.stockName}</span>
            <span className="tabular text-xs text-muted-foreground">
              {formatPercent(row.weightPct)}
            </span>
            <span className="tabular w-20 text-right text-muted-foreground">
              {formatCurrency(row.ltp)}
            </span>
            <span className={cn('tabular w-16 text-right font-medium', changeClass(row.changePct))}>
              {formatPercent(row.changePct, 2, true)}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ConcentrationPanel({ analytics }: { analytics: PortfolioAnalytics }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Concentration &amp; market cap</CardTitle>
        <CardDescription>
          Largest position {analytics.highestWeighted?.stockName ?? '—'} at{' '}
          {formatPercent(analytics.highestWeighted?.weightPct ?? null)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          {analytics.marketCapAllocation.map((bucket) => (
            <div key={bucket.category} className="space-y-1">
              <div className="flex items-baseline justify-between text-sm">
                <span>{capLabel(bucket.category)}</span>
                <span className="tabular text-xs text-muted-foreground">
                  {bucket.stockCount} · {formatPercent(bucket.weightPct)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  // Scaled against equity weight, not 100, so the bars fill the
                  // sleeve they actually describe.
                  style={{
                    width: `${Math.min(100, (bucket.weightPct / Math.max(analytics.totalEquityWeightPct, 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="secondary">Top 10: {formatPercent(analytics.top10WeightPct)}</Badge>
          <Badge variant="secondary">HHI {analytics.concentrationHhi}</Badge>
          <Badge variant="outline">{describeHhi(analytics.concentrationHhi)}</Badge>
          {analytics.nonEquityWeightPct > 0 && (
            <Badge variant="outline">
              Non-equity {formatPercent(analytics.nonEquityWeightPct)}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function describeHhi(hhi: number): string {
  if (hhi < HHI_THRESHOLDS.DIFFUSE) return 'Widely diversified';
  if (hhi < HHI_THRESHOLDS.MODERATE) return 'Moderately diversified';
  if (hhi < HHI_THRESHOLDS.CONCENTRATED) return 'Moderately concentrated';
  return 'Highly concentrated';
}

function capLabel(category: string): string {
  switch (category) {
    case 'LARGE_CAP':
      return 'Large cap';
    case 'MID_CAP':
      return 'Mid cap';
    case 'SMALL_CAP':
      return 'Small cap';
    default:
      return 'Unclassified';
  }
}
