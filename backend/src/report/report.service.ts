import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DetectionService } from '../detection/detection.service';
import { CacheService } from '../cache/cache.service';
import {
  bucketizeTrend,
  summarizeEmotion,
  detectRiskBursts,
  computeComfortStats,
  computeInterventionEffect,
  computeRecovery,
  computeRiskLevels,
  buildWeeklyNarrative,
  dashboardToCsv,
  periodRange,
  type DashboardData,
  type TrendGranularity,
  type EmotionFrameInput,
  type ComfortSessionInput,
  type ComfortEpisodeInput,
} from './report.aggregate';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import type { ReportPeriodType, TrendGranularityType, ReportFormatType } from './dto/report.dto';

export interface ExportResult {
  content: string;
  mime: string;
  filename: string;
  recordId: string;
}

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly detection: DetectionService,
    private readonly cache: CacheService,
  ) {}

  // ---------------- 权限 ----------------

  /** 与既有 detection/chat controller 一致的访问校验：学生仅看自己，家长/教师需为 owner 或 guardian。 */
  async assertStudentAccess(user: AuthUser, studentId: string): Promise<void> {
    const uid = (user as any).sub ?? (user as any).userId;
    if ((user as any).role === 'STUDENT') {
      if (uid !== studentId) throw new ForbiddenException('只能查看自己的数据');
      return;
    }
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { guardians: { select: { id: true } } },
    });
    if (!student) throw new ForbiddenException('学生不存在');
    const ownerOk = student.ownerId === uid;
    const guardianOk = student.guardians.some((g: any) => g.id === uid);
    if (!ownerOk && !guardianOk) throw new ForbiddenException('无权访问该学生数据');
  }

  // ---------------- 数据聚合 ----------------

  private async loadInputs(studentId: string, from: Date, to: Date) {
    const [frames, sessions] = await Promise.all([
      this.prisma.emotionFrame.findMany({
        where: { studentId, ts: { gte: from, lte: to } },
        select: { ts: true, compositeScore: true, negative: true, dominant: true },
        orderBy: { ts: 'asc' },
      }),
      this.prisma.chatSession.findMany({
        where: { studentId, startedAt: { gte: from, lte: to } },
        select: { status: true, triggerSource: true, messageCount: true },
      }),
    ]);
    const frameInputs: EmotionFrameInput[] = frames.map((f) => ({
      ts: f.ts.toISOString(),
      compositeScore: f.compositeScore,
      negative: f.negative,
      dominant: f.dominant,
    }));
    const sessionInputs: ComfortSessionInput[] = sessions.map((s) => ({
      status: s.status,
      triggerSource: s.triggerSource,
      messageCount: s.messageCount,
    }));
    return { frameInputs, sessionInputs };
  }

  async getDashboard(
    studentId: string,
    period: ReportPeriodType = 'CUSTOM',
    from?: string,
    to?: string,
    granularity: TrendGranularity = 'day',
  ): Promise<DashboardData> {
    // 读缓存：看板聚合为计算密集型，命中可显著降低 DB 与 CPU 压力
    const cacheKey = CacheService.key('dashboard', [studentId, period, from ?? '', to ?? '', granularity]);
    const cached = await this.cache.getJSON<DashboardData>(cacheKey);
    if (cached) return cached;

    const { from: f, to: t } = periodRange(period, from, to);
    const { frameInputs, sessionInputs } = await this.loadInputs(studentId, f, t);
    const behavior = await this.detection.behaviorStats(
      studentId,
      f.toISOString(),
      t.toISOString(),
    );

    const summary = summarizeEmotion(frameInputs);
    const trend = bucketizeTrend(frameInputs, granularity);
    const riskBursts = detectRiskBursts(frameInputs);
    const comfortStats = computeComfortStats(sessionInputs);
    const intervention = computeInterventionEffect(riskBursts, sessionInputs);
    const recovery = await this.computeRecoveryEpisodes(studentId, f, t);
    const riskLevels = computeRiskLevels(behavior);
    const partial: DashboardData = {
      studentId,
      period: { from: f.toISOString(), to: t.toISOString(), type: period },
      summary,
      trend,
      riskBursts,
      comfortStats,
      intervention,
      behaviorStats: behavior,
      recovery,
      riskLevels,
      narrative: { narrative: '', highlights: [] },
    };
    partial.narrative = buildWeeklyNarrative(partial);
    const result = partial;
    await this.cache.setJSON(cacheKey, result, 30);
    return result;
  }

  /**
   * 特征 2：计算「安抚介入后情绪是否回升」。
   * 对每个由检测自动触发的安抚会话，取其开始前后各一段情绪帧窗口，
   * 比较介入前后平均综合分，得到介入前/后分差与回升率（无需新增数据表，复用既有帧与对话数据）。
   */
  private async computeRecoveryEpisodes(
    studentId: string,
    from: Date,
    to: Date,
  ): Promise<{ episodes: number; recovered: number; recoveryRate: number; avgPreScore: number; avgPostScore: number; avgDelta: number }> {
    const detectionChats = await this.prisma.chatSession.findMany({
      where: { studentId, triggerSource: 'DETECTION', startedAt: { gte: from, lte: to } },
      select: { startedAt: true },
      orderBy: { startedAt: 'asc' },
    });
    const episodes: ComfortEpisodeInput[] = [];
    const WINDOW_BEFORE = 60_000; // 介入前 60s 窗口
    const WINDOW_AFTER = 120_000; // 介入后 120s 窗口
    for (const c of detectionChats) {
      const start = c.startedAt.getTime();
      const [pre, post] = await Promise.all([
        this.prisma.emotionFrame.findMany({
          where: { studentId, ts: { gte: new Date(start - WINDOW_BEFORE), lt: new Date(start) } },
          select: { compositeScore: true },
        }),
        this.prisma.emotionFrame.findMany({
          where: { studentId, ts: { gte: new Date(start), lt: new Date(start + WINDOW_AFTER) } },
          select: { compositeScore: true },
        }),
      ]);
      if (pre.length === 0 || post.length === 0) continue; // 窗口数据不足则跳过该事件
      const avg = (arr: { compositeScore: number }[]) =>
        arr.reduce((s, x) => s + x.compositeScore, 0) / arr.length;
      episodes.push({ preAvg: avg(pre), postAvg: avg(post) });
    }
    return computeRecovery(episodes);
  }

  /** 写时失效：新检测数据到达后应清除该学生看板缓存，保证一致性。 */
  async invalidateDashboard(studentId: string): Promise<void> {
    await this.cache.deleteByPrefix(`dashboard:${studentId}:`);
  }

  async getTrend(
    studentId: string,
    period: ReportPeriodType = 'CUSTOM',
    from?: string,
    to?: string,
    granularity: TrendGranularityType = 'day',
  ) {
    const dash = await this.getDashboard(studentId, period, from, to, granularity as TrendGranularity);
    return { studentId, period: dash.period, trend: dash.trend };
  }

  async getRiskEvents(
    studentId: string,
    period: ReportPeriodType = 'CUSTOM',
    from?: string,
    to?: string,
  ) {
    const dash = await this.getDashboard(studentId, period, from, to);
    return { studentId, riskBursts: dash.riskBursts, negativeRatio: dash.summary.negativeRatio };
  }

  async getComfortStats(
    studentId: string,
    period: ReportPeriodType = 'CUSTOM',
    from?: string,
    to?: string,
  ) {
    const dash = await this.getDashboard(studentId, period, from, to);
    return { studentId, comfortStats: dash.comfortStats, intervention: dash.intervention };
  }

  async getIntervention(
    studentId: string,
    period: ReportPeriodType = 'CUSTOM',
    from?: string,
    to?: string,
  ) {
    const dash = await this.getDashboard(studentId, period, from, to);
    return { studentId, intervention: dash.intervention, comfortStats: dash.comfortStats };
  }

  // ---------------- 导出 ----------------

  async exportReport(
    studentId: string,
    format: ReportFormatType,
    period: ReportPeriodType = 'CUSTOM',
    from?: string,
    to?: string,
    generatedById?: string,
  ): Promise<ExportResult> {
    const { from: f, to: t } = periodRange(period, from, to);
    const dash = await this.getDashboard(studentId, period, from, to);
    let content: string;
    let mime: string;
    let ext: string;
    if (format === 'CSV') {
      content = dashboardToCsv(dash);
      mime = 'text/csv; charset=utf-8';
      ext = 'csv';
    } else {
      content = JSON.stringify(dash, null, 2);
      mime = 'application/json';
      ext = 'json';
    }

    const record = await this.prisma.reportRecord.create({
      data: {
        studentId,
        type: period as any,
        periodFrom: f,
        periodTo: t,
        format: format as any,
        generatedById: generatedById ?? null,
      },
    });
    await this.audit.log({
      userId: generatedById ?? studentId,
      action: 'report.export',
      resource: 'ReportRecord',
      detail: { studentId, format, period, recordId: record.id },
    });

    const filename = `report_${studentId}_${period}_${Date.now()}.${ext}`;
    return { content, mime, filename, recordId: record.id };
  }

  async listRecords(studentId: string, limit = 50) {
    return this.prisma.reportRecord.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        format: true,
        periodFrom: true,
        periodTo: true,
        createdAt: true,
        generatedById: true,
      },
    });
  }
}
