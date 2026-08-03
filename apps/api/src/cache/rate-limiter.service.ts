import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until at least one token is available again. */
  retryAfterMs: number;
}

/**
 * Distributed token bucket.
 *
 * Market-data licences are priced and enforced per account, not per process, so
 * counting in memory would let N API replicas each spend the full quota and
 * breach the contract. The bucket state lives in Redis and refills lazily; the
 * whole check-and-consume runs as one Lua script so concurrent replicas cannot
 * interleave a read with someone else's write.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  /**
   * KEYS[1] bucket hash. ARGV: capacity, refillPerMs, nowMs, cost, ttlSec.
   * Returns { allowed, remainingTokens(scaled), retryAfterMs }.
   */
  private static readonly SCRIPT = `
    local key       = KEYS[1]
    local capacity  = tonumber(ARGV[1])
    local refillRate= tonumber(ARGV[2])
    local now       = tonumber(ARGV[3])
    local cost      = tonumber(ARGV[4])
    local ttl       = tonumber(ARGV[5])

    local bucket = redis.call("HMGET", key, "tokens", "ts")
    local tokens = tonumber(bucket[1])
    local ts     = tonumber(bucket[2])

    if tokens == nil then
      tokens = capacity
      ts = now
    else
      local elapsed = math.max(0, now - ts)
      tokens = math.min(capacity, tokens + elapsed * refillRate)
      ts = now
    end

    local allowed = 0
    local retryAfter = 0
    if tokens >= cost then
      tokens = tokens - cost
      allowed = 1
    else
      retryAfter = math.ceil((cost - tokens) / refillRate)
    end

    redis.call("HMSET", key, "tokens", tokens, "ts", ts)
    redis.call("EXPIRE", key, ttl)
    return { allowed, math.floor(tokens), retryAfter }
  `;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * @param bucket   Logical bucket name, e.g. `market-data` or `ai:user:<id>`.
   * @param perMinute Permitted operations per minute.
   * @param cost     How many tokens this operation consumes. A batch quote
   *                 request for 50 symbols costs 1 if the provider bills per
   *                 call, or 50 if it bills per symbol — configure to match
   *                 the contract.
   */
  async consume(bucket: string, perMinute: number, cost = 1): Promise<RateLimitDecision> {
    const capacity = Math.max(1, perMinute);
    const refillPerMs = perMinute / 60_000;
    try {
      const result = (await this.redis.eval(
        RateLimiterService.SCRIPT,
        1,
        `ratelimit:${bucket}`,
        capacity,
        refillPerMs,
        Date.now(),
        cost,
        // Keep the bucket around long enough that a quiet period does not reset
        // it to full and hand out a free burst.
        Math.ceil(120 + capacity / Math.max(refillPerMs * 1000, 0.001)),
      )) as [number, number, number];

      return { allowed: result[0] === 1, remaining: result[1], retryAfterMs: result[2] };
    } catch (err) {
      // Fail *closed* for outbound provider calls: exceeding a licensed rate
      // limit has contractual consequences, whereas a briefly degraded price
      // feed does not. The caller falls back to cached quotes.
      this.logger.warn(`Rate limiter unavailable, denying ${bucket}: ${(err as Error).message}`);
      return { allowed: false, remaining: 0, retryAfterMs: 1_000 };
    }
  }
}
