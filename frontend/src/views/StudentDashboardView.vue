<template>
  <div class="center-screen dash-with-bg" :style="{ backgroundImage: `url(${bgUrl})` }">
    <div class="dash-bg-overlay"></div>

    <!-- 隐私承诺条（特征 5） -->
    <div class="privacy-bar">
      <span>🔒 数据本地优先 · 最小化 · 不出本机</span>
      <button class="link" @click="showPrivacy = true">了解</button>
    </div>

    <!-- 阶段三：识别精度诚实声明（常驻） -->
    <div class="acc-bar">
      <span>🧪 情绪/行为识别为<strong>辅助参考</strong>，非医学诊断。已按孩子个人基线校准；摄像头实时识别由 MediaPipe 姿态/手部关键点驱动，存在误差，请以真人观察为准。</span>
    </div>

    <div class="card" style="width: 820px; max-width: 96%; margin: 0 auto">
      <div style="display: flex; align-items: center; justify-content: space-between">
        <div>
          <div style="font-size: 64px">{{ mood.emoji }}</div>
          <h1 class="title" style="margin: 0">{{ mood.text }}</h1>
          <p class="subtitle" style="margin: 4px 0 0">
            综合情绪评分 {{ composite }}
            <span v-if="baseline" class="base-tag">相对我的基线 {{ baselineDropText }}</span>
          </p>
        </div>
        <div style="text-align: right">
          <div style="font-size: 28px; font-weight: 800">{{ behaviorLabel }}</div>
          <p class="hint">正在识别动作行为…</p>
          <!-- 久坐提醒：连续静坐超过阈值（默认 30 分钟）提示起身活动 -->
          <div v-if="sitLongAlert" class="sit-long-tip">
            🪑 已连续静坐 {{ Math.floor(sitMinutes) }} 分钟，建议起身活动 2 分钟
          </div>
          <p v-else-if="sitMinutes >= 1" class="hint">已静坐 {{ Math.floor(sitMinutes) }} 分钟</p>
          <!-- 正向强化星星（特征 4） -->
          <div class="stars">
            ⭐ <b>{{ starCount }}</b>
            <span class="star-sub">本周 +{{ starWeek }}</span>
          </div>
        </div>
      </div>

      <!-- 摄像头 + 叠加 -->
      <div style="position: relative; margin: 16px 0; border-radius: 16px; overflow: hidden; background: #000">
        <video ref="videoEl" autoplay playsinline muted
          style="width: 100%; display: block; max-height: 360px; object-fit: cover"></video>
        <canvas ref="overlayEl" style="position: absolute; inset: 0; width: 100%; height: 100%"></canvas>
        <div v-if="!running" class="hint"
          style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff">
          点击下方按钮开始检测
        </div>

        <!-- 风险预警（特征 7：柔和脉冲，不刺眼） -->
        <div v-if="riskLevel" class="risk-banner" :class="'lv-' + riskLevel">
          <div class="rb-head">⚠️ {{ riskLabel }} · 已通知家长 / 教师</div>
          <ul class="rb-steps">
            <li v-for="(s, i) in currentSop.steps" :key="i">{{ s }}</li>
          </ul>
          <div class="rb-contacts">
            <a v-for="(c, i) in currentSop.contacts" :key="i"
               class="contact-btn"
               :href="telFor(c.role) || undefined"
               @click.prevent="onContact(c.role)">
              {{ contactActionLabel(c.action) }} · {{ c.role }}
            </a>
          </div>
        </div>

        <!-- 行为即时步骤（特征 3） -->
        <transition name="toast">
          <div v-if="stepToast" class="step-toast">
            <div class="st-emoji">{{ stepToast.emoji }}</div>
            <div class="st-body">
              <div class="st-title">{{ stepToast.label }} · 现在可以这样做</div>
              <div v-for="(s, i) in stepToast.steps" :key="i" class="st-step">{{ i + 1 }}. {{ s }}</div>
              <button class="link" @click="stepToast = null">知道了</button>
            </div>
          </div>
        </transition>

        <!-- 正向强化庆祝（特征 4） -->
        <transition name="pop">
          <div v-if="celebrate" class="celebrate">🎉 星宝为你骄傲！+{{ lastStars }}⭐</div>
        </transition>

        <!-- 基线录制遮罩（特征 1） -->
        <div v-if="baselinePhase === 'prompt' || baselinePhase === 'recording'" class="baseline-mask">
          <div v-if="baselinePhase === 'prompt'">
            <p style="font-size: 18px; margin: 0 0 10px">先录一段「平静基线」吧</p>
            <p class="hint" style="color:#fff">孩子安静坐着 10 秒，星宝会记住 ta 的「平常样子」，之后只在明显比平常更难过时才提醒，不乱报警。</p>
            <button class="btn" @click="startBaseline">开始录制（10 秒）</button>
          </div>
          <div v-else>
            <p style="font-size: 22px; margin: 0">录制中… {{ baselineCountdown }}s</p>
            <div class="bl-progress"><div class="bl-fill" :style="{ width: (1 - baselineCountdown / 10) * 100 + '%' }"></div></div>
          </div>
        </div>
      </div>

      <!-- 情绪波动曲线 -->
      <div class="card" style="background: #fff3e6; padding: 12px">
        <div style="font-weight: 700; margin-bottom: 6px">情绪波动曲线（实时）</div>
        <svg :viewBox="`0 0 300 80`" width="100%" height="80" preserveAspectRatio="none">
          <line x1="0" y1="40" x2="300" y2="40" stroke="#e0c9a6" stroke-width="1" />
          <polyline :points="curvePoints" fill="none" stroke="#e8833a" stroke-width="2" />
        </svg>
      </div>

      <!-- 安抚触发提示（特征 2：多帧确认后才弹出） -->
      <div v-if="sootheHint" class="card" style="background: #ffe7d6; margin-top: 12px">
        <p style="margin: 0 0 8px; font-weight: 700">星宝感觉到你有点不开心，想陪你聊聊～</p>
        <button class="btn" style="width: 100%; min-height: 56px" @click="onSoothe">🤗 星宝陪我聊聊</button>
      </div>

      <!-- 控制区：2x2 网格 + 独立退出 -->
      <div class="ctrl-grid">
        <button v-if="!running" class="btn ctrl-primary" @click="start">
          <span class="ctrl-ico">▶</span>
          <span>开始检测</span>
        </button>
        <button v-else class="btn ghost ctrl-primary" @click="stop">
          <span class="ctrl-ico">⏹</span>
          <span>停止</span>
        </button>

        <button class="btn ctrl-chat" @click="onSoothe">
          <span class="ctrl-ico">💬</span>
          <span>和星宝聊聊</span>
        </button>

        <button class="btn ghost ctrl-secondary" @click="toggleMode">
          <span class="ctrl-ico">{{ mode === 'realtime' ? '🎭' : '📷' }}</span>
          <span>{{ mode === 'realtime' ? '演示模式' : '真实识别' }}</span>
        </button>

        <button class="btn ghost ctrl-secondary" :class="{ active: noCamera }" @click="toggleNoCamera">
          <span class="ctrl-ico">{{ noCamera ? '✅' : '📷' }}</span>
          <span>{{ noCamera ? '已开纯行为' : '纯行为模式' }}</span>
        </button>
      </div>

      <div class="ctrl-foot">
        <button class="btn-link" @click="logout">退出</button>
        <span class="ctrl-status">
          {{ mode === 'realtime' ? (noCamera ? '纯行为（无摄像头）' : '真实识别') : '演示模式' }}
          ｜ {{ fps.toFixed(1) }} fps
          ｜ <span v-if="poseReady" style="color:#1f9254">姿态模型已加载</span>
          <span v-else style="color:#b06a2c">姿态模型加载中/未启用</span>
        </span>
        <label class="rm"><input type="checkbox" v-model="reducedMotion" /> 减少动效</label>
      </div>

      <!-- 阶段三：上传照片自检（摄像头损坏也能验收识别管线） -->
      <button class="btn ghost ctrl-secondary sc-btn" style="width: 100%; margin-top: 12px" @click="openSelfCheck">
        <span class="ctrl-ico">📷</span>
        <span>上传照片自检（摄像头坏了也能验收识别）</span>
      </button>
      <input ref="selfCheckFileInput" type="file" accept="image/*" style="display: none" @change="onSelfCheckPick" />
    </div>

    <!-- 照片自检弹窗（阶段三） -->
    <div v-if="selfCheckOpen" class="modal-mask" @click.self="selfCheckOpen = false">
      <div class="modal selfcheck">
        <h3>📷 上传照片自检</h3>
        <p class="hint" style="font-size: 13px; line-height: 1.6">
          选一张含孩子的人物照片，星宝会用与摄像头<strong>完全相同的识别管线</strong>
          （MediaPipe 姿态/手部关键点 + 表情模型）给出结果，方便你验收准确性。
        </p>
        <div class="sc-upload">
          <img v-if="selfCheckImg" :src="selfCheckImg" class="sc-img" alt="自检图片" />
        </div>
        <div v-if="selfCheckLoading" class="hint">识别中…（首次需加载约 12MB 模型，请稍候）</div>
        <div v-if="selfCheckResult" class="sc-result">
          <div class="sc-row"><b>情绪：</b>{{ selfCheckResult.emotionLabel }}</div>
          <div class="sc-bars">
            <div v-for="(v, k) in selfCheckResult.emotion" :key="k" class="sc-bar">
              <span class="sc-k">{{ EMOTION_LABELS[k] || k }}</span>
              <span class="sc-track"><i :style="{ width: v + '%' }"></i></span>
              <span class="sc-v">{{ v }}</span>
            </div>
          </div>
          <div class="sc-row"><b>行为：</b>{{ selfCheckResult.behaviorLabel }}（置信 {{ (selfCheckResult.behaviorConf * 100).toFixed(0) }}%）</div>
          <ul class="sc-notes">
            <li v-for="(n, i) in selfCheckResult.poseNotes" :key="i">{{ n }}</li>
          </ul>
        </div>
        <div class="sc-acc">⚠️ 结果仅为<strong>辅助参考</strong>，非医学诊断；姿态识别存在误差，请以真人观察为准。</div>
        <div class="sc-actions">
          <button class="btn-link" @click="selfCheckOpen = false">关闭</button>
          <button class="btn" @click="selfCheckFileInput?.click()">重新选择图片</button>
        </div>
      </div>
    </div>

    <!-- 隐私说明弹窗（特征 5） -->
    <div v-if="showPrivacy" class="modal-mask" @click.self="showPrivacy = false">
      <div class="modal">
        <h3>{{ PRIVACY_PROMISE.title }}</h3>
        <ul><li v-for="(p, i) in PRIVACY_PROMISE.points" :key="i">{{ p }}</li></ul>
        <h4>一键联系号码（仅本机保存）</h4>
        <div class="contact-form">
          <label>家长 <input v-model="contacts.parentPhone" placeholder="手机号" /></label>
          <label>班主任 <input v-model="contacts.teacherPhone" placeholder="手机号" /></label>
          <label>校医 <input v-model="contacts.nursePhone" placeholder="手机号" /></label>
        </div>
        <button class="btn" @click="saveContactsLocal">保存</button>
      </div>
    </div>
    <MobileTabBar />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/store/auth';
import { useToast } from '@/composables/useToast';
import api from '@/api';
import { detectEmotion } from '@/utils/face';
import { applyComplexEmotion } from '@/utils/complexEmotion';
import { getPoseDetector } from '@/utils/pose';
import {
  MotionTracker,
  classifyBehavior,
  DetectionSimulator,
  EMOTION_LABELS,
  EMOTION_EMOJI,
  BEHAVIOR_LABELS,
  RED_BEHAVIORS,
} from '@/utils/behavior';
import { DetectionSocket } from '@/utils/ws';
import {
  getBaseline,
  saveBaseline,
  evaluateRelative,
  newBaselineAccumulator,
  accumulateBaseline,
  finalizeBaseline,
  type BaselineProfile,
} from '@/care/baseline';
import { stepForBehavior, type BehaviorStep } from '@/care/behaviorSteps';
import { awardStars, getStars, isPositiveMoment, nextRewardAt } from '@/care/reinforcement';
import {
  RISK_LEVEL_LABELS,
  contactActionLabel,
  getContacts,
  saveContacts,
  phoneForRole,
  type EmergencyContacts,
} from '@/care/risk';
import { PRIVACY_PROMISE, getNoCameraMode, setNoCameraMode } from '@/care/privacy';
import type { RiskLevel, RiskSopItem } from '@/api/types';
import MobileTabBar from '@/components/MobileTabBar.vue';

const router = useRouter();
const auth = useAuthStore();
const toast = useToast();

// 学生端登录成功提示「欢迎进入 XX」（同一标签页同一学生只弹一次）
onMounted(() => {
  if (auth.studentName) {
    const welcomedKey = `sg_welcomed_${auth.studentId || ''}`;
    if (!sessionStorage.getItem(welcomedKey)) {
      sessionStorage.setItem(welcomedKey, '1');
      toast.success(`欢迎进入 ${auth.studentName} 👋`);
    }
  }
});

// 背景图（用户上传素材）
const bgUrl = '/backgrounds/bg-emotion.jpg';

const videoEl = ref<HTMLVideoElement | null>(null);
const overlayEl = ref<HTMLCanvasElement | null>(null);

const running = ref(false);
const mode = ref<'realtime' | 'demo'>('realtime');
const noCamera = ref(getNoCameraMode());
const fps = ref(0);
const composite = ref(70);
const mood = ref({ emoji: '😐', text: '平静' });
const behaviorLabel = ref('—');
const riskAlert = ref(false);
const sootheHint = ref(false);
const comfortSession = ref('');
const curve = ref<number[]>([]);

// 特征 1：个人基线
const baseline = ref<BaselineProfile | null>(auth.studentId ? getBaseline(auth.studentId) : null);
const baselinePhase = ref<'none' | 'prompt' | 'recording'>('none');
const baselineCountdown = ref(10);
const baselineAcc = newBaselineAccumulator();
let baselineTimer: number | null = null;

// 特征 1：多帧确认（连续 N 帧负向才确认告警）
const CONFIRM_FRAMES = 5;
const negativeStreak = ref(0);
let positiveStreak = 0;

// 特征 2：介入前/后情绪（本地记录，便于学生端即时反馈；后端看板算回升率）
let preNegativeAvg = 0;
let preNegativeN = 0;

// 特征 3：行为即时步骤
const stepToast = ref<BehaviorStep | null>(null);
let lastStepBehavior = '';
let stepCooldownUntil = 0;

// 特征 4：正向强化
const starCount = ref(auth.studentId ? getStars(auth.studentId).total : 0);
const starWeek = ref(auth.studentId ? getStars(auth.studentId).weekTotal : 0);
const celebrate = ref(false);
const lastStars = ref(1);
let calmStart = 0;
let lastRewardAt = 0;

// 特征 5 / 7
const showPrivacy = ref(false);
const contacts = ref<EmergencyContacts>(getContacts());
const reducedMotion = ref(false);

// 特征 7：风险分级
const riskLevel = ref<RiskLevel | null>(null);
const sopMap = ref<Record<RiskLevel, RiskSopItem> | null>(null);
const riskLabel = computed(() => (riskLevel.value ? RISK_LEVEL_LABELS[riskLevel.value] : ''));
const currentSop = computed<RiskSopItem>(() => {
  if (riskLevel.value && sopMap.value) return sopMap.value[riskLevel.value];
  return { level: 'yellow', label: '', color: '#f1c40f', steps: [], contacts: [] };
});

// 加载风险 SOP（含一键联系动作）
async function loadSop() {
  if (!auth.studentId) return;
  try {
    const res = await api.reportRiskSummary(auth.studentId, { period: 'WEEKLY' });
    sopMap.value = res.data.sop;
  } catch {
    /* 离线也可用内置兜底 */
  }
}

const baselineDropText = computed(() => {
  if (!baseline.value) return '';
  // composite 已是相对评估后的，这里展示相对基线的方向
  return lastDrop.value > 0 ? `↓${lastDrop.value}` : '平稳';
});
const lastDrop = ref(0);

let stream: MediaStream | null = null;
let timer: number | null = null;
let sessionId = '';
let lastTick = 0;
let frameCount = 0;
let fpsWindow = 0;
let negativeMs = 0;
let lastTs = 0;

const tracker = new MotionTracker();
const simulator = new DetectionSimulator();
const sock = new DetectionSocket();

// 阶段三：MediaPipe 姿态/手部关键点（真实行为特征：自残/拍手/指认/捂脸/转圈）
const poseDetector = getPoseDetector();
const poseReady = ref(false);
const poseBusy = ref(false);
let prevYaw = 0;
let angularEMA = 0;

// 情绪 EMA 平滑（降抖，避免逐帧表情跳变）
const emaScores: Record<string, number> = {};
const EMA_ALPHA = 0.25;

// 行为平滑（滞回：连续 2 帧相同才切换，避免单帧跳变）+ 自伤多帧确认
let behaviorEMA: string = 'sit_still';
let behaviorEMACount = 0;
// 红色风险行为多帧确认（连续 3 帧才上报：
// 避免托腮/整理头发/挥手掠面被判自伤、瞬间低头被判跌倒这类误报触发紧急短信）
const RISK_CONFIRM = 3;
let riskStreak = 0;

// 久坐计时：连续静坐超过阈值需起身活动（默认 30 分钟，可用 localStorage 覆盖便于测试）
const SIT_LONG_MINUTES = Number(localStorage.getItem('sp_sit_long_minutes') || 30);
const sitMinutes = ref(0);
const sitLongAlert = ref(false);
const complexCues = ref<string[]>([]);
let sitStillMs = 0;
let lastFrameTs = 0;
let lastSitRemindAt = 0;

// 阶段三：上传照片自检（摄像头坏了也能验收识别管线）
const selfCheckOpen = ref(false);
const selfCheckImg = ref<string | null>(null);
const selfCheckLoading = ref(false);
const selfCheckResult = ref<{
  emotion: Record<string, number>;
  emotionLabel: string;
  behaviorLabel: string;
  behaviorConf: number;
  poseNotes: string[];
} | null>(null);

const curvePoints = computed(() => {
  const data = curve.value.slice(-60);
  if (data.length === 0) return '';
  const step = 300 / Math.max(data.length - 1, 1);
  return data.map((v, i) => `${(i * step).toFixed(1)},${(80 - (v / 100) * 80).toFixed(1)}`).join(' ');
});

function drawBox(box: { x: number; y: number; width: number; height: number } | null) {
  const cv = overlayEl.value;
  const video = videoEl.value;
  if (!cv || !video) return;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!box || !video.videoWidth) return;
  const sx = cv.width / video.videoWidth;
  const sy = cv.height / video.videoHeight;
  ctx.strokeStyle = '#ffb15c';
  ctx.lineWidth = 3;
  ctx.strokeRect(box.x * sx, box.y * sy, box.width * sx, box.height * sy);
}

async function start() {
  if (running.value) return;
  if (!auth.studentId) {
    router.push('/student/face-login');
    return;
  }
  await loadSop();

  // 阶段三：初始化 MediaPipe 姿态/手部模型（本地加载，失败自动回退运动检测）
  poseDetector
    .init()
    .then(() => {
      poseReady.value = poseDetector.isAvailable;
    })
    .catch(() => {
      poseReady.value = false;
    });

  try {
    const res = await api.createSession(auth.studentId, noCamera.value ? 'VIDEO_UPLOAD' : 'CAMERA', 'web-' + mode.value);
    sessionId = res.data.sessionId;
  } catch (e) {
    console.error('创建会话失败', e);
    return;
  }

  const token = auth.token || '';
  try {
    await sock.connect(token);
    sock.onRisk((frame) => {
      if (frame.riskLevel) setRiskLevel(frame.riskLevel);
    });
    sock.onRealtime((frame) => {
      // 特征 7：实时风险分级（黄/橙/红）来自后端映射
      if (frame.riskLevel) setRiskLevel(frame.riskLevel);
      else if (positiveStreak >= 10) setRiskLevel(null);
    });
  } catch (e) {
    console.warn('WebSocket 连接失败，将仅本地展示', e);
  }

  sock.onComfort((payload) => {
    comfortSession.value = payload.session?.id ?? '';
  });

  // 特征 1：首次进入且无基线 → 先录平静基线（需摄像头）
  if (mode.value === 'realtime' && !noCamera.value && !baseline.value) {
    baselinePhase.value = 'prompt';
    // 仍需打开摄像头以便录制基线
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      if (videoEl.value) videoEl.value.srcObject = stream;
      await detectEmotion;
    } catch (e) {
      console.warn('摄像头不可用，进入纯行为模式', e);
      noCamera.value = true;
    }
    running.value = true;
    timer = window.setInterval(tick, 180);
    return;
  }

  if (mode.value === 'realtime' && !noCamera.value) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      if (videoEl.value) videoEl.value.srcObject = stream;
      await detectEmotion;
    } catch (e) {
      console.warn('摄像头不可用，进入纯行为模式', e);
      noCamera.value = true;
    }
  }

  running.value = true;
  negativeMs = 0;
  fpsWindow = performance.now();
  frameCount = 0;
  lastTick = 0;
  negativeStreak.value = 0;
  riskLevel.value = null;
  timer = window.setInterval(tick, 180);
}

function startBaseline() {
  baselinePhase.value = 'recording';
  baselineCountdown.value = 10;
  const acc = newBaselineAccumulator();
  Object.assign(baselineAcc, acc);
  baselineTimer = window.setInterval(async () => {
    baselineCountdown.value -= 1;
    if (videoEl.value) {
      const er = await detectEmotion(videoEl.value);
      if (er) accumulateBaseline(baselineAcc, er.scores);
    }
    if (baselineCountdown.value <= 0) finishBaseline();
  }, 1000);
}

function finishBaseline() {
  if (baselineTimer) {
    clearInterval(baselineTimer);
    baselineTimer = null;
  }
  const prof = finalizeBaseline(baselineAcc);
  if (auth.studentId) saveBaseline(auth.studentId, prof);
  baseline.value = prof;
  baselinePhase.value = 'none';
}

async function tick() {
  const now = performance.now();
  frameCount++;
  if (now - fpsWindow >= 1000) {
    fps.value = (frameCount * 1000) / (now - fpsWindow);
    frameCount = 0;
    fpsWindow = now;
  }

  let scores: Record<string, number>;
  let behavior: { behavior: string; confidence: number };
  let box: { x: number; y: number; width: number; height: number } | null = null;

  if (mode.value === 'realtime' && videoEl.value && !noCamera.value) {
    const er = await detectEmotion(videoEl.value);
    if (er) {
      // 情绪 EMA 平滑：降低逐帧抖动
      for (const k of Object.keys(er.scores)) {
        emaScores[k] = emaScores[k] == null ? er.scores[k] : emaScores[k] * (1 - EMA_ALPHA) + er.scores[k] * EMA_ALPHA;
      }
      scores = { ...emaScores };
      box = er.box;
      const features = tracker.update(videoEl.value, box);

      // 阶段三：接入 MediaPipe 真实姿态/手部关键点（自残/拍手/指认/捂脸/转圈）
      if (poseReady.value && !poseBusy.value) {
        poseBusy.value = true;
        try {
          const { pose, hand } = await poseDetector.detectVideo(videoEl.value, now);
          const pf = poseDetector.extractWithMotion(pose, hand, features.motionEnergy);
          if (pf.personPresent) {
            features.selfHit = pf.selfHit;
            features.handClap = pf.handClap;
            features.pointing = pf.pointing;
            features.handsNearFace = pf.handsNearFace;
            // 补盲新增：跌倒 / 打架 / 击打肢体 / 撞头 / 人数
            features.fall = pf.fall;
            features.fight = pf.fight;
            features.hitArm = pf.hitArm;
            features.headBang = pf.headBang;
            features.personCount = pf.personCount;
            // 转圈：基于躯干偏转轴单帧变化的平滑估计（时序角速度）
            const dYaw = Math.abs(pf.bodyYaw - prevYaw);
            prevYaw = pf.bodyYaw;
            angularEMA = angularEMA * 0.82 + Math.min(1, dYaw / 0.22) * 0.18;
            features.angular = angularEMA;
          }
        } catch (e) {
          // 单帧推理异常，跳过本帧的姿态特征，运动检测仍生效
          console.warn('[pose] 推理异常，本帧跳过：', (e as Error).message);
        } finally {
          poseBusy.value = false;
        }
      }

      behavior = classifyBehavior(features);
      if (RED_BEHAVIORS.includes(behavior.behavior)) riskStreak += 1;
      else riskStreak = 0;

      // 复杂情绪融合：7 类基础表情 + 面部几何(EAR/MAR/眉毛/头姿) + 运动特征
      // → 困惑 / 焦虑 / 兴奋 / 疲惫 / 沮丧 / 专注 / 满足
      const ce = applyComplexEmotion({
        basic: scores,
        face: er.faceMetrics,
        motion: {
          motionEnergy: features.motionEnergy,
          headSway: features.headSway,
          handsNearFace: features.handsNearFace,
          stillness: features.stillness,
          dy: features.dy,
        },
      });
      scores = ce.scores;
      complexCues.value = ce.cues;
    } else {
      // 重新初始化 EMA，避免上一轮残留
      for (const k of Object.keys(emaScores)) emaScores[k] = undefined as any;
      scores = { neutral: 80, happy: 10, surprise: 4, sad: 2, angry: 1, fear: 2, disgust: 1 };
      tracker.update(videoEl.value, null);
      // 修正：检测不到人脸 → 标记为「不在场」，而不是误判为平静静坐
      riskStreak = 0;
      behavior = { behavior: 'absent', confidence: 0.6 };
    }
    drawBox(box);
  } else if (noCamera.value) {
    // 特征 5：纯行为/定时抽样模式——不开摄像头，仅定期记录「在场/静坐」
    scores = { neutral: 88, happy: 6, surprise: 2, sad: 1, angry: 1, fear: 1, disgust: 1 };
    riskStreak = 0;
    behaviorEMA = 'sit_still';
    behaviorEMACount = 0;
    behavior = { behavior: 'sit_still', confidence: 0.7 };
  } else {
    const s = simulator.next();
    scores = s.scores;
    behavior = s.behavior;
  }

  // 特征 1：相对自身基线判断（而非绝对阈值）
  const rel = evaluateRelative(scores, baseline.value);
  lastDrop.value = rel.drop;
  composite.value = rel.compositeScore;
  const dominant = rel.dominant;
  mood.value = { emoji: EMOTION_EMOJI[dominant] || '😐', text: EMOTION_LABELS[dominant] || '平静' };
  // —— 行为后处理：自伤多帧确认 + 滞回平滑，抑制单帧噪声跳变 ——
  const confirmedBehavior =
    RED_BEHAVIORS.includes(behavior.behavior) && riskStreak < RISK_CONFIRM
      ? 'sit_still'
      : behavior.behavior;
  if (RED_BEHAVIORS.includes(confirmedBehavior) || confirmedBehavior === 'absent') {
    behaviorEMA = confirmedBehavior;
    behaviorEMACount = 0;
  } else if (confirmedBehavior !== behaviorEMA) {
    behaviorEMACount += 1;
    if (behaviorEMACount >= 2) {
      behaviorEMA = confirmedBehavior;
      behaviorEMACount = 0;
    }
  } else {
    behaviorEMACount = 0;
  }
  const displayBehavior = behaviorEMA;

  // 久坐计时：连续静坐累计（切后台再回来时限幅，避免时间跳变导致误提醒）
  const dt = lastFrameTs ? Math.min(now - lastFrameTs, 2000) : 0;
  lastFrameTs = now;
  if (displayBehavior === 'sit_still') sitStillMs += dt;
  else sitStillMs = 0;
  sitMinutes.value = Math.round((sitStillMs / 60000) * 10) / 10;
  const isSitLong = sitMinutes.value >= SIT_LONG_MINUTES;
  sitLongAlert.value = isSitLong;
  if (isSitLong && now - lastSitRemindAt > 5 * 60 * 1000) {
    lastSitRemindAt = now;
    toast.warn(`已连续静坐 ${Math.floor(sitMinutes.value)} 分钟，建议起身活动一下 🚶`);
  }
  // 久坐是比"静坐"更值得关注的状态，达到阈值后升级标签
  const finalBehavior = isSitLong ? 'sit_long' : displayBehavior;
  behaviorLabel.value = isSitLong
    ? `久坐 ${Math.floor(sitMinutes.value)} 分钟`
    : BEHAVIOR_LABELS[displayBehavior] ||
      (displayBehavior === 'absent' ? '不在场' : displayBehavior);

  curve.value.push(rel.compositeScore);
  if (curve.value.length > 200) curve.value.shift();

  // 特征 1：多帧确认——连续 N 帧负向才确认告警
  if (rel.negative) {
    negativeStreak.value += 1;
    positiveStreak = 0;
    if (lastTs) negativeMs += now - lastTs;
    preNegativeAvg = (preNegativeAvg * preNegativeN + rel.compositeScore) / (preNegativeN + 1);
    preNegativeN += 1;
  } else {
    negativeStreak.value = 0;
    positiveStreak += 1;
    negativeMs = 0;
    if (positiveStreak >= 10 && riskLevel.value) setRiskLevel(null);
  }
  lastTs = now;
  // 仅多帧确认后才弹安抚提示（特征 2 的本地触发条件）
  sootheHint.value = negativeStreak.value >= CONFIRM_FRAMES;

  // 特征 3：行为即时步骤弹窗（用平滑后的行为，避免单帧噪声触发）
  maybeShowStep(finalBehavior);

  // 特征 4：正向强化
  maybeReward(dominant, finalBehavior, now);

  // 实时推送
  if (sessionId && (now - lastTick > 150)) {
    lastTick = now;
    sock.sendFrame({
      sessionId,
      emotionScores: scores,
      behaviors: [
        {
          behavior: finalBehavior,
          confidence:
            finalBehavior === behavior.behavior
              ? behavior.confidence
              : finalBehavior === 'self_injury'
                ? 0.85
                : 0.5,
          // source 区分数据来源，便于后端/调参时区分高精度（pose）与降级（motion-fallback）样本
          source: noCamera.value
            ? 'sampler'
            : mode.value === 'demo'
              ? 'demo'
              : poseReady.value
                ? 'pose'
                : 'motion-fallback',
        },
      ],
      ts: Date.now(),
    });
  }
}

// 特征 3
function maybeShowStep(behavior: string) {
  const now = Date.now();
  if (behavior === lastStepBehavior && now < stepCooldownUntil) return;
  const step = stepForBehavior(behavior);
  if (!step) return;
  stepToast.value = step;
  lastStepBehavior = behavior;
  stepCooldownUntil = now + 20000; // 同行为 20s 内不重复弹
}

// 特征 4
function maybeReward(dominant: string, behavior: string, now: number) {
  if (!calmStart) calmStart = now;
  const calmMs = now - calmStart;
  if (behavior !== 'sit_still' && dominant !== 'neutral') calmStart = now; // 重置平静计时
  const r = isPositiveMoment({ dominant, behavior, calmMs });
  if (r.hit && now - lastRewardAt > 8000 && auth.studentId) {
    lastRewardAt = now;
    const st = awardStars(auth.studentId, r.reason || '积极时刻', 1);
    starCount.value = st.total;
    starWeek.value = st.weekTotal;
    lastStars.value = 1;
    celebrate.value = true;
    setTimeout(() => (celebrate.value = false), 2500);
    // 顺手让桌宠庆祝
    if (auth.studentId) api.deskPetCommand(auth.studentId, { action: 'cheer' }).catch(() => {});
  }
}

// 特征 7
function setRiskLevel(level: RiskLevel | null) {
  riskLevel.value = level;
}

function telFor(role: string): string | undefined {
  const phone = phoneForRole(role, contacts.value);
  return phone ? `tel:${phone}` : undefined;
}
function onContact(role: string) {
  const phone = phoneForRole(role, contacts.value);
  if (!phone) {
    alert(`请在「隐私说明」中填写${role}的手机号，即可一键拨打。`);
    showPrivacy.value = true;
  }
}

function saveContactsLocal() {
  saveContacts(contacts.value);
  showPrivacy.value = false;
}

function stop() {
  running.value = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (baselineTimer) {
    clearInterval(baselineTimer);
    baselineTimer = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  sock.disconnect();
  if (sessionId) {
    api.endSession(sessionId, Math.round(fps.value)).catch(() => {});
    sessionId = '';
  }
  riskLevel.value = null;
  sootheHint.value = false;
  comfortSession.value = '';
  negativeMs = 0;
  lastTs = 0;
  negativeStreak.value = 0;
  riskAlert.value = false;
  baselinePhase.value = 'none';
}

function toggleMode() {
  const wasRunning = running.value;
  if (wasRunning) stop();
  mode.value = mode.value === 'realtime' ? 'demo' : 'realtime';
  tracker.reset();
  if (wasRunning) start();
}

function toggleNoCamera() {
  noCamera.value = !noCamera.value;
  setNoCameraMode(noCamera.value);
  if (running.value) {
    // 切换模式需重启检测
    stop();
    start();
  }
}

watch(reducedMotion, (v) => {
  document.documentElement.classList.toggle('reduced-motion', v);
});

function onSoothe() {
  sootheHint.value = false;
  negativeMs = 0;
  router.push({
    path: '/student/comfort',
    query: { sessionId: comfortSession.value || undefined },
  });
}

function logout() {
  stop();
  auth.logout();
  router.push('/student/face-login');
}

// 阶段三：上传照片自检（摄像头损坏也能验收识别管线）
const selfCheckFileInput = ref<HTMLInputElement | null>(null);

function openSelfCheck() {
  selfCheckOpen.value = true;
}

function onSelfCheckPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files && input.files[0];
  if (!file) return;
  runSelfCheck(file);
}

async function runSelfCheck(file: File) {
  selfCheckLoading.value = true;
  selfCheckResult.value = null;
  const url = URL.createObjectURL(file);
  selfCheckImg.value = url;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = url;
    });
    // 情绪识别
    const er = await detectEmotion(img as unknown as HTMLVideoElement);
    const scores = er?.scores ?? { neutral: 100 };
    // 姿态/手部关键点
    await poseDetector.init();
    const { pose, hand } = await poseDetector.detectImage(img);
    const pf = poseDetector.extractFeatures(pose, hand); // 静态图不做运动门控
    const features = {
      motionEnergy: 0,
      dx: 0,
      dy: 0,
      angular: 0,
      handsNearFace: pf.handsNearFace,
      headSway: 0,
      offSeat: 0,
      stillness: 1,
      handClap: pf.handClap,
      pointing: pf.pointing,
      selfHit: pf.selfHit,
    };
    const behavior = classifyBehavior(features);
    const notes: string[] = [];
    if (pf.personPresent) {
      if (pf.selfHit > 0.4) notes.push('⚠️ 检测到手部接触头部（自伤倾向动作）');
      if (pf.handClap > 0.5) notes.push('👏 检测到双手靠近（拍手）');
      if (pf.pointing > 0.5) notes.push('👉 检测到单臂前伸（指认）');
      if (pf.handsNearFace > 0.6) notes.push('🤚 检测到手捂面部');
      if (notes.length === 0) notes.push('未识别到明显动作特征（可换更清晰/全身的照片）');
    } else {
      notes.push('未检测到人体姿态关键点（请上传含全身或半身的人物照片）');
    }
    selfCheckResult.value = {
      emotion: scores,
      emotionLabel: er ? EMOTION_LABELS[er.dominant] || '平静' : '平静',
      behaviorLabel: BEHAVIOR_LABELS[behavior.behavior] || behavior.behavior,
      behaviorConf: behavior.confidence,
      poseNotes: notes,
    };
  } catch (err) {
    alert('自检识别失败：' + (err as Error).message);
  } finally {
    selfCheckLoading.value = false;
  }
}

onBeforeUnmount(stop);
</script>

<style scoped>
/* 背景图：固定铺满 + 柔和遮罩，保留卡片可读性 */
.dash-with-bg {
  position: relative;
  flex-direction: column;
  align-items: stretch;
  background-size: cover !important;
  background-position: center !important;
  background-attachment: fixed;
  background-repeat: no-repeat;
}
.dash-bg-overlay {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(255, 220, 235, 0.35) 0%, rgba(255, 240, 220, 0.25) 50%, rgba(200, 170, 230, 0.30) 100%);
}
/* 提升前景卡片层级，确保不被遮罩盖住 */
.dash-with-bg > .privacy-bar,
.dash-with-bg > .card {
  position: relative;
  z-index: 1;
}
.dash-with-bg > .modal-mask {
  z-index: 50;
}
/* 卡片半透明磨砂，让背景也透一点，但文字仍清晰 */
.dash-with-bg > .card {
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(6px);
  box-shadow: 0 12px 36px rgba(120, 70, 160, 0.18);
}
.dash-with-bg > .card[style*="background: #fff3e6"],
.dash-with-bg > .card[style*="background: #ffe7d6"] {
  /* 曲线/安抚条保留原本的暖色，不再加磨砂 */
  backdrop-filter: none;
}

.privacy-bar {
  width: 820px; max-width: 96%; margin: 0 auto 10px;
  display: flex; justify-content: space-between; align-items: center;
  background: #eafaf1; color: #1f9254; border-radius: 12px; padding: 8px 14px; font-size: 14px;
}
.link { background: none; border: none; color: #ff7a59; cursor: pointer; font-size: 13px; text-decoration: underline; }
.base-tag { font-size: 13px; color: #888; margin-left: 8px; }
.stars { font-size: 16px; margin-top: 4px; }
.sit-long-tip {
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: 10px;
  background: #fff4e0;
  border: 1px solid #f0c88a;
  color: #8a5a12;
  font-size: 12px;
  font-weight: 600;
}
.star-sub { font-size: 12px; color: #888; margin-left: 6px; }

/* 特征 7：风险横幅——柔和脉冲，不刺眼闪烁 */
.risk-banner {
  position: absolute; left: 0; right: 0; top: 0; margin: 10px;
  border-radius: 14px; padding: 10px 14px; color: #5a3a12;
  background: #fff6e6; border: 2px solid #f1c40f; text-align: left;
  animation: soft-pulse 2.4s ease-in-out infinite;
}
.risk-banner.lv-orange { background: #fff0e6; border-color: #e8833a; }
.risk-banner.lv-red { background: #fdeee9; border-color: #d9603b; }
.rb-head { font-weight: 800; font-size: 15px; margin-bottom: 4px; }
.rb-steps { margin: 4px 0; padding-left: 18px; font-size: 13px; }
.rb-contacts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.contact-btn {
  background: #fff; border: 1px solid #e8833a; color: #d9603b; border-radius: 10px;
  padding: 4px 10px; font-size: 13px; text-decoration: none; cursor: pointer;
}
@keyframes soft-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(232, 131, 58, 0.0); }
  50% { box-shadow: 0 0 0 6px rgba(232, 131, 58, 0.18); }
}

/* 特征 3：行为步骤弹窗 */
.step-toast {
  position: absolute; right: 10px; bottom: 10px; max-width: 280px;
  background: #fff; border: 2px solid #ffd9a8; border-radius: 14px; padding: 10px 12px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.15); display: flex; gap: 8px;
}
.st-emoji { font-size: 28px; }
.st-title { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
.st-step { font-size: 13px; color: #444; }
.toast-enter-active, .toast-leave-active { transition: opacity .3s, transform .3s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px); }

/* 特征 4：庆祝 */
.celebrate {
  position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%);
  background: #fff; border: 2px solid #ffb4e1; color: #d63384; font-weight: 800;
  padding: 12px 20px; border-radius: 16px; font-size: 18px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);
}
.pop-enter-active { animation: pop .5s ease; }
.pop-leave-active { transition: opacity .4s; }
.pop-leave-to { opacity: 0; }
@keyframes pop { 0% { transform: translate(-50%, -50%) scale(0.6); } 60% { transform: translate(-50%, -50%) scale(1.15); } 100% { transform: translate(-50%, -50%) scale(1); } }

/* 特征 1：基线录制遮罩 */
.baseline-mask {
  position: absolute; inset: 0; background: rgba(20,20,20,0.78); color: #fff;
  display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; text-align: center;
}
.bl-progress { width: 70%; height: 10px; background: #444; border-radius: 6px; margin-top: 12px; overflow: hidden; }
.bl-fill { height: 100%; background: #ffb15c; transition: width 1s linear; }

/* 控制区：2x2 网格 + 状态行 */
.ctrl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 18px;
}
.ctrl-grid .btn {
  min-height: 72px;
  padding: 10px 12px;
  font-size: 17px;
  font-weight: 600;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 14px;
}
.ctrl-ico { font-size: 22px; }
.ctrl-primary { background: linear-gradient(135deg, #ff9a6c, #ff7a3d); color: #fff; border: none; }
.ctrl-primary:hover { filter: brightness(1.05); }
.ctrl-chat {
  background: linear-gradient(135deg, #ff8fa3, #ff6b9a);
  color: #fff;
  border: none;
}
.ctrl-chat:hover { filter: brightness(1.05); }
.ctrl-secondary { background: #fff7ef; color: #9a5a1f; border: 1px solid #ffd9a8; }
.ctrl-secondary:hover { background: #fff0e0; }
.ctrl-secondary.active { background: #ffe7d6; border-color: #ff9a6c; color: #d9603b; }
.ctrl-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
  font-size: 13px;
  color: #8a6239;
}
.btn-link {
  background: none;
  border: none;
  color: #b06a2c;
  cursor: pointer;
  text-decoration: underline;
  font-size: 13px;
  padding: 4px 6px;
}
.btn-link:hover { color: #d9603b; }
.ctrl-status { flex: 1; text-align: center; }
.rm { display: inline-flex; align-items: center; gap: 4px; }
@media (max-width: 480px) {
  .ctrl-grid { gap: 10px; }
  .ctrl-grid .btn { min-height: 64px; font-size: 15px; }
}

.rm { margin-left: 12px; font-size: 14px; color: #666; }

/* 弹窗 */
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: #fff; border-radius: 16px; padding: 22px; width: 460px; max-width: 92%; max-height: 86vh; overflow: auto; }
.modal h3 { margin: 0 0 10px; }
.modal ul { padding-left: 18px; font-size: 14px; line-height: 1.7; }
.modal h4 { margin: 14px 0 6px; }
.contact-form { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.contact-form input { padding: 8px 10px; border-radius: 8px; border: 1px solid #ddd; font-size: 14px; }

/* 阶段三：识别精度诚实声明条 */
.acc-bar {
  width: 820px; max-width: 96%; margin: 0 auto 10px;
  background: #fff7e6; color: #8a5a1f; border: 1px solid #ffe0a8;
  border-radius: 12px; padding: 8px 14px; font-size: 12.5px; line-height: 1.6;
}
.acc-bar strong { color: #d9603b; }

/* 阶段三：照片自检弹窗 */
.selfcheck { width: 520px; }
.selfcheck .hint { color: #666; }
.sc-btn { background: #f3f0ff; color: #5b3aa6; border: 1px solid #d6c8ff; }
.sc-btn:hover { background: #ece6ff; }
.sc-upload { display: flex; justify-content: center; margin: 10px 0; }
.sc-img { max-width: 100%; max-height: 280px; border-radius: 12px; border: 1px solid #eee; }
.sc-result { background: #fafaff; border: 1px solid #e8e3ff; border-radius: 12px; padding: 12px; margin: 10px 0; }
.sc-row { font-size: 14px; margin-bottom: 6px; }
.sc-bars { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; }
.sc-bar { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.sc-k { width: 42px; color: #555; }
.sc-track { flex: 1; height: 8px; background: #eee; border-radius: 6px; overflow: hidden; }
.sc-track i { display: block; height: 100%; background: linear-gradient(90deg, #ff9a6c, #ff6b9a); }
.sc-v { width: 30px; text-align: right; color: #888; }
.sc-notes { margin: 8px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.7; color: #333; }
.sc-acc { background: #fff3e6; border: 1px solid #ffd9a8; color: #9a5a1f; border-radius: 10px; padding: 8px 10px; font-size: 12px; margin: 8px 0; }
.sc-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
</style>
