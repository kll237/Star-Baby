/**
 * 特征 1：个人基线 + 相对判断。
 * 特殊儿童（尤其自闭症）表情少、眼神接触少，通用 face-api 易把「平静/少表情」误判为悲伤/生气。
 * 做法：每个孩子首次进入先录一段「平静基线」，之后用「相对自身基线」的偏移判断情绪，
 * 而非绝对阈值——避免把天生低表达的孩子长期误报为负面。
 */
/**
 * 与后端 detection.taxonomy 保持一致的情绪键：
 * 7 类基础情绪（face-api 直出）+ 7 类复杂情绪（complexEmotion.ts 合成）。
 * 必须包含复杂情绪，否则融合进分布的复杂情绪在综合分与主导情绪计算中会被整个忽略。
 */
const EMOTION_KEYS = [
  // 基础
  'happy',
  'sad',
  'angry',
  'fear',
  'surprise',
  'disgust',
  'neutral',
  // 复杂
  'confused',
  'anxious',
  'excited',
  'tired',
  'frustrated',
  'focused',
  'content',
] as const;
const EMOTION_VALENCE: Record<string, number> = {
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
const NEGATIVE_EMOTIONS = ['angry', 'sad', 'fear', 'disgust', 'frustrated', 'anxious'];

export interface BaselineProfile {
  /** 7 类情绪的平均置信度（0-100） */
  scores: Record<string, number>;
  /** 基线综合分（0-100） */
  compositeScore: number;
  sampledFrames: number;
  recordedAt: string;
}

export interface RelativeResult {
  compositeScore: number;
  baselineComposite: number;
  /** 相对自身基线的落差：>0 表示比自己平静时更负面 */
  drop: number;
  negative: boolean;
  dominant: string;
  dominantScore: number;
}

function compositeOf(scores: Record<string, number>): number {
  let w = 0;
  let t = 0;
  for (const k of EMOTION_KEYS) {
    const s = Number(scores[k] ?? 0);
    w += EMOTION_VALENCE[k] * s;
    t += s;
  }
  return t > 0 ? w / t : 70;
}

function dominantOf(scores: Record<string, number>): { dominant: string; dominantScore: number } {
  let dominant = 'neutral';
  let dominantScore = -1;
  for (const k of EMOTION_KEYS) {
    const s = Number(scores[k] ?? 0);
    if (s > dominantScore) {
      dominantScore = s;
      dominant = k;
    }
  }
  return { dominant, dominantScore: Math.round(dominantScore * 10) / 10 };
}

// ---------------- 持久化（localStorage，按学生区分） ----------------

function baselineKey(studentId: string): string {
  return `sp_baseline_${studentId}`;
}

export function getBaseline(studentId: string): BaselineProfile | null {
  try {
    const s = localStorage.getItem(baselineKey(studentId));
    return s ? (JSON.parse(s) as BaselineProfile) : null;
  } catch {
    return null;
  }
}

export function saveBaseline(studentId: string, p: BaselineProfile): void {
  localStorage.setItem(baselineKey(studentId), JSON.stringify(p));
}

export function clearBaseline(studentId: string): void {
  localStorage.removeItem(baselineKey(studentId));
}

// ---------------- 录制基线（首次进入录 10 秒） ----------------

export interface BaselineAccumulator {
  scores: Record<string, number>;
  n: number;
}

export function newBaselineAccumulator(): BaselineAccumulator {
  const scores: Record<string, number> = {};
  for (const k of EMOTION_KEYS) scores[k] = 0;
  return { scores, n: 0 };
}

export function accumulateBaseline(acc: BaselineAccumulator, scores: Record<string, number>): void {
  for (const k of EMOTION_KEYS) acc.scores[k] = (acc.scores[k] ?? 0) + Number(scores[k] ?? 0);
  acc.n += 1;
}

export function finalizeBaseline(acc: BaselineAccumulator): BaselineProfile {
  const scores: Record<string, number> = {};
  for (const k of EMOTION_KEYS) scores[k] = acc.n ? Math.round((acc.scores[k] ?? 0) / acc.n) : 0;
  return {
    scores,
    compositeScore: Math.round(compositeOf(scores) * 10) / 10,
    sampledFrames: acc.n,
    recordedAt: new Date().toISOString(),
  };
}

// ---------------- 相对基线判断 ----------------

export interface BaselineEvalOptions {
  /** 相对自身基线落差超过该值才判为负向（默认 15 分） */
  dropThreshold?: number;
  /** 单类负向情绪绝对置信度超过该值直接判负（默认 55，比通用阈值更宽松，仅极端表情才触发） */
  negativeEmotionThreshold?: number;
}

/**
 * 用「相对自身基线」的方式评估当前情绪。
 * 关键：每个孩子的「平静」基准不同，自闭症孩子天生表情少，我们不能用统一阈值把它判成悲伤。
 * 只有明显低于「他自己」的平静基线，或某一负向表情极强时，才确认负向。
 */
export function evaluateRelative(
  scores: Record<string, number>,
  baseline: BaselineProfile | null,
  opts: BaselineEvalOptions = {},
): RelativeResult {
  const composite = compositeOf(scores);
  const base = baseline?.compositeScore ?? 70;
  const drop = base - composite;
  const dropThreshold = opts.dropThreshold ?? 15;
  const negEmoThreshold = opts.negativeEmotionThreshold ?? 55;

  let negative = false;
  if (drop >= dropThreshold) negative = true;
  for (const k of NEGATIVE_EMOTIONS) {
    if ((scores[k] ?? 0) >= negEmoThreshold) negative = true;
  }

  const { dominant, dominantScore } = dominantOf(scores);
  return {
    compositeScore: Math.round(composite * 10) / 10,
    baselineComposite: Math.round(base * 10) / 10,
    drop: Math.round(drop * 10) / 10,
    negative,
    dominant,
    dominantScore,
  };
}
