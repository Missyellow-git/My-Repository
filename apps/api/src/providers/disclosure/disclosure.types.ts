/**
 * Disclosure provider contract.
 *
 * A "disclosure" is one scheme's month-end portfolio statement. AMCs publish
 * these as XLS/XLSX (and occasionally PDF) on their own sites in layouts that
 * differ per AMC, which is why ingestion is adapter-shaped: the pipeline below
 * the adapter — mapping, normalisation, snapshotting, diffing — is shared.
 */

export const DISCLOSURE_PROVIDER = Symbol('DISCLOSURE_PROVIDER');

export interface DisclosureLine {
  /** Instrument name exactly as printed in the source document. */
  instrumentName: string;
  isin: string | null;
  /** Raw industry/sector text from the disclosure, if the AMC prints one. */
  industry?: string | null;
  quantity: number | null;
  marketValueLakh: number | null;
  /** Percentage of net assets as disclosed. */
  weightPct: number;
  /** Set when the adapter can classify; otherwise inferred downstream. */
  instrumentType?: string | null;
}

export interface RawDisclosure {
  /** AMFI scheme code when the adapter knows it — the most reliable join key. */
  amfiSchemeCode?: string | null;
  /** Scheme name as printed; used when no scheme code is available. */
  schemeName: string;
  disclosureDate: Date;
  totalAumCrore?: number | null;
  sourceUrl?: string | null;
  lines: DisclosureLine[];
}

export interface DisclosureFetchResult {
  disclosures: RawDisclosure[];
  warnings: string[];
}

export interface DisclosureProvider {
  readonly name: string;
  /**
   * Returns disclosures published since `since`. Implementations should be
   * incremental: re-downloading every AMC's full history on each run is both
   * slow and impolite to the AMC's servers.
   */
  fetchLatest(since?: Date): Promise<DisclosureFetchResult>;
}
