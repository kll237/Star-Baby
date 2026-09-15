import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

interface WsUser {
  sub: string;
}

/**
 * 危机告警 WebSocket 网关（命名空间 /alerts）。
 * 监护人/教师连接后加入个人房间 user:{userId}，服务端在此推送：
 * - 'crisis'    危机升级提醒（短信/邮件/站内信同级的实时推送）
 * - 'emergency' 紧急弹窗（自残/高危行为，需立即弹窗）
 * - 'risk'      风险行为提醒
 * - 'summary'   新的聊天/看板摘要
 */
@WebSocketGateway({ namespace: '/alerts', cors: { origin: true, credentials: true } })
export class AlertGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AlertGateway.name);
  @WebSocketServer() server!: Server;

  private userSockets = new Map<string, Set<string>>();

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string) ||
        this.bearer(client.handshake.headers.authorization);
      if (!token) throw new Error('未提供令牌');
      const payload = this.jwt.verify<WsUser>(token);
      client.data.userId = payload.sub;
      const set = this.userSockets.get(payload.sub) ?? new Set<string>();
      set.add(client.id);
      this.userSockets.set(payload.sub, set);
      client.join(this.room(payload.sub));
      client.emit('ready', { userId: payload.sub });
    } catch (err) {
      this.logger.warn(`告警网关连接拒绝：${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (userId) {
      const set = this.userSockets.get(userId);
      if (set) {
        set.delete(client.id);
        if (set.size === 0) this.userSockets.delete(userId);
      }
    }
  }

  private room(userId: string) {
    return `user:${userId}`;
  }

  private bearer(header?: string): string | undefined {
    if (!header) return undefined;
    const m = /^Bearer\s+(.+)$/i.exec(header);
    return m ? m[1] : undefined;
  }

  emitCrisis(userId: string, payload: any) {
    this.server?.to(this.room(userId)).emit('crisis', payload);
  }

  emitEmergency(userId: string, payload: any) {
    this.server?.to(this.room(userId)).emit('emergency', payload);
  }

  emitRisk(userId: string, payload: any) {
    this.server?.to(this.room(userId)).emit('risk', payload);
  }

  emitSummary(userId: string, payload: any) {
    this.server?.to(this.room(userId)).emit('summary', payload);
  }
}
