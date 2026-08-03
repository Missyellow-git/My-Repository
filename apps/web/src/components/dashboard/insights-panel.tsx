'use client';

import { Sparkles } from 'lucide-react';
import type { AiInsightsResponse } from '@fundlens/shared';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@/components/ui';

/**
 * Daily commentary panel.
 *
 * `facts` and `insights` come back as separate fields from the API and are
 * rendered as separate blocks here. The badge states whether the prose was
 * model-written or template-generated, so a reader always knows what they are
 * looking at without having to infer it from the writing style.
 */
export function InsightsPanel({
  insights,
  isLoading,
}: {
  insights: AiInsightsResponse | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Portfolio insights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </CardContent>
      </Card>
    );
  }

  if (!insights) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Portfolio insights</CardTitle>
            <CardDescription>
              As of the {insights.dataAsOf.disclosureDate} disclosure
            </CardDescription>
          </div>
          <Badge variant={insights.generatedBy === 'llm' ? 'default' : 'secondary'}>
            {insights.generatedBy === 'llm' ? (
              <>
                <Sparkles className="mr-1 h-3 w-3" aria-hidden /> AI-written
              </>
            ) : (
              'computed summary'
            )}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Facts: every line here is arithmetic over disclosed data. */}
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {insights.facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {fact.label}
              </dt>
              <dd className="tabular truncate text-sm font-medium" title={fact.value}>
                {fact.value}
              </dd>
              {fact.detail && (
                <dd className="truncate text-xs text-muted-foreground" title={fact.detail}>
                  {fact.detail}
                </dd>
              )}
            </div>
          ))}
        </dl>

        {insights.insights && insights.insights.length > 0 && (
          <div className="space-y-3 border-t pt-3">
            {insights.generatedBy === 'llm' && (
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Generated commentary — describes the figures above, may contain errors
              </p>
            )}
            {insights.insights.map((section) => (
              <div key={section.heading}>
                <h3 className="text-sm font-medium">{section.heading}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{section.body}</p>
              </div>
            ))}
          </div>
        )}

        {insights.warnings.length > 0 && (
          <ul className="space-y-1 border-t pt-3">
            {insights.warnings.map((warning) => (
              <li key={warning} className="text-xs text-muted-foreground">
                • {warning}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
