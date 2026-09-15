import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  userId?: string;
  action: string;
  resource?: string;
  detail?: Record<string, any>;
  ip?: string;
}

/**
 * 审计日志服务：记录关键操作（登录、查看报告、导出、人脸注册等），
 * 满足需求的「日志记录完整，支持审计」要求。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.userId,
          action: input.action,
          resource: input.resource,
          detail: input.detail as any,
          ip: input.ip,
        },
      });
    } catch (e) {
      // 审计写入失败不应阻断主流程，仅记录
      this.logger.error(`Audit log failed: ${input.action}`, (e as Error).message);
    }
  }

  /**
   * 审计日志查询（阶段七：审计增强，便于安全回溯与合规审查）。
   * 支持按用户 / 动作 / 资源 / 时间区间过滤，分页返回。
   */
  async query(opts: {
    userId?: string;
    action?: string;
    resource?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ items: any[]; total: number }> {
    const where: Record<string, any> = {};
    if (opts.userId) where.userId = opts.userId;
    if (opts.action) where.action = opts.action;
    if (opts.resource) where.resource = opts.resource;
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) where.createdAt.gte = opts.from;
      if (opts.to) where.createdAt.lte = opts.to;
    }
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}
