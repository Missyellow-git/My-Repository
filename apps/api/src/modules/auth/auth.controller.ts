import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
} from '@fundlens/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './optional-jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { RequestUser } from './jwt.strategy';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  // Credential endpoints get their own tight budget regardless of the global
  // throttle, since they are the ones worth brute-forcing.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create an account (optional — the product works signed out)' })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
    @Req() request: Request,
  ) {
    return this.auth.register(input, { ip: request.ip, userAgent: request.headers['user-agent'] });
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange credentials for an access + refresh token pair' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInput,
    @Req() request: Request,
  ) {
    return this.auth.login(input, { ip: request.ip, userAgent: request.headers['user-agent'] });
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Rotate tokens',
    description: 'The presented refresh token is revoked and replaced. Reusing an old token fails.',
  })
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: { refreshToken: string },
    @Req() request: Request,
  ) {
    return this.auth.refresh(body.refreshToken, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  async logout(@Body(new ZodValidationPipe(refreshSchema)) body: { refreshToken: string }) {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user profile' })
  async me(@CurrentUser() user: RequestUser) {
    return this.auth.getProfile(user.userId);
  }
}
