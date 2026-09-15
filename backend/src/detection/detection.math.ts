import {
  EMOTION_KEYS,
  EMOTION_VALENCE,
  NEGATIVE_EMOTIONS,
  RISK_BEHAVIORS,
  type EmotionKey,
  type EmotionScores,
  type BehaviorKey,
} from './detection.taxonomy';

export interface CompositeResult {
  /** 综合情绪状态评分 0-100（越高越积极/平静） */
  compositeScore: number;
  dominant: EmotionKey;
  dominantScore: number;
  negative: boolean;
}

/**
 * 计算综合情绪状态评分（0-100）。
 * 以各情绪置信度为权重，对效价权重做加权平均，归一化到 0-100。
 * 公式：composite = Σ(valence_i * score_i) / Σ(score_i)
 */
export function computeCompositeScore(scores: EmotionScores): CompositeResult {
  const norm = normalizeScores(scores);
  let weighted = 0;
  let total = 0;
  let dominant: EmotionKey = 'neutral';
  let dominantScore = -1;
  for (const key of EMOTION_KEYS) {
    const s = norm[key];
    weighted += EMOTION_VALENCE[key] * s;
    total += s;
    if (s > dominantScore) {
      dominantScore = s;
      dominant = key;
    }
  }
  const compositeScore = total > 0 ? weighted / total : EMOTION_VALENCE.neutral;
  const negative = isNegativeState(norm, compositeScore);
  return {
    compositeScore: round1(clamp(compositeScore, 0, 100)),
    dominant,
    dominantScore: round1(dominantScore),
    negative,
  };
}

/**
 * 判断当前是否为负向情绪状态。
 * 触发条件（满足其一）：
 *  - 主导情绪为负向情绪且置信度 ≥ negativeEmotionThreshold（默认 35）
 *  - 综合评分 < compositeFloor（默认 40）
 */
export function isNegativeState(
  scores: EmotionScores,
  compositeScore: number,
  opts: { negativeEmotionThreshold?: number; compositeFloor?: number } = {},
): boolean {
  const negativeEmotionThreshold = opts.negativeEmotionThreshold ?? 45;
  const compositeFloor = opts.compositeFloor ?? 45;
  for (const key of NEGATIVE_EMOTIONS) {
    if ((scores[key] ?? 0) >= negativeEmotionThreshold) return true;
  }
  return compositeScore < compositeFloor;
}

/** 把任意输入归一化为 7 类、0-100 的置信度分布（缺失补 0）。 */
export function normalizeScores(scores: EmotionScores): Record<EmotionKey, number> {
  const out = {} as Record<EmotionKey, number>;
  for (const key of EMOTION_KEYS) {
    const v = Number(scores[key] ?? 0);
    out[key] = clamp(Number.isFinite(v) ? v : 0, 0, 100);
  }
  return out;
}

export interface MotionFeatures {
  /** 整体运动能量 0-1（帧差 / 光流幅度） */
  motionEnergy: number;
  /** 水平位移 -1..1（左负右正） */
  dx: number;
  /** 垂直位移 -1..1（上负下正） */
  dy: number;
  /** 角速度（转圈）0-1 */
  angular: number;
  /** 双手抬至面部区域比例 0-1 */
  handsNearFace: number;
  /** 头部摆动幅度 0-1（摇头） */
  headSway: number;
  /** 躯干是否离开座椅中心（离座）0-1 */
  offSeat: number;
  /** 身体是否基本静止 0-1 */
  stillness: number;
  /** 双手是否高频开合（拍手）0-1 */
  handClap: number;
  /** 是否检测到指向手势（单手指向前方）0-1 */
  pointing: number;
  /** 是否疑似自伤（击打自身头部/肢体）0-1 */
  selfHit: number;
  /** 跌倒 0-1（躯干倾角突变 + 高度骤降） */
  fall: number;
  /** 打架/肢体冲突 0-1（多人贴近 + 高频高幅） */
  fight: number;
  /** 击打自身手臂/大腿 0-1（自伤漏报场景） */
  hitArm: number;
  /** 撞头/撞墙 0-1（自伤漏报场景） */
  headBang: number;
  /** 画面中人数（多人检测） */
  personCount: number;
}

const DEFAULT_FEATURES: MotionFeatures = {
  motionEnergy: 0,
  dx: 0,
  dy: 0,
  angular: 0,
  handsNearFace: 0,
  headSway: 0,
  offSeat: 0,
  stillness: 0,
  handClap: 0,
  pointing: 0,
  selfHit: 0,
  fall: 0,
  fight: 0,
  hitArm: 0,
  headBang: 0,
  personCount: 0,
};

/**
 * 行为分类阈值：集中在这里，便于用真值标注数据做网格搜索调参
 * （见 backend/scripts/tune-thresholds.ts）。前后端需保持同一份默认值。
 */
export const BEHAVIOR_THRESHOLDS = {
  fall: 0.55,
  headBang: 0.5,
  fight: 0.5,
  hitArm: 0.5,
  selfHit: 0.5,
  handClap: 0.5,
  handsNearFace: 0.6,
  angular: 0.5,
  headSway: 0.5,
  pointing: 0.6,
  offSeat: 0.6,
  bigMove: 0.5,
  jumpEnergy: 0.75,
  stillness: 0.7,
  waveEnergy: 0.3,
  waveDx: 0.3,
  minConfidence: 0.5,
} as const;

export type BehaviorThresholds = typeof BEHAVIOR_THRESHOLDS;

let _bt: BehaviorThresholds = { ...BEHAVIOR_THRESHOLDS };

/** 覆盖行为分类阈值（调参脚本 / 个性化校准用） */
export function setBehaviorThresholds(patch: Partial<BehaviorThresholds>): void {
  _bt = { ..._bt, ...patch };
}
export function getBehaviorThresholds(): BehaviorThresholds {
  return { ..._bt };
}

/**
 * 基于运动特征的规则式动作行为分类器（纯函数，便于单元测试）。
 * 返回置信度最高的行为；置信度 < minConfidence 时返回 'sit_still'（默认静坐）。
 * 这是浏览器端无法加载大模型时的可运行降级路径；接入 MediaPipe Pose / ST-GCN
 * 后可作为交叉验证或离线回退。
 */
export function classifyBehavior(
  rawFeatures: Partial<MotionFeatures>,
  minConfidence: number = _bt.minConfidence,
): { behavior: BehaviorKey; confidence: number } {
  const f: MotionFeatures = { ...DEFAULT_FEATURES, ...rawFeatures };

  // 优先级：高风险 > 明显动作 > 静态
  const candidates: { behavior: BehaviorKey; confidence: number }[] = [];

  // 高风险优先：跌倒 > 撞头 > 打架 > 击打肢体 > 自伤（击打头面）
  if (f.fall > _bt.fall)
    candidates.push({ behavior: 'fall', confidence: clamp(f.fall + 0.1, 0, 1) });
  if (f.headBang > _bt.headBang)
    candidates.push({ behavior: 'head_bang', confidence: clamp(f.headBang + 0.1, 0, 1) });
  if (f.fight > _bt.fight)
    candidates.push({ behavior: 'fight', confidence: clamp(f.fight + 0.1, 0, 1) });
  if (f.hitArm > _bt.hitArm)
    candidates.push({ behavior: 'hit_arm', confidence: clamp(f.hitArm + 0.1, 0, 1) });
  if (f.selfHit > _bt.selfHit)
    candidates.push({ behavior: 'self_injury', confidence: clamp(f.selfHit + 0.1, 0, 1) });
  if (f.handClap > _bt.handClap)
    candidates.push({ behavior: 'clap', confidence: clamp(f.handClap, 0, 1) });
  if (f.handsNearFace > _bt.handsNearFace)
    candidates.push({ behavior: 'cover_face', confidence: clamp(f.handsNearFace, 0, 1) });
  if (f.angular > _bt.angular)
    candidates.push({ behavior: 'spin', confidence: clamp(f.angular, 0, 1) });
  if (f.headSway > _bt.headSway)
    candidates.push({ behavior: 'shake_head', confidence: clamp(f.headSway, 0, 1) });
  if (f.pointing > _bt.pointing)
    candidates.push({ behavior: 'point', confidence: clamp(f.pointing, 0, 1) });
  if (f.offSeat > _bt.offSeat)
    candidates.push({ behavior: 'leave_seat', confidence: clamp(f.offSeat, 0, 1) });

  // 大幅位移 + 高运动能量 → 奔跑 / 跳动 / 跺脚
  const bigMove = f.motionEnergy > _bt.bigMove;
  if (bigMove && Math.abs(f.dy) > Math.abs(f.dx)) {
    // 垂直方向能量强：跺脚（小幅高频）或跳动（大幅）
    candidates.push({
      behavior: f.motionEnergy > _bt.jumpEnergy ? 'jump' : 'stamp',
      confidence: clamp(f.motionEnergy, 0, 1),
    });
  } else if (bigMove) {
    candidates.push({ behavior: 'run', confidence: clamp(f.motionEnergy, 0, 1) });
  }

  if (f.stillness > _bt.stillness && candidates.length === 0)
    candidates.push({ behavior: 'sit_still', confidence: clamp(f.stillness, 0, 1) });
  if (
    f.handsNearFace < _bt.handsNearFace &&
    f.motionEnergy > _bt.waveEnergy &&
    f.dx > _bt.waveDx &&
    candidates.length === 0
  )
    candidates.push({ behavior: 'wave', confidence: clamp(f.motionEnergy, 0, 1) });

  if (candidates.length === 0) {
    return { behavior: 'sit_still', confidence: 0.6 };
  }
  // 红色风险行为一旦命中就优先返回：跌倒/打架/撞头/击打/自伤同样伴随高运动能量，
  // 若纯按置信度排序会被「奔跑/跳动」盖掉（调参脚本实测 fight 的 F1 为 0 即因此）
  const redHits = candidates.filter((c) => RISK_BEHAVIORS.includes(c.behavior));
  if (redHits.length > 0) {
    redHits.sort((a, b) => b.confidence - a.confidence);
    const red = redHits[0];
    return red.confidence < minConfidence
      ? { behavior: 'sit_still', confidence: Math.max(0.5, red.confidence) }
      : red;
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const top = candidates[0];
  if (top.confidence < minConfidence) {
    return { behavior: 'sit_still', confidence: Math.max(0.5, top.confidence) };
  }
  return top;
}

// ---------------- 工具 ----------------
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
