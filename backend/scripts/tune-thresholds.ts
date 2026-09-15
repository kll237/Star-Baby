/**
 * 离线阈值调参：用真值标注数据评估并网格搜索识别阈值
 * =====================================================
 * 背景：本项目的情绪/行为识别是**纯规则式**的（无训练模型），所有判定阈值
 * 都是硬编码经验值。要让阈值站得住脚，必须用真值标注数据来评估与搜索。
 *
 * 运行：
 *   npx tsx backend/scripts/tune-thresholds.ts
 *   npx tsx backend/scripts/tune-thresholds.ts --data backend/data/my.jsonl --full
 *   npx tsx backend/scripts/tune-thresholds.ts --metric recall --out result.json
 *
 * 参数：
 *   --data <path>   标注数据（JSONL），默认 backend/data/annotations.jsonl
 *   --full          全量网格搜索（默认只搜关键维度，避免组合爆炸）
 *   --metric <name> 优化目标：f1（默认）| precision | recall
 *   --out <path>    把最优阈值与指标写成 JSON
 *
 * 标注数据格式（每行一个 JSON）：
 *   {"kind":"behavior","features":{...MotionFeatures},"label":"jump"}
 *   {"kind":"emotion","scores":{"happy":80,...},"label":{"negative":false}}
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  classifyBehavior,
  isNegativeState,
  computeCompositeScore,
  type MotionFeatures,
} from '../src/detection/detection.math';
import { BEHAVIOR_KEYS } from '../src/detection/detection.taxonomy';

// ---------------- 类型 ----------------
interface BehaviorSample {
  kind: 'behavior';
  features: Partial<MotionFeatures>;
  label: string;
}
interface EmotionSample {
  kind: 'emotion';
  scores: Record<string, number>;
  label: { negative: boolean };
}
type Sample = BehaviorSample | EmotionSample;

/** 可调阈值维度（与 detection.math.BEHAVIOR_THRESHOLDS 对应） */
type Thresholds = {
  selfHit: number;
  handClap: number;
  handsNearFace: number;
  headSway: number;
  offSeat: number;
  fall: number;
  headBang: number;
  hitArm: number;
  fight: number;
  stillness: number;
  bigMove: number;
  negativeEmotionThreshold: number;
  compositeFloor: number;
};

const DEFAULTS: Thresholds = {
  selfHit: 0.5,
  handClap: 0.5,
  handsNearFace: 0.6,
  headSway: 0.5,
  offSeat: 0.5,
  fall: 0.55,
  headBang: 0.5,
  hitArm: 0.5,
  fight: 0.5,
  stillness: 0.7,
  bigMove: 0.5,
  negativeEmotionThreshold: 45,
  compositeFloor: 45,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// ---------------- 参数化分类器 ----------------
/**
 * 与 detection.math.classifyBehavior 逻辑一致、但阈值可替换的版本。
 * 改动官方实现后必须同步这里（脚本启动时会做一次一致性自检）。
 */
export function classifyBehaviorWith(raw: Partial<MotionFeatures>, th: Thresholds): string {
  const f = {
    motionEnergy: 0, dx: 0, dy: 0, angular: 0, handsNearFace: 0, headSway: 0,
    offSeat: 0, stillness: 0, handClap: 0, pointing: 0, selfHit: 0,
    fall: 0, fight: 0, hitArm: 0, headBang: 0, personCount: 0,
    ...raw,
  };
  const c: { b: string; s: number }[] = [];
  if (f.fall > th.fall) c.push({ b: 'fall', s: clamp01(f.fall + 0.1) });
  if (f.headBang > th.headBang) c.push({ b: 'head_bang', s: clamp01(f.headBang + 0.1) });
  if (f.fight > th.fight) c.push({ b: 'fight', s: clamp01(f.fight + 0.1) });
  if (f.hitArm > th.hitArm) c.push({ b: 'hit_arm', s: clamp01(f.hitArm + 0.1) });
  if (f.selfHit > th.selfHit) c.push({ b: 'self_injury', s: clamp01(f.selfHit + 0.1) });
  if (f.handClap > th.handClap) c.push({ b: 'clap', s: clamp01(f.handClap) });
  if (f.handsNearFace > th.handsNearFace) c.push({ b: 'cover_face', s: clamp01(f.handsNearFace) });
  if (f.angular > 0.5) c.push({ b: 'spin', s: clamp01(f.angular) });
  if (f.headSway > th.headSway) c.push({ b: 'shake_head', s: clamp01(f.headSway) });
  if (f.pointing > 0.6) c.push({ b: 'point', s: clamp01(f.pointing) });
  if (f.offSeat > th.offSeat) c.push({ b: 'leave_seat', s: clamp01(f.offSeat) });

  const bigMove = f.motionEnergy > th.bigMove;
  if (bigMove && Math.abs(f.dy) > Math.abs(f.dx)) {
    c.push({ b: f.motionEnergy > 0.75 ? 'jump' : 'stamp', s: clamp01(f.motionEnergy) });
  } else if (bigMove) {
    c.push({ b: 'run', s: clamp01(f.motionEnergy) });
  }
  if (f.stillness > th.stillness && c.length === 0) c.push({ b: 'sit_still', s: clamp01(f.stillness) });
  if (f.handsNearFace < th.handsNearFace && f.motionEnergy > 0.3 && f.dx > 0.3 && c.length === 0) {
    c.push({ b: 'wave', s: clamp01(f.motionEnergy) });
  }
  if (c.length === 0) return 'sit_still';
  // 与官方 classifyBehavior 一致：红色风险行为（跌倒/撞头/打架/击打/自伤）命中即优先，
  // 否则会被高运动能量下的「奔跑/跳动」按其置信度盖掉（fight/wave 的 F1 会因此为 0）
  const RED = ['self_injury', 'hit_arm', 'head_bang', 'fall', 'fight'];
  const redHits = c.filter((x) => RED.includes(x.b));
  if (redHits.length > 0) {
    redHits.sort((a, b) => b.s - a.s);
    return redHits[0].s < 0.5 ? 'sit_still' : redHits[0].b;
  }
  c.sort((a, b) => b.s - a.s);
  return c[0].s < 0.5 ? 'sit_still' : c[0].b;
}

// ---------------- 指标 ----------------
interface BinaryMetrics {
  precision: number;
  recall: number;
  f1: number;
  support: number;
  tp: number;
  fp: number;
  fn: number;
}
function binary(tp: number, fp: number, fn: number): BinaryMetrics {
  const p = tp + fp > 0 ? tp / (tp + fp) : 0;
  const r = tp + fn > 0 ? tp / (tp + fn) : 0;
  return {
    precision: p,
    recall: r,
    f1: p + r > 0 ? (2 * p * r) / (p + r) : 0,
    support: tp + fn,
    tp,
    fp,
    fn,
  };
}
const score = (m: BinaryMetrics, metric: string) =>
  metric === 'precision' ? m.precision : metric === 'recall' ? m.recall : m.f1;

// ---------------- 评估 ----------------
function evaluateBehavior(samples: BehaviorSample[], th: Thresholds) {
  const labels = Array.from(new Set(samples.map((s) => s.label)));
  const per: Record<string, BinaryMetrics> = {};
  let weighted = 0;
  let totalSupport = 0;
  for (const label of labels) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const s of samples) {
      const pred = classifyBehaviorWith(s.features, th);
      if (s.label === label && pred === label) tp++;
      else if (s.label !== label && pred === label) fp++;
      else if (s.label === label && pred !== label) fn++;
    }
    const m = binary(tp, fp, fn);
    per[label] = m;
    weighted += m.f1 * m.support;
    totalSupport += m.support;
  }
  return { per, macroF1: totalSupport > 0 ? weighted / totalSupport : 0 };
}

function evaluateEmotion(samples: EmotionSample[], th: Thresholds) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const s of samples) {
    const c = computeCompositeScore(s.scores);
    const pred = isNegativeState(s.scores, c.compositeScore, {
      negativeEmotionThreshold: th.negativeEmotionThreshold,
      compositeFloor: th.compositeFloor,
    });
    const truth = !!s.label.negative;
    if (pred && truth) tp++;
    else if (pred && !truth) fp++;
    else if (!pred && truth) fn++;
    else tn++;
  }
  return { ...binary(tp, fp, fn), tn };
}

// ---------------- 网格搜索 ----------------
function* grid(full: boolean): Generator<Partial<Thresholds>> {
  const axis = (v: number, fullMode: boolean) =>
    fullMode ? [v * 0.6, v * 0.8, v, v * 1.2, v * 1.4] : [v * 0.8, v, v * 1.2];
  const dims: (keyof Thresholds)[] = full
    ? ['selfHit', 'hitArm', 'headBang', 'fall', 'fight', 'handClap', 'handsNearFace', 'headSway', 'offSeat', 'stillness', 'bigMove', 'negativeEmotionThreshold', 'compositeFloor']
    : ['selfHit', 'hitArm', 'headBang', 'fall', 'negativeEmotionThreshold', 'compositeFloor'];
  const values = dims.map((d) => axis(DEFAULTS[d], full).map((v) => [d, v] as const));

  const walk = function* (i: number, acc: Partial<Thresholds>): Generator<Partial<Thresholds>> {
    if (i >= values.length) {
      yield { ...acc };
      return;
    }
    for (const [k, v] of values[i]) {
      yield* walk(i + 1, { ...acc, [k]: v });
    }
  };
  yield* walk(0, {});
}

// ---------------- 主流程 ----------------
function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string, def?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  // 兼容从项目根（backend/data/...）或 backend 目录（data/...）两种运行方式
  const candidates = [
    arg('data'),
    resolve(process.cwd(), 'backend/data/annotations.jsonl'),
    resolve(process.cwd(), 'data/annotations.jsonl'),
  ].filter(Boolean) as string[];
  const dataPath = candidates.find((p) => existsSync(p)) ?? candidates[0];
  const full = argv.includes('--full');
  const metric = arg('metric', 'f1')!;
  const outPath = arg('out');

  if (!existsSync(dataPath)) {
    console.error(`[调参] 找不到标注数据：${dataPath}`);
    console.error('请先按 backend/data/annotations.jsonl 的格式准备真值标注，或用 --data 指定路径。');
    process.exit(1);
  }

  const samples: Sample[] = readFileSync(dataPath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Sample);

  const behaviorSamples = samples.filter((s) => s.kind === 'behavior') as BehaviorSample[];
  const emotionSamples = samples.filter((s) => s.kind === 'emotion') as EmotionSample[];
  console.log(`[调参] 载入 ${samples.length} 条标注（行为 ${behaviorSamples.length} / 情绪 ${emotionSamples.length}）`);

  // 一致性自检：默认阈值下参数化版本必须与官方实现一致
  if (behaviorSamples.length) {
    let diff = 0;
    for (const s of behaviorSamples) {
      if (classifyBehavior(s.features).behavior !== classifyBehaviorWith(s.features, DEFAULTS)) diff++;
    }
    if (diff > 0) {
      console.warn(`[自检] ⚠️ 参数化实现与官方 classifyBehavior 有 ${diff}/${behaviorSamples.length} 处不一致，请同步脚本内的逻辑！`);
    } else {
      console.log('[自检] ✅ 参数化实现与官方 classifyBehavior 完全一致');
    }
  }

  // 基线
  if (behaviorSamples.length) {
    const base = evaluateBehavior(behaviorSamples, DEFAULTS);
    console.log(`\n[基线] 行为宏平均 F1 = ${base.macroF1.toFixed(3)}`);
    for (const [k, m] of Object.entries(base.per)) {
      console.log(`  ${k.padEnd(12)} P=${m.precision.toFixed(2)} R=${m.recall.toFixed(2)} F1=${m.f1.toFixed(2)} (n=${m.support})`);
    }
  }
  if (emotionSamples.length) {
    const base = evaluateEmotion(emotionSamples, DEFAULTS);
    console.log(`[基线] 情绪负向判定 P=${base.precision.toFixed(2)} R=${base.recall.toFixed(2)} F1=${base.f1.toFixed(2)} (n=${base.support})`);
  }

  // 搜索
  let best: { th: Thresholds; score: number; detail: string } | null = null;
  let tried = 0;
  for (const patch of grid(full)) {
    const th: Thresholds = { ...DEFAULTS, ...patch };
    let s = 0;
    let parts: string[] = [];
    if (behaviorSamples.length) {
      const r = evaluateBehavior(behaviorSamples, th);
      s += r.macroF1;
      parts.push(`行为F1=${r.macroF1.toFixed(3)}`);
    }
    if (emotionSamples.length) {
      const r = evaluateEmotion(emotionSamples, th);
      s += score(r, metric);
      parts.push(`情绪${metric}=${score(r, metric).toFixed(3)}`);
    }
    tried++;
    if (!best || s > best.score) best = { th, score: s, detail: parts.join(' ') };
  }
  console.log(`\n[搜索] 共评估 ${tried} 组阈值组合（优化目标 ${metric}）`);

  if (best) {
    console.log(`[最优] ${best.detail}`);
    console.log('\n可直接覆盖的阈值：');
    console.log('export const BEHAVIOR_THRESHOLDS = {');
    for (const [k, v] of Object.entries(best.th)) {
      const changed = v !== DEFAULTS[k] ? '  ← 已调整' : '';
      console.log(`  ${k}: ${v},${changed}`);
    }
    console.log('};');
    console.log('\n注意：前后端需同步（backend/src/detection/detection.math.ts 与 frontend/src/utils/behavior.ts），');
    console.log('情绪阈值同理在 frontend/src/utils/complexEmotion.ts 的 EMOTION_THRESHOLDS。');
    console.log('\n安全场景提示：看护场景中漏报代价远高于误报，建议优先看 recall；');
    console.log('追求更高召回可运行 --metric recall。');

    if (outPath) {
      writeFileSync(resolve(process.cwd(), outPath), JSON.stringify({ thresholds: best.th, score: best.score }, null, 2));
      console.log(`\n[输出] 已写入 ${outPath}`);
    }
  }
  void BEHAVIOR_KEYS;
}

main();
