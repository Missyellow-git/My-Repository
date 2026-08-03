import { z } from 'zod';

/**
 * Environment contract.
 *
 * The schema is validated once at boot and the process refuses to start if
 * anything is missing or malformed — a mis-typed rate limit or an absent JWT
 * secret must fail loudly at deploy time, never silently at 2am under load.
 *
 * Secrets are read from the environment only. Nothing here is logged: the
 * logger's redaction list (see main.ts) covers every key ending in
 * SECRET/KEY/TOKEN/PASSWORD.
 */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_GLOBAL_PREFIX: z.string().default('api'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  MARKET_DATA_PROVIDER: z.enum(['simulated', 'http']).default('simulated'),
  MARKET_DATA_BASE_URL: z.string().optional(),
  MARKET_DATA_API_KEY: z.string().optional(),
  MARKET_DATA_API_KEY_HEADER: z.string().default('x-api-key'),
  MARKET_DATA_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(100_000).default(60),
  MARKET_DATA_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  MARKET_DATA_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8000),
  PRICE_STALE_AFTER_SECONDS: z.coerce.number().int().min(30).max(86_400).default(180),
  PRICE_REFRESH_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),

  AMFI_NAV_ALL_URL: z.string().url().default('https://www.amfiindia.com/spages/NAVAll.txt'),
  SCHEME_MASTER_SYNC_CRON: z.string().default('0 30 22 * * *'),

  DISCLOSURE_PROVIDER: z.enum(['fixture', 'amc']).default('fixture'),
  DISCLOSURE_SYNC_CRON: z.string().default('0 0 3 * * *'),
  DISCLOSURE_STALE_AFTER_DAYS: z.coerce.number().int().min(30).max(365).default(75),

  AI_ENABLED: booleanish.default(true),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  AI_MAX_TOKENS: z.coerce.number().int().min(256).max(8192).default(1200),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
  AI_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(1000).default(20),

  ENABLE_BACKGROUND_JOBS: booleanish.default(true),
  THROTTLE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;

  // Cross-field rules that a per-key schema cannot express.
  if (env.MARKET_DATA_PROVIDER === 'http' && !env.MARKET_DATA_BASE_URL) {
    throw new Error('MARKET_DATA_BASE_URL is required when MARKET_DATA_PROVIDER=http');
  }
  if (env.AI_ENABLED && !env.ANTHROPIC_API_KEY && env.NODE_ENV === 'production') {
    throw new Error('ANTHROPIC_API_KEY is required in production when AI_ENABLED=true');
  }
  // A cached quote must never outlive the staleness threshold, or the UI would
  // show a "live" badge over data we already consider stale.
  if (env.PRICE_REFRESH_INTERVAL_SECONDS >= env.PRICE_STALE_AFTER_SECONDS) {
    throw new Error(
      'PRICE_REFRESH_INTERVAL_SECONDS must be smaller than PRICE_STALE_AFTER_SECONDS',
    );
  }
  if (env.NODE_ENV === 'production') {
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (env[key].includes('change-me')) {
        throw new Error(`${key} still holds the placeholder value from .env.example`);
      }
    }
  }

  return env;
}

/** Typed accessor shape registered with @nestjs/config. */
export const configuration = () => {
  const env = validateEnv(process.env);
  return {
    env,
    isProduction: env.NODE_ENV === 'production',
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
};

export type AppConfig = ReturnType<typeof configuration>;
