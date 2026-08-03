import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';

/**
 * Cache-aside helper over Redis.
 *
 * Every method is failure-tolerant on purpose. If Redis is down the service
 * degrades to "always miss" and the request still succeeds against Postgres —
 * a cache outage must never become a product outage. Failures are logged at
 * debug level to avoid flooding logs during a Redis restart.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private hits = 0;
  private misses = 0;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) {
        this.misses += 1;
        return null;
      }
      this.hits += 1;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.debug(`cache get failed for ${key}: ${(err as Error).message}`);
      this.misses += 1;
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.debug(`cache set failed for ${key}: ${(err as Error).message}`);
    }
  }

  /**
   * Classic cache-aside. `factory` runs on a miss and its result is stored.
   *
   * Note there is no in-process single-flight here: for this workload a
   * thundering herd on a cold key costs one extra Postgres read, whereas a
   * promise map would need careful eviction to avoid leaking on rejection.
   * The one place herds actually matter — the market-data fetch — is guarded
   * by the provider's own batching and rate limiter.
   */
  async getOrSet<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await factory();
    if (value !== null && value !== undefined) {
      await this.set(key, value, ttlSeconds);
    }
    return value;
  }

  /** Batch read. Returns a map containing only the keys that were present. */
  async mget<T>(keys: string[]): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    if (keys.length === 0) return out;
    try {
      const values = await this.redis.mget(keys);
      values.forEach((raw, i) => {
        if (raw === null) {
          this.misses += 1;
          return;
        }
        this.hits += 1;
        try {
          out.set(keys[i], JSON.parse(raw) as T);
        } catch {
          /* Corrupt entry — treat as a miss and let it expire. */
        }
      });
    } catch (err) {
      this.logger.debug(`cache mget failed: ${(err as Error).message}`);
    }
    return out;
  }

  /** Batch write with per-key TTL, issued as one pipeline. */
  async mset<T>(entries: Array<{ key: string; value: T; ttlSeconds: number }>): Promise<void> {
    if (entries.length === 0) return;
    try {
      const pipeline = this.redis.pipeline();
      for (const { key, value, ttlSeconds } of entries) {
        pipeline.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      }
      await pipeline.exec();
    } catch (err) {
      this.logger.debug(`cache mset failed: ${(err as Error).message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch (err) {
      this.logger.debug(`cache del failed: ${(err as Error).message}`);
    }
  }

  /**
   * Deletes by pattern using SCAN, never KEYS — KEYS blocks the Redis event
   * loop for the whole keyspace, which on a warm cache is a multi-second stall
   * affecting every request in flight.
   */
  async delByPattern(pattern: string): Promise<number> {
    let cursor = '0';
    let deleted = 0;
    try {
      do {
        const [next, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (batch.length > 0) {
          deleted += await this.redis.del(...batch);
        }
      } while (cursor !== '0');
    } catch (err) {
      this.logger.debug(`cache scan-delete failed for ${pattern}: ${(err as Error).message}`);
    }
    return deleted;
  }

  /**
   * Distributed lock via SET NX. Used to stop two API replicas from importing
   * the same disclosure or hammering the price provider simultaneously.
   * Returns null when the lock is held elsewhere.
   */
  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const res = await this.redis.set(`lock:${key}`, token, 'EX', ttlSeconds, 'NX');
      return res === 'OK' ? token : null;
    } catch {
      // Without Redis we cannot coordinate; allow the work rather than block it.
      return token;
    }
  }

  /** Releases a lock only if we still own it, so a slow holder cannot free someone else's. */
  async releaseLock(key: string, token: string): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end`;
    try {
      await this.redis.eval(script, 1, `lock:${key}`, token);
    } catch {
      /* Lock expires on its own. */
    }
  }

  /** Hit-rate counters exposed on /health/metrics. */
  stats(): { hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return { hits: this.hits, misses: this.misses, hitRate: total === 0 ? 0 : this.hits / total };
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
