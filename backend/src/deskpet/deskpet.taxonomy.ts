/**
 * 阶段六：桌宠硬件接口 —— 类型与常量定义。
 * 把检测 / 安抚 / 建议事件映射为「桌宠反应」（心情 + 动画 + 文案），
 * 通过 WebSocket 与 MQTT 双通道推送给前端虚拟桌宠与实体机器人桌宠。
 */

/** 桌宠心情 */
export type PetMood =
  | 'happy'
  | 'calm'
  | 'sad'
  | 'anxious'
  | 'angry'
  | 'alert'
  | 'celebrate'
  | 'sleep';

/** 桌宠动画（与前端 CSS 动画类一一对应） */
export type PetAnimation =
  | 'idle'
  | 'bounce'
  | 'dance'
  | 'sway'
  | 'shake'
  | 'hug'
  | 'alert'
  | 'cheer'
  | 'spin';

/** 已注册桌宠设备类型 */
export type DeskPetDeviceType = 'VIRTUAL' | 'ROBOT' | 'SCREEN';

/** 桌宠反应事件类型（同时作为 MQTT channel） */
export type DeskPetEventType =
  | 'detection'
  | 'risk'
  | 'comfort'
  | 'advice'
  | 'command'
  | 'heartbeat';

/** 桌宠反应载荷 */
export interface PetReaction {
  mood: PetMood;
  animation: PetAnimation;
  message?: string | null;
  /** 情绪强度 0-100（用于桌宠表现幅度） */
  intensity?: number;
  /** ISO 时间戳 */
  ts: string;
}

export const PET_MOOD_LABELS: Record<PetMood, string> = {
  happy: '开心',
  calm: '平静',
  sad: '难过',
  anxious: '不安',
  angry: '生气',
  alert: '警觉',
  celebrate: '庆祝',
  sleep: '休眠',
};

export const PET_ANIMATION_LABELS: Record<PetAnimation, string> = {
  idle: '待机',
  bounce: '弹跳',
  dance: '跳舞',
  sway: '摇摆',
  shake: '抖动',
  hug: '拥抱',
  alert: '警示',
  cheer: '欢呼',
  spin: '旋转',
};

export const DESKPET_DEVICE_LABELS: Record<DeskPetDeviceType, string> = {
  VIRTUAL: '虚拟桌宠',
  ROBOT: '实体机器人桌宠',
  SCREEN: '屏幕挂件',
};

/** 事件类型 → MQTT channel 名 */
export const DESKPET_CHANNELS: Record<DeskPetEventType, string> = {
  detection: 'detection',
  risk: 'risk',
  comfort: 'comfort',
  advice: 'advice',
  command: 'command',
  heartbeat: 'heartbeat',
};

/** 构造 MQTT 主题：形如 {prefix}/{studentId}/{channel} */
export function deskpetTopic(prefix: string, studentId: string, channel: string): string {
  return `${prefix}/${studentId}/${channel}`;
}
