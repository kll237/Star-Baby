import { defineStore } from 'pinia';

/** 告警载荷（与 /alerts websocket 事件对齐，额外补充 studentName 等字段） */
export interface AlertPayload {
  studentId: string;
  studentName?: string;
  level?: string;
  kind?: string;
  title: string;
  body: string;
  safetyEventId?: string;
  summary?: string;
  createdAt?: string;
}

interface NotifyState {
  /** 最近一次危机预警载荷（非紧急，弹 toast） */
  latestCrisis: AlertPayload | null;
  /** 最近一次紧急事件载荷（全屏弹窗） */
  latestEmergency: AlertPayload | null;
  /** 最近一次风险提示载荷（非紧急，弹 toast） */
  latestRisk: AlertPayload | null;
  /** 最近一次周报摘要载荷 */
  lastSummary: AlertPayload | null;
  /** 未读告警数（crisis/risk 计入，emergency/summary 不计入红点） */
  unreadAlerts: number;
  /** 每次收到任意告警自增的时间戳，供通知铃等组件监听刷新 */
  lastAlertAt: number;
}

export const useNotifyStore = defineStore('notify', {
  state: (): NotifyState => ({
    latestCrisis: null,
    latestEmergency: null,
    latestRisk: null,
    lastSummary: null,
    unreadAlerts: 0,
    lastAlertAt: 0,
  }),
  actions: {
    setCrisis(p: AlertPayload) {
      this.latestCrisis = p;
      this.latestRisk = null; // crisis 优先级高于 risk，覆盖
      this.unreadAlerts += 1;
      this.lastAlertAt = Date.now();
      // CRITICAL 级危机（如表达绝望/自伤意念）与自残行为同等紧急，一并升级为全屏弹窗，
      // 避免仅用 toast 提示而被监护人忽略。
      if ((p.level || '').toUpperCase() === 'CRITICAL') {
        this.latestEmergency = p;
      }
    },
    setEmergency(p: AlertPayload) {
      this.latestEmergency = p;
      this.lastAlertAt = Date.now();
    },
    setRisk(p: AlertPayload) {
      this.latestRisk = p;
      this.latestCrisis = null; // risk 被新的 crisis 覆盖时由 setCrisis 处理
      this.unreadAlerts += 1;
      this.lastAlertAt = Date.now();
    },
    setSummary(p: AlertPayload) {
      this.lastSummary = p;
      this.lastAlertAt = Date.now();
    },
    clear() {
      this.latestCrisis = null;
      this.latestEmergency = null;
      this.latestRisk = null;
      this.lastSummary = null;
      this.unreadAlerts = 0;
    },
    acknowledge() {
      this.latestEmergency = null;
    },
  },
});
