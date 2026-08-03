import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfig } from './common/config/configuration';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  const config = app.get(ConfigService<AppConfig, true>);
  const env = config.get('env', { infer: true });
  const corsOrigins = config.get('corsOrigins', { infer: true });

  app.setGlobalPrefix(`${env.API_GLOBAL_PREFIX}/v1`, {
    // Probes must answer at a stable path that does not move with API versions.
    exclude: ['health', 'health/ready', 'health/providers'],
  });

  app.use(
    helmet({
      // The API serves JSON and file downloads only; a restrictive CSP here
      // costs nothing and blocks content-sniffing surprises on the Swagger page.
      contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'Content-Disposition'],
  });

  // Request payloads are validated per-endpoint with Zod schemas; this pipe is
  // the backstop for the few DTO-decorated bodies and enforces the size floor.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
  );

  app.enableShutdownHooks();
  app.get(PrismaService).enableShutdownHooks(app);

  if (env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('FundLens API')
      .setDescription(
        'Live portfolio X-ray for Indian mutual fund schemes. Search any scheme, read its latest ' +
          'disclosed holdings joined with market prices, and query the portfolio in natural language.\n\n' +
          '**Data provenance:** holdings come from published monthly disclosures and may lag the ' +
          "fund's current positions; every holdings response carries `snapshot.stale` and " +
          '`priceCoverage` so clients can show the true freshness of what they display.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('funds', 'Scheme search and metadata')
      .addTag('holdings', 'Disclosed portfolio holdings with live prices')
      .addTag('analytics', 'Portfolio analytics, comparison and overlap')
      .addTag('ai', 'Natural-language questions and generated commentary')
      .addTag('export', 'CSV and Excel downloads')
      .addTag('me', 'Favourites, watchlists, preferences, notifications')
      .addTag('alerts', 'Alert rules')
      .build();

    SwaggerModule.setup(
      `${env.API_GLOBAL_PREFIX}/docs`,
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
      { swaggerOptions: { persistAuthorization: true } },
    );
    logger.log(`API docs at http://localhost:${env.API_PORT}/${env.API_GLOBAL_PREFIX}/docs`);
  }

  await app.listen(env.API_PORT, '0.0.0.0');
  logger.log(`FundLens API listening on port ${env.API_PORT} (${env.NODE_ENV})`);
  logger.log(`Market data: ${env.MARKET_DATA_PROVIDER} | Disclosures: ${env.DISCLOSURE_PROVIDER}`);
}

bootstrap().catch((err: Error) => {
  // Configuration errors surface here. Exit non-zero so the orchestrator does
  // not route traffic to a process that came up misconfigured.
  // eslint-disable-next-line no-console
  console.error('Failed to start FundLens API:', err.message);
  process.exit(1);
});
