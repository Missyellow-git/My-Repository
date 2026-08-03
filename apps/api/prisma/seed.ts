/**
 * Development seed.
 *
 * Creates: sectors, the stock master, synthetic AMCs and schemes, three
 * month-end portfolio disclosures per scheme, and a year of daily bars so the
 * 52-week average is populated on first boot.
 *
 * Deliberately standalone — it talks to Prisma directly rather than booting the
 * Nest container, so `npm run db:seed` works without Redis, without a market
 * data provider, and without the API being able to start.
 *
 * Idempotent: safe to re-run. Everything is upserted on a natural key.
 */
import { PrismaClient } from '@prisma/client';
import { normalizeName, normalizeSchemeName } from '../src/common/utils/text';
import {
  FIXTURE_FUNDS,
  buildFixtureDisclosures,
} from '../src/providers/disclosure/fixtures/sample-disclosures';
import {
  STOCK_MASTER,
  SECTOR_MACRO_MAP,
  classifyMarketCap,
} from '../src/providers/scheme-master/fixtures/stock-master';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Seeding FundLens development data...\n');

  const sectorIds = await seedSectors();
  const stockIds = await seedStocks(sectorIds);
  await seedDailyBars(stockIds);
  const fundIds = await seedFundsAndAmcs();
  await seedDisclosures(fundIds, stockIds);
  await seedMarketHolidays();

  console.log('\nSeed complete.');
  console.log('Note: fixture schemes are synthetic and clearly labelled "(Sample)".');
  console.log('Real scheme names arrive via the AMFI scheme-master sync job.');
}

async function seedSectors(): Promise<Map<string, string>> {
  const names = [...new Set(STOCK_MASTER.map((s) => s.sector))];
  const ids = new Map<string, string>();

  for (const name of names) {
    const sector = await prisma.sector.upsert({
      where: { name },
      create: { name, macroSector: SECTOR_MACRO_MAP[name] ?? null },
      update: { macroSector: SECTOR_MACRO_MAP[name] ?? null },
    });
    ids.set(name, sector.id);
  }

  console.log(`  sectors: ${ids.size}`);
  return ids;
}

async function seedStocks(sectorIds: Map<string, string>): Promise<Map<string, string>> {
  const bySymbol = new Map<string, string>();

  for (const seed of STOCK_MASTER) {
    const stock = await prisma.stock.upsert({
      where: { isin: seed.isin },
      create: {
        name: seed.name,
        normalizedName: normalizeName(seed.name),
        isin: seed.isin,
        nseSymbol: seed.nseSymbol,
        bseCode: seed.bseCode,
        sectorId: sectorIds.get(seed.sector) ?? null,
        industry: seed.industry,
        marketCapCrore: seed.marketCapCrore,
        marketCapCategory: classifyMarketCap(seed.marketCapCrore),
        metadataUpdatedAt: new Date(),
      },
      update: {
        name: seed.name,
        normalizedName: normalizeName(seed.name),
        nseSymbol: seed.nseSymbol,
        bseCode: seed.bseCode,
        sectorId: sectorIds.get(seed.sector) ?? null,
        industry: seed.industry,
        marketCapCrore: seed.marketCapCrore,
        marketCapCategory: classifyMarketCap(seed.marketCapCrore),
      },
    });
    bySymbol.set(seed.nseSymbol, stock.id);
  }

  console.log(`  stocks: ${bySymbol.size}`);
  return bySymbol;
}

/**
 * Writes ~250 trading days of synthetic closes per stock.
 *
 * Without these the 52-week average column is empty, and the "trading above
 * its 52-week average" question — one of the product's headline examples —
 * has nothing to answer from on a fresh database.
 */
async function seedDailyBars(stockIds: Map<string, string>): Promise<void> {
  const today = new Date();
  let written = 0;

  for (const seed of STOCK_MASTER) {
    const stockId = stockIds.get(seed.nseSymbol);
    if (!stockId) continue;

    const rows: Array<{
      stockId: string;
      date: Date;
      close: number;
      open: number;
      high: number;
      low: number;
    }> = [];

    for (let daysAgo = 365; daysAgo >= 1; daysAgo -= 1) {
      const date = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo),
      );
      const weekday = date.getUTCDay();
      if (weekday === 0 || weekday === 6) continue;

      // Gentle sinusoidal drift plus deterministic jitter — enough shape for a
      // meaningful 52-week average without pretending to be real history.
      const phase = (365 - daysAgo) / 365;
      const trend = 1 + 0.12 * Math.sin(phase * Math.PI * 2 + seed.refPrice);
      const jitter = 1 + (unit(`${seed.nseSymbol}:${daysAgo}`) - 0.5) * 0.02;
      const close = round2(seed.refPrice * trend * jitter);

      rows.push({
        stockId,
        date,
        close,
        open: round2(close * (1 + (unit(`${seed.nseSymbol}:o:${daysAgo}`) - 0.5) * 0.01)),
        high: round2(close * 1.008),
        low: round2(close * 0.992),
      });
    }

    // createMany + skipDuplicates keeps a re-run cheap: ~250 rows per stock
    // upserted individually would be tens of thousands of round trips.
    const result = await prisma.dailyBar.createMany({ data: rows, skipDuplicates: true });
    written += result.count;
  }

  console.log(`  daily bars: ${written}`);
}

async function seedFundsAndAmcs(): Promise<Map<string, string>> {
  const fundIds = new Map<string, string>();
  const amcIds = new Map<string, string>();

  for (const fixture of FIXTURE_FUNDS) {
    let amcId = amcIds.get(fixture.amcName);
    if (!amcId) {
      const amc = await prisma.amc.upsert({
        where: { name: fixture.amcName },
        create: { name: fixture.amcName, shortName: fixture.amcShortName },
        update: { shortName: fixture.amcShortName },
      });
      amcId = amc.id;
      amcIds.set(fixture.amcName, amcId);
    }

    // Fixture schemes get a synthetic code in a range AMFI does not use, so a
    // later real scheme-master sync can never collide with them.
    const amfiSchemeCode = `SAMPLE-${slug(fixture.schemeName).slice(0, 24)}`;

    const fund = await prisma.mutualFund.upsert({
      where: { amfiSchemeCode },
      create: {
        amfiSchemeCode,
        amcId,
        name: fixture.schemeName,
        normalizedName: normalizeSchemeName(fixture.schemeName),
        category: fixture.category,
        subCategory: fixture.subCategory,
        planType: 'DIRECT',
        optionType: 'GROWTH',
        benchmark: fixture.benchmark,
        riskometer: fixture.riskometer,
        aumCrore: fixture.aumCrore,
        latestNav: fixture.nav,
        latestNavDate: new Date(),
      },
      update: {
        name: fixture.schemeName,
        normalizedName: normalizeSchemeName(fixture.schemeName),
        latestNav: fixture.nav,
        latestNavDate: new Date(),
        aumCrore: fixture.aumCrore,
      },
    });

    fundIds.set(fixture.schemeName, fund.id);
  }

  console.log(`  AMCs: ${amcIds.size}, schemes: ${fundIds.size}`);
  return fundIds;
}

async function seedDisclosures(
  fundIds: Map<string, string>,
  stockIds: Map<string, string>,
): Promise<void> {
  const isinToStockId = new Map(
    STOCK_MASTER.map((s) => [s.isin, stockIds.get(s.nseSymbol)!]).filter(([, id]) => !!id) as Array<
      [string, string]
    >,
  );

  let snapshots = 0;
  let holdings = 0;

  for (const fixture of FIXTURE_FUNDS) {
    const fundId = fundIds.get(fixture.schemeName);
    if (!fundId) continue;

    for (const disclosure of buildFixtureDisclosures(fixture)) {
      const ordered = [...disclosure.lines].sort((a, b) => b.weightPct - a.weightPct);
      const equity = ordered.filter((l) => l.instrumentType === 'EQUITY');

      const snapshot = await prisma.portfolioSnapshot.upsert({
        where: {
          fundId_disclosureDate: { fundId, disclosureDate: disclosure.disclosureDate },
        },
        create: {
          fundId,
          disclosureDate: disclosure.disclosureDate,
          status: 'PUBLISHED',
          source: 'fixture',
          holdingsCount: ordered.length,
          equityCount: equity.length,
          totalEquityWeightPct: round4(equity.reduce((s, l) => s + l.weightPct, 0)),
          publishedAt: new Date(),
        },
        update: { status: 'PUBLISHED', publishedAt: new Date() },
      });

      await prisma.holding.deleteMany({ where: { snapshotId: snapshot.id } });
      const created = await prisma.holding.createMany({
        data: ordered.map((line, index) => ({
          snapshotId: snapshot.id,
          stockId: line.isin ? (isinToStockId.get(line.isin) ?? null) : null,
          instrumentName: line.instrumentName,
          isin: line.isin,
          instrumentType: line.instrumentType ?? 'EQUITY',
          quantity: line.quantity,
          marketValueLakh: line.marketValueLakh,
          weightPct: round4(line.weightPct),
          rank: index + 1,
          // ISIN match — the highest-confidence mapping tier.
          mappingConfidence: line.isin && isinToStockId.has(line.isin) ? 1 : null,
        })),
      });

      snapshots += 1;
      holdings += created.count;
    }
  }

  console.log(`  snapshots: ${snapshots}, holdings: ${holdings}`);
}

/**
 * A couple of representative NSE holidays so the market-hours logic has
 * something to exercise. Replace with the exchange's published annual list.
 */
async function seedMarketHolidays(): Promise<void> {
  const year = new Date().getUTCFullYear();
  const holidays = [
    { month: 1, day: 26, description: 'Republic Day' },
    { month: 8, day: 15, description: 'Independence Day' },
    { month: 10, day: 2, description: 'Mahatma Gandhi Jayanti' },
    { month: 12, day: 25, description: 'Christmas' },
  ];

  for (const holiday of holidays) {
    const date = new Date(Date.UTC(year, holiday.month - 1, holiday.day));
    await prisma.marketHoliday.upsert({
      where: { date },
      create: { date, description: holiday.description, exchange: 'NSE' },
      update: { description: holiday.description },
    });
  }

  console.log(`  market holidays: ${holidays.length}`);
}

function unit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
