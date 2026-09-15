import { io, Socket } from 'socket.io-client';

/**
 * 实时检测 WebSocket 客户端（命名空间 /detection）。
 * 开发/生产均同源：通过 Vite / Nginx 代理转发到后端 socket.io。
 */
export interface RealtimeFrame {
  studentId: string;
  sessionId: string;
  ts: string;
  dominant: string;
  compositeScore: number;
  negative: boolean;
  scores: Record<string, number>;
  behaviors: { behavior: string; confidence: number; source: string }[];
  risk?: boolean;
  riskLevel?: 'yellow' | 'orange' | 'red' | null;
}

export class DetectionSocket {
  private socket: Socket | null = null;

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io('/detection', {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
      });
      this.socket.on('connect', () => resolve());
      this.socket.on('connect_error', (err) => reject(err));
      this.socket.on('ready', () => resolve());
    });
  }

  onRealtime(cb: (frame: RealtimeFrame) => void) {
    this.socket?.on('realtime', cb);
  }

  onRisk(cb: (frame: RealtimeFrame) => void) {
    this.socket?.on('risk', cb);
  }

  /** 阶段三：检测端自动触发安抚对话时收到此事件（含会话与首条消息）。 */
  onComfort(cb: (payload: { session: any; messages: any[] }) => void) {
    this.socket?.on('comfort', cb);
  }

  sendFrame(payload: {
    sessionId: string;
    emotionScores: Record<string, number>;
    behaviors?: { behavior: string; confidence: number; source?: string }[];
    ts?: number;
  }) {
    this.socket?.emit('frame', payload);
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}
