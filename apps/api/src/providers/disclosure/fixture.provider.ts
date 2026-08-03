import { Injectable, Logger } from '@nestjs/common';
import { StockMapperService } from './stock-mapper.service';
import type { DisclosureFetchResult, DisclosureProvider, RawDisclosure } from './disclosure.types';
import { FIXTURE_FUNDS, buildFixtureDisclosures } from './fixtures/sample-disclosures';

/**
 * Development disclosure source.
 *
 * Emits three month-end disclosures for each synthetic scheme so the import
 * pipeline, historical comparison and turnover analytics all have real work to
 * do without depending on any AMC's website being reachable from CI.
 */
@Injectable()
export class FixtureDisclosureProvider implements DisclosureProvider {
  readonly name = 'fixture';
  private readonly logger = new Logger(FixtureDisclosureProvider.name);

  async fetchLatest(since?: Date): Promise<DisclosureFetchResult> {
    const disclosures: RawDisclosure[] = [];

    for (const fund of FIXTURE_FUNDS) {
      for (const fixture of buildFixtureDisclosures(fund)) {
        if (since && fixture.disclosureDate <= since) continue;
        disclosures.push({
          schemeName: fixture.schemeName,
          disclosureDate: fixture.disclosureDate,
          totalAumCrore: fund.aumCrore,
          sourceUrl: null,
          lines: fixture.lines.map((l) => ({
            instrumentName: l.instrumentName,
            isin: l.isin,
            quantity: l.quantity,
            marketValueLakh: l.marketValueLakh,
            weightPct: l.weightPct,
            instrumentType:
              l.instrumentType ?? StockMapperService.inferInstrumentType(l.instrumentName, l.isin),
          })),
        });
      }
    }

    this.logger.log(`Fixture provider produced ${disclosures.length} disclosures`);
    return { disclosures, warnings: [] };
  }
}
