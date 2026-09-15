import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

interface MemEntry {
  value: string;
  expireAt?: number;
}

/**
 * Redis 封装：
 * - 客户端在 onModuleInit 中创建并连接；连接成功则使用真实 Redis（缓存/会话/登录限流）。
 * - 若 Redis 不可达（开发环境、容器未启动等），自动降级为进程内内存存储，
 *   保证核心登录限流逻辑在单机环境下仍可运行（生产环境应部署 Redis 以获得多实例一致性）。
 * - 注意：构造时并不创建客户端，避免在 Redis 不可用时产生半初始化连接。
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private readonly mem = new Map<string, MemEntry>();
  /** 标记是否使用真实 Redis */
  readonly usingRedis = false;
  private cfg: any;

  constructor(config: ConfigService) {
    this.cfg = config.get('redis') || {};
  }

  async onModuleInit() {
    try {
      const client = new Redis({
        host: this.cfg.host || '127.0.0.1',
        port: this.cfg.port || 6379,
        password: this.cfg.password || undefined,
        db: this.cfg.db || 0,
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 2,
        // 连接失败时不再自动重连，直接降级为内存存储，避免阻塞启动
        retryStrategy: null,
      });
      await client.connect();
      this.client = client;
      (this as { usingRedis: boolean }).usingRedis = true;
      this.logger.log('Redis connected.');
    } catch (e) {
      this.logger.warn(`Redis 不可用，降级为内存存储：${(e as Error).message}`);
      this.client = null;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        /* ignore */
      }
    }
  }

  private now() {
    return Date.now();
  }

  private isExpired(e?: MemEntry): boolean {
    return !!e && !!e.expireAt && e.expireAt < this.now();
  }

  async set(key: string, value: string, mode?: string, seconds?: number): Promise<string | null> {
    if (this.client) return this.client.set(key, value, mode as any, seconds as any);
    const expireAt = mode === 'EX' && seconds ? this.now() + seconds * 1000 : undefined;
    this.mem.set(key, { value, expireAt });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    if (this.client) return this.client.get(key);
    const e = this.mem.get(key);
    if (!e || this.isExpired(e)) {
      this.mem.delete(key);
      return null;
    }
    return e.value;
  }

  async incr(key: string): Promise<number> {
    if (this.client) return this.client.incr(key);
    const e = this.mem.get(key);
    const current = e && !this.isExpired(e) ? Number(e.value) || 0 : 0;
    const next = current + 1;
    this.mem.set(key, { value: String(next), expireAt: e?.expireAt });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (this.client) return this.client.expire(key, seconds);
    const e = this.mem.get(key);
    if (e) e.expireAt = this.now() + seconds * 1000;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    if (this.client) return this.client.ttl(key);
    const e = this.mem.get(key);
    if (!e) return -2;
    if (!e.expireAt) return -1;
    return Math.max(0, Math.ceil((e.expireAt - this.now()) / 1000));
  }

  /**
   * 健康检查探针：探测 Redis 是否可用。
   * - 真实 Redis：PING，返回延迟；
   * - 内存降级：视为可用（单机/未配置 Redis 场景），mode=memory。
   */
  async ping(): Promise<{ ok: boolean; mode: 'redis' | 'memory'; latencyMs?: number; error?: string }> {
    if (this.client) {
      try {
        const t0 = Date.now();
        const r = await this.client.ping();
        return { ok: r === 'PONG', mode: 'redis', latencyMs: Date.now() - t0 };
      } catch (e) {
        return { ok: false, mode: 'redis', error: (e as Error).message };
      }
    }
    return { ok: true, mode: 'memory' };
  }

  async del(...keys: string[]): Promise<number> {
    if (this.client) return this.client.del(...keys);
    let n = 0;
    for (const k of keys) if (this.mem.delete(k)) n++;
    return n;
  }

  /**
   * 分布式锁（阶段八：跨进程去重）。
   * 用于在多个后端实例同时订阅同一 MQTT 设备主题时，确保同一条设备消息只被一个实例处理，
   * 避免重复持久化 / 重复下发。
   * - 真实 Redis：SET key 1 NX EX ttl，返回 'OK' 表示抢锁成功；
   * - 内存降级：进程内带过期标记的简单锁，仅在单实例场景生效。
   */
  async tryLock(key: string, ttlSec = 5): Promise<boolean> {
    if (this.client) {
      const r = await (this.client as any).set(key, '1', 'NX', 'EX', ttlSec);
      return r === 'OK';
    }
    const k = `lock:${key}`;
    const e = this.mem.get(k);
    if (e && !this.isExpired(e)) return false;
    this.mem.set(k, { value: '1', expireAt: this.now() + ttlSec * 1000 });
    return true;
  }

  /**
   * 按前缀批量删除（用于缓存失效）。
   * - 真实 Redis：SCAN 匹配后批量 DEL（避免 KEYS 阻塞）。
   * - 内存降级：遍历内存 Map 删除匹配键。
   */
  async delByPrefix(prefix: string): Promise<number> {
    if (this.client) {
      let cursor = '0';
      let deleted = 0;
      do {
        const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
        cursor = next;
        if (keys.length) deleted += await this.client.del(...keys);
      } while (cursor !== '0');
      return deleted;
    }
    let n = 0;
    for (const k of [...this.mem.keys()]) {
      if (k.startsWith(prefix)) {
        this.mem.delete(k);
        n++;
      }
    }
    return n;
  }
}
