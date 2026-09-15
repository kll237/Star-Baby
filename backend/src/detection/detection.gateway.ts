import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { DetectionService } from './detection.service';
import { ChatService } from '../chat/chat.service';
import { DeskPetService } from '../deskpet/deskpet.service';
import { CacheService } from '../cache/cache.service';
import { AlertService } from '../alerts/alerts.service';
import { normalizeScores, computeCompositeScore } from './detection.math';
import { RISK_BEHAVIORS, riskLevelOf, type RiskLevelKey } from './detection.taxonomy';

interface WsUser {
  sub: string;
  role: 'PARENT' | 'TEACHER' | 'STUDENT';
  name?: string;
}

interface FramePayload {
  sessionId: string;
  emotionScores: Record<string, number>;
  behaviors?: { behavior: string; confidence: number; source?: string }[];
  ts?: number;
}

/**
 * 实时检测 WebSocket 网关（命名空间 /detection）。
 * - 学生端连接后加入房间 student:{studentId}，持续发送 'frame'。
 * - 服务端校验会话归属 → 落库 → 向该学生房间广播 'realtime'（家长/教师端 + 阶段六桌宠订阅同一房间）。
 * 推送延迟目标 ≤200ms。
 */
@WebSocketGateway({ namespace: '/detection', cors: { origin: true, credentials: true } })
export class DetectionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(DetectionGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly detection: DetectionService,
    private readonly chat: ChatService,
    private readonly deskpet: DeskPetService,
    private readonly cache: CacheService,
    private readonly alerts: AlertService,
  ) {}

  /** 风险行为升级节流：同一学生同一行为 60s 内仅升级一次，避免重复骚扰监护人。 */
  private riskThrottle = new Map<string, number>();
  private shouldEscalate(studentId: string, behavior: string): boolean {
    const key = `${studentId}:${behavior}`;
    const last = this.riskThrottle.get(key) ?? 0;
    const now = Date.now();
    if (now - last < 60_000) return false;
    this.riskThrottle.set(key, now);
    return true;
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string) ||
        this.extractBearer(client.handshake.headers.authorization);
      if (!token) throw new WsException('未提供令牌');
      const payload = this.jwt.verify<WsUser>(token);
      client.data.user = payload;

      if (payload.role === 'STUDENT') {
        client.join(this.room(payload.sub));
      } else {
        // 家长/教师：加入其关联的全部学生房间，实时接收数据
        const students = await this.prisma.student.findMany({
          where: { OR: [{ ownerId: payload.sub }, { guardians: { some: { id: payload.sub } } }] },
          select: { id: true },
        });
        for (const s of students) client.join(this.room(s.id));
      }
      client.emit('ready', { role: payload.role, studentId: payload.sub });
    } catch (err) {
      this.logger.warn(`检测网关连接拒绝：${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    void client;
  }

  @SubscribeMessage('frame')
  async onFrame(@ConnectedSocket() client: Socket, @MessageBody() payload: FramePayload) {
    const user = client.data.user as WsUser | undefined;
    if (!user) throw new WsException('未认证');

    const session = await this.prisma.detectionSession.findUnique({
      where: { id: payload.sessionId },
    });
    if (!session) throw new WsException('会话不存在');
    if (user.role === 'STUDENT' && session.studentId !== user.sub)
      throw new WsException('无权写入该会话');

    const result = await this.detection.appendFrame(session.studentId, {
      sessionId: payload.sessionId,
      emotionScores: payload.emotionScores,
      behaviors: payload.behaviors ?? [],
      ts: payload.ts,
    });

    const scores = normalizeScores(payload.emotionScores);
    const composite = computeCompositeScore(scores);
    const risk = result.behaviors.some((b) =>
      RISK_BEHAVIORS.includes(b.behavior as any),
    );

    // 特征 7：实时风险分级（黄/橙/红）
    let riskLevel: RiskLevelKey | null = null;
    if (risk) {
      const levels = result.behaviors
        .filter((b) => RISK_BEHAVIORS.includes(b.behavior as any) || b.behavior)
        .map((b) => riskLevelOf(b.behavior));
      riskLevel = levels.includes('red') ? 'red' : levels.includes('orange') ? 'orange' : 'yellow';
    } else if (composite.compositeScore < 30) {
      riskLevel = 'orange'; // 综合分极低且无明确风险行为：升级关注
    }

    const broadcast = {
      studentId: session.studentId,
      sessionId: session.id,
      ts: new Date(payload.ts ?? Date.now()).toISOString(),
      dominant: composite.dominant,
      compositeScore: composite.compositeScore,
      negative: composite.negative,
      scores: scores as Record<string, number>,
      behaviors: result.behaviors,
      risk,
      riskLevel,
    };

    // 向该学生房间（含家长/教师/桌宠）广播实时数据
    this.server.to(this.room(session.studentId)).emit('realtime', broadcast);
    // 风险行为单独特急广播
    if (risk) {
      this.server.to(this.room(session.studentId)).emit('risk', broadcast);

      // 危机升级：自残/高危行为 → 短信 + 邮件 + 紧急弹窗（多级监护人提醒）
      const riskyBehaviors = result.behaviors.filter((b) =>
        RISK_BEHAVIORS.includes(b.behavior as any),
      );
      for (const b of riskyBehaviors) {
        if (!this.shouldEscalate(session.studentId, b.behavior)) continue;
        const emergency = b.behavior === 'self_injury' || riskLevel === 'red';
        void this.alerts
          .recordRisk({
            studentId: session.studentId,
            kind: b.behavior,
            riskLevel: riskLevel ?? 'yellow',
            sourceText: `实时检测识别到风险行为：${b.behavior}（置信度 ${(b.confidence * 100).toFixed(0)}%）`,
            emergency,
            sessionId: session.id,
          })
          .catch(() => {});
      }
    }

    // 阶段六：将检测结果映射为桌宠反应并分发（WebSocket + MQTT）
    this.deskpet.handleDetection(session.studentId, broadcast).catch(() => {});

    // 阶段七：新检测帧写入后失效看板缓存，保证家长端看板最终一致
    this.cache.deleteByPrefix('dashboard:').catch(() => {});

    // 阶段三：持续负向情绪 → 自动触发安抚对话（节流在 ChatService 内完成）
    if (broadcast.negative) {
      this.tryComfort(session.studentId, composite.dominant, composite.compositeScore).catch(() => {});
    }
    return { ok: true, compositeScore: composite.compositeScore };
  }

  /** 尝试由情绪检测结果自动开启一段安抚对话，并向房间广播 'comfort' 事件。 */
  private async tryComfort(studentId: string, emotionKey: string, compositeScore: number) {
    try {
      const res = await this.chat.maybeAutoStartComfort(studentId, emotionKey, compositeScore);
    if (res) {
      this.server.to(this.room(studentId)).emit('comfort', {
        session: res.session,
        messages: res.messages,
      });
      // 阶段六：安抚开启时让桌宠给出陪伴反应
      const firstAssistant = res.messages.find((m) => m.role === 'ASSISTANT');
      this.deskpet.handleComfort(studentId, { message: firstAssistant?.content }).catch(() => {});
    }
    } catch {
      // 安抚触发失败不应影响检测主流程
    }
  }

  private room(studentId: string) {
    return `student:${studentId}`;
  }

  private extractBearer(header?: string): string | undefined {
    if (!header) return undefined;
    const m = /^Bearer\s+(.+)$/i.exec(header);
    return m ? m[1] : undefined;
  }
}
