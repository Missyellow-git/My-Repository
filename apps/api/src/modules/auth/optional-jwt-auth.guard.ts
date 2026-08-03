import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authenticates when a valid bearer token is present and passes through
 * silently when it is not.
 *
 * Used on endpoints that are public but behave better when they know who is
 * calling — the AI endpoint charges rate limits to the individual rather than
 * to a shared IP bucket, and the dashboard can apply saved preferences.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  /**
   * Passport calls this with the verification outcome. Returning `undefined`
   * instead of throwing is what makes the guard optional: an absent, malformed
   * or expired token simply leaves `request.user` unset.
   */
  handleRequest<TUser>(_err: unknown, user: TUser): TUser {
    return (user || undefined) as TUser;
  }
}

/** Strict variant — used by everything under /me. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
