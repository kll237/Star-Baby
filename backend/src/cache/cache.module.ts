import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { CacheService } from './cache.service';

/**
 * 缓存模块：提供 CacheService（依赖 RedisService）。
 * 其余模块通过 `imports: [CacheModule]` 后注入 CacheService 使用。
 */
@Module({
  imports: [RedisModule],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
