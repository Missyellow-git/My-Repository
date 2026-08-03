'use client';

import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react';
import * as React from 'react';
import { InstrumentType, PriceQuality, type HoldingRow } from '@fundlens/shared';
import {
  Badge,
  Button,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import {
  changeClass,
  cn,
  formatCurrency,
  formatMarketCap,
  formatNumber,
  formatPercent,
  formatTime,
} from '@/lib/utils';

type SortKey =
  'rank' | 'instrumentName' | 'sector' | 'weightPct' | 'ltp' | 'changePct' | 'marketCapCrore';

interface Props {
  holdings: HoldingRow[];
  /** Highlighted by the AI assistant when it answers with a filter. */
  highlightSymbols?: string[];
}

/**
 * The holdings table.
 *
 * Sorting, filtering and search are all client-side. That is a deliberate
 * choice, not a shortcut: a disclosed portfolio is at most a few hundred rows
 * and the whole set is already in memory for the analytics panels, so a round
 * trip per sort would add latency and load for no benefit. If schemes with
 * thousands of lines ever appear, the sort/filter state is already shaped to
 * move server-side without changing the component's contract.
 */
export function HoldingsTable({ holdings, highlightSymbols = [] }: Props) {
  const [search, setSearch] = React.useState('');
  const [sector, setSector] = React.useState('all');
  const [capCategory, setCapCategory] = React.useState('all');
  const [movement, setMovement] = React.useState('all');
  const [sortKey, setSortKey] = React.useState<SortKey>('weightPct');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');

  const highlighted = React.useMemo(
    () => new Set(highlightSymbols.filter(Boolean)),
    [highlightSymbols],
  );

  const sectors = React.useMemo(() => {
    const set = new Set<string>();
    for (const h of holdings) if (h.stock?.sector) set.add(h.stock.sector);
    return [...set].sort();
  }, [holdings]);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();

    const rows = holdings.filter((h) => {
      if (term) {
        const haystack = [
          h.stock?.name ?? h.instrumentName,
          h.stock?.nseSymbol,
          h.stock?.bseCode,
          h.isin,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (sector !== 'all' && h.stock?.sector !== sector) return false;
      if (capCategory !== 'all' && h.stock?.marketCapCategory !== capCategory) return false;

      if (movement !== 'all') {
        const change = h.quote?.changePct;
        // A holding with no quote is excluded from movement filters entirely —
        // it is unknown, not flat.
        if (change === null || change === undefined) return false;
        if (movement === 'gainers' && change <= 0) return false;
        if (movement === 'losers' && change >= 0) return false;
        if (movement === 'big-movers' && Math.abs(change) < 2) return false;
      }
      return true;
    });

    const direction = sortDir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      // Unknown values sort last regardless of direction.
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
      return String(av).localeCompare(String(bv), 'en') * direction;
    });
  }, [holdings, search, sector, capCategory, movement, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Text sorts read better ascending; numbers read better descending.
      setSortDir(key === 'instrumentName' || key === 'sector' ? 'asc' : 'desc');
    }
  };

  const clearFilters = () => {
    setSearch('');
    setSector('all');
    setCapCategory('all');
    setMovement('all');
  };

  const filtersActive =
    search !== '' || sector !== 'all' || capCategory !== 'all' || movement !== 'all';
  const shownWeight = filtered.reduce((sum, h) => sum + h.weightPct, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-[14rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a stock in this portfolio"
            className="h-9 pl-9"
            aria-label="Search holdings"
          />
        </div>

        <Select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          aria-label="Filter by sector"
        >
          <option value="all">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        <Select
          value={capCategory}
          onChange={(e) => setCapCategory(e.target.value)}
          aria-label="Filter by market cap"
        >
          <option value="all">All market caps</option>
          <option value="LARGE_CAP">Large cap</option>
          <option value="MID_CAP">Mid cap</option>
          <option value="SMALL_CAP">Small cap</option>
          <option value="UNCLASSIFIED">Unclassified</option>
        </Select>

        <Select
          value={movement}
          onChange={(e) => setMovement(e.target.value)}
          aria-label="Filter by today's movement"
        >
          <option value="all">Any movement</option>
          <option value="gainers">Gainers only</option>
          <option value="losers">Losers only</option>
          <option value="big-movers">Moved over 2%</option>
        </Select>

        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Showing <span className="tabular font-medium text-foreground">{filtered.length}</span> of{' '}
        {holdings.length} holdings
        {filtersActive && (
          <>
            {' '}
            · <span className="tabular">{formatPercent(shownWeight)}</span> of net assets
          </>
        )}
      </p>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHead
                label="#"
                k="rank"
                {...{ sortKey, sortDir, toggleSort }}
                className="w-12"
              />
              <SortableHead
                label="Stock"
                k="instrumentName"
                {...{ sortKey, sortDir, toggleSort }}
              />
              <TableHead className="hidden md:table-cell">Symbols</TableHead>
              <SortableHead
                label="Sector"
                k="sector"
                {...{ sortKey, sortDir, toggleSort }}
                className="hidden lg:table-cell"
              />
              <SortableHead
                label="Weight"
                k="weightPct"
                {...{ sortKey, sortDir, toggleSort }}
                align="right"
              />
              <SortableHead
                label="Price"
                k="ltp"
                {...{ sortKey, sortDir, toggleSort }}
                align="right"
              />
              <SortableHead
                label="Change"
                k="changePct"
                {...{ sortKey, sortDir, toggleSort }}
                align="right"
              />
              <SortableHead
                label="Market cap"
                k="marketCapCrore"
                {...{ sortKey, sortDir, toggleSort }}
                align="right"
                className="hidden lg:table-cell"
              />
              <TableHead className="hidden xl:table-cell text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  No holdings match these filters.
                </TableCell>
              </TableRow>
            )}

            {filtered.map((holding) => (
              <HoldingTableRow
                key={holding.id}
                holding={holding}
                highlighted={
                  holding.stock?.nseSymbol ? highlighted.has(holding.stock.nseSymbol) : false
                }
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function HoldingTableRow({ holding, highlighted }: { holding: HoldingRow; highlighted: boolean }) {
  const quote = holding.quote;
  const change = quote?.changePct ?? null;

  return (
    <TableRow className={cn(highlighted && 'bg-primary/5')}>
      <TableCell className="tabular text-xs text-muted-foreground">{holding.rank}</TableCell>

      <TableCell>
        <div className="font-medium leading-tight">
          {holding.stock?.name ?? holding.instrumentName}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 md:hidden">
          {holding.stock?.nseSymbol && (
            <span className="text-xs text-muted-foreground">{holding.stock.nseSymbol}</span>
          )}
          {holding.stock?.sector && (
            <span className="text-xs text-muted-foreground">· {holding.stock.sector}</span>
          )}
        </div>
        {!holding.mapped && (
          // Unmapped lines are shown, not hidden. Their weight is real even
          // when we cannot price them.
          <Badge variant="warning" className="mt-1">
            {holding.instrumentType === InstrumentType.EQUITY
              ? 'Unmapped'
              : label(holding.instrumentType)}
          </Badge>
        )}
      </TableCell>

      <TableCell className="hidden md:table-cell">
        <div className="flex flex-col gap-0.5 text-xs">
          {holding.stock?.nseSymbol && (
            <span className="font-medium">{holding.stock.nseSymbol}</span>
          )}
          {holding.stock?.bseCode && (
            <span className="text-muted-foreground">BSE {holding.stock.bseCode}</span>
          )}
          {!holding.stock?.nseSymbol && !holding.stock?.bseCode && (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      </TableCell>

      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
        {holding.stock?.sector ?? '—'}
      </TableCell>

      <TableCell className="tabular text-right font-medium">
        {formatPercent(holding.weightPct)}
      </TableCell>

      <TableCell className="tabular text-right">
        {quote?.ltp !== null && quote?.ltp !== undefined ? formatCurrency(quote.ltp) : '—'}
      </TableCell>

      <TableCell className={cn('tabular text-right font-medium', changeClass(change))}>
        {change === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="inline-flex items-center justify-end gap-1">
            {/* An arrow as well as colour, so direction survives colour blindness. */}
            {change > 0 ? (
              <ArrowUp className="h-3 w-3" aria-hidden />
            ) : change < 0 ? (
              <ArrowDown className="h-3 w-3" aria-hidden />
            ) : null}
            {formatPercent(change, 2, true)}
          </span>
        )}
      </TableCell>

      <TableCell className="hidden lg:table-cell tabular text-right text-sm">
        {formatMarketCap(holding.stock?.marketCapCrore)}
      </TableCell>

      <TableCell className="hidden xl:table-cell text-right">
        <PriceQualityBadge quality={quote?.quality} quotedAt={quote?.quotedAt} />
      </TableCell>
    </TableRow>
  );
}

function PriceQualityBadge({
  quality,
  quotedAt,
}: {
  quality?: PriceQuality;
  quotedAt?: string | null;
}) {
  if (!quality || quality === PriceQuality.UNAVAILABLE) {
    return <span className="text-xs text-muted-foreground">no quote</span>;
  }
  if (quality === PriceQuality.LIVE) {
    return <span className="tabular text-xs text-muted-foreground">{formatTime(quotedAt)}</span>;
  }
  const variant = quality === PriceQuality.STALE ? 'danger' : 'secondary';
  return (
    <Badge variant={variant} className="text-[10px]">
      {quality === PriceQuality.MARKET_CLOSED ? 'closed' : quality.toLowerCase()}
    </Badge>
  );
}

function SortableHead({
  label,
  k,
  sortKey,
  sortDir,
  toggleSort,
  align = 'left',
  className,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  toggleSort: (k: SortKey) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  const active = sortKey === k;
  return (
    <TableHead className={cn(align === 'right' && 'text-right', className)}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground',
          active && 'text-foreground',
        )}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        {active ? (
          sortDir === 'asc' ? (
            <ArrowUp className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />
        )}
      </button>
    </TableHead>
  );
}

function sortValue(holding: HoldingRow, key: SortKey): string | number | null {
  switch (key) {
    case 'rank':
      return holding.rank;
    case 'instrumentName':
      return holding.stock?.name ?? holding.instrumentName;
    case 'sector':
      return holding.stock?.sector ?? null;
    case 'weightPct':
      return holding.weightPct;
    case 'ltp':
      return holding.quote?.ltp ?? null;
    case 'changePct':
      return holding.quote?.changePct ?? null;
    case 'marketCapCrore':
      return holding.stock?.marketCapCrore ?? null;
    default:
      return null;
  }
}

function label(instrumentType: string): string {
  return instrumentType
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
