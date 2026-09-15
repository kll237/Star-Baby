import {
  Controller,
  Get,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit.dto';

/**
 * 审计日志查询接口（阶段七：审计增强）。
 * - 学生 / 家长默认仅能查看自己的操作日志；
 * - 教师可传 scope=all 查看全部（用于安全审查与合规留痕）。
 */
@ApiTags('审计 Audit')
@Controller('audit')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: '查询审计日志（分页 / 过滤）' })
  async list(@CurrentUser() user: AuthUser, @Query() q: AuditQueryDto) {
    const isTeacher = (user as any).role === 'TEACHER';
    const scopeAll = q.scope === 'all' && isTeacher;
    if (q.scope === 'all' && !isTeacher) {
      throw new ForbiddenException('仅教师可查看全部审计日志');
    }
    const { items, total } = await this.audit.query({
      userId: scopeAll ? undefined : user.userId,
      action: q.action,
      resource: q.resource,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      limit: q.limit,
      offset: q.offset,
    });
    return { total, items };
  }
}
