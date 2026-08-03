import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppConfig } from '../common/config/configuration';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * A single shared ioredis connection for cache reads/writes.
 *
 * BullMQ deliberately gets its own connections (see jobs/queue.module.ts):
 * it issues blocking commands, and sharing a connection between blocking reads
 * and ordinary GET/SET traffic stalls the latter behind the former.
 */
export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>) => {
    const logger = new Logger('Redis');
    const url = config.get('env', { infer: true }).REDIS_URL;

    const client = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      // Cache is an optimisation, never a dependency: fail the command fast and
      // let the caller fall through to Postgres instead of queueing forever.
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
      lazyConnect: false,
    });

    client.on('error', (err: Error) => logger.warn(`Redis error: ${err.message}`));
    client.on('ready', () => logger.log('Redis connection ready'));
    client.on('reconnecting', () => logger.warn('Redis reconnecting'));

    return client;
  },
};
