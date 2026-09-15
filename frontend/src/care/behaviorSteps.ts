/**
 * 特征 3：行为触发「当下 1–2 步操作」，而非事后读长文。
 * 家长/老师遇到 cover_face、shake_head 等，要的是此刻怎么做：
 * 「先关掉背景声、蹲到孩子视线高度、用 3 个字以内的短句」。
 * 这里按行为给出最可操作的即时步骤（内容与知识库同一循证体系），
 * 行为事件发生时直接弹窗，同时可跳转到完整专业建议。
 */
import { BEHAVIOR_LABELS } from '@/utils/behavior';

export interface BehaviorStep {
  behavior: string;
  label: string;
  emoji: string;
  /** 当下可操作的 1–2 步 */
  steps: string[];
  /** 是否高危（需进入风险分级 SOP） */
  highRisk?: boolean;
}

export const BEHAVIOR_STEPS: Record<string, BehaviorStep> = {
  cover_face: {
    behavior: 'cover_face',
    label: BEHAVIOR_LABELS.cover_face,
    emoji: '🤚',
    steps: ['降低刺激：关掉背景声、调暗灯光', '蹲到孩子视线高度，轻声说「没事，我在这儿」'],
  },
  shake_head: {
    behavior: 'shake_head',
    label: BEHAVIOR_LABELS.shake_head,
    emoji: '🙅',
    steps: ['暂停当前要求，给 10 秒缓冲', '换成更简单的单步指令或图示'],
  },
  spin: {
    behavior: 'spin',
    label: BEHAVIOR_LABELS.spin,
    emoji: '🌀',
    steps: ['确认环境安全、清空周围尖角物品', '提供替代的「旋转感」：转椅/原地转，满足感官需求'],
  },
  stamp: {
    behavior: 'stamp',
    label: BEHAVIOR_LABELS.stamp,
    emoji: '🦶',
    steps: ['用平静低音量说「脚脚停」', '引导到软垫区，给可踩踏的安全出口'],
  },
  jump: {
    behavior: 'jump',
    label: BEHAVIOR_LABELS.jump,
    emoji: '🦘',
    steps: ['确认地面安全', '转化为有节奏的「跳—停—跳」游戏，帮其自我调节'],
  },
  run: {
    behavior: 'run',
    label: BEHAVIOR_LABELS.run,
    emoji: '🏃',
    steps: ['平稳拦截，不追逐（越追越兴奋）', '用身体挡在前进方向，而非拉手强拽'],
  },
  leave_seat: {
    behavior: 'leave_seat',
    label: BEHAVIOR_LABELS.leave_seat,
    emoji: '🪑',
    steps: ['确认去向，不立即斥责', '用视觉时间表提示「再坐 5 分钟就可以休息」'],
  },
  clap: {
    behavior: 'clap',
    label: BEHAVIOR_LABELS.clap,
    emoji: '👏',
    steps: ['这是兴奋/高兴的表达，可顺势正向回应', '跟随节奏给一句短鼓励'],
  },
  wave: {
    behavior: 'wave',
    label: BEHAVIOR_LABELS.wave,
    emoji: '👋',
    steps: ['立即回以挥手并叫名，强化社交发起', '用 2 字短句回应：「你好呀」'],
  },
  point: {
    behavior: 'point',
    label: BEHAVIOR_LABELS.point,
    emoji: '👉',
    steps: ['顺着手指方向看过去并命名物品', '借机扩展：「你要车车？」鼓励用语言/图卡'],
  },
  sit_still: {
    behavior: 'sit_still',
    label: BEHAVIOR_LABELS.sit_still,
    emoji: '🧘',
    steps: ['平静配合，给予肯定', '可趁机做 1 件小任务，随后即时奖励'],
  },
  self_injury: {
    behavior: 'self_injury',
    label: BEHAVIOR_LABELS.self_injury,
    emoji: '⚠️',
    highRisk: true,
    steps: ['立即确保孩子与他人安全，移除危险物品', '不强行约束，保持安全距离持续陪伴并联系校医'],
  },
};

/** 取某行为的即时步骤；未知行为返回 null。 */
export function stepForBehavior(behavior: string): BehaviorStep | null {
  return BEHAVIOR_STEPS[behavior] ?? null;
}
