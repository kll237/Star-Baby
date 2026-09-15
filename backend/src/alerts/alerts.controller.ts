import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AlertService } from './alerts.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { Role } from '@prisma/client';

@ApiTags('危机升级告警 Alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PARENT, Role.TEACHER)
@Controller('alerts')
export class AlertController {
  constructor(private readonly alerts: AlertService) {}

  @Post('demo-trigger')
  @ApiOperation({
    summary:
      '演示触发危机：走完整短信/邮件/站内信/弹窗升级闭环（仅验收用）。scenario=CRISIS 情绪危机；SELF_HARM 自残紧急弹窗',
  })
  demoTrigger(
    @CurrentUser() user: AuthUser,
    @Body() body: { studentId: string; scenario?: 'CRISIS' | 'SELF_HARM' },
  ) {
    void user;
    return this.alerts.demoTrigger(body.studentId, body.scenario ?? 'CRISIS');
  }

  @Get('logs')
  @ApiOperation({ summary: '查询某学生的危机触达日志（短信/邮件/站内信投递记录）' })
  logs(@CurrentUser() user: AuthUser, @Query('studentId') studentId: string) {
    return this.alerts.listLogs(studentId, user.userId);
  }

  @Get('contacts')
  @ApiOperation({ summary: '查询某学生的监护联系人及可用触达渠道' })
  contacts(@CurrentUser() user: AuthUser, @Query('studentId') studentId: string) {
    return this.alerts.getContacts(studentId, user.userId);
  }
}
