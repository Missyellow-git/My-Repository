import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { exportQuerySchema, type ExportQuery } from '@fundlens/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ExportService } from './export.service';

@ApiTags('export')
@Controller('funds/:id/export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get()
  @ApiOperation({
    summary: 'Download holdings as CSV or Excel',
    description:
      'The file opens with a provenance block naming the scheme, the disclosure date and the ' +
      'price quality at the time of export, so the numbers stay interpretable after the file ' +
      'leaves the app.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'xlsx'] })
  @ApiQuery({ name: 'date', required: false, example: 'latest' })
  @ApiProduces('text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  // Downloads are user-specific point-in-time artefacts; caching them anywhere
  // in front of the API would hand one user's export to another.
  @Header('Cache-Control', 'no-store')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(exportQuerySchema)) query: ExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.exportService.export(id, query);

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', result.body.length);
    // RFC 5987 filename* so non-ASCII scheme names survive the round trip.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    );
    res.end(result.body);
  }
}
