'use client';

import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Loader2 } from 'lucide-react';
import * as React from 'react';
import type { FundSummary, OverlapResult } from '@fundlens/shared';
import { api, ApiError } from '@/lib/api';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@/components/ui';
import { formatDate, formatPercent } from '@/lib/utils';

/**
 * Cross-scheme overlap.
 *
 * Investors routinely hold four funds that turn out to own the same twenty
 * companies. This page answers that directly, using the standard
 * Σ min(weightA, weightB) measure the API computes.
 */
export default function ComparePage() {
  const [fundA, setFundA] = React.useState<FundSummary | null>(null);
  const [fundB, setFundB] = React.useState<FundSummary | null>(null);
  const [result, setResult] = React.useState<OverlapResult | null>(null);

  const compare = useMutation({
    mutationFn: () => api.compareFunds(fundA!.id, fundB!.id),
    onSuccess: setResult,
  });

  const error = compare.error as ApiError | null;

  return (
    <div className="container max-w-5xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Compare two schemes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See how much of two portfolios is the same holdings. Overlap is measured as the sum of the
          smaller weight in each shared position, so 100% means identical portfolios.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <FundPicker label="First scheme" selected={fundA} onSelect={setFundA} />
        <ArrowRight className="mx-auto hidden h-5 w-5 text-muted-foreground sm:block" aria-hidden />
        <FundPicker label="Second scheme" selected={fundB} onSelect={setFundB} />
      </div>

      <Button
        onClick={() => compare.mutate()}
        disabled={!fundA || !fundB || fundA.id === fundB.id || compare.isPending}
      >
        {compare.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Compare portfolios
      </Button>

      {fundA && fundB && fundA.id === fundB.id && (
        <Alert variant="warning">
          <AlertDescription>Pick two different schemes.</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="danger">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {result && <OverlapResultView result={result} />}
    </div>
  );
}

function OverlapResultView({ result }: { result: OverlapResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          <span className="tabular text-3xl font-bold">{formatPercent(result.overlapPct)}</span>
          <span className="text-sm font-normal text-muted-foreground">portfolio overlap</span>
        </CardTitle>
        <CardDescription>
          {result.commonHoldings.length} shared holdings · {result.onlyInA} only in{' '}
          {result.fundA.name} · {result.onlyInB} only in {result.fundB.name}
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="secondary">
            {result.fundA.name} — {formatDate(result.fundA.disclosureDate)}
          </Badge>
          <Badge variant="secondary">
            {result.fundB.name} — {formatDate(result.fundB.disclosureDate)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {result.fundA.disclosureDate !== result.fundB.disclosureDate && (
          <Alert variant="warning" className="mb-4">
            <AlertDescription>
              These schemes disclosed on different dates, so the comparison is not strictly
              like-for-like.
            </AlertDescription>
          </Alert>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 text-left font-medium">Shared holding</th>
                <th className="py-2 pr-3 text-right font-medium">Weight in A</th>
                <th className="py-2 text-right font-medium">Weight in B</th>
              </tr>
            </thead>
            <tbody>
              {result.commonHoldings.slice(0, 50).map((holding) => (
                <tr key={holding.instrumentName} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">{holding.instrumentName}</td>
                  <td className="tabular py-1.5 pr-3 text-right">
                    {formatPercent(holding.weightA)}
                  </td>
                  <td className="tabular py-1.5 text-right">{formatPercent(holding.weightB)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** Minimal inline search — a full combobox is overkill for a two-field form. */
function FundPicker({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: FundSummary | null;
  onSelect: (fund: FundSummary | null) => void;
}) {
  const [term, setTerm] = React.useState('');
  const [results, setResults] = React.useState<FundSummary[]>([]);
  const [searching, setSearching] = React.useState(false);

  React.useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await api.searchFunds(term.trim(), { limit: 6, withHoldingsOnly: true });
        setResults(response.items);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  if (selected) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="flex items-center justify-between gap-2 rounded-md border p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{selected.name}</p>
            <p className="truncate text-xs text-muted-foreground">{selected.amcName}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onSelect(null)}>
            Change
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search a scheme"
        aria-label={label}
      />
      {searching && <p className="text-xs text-muted-foreground">Searching…</p>}
      {results.length > 0 && (
        <Card className="p-1">
          {results.map((fund) => (
            <button
              key={fund.id}
              onClick={() => {
                onSelect(fund);
                setTerm('');
                setResults([]);
              }}
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span className="block truncate">{fund.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{fund.amcName}</span>
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}
