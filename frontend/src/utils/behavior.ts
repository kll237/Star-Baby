/**
 * 阶段二：动作行为识别（浏览器端）
 * - MotionTracker：基于视频帧差 + 人脸框位移提取运动特征（真实可运行路径）
 * - classifyBehavior：与后端 detection.math.classifyBehavior 一致的规则式分类器（12 类）
 * - DetectionSimulator：演示/无模型场景下的合成数据流，用于端到端联调与看板展示
 */

export interface MotionFeatures {
  motionEnergy: number; // 0-1 帧差运动能量
  dx: number; // -1..1 水平位移
  dy: number; // -1..1 垂直位移
  angular: number; // 0-1 角速度（转圈，需姿态估计）
  handsNearFace: number; // 0-1 双手接近面部（需姿态估计）
  headSway: number; // 0-1 头部摆动（摇头）
  offSeat: number; // 0-1 离座
  stillness: number; // 0-1 静止
  handClap: number; // 0-1 双手开合（拍手，需姿态估计）
  pointing: number; // 0-1 指向（需姿态估计）
  selfHit: number; // 0-1 自伤：手击打头面部（需姿态估计）
  // —— 补盲新增 ——
  fall: number; // 0-1 跌倒
  fight: number; // 0-1 打架/冲突（需多人检测）
  hitArm: number; // 0-1 击打自身手臂/大腿
  headBang: number; // 0-1 撞头/撞墙
  personCount: number; // 画面中人数
}

export interface BehaviorHit {
  behavior: string;
  confidence: number;
}

/**
 * 行为分类阈值：与后端 detection.math.BEHAVIOR_THRESHOLDS 保持一致，
 * 便于用真值标注数据网格搜索调参后统一覆盖。
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

/** 红色风险行为（与后端 RISK_BEHAVIORS 一致）：命中即优先，避免被「奔跑/跳动」盖掉 */
export const RED_BEHAVIORS = ['self_injury', 'hit_arm', 'head_bang', 'fall', 'fight'];

export function classifyBehavior(
  raw: Partial<MotionFeatures>,
  minConfidence: number = _bt.minConfidence,
): BehaviorHit {
  const f: MotionFeatures = {
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
    ...raw,
  };
  const candidates: BehaviorHit[] = [];

  // 高风险优先：跌倒 > 撞头 > 打架 > 击打肢体 > 自伤（击打头面）
  if (f.fall > _bt.fall) candidates.push({ behavior: 'fall', confidence: clamp(f.fall + 0.1) });
  if (f.headBang > _bt.headBang) candidates.push({ behavior: 'head_bang', confidence: clamp(f.headBang + 0.1) });
  if (f.fight > _bt.fight) candidates.push({ behavior: 'fight', confidence: clamp(f.fight + 0.1) });
  if (f.hitArm > _bt.hitArm) candidates.push({ behavior: 'hit_arm', confidence: clamp(f.hitArm + 0.1) });
  if (f.selfHit > _bt.selfHit) candidates.push({ behavior: 'self_injury', confidence: clamp(f.selfHit + 0.1) });
  if (f.handClap > _bt.handClap) candidates.push({ behavior: 'clap', confidence: clamp(f.handClap) });
  if (f.handsNearFace > _bt.handsNearFace) candidates.push({ behavior: 'cover_face', confidence: clamp(f.handsNearFace) });
  if (f.angular > _bt.angular) candidates.push({ behavior: 'spin', confidence: clamp(f.angular) });
  if (f.headSway > _bt.headSway) candidates.push({ behavior: 'shake_head', confidence: clamp(f.headSway) });
  if (f.pointing > _bt.pointing) candidates.push({ behavior: 'point', confidence: clamp(f.pointing) });
  if (f.offSeat > _bt.offSeat) candidates.push({ behavior: 'leave_seat', confidence: clamp(f.offSeat) });

  const bigMove = f.motionEnergy > _bt.bigMove;
  if (bigMove && Math.abs(f.dy) > Math.abs(f.dx)) {
    candidates.push({
      behavior: f.motionEnergy > _bt.jumpEnergy ? 'jump' : 'stamp',
      confidence: clamp(f.motionEnergy),
    });
  } else if (bigMove) {
    candidates.push({ behavior: 'run', confidence: clamp(f.motionEnergy) });
  }

  if (f.stillness > _bt.stillness && candidates.length === 0)
    candidates.push({ behavior: 'sit_still', confidence: clamp(f.stillness) });
  if (
    f.handsNearFace < _bt.handsNearFace &&
    f.motionEnergy > _bt.waveEnergy &&
    f.dx > _bt.waveDx &&
    candidates.length === 0
  )
    candidates.push({ behavior: 'wave', confidence: clamp(f.motionEnergy) });

  if (candidates.length === 0) return { behavior: 'sit_still', confidence: 0.6 };
  // 红色风险行为命中即优先：跌倒/打架/撞头/击打/自伤同样伴随高运动能量，
  // 纯按置信度排序会被「奔跑/跳动」盖掉（调参脚本实测 fight 的 F1 为 0 即因此）
  const redHits = candidates.filter((c) => RED_BEHAVIORS.includes(c.behavior));
  if (redHits.length > 0) {
    redHits.sort((a, b) => b.confidence - a.confidence);
    const red = redHits[0];
    return red.confidence < minConfidence
      ? { behavior: 'sit_still', confidence: Math.max(0.5, red.confidence) }
      : red;
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const top = candidates[0];
  if (top.confidence < minConfidence) return { behavior: 'sit_still', confidence: Math.max(0.5, top.confidence) };
  return top;
}

export const BEHAVIOR_LABELS: Record<string, string> = {
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

export const EMOTION_LABELS: Record<string, string> = {
  happy: '高兴',
  sad: '悲伤',
  angry: '愤怒',
  fear: '恐惧',
  surprise: '惊讶',
  disgust: '厌恶',
  neutral: '平静',
  // 复杂/复合情绪（由 complexEmotion.ts 合成）
  confused: '困惑',
  anxious: '焦虑',
  excited: '兴奋',
  tired: '疲惫',
  frustrated: '沮丧',
  focused: '专注',
  content: '满足',
};

export const EMOTION_EMOJI: Record<string, string> = {
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

/** 真实视频运动特征提取器（无需姿态模型即可识别运动类行为） */
export class MotionTracker {
  private prevGray: Uint8ClampedArray | null = null;
  private prevCenter: { x: number; y: number } | null = null;
  private baselineY: number | null = null;
  /** 坐姿时人脸 cy 的中位数窗口：只有 offSeat 低时才收集，避免站起来的帧污染基线 */
  private seatedYHist: number[] = [];
  private offSeatStreak = 0;
  private dxHistory: number[] = [];
  /** 整体运动能量历史：用于检测"接近-远离"的往复节奏（拍手/击打/撞头） */
  private energyHist: number[] = [];
  /** 人脸中心纵向历史：用于降级时近似跌倒检测 */
  private faceYHist: number[] = [];
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;

  constructor(private w = 64, private h = 48) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  update(video: HTMLVideoElement, faceBox: { x: number; y: number; width: number; height: number } | null): MotionFeatures {
    // 帧差运动能量
    this.ctx.drawImage(video, 0, 0, this.w, this.h);
    const data = this.ctx.getImageData(0, 0, this.w, this.h).data;
    const gray = new Uint8ClampedArray(this.w * this.h);
    for (let i = 0; i < this.w * this.h; i++) {
      gray[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
    }
    let motionEnergy = 0;
    // 网格帧差：4x3 分块，用于判断运动发生在画面哪个区域（头部？手臂？）
    const GW = 4;
    const GH = 3;
    const cellW = Math.floor(this.w / GW);
    const cellH = Math.floor(this.h / GH);
    const cells: number[] = new Array(GW * GH).fill(0);
    if (this.prevGray) {
      let sum = 0;
      for (let i = 0; i < gray.length; i++) sum += Math.abs(gray[i] - this.prevGray[i]);
      motionEnergy = clamp(sum / gray.length / 60, 0, 1);
      const prev = this.prevGray;
      for (let by = 0; by < GH; by++) {
        for (let bx = 0; bx < GW; bx++) {
          let cs = 0;
          let cnt = 0;
          for (let y = by * cellH; y < (by + 1) * cellH; y++) {
            for (let x = bx * cellW; x < (bx + 1) * cellW; x++) {
              const i = y * this.w + x;
              cs += Math.abs(gray[i] - prev[i]);
              cnt++;
            }
          }
          cells[by * GW + bx] = clamp(cnt ? cs / cnt / 60 : 0, 0, 1);
        }
      }
    }
    this.prevGray = gray;

    // 往复节奏：拍手/击打/撞头都是"接近-远离"的高频往复
    this.energyHist.push(motionEnergy);
    if (this.energyHist.length > 12) this.energyHist.shift();
    const rhythm = clamp(flipCount(this.energyHist, 0.05) / 4, 0, 1);

    // 人脸框位移
    let dx = 0;
    let dy = 0;
    let headSway = 0;
    let offSeat = 0;
    let headNearMotion = 0;
    let lowerMotion = 0;
    let fallApprox = 0;
    if (faceBox) {
      const cx = faceBox.x + faceBox.width / 2;
      const cy = faceBox.y + faceBox.height / 2;
      if (this.prevCenter) {
        dx = clamp((cx - this.prevCenter.x) / (video.videoWidth || 640), -1, 1);
        dy = clamp((cy - this.prevCenter.y) / (video.videoHeight || 480), -1, 1);
        this.dxHistory.push(dx);
        if (this.dxHistory.length > 12) this.dxHistory.shift();
        const signs = this.dxHistory.filter((v) => Math.abs(v) > 0.01).map((v) => Math.sign(v));
        const flips = signs.slice(1).filter((s, i) => s !== signs[i]).length;
        headSway = clamp(flips / 6, 0, 1);
      }
      // 维护坐姿基线：只在"看起来还坐着"时收集 cy，站起来时不污染基线
      const rawDelta = (this.baselineY ?? cy) - cy;
      const rawOffSeat = clamp(rawDelta / (video.videoHeight || 480) / 0.22, 0, 1);
      if (rawOffSeat < 0.35) {
        this.seatedYHist.push(cy);
        if (this.seatedYHist.length > 90) this.seatedYHist.shift();
        this.offSeatStreak = 0;
      } else {
        this.offSeatStreak += 1;
      }
      // 用坐姿窗口的中位数作为基线，对初始位置偏差和坐姿变化更鲁棒
      if (this.seatedYHist.length >= 10) {
        const sorted = [...this.seatedYHist].sort((a, b) => a - b);
        this.baselineY = sorted[Math.floor(sorted.length / 2)];
      } else if (this.baselineY === null) {
        this.baselineY = cy;
      }
      // 灵敏度降低（0.15→0.22），且只有连续多帧偏高才算真正离座
      offSeat = clamp((this.baselineY - cy) / (video.videoHeight || 480) / 0.22, 0, 1);
      if (this.offSeatStreak < 8) offSeat *= 0.6;
      this.prevCenter = { x: cx, y: cy };

      // 头部邻域运动：人脸所在网格及其 8 邻域中的最大运动能量
      const gx = clamp(Math.floor((cx / (video.videoWidth || 640)) * GW), 0, GW - 1);
      const gy = clamp(Math.floor((cy / (video.videoHeight || 480)) * GH), 0, GH - 1);
      let mx = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = gx + ox;
          const ny = gy + oy;
          if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
          mx = Math.max(mx, cells[ny * GW + nx] ?? 0);
        }
      }
      headNearMotion = clamp(mx, 0, 1);

      // 画面下三分之一（手臂/腿部区域）的平均运动
      let ls = 0;
      let lc = 0;
      for (let bx = 0; bx < GW; bx++) {
        ls += cells[(GH - 1) * GW + bx] ?? 0;
        lc++;
      }
      lowerMotion = clamp(lc ? ls / lc : 0, 0, 1);

      // 跌倒近似：人脸中心快速下沉 + 人脸框变扁（躺倒时侧向拉伸）
      const cyN = cy / (video.videoHeight || 480);
      this.faceYHist.push(cyN);
      if (this.faceYHist.length > 8) this.faceYHist.shift();
      if (this.faceYHist.length >= 3) {
        const fh = this.faceYHist;
        const drop = fh[fh.length - 1] - fh[Math.max(0, fh.length - 3)];
        fallApprox = clamp(drop / 0.05, 0, 1) * 0.7;
      }
      const faceAspect = faceBox.width / Math.max(faceBox.height, 1);
      fallApprox = clamp(fallApprox + clamp((faceAspect - 1.3) / 0.8, 0, 1) * 0.3, 0, 1);
    } else {
      this.prevCenter = null;
      this.dxHistory = [];
      this.faceYHist = [];
    }

    // —— 降级近似 ——
    // 无 MediaPipe 姿态模型时，这些特征不再写死为 0，而是用帧差的**空间分布**
    // 与**往复节奏**给出带噪声的估计。精度显著低于姿态关键点，仅作兜底。
    return {
      motionEnergy,
      dx,
      dy,
      angular: 0, // 转圈需躯干朝向，降级仍无法估计
      handsNearFace: clamp(headNearMotion * 0.8, 0, 1),
      headSway,
      offSeat,
      stillness: clamp(1 - motionEnergy, 0, 1),
      handClap: clamp(rhythm * lowerMotion * 0.9, 0, 1),
      pointing: 0, // 指向需手臂骨架几何，降级无法估计
      selfHit: clamp(headNearMotion * rhythm * 0.75, 0, 1),
      hitArm: clamp(lowerMotion * rhythm * 0.7, 0, 1),
      headBang: clamp(headNearMotion * rhythm * 0.6, 0, 1),
      fall: fallApprox,
      fight: 0, // 需多人检测，降级无法识别
      personCount: 0,
    };
  }

  reset() {
    this.prevGray = null;
    this.prevCenter = null;
    this.baselineY = null;
    this.seatedYHist = [];
    this.offSeatStreak = 0;
    this.dxHistory = [];
    this.energyHist = [];
    this.faceYHist = [];
  }
}

/** 演示数据流（无模型/无摄像头场景）：脚本化情绪 + 行为循环 */
export class DetectionSimulator {
  private t = 0;
  private emotionScript: Record<string, number>[] = [
    { neutral: 70, happy: 22, surprise: 5, sad: 2, angry: 1, fear: 0, disgust: 0 },
    { neutral: 60, happy: 30, surprise: 6, sad: 2, angry: 1, fear: 1, disgust: 0 },
    { happy: 75, neutral: 18, surprise: 5, sad: 1, angry: 0, fear: 1, disgust: 0 },
    { sad: 40, neutral: 20, fear: 25, angry: 8, surprise: 4, happy: 2, disgust: 1 },
    { angry: 35, sad: 25, fear: 20, neutral: 12, surprise: 5, happy: 2, disgust: 1 },
    { neutral: 55, happy: 30, surprise: 8, sad: 4, angry: 2, fear: 1, disgust: 0 },
  ];
  private behaviorCycle = [
    'sit_still', 'wave', 'clap', 'shake_head', 'cover_face',
    'spin', 'stamp', 'jump', 'run', 'point', 'leave_seat', 'sit_still',
  ];

  next(): { scores: Record<string, number>; behavior: BehaviorHit } {
    this.t += 1;
    const scores = { ...this.emotionScript[this.t % this.emotionScript.length] };
    const behavior = {
      behavior: this.behaviorCycle[this.t % this.behaviorCycle.length],
      confidence: 0.7 + (this.t % 3) * 0.08,
    };
    return { scores, behavior };
  }
}

export function clamp(v: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, v));
}

/** 统计序列中方向翻转的次数：用于识别"接近-远离"的往复运动（拍手/击打/撞头） */
export function flipCount(seq: number[], deadzone = 0.05): number {
  const signs: number[] = [];
  for (let i = 1; i < seq.length; i++) {
    const d = seq[i] - seq[i - 1];
    if (Math.abs(d) > deadzone) signs.push(Math.sign(d));
  }
  let flips = 0;
  for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) flips++;
  return flips;
}

// 情绪效价权重（与后端 EMOTION_VALENCE 一致，含复杂情绪）
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

/** 负向情绪（含复杂情绪中的沮丧/焦虑），达到阈值即判负向 */
const NEGATIVE_EMOTION_SET = ['angry', 'sad', 'fear', 'disgust', 'frustrated', 'anxious'];

export function computeCompositeScore(scores: Record<string, number>): {
  compositeScore: number;
  dominant: string;
  dominantScore: number;
  negative: boolean;
} {
  const keys = Object.keys(EMOTION_VALENCE);
  let weighted = 0;
  let total = 0;
  let dominant = 'neutral';
  let dominantScore = -1;
  for (const k of keys) {
    const s = clamp(Number(scores[k] ?? 0), 0, 100);
    weighted += EMOTION_VALENCE[k] * s;
    total += s;
    if (s > dominantScore) {
      dominantScore = s;
      dominant = k;
    }
  }
  const compositeScore = total > 0 ? weighted / total : 70;
  const negative =
    NEGATIVE_EMOTION_SET.some((k) => (scores[k] ?? 0) >= 45) || compositeScore < 45;
  return {
    compositeScore: Math.round(compositeScore * 10) / 10,
    dominant,
    dominantScore: Math.round(dominantScore * 10) / 10,
    negative,
  };
}
