'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { FundSummary } from '@fundlens/shared';
import { api } from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { Badge, Card, Input } from '@/components/ui';

/**
 * Scheme search box.
 *
 * The debounce is 250ms rather than the more common 500ms: search is the first
 * thing a user does and the query is a single indexed trigram lookup, so the
 * extra requests are cheap and the box feels immediate.
 *
 * Keyboard navigation is implemented rather than left to click-only — this is
 * a combobox, and users type a fund name then press Enter without reaching for
 * the mouse.
 */
export function FundSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [term, setTerm] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [highlighted, setHighlighted] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  React.useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const { data, isFetching, isError } = useQuery({
    queryKey: ['fund-search', debounced],
    queryFn: () => api.searchFunds(debounced, { limit: 12 }),
    // The API requires 2 characters; asking for fewer is a guaranteed 400.
    enabled: debounced.length >= 2,
    staleTime: 60_000,
  });

  const results = data?.items ?? [];

  const select = (fund: FundSummary) => {
    setOpen(false);
    router.push(`/fund/${fund.id}`);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((i) => (i + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      select(results[highlighted]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={term}
          autoFocus={autoFocus}
          onChange={(e) => {
            setTerm(e.target.value);
            setHighlighted(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search any mutual fund scheme — try a fund name, AMC or category"
          className="h-12 pl-10 pr-10 text-base"
          role="combobox"
          aria-expanded={open}
          aria-controls="fund-search-results"
          aria-autocomplete="list"
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && debounced.length >= 2 && (
        <Card
          id="fund-search-results"
          role="listbox"
          className="absolute z-40 mt-2 max-h-[26rem] w-full overflow-y-auto p-1 shadow-lg"
        >
          {isError && (
            <p className="p-4 text-sm text-muted-foreground">
              Search is unavailable right now. Please try again in a moment.
            </p>
          )}

          {!isError && results.length === 0 && !isFetching && (
            <div className="p-4 text-sm text-muted-foreground">
              <p>No scheme matched “{debounced}”.</p>
              <p className="mt-1 text-xs">
                Schemes are loaded from the AMFI master. Try the full scheme name, or check the
                spelling of the AMC.
              </p>
            </div>
          )}

          {results.map((fund, index) => (
            <button
              key={fund.id}
              role="option"
              aria-selected={index === highlighted}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => select(fund)}
              className={cn(
                'flex w-full flex-col gap-1 rounded-md px-3 py-2.5 text-left transition-colors',
                index === highlighted ? 'bg-accent' : 'hover:bg-accent/60',
              )}
            >
              <span className="text-sm font-medium leading-snug">{fund.name}</span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{fund.amcName}</span>
                {fund.subCategory && (
                  <Badge variant="secondary" className="font-normal">
                    {fund.subCategory}
                  </Badge>
                )}
                {fund.latestNav !== null && (
                  <span className="tabular">
                    NAV {formatCurrency(fund.latestNav)} · {formatDate(fund.latestNavDate)}
                  </span>
                )}
              </span>
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}
