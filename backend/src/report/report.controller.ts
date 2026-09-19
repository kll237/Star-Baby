import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Res,
  Req,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, Subscriber } from 'rxjs';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReportService } from './report.service';
import { ReportQueryDto, ExportReportDto } from './dto/report.dto';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { RISK_SOP } from '../detection/detection.taxonomy';
import type { AuthUser } from '../common/interfaces/auth-user.interface';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportController {
  constructor(private readonly report: ReportService) {}

  @Get('students/:id/dashboard')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async dashboard(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: string, @Query() q: ReportQueryDto) {
    await this.report.assertStudentAccess(user, id);
    return this.report.getDashboard(id, q.period, q.from, q.to, q.granularity);
  }

  /**
   * SSE 流式输出情绪分析报告：与 WebSocket（设备状态/告警）形成双通道。
   * 前端用 EventSource 订阅，服务端按行切片逐段下发，模拟流式渲染。
   */
  @Sse('students/:id/analysis-stream')
  @Roles('PARENT', 'TEACHER', 'STUDENT', 'ADMIN')
  async analysisStream(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIdPipe) id: string,
    @Query() q: ReportQueryDto,
  ): Promise<Observable<MessageEvent>> {
    await this.report.assertStudentAccess(user, id);
    const dash = await this.report.getDashboard(id, q.period, q.from, q.to, q.granularity);
    const text: string = (dash as any)?.narrative?.narrative || '暂无可用的情绪分析数据。';
    const chunks = text.split('\n').filter((c) => c.trim().length > 0);
    return new Observable<MessageEvent>((subscriber: Subscriber<MessageEvent>) => {
      let i = 0;
      const timer = setInterval(() => {
        if (i >= chunks.length) {
          subscriber.next({ data: '[DONE]' });
          clearInterval(timer);
          subscriber.complete();
          return;
        }
        subscriber.next({ data: chunks[i++] + '\n' });
      }, 120);
      return () => clearInterval(timer);
    });
  }

  @Get('students/:id/trend')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async trend(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: string, @Query() q: ReportQueryDto) {
    await this.report.assertStudentAccess(user, id);
    return this.report.getTrend(id, q.period, q.from, q.to, q.granularity);
  }

  @Get('students/:id/risk-events')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async riskEvents(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: string, @Query() q: ReportQueryDto) {
    await this.report.assertStudentAccess(user, id);
    return this.report.getRiskEvents(id, q.period, q.from, q.to);
  }

  @Get('students/:id/comfort-stats')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async comfortStats(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: string, @Query() q: ReportQueryDto) {
    await this.report.assertStudentAccess(user, id);
    return this.report.getComfortStats(id, q.period, q.from, q.to);
  }

  @Get('students/:id/intervention')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async intervention(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: string, @Query() q: ReportQueryDto) {
    await this.report.assertStudentAccess(user, id);
    return this.report.getIntervention(id, q.period, q.from, q.to);
  }

  @Get('students/:id/weekly-narrative')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async weeklyNarrative(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: string, @Query() q: ReportQueryDto) {
    await this.report.assertStudentAccess(user, id);
    const dash = await this.report.getDashboard(id, q.period, q.from, q.to);
    return { studentId: id, period: dash.period, narrative: dash.narrative.narrative, highlights: dash.narrative.highlights };
  }

  @Get('students/:id/risk-summary')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async riskSummary(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: string, @Query() q: ReportQueryDto) {
    await this.report.assertStudentAccess(user, id);
    const dash = await this.report.getDashboard(id, q.period, q.from, q.to);
    return {
      studentId: id,
      period: dash.period,
      riskLevels: dash.riskLevels,
      sop: RISK_SOP,
    };
  }

  @Get('students/:id/records')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async records(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: string) {
    await this.report.assertStudentAccess(user, id);
    return this.report.listRecords(id);
  }

  @Post('students/:id/export')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: ExportReportDto,
    @Res() res: Response,
  ) {
    await this.report.assertStudentAccess(user, id);
    const uid = (user as any).sub ?? (user as any).userId;
    const result = await this.report.exportReport(
      id,
      dto.format,
      dto.period,
      dto.from,
      dto.to,
      uid,
    );
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.content);
  }
}
