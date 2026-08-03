import { Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import type { ExportQuery, HoldingsResponse } from '@fundlens/shared';
import { HoldingsService } from '../holdings/holdings.service';

export interface ExportResult {
  filename: string;
  contentType: string;
  body: Buffer;
}

/**
 * CSV and Excel export of a scheme's holdings.
 *
 * Exports carry a provenance header block — scheme, disclosure date, generation
 * time and price quality. A spreadsheet outlives the page it came from, and a
 * column of prices with no timestamp is exactly the artefact that later gets
 * pasted into something important as if it were current.
 */
@Injectable()
export class ExportService {
  private static readonly COLUMNS = [
    { header: 'Rank', key: 'rank', width: 8 },
    { header: 'Instrument', key: 'instrumentName', width: 44 },
    { header: 'NSE Symbol', key: 'nseSymbol', width: 14 },
    { header: 'BSE Code', key: 'bseCode', width: 12 },
    { header: 'ISIN', key: 'isin', width: 16 },
    { header: 'Type', key: 'instrumentType', width: 14 },
    { header: 'Sector', key: 'sector', width: 24 },
    { header: 'Market Cap Category', key: 'marketCapCategory', width: 20 },
    { header: 'Weight %', key: 'weightPct', width: 11 },
    { header: 'Quantity', key: 'quantity', width: 14 },
    { header: 'Market Value (₹ lakh)', key: 'marketValueLakh', width: 20 },
    { header: 'LTP (₹)', key: 'ltp', width: 12 },
    { header: 'Change (₹)', key: 'change', width: 12 },
    { header: 'Change %', key: 'changePct', width: 11 },
    { header: 'Market Cap (₹ cr)', key: 'marketCapCrore', width: 18 },
    { header: '52W High', key: 'week52High', width: 12 },
    { header: '52W Low', key: 'week52Low', width: 12 },
    { header: 'Price Quality', key: 'priceQuality', width: 15 },
    { header: 'Price As Of', key: 'quotedAt', width: 22 },
  ] as const;

  constructor(private readonly holdings: HoldingsService) {}

  async export(fundId: string, query: ExportQuery): Promise<ExportResult> {
    const response = await this.holdings.getHoldings(fundId, {
      date: query.date,
      includeNonEquity: query.includeNonEquity,
      includeUnmapped: true,
      withPrices: query.withPrices,
    });

    const slug = response.fund.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    const filename = `${slug}-holdings-${response.snapshot.disclosureDate}.${query.format}`;

    return query.format === 'xlsx'
      ? { filename, contentType: XLSX_MIME, body: await this.toXlsx(response) }
      : { filename, contentType: 'text/csv; charset=utf-8', body: this.toCsv(response) };
  }

  private rows(response: HoldingsResponse) {
    return response.holdings.map((h) => ({
      rank: h.rank,
      instrumentName: h.stock?.name ?? h.instrumentName,
      nseSymbol: h.stock?.nseSymbol ?? '',
      bseCode: h.stock?.bseCode ?? '',
      isin: h.isin ?? h.stock?.isin ?? '',
      instrumentType: h.instrumentType,
      sector: h.stock?.sector ?? (h.mapped ? 'Unclassified' : 'Unmapped'),
      marketCapCategory: h.stock?.marketCapCategory ?? '',
      weightPct: h.weightPct,
      quantity: h.quantity ?? '',
      marketValueLakh: h.marketValueLakh ?? '',
      ltp: h.quote?.ltp ?? '',
      change: h.quote?.change ?? '',
      changePct: h.quote?.changePct ?? '',
      marketCapCrore: h.stock?.marketCapCrore ?? '',
      week52High: h.quote?.week52High ?? '',
      week52Low: h.quote?.week52Low ?? '',
      priceQuality: h.quote?.quality ?? 'UNAVAILABLE',
      quotedAt: h.quote?.quotedAt ?? '',
    }));
  }

  private metadataLines(response: HoldingsResponse): string[][] {
    return [
      ['Scheme', response.fund.name],
      ['AMC', response.fund.amcName],
      ['Disclosure date', response.snapshot.disclosureDate],
      [
        'Disclosure status',
        response.snapshot.stale ? 'STALE — past freshness threshold' : 'Current',
      ],
      ['Disclosure source', response.snapshot.source],
      ['Generated at', response.generatedAt],
      [
        'Price coverage',
        `${response.priceCoverage.withQuote} of ${response.priceCoverage.requested} holdings priced` +
          (response.priceCoverage.stale > 0 ? `, ${response.priceCoverage.stale} stale` : ''),
      ],
      ['Unmapped instruments', String(response.unmappedInstruments.length)],
      [
        'Note',
        'Holdings are as disclosed on the date above and may not reflect current positions. ' +
          'Prices are informational, not for trading or valuation. Not investment advice.',
      ],
    ];
  }

  private toCsv(response: HoldingsResponse): Buffer {
    const lines: string[] = [];

    for (const [label, value] of this.metadataLines(response)) {
      lines.push(`${csvCell(`# ${label}`)},${csvCell(value)}`);
    }
    lines.push('');
    lines.push(ExportService.COLUMNS.map((c) => csvCell(c.header)).join(','));

    for (const row of this.rows(response)) {
      lines.push(
        ExportService.COLUMNS.map((c) => csvCell(row[c.key as keyof typeof row])).join(','),
      );
    }

    // BOM so Excel on Windows reads the ₹ sign and company names correctly
    // instead of rendering mojibake.
    return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
  }

  private async toXlsx(response: HoldingsResponse): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'FundLens';
    workbook.created = new Date();

    const info = workbook.addWorksheet('About this export');
    info.columns = [
      { header: 'Field', key: 'field', width: 24 },
      { header: 'Value', key: 'value', width: 90 },
    ];
    info.getRow(1).font = { bold: true };
    for (const [field, value] of this.metadataLines(response)) {
      info.addRow({ field, value });
    }
    info.getColumn('value').alignment = { wrapText: true, vertical: 'top' };

    const sheet = workbook.addWorksheet('Holdings', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = ExportService.COLUMNS.map((c) => ({ ...c }));
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: 'A1', to: { row: 1, column: ExportService.COLUMNS.length } };

    for (const row of this.rows(response)) {
      sheet.addRow(row);
    }

    sheet.getColumn('weightPct').numFmt = '0.0000';
    sheet.getColumn('changePct').numFmt = '0.00';
    sheet.getColumn('ltp').numFmt = '#,##0.00';
    sheet.getColumn('marketValueLakh').numFmt = '#,##0.00';
    sheet.getColumn('marketCapCrore').numFmt = '#,##0';

    if (response.unmappedInstruments.length > 0) {
      const unmapped = workbook.addWorksheet('Unmapped instruments');
      unmapped.columns = [{ header: 'Instrument name (as disclosed)', key: 'name', width: 60 }];
      unmapped.getRow(1).font = { bold: true };
      for (const name of response.unmappedInstruments) unmapped.addRow({ name });
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Quotes a CSV cell.
 *
 * The leading apostrophe on values starting with =, +, - or @ is CSV injection
 * defence: without it, a company name beginning with "=" is executed as a
 * formula when the file is opened in Excel.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}
