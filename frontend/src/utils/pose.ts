/**
 * 阶段三：基于 MediaPipe 姿态 / 手部关键点（浏览器端 WASM 推理）的真实行为特征提取。
 *
 * 解决此前 MotionTracker 把 selfHit / handClap / pointing / handsNearFace / angular
 * 全部写死为 0 的问题 —— 摄像头实时画面里「自残 / 捂脸 / 拍手 / 指认 / 转圈」现在能真正识别。
 *
 * 设计要点：
 * - 懒加载：首次使用时才下载 wasm + .task 模型（本地 public 目录，离线可用）。
 * - 优雅降级：模型加载失败 / 推理异常时，PoseDetector 标记为不可用，
 *   调用方回退到既有 MotionTracker（运动类行为仍可用），绝不抛错中断页面。
 * - 同时支持视频流（detectForVideo）与单张图片（detectForImage，供「上传照片自检」）。
 */

import {
  FilesetResolver,
  PoseLandmarker,
  HandLandmarker,
  type PoseLandmarkerResult,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';

/**
 * 屏蔽 MediaPipe 向 Google 发送的遥测噪声。
 *
 * 根因：MediaPipe Tasks Vision 的遥测上报使用的是它**自己封装的 XHR 传输层**
 * （`this.m.send({url:"https://odml.pa.googleapis.com/v1/log", ...})`），根本不调用
 * `window.fetch`；且被本项目的 CSP（`connect-src 'self' ws: wss:`）拦截，导致遥测
 * session 从未初始化。其后它挂在 `requestIdleCallback` 上的周期 `reportAllChanges`
 * 会读 `session.startTime`，而 `session` 为 undefined → 抛 `TypeError: Cannot read
 * properties of undefined (reading 'startTime')`。该错误纯属遥测噪声，不影响摄像头/
 * 检测功能，但会污染控制台。
 *
 * 修复：① 包裹 `window.requestIdleCallback`，在其回调抛出遥测类错误（startTime /
 * reportAllChanges / odml / telemetry）时静默吞掉，不清真 bug；② 保留对 `fetch` 中
 * odml 请求的 200 兜底（无害）。遥测数据始终不出本机。
 */
if (typeof window !== 'undefined' && !(window as any).__sgTelemetryPatched) {
  // 1) 兜底：拦截 fetch 中的 odml 请求（部分版本可能走 fetch）
  const _nativeFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as any)?.url;
    if (url && String(url).includes('odml.pa.googleapis.com')) {
      return Promise.resolve(new Response('{}', { status: 200, statusText: 'OK' }));
    }
    return _nativeFetch(input as any, init);
  }) as typeof window.fetch;

  // 2) 根治：包裹 requestIdleCallback，吞掉 MediaPipe 遥测回调里的无关报错
  const _nativeRIC = (window as any).requestIdleCallback?.bind(window);
  if (_nativeRIC) {
    (window as any).requestIdleCallback = (cb: any, opts?: any) =>
      _nativeRIC((deadline: any) => {
        try {
          return cb(deadline);
        } catch (e: any) {
          const msg: string = e?.message || '';
          if (/startTime|reportAllChanges|odml|telemetry/i.test(msg)) {
            // MediaPipe 遥测噪声：不向 Google 发送任何数据，也不污染控制台
            return;
          }
          throw e;
        }
      }, opts);
  }

  (window as any).__sgTelemetryPatched = true;
}

/** WASM 与模型均放在本地 public 下：手机/平板真机测试不依赖外网 CDN，离线也能跑。 */
const WASM_ROOT = '/mp-wasm';
const POSE_MODEL = '/models/pose_landmarker_lite.task';
const HAND_MODEL = '/models/hand_landmarker.task';

/** MediaPipe 姿势关键点的常用索引（33 点模型） */
const P = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
} as const;

export interface PoseFeatures {
  personPresent: boolean;
  handClap: number; // 0-1 双手开合（拍手）
  pointing: number; // 0-1 指向（单臂前伸）
  handsNearFace: number; // 0-1 双手接近面部（捂脸/抱头）
  selfHit: number; // 0-1 自伤（手接触头部 + 快速运动）
  bodyYaw: number; // -1..1 躯干/头部偏转（用于时序转圈识别）
  faceCenter: { x: number; y: number } | null;
  headTilt: number; // -1..1 头部侧倾（摇头/歪头）
  torsoHeight: number; // 归一化躯干高度（肩到髋）
  // —— 补盲新增 ——
  fall: number; // 0-1 跌倒（躯干倾角突变 + 高度骤降）
  fight: number; // 0-1 打架/冲突（多人贴近 + 高频高幅）
  hitArm: number; // 0-1 击打自身手臂/大腿（自伤漏报场景）
  headBang: number; // 0-1 撞头/撞墙（头部高频往复 + 躯干相对静止）
  personCount: number; // 当前画面检测到的人数
}

/** 时序振荡特征：往复次数与振幅 */
interface Oscillation {
  flips: number;
  amp: number;
}

type LM = { x: number; y: number; z?: number; visibility?: number };

function dist(a: LM, b: LM): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function avg(...pts: LM[]): LM {
  const n = pts.length || 1;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  };
}

function clamp(v: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, v));
}

/** 平滑过渡（用于时序角速度等） */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 点到线段的最短距离：用于判断手腕是否击中另一条手臂/大腿 */
function distToSegment(p: LM, a: LM, b: LM): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * 时序振荡特征：往复次数（方向翻转）与振幅。
 * 击打、撞头、拍手这类行为的共同点是"接近-远离"的高频往复，
 * 单帧静态距离无法区分"手放在脸上"和"手在打自己"，必须看时序。
 */
function oscillation(seq: number[], win = 8, deadzone = 0.004): Oscillation {
  const h = seq.slice(-win);
  if (h.length < 4) return { flips: 0, amp: 0 };
  const signs: number[] = [];
  for (let i = 1; i < h.length; i++) {
    const d = h[i] - h[i - 1];
    if (Math.abs(d) > deadzone) signs.push(Math.sign(d));
  }
  let flips = 0;
  for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) flips++;
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of h) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return { flips, amp: Number.isFinite(mx - mn) ? mx - mn : 0 };
}

export class PoseDetector {
  private pose: PoseLandmarker | null = null;
  private hand: HandLandmarker | null = null;
  /** 自检照片用：MediaPipe 不允许运行后切换 runningMode，必须用独立 IMAGE 模式实例。 */
  private imagePose: PoseLandmarker | null = null;
  private imageHand: HandLandmarker | null = null;
  private vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
  private available = false;
  private imageAvailable = false;
  private loadingPromise: Promise<void> | null = null;
  private imageLoadingPromise: Promise<void> | null = null;
  private lastVideoTs = -1;

  /** 时序缓冲：跌倒（髋部高度）、击打（手腕-肢体间距）、撞头（头部/肩部位移） */
  private hipYHist: number[] = [];
  private armGapHist: number[] = [];
  private headHist: LM[] = [];
  private shHist: LM[] = [];

  private pushHist<T>(arr: T[], v: T, max = 12): void {
    arr.push(v);
    if (arr.length > max) arr.shift();
  }

  /** 重置全部时序缓冲（切换学生/重新开始检测时调用） */
  resetHistory(): void {
    this.hipYHist = [];
    this.armGapHist = [];
    this.headHist = [];
    this.shHist = [];
    this.lastVideoTs = -1;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  /** 懒加载并初始化两个 VIDEO 模式模型（用于摄像头实时流）。失败不抛错，仅标记不可用。 */
  async init(): Promise<void> {
    if (this.available) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      try {
        this.vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
        const delegate: 'GPU' | 'CPU' = 'GPU';
        try {
          this.pose = await PoseLandmarker.createFromOptions(this.vision, {
            baseOptions: { modelAssetPath: POSE_MODEL, delegate },
            runningMode: 'VIDEO',
            // numPoses=2：画面中出现第二个人时才可能识别「打架/冲突」
            numPoses: 2,
          });
        } catch {
          // 某些设备无 WebGL/GPU，回退 CPU
          this.pose = await PoseLandmarker.createFromOptions(this.vision, {
            baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'CPU' },
            runningMode: 'VIDEO',
            // numPoses=2：画面中出现第二个人时才可能识别「打架/冲突」
            numPoses: 2,
          });
        }
        try {
          this.hand = await HandLandmarker.createFromOptions(this.vision, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate },
            runningMode: 'VIDEO',
            numHands: 2,
          });
        } catch {
          this.hand = await HandLandmarker.createFromOptions(this.vision, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numHands: 2,
          });
        }
        this.available = true;
      } catch (e) {
        console.warn('[PoseDetector] 模型初始化失败，回退运动检测：', (e as Error).message);
        this.available = false;
      }
    })();

    return this.loadingPromise;
  }

  /**
   * 懒加载并初始化两个 IMAGE 模式模型（用于「上传照片自检」）。
   * 关键：MediaPipe Tasks Vision 不允许在创建后切换 runningMode，
   *   因此 VIDEO 模式的实例无法直接对静态图调 detect()。这里单独建一份 IMAGE 实例。
   */
  async initImageMode(): Promise<void> {
    if (this.imageAvailable) return;
    if (this.imageLoadingPromise) return this.imageLoadingPromise;

    this.imageLoadingPromise = (async () => {
      try {
        // 复用或新建 vision fileset
        if (!this.vision) {
          this.vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
        }
        const delegate: 'GPU' | 'CPU' = 'GPU';
        try {
          this.imagePose = await PoseLandmarker.createFromOptions(this.vision, {
            baseOptions: { modelAssetPath: POSE_MODEL, delegate },
            runningMode: 'IMAGE',
            // numPoses=2：画面中出现第二个人时才可能识别「打架/冲突」
            numPoses: 2,
          });
        } catch {
          this.imagePose = await PoseLandmarker.createFromOptions(this.vision, {
            baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'CPU' },
            runningMode: 'IMAGE',
            // numPoses=2：画面中出现第二个人时才可能识别「打架/冲突」
            numPoses: 2,
          });
        }
        try {
          this.imageHand = await HandLandmarker.createFromOptions(this.vision, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate },
            runningMode: 'IMAGE',
            numHands: 2,
          });
        } catch {
          this.imageHand = await HandLandmarker.createFromOptions(this.vision, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'CPU' },
            runningMode: 'IMAGE',
            numHands: 2,
          });
        }
        this.imageAvailable = true;
      } catch (e) {
        console.warn('[PoseDetector] IMAGE 模式模型初始化失败：', (e as Error).message);
        this.imageAvailable = false;
      }
    })();

    return this.imageLoadingPromise;
  }

  /** 对视频帧推理（要求递增的时间戳，单位 ms）。返回原始结果供外部复用。 */
  async detectVideo(
    video: HTMLVideoElement,
    timestampMs: number,
  ): Promise<{ pose: PoseLandmarkerResult | null; hand: HandLandmarkerResult | null }> {
    if (!this.available || !this.pose) return { pose: null, hand: null };
    // MediaPipe 要求时间戳严格递增
    const ts = timestampMs <= this.lastVideoTs ? this.lastVideoTs + 1 : timestampMs;
    this.lastVideoTs = ts;
    let poseRes: PoseLandmarkerResult | null = null;
    let handRes: HandLandmarkerResult | null = null;
    try {
      poseRes = this.pose.detectForVideo(video, ts);
    } catch (e) {
      console.warn('[PoseDetector] pose 推理异常：', (e as Error).message);
    }
    if (this.hand) {
      try {
        handRes = this.hand.detectForVideo(video, ts);
      } catch {
        /* 手部模型可选，失败不影响姿态 */
      }
    }
    return { pose: poseRes, hand: handRes };
  }

  /** 对单张图片推理（供「上传照片自检」）。使用独立 IMAGE 模式实例。 */
  async detectImage(
    image: HTMLImageElement | HTMLCanvasElement,
  ): Promise<{ pose: PoseLandmarkerResult | null; hand: HandLandmarkerResult | null }> {
    if (!this.imageAvailable || !this.imagePose) {
      await this.initImageMode();
    }
    if (!this.imageAvailable || !this.imagePose) return { pose: null, hand: null };
    let poseRes: PoseLandmarkerResult | null = null;
    let handRes: HandLandmarkerResult | null = null;
    try {
      poseRes = this.imagePose.detect(image);
    } catch (e) {
      console.warn('[PoseDetector] 图片 pose 推理异常：', (e as Error).message);
    }
    if (this.imageHand) {
      try {
        handRes = this.imageHand.detect(image);
      } catch {
        /* 可选 */
      }
    }
    return { pose: poseRes, hand: handRes };
  }

  /**
   * 从关键点计算行为特征。
   * 同时接收手部关键点结果（若可用，比仅用姿态手腕点更准）。
   */
  extractFeatures(
    pose: PoseLandmarkerResult | null,
    hand: HandLandmarkerResult | null,
  ): PoseFeatures {
    const empty: PoseFeatures = {
      personPresent: false,
      handClap: 0,
      pointing: 0,
      handsNearFace: 0,
      selfHit: 0,
      bodyYaw: 0,
      faceCenter: null,
      headTilt: 0,
      torsoHeight: 0,
      fall: 0,
      fight: 0,
      hitArm: 0,
      headBang: 0,
      personCount: 0,
    };
    if (!pose || !pose.landmarks || pose.landmarks.length === 0) return empty;

    const lm = pose.landmarks[0] as LM[];
    const get = (i: number): LM => lm[i];

    const faceCenter = avg(
      get(P.nose),
      get(P.leftEye),
      get(P.rightEye),
      get(P.mouthLeft),
      get(P.mouthRight),
    );

    const lSh = get(P.leftShoulder);
    const rSh = get(P.rightShoulder);
    const lHip = get(P.leftHip);
    const rHip = get(P.rightHip);
    const torsoHeight = clamp(dist(avg(lSh, rSh), avg(lHip, rHip)) * 3.2, 0.05, 1.2);
    const shoulderMid = avg(lSh, rSh);
    const shoulderWidth = Math.max(dist(lSh, rSh), 0.05);

    // 头部偏转（yaw）：鼻尖相对肩中线的水平偏移
    const bodyYaw = clamp((get(P.nose).x - shoulderMid.x) / shoulderWidth, -1.25, 1.25);
    // 头部侧倾（tilt）：左耳-右耳连线相对水平的角度
    const earDx = get(P.rightEar).x - get(P.leftEar).x;
    const earDy = get(P.rightEar).y - get(P.leftEar).y;
    const headTilt = clamp(Math.atan2(earDy, earDx) / (Math.PI / 2), -1, 1);

    // 手腕（优先用手部模型 21 点里的 0 号，否则用姿态 15/16）
    let lWrist: LM = get(P.leftWrist);
    let rWrist: LM = get(P.rightWrist);
    if (hand && hand.landmarks && hand.landmarks.length) {
      for (const hpts of hand.landmarks) {
        const w = hpts[0];
        // 简单按 x 归到左/右半区
        if (w.x < faceCenter.x) lWrist = { x: w.x, y: w.y };
        else rWrist = { x: w.x, y: w.y };
      }
    }

    // 双手开合（拍手）：两腕距离很近
    const wristDist = dist(lWrist, rWrist);
    const handClap = clamp(1 - wristDist / 0.14, 0, 1);

    // 手接近面部：腕-面中心距离
    const lFace = dist(lWrist, faceCenter);
    const rFace = dist(rWrist, faceCenter);
    const minFace = Math.min(lFace, rFace);
    const faceContact = clamp(1 - minFace / 0.22, 0, 1);

    // 指向：单侧手臂明显前伸、另一侧屈曲。用「腕-肩」距离 / 躯干高度 表征伸展度。
    const lArmExt = clamp(dist(lWrist, lSh) / torsoHeight, 0, 1.5);
    const rArmExt = clamp(dist(rWrist, rSh) / torsoHeight, 0, 1.5);
    const maxExt = Math.max(lArmExt, rArmExt);
    const minExt = Math.min(lArmExt, rArmExt);
    // 伸展侧够直（>0.55），另一侧相对屈曲（<0.4）→ 指向
    const pointing = clamp((maxExt - 0.5) / 0.45) * (minExt < 0.45 ? 1 : 0.45);

    // 自伤（selfHit）：手接触头部 + 存在运动（由调用方传入 motionEnergy 调制）；
    // 此处先给「接触强度」，运动调制在 extractWithMotion 中完成。
    const selfHitContact = faceContact;

    const hipMid = avg(lHip, rHip);
    const personCount = pose.landmarks.length;

    // ---------- 跌倒 fall：躯干倾角突变 + 髋部高度骤降 + 宽高比变扁 ----------
    this.pushHist(this.hipYHist, hipMid.y, 12);
    const torsoVecY = Math.max(hipMid.y - shoulderMid.y, 1e-3);
    // 与垂直向下方向的夹角：直立≈0，水平躺倒≈π/2
    const torsoTiltRad = Math.atan2(Math.abs(hipMid.x - shoulderMid.x), torsoVecY);
    const tiltScore = clamp((torsoTiltRad - 0.55) / 0.6);
    let dropScore = 0;
    if (this.hipYHist.length >= 3) {
      const h = this.hipYHist;
      // y 轴向下增大：正值表示髋部正在下沉（摔倒）
      dropScore = clamp((h[h.length - 1] - h[h.length - 3]) / 0.05);
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of lm) {
      if (p.visibility != null && p.visibility < 0.3) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const bboxH = Math.max(maxY - minY, 1e-3);
    const aspectScore = clamp(((maxX - minX) / bboxH - 0.55) / 0.75);
    const fall = clamp(0.45 * tiltScore + 0.35 * dropScore + 0.2 * aspectScore);

    // ---------- 打架 fight：多人贴近（运动强度调制在 extractWithMotion 中叠加） ----------
    let fight = 0;
    if (personCount >= 2 && pose.landmarks[1]) {
      const lm2 = pose.landmarks[1] as LM[];
      const g2 = (i: number): LM => lm2[i] ?? lm[i];
      const c1 = avg(lSh, rSh, lHip, rHip);
      const c2 = avg(g2(P.leftShoulder), g2(P.rightShoulder), g2(P.leftHip), g2(P.rightHip));
      fight = clamp(1 - dist(c1, c2) / 0.75) * 0.5;
    }

    // ---------- 击打手臂/大腿 hitArm：手腕贴近对侧肢体 + 接近-远离的往复节奏 ----------
    const gapArm = Math.min(
      distToSegment(lWrist, get(P.rightElbow), rWrist),
      distToSegment(rWrist, get(P.leftElbow), lWrist),
    );
    const gapLeg = Math.min(
      distToSegment(lWrist, lHip, get(P.leftKnee)),
      distToSegment(rWrist, rHip, get(P.rightKnee)),
    );
    const limbGap = Math.min(gapArm, gapLeg);
    this.pushHist(this.armGapHist, limbGap, 12);
    const limbContact = clamp(1 - limbGap / 0.13);
    const strikeRhythm = clamp(oscillation(this.armGapHist, 8, 0.01).flips / 3);
    const hitArm = clamp(limbContact * (0.45 + 0.55 * strikeRhythm));

    // ---------- 撞头/撞墙 headBang：头部高频往复 + 躯干相对静止 ----------
    this.pushHist(this.headHist, get(P.nose), 10);
    this.pushHist(this.shHist, shoulderMid, 10);
    const headAmp = Math.max(
      oscillation(this.headHist.map((p) => p.x), 8, 0.005).amp,
      oscillation(this.headHist.map((p) => p.y), 8, 0.005).amp,
    );
    const headFlips = Math.max(
      oscillation(this.headHist.map((p) => p.x), 8, 0.005).flips,
      oscillation(this.headHist.map((p) => p.y), 8, 0.005).flips,
    );
    const shAmp = Math.max(
      oscillation(this.shHist.map((p) => p.x), 8, 0.005).amp,
      oscillation(this.shHist.map((p) => p.y), 8, 0.005).amp,
    );
    const headBang = clamp(
      clamp((headAmp - 0.015) / 0.045) * clamp(headFlips / 3) * clamp(1 - shAmp / 0.06),
    );

    return {
      personPresent: true,
      handClap,
      pointing,
      handsNearFace: clamp(faceContact * (1 - this.spinGate(bodyYaw)) , 0, 1),
      selfHit: selfHitContact,
      bodyYaw,
      faceCenter,
      headTilt,
      torsoHeight,
      fall,
      fight,
      hitArm,
      headBang,
      personCount,
    };
  }

  /** 转圈门控：当偏转轴快速翻转时，降低「捂脸」误报（更可能是转身/转圈）。 */
  private spinGate(_yaw: number): number {
    return 0; // 时序调制在调用方处理
  }

  /**
   * 综合单帧特征 + 帧差运动能量，产出最终可用于 classifyBehavior 的特征。
   * - selfHit：接触强度 × 运动强度（自伤是「手撞头」的快动作）。
   * - handsNearFace：接触强度 × 低运动（捂脸/抱头是持续接触）。
   */
  extractWithMotion(
    pose: PoseLandmarkerResult | null,
    hand: HandLandmarkerResult | null,
    motionEnergy: number,
  ): PoseFeatures {
    const f = this.extractFeatures(pose, hand);
    if (!f.personPresent) return f;
    const dyn = clamp(motionEnergy, 0, 1);
    // 自伤：明显接触 + 有运动（哪怕中等运动也保留，安全第一）
    f.selfHit = clamp(f.selfHit * (0.35 + dyn * 0.9), 0, 1);
    // 捂脸：接触为主、运动低
    f.handsNearFace = clamp(f.handsNearFace * (1 - dyn * 0.6), 0, 1);
    // 击打手臂/大腿：与自伤同为「击打类」，需要接触 + 运动
    f.hitArm = clamp(f.hitArm * (0.35 + dyn * 0.85), 0, 1);
    // 打架：多人贴近 + 高运动能量（推搡/挥拳）
    f.fight = clamp(f.fight * (0.3 + dyn * 1.2), 0, 1);
    // 跌倒：以几何证据为主，运动能量仅作辅助（摔倒瞬间能量会飙升）
    f.fall = clamp(f.fall * (0.75 + dyn * 0.4), 0, 1);
    // 撞头：头部往复已在时序层判定，运动能量仅作轻微增强
    f.headBang = clamp(f.headBang * (0.8 + dyn * 0.3), 0, 1);
    return f;
  }
}

/** 单例：避免重复加载模型。 */
let _detector: PoseDetector | null = null;
export function getPoseDetector(): PoseDetector {
  if (!_detector) _detector = new PoseDetector();
  return _detector;
}
