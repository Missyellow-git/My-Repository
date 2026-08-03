import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { RateLimiterService } from './rate-limiter.service';
import { redisProvider } from './redis.provider';

@Global()
@Module({
  providers: [redisProvider, CacheService, RateLimiterService],
  exports: [redisProvider, CacheService, RateLimiterService],
})
export class CacheModule {}
