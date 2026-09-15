import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateSessionDto,
  AppendFrameDto,
  EndSessionDto,
  HistoryQueryDto,
} from './dto/detection.dto';
import {
  computeCompositeScore,
  normalizeScores,
  clamp,
} from './detection.math';
import { BEHAVIOR_LABELS } from './detection.taxonomy';

@Injectable()
export class DetectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createSession(
    operatorId: string,
    dto: CreateSessionDto,
  ): Promise<{ sessionId: string; studentId: string }> {
    const student = await this.prisma.student.findUnique({
      where: { id: dto.studentId },
    });
    if (!student) throw new NotFoundException('学生不存在');

    const session = await this.prisma.detectionSession.create({
      data: {
        studentId: dto.studentId,
        source: dto.source ?? 'CAMERA',
        deviceInfo: dto.deviceInfo,
      },
    });
    await this.audit.log({
      userId: operatorId,
      action: 'detection.session.create',
      resource: 'DetectionSession',
      detail: { sessionId: session.id, studentId: dto.studentId },
    });
    return { sessionId: session.id, studentId: session.studentId };
  }

  /**
   * 追加一帧情绪 + 行为数据。
   * 情绪帧每帧必存；行为仅在有命中点时存为事件，避免噪声写入。
   */
  async appendFrame(
    studentId: string,
    dto: AppendFrameDto,
  ): Promise<{ frameId: string; compositeScore: number; dominant: string; negative: boolean; behaviors: { behavior: string; confidence: number; source: string }[] }> {
    const session = await this.prisma.detectionSession.findUnique({
      where: { id: dto.sessionId },
    });
    if (!session) throw new NotFoundException('检测会话不存在');
    if (session.studentId !== studentId)
      throw new BadRequestException('会话与该学生不匹配');
    if (session.status === 'ENDED')
      throw new BadRequestException('会话已结束，无法追加数据');

    const scores = normalizeScores(dto.emotionScores);
    const { compositeScore, dominant, negative } = computeCompositeScore(scores);

    const ts = dto.ts ? new Date(dto.ts) : new Date();

    const frame = await this.prisma.emotionFrame.create({
      data: {
        sessionId: dto.sessionId,
        studentId,
        ts,
        scores: scores as any,
        dominant,
        compositeScore,
        negative,
      },
    });

    const behaviors: { behavior: string; confidence: number; source: string }[] = [];
    if (dto.behaviors && dto.behaviors.length > 0) {
      await this.prisma.behaviorEvent.createMany({
        data: dto.behaviors.map((b) => ({
          sessionId: dto.sessionId,
          studentId,
          ts,
          behavior: b.behavior,
          confidence: clamp(b.confidence, 0, 1),
          source: b.source ?? 'motion',
        })),
      });
      for (const b of dto.behaviors) {
        behaviors.push({
          behavior: b.behavior,
          confidence: clamp(b.confidence, 0, 1),
          source: b.source ?? 'motion',
        });
      }
    }

    return {
      frameId: frame.id,
      compositeScore,
      dominant,
      negative,
      behaviors,
    };
  }

  async endSession(
    operatorId: string,
    dto: EndSessionDto,
  ): Promise<{ sessionId: string; endedAt: string }> {
    const session = await this.prisma.detectionSession.findUnique({
      where: { id: dto.sessionId },
    });
    if (!session) throw new NotFoundException('检测会话不存在');
    const updated = await this.prisma.detectionSession.update({
      where: { id: dto.sessionId },
      data: { status: 'ENDED', endedAt: new Date(), fps: dto.fps },
    });
    await this.audit.log({
      userId: operatorId,
      action: 'detection.session.end',
      resource: 'DetectionSession',
      detail: { sessionId: updated.id },
    });
    return { sessionId: updated.id, endedAt: updated.endedAt!.toISOString() };
  }

  async listSessions(studentId: string, query: HistoryQueryDto) {
    const where: any = { studentId };
    if (query.from || query.to) {
      where.startedAt = {};
      if (query.from) where.startedAt.gte = new Date(query.from);
      if (query.to) where.startedAt.lte = new Date(query.to);
    }
    const sessions = await this.prisma.detectionSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: query.limit ?? 50,
      select: {
        id: true,
        source: true,
        status: true,
        fps: true,
        startedAt: true,
        endedAt: true,
      },
    });
    return sessions;
  }

  async getSessionFrames(studentId: string, sessionId: string) {
    const session = await this.prisma.detectionSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.studentId !== studentId)
      throw new NotFoundException('会话不存在或无权限');

    const [frames, events] = await Promise.all([
      this.prisma.emotionFrame.findMany({
        where: { sessionId },
        orderBy: { ts: 'asc' },
        select: { id: true, ts: true, scores: true, dominant: true, compositeScore: true, negative: true },
      }),
      this.prisma.behaviorEvent.findMany({
        where: { sessionId },
        orderBy: { ts: 'asc' },
        select: { id: true, ts: true, behavior: true, confidence: true, source: true },
      }),
    ]);

    return {
      session: {
        id: session.id,
        source: session.source,
        status: session.status,
        fps: session.fps,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
      },
      frames: frames.map((f) => ({
        id: f.id,
        ts: f.ts.toISOString(),
        scores: f.scores as Record<string, number>,
        dominant: f.dominant,
        compositeScore: f.compositeScore,
        negative: f.negative,
      })),
      behaviors: events.map((e) => ({
        id: e.id,
        ts: e.ts.toISOString(),
        behavior: e.behavior,
        behaviorLabel: BEHAVIOR_LABELS[e.behavior as keyof typeof BEHAVIOR_LABELS] ?? e.behavior,
        confidence: e.confidence,
        source: e.source,
      })),
    };
  }

  /** 行为频次统计（供看板，阶段四复用） */
  async behaviorStats(studentId: string, from?: string, to?: string) {
    const where: any = { studentId };
    if (from || to) {
      where.ts = {};
      if (from) where.ts.gte = new Date(from);
      if (to) where.ts.lte = new Date(to);
    }
    const events = await this.prisma.behaviorEvent.findMany({
      where,
      select: { behavior: true, confidence: true },
    });
    const stats: Record<string, { count: number; avgConfidence: number }> = {};
    for (const e of events) {
      const s = (stats[e.behavior] = stats[e.behavior] ?? { count: 0, avgConfidence: 0 });
      s.count += 1;
      s.avgConfidence += e.confidence;
    }
    for (const k of Object.keys(stats)) {
      stats[k].avgConfidence = stats[k].count ? stats[k].avgConfidence / stats[k].count : 0;
    }
    return stats;
  }
}
