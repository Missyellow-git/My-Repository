import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ApiErrorBody, ErrorCode } from '@fundlens/shared';
import { AppException } from '../errors';

/**
 * The single place an exception becomes an HTTP response.
 *
 * Two rules this filter enforces, both of which matter for a financial product:
 *  1. Internal details never reach the client. Prisma messages leak schema and
 *     sometimes data; they are logged in full and replaced with a generic body.
 *  2. Every response carries the request id, so a user-reported error can be
 *     tied to the exact server log line without guessing.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request.headers['x-request-id'] as string) ?? 'unknown';

    const { status, code, message, details } = this.translate(exception);

    const body: ApiErrorBody = {
      statusCode: status,
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl ?? request.url,
    };

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId, path: body.path, code },
        `Unhandled error: ${message}`,
      );
    } else if (
      status === HttpStatus.TOO_MANY_REQUESTS ||
      status === HttpStatus.SERVICE_UNAVAILABLE
    ) {
      this.logger.warn({ requestId, path: body.path, code }, message);
    }

    response.status(status).json(body);
  }

  private translate(exception: unknown): {
    status: number;
    code: ErrorCode;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof AppException) {
      const res = exception.getResponse() as {
        code: ErrorCode;
        message: string;
        details?: unknown;
      };
      return {
        status: exception.getStatus(),
        code: res.code,
        message: res.message,
        details: res.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string | string[] }).message ?? exception.message);
      return {
        status,
        code: this.codeForStatus(status),
        message: Array.isArray(message) ? message.join('; ') : message,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 unique violation is the only Prisma error a client can act on.
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.CONFLICT,
          message: 'That record already exists.',
          details: { fields: (exception.meta?.target as string[]) ?? [] },
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          code: ErrorCode.INTERNAL,
          message: 'The requested record does not exist.',
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL,
      message: 'An unexpected error occurred. The incident has been logged.',
    };
  }

  private codeForStatus(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_FAILED;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      default:
        return ErrorCode.INTERNAL;
    }
  }
}
