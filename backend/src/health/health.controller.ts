import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('系统')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 存活探针（liveness）：只要进程在就返回 200，供 K8s/Docker 重启判定。 */
  @Get()
  @ApiOperation({ summary: '存活探针（liveness）：仅表明进程已启动，不含依赖探活' })
  @ApiResponse({ status: 200, description: '进程存活' })
  liveness() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 就绪探针（readiness）：探测关键依赖（数据库、Redis）是否可用。
   * - 数据库不可用 → 503；
   * - 已配置 Redis 但不可用 → 503；未配置（内存降级）视为可用。
   */
  @Get('ready')
  @ApiOperation({ summary: '就绪探针（readiness）：探测 DB / Redis 依赖，供负载均衡与监控' })
  @ApiResponse({ status: 200, description: '依赖健康' })
  @ApiResponse({ status: 503, description: '关键依赖不可用' })
  async readiness() {
    const components: Record<
      string,
      { status: 'ok' | 'fail' | 'degraded'; detail?: string; latencyMs?: number }
    > = {};

    // 数据库探测
    try {
      const t0 = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      components.db = { status: 'ok', latencyMs: Date.now() - t0 };
    } catch (e) {
      components.db = { status: 'fail', detail: (e as Error).message };
    }

    // Redis 探测
    const p = await this.redis.ping();
    if (p.mode === 'memory') {
      components.redis = { status: 'degraded', detail: '未配置 Redis，使用内存降级（多实例不一致）' };
    } else if (p.ok) {
      components.redis = { status: 'ok', latencyMs: p.latencyMs };
    } else {
      components.redis = { status: 'fail', detail: p.error };
    }

    const allOk = components.db.status === 'ok' && components.redis.status !== 'fail';
    const status = allOk ? 'ok' : 'unhealthy';
    const httpStatus = allOk ? 200 : 503;

    return {
      status,
      components,
      redisMode: p.mode,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
