import { Injectable, Logger } from '@nestjs/common';
import { monthEndUtc } from '../../common/utils/market-hours';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiLogService } from '../api-log.service';
import { AMC_ADAPTERS, getAdapter, registeredAdapterKeys, type AmcAdapter } from './amc-adapters';
import { parsePortfolioWorkbook } from './portfolio-workbook.parser';
import type { DisclosureFetchResult, DisclosureProvider, RawDisclosure } from './disclosure.types';

/**
 * Downloads and parses month-end portfolio workbooks from AMCs that have a
 * registered adapter (see amc-adapters.ts).
 *
 * Behaviour when no adapters are registered — the default — is to return an
 * empty result with an explanatory warning rather than to fail. That keeps the
 * scheduled job green while making the gap visible in the job-run record,
 * which is the honest state of affairs: the pipeline is ready, the data source
 * has not been chosen.
 */
@Injectable()
export class AmcDisclosureProvider implements DisclosureProvider {
  readonly name = 'amc';
  private readonly logger = new Logger(AmcDisclosureProvider.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiLog: ApiLogService,
  ) {}

  async fetchLatest(since?: Date): Promise<DisclosureFetchResult> {
    const keys = registeredAdapterKeys();
    if (keys.length === 0) {
      const warning =
        'DISCLOSURE_PROVIDER=amc but no AMC adapters are registered. Register one in ' +
        'providers/disclosure/amc-adapters.ts, switch to a licensed data vendor, or use the ' +
        'admin workbook upload endpoint.';
      this.logger.warn(warning);
      return { disclosures: [], warnings: [warning] };
    }

    const warnings: string[] = [];
    const disclosures: RawDisclosure[] = [];

    // Look back two month-ends: AMCs publish with a lag, and a run early in the
    // month should still pick up the prior period if it landed late.
    const periods = [monthEndUtc(new Date(), 1), monthEndUtc(new Date(), 0)].filter(
      (d) => !since || d > since,
    );

    for (const key of keys) {
      const adapter = AMC_ADAPTERS[key];
      for (const monthEnd of periods) {
        try {
          const fetched = await this.fetchAdapterPeriod(adapter, monthEnd);
          disclosures.push(...fetched.disclosures);
          warnings.push(...fetched.warnings);
        } catch (err) {
          const message = `Adapter "${key}" failed for ${monthEnd.toISOString().slice(0, 10)}: ${(err as Error).message}`;
          this.logger.error(message);
          warnings.push(message);
        }
      }
    }

    return { disclosures, warnings };
  }

  private async fetchAdapterPeriod(
    adapter: AmcAdapter,
    monthEnd: Date,
  ): Promise<DisclosureFetchResult> {
    const urls = await adapter.resolveDisclosureUrls(monthEnd);
    const disclosures: RawDisclosure[] = [];
    const warnings: string[] = [];

    for (const url of urls) {
      const started = Date.now();
      try {
        const buffer = await this.download(url);
        this.apiLog.record({
          provider: `amc:${adapter.key}`,
          endpoint: url,
          outcome: 'ok',
          httpStatus: 200,
          latencyMs: Date.now() - started,
        });

        const parsed = await parsePortfolioWorkbook(buffer, {
          ...adapter.parseOptions,
          disclosureDate: monthEnd,
          sourceUrl: url,
        });
        disclosures.push(...parsed.disclosures);
        warnings.push(...parsed.warnings.map((w) => `${adapter.key}: ${w}`));
      } catch (err) {
        this.apiLog.record({
          provider: `amc:${adapter.key}`,
          endpoint: url,
          outcome: (err as Error).name === 'AbortError' ? 'timeout' : 'error',
          latencyMs: Date.now() - started,
          errorMessage: (err as Error).message,
        });
        warnings.push(`${adapter.key}: failed to ingest ${url} — ${(err as Error).message}`);
      }

      if (adapter.minRequestIntervalMs) {
        await sleep(adapter.minRequestIntervalMs);
      }
    }

    return { disclosures, warnings };
  }

  private async download(url: string): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'FundLens/1.0 (portfolio disclosure importer)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      // Guard against an AMC serving an HTML error page with a 200.
      if (bytes.byteLength < 1024)
        throw new Error(`Suspiciously small payload (${bytes.byteLength} bytes)`);
      return Buffer.from(bytes);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Used by the admin upload endpoint to reuse the same parse + import path. */
  async parseUploadedWorkbook(
    buffer: Buffer,
    opts: { amcKey?: string; schemeName?: string; disclosureDate?: Date },
  ): Promise<DisclosureFetchResult> {
    const adapter = getAdapter(opts.amcKey);
    const parsed = await parsePortfolioWorkbook(buffer, {
      ...adapter?.parseOptions,
      schemeNameOverride: opts.schemeName,
      disclosureDate: opts.disclosureDate,
    });
    return { disclosures: parsed.disclosures, warnings: parsed.warnings };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
