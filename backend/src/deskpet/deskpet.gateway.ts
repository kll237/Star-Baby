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
import { DeskPetService } from './deskpet.service';
import { DeskPetBus } from './deskpet.bus';

interface WsUser {
  sub: string;
  role: 'PARENT' | 'TEACHER' | 'STUDENT';
}

/**
 * 桌宠 WebSocket 网关（命名空间 /deskpet）。
 * - 虚拟桌宠 / 实体机器人连接后，按权限加入房间 deskpet:{studentId}；
 * - 订阅 DeskPetBus 的 reaction 事件，向房间广播 'pet_state'；
 * - 客户端可发送 'subscribe' 指定要跟随的学生，或 'command' 反向下发指令（如让桌宠跳舞）。
 * 与 /detection、/chat 同源，延迟目标 ≤200ms。
 */
@WebSocketGateway({ namespace: '/deskpet', cors: { origin: true, credentials: true } })
export class DeskPetGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(DeskPetGateway.name);
  @WebSocketServer() server!: Server;
  private offBus?: () => void;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly deskpet: DeskPetService,
    private readonly bus: DeskPetBus,
  ) {
    this.offBus = this.bus.onReaction((evt) => {
      this.server.to(this.room(evt.studentId)).emit('pet_state', {
        studentId: evt.studentId,
        type: evt.type,
        reaction: evt.reaction,
        ts: evt.ts,
      });
    });
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
        const students = await this.prisma.student.findMany({
          where: { OR: [{ ownerId: payload.sub }, { guardians: { some: { id: payload.sub } } }] },
          select: { id: true },
        });
        for (const s of students) client.join(this.room(s.id));
      }
      client.emit('ready', { role: payload.role, studentId: payload.sub, mqtt: this.deskpet.mqttStatus() });
    } catch (err) {
      this.logger.warn(`桌宠网关连接拒绝：${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    void client;
  }

  /** 客户端指定要跟随的学生（用于一台桌宠切换不同孩子）。 */
  @SubscribeMessage('subscribe')
  async onSubscribe(@ConnectedSocket() client: Socket, @MessageBody() payload: { studentId: string }) {
    const user = client.data.user as WsUser | undefined;
    if (!user) throw new WsException('未认证');
    if (!payload?.studentId) throw new WsException('缺少 studentId');
    if (user.role !== 'STUDENT') {
      const student = await this.prisma.student.findUnique({
        where: { id: payload.studentId },
        include: { guardians: { select: { id: true } } },
      });
      if (!student || (student.ownerId !== user.sub && !student.guardians.some((g: any) => g.id === user.sub)))
        throw new WsException('无权订阅该学生');
    } else if (user.sub !== payload.studentId) {
      throw new WsException('只能订阅自己');
    }
    client.join(this.room(payload.studentId));
    const feed = await this.deskpet.feed(payload.studentId);
    client.emit('feed', feed);
    return { ok: true, studentId: payload.studentId };
  }

  /** 反向指令：让桌宠执行某个动作（前端/硬件均可下发）。 */
  @SubscribeMessage('command')
  async onCommand(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { studentId: string; action: string; deviceId?: string },
  ) {
    const user = client.data.user as WsUser | undefined;
    if (!user) throw new WsException('未认证');
    if (!payload?.studentId || !payload?.action) throw new WsException('缺少 studentId/action');
    const res = await this.deskpet.handleCommand(payload.studentId, payload.action, payload.deviceId);
    return res;
  }

  private room(studentId: string) {
    return `deskpet:${studentId}`;
  }

  private extractBearer(header?: string): string | undefined {
    if (!header) return undefined;
    const m = /^Bearer\s+(.+)$/i.exec(header);
    return m ? m[1] : undefined;
  }
}
