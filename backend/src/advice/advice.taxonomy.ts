/**
 * 阶段五：专业心理建议引擎与知识库的分类与映射常量。
 * 与数据库 KnowledgeCategory / AdviceSeverity / AdviceTarget 枚举保持一致。
 */

export const KNOWLEDGE_CATEGORIES = [
  'EMOTION_REGULATION',
  'SOCIAL_SKILL',
  'BEHAVIOR_INTERVENTION',
  'SENSORY_INTEGRATION',
  'COMMUNICATION',
  'FAMILY_LIFE',
  'SCHOOL_ADAPTATION',
  'CRISIS_INTERVENTION',
  'PARENT_GUIDANCE',
  'TEACHER_STRATEGY',
  'COGNITIVE_TRAINING',
  'ROUTINE_BUILDING',
] as const;

export type KnowledgeCategoryKey = (typeof KNOWLEDGE_CATEGORIES)[number];

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategoryKey, string> = {
  EMOTION_REGULATION: '情绪调节',
  SOCIAL_SKILL: '社交技能',
  BEHAVIOR_INTERVENTION: '行为干预',
  SENSORY_INTEGRATION: '感觉统合',
  COMMUNICATION: '沟通表达',
  FAMILY_LIFE: '家庭生活',
  SCHOOL_ADAPTATION: '学校适应',
  CRISIS_INTERVENTION: '危机干预',
  PARENT_GUIDANCE: '家长指导',
  TEACHER_STRATEGY: '教师策略',
  COGNITIVE_TRAINING: '认知训练',
  ROUTINE_BUILDING: '常规建立',
};

export const ADVICE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type AdviceSeverityKey = (typeof ADVICE_SEVERITIES)[number];

export const ADVICE_SEVERITY_LABELS: Record<AdviceSeverityKey, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  CRITICAL: '紧急',
};

export const ADVICE_TARGETS = ['ALL', 'PARENT', 'TEACHER', 'STUDENT'] as const;
export type AdviceTargetKey = (typeof ADVICE_TARGETS)[number];

/**
 * 主导负向情绪 → 优先知识类别映射（用于建议引擎的类别亲和度）。
 * 当学生出现某类负向情绪时，优先推荐对应类别的知识条目。
 */
export const EMOTION_KNOWLEDGE_PRIORITY: Record<string, KnowledgeCategoryKey[]> = {
  angry: ['BEHAVIOR_INTERVENTION', 'EMOTION_REGULATION', 'CRISIS_INTERVENTION'],
  sad: ['EMOTION_REGULATION', 'COMMUNICATION', 'PARENT_GUIDANCE'],
  fear: ['EMOTION_REGULATION', 'SENSORY_INTEGRATION', 'CRISIS_INTERVENTION'],
  disgust: ['SENSORY_INTEGRATION', 'BEHAVIOR_INTERVENTION'],
  surprise: ['EMOTION_REGULATION', 'COGNITIVE_TRAINING'],
  neutral: ['ROUTINE_BUILDING', 'SOCIAL_SKILL', 'COGNITIVE_TRAINING'],
  happy: ['SOCIAL_SKILL', 'FAMILY_LIFE'],
};

/**
 * 行为 → 优先知识类别映射。
 */
export const BEHAVIOR_KNOWLEDGE_PRIORITY: Record<string, KnowledgeCategoryKey[]> = {
  self_injury: ['CRISIS_INTERVENTION', 'BEHAVIOR_INTERVENTION'],
  stamp: ['BEHAVIOR_INTERVENTION', 'EMOTION_REGULATION'],
  shake_head: ['BEHAVIOR_INTERVENTION', 'COMMUNICATION'],
  cover_face: ['EMOTION_REGULATION', 'SENSORY_INTEGRATION'],
  spin: ['SENSORY_INTEGRATION', 'BEHAVIOR_INTERVENTION'],
  leave_seat: ['SCHOOL_ADAPTATION', 'ROUTINE_BUILDING'],
  run: ['BEHAVIOR_INTERVENTION', 'SCHOOL_ADAPTATION'],
  jump: ['SENSORY_INTEGRATION', 'BEHAVIOR_INTERVENTION'],
  clap: ['SOCIAL_SKILL', 'COMMUNICATION'],
  wave: ['SOCIAL_SKILL'],
  sit_still: ['ROUTINE_BUILDING', 'COGNITIVE_TRAINING'],
  point: ['COMMUNICATION', 'SOCIAL_SKILL'],
};

/** 严重度阈值（基于阶段四聚合的 negativeRatio 与风险行为）。 */
export interface SeverityThresholds {
  negativeRatioMedium: number; // 超过 → MEDIUM
  negativeRatioHigh: number; // 超过 → HIGH
  riskBehaviorCritical: string[]; // 出现即 → CRITICAL
  riskBehaviorHigh: string[]; // 出现即 → HIGH
}

export const DEFAULT_SEVERITY_THRESHOLDS: SeverityThresholds = {
  negativeRatioMedium: 0.35,
  negativeRatioHigh: 0.6,
  riskBehaviorCritical: ['self_injury'],
  riskBehaviorHigh: ['stamp', 'run', 'leave_seat'],
};

/** 把数据库 AdviceSeverity 字符串规整为受支持的值（默认 LOW）。 */
export function normalizeSeverity(s?: string | null): AdviceSeverityKey {
  if (s === 'LOW' || s === 'MEDIUM' || s === 'HIGH' || s === 'CRITICAL') return s;
  return 'LOW';
}

/** 把数据库 AdviceTarget 字符串规整（默认 ALL）。 */
export function normalizeTarget(t?: string | null): AdviceTargetKey {
  if (t === 'PARENT' || t === 'TEACHER' || t === 'STUDENT' || t === 'ALL') return t;
  return 'ALL';
}
