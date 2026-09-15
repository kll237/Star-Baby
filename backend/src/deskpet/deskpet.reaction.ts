/**
 * 阶段六：桌宠反应映射（纯函数，便于单元测试）。
 * 输入为检测 / 安抚 / 建议事件，输出统一的桌宠反应（PetReaction）。
 */
import { PetMood, PetAnimation, PetReaction } from './deskpet.taxonomy';

/** 检测网关广播的结构（与 detection.gateway 的 realtime 负载一致） */
export interface DetectionBroadcast {
  studentId: string;
  dominant: string;
  compositeScore: number;
  negative: boolean;
  scores?: Record<string, number>;
  behaviors?: { behavior: string; confidence: number; source?: string }[];
  risk?: boolean;
  ts?: string;
}

/** 把 0-100 数字收敛到整数区间 */
export function clampScore(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** 由检测结果映射桌宠反应（风险行为优先） */
export function mapDetectionToReaction(b: DetectionBroadcast): PetReaction {
  const ts = b.ts || new Date().toISOString();
  const intensity = clampScore(b.compositeScore);

  if (b.risk || (b.behaviors || []).some((x) => x.behavior === 'self_injury')) {
    return {
      mood: 'alert',
      animation: 'alert',
      message: '星宝注意到危险动作，快保护小朋友！',
      intensity: 100,
      ts,
    };
  }

  switch (b.dominant) {
    case 'happy':
      return { mood: 'celebrate', animation: 'dance', message: '看到你笑，星宝也开心地跳起来啦～', intensity, ts };
    case 'angry':
      return { mood: 'angry', animation: 'shake', message: '星宝陪你一起深呼吸，不着急。', intensity, ts };
    case 'fear':
      return { mood: 'anxious', animation: 'hug', message: '别怕，星宝在你身边。', intensity, ts };
    case 'sad':
      return { mood: 'sad', animation: 'sway', message: '抱抱你，难过的时候星宝都在。', intensity, ts };
    case 'surprise':
    case 'disgust':
      return { mood: 'calm', animation: 'bounce', message: '星宝陪你看看发生了什么～', intensity, ts };
    default:
      break;
  }

  if (typeof b.compositeScore === 'number' && b.compositeScore < 40) {
    return { mood: 'anxious', animation: 'hug', message: '星宝感觉到你有点不舒服，过来陪陪你。', intensity, ts };
  }
  return { mood: 'calm', animation: 'idle', message: '星宝安静地陪着你～', intensity, ts };
}

/** 由风险行为映射桌宠反应 */
export function mapRiskToReaction(behavior: string, ts = new Date().toISOString()): PetReaction {
  return {
    mood: 'alert',
    animation: 'alert',
    message: `星宝提示：检测到「${behavior}」，请关注小朋友安全。`,
    intensity: 100,
    ts,
  };
}

/** 由安抚对话映射桌宠反应 */
export function mapComfortToReaction(
  payload: { message?: string } = {},
  ts = new Date().toISOString(),
): PetReaction {
  const message = payload.message || '来，星宝陪你聊聊天、放松一下～';
  return { mood: 'celebrate', animation: 'cheer', message, intensity: 70, ts };
}

/** 由专业建议映射桌宠反应 */
export function mapAdviceToReaction(severity: string, ts = new Date().toISOString()): PetReaction {
  const high = severity === 'CRITICAL' || severity === 'HIGH';
  const mood: PetMood = high ? 'alert' : 'calm';
  const animation: PetAnimation = high ? 'alert' : 'bounce';
  const label = high ? '重要' : '温馨';
  return {
    mood,
    animation,
    message: `星宝带来${label}建议，记得看看哦～`,
    intensity: severity === 'CRITICAL' ? 100 : severity === 'HIGH' ? 80 : 50,
    ts,
  };
}

const COMMAND_ANIMATION: Record<string, PetAnimation> = {
  wave: 'bounce',
  dance: 'dance',
  cheer: 'cheer',
  spin: 'spin',
  hug: 'hug',
  alert: 'alert',
};

/** 由硬件/前端指令映射桌宠反应 */
export function mapCommandToReaction(action: string, ts = new Date().toISOString()): PetReaction {
  const animation = COMMAND_ANIMATION[action] || 'bounce';
  return { mood: 'celebrate', animation, message: `星宝收到指令：${action}`, intensity: 60, ts };
}
