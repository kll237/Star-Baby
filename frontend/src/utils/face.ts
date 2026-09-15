import * as faceapi from 'face-api.js';

/** 模型目录（需将 face-api 权重文件置于 public/models 下） */
const MODEL_URL = '/models';

let modelsLoaded = false;

export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
  ]);
  modelsLoaded = true;
}

export interface DetectResult {
  descriptor: number[];
  box: { x: number; y: number; width: number; height: number };
  score: number;
}

/**
 * 从 video 元素检测人脸并返回 128 维特征向量。
 * 若无检测到人脸，返回 null（用于活体/质量判断）。
 */
export async function detectDescriptor(
  video: HTMLVideoElement,
): Promise<DetectResult | null> {
  await loadFaceModels();
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
  const detection = await faceapi
    .detectSingleFace(video, options)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return null;
  const { x, y, width, height } = detection.detection.box;
  return {
    descriptor: Array.from(detection.descriptor as Float32Array),
    box: { x, y, width, height },
    score: detection.detection.score,
  };
}

export type EmotionScores = Partial<Record<string, number>>;

/** 由 68 个面部关键点派生的几何/姿态特征，用于识别复杂情绪 */
export interface FaceMetrics {
  /** 眼睛纵横比（睁眼程度）：越小越接近闭眼，正常 0.25~0.35 */
  ear: number;
  /** 左右眼 EAR 差异 0-1（眨眼/单眼眯） */
  earAsym: number;
  /** 嘴纵横比（张嘴程度）：哈欠/大笑/喊叫时显著升高 */
  mar: number;
  /** 眉毛抬高 0-1 */
  browRaise: number;
  /** 左右眉高度不对称 0-1（困惑的典型线索） */
  browAsym: number;
  /** 皱眉程度 0-1（眉心紧锁） */
  browFurrow: number;
  /** 头部左右偏转 -1..1 */
  yaw: number;
  /** 头部上下俯仰 -1..1（正=低头） */
  pitch: number;
  /** 头部侧倾（歪头）-1..1 */
  roll: number;
}

export interface EmotionResult {
  scores: Record<string, number>; // 7 类，0-100
  box: { x: number; y: number; width: number; height: number } | null;
  dominant: string;
  dominantScore: number;
  /** 面部几何特征（关键点可用时才有） */
  faceMetrics: FaceMetrics | null;
}

/** face-api 7 类表情 → 系统情绪键 映射 */
const EXPR_MAP: Record<string, string> = {
  neutral: 'neutral',
  happy: 'happy',
  sad: 'sad',
  angry: 'angry',
  fearful: 'fear',
  surprised: 'surprise',
  disgusted: 'disgust',
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const clampSym = (v: number) => Math.min(1, Math.max(-1, v));
const _d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const _mid = (pts: { x: number; y: number }[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

/** 单眼纵横比 EAR = (|p2-p6| + |p3-p5|) / (2|p1-p4|) */
function eyeAspectRatio(p: { x: number; y: number }[], idx: number[]): number {
  const [p1, p2, p3, p4, p5, p6] = idx.map((i) => p[i]);
  const h = 2 * _d(p1, p4);
  return h > 0 ? (_d(p2, p6) + _d(p3, p5)) / h : 0;
}

/**
 * 从 68 个人脸关键点计算情绪相关的几何/姿态特征。
 * 索引遵循 dlib 标准：17-21 左眉、22-26 右眉、30 鼻尖、
 * 36-41 左眼、42-47 右眼、48-59 外唇、60-67 内唇。
 */
export function computeFaceMetrics(p: { x: number; y: number }[]): FaceMetrics | null {
  if (!p || p.length < 68) return null;
  try {
    const eyeL = eyeAspectRatio(p, [36, 37, 38, 39, 40, 41]);
    const eyeR = eyeAspectRatio(p, [42, 43, 44, 45, 46, 47]);
    const ear = (eyeL + eyeR) / 2;
    const earAsym = clamp01(Math.abs(eyeL - eyeR) / Math.max(ear, 0.05));

    // 嘴纵横比（内唇）：张口/哈欠/喊叫时显著升高
    const marDen = 2 * _d(p[60], p[64]);
    const mar = marDen > 0 ? (_d(p[61], p[67]) + _d(p[62], p[66]) + _d(p[63], p[65])) / marDen : 0;

    const browLMid = _mid([p[18], p[19], p[20]]);
    const browRMid = _mid([p[23], p[24], p[25]]);
    const eyeLCenter = _mid([p[36], p[37], p[38], p[39], p[40], p[41]]);
    const eyeRCenter = _mid([p[42], p[43], p[44], p[45], p[46], p[47]]);
    const eyeLH = Math.max(_d(p[37], p[41]), 1e-3);
    const eyeRH = Math.max(_d(p[43], p[47]), 1e-3);
    // 眉高比：压眉约 0.8，自然约 1.2，挑眉约 1.8
    const browLH = _d(browLMid, eyeLCenter) / eyeLH;
    const browRH = _d(browRMid, eyeRCenter) / eyeRH;
    const browMean = (browLH + browRH) / 2;
    const browRaise = clamp01((browMean - 0.85) / 0.95);
    const browAsym = clamp01((Math.abs(browLH - browRH) / Math.max(browMean, 1e-3)) * 2.5);
    // 皱眉：眉心间距收窄 + 眉内侧下压
    const eyeDist = Math.max(_d(eyeLCenter, eyeRCenter), 1e-3);
    const innerRatio = _d(p[21], p[22]) / eyeDist;
    const innerDrop = (_d(p[21], p[39]) + _d(p[22], p[42])) / 2 / eyeLH;
    const browFurrow = clamp01(clamp01((0.95 - innerRatio) / 0.35) * 0.6 + clamp01((1.6 - innerDrop) / 1.1) * 0.4);

    // 头部姿态（2D 近似，无需 3D 模型）
    const eyeMid = { x: (eyeLCenter.x + eyeRCenter.x) / 2, y: (eyeLCenter.y + eyeRCenter.y) / 2 };
    const nose = p[30];
    const yaw = clampSym((nose.x - eyeMid.x) / Math.max(eyeDist * 0.55, 1e-3));
    const pitch = clampSym((nose.y - eyeMid.y) / Math.max(eyeDist * 0.9, 1e-3));
    const roll = clampSym(
      Math.atan2(eyeRCenter.y - eyeLCenter.y, Math.max(eyeRCenter.x - eyeLCenter.x, 1e-3)) / (Math.PI / 3),
    );

    return { ear, earAsym, mar, browRaise, browAsym, browFurrow, yaw, pitch, roll };
  } catch {
    return null;
  }
}

/**
 * 实时情绪识别：返回 7 类基础情绪置信度（0-100）+ 面部几何特征。
 * 与后端 EMOTION_KEYS 完全一致：happy/sad/angry/fear/surprise/disgust/neutral。
 * 复杂情绪由 complexEmotion.ts 在本结果之上合成。
 */
export async function detectEmotion(video: HTMLVideoElement): Promise<EmotionResult | null> {
  await loadFaceModels();
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
  const detection = await faceapi
    .detectSingleFace(video, options)
    .withFaceLandmarks()
    .withFaceExpressions();
  if (!detection) return null;

  const scores: Record<string, number> = {
    happy: 0,
    sad: 0,
    angry: 0,
    fear: 0,
    surprise: 0,
    disgust: 0,
    neutral: 0,
  };
  let dominant = 'neutral';
  let dominantScore = -1;
  const expr = detection.expressions as unknown as Record<string, number>;
  for (const k of Object.keys(expr)) {
    const key = EXPR_MAP[k] ?? k;
    const v = Math.round((expr[k] ?? 0) * 100);
    scores[key] = v;
    if (v > dominantScore) {
      dominantScore = v;
      dominant = key;
    }
  }
  const { x, y, width, height } = detection.detection.box;
  const faceMetrics = detection.landmarks
    ? computeFaceMetrics(detection.landmarks.positions as unknown as { x: number; y: number }[])
    : null;
  return { scores, box: { x, y, width, height }, dominant, dominantScore, faceMetrics };
}
