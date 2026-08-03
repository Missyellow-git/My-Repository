import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Assigns (or honours) a correlation id for every request and echoes it back.
 * The id flows into pino's per-request child logger, into error bodies and into
 * ApiCallLog rows, which is what lets an operator trace one user's dashboard
 * load through every provider call it triggered.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    // Trust an upstream id only if it looks like one — an unbounded header
    // would otherwise end up in logs and in the response verbatim.
    const id =
      typeof incoming === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
  }
}
