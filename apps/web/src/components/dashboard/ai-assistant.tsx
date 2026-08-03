'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Bot, CornerDownLeft, Cpu, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import * as React from 'react';
import type { AiQueryResponse } from '@fundlens/shared';
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
import { changeClass, cn, formatCurrency, formatMarketCap, formatPercent } from '@/lib/utils';

interface Props {
  fundId: string;
  date: string;
  /** Lets the assistant highlight the rows it answered with, in the main table. */
  onHighlight?: (symbols: string[]) => void;
}

/**
 * Natural-language assistant.
 *
 * The UI mirrors the backend's separation of concerns exactly, because that
 * separation is the product's honesty guarantee:
 *
 *   • the *answer* (table or number) is server-computed and rendered plainly;
 *   • the *narrative* sits in its own block, explicitly labelled AI-generated;
 *   • a provenance badge says whether the query plan came from deterministic
 *     rules or from the model;
 *   • warnings about stale disclosures or missing prices are shown with the
 *     answer, not tucked away.
 *
 * A user should never have to guess which part of this panel is arithmetic.
 */
export function AiAssistant({ fundId, date, onHighlight }: Props) {
  const [question, setQuestion] = React.useState('');
  const [answer, setAnswer] = React.useState<AiQueryResponse | null>(null);

  const { data: capabilities } = useQuery({
    queryKey: ['ai-capabilities'],
    queryFn: () => api.getAiCapabilities(),
    staleTime: 30 * 60_000,
    retry: false,
  });

  const ask = useMutation({
    mutationFn: (q: string) => api.askAi(fundId, q, date),
    onSuccess: (result) => {
      setAnswer(result);
      onHighlight?.(
        (result.answer.rows ?? []).map((r) => r.nseSymbol).filter((s): s is string => !!s),
      );
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (trimmed.length >= 3) ask.mutate(trimmed);
  };

  const runExample = (example: string) => {
    setQuestion(example);
    ask.mutate(example);
  };

  const error = ask.error as ApiError | null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bot className="h-4 w-4 text-primary" aria-hidden />
          Ask about this portfolio
        </CardTitle>
        <CardDescription>
          Questions are turned into a query the server runs against these holdings. Every figure
          below is computed from the data — not written by a model.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <form onSubmit={submit} className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Which holdings are down more than 2% today?"
            aria-label="Ask a question about this portfolio"
            maxLength={500}
          />
          <Button type="submit" disabled={ask.isPending || question.trim().length < 3}>
            {ask.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CornerDownLeft className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Ask</span>
          </Button>
        </form>

        {!answer && !ask.isPending && (
          <div className="flex flex-wrap gap-1.5">
            {(capabilities?.exampleQuestions ?? []).slice(0, 6).map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => runExample(example)}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {example}
              </button>
            ))}
          </div>
        )}

        {error && (
          <Alert variant={error.code === 'AI_QUESTION_UNSUPPORTED' ? 'warning' : 'danger'}>
            <AlertDescription>
              <p>{error.message}</p>
              {Array.isArray((error.details as { examples?: string[] })?.examples) && (
                <p className="mt-2 text-xs">
                  Try one of the suggestions above, or filter the table directly.
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {answer && <AnswerBlock answer={answer} />}
      </CardContent>
    </Card>
  );
}

function AnswerBlock({ answer }: { answer: AiQueryResponse }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={answer.resolvedBy === 'llm' ? 'default' : 'secondary'}>
          {answer.resolvedBy === 'llm' ? (
            <>
              <Sparkles className="mr-1 h-3 w-3" aria-hidden /> planned by AI
            </>
          ) : (
            <>
              <Cpu className="mr-1 h-3 w-3" aria-hidden /> matched a built-in rule
            </>
          )}
        </Badge>
        <span className="text-xs text-muted-foreground">{answer.interpretation}</span>
      </div>

      {/* Computed answer. */}
      <div className="rounded-lg border bg-muted/30 p-3">
        <p className="text-sm font-medium">{answer.answer.factualSummary}</p>

        {answer.answer.kind === 'scalar' && answer.answer.scalar && (
          <p className="tabular mt-2 text-3xl font-semibold">
            {answer.answer.scalar.value}
            <span className="ml-1 text-base text-muted-foreground">
              {answer.answer.scalar.unit ?? ''}
            </span>
          </p>
        )}

        {answer.answer.kind === 'rows' && (answer.answer.rows?.length ?? 0) > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-3 text-left font-medium">Stock</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Weight</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Price</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Change</th>
                  <th className="hidden py-1.5 text-right font-medium sm:table-cell">Market cap</th>
                </tr>
              </thead>
              <tbody>
                {answer.answer.rows!.slice(0, 25).map((row) => (
                  <tr
                    key={`${row.instrumentName}-${row.nseSymbol}`}
                    className="border-b last:border-0"
                  >
                    <td className="py-1.5 pr-3">
                      <span className="font-medium">{row.instrumentName}</span>
                      {row.sector && (
                        <span className="ml-2 text-xs text-muted-foreground">{row.sector}</span>
                      )}
                    </td>
                    <td className="tabular py-1.5 pr-3 text-right">
                      {formatPercent(row.weightPct)}
                    </td>
                    <td className="tabular py-1.5 pr-3 text-right">{formatCurrency(row.ltp)}</td>
                    <td
                      className={cn(
                        'tabular py-1.5 pr-3 text-right font-medium',
                        changeClass(row.changePct),
                      )}
                    >
                      {row.changePct === null ? '—' : formatPercent(row.changePct, 2, true)}
                    </td>
                    <td className="tabular hidden py-1.5 text-right sm:table-cell">
                      {formatMarketCap(row.marketCapCrore)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(answer.answer.rows?.length ?? 0) > 25 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing 25 of {answer.answer.rows!.length} rows. Use the table filters for the full
                set.
              </p>
            )}
          </div>
        )}

        {answer.answer.kind === 'groups' && (
          <ul className="mt-3 space-y-1">
            {answer.answer.groups!.map((group) => (
              <li key={group.key} className="flex items-baseline gap-2 text-sm">
                <span className="flex-1 truncate">{group.key}</span>
                <span className="tabular text-xs text-muted-foreground">{group.count}</span>
                <span className="tabular w-16 text-right font-medium">
                  {formatPercent(group.weightPct)}
                </span>
                <span
                  className={cn(
                    'tabular w-16 text-right text-xs',
                    changeClass(group.weightedChangePct),
                  )}
                >
                  {group.weightedChangePct === null
                    ? '—'
                    : formatPercent(group.weightedChangePct, 2, true)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Model commentary — visually and semantically separate from the facts. */}
      {answer.narrative && (
        <div className="rounded-lg border border-dashed p-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3 w-3" aria-hidden />
            AI commentary
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">{answer.narrative}</p>
        </div>
      )}

      {answer.warnings.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            <ul className="space-y-1">
              {answer.warnings.map((warning) => (
                <li key={warning} className="flex gap-2 text-xs">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">{answer.disclaimer}</p>
    </div>
  );
}
