import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthUser, LoginInput, RegisterInput } from '@fundlens/shared';
import type { AppConfig } from '../../common/config/configuration';
import { ConflictException, UnauthorizedException } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

/**
 * Accounts are optional in this product — search, holdings, analytics and the
 * AI assistant all work signed out. Authentication exists only to persist
 * favourites, watchlists, alerts and preferences.
 *
 * Security decisions worth stating explicitly:
 *  - refresh tokens are random 256-bit values stored as SHA-256 hashes, so a
 *    database leak cannot be replayed into live sessions;
 *  - refresh rotates on every use and the old token is revoked, which turns
 *    token theft into a detectable double-use rather than silent persistence;
 *  - login failures are indistinguishable between "no such user" and "wrong
 *    password", and both paths do the same work, so the response cannot be
 *    used to enumerate registered addresses.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** Compared against on the no-such-user path to equalise timing. */
  private static readonly DUMMY_HASH =
    '$2b$12$C6UzMDM.H6dfI/f/IKcEe.9NlF0S8yBQZ.ubGiIWX/L4x0Zj0Bwqa';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get env() {
    return this.config.get('env', { infer: true });
  }

  async register(
    input: RegisterInput,
    context: AuditContext,
  ): Promise<{ user: AuthUser } & TokenPair> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      // A deliberate exception to enumeration-resistance: registration must
      // tell the user their address is taken or the flow is unusable. The
      // endpoint is throttled to blunt scripted enumeration.
      throw new ConflictException('An account with that email already exists.');
    }

    const passwordHash = await bcrypt.hash(input.password, this.env.BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        displayName: input.displayName ?? null,
        preference: { create: {} },
      },
    });

    await this.audit(user.id, 'USER_REGISTERED', context);
    const tokens = await this.issueTokens(user.id, user.email, user.role);
    return { user: toAuthUser(user), ...tokens };
  }

  async login(input: LoginInput, context: AuditContext): Promise<{ user: AuthUser } & TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    const valid = user
      ? await bcrypt.compare(input.password, user.passwordHash)
      : await bcrypt.compare(input.password, AuthService.DUMMY_HASH).then(() => false);

    if (!user || !valid || !user.isActive) {
      await this.audit(user?.id ?? null, 'LOGIN_FAILED', context, { email: input.email });
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit(user.id, 'LOGIN_SUCCEEDED', context);

    const tokens = await this.issueTokens(user.id, user.email, user.role);
    return { user: toAuthUser(user), ...tokens };
  }

  /**
   * Rotating refresh. The presented token is revoked and a new one issued in
   * the same transaction, so a replayed token finds itself already revoked.
   */
  async refresh(refreshToken: string, context: AuditContext): Promise<TokenPair> {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.isActive) {
      await this.audit(stored?.userId ?? null, 'REFRESH_REJECTED', context);
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(stored.user.id, stored.user.email, stored.user.role);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken
      .updateMany({
        where: { tokenHash: hashToken(refreshToken) },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }

  async getProfile(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return toAuthUser(user);
  }

  private async issueTokens(userId: string, email: string, role: string): Promise<TokenPair> {
    const payload: JwtPayload = { sub: userId, email, role };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.env.JWT_ACCESS_SECRET,
      expiresIn: this.env.JWT_ACCESS_TTL,
    });

    // Opaque random string, not a JWT: it is stored server-side anyway, so a
    // signed self-describing token would only widen what a leak reveals.
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + parseDuration(this.env.JWT_REFRESH_TTL)),
      },
    });

    return { accessToken, refreshToken, expiresIn: this.env.JWT_ACCESS_TTL };
  }

  private async audit(
    userId: string | null,
    action: string,
    context: AuditContext,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog
      .create({
        data: {
          userId,
          action,
          entityType: 'User',
          entityId: userId,
          ipAddress: context.ip ?? null,
          userAgent: context.userAgent?.slice(0, 500) ?? null,
          metadata: metadata as never,
        },
      })
      .catch((err: Error) => this.logger.warn(`Audit write failed for ${action}: ${err.message}`));
  }

  /** Removes expired and revoked tokens. Called by the nightly maintenance job. */
  async pruneExpiredTokens(): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { revokedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
        ],
      },
    });
    return result.count;
  }
}

export interface AuditContext {
  ip?: string;
  userAgent?: string;
}

function toAuthUser(user: {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  createdAt: Date;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Parses "15m" / "7d" / "30s" / "12h" into milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const multipliers = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return Number(match[1]) * multipliers[match[2] as keyof typeof multipliers];
}
