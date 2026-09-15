/**
 * 阶段二：情绪与动作行为识别的常量定义
 * —— 全部集中在此，前后端可共用同一份语义。
 */

// ---------------- 情绪 ----------------
// 基础情绪（face-api faceExpressionNet 直出）
export const BASIC_EMOTION_KEYS = [
  'happy', // 高兴
  'sad', // 悲伤
  'angry', // 愤怒
  'fear', // 恐惧
  'surprise', // 惊讶
  'disgust', // 厌恶
  'neutral', // 平静 / 中性
] as const;

// 复杂/复合情绪（由基础表情分布 + 面部几何 + 姿态运动特征合成）
export const COMPLEX_EMOTION_KEYS = [
  'confused', // 困惑
  'anxious', // 焦虑
  'excited', // 兴奋
  'tired', // 疲惫
  'frustrated', // 沮丧
  'focused', // 专注
  'content', // 满足
] as const;

export const EMOTION_KEYS = [...BASIC_EMOTION_KEYS, ...COMPLEX_EMOTION_KEYS] as const;

export type EmotionKey = (typeof EMOTION_KEYS)[number];

export const EMOTION_LABELS: Record<EmotionKey, string> = {
  happy: '高兴',
  sad: '悲伤',
  angry: '愤怒',
  fear: '恐惧',
  surprise: '惊讶',
  disgust: '厌恶',
  neutral: '平静',
  confused: '困惑',
  anxious: '焦虑',
  excited: '兴奋',
  tired: '疲惫',
  frustrated: '沮丧',
  focused: '专注',
  content: '满足',
};

export const EMOTION_EMOJI: Record<EmotionKey, string> = {
  happy: '😊',
  sad: '😢',
  angry: '😠',
  fear: '😨',
  surprise: '😲',
  disgust: '🤢',
  neutral: '😐',
  confused: '😕',
  anxious: '😰',
  excited: '🤩',
  tired: '😪',
  frustrated: '😤',
  focused: '🧐',
  content: '😌',
};

/** 情绪效价权重（0-100）：用于计算综合情绪状态评分。
 *  正值情绪权重高，危险/负面情绪权重低；中性作为平静基线。 */
export const EMOTION_VALENCE: Record<EmotionKey, number> = {
  happy: 95,
  surprise: 62,
  neutral: 70,
  sad: 32,
  fear: 22,
  disgust: 16,
  angry: 10,
  content: 88,
  excited: 85,
  focused: 72,
  confused: 45,
  tired: 40,
  frustrated: 25,
  anxious: 20,
};

/** 负向情绪集合（用于触发安抚） */
export const NEGATIVE_EMOTIONS: EmotionKey[] = [
  'angry',
  'sad',
  'fear',
  'disgust',
  'frustrated',
  'anxious',
];

/** 需关注但未必负向的情绪（困惑/疲惫）：不触发安抚，但在看板提示关注 */
export const CONCERN_EMOTIONS: EmotionKey[] = ['confused', 'tired'];

// ---------------- 动作行为（≥10 种） ----------------
export const BEHAVIOR_KEYS = [
  'clap', // 拍手
  'wave', // 挥手
  'shake_head', // 摇头
  'cover_face', // 捂脸
  'spin', // 转圈
  'stamp', // 跺脚
  'self_injury', // 自伤倾向动作
  'leave_seat', // 离座
  'run', // 奔跑
  'sit_still', // 静坐
  'jump', // 跳动
  'point', // 指认
  'absent', // 不在场（画面中未检测到人，区别于"静坐"，避免离屏被误判为平静）
  // 以下为补盲新增：跌倒 / 冲突 / 久坐 / 自伤漏报场景
  'fall', // 跌倒（躯干倾角突变 + 头部/髋部高度骤降）
  'fight', // 打架/肢体冲突（多人 + 高频高幅肢体运动）
  'sit_long', // 久坐（连续静坐超过阈值，需起身活动提醒）
  'hit_arm', // 击打自身手臂/大腿（自伤漏报场景：无"手贴脸"特征）
  'head_bang', // 撞头/撞墙（自伤漏报场景：头部高频冲撞静止物体）
] as const;

export type BehaviorKey = (typeof BEHAVIOR_KEYS)[number];

export const BEHAVIOR_LABELS: Record<BehaviorKey, string> = {
  clap: '拍手',
  wave: '挥手',
  shake_head: '摇头',
  cover_face: '捂脸',
  spin: '转圈',
  stamp: '跺脚',
  self_injury: '自伤倾向动作',
  leave_seat: '离座',
  run: '奔跑',
  sit_still: '静坐',
  jump: '跳动',
  point: '指认',
  absent: '不在场',
  fall: '跌倒',
  fight: '打架/冲突',
  sit_long: '久坐',
  hit_arm: '击打肢体',
  head_bang: '撞头/撞墙',
};

/** 需重点关注的异常/风险行为（触发预警）：覆盖自伤两大类 + 跌倒 + 冲突 */
export const RISK_BEHAVIORS: BehaviorKey[] = [
  'self_injury',
  'hit_arm',
  'head_bang',
  'fall',
  'fight',
];

// ---------------- 特征 7：风险分级 + 人工介入 SOP ----------------

export type RiskLevelKey = 'yellow' | 'orange' | 'red';

/** 行为 → 风险等级映射（无姿态模型时也可分级）。 */
export function riskLevelOf(behavior: string): RiskLevelKey {
  switch (behavior) {
    // 红色（紧急）：自伤各类 + 跌倒 + 冲突
    case 'self_injury':
    case 'hit_arm':
    case 'head_bang':
    case 'fall':
    case 'fight':
      return 'red';
    // 橙色（需介入）：离座/奔跑/跳动/跺脚/转圈/久坐
    case 'leave_seat':
    case 'run':
    case 'jump':
    case 'stamp':
    case 'spin':
    case 'sit_long':
      return 'orange';
    default:
      return 'yellow';
  }
}

export interface RiskSopContact {
  role: string; // 家长 / 班主任 / 校医
  /** 一键联系动作描述（前端可映射为 tel: 等） */
  action: string;
}

export interface RiskSopItem {
  level: RiskLevelKey;
  label: string;
  /** 主题色（柔和不刺眼） */
  color: string;
  /** 处置清单（1-2 步可操作） */
  steps: string[];
  /** 一键联系对象 */
  contacts: RiskSopContact[];
}

/**
 * 黄 / 橙 / 红三级风险对应的处置清单与一键联系对象。
 * 颜色采用柔和暖橙—琥珀—陶土，避免对自闭症儿童造成刺眼红色闪烁。
 */
export const RISK_SOP: Record<RiskLevelKey, RiskSopItem> = {
  yellow: {
    level: 'yellow',
    label: '黄色（关注）',
    color: '#f1c40f',
    steps: [
      '保持平静陪伴，记录行为发生的时间与前置活动',
      '用 3 字以内短句温和提示，避免追问',
    ],
    contacts: [{ role: '家长', action: 'notify' }, { role: '班主任', action: 'notify' }],
  },
  orange: {
    level: 'orange',
    label: '橙色（需介入）',
    color: '#e8833a',
    steps: [
      '降低环境刺激：关背景声、调暗灯光、撤走人群',
      '蹲到孩子视线高度，给可预测的单步指令',
      '若持续 2 分钟以上，联系班主任协同处理',
    ],
    contacts: [
      { role: '家长', action: 'call' },
      { role: '班主任', action: 'call' },
    ],
  },
  red: {
    level: 'red',
    label: '红色（紧急）',
    color: '#d9603b',
    steps: [
      '立即确保孩子与他人安全，移除危险物品',
      '不要强行约束，保持安全距离并持续陪伴',
      '立即联系校医并同步家长，必要时启动应急预案',
    ],
    contacts: [
      { role: '校医', action: 'call' },
      { role: '家长', action: 'call' },
      { role: '班主任', action: 'call' },
    ],
  },
};

// ---------------- 类型辅助 ----------------
export type EmotionScores = Partial<Record<EmotionKey, number>>;
export interface BehaviorHit {
  behavior: BehaviorKey;
  confidence: number; // 0-1
}
