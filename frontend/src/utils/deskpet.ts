import { io, Socket } from 'socket.io-client';
import type { DeskPetEventView, DeskPetFeed, PetReaction, DeskPetEventType } from '@/api/types';

/**
 * 桌宠 WebSocket 客户端（命名空间 /deskpet）。
 * 与后端 DeskPetGateway 对应：连接后加入学生房间，服务端把检测/安抚/建议映射成的
 * 「桌宠反应」通过 'pet_state' 事件推送到房间；客户端也可发送 'subscribe' / 'command'。
 */
export interface PetStatePayload {
  studentId: string;
  type: DeskPetEventType;
  reaction: PetReaction;
  ts: string;
}

export interface ReadyPayload {
  role: string;
  studentId: string;
  mqtt: { connected: boolean; mode: 'remote' | 'local'; url: string | null };
}

export class DeskPetSocket {
  private socket: Socket | null = null;

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io('/deskpet', {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
      });
      this.socket.on('connect', () => resolve());
      this.socket.on('connect_error', (err) => reject(err));
      this.socket.on('ready', () => resolve());
    });
  }

  onReady(cb: (p: ReadyPayload) => void) {
    this.socket?.on('ready', cb);
  }

  onPetState(cb: (p: PetStatePayload) => void) {
    this.socket?.on('pet_state', cb);
  }

  onFeed(cb: (p: DeskPetFeed) => void) {
    this.socket?.on('feed', cb);
  }

  subscribe(studentId: string) {
    this.socket?.emit('subscribe', { studentId });
  }

  sendCommand(studentId: string, action: string, deviceId?: string) {
    this.socket?.emit('command', { studentId, action, deviceId });
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}
