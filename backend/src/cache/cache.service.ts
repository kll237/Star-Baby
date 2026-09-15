import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export interface CacheOptions {
  /** 缓存有效期（秒），默认 30s */
  ttlSeconds?: number;
}

/**
 * 应用层缓存封装：基于 RedisService（自动降级为内存存储）。
 * - 统一 key 前缀，避免与其它用途的 Redis 键冲突；
 * - 透明 JSON 序列化 / 反序列化，读取失败自动回退（不抛错，宁可穿透到源）；
 * - 支持按前缀批量失效（缓存一致性）。
 *
 * 目的：缓解阶段四/五中计算密集的看板聚合与知识库检索在并发访问下的压力，
 * 配合「写时失效」策略保证数据最终一致。
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly prefix = 'spc:cache:';

  constructor(private readonly redis: RedisService) {}

  private fullKey(key: string): string {
    return this.prefix + key;
  }

  /** 读取并反序列化为对象；未命中或解析失败时返回 null（调用方应回源）。 */
  async getJSON<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(this.fullKey(key));
      if (raw == null) return null;
      return JSON.parse(raw) as T;
    } catch (e) {
      this.logger.warn(`cache getJSON 失败(${key}): ${(e as Error).message}`);
      return null;
    }
  }

  /** 写入 JSON（带 TTL）；失败仅告警，不阻断主流程。 */
  async setJSON<T>(key: string, value: T, ttlSeconds = 30): Promise<void> {
    try {
      await this.redis.set(this.fullKey(key), JSON.stringify(value), 'EX', ttlSeconds);
    } catch (e) {
      this.logger.warn(`cache setJSON 失败(${key}): ${(e as Error).message}`);
    }
  }

  /** 删除单个键。 */
  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(this.fullKey(key));
    } catch (e) {
      this.logger.warn(`cache delete 失败(${key}): ${(e as Error).message}`);
    }
  }

  /** 按前缀批量失效（用于「写时失效」）。 */
  async deleteByPrefix(prefix: string): Promise<void> {
    try {
      await this.redis.delByPrefix(this.fullKey(prefix));
    } catch (e) {
      this.logger.warn(`cache deleteByPrefix 失败(${prefix}): ${(e as Error).message}`);
    }
  }

  /** 生成命名空间化的缓存键，避免不同维度数据相互覆盖。 */
  static key(namespace: string, parts: Array<string | number | undefined>): string {
    return [namespace, ...parts.map((p) => (p === undefined ? '' : String(p)))].join(':');
  }
}
