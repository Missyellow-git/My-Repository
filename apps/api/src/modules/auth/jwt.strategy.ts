import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../../common/config/configuration';
import { UnauthorizedException } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from './auth.service';

export interface RequestUser {
  userId: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('env', { infer: true }).JWT_ACCESS_SECRET,
    });
  }

  /**
   * Access tokens are short-lived, but a deactivated account must lose access
   * immediately rather than at the end of its token's life — so this checks the
   * user is still active on every request. It is one indexed primary-key lookup;
   * if that ever shows up in profiling, cache it in Redis keyed by user id and
   * invalidate on deactivation.
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (!user?.isActive)
      throw new UnauthorizedException('Account is inactive or no longer exists.');

    return { userId: user.id, email: user.email, role: user.role };
  }
}
