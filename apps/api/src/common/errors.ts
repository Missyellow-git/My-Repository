import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@fundlens/shared';

/**
 * Every error the API raises deliberately carries a stable `code`. Clients
 * branch on the code; the human message is free to change without breaking
 * them. The global filter (all-exceptions.filter.ts) is the only place that
 * turns these into HTTP bodies.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export class FundNotFoundException extends AppException {
  constructor(identifier: string) {
    super(
      ErrorCode.FUND_NOT_FOUND,
      `No mutual fund scheme matched "${identifier}". Try searching by the full scheme name, or check that the scheme is still active.`,
      HttpStatus.NOT_FOUND,
      { identifier },
    );
  }
}

export class DisclosureNotFoundException extends AppException {
  constructor(fundId: string, date: string) {
    super(
      ErrorCode.DISCLOSURE_NOT_FOUND,
      date === 'latest'
        ? 'This scheme has no published portfolio disclosure yet. Disclosures are imported within a few days of the AMC publishing them.'
        : `No portfolio disclosure exists for this scheme on ${date}.`,
      HttpStatus.NOT_FOUND,
      { fundId, date },
    );
  }
}

/**
 * Not an error the caller can fix — the data really is old. Returned as 200
 * with a `stale` flag on normal reads; this exception exists for endpoints
 * where acting on stale data would be wrong (e.g. alert evaluation).
 */
export class StaleDisclosureException extends AppException {
  constructor(fundId: string, disclosureDate: string, ageDays: number) {
    super(
      ErrorCode.DISCLOSURE_STALE,
      `The most recent disclosure for this scheme is from ${disclosureDate} (${ageDays} days old) and is past the freshness threshold.`,
      HttpStatus.CONFLICT,
      { fundId, disclosureDate, ageDays },
    );
  }
}

export class PriceFeedUnavailableException extends AppException {
  constructor(detail?: string) {
    super(
      ErrorCode.PRICE_FEED_UNAVAILABLE,
      'Live prices are temporarily unavailable. Portfolio holdings are still shown, without market data.',
      HttpStatus.SERVICE_UNAVAILABLE,
      { detail },
    );
  }
}

export class ProviderRateLimitedException extends AppException {
  constructor(provider: string, retryAfterMs: number) {
    super(
      ErrorCode.PROVIDER_RATE_LIMITED,
      `Market data provider "${provider}" rate limit reached. Serving cached prices.`,
      HttpStatus.TOO_MANY_REQUESTS,
      { provider, retryAfterMs },
    );
  }
}

export class ProviderTimeoutException extends AppException {
  constructor(provider: string, timeoutMs: number) {
    super(
      ErrorCode.PROVIDER_TIMEOUT,
      `Request to "${provider}" timed out after ${timeoutMs}ms.`,
      HttpStatus.GATEWAY_TIMEOUT,
      { provider, timeoutMs },
    );
  }
}

export class AiUnavailableException extends AppException {
  constructor(detail: string) {
    super(
      ErrorCode.AI_UNAVAILABLE,
      'The AI assistant is unavailable right now. You can still sort and filter the holdings table directly.',
      HttpStatus.SERVICE_UNAVAILABLE,
      { detail },
    );
  }
}

export class UnsupportedQuestionException extends AppException {
  constructor(reason: string, examples: string[]) {
    super(ErrorCode.AI_QUESTION_UNSUPPORTED, reason, HttpStatus.UNPROCESSABLE_ENTITY, { examples });
  }
}

export class ValidationException extends AppException {
  constructor(details: unknown) {
    super(
      ErrorCode.VALIDATION_FAILED,
      'Request validation failed.',
      HttpStatus.BAD_REQUEST,
      details,
    );
  }
}

export class ConflictException extends AppException {
  constructor(message: string, details?: unknown) {
    super(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT, details);
  }
}

export class UnauthorizedException extends AppException {
  constructor(message = 'Authentication required.') {
    super(ErrorCode.UNAUTHORIZED, message, HttpStatus.UNAUTHORIZED);
  }
}

export class ForbiddenException extends AppException {
  constructor(message = 'You do not have access to this resource.') {
    super(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }
}
