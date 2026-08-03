import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  aiInsightsQuerySchema,
  aiQuerySchema,
  type AiInsightsQuery,
  type AiQueryInput,
} from '@fundlens/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { AiService } from './ai.service';
import { InsightsService } from './insights.service';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly insights: InsightsService,
  ) {}

  @Post('query')
  // Optional auth: the assistant works signed out, but a signed-in caller is
  // identified so their AI budget is their own rather than shared per IP.
  @UseGuards(OptionalJwtAuthGuard)
  // Tighter than the global throttle: this is the only endpoint that can reach
  // a paid model, so it is limited per caller independently of the rest.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Ask a natural-language question about a fund’s holdings',
    description:
      'The question is translated into a structured query (deterministic rules first, model second) ' +
      'which the server then executes itself. Every figure in `answer` is computed from the ' +
      'holdings data; `narrative` is model-written commentary and is labelled separately. ' +
      'Set `deterministicOnly` to skip the model entirely.',
  })
  @ApiOkResponse({
    description: 'Structured answer, provenance, data-freshness metadata and disclaimer.',
  })
  async query(
    @Body(new ZodValidationPipe(aiQuerySchema)) input: AiQueryInput,
    @Req() request: Request & { user?: { userId: string } },
  ) {
    // Signed-in users get their own AI budget; anonymous callers share one per
    // IP, which stops a single client from spending the deployment's quota.
    const rateLimitKey = request.user?.userId ?? `ip:${request.ip ?? 'unknown'}`;
    return this.ai.ask(input, rateLimitKey);
  }

  @Get('insights')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Intraday commentary on a fund’s holdings',
    description:
      'Returns `facts` (computed and reproducible) alongside `insights` (prose). `generatedBy` ' +
      'reports whether the prose came from the model or from the deterministic template used when ' +
      'the model is unavailable.',
  })
  async getInsights(@Query(new ZodValidationPipe(aiInsightsQuerySchema)) query: AiInsightsQuery) {
    return this.insights.getInsights(query.fundId, query.date);
  }

  @Get('capabilities')
  @ApiOperation({ summary: 'What the assistant can answer on this deployment' })
  capabilities() {
    return this.ai.capabilities();
  }
}
