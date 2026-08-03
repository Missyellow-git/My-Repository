import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestUser } from './jwt.strategy';

/**
 * Injects the authenticated user set by JwtStrategy.validate.
 *
 * Under JwtAuthGuard this is always populated; under OptionalJwtAuthGuard it
 * may be undefined, which is why the return type is nullable and callers must
 * handle the anonymous case explicitly.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    return request.user;
  },
);
