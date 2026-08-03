import type { ParseOptions } from './portfolio-workbook.parser';

/**
 * Per-AMC disclosure adapters.
 *
 * SEBI requires every AMC to publish a month-end portfolio statement, but not
 * to publish it at a predictable URL in a common format. In practice each AMC
 * needs a small amount of configuration: where the file lives and which
 * template quirks its workbook has.
 *
 * This registry ships EMPTY on purpose. Populating it means pointing the
 * importer at a specific AMC's servers, which is a decision for the operator —
 * it carries terms-of-use and rate-of-access obligations that differ per AMC
 * and per jurisdiction. `docs/ARCHITECTURE.md#disclosure-ingestion` explains
 * the three supported sourcing routes and when each is appropriate:
 *
 *   1. a licensed mutual-fund data vendor (recommended for production —
 *      one contract, one format, normalised names and ISINs);
 *   2. direct AMC downloads under the AMC's published terms;
 *   3. manual/administrative upload of a workbook via the admin import path.
 *
 * Adding an adapter is deliberately a code change rather than a runtime
 * setting: it is a data-provenance decision and belongs in review and in the
 * audit trail.
 */

export interface AmcAdapter {
  /** Registry key, matched against Amc.disclosureAdapter. */
  key: string;
  amcName: string;
  /**
   * Resolves the downloadable workbook URLs for a given month-end. Implement
   * with a URL template when the AMC uses one, or with a listing-page fetch
   * when it does not.
   */
  resolveDisclosureUrls(monthEnd: Date): Promise<string[]>;
  /** Template quirks handed to the generic workbook parser. */
  parseOptions?: Omit<ParseOptions, 'disclosureDate' | 'sourceUrl'>;
  /**
   * Minimum delay between requests to this AMC's servers, in ms. The importer
   * honours it; be a good citizen even where robots.txt is silent.
   */
  minRequestIntervalMs?: number;
}

/** Registered adapters, keyed by `AmcAdapter.key`. */
export const AMC_ADAPTERS: Record<string, AmcAdapter> = {
  // Example of the intended shape — commented out rather than active so that
  // nothing starts fetching a third party's servers on `docker compose up`:
  //
  // hdfc: {
  //   key: 'hdfc',
  //   amcName: 'HDFC Mutual Fund',
  //   minRequestIntervalMs: 2_000,
  //   async resolveDisclosureUrls(monthEnd) {
  //     const period = `${monthEnd.getUTCFullYear()}${String(monthEnd.getUTCMonth() + 1).padStart(2, '0')}`;
  //     return [`https://<amc-disclosure-host>/monthly-portfolio-${period}.xlsx`];
  //   },
  //   parseOptions: { headerSynonyms: { weight: ['% to nav'] } },
  // },
};

export function getAdapter(key: string | null | undefined): AmcAdapter | null {
  if (!key) return null;
  return AMC_ADAPTERS[key] ?? null;
}

export function registeredAdapterKeys(): string[] {
  return Object.keys(AMC_ADAPTERS);
}
