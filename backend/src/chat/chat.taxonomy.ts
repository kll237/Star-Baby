/**
 * 阶段三：智能聊天安抚系统的分类与映射常量。
 * 与数据库 ComfortCategory 枚举保持一致，并定义「情绪 → 优先话术类别」的亲和映射。
 */

export const COMFORT_CATEGORIES = [
  'CBT',
  'MINDFULNESS',
  'BREATHING',
  'GROUNDING',
  'VALIDATION',
  'ENCOURAGEMENT',
  'DISTRACTION',
  'ROUTINE',
] as const;

export type ComfortCategoryKey = (typeof COMFORT_CATEGORIES)[number];

export const COMFORT_CATEGORY_LABELS: Record<ComfortCategoryKey, string> = {
  CBT: '认知行为疗法',
  MINDFULNESS: '正念觉察',
  BREATHING: '呼吸放松',
  GROUNDING: '着陆技术',
  VALIDATION: '情绪确认',
  ENCOURAGEMENT: '鼓励赋能',
  DISTRACTION: '转移注意',
  ROUTINE: '行为引导',
};

export const COMFORT_TONES = ['warm', 'playful', 'calm'] as const;
export type ComfortTone = (typeof COMFORT_TONES)[number];

/**
 * 情绪 → 优先话术类别（按优先级排序）。
 * 当学生出现某类负向情绪时，优先从该类别中挑选话术，再回退到通用话术。
 */
export const EMOTION_COMFORT_PRIORITY: Record<string, ComfortCategoryKey[]> = {
  angry: ['VALIDATION', 'BREATHING', 'GROUNDING', 'CBT'],
  sad: ['VALIDATION', 'ENCOURAGEMENT', 'MINDFULNESS', 'DISTRACTION'],
  fear: ['GROUNDING', 'BREATHING', 'VALIDATION', 'ENCOURAGEMENT'],
  disgust: ['DISTRACTION', 'ROUTINE', 'MINDFULNESS'],
  neutral: ['ENCOURAGEMENT', 'MINDFULNESS', 'ROUTINE'],
};

/** 取某情绪对应的首选话术类别（无映射返回通用类别）。 */
export function preferredCategories(emotion: string | undefined): ComfortCategoryKey[] {
  if (emotion && EMOTION_COMFORT_PRIORITY[emotion]) return EMOTION_COMFORT_PRIORITY[emotion];
  return ['VALIDATION', 'ENCOURAGEMENT', 'MINDFULNESS', 'BREATHING'];
}

/** 把数据库 LlmProvider 字符串规整为受支持的值（默认 RULE）。 */
export function normalizeLlmProvider(p?: string | null): 'RULE' | 'MOCK' | 'OPENAI' | 'ZHIPU' {
  if (p === 'MOCK' || p === 'OPENAI' || p === 'RULE' || p === 'ZHIPU') return p;
  return 'RULE';
}

/** 后端支持的所有 LLM 提供方（按"是否默认"排序：RULE 最稳；ZHIPU 是免费推荐）。 */
export const ALL_LLM_PROVIDERS = ['RULE', 'MOCK', 'ZHIPU', 'OPENAI'] as const;
export type AnyLlmProviderName = (typeof ALL_LLM_PROVIDERS)[number];
