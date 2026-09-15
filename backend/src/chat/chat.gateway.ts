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
import { ChatService } from './chat.service';
import { DeskPetService } from '../deskpet/deskpet.service';

interface WsUser {
  sub: string;
  role: 'PARENT' | 'TEACHER' | 'STUDENT';
}

interface MessagePayload {
  sessionId?: string;
  studentId?: string;
  content: string;
}

interface TriggerPayload {
  studentId: string;
  emotionKey?: string;
  compositeScore?: number;
  dominantScore?: number;
}

/**
 * 智能安抚对话 WebSocket 网关（命名空间 /chat）。
 * - 学生端连接后加入房间 chat:{studentId}，发送 'message' 触发多轮安抚对话；
 *   服务端调用 ChatService 生成回复，并向该房间广播 'reply'（学生端 + 家长/教师端 + 阶段六桌宠均可订阅）。
 * - 客户端也可发送 'trigger' 由情绪检测结果主动开启安抚会话。
 * 广播延迟目标 ≤200ms。
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: true, credentials: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly deskpet: DeskPetService,
  ) {}

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
        // 家长/教师：加入其关联的全部学生房间，实时旁听安抚对话
        const students = await this.prisma.student.findMany({
          where: { OR: [{ ownerId: payload.sub }, { guardians: { some: { id: payload.sub } } }] },
          select: { id: true },
        });
        for (const s of students) client.join(this.room(s.id));
      }
      client.emit('ready', { role: payload.role, studentId: payload.sub });
    } catch (err) {
      this.logger.warn(`聊天网关连接拒绝：${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    void client;
  }

  @SubscribeMessage('trigger')
  async onTrigger(@ConnectedSocket() client: Socket, @MessageBody() payload: TriggerPayload) {
    const user = client.data.user as WsUser | undefined;
    if (!user) throw new WsException('未认证');
    const studentId = payload.studentId || user.sub;
    const res = await this.chat.maybeAutoStartComfort(
      studentId,
      payload.emotionKey,
      payload.compositeScore,
      payload.dominantScore,
    );
    if (res) {
      this.server.to(this.room(studentId)).emit('session_started', {
        session: res.session,
        messages: res.messages,
      });
      const firstAssistant = res.messages.find((m) => m.role === 'ASSISTANT');
      this.deskpet.handleComfort(studentId, { message: firstAssistant?.content }).catch(() => {});
      return { ok: true, started: true, sessionId: res.session.id };
    }
    return { ok: true, started: false };
  }

  @SubscribeMessage('message')
  async onMessage(@ConnectedSocket() client: Socket, @MessageBody() payload: MessagePayload) {
    const user = client.data.user as WsUser | undefined;
    if (!user) throw new WsException('未认证');
    const studentId = payload.studentId || user.sub;
    if (user.role === 'STUDENT' && studentId !== user.sub)
      throw new WsException('无权以他人身份发言');

    let sessionId = payload.sessionId;
    if (!sessionId) {
      // 无会话则主动创建一个 MANUAL 会话
      // 操作者即 WS 登录用户；学生本人开会话时无 User 记录，userId 留空
      const operatorUserId = user.role === 'STUDENT' ? null : user.sub;
      const res = await this.chat.startSession(operatorUserId, studentId, { triggerSource: 'MANUAL' });
      sessionId = res.session.id;
    }

    // 真实流式：1) 先持久化用户消息并广播 user_echo；2) 订阅 LLM 流把每段推给客户端；
    // 3) 流结束后再持久化 assistant 消息并广播 reply 事件（避免抖动写入）。
    const userMessage = await this.chat.persistUserMessage(sessionId, studentId, payload.content);
    this.server.to(this.room(studentId)).emit('user_echo', {
      sessionId,
      studentId,
      userMessage,
    });

    const result = await this.chat.streamAssistantReply(
      studentId,
      sessionId,
      (delta) => {
        this.server.to(this.room(studentId)).emit('reply_chunk', {
          sessionId,
          studentId,
          delta,
          done: false,
        });
      },
    );

    // 终结 chunk
    this.server.to(this.room(studentId)).emit('reply_chunk', {
      sessionId,
      studentId,
      delta: '',
      done: true,
    });

    // 完整回复事件（携带 audioUrl、技术、最终气泡）
    const broadcast = {
      sessionId,
      studentId,
      userMessage,
      assistantMessage: result.assistantMessage,
      tts: result.tts,
      provider: result.provider,
    };
    this.server.to(this.room(studentId)).emit('reply', broadcast);
    // 阶段六：聊天进行中让桌宠以轻柔方式陪伴
    this.deskpet
      .handleChat(studentId, { content: result.assistantMessage.content })
      .catch(() => {});
    return { ok: true };
  }

  private room(studentId: string) {
    return `chat:${studentId}`;
  }

  private extractBearer(header?: string): string | undefined {
    if (!header) return undefined;
    const m = /^Bearer\s+(.+)$/i.exec(header);
    return m ? m[1] : undefined;
  }
}
