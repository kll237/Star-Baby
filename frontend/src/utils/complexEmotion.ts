/**
 * 复杂/复合情绪识别层
 * ---------------------------------------------------------------
 * face-api 的 faceExpressionNet 只能直出 7 类基础表情，无法表达
 * 「困惑/焦虑/兴奋/疲惫/沮丧/专注/满足」这类在自闭症儿童看护场景中
 * 更常见也更有干预价值的状态。
 *
 * 本模块把三类信号合成为复杂情绪：
 *   1. 基础表情分布（happy/sad/angry/fear/surprise/disgust/neutral）
 *   2. 面部几何（EAR 眼纵横比 / MAR 嘴纵横比 / 眉毛 / 头部姿态）
 *   3. 身体运动（运动能量 / 头部摆动 / 手靠近脸 / 静止度）
 *
 * 所有阈值集中在 EMOTION_THRESHOLDS，支持运行时覆盖，
 * 便于用标注数据做网格搜索调参（见 backend/scripts/tune-thresholds）。
 */

import type { FaceMetrics } from './face';

export interface ComplexMotionInput {
  /** 0-1 帧差运动能量 */
  motionEnergy: number;
  /** 0-1 头部摆动 */
  headSway: number;
  /** 0-1 手接近面部 */
  handsNearFace: number;
  /** 0-1 静止度 */
  stillness: number;
  /** -1..1 垂直位移（跳动/身体起伏） */
  dy: number;
}

export interface ComplexEmotionInput {
  /** 7 类基础情绪，0-100 */
  basic: Record<string, number>;
  face: FaceMetrics | null;
  motion: ComplexMotionInput;
}

export interface ComplexEmotionResult {
  /** 融合后的完整分布（7 基础 + 7 复杂），总和约 100 */
  scores: Record<string, number>;
  /** 各复杂情绪的原始置信度 0-100 */
  complex: Record<string, number>;
  /** 胜出的复杂情绪（未达阈值时为 null） */
  winner: string | null;
  /** 触发线索（可解释性：家长端展示 / 调参排查） */
  cues: string[];
}

/** 复杂情绪键（与后端 COMPLEX_EMOTION_KEYS 一致） */
export const COMPLEX_EMOTION_KEYS = [
  'confused',
  'anxious',
  'excited',
  'tired',
  'frustrated',
  'focused',
  'content',
] as const;

/**
 * 可调阈值：全部集中在此，可用 setEmotionThresholds() 覆盖，
 * 供离线评估脚本做网格搜索（数据驱动调参）。
 */
export const EMOTION_THRESHOLDS = {
  /** 复杂情绪参与融合的最低置信度（提高，避免专注/平静等常见状态轻易覆盖明显基础表情） */
  complexMin: 48,
  /** 复杂情绪在最终分布中最多占据的权重 */
  complexMaxWeight: 0.55,
  /** 无面部关键点时对依赖几何的情绪打多少折 */
  noFaceDiscount: 0.5,

  // 眼睑 / 嘴
  earDroopStart: 0.26, // EAR 低于此开始认为眼睑下垂
  earDroopFull: 0.14, // EAR 低于此认为接近闭合
  earOpenFull: 0.3, // EAR 高于此认为睁眼充分
  marYawn: 0.35, // MAR 高于此认为张口（哈欠/喊叫）
  marOpen: 0.25, // MAR 高于此认为开口
  marPressed: 0.22, // MAR 低于此认为抿嘴
  marSoftMax: 0.35, // 微笑/满足时 MAR 上限

  // 运动
  motionLow: 0.18, // 低于此认为少动
  motionMid: 0.3, // 中等运动起点
  motionHigh: 0.45, // 高于此认为活跃
  bounce: 0.25, // |dy| 高于此认为身体起伏（跳/蹦）

  // 头部姿态
  pitchDown: 0.35, // pitch 高于此认为低头
  rollTilt: 0.4, // |roll| 高于此认为歪头
  swayFidget: 0.45, // headSway 高于此认为坐立不安
  faceTouch: 0.45, // handsNearFace 高于此认为手常触脸

  // 基础情绪参考点
  negMidFull: 60, // 负向情绪达到此值认为明显
  joyFull: 60, // happy 达到此值认为明显愉悦
  angerMixFull: 55, // angry/sad 混合达到此值
  contentJoyFull: 45, // 满足所需的 happy 参考
  contentPeak: 50, // 满足的 happy 峰值（过高则更偏 excited）
} as const;

export type EmotionThresholds = typeof EMOTION_THRESHOLDS;

let _thresholds: EmotionThresholds = { ...EMOTION_THRESHOLDS };

/** 覆盖阈值（调参/个性化校准用） */
export function setEmotionThresholds(patch: Partial<EmotionThresholds>): void {
  _thresholds = { ..._thresholds, ...patch };
}
export function getEmotionThresholds(): EmotionThresholds {
  return { ..._thresholds };
}

const c01 = (v: number) => Math.min(1, Math.max(0, v));

/** 归一化到 0-100 的 ramp：v 从 lo 到 hi 线性映射到 0-100 */
function ramp(v: number, lo: number, hi: number): number {
  if (hi === lo) return v >= hi ? 100 : 0;
  return c01((v - lo) / (hi - lo)) * 100;
}
/** 反向 ramp：v 从 hi 降到 lo 时 0→100 */
function rampDown(v: number, hi: number, lo: number): number {
  return ramp(-v, -hi, -lo);
}

const num = (o: Record<string, number>, k: string) => Number(o[k] ?? 0);

/**
 * 计算 7 类复杂情绪置信度（0-100）。
 * 依赖面部几何的情绪在无关键点时会被打折，避免凭运动特征臆测。
 */
export function computeComplexEmotions(input: ComplexEmotionInput): { complex: Record<string, number>; cues: string[] } {
  const T = _thresholds;
  const b = input.basic;
  const f = input.face;
  const m = input.motion;
  const cues: string[] = [];
  const out: Record<string, number> = {};

  const hasFace = !!f;
  const ear = f?.ear ?? 0.28;
  const mar = f?.mar ?? 0.2;

  // ---------- 疲惫 tired：眼睑下垂 + 哈欠 + 少动 + 低头 ----------
  if (hasFace) {
    const droop = rampDown(ear, T.earDroopStart, T.earDroopFull);
    const yawn = ramp(mar, T.marYawn, T.marYawn + 0.35);
    const still = rampDown(m.motionEnergy, T.motionLow, 0.02);
    const headDown = ramp(Math.abs(Math.max(f?.pitch ?? 0, 0)), 0.05, T.pitchDown);
    out.tired = c01(0.4 * (droop / 100) + 0.3 * (yawn / 100) + 0.18 * (still / 100) + 0.12 * (headDown / 100)) * 100;
    if (ear < T.earDroopStart) cues.push(`眼睑下垂 EAR=${ear.toFixed(2)}`);
    if (mar > T.marYawn) cues.push(`张口/哈欠 MAR=${mar.toFixed(2)}`);
    if ((f?.pitch ?? 0) > T.pitchDown) cues.push('头部低垂');
  } else {
    out.tired = 0;
  }

  // ---------- 专注 focused：静止 + 睁眼 + 中性显著领先 + 嘴闭合 + 头部稳定 ----------
  // 专注容易误触发：只要平静/睁眼/不晃就被判专注，会压住惊讶、高兴等明显基础表情。
  // 因此要求：neutral 必须显著领先次高情绪，嘴部相对闭合，无惊讶/恐惧等强情绪。
  const BASIC_EMOTION_KEYS = ['happy', 'sad', 'angry', 'fear', 'surprise', 'disgust', 'neutral'];
  const neutralScore = num(b, 'neutral');
  const nextScore = Math.max(...BASIC_EMOTION_KEYS.filter((k) => k !== 'neutral').map((k) => num(b, k)));
  const neutralDominant = neutralScore > nextScore + 15 ? 1 : 0;
  const stillN = ramp(m.stillness, 0.65, 0.92);
  const steady = rampDown(m.headSway, 0.35, 0.05);
  const eyesOpen = hasFace ? ramp(ear, T.earDroopFull, T.earOpenFull) : 50;
  const mouthClosed = hasFace ? rampDown(mar, T.marOpen, 0.05) : 50;
  const browCalm = hasFace ? rampDown(f?.browFurrow ?? 0, 0.35, 0.05) : 50;
  const noStrongSurprise = num(b, 'surprise') < 30 && num(b, 'fear') < 25 ? 1 : 0;
  out.focused =
    c01(
      0.32 * neutralDominant +
        0.22 * (stillN / 100) +
        0.18 * (eyesOpen / 100) +
        0.13 * (steady / 100) +
        0.08 * (mouthClosed / 100) +
        0.07 * (browCalm / 100),
    ) *
    100 *
    noStrongSurprise;
  if (stillN > 70 && steady > 60 && neutralDominant > 0.5) cues.push('身体稳定、注意力集中');

  // ---------- 困惑 confused：眉毛不对称 + 歪头 + 表情不确定 + 轻皱眉 ----------
  if (hasFace) {
    const asym = ramp(f?.browAsym ?? 0, 0.12, 0.5);
    const tilt = ramp(Math.abs(f?.roll ?? 0), 0.08, T.rollTilt);
    const topOther = Math.max(num(b, 'surprise'), num(b, 'sad'), num(b, 'fear'));
    // 表情"拿不准"：neutral 与次高情绪接近
    const uncert = rampDown(Math.abs(num(b, 'neutral') - topOther), 60, 5);
    const furrow = ramp(f?.browFurrow ?? 0, 0.15, 0.65);
    out.confused = c01(0.32 * (asym / 100) + 0.26 * (tilt / 100) + 0.24 * (uncert / 100) + 0.18 * (furrow / 100)) * 100;
    if ((f?.browAsym ?? 0) > 0.15) cues.push('眉毛不对称');
    if (Math.abs(f?.roll ?? 0) > 0.15) cues.push('歪头');
  } else {
    out.confused = 0;
  }

  // ---------- 焦虑 anxious：恐惧/悲伤中等 + 手触脸 + 坐立不安 + 抿嘴 ----------
  const fearSad = ramp(Math.max(num(b, 'fear'), num(b, 'sad')), 12, T.negMidFull);
  const faceTouch = ramp(m.handsNearFace, 0.2, 0.8);
  const fidget = c01((ramp(m.headSway, 0.15, T.swayFidget) / 100) * (1 - c01(m.motionEnergy / 0.6)));
  const pressed = hasFace ? rampDown(mar, T.marPressed, 0.06) : 50;
  out.anxious = c01(0.35 * (fearSad / 100) + 0.25 * (faceTouch / 100) + 0.2 * fidget + 0.2 * (pressed / 100)) * 100;
  if (m.handsNearFace > T.faceTouch) cues.push('手频繁靠近面部');
  if (m.headSway > T.swayFidget) cues.push('坐立不安');

  // ---------- 兴奋 excited：愉悦 + 高运动 + 张口 + 身体起伏 ----------
  const joy = ramp(num(b, 'happy'), 20, T.joyFull);
  const energy = ramp(m.motionEnergy, 0.22, T.motionHigh + 0.2);
  const openMouth = hasFace ? ramp(mar, T.marOpen, T.marOpen + 0.3) : (num(b, 'happy') > 50 ? 55 : 20);
  const bounce = ramp(Math.abs(m.dy), 0.05, T.bounce);
  out.excited = c01(0.34 * (joy / 100) + 0.28 * (energy / 100) + 0.2 * (openMouth / 100) + 0.18 * (bounce / 100)) * 100;
  if (m.motionEnergy > T.motionHigh && num(b, 'happy') > 40) cues.push('愉悦且活动量大');

  // ---------- 沮丧 frustrated：愤怒/悲伤混合 + 皱眉 + 躁动 ----------
  const angerMix = ramp((num(b, 'angry') * 0.6 + num(b, 'sad') * 0.4), 10, T.angerMixFull);
  const furrow2 = hasFace ? ramp(f?.browFurrow ?? 0, 0.2, 0.7) : 45;
  const agitation = ramp(m.motionEnergy, 0.15, 0.5);
  out.frustrated = c01(0.4 * (angerMix / 100) + 0.35 * (furrow2 / 100) + 0.25 * (agitation / 100)) * 100;
  if ((f?.browFurrow ?? 0) > 0.5) cues.push('眉头紧锁');

  // ---------- 满足 content：温和愉悦 + 安静 + 嘴角微扬（非大张嘴） ----------
  const happyV = num(b, 'happy');
  const mildJoy = c01((ramp(happyV, 12, T.contentJoyFull) / 100) * (1 - c01(Math.abs(happyV - T.contentPeak) / 70)));
  const calm2 = ramp(m.stillness, 0.5, 0.9);
  const softMouth = hasFace ? rampDown(mar, T.marSoftMax, 0.05) : 55;
  out.content = c01(0.4 * mildJoy + 0.35 * (calm2 / 100) + 0.25 * (softMouth / 100)) * 100;
  if (happyV > 30 && m.stillness > 0.6) cues.push('情绪平稳愉悦');

  // 无面部关键点时对强依赖几何的情绪打折，避免凭运动臆测
  if (!hasFace) {
    out.tired = out.tired * T.noFaceDiscount;
    out.confused = out.confused * T.noFaceDiscount;
    out.focused = out.focused * T.noFaceDiscount;
    out.content = out.content * T.noFaceDiscount;
  }

  for (const k of COMPLEX_EMOTION_KEYS) {
    out[k] = Math.round(Math.min(100, Math.max(0, out[k] ?? 0)) * 10) / 10;
  }
  return { complex: out, cues };
}

/**
 * 把复杂情绪融合进基础情绪分布。
 * 只有置信度达到 complexMin 的复杂情绪才会占据分布权重，
 * 未达标时仅作为参考分数返回，避免噪声干扰主导情绪与综合分。
 */
export function applyComplexEmotion(input: ComplexEmotionInput): ComplexEmotionResult {
  const T = _thresholds;
  const { complex, cues } = computeComplexEmotions(input);

  let winner: string | null = null;
  let best = -1;
  for (const k of COMPLEX_EMOTION_KEYS) {
    if ((complex[k] ?? 0) > best) {
      best = complex[k] ?? 0;
      winner = k;
    }
  }

  const scores: Record<string, number> = { ...input.basic };
  // 当基础情绪已经强势且领先明显时，复杂情绪必须显著更强才能覆盖，
  // 避免"专注"等常见复杂状态轻易压住"高兴/惊讶"等明显基础表情。
  const basicSorted = Object.entries(input.basic).sort((a, c) => c[1] - a[1]);
  const basicDominantScore = basicSorted[0]?.[1] ?? 0;
  const basicDominantGap = basicDominantScore - (basicSorted[1]?.[1] ?? 0);
  const basicDominantSuppresses =
    basicDominantScore >= 55 && basicDominantGap > 12 && best < basicDominantScore + 8;
  if (winner && best >= T.complexMin && !basicDominantSuppresses) {
    const w = Math.min(T.complexMaxWeight, (best / 100) * T.complexMaxWeight + 0.08);
    for (const k of Object.keys(scores)) scores[k] = (scores[k] ?? 0) * (1 - w);
    scores[winner] = (scores[winner] ?? 0) + w * 100;
    cues.push(`复杂情绪命中：${winner}（${best.toFixed(0)}%）`);
  } else {
    winner = null;
  }
  return { scores, complex, winner, cues };
}
