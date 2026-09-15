import { io, Socket } from 'socket.io-client';
import { useNotifyStore } from '@/store/notify';

/** /alerts 命名空间下服务端推送的事件载荷 */
export interface CrisisAlertPayload {
  studentId: string;
  studentName: string;
  level: string;
  title: string;
  body: string;
  safetyEventId: string;
  createdAt: string;
}
export interface EmergencyAlertPayload {
  studentId: string;
  studentName: string;
  kind: string;
  title: string;
  body: string;
  safetyEventId: string;
  createdAt: string;
}
export interface RiskAlertPayload {
  studentId: string;
  studentName: string;
  kind: string;
  level: string;
  title: string;
  body: string;
  safetyEventId: string;
  createdAt: string;
}
export interface SummaryAlertPayload {
  studentId: string;
  summary: string;
  createdAt: string;
}

/**
 * 危机告警 WebSocket 客户端（命名空间 /alerts）。
 * 单例 + 引用计数：App.vue 与 ParentDashboardView 都可请求连接，
 * 当引用计数归零（全局登出）才真正断开，避免视图卸载误杀全局连接。
 */
let socket: Socket | null = null;
let refCount = 0;
let currentToken = '';

export function connectAlerts(token: string): void {
  if (socket && currentToken === token) {
    refCount += 1;
    return;
  }
  // token 变更：重建连接
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  currentToken = token;
  refCount = 1;

  const notify = useNotifyStore();
  socket = io('/alerts', {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
  });

  socket.on('connect', () => console.log('[alerts] connected'));
  socket.on('connect_error', (err) => console.warn('[alerts] connect_error', err));

  socket.on('crisis', (p: CrisisAlertPayload) => {
    notify.setCrisis({
      studentId: p.studentId,
      studentName: p.studentName,
      level: p.level,
      title: p.title,
      body: p.body,
      safetyEventId: p.safetyEventId,
      createdAt: p.createdAt,
    });
  });

  socket.on('emergency', (p: EmergencyAlertPayload) => {
    notify.setEmergency({
      studentId: p.studentId,
      studentName: p.studentName,
      kind: p.kind,
      title: p.title,
      body: p.body,
      safetyEventId: p.safetyEventId,
      createdAt: p.createdAt,
    });
  });

  socket.on('risk', (p: RiskAlertPayload) => {
    notify.setRisk({
      studentId: p.studentId,
      studentName: p.studentName,
      kind: p.kind,
      level: p.level,
      title: p.title,
      body: p.body,
      safetyEventId: p.safetyEventId,
      createdAt: p.createdAt,
    });
  });

  socket.on('summary', (p: SummaryAlertPayload) => {
    notify.setSummary({
      studentId: p.studentId,
      title: '陪伴摘要',
      body: p.summary,
      summary: p.summary,
      createdAt: p.createdAt,
    });
  });
}

export function disconnectAlerts(): void {
  if (refCount > 0) refCount -= 1;
  if (refCount <= 0) {
    refCount = 0;
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    currentToken = '';
  }
}
