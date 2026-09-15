import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { ServerOptions } from 'socket.io';
import { ConfigService } from '@nestjs/config';

/**
 * Socket.IO Redis 适配器（阶段八：真实 MQTT 跨进程联动 的 WebSocket 一侧）。
 *
 * - 配置了 REDIS_HOST → 启用 @socket.io/redis-adapter，使 WebSocket 广播（如桌宠 pet_state）
 *   在多个后端实例间一致：连接到实例 A 的客户端也能收到实例 B 产生的事件，实现真正的水平扩展。
 * - 未配置 REDIS_HOST → 回退为默认内存适配器（单机 / 开发）。
 *
 * 通过动态 require 引入 @socket.io/redis-adapter / ioredis，避免可选依赖缺失时编译或启动失败。
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterCtor: any = null;

  constructor(
    app: INestApplicationContext,
    private readonly config: ConfigService,
  ) {
    super(app);
  }

  async connectWithRedis(): Promise<void> {
    const cfg = this.config.get('redis') || {};
    if (!cfg.host) {
      this.logger.log('未配置 REDIS_HOST，Socket.IO 使用内存适配器（单机模式）');
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Redis = require('ioredis');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const adapterMod = require('@socket.io/redis-adapter');
      const createAdapter = adapterMod.createAdapter || adapterMod.default?.createAdapter;

      // 与 RedisService 对齐的稳健连接策略：
      // - lazyConnect: 显式 connect() 并在失败时立即降级，避免阻塞启动；
      // - retryStrategy: null：连接失败不再自动重连，直接退回内存适配器；
      // - maxRetriesPerRequest: 1 + error 处理器：Redis 不可用时离线队列不会
      //   抛出未被捕获的 MaxRetriesPerRequestError 导致进程崩溃；
      // - 真实部署下 Redis 恢复后由调用方重建适配器逻辑不变。
      const baseOpts = {
        host: cfg.host,
        port: cfg.port || 6379,
        password: cfg.password || undefined,
        db: cfg.db || 0,
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        retryStrategy: null as null,
      };
      const pub = new Redis(baseOpts);
      const sub = pub.duplicate();
      // 吞掉底层连接错误，防止未处理的 'error' 事件中断进程
      pub.on('error', (err: Error) => this.logger.warn(`Socket.IO Redis(pub) 错误，已降级内存适配器：${err.message}`));
      sub.on('error', (err: Error) => this.logger.warn(`Socket.IO Redis(sub) 错误，已降级内存适配器：${err.message}`));

      await pub.connect();
      await sub.connect();
      this.adapterCtor = createAdapter(pub, sub);
      this.logger.log(`Socket.IO Redis 适配器已启用（${cfg.host}:${cfg.port || 6379}）`);
    } catch (e) {
      this.logger.warn(`Socket.IO Redis 适配器启用失败，回退内存适配器：${(e as Error).message}`);
      this.adapterCtor = null;
    }
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterCtor) server.adapter(this.adapterCtor);
    return server;
  }
}
