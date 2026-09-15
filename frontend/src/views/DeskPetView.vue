<template>
  <div class="dp-with-bg" :style="{ backgroundImage: `url(${bgUrl})` }">
    <div class="dp-bg-overlay"></div>
    <div class="dp-wrap">
      <header class="dp-head dp-elevate">
      <div>
        <h1>🐾 桌面星宝（桌宠硬件接口）</h1>
        <p class="sub">实时接收检测 / 安抚 / 建议事件 · 通过 WebSocket 与 MQTT 双通道联动虚拟桌宠与实体机器人</p>
      </div>
      <button class="btn ghost" @click="router.push('/dashboard')">← 返回概览</button>
    </header>

    <!-- 控制条 -->
    <section class="card controls">
      <label>
        关联学生
        <select v-model="selectedStudent" :disabled="!students.length">
          <option v-for="s in students" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <button class="btn" :disabled="!selectedStudent || !!sock" @click="connect">{{ connected ? '已连接' : '连接桌宠' }}</button>
      <button class="btn ghost" :disabled="!sock" @click="disconnect">断开</button>
      <span class="status" :class="connected ? 'on' : 'off'">{{ connected ? '● 已连接' : '○ 未连接' }}</span>
      <span class="status mqtt" :class="mqttMode">MQTT: {{ mqttText }}</span>
      <button class="btn ghost float-btn" @click="toggleFloating">{{ floating ? '收起悬浮窗' : '打开悬浮窗' }}</button>
    </section>

    <div class="main">
      <!-- 桌宠舞台 -->
      <section class="card stage">
        <div class="pet-stage" :class="{ 'is-floating': floating }">
          <div class="glow" :style="{ background: moodColor }"></div>
          <img
            src="/images/xingbao.jpg"
            alt="星宝"
            class="pet"
            :class="animationClass"
            draggable="false"
          />
          <transition name="bubble">
            <div v-if="bubbleText" class="bubble">{{ bubbleText }}</div>
          </transition>
        </div>
        <div class="mood-label">
          心情：<b :style="{ color: moodColor }">{{ moodLabel }}</b>
          <span class="anim-label">· 动作：{{ animLabel }}</span>
        </div>
      </section>

      <!-- 指令 + 日志 -->
      <section class="card side">
        <h3>让星宝动起来（下发指令）</h3>
        <div class="cmd-grid">
          <button v-for="c in commands" :key="c.action" class="btn ghost cmd" @click="sendCommand(c.action)">
            {{ c.icon }} {{ c.label }}
          </button>
        </div>
        <h3 style="margin-top: 14px">实时事件流</h3>
        <ul class="log">
          <li v-for="(e, i) in events" :key="i" :class="'ev-' + e.type">
            <span class="ev-type">{{ evLabel(e.type) }}</span>
            <span class="ev-msg">{{ e.reaction.message || e.reaction.mood }}</span>
            <span class="ev-time">{{ fmt(e.ts) }}</span>
          </li>
          <li v-if="!events.length" class="hint">等待事件…（开启检测或安抚对话后，桌宠会实时反应）</li>
        </ul>
      </section>
    </div>

    <!-- 悬浮窗模式 -->
    <div
      v-if="floating"
      class="floating"
      :style="{ left: floatPos.x + 'px', top: floatPos.y + 'px' }"
      @pointerdown="startDrag"
    >
      <div class="floating-bar">
        <span>🐾 星宝</span>
        <button class="x" @pointerdown.stop @click="floating = false">×</button>
      </div>
      <div class="floating-pet">
        <img src="/images/xingbao.jpg" alt="星宝" class="pet mini" :class="animationClass" draggable="false" />
        <div v-if="bubbleText" class="mini-bubble">{{ bubbleText }}</div>
      </div>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/store/auth';
import api from '@/api';
import { DeskPetSocket } from '@/utils/deskpet';
import type { Student, PetReaction, DeskPetEventType, PetMood, PetAnimation } from '@/api/types';

const router = useRouter();
const auth = useAuthStore();
// 背景图（用户上传素材）
const bgUrl = '/backgrounds/bg-deskpet.jpg';

const STAR_PATH = 'M64 12 L78 45 L113 48 L87 71 L95 106 L64 88 L33 106 L41 71 L33 48 L78 45 Z';

const students = ref<Student[]>([]);
const selectedStudent = ref('');
const connected = ref(false);
const reaction = ref<PetReaction | null>(null);
const bubbleText = ref('');
const events = ref<{ type: DeskPetEventType; reaction: PetReaction; ts: string }[]>([]);
const mqtt = ref<{ connected: boolean; mode: 'remote' | 'local'; url: string | null }>({
  connected: false,
  mode: 'local',
  url: null,
});

const floating = ref(false);
const floatPos = ref({ x: window.innerWidth - 160, y: 120 });
const dragging = ref(false);

const sock = ref<DeskPetSocket | null>(null);
let bubbleTimer: any = null;

const MOOD_COLORS: Record<PetMood, string> = {
  happy: '#ffd166',
  calm: '#7ec8ef',
  sad: '#8fb8de',
  anxious: '#c9b6e4',
  angry: '#ff9a9a',
  alert: '#ff5a5a',
  celebrate: '#ffb4e1',
  sleep: '#b7b7b7',
};
const MOOD_LABELS: Record<PetMood, string> = {
  happy: '开心', calm: '平静', sad: '难过', anxious: '不安', angry: '生气', alert: '警觉', celebrate: '庆祝', sleep: '休眠',
};
const ANIM_LABELS: Record<PetAnimation, string> = {
  idle: '待机', bounce: '弹跳', dance: '跳舞', sway: '摇摆', shake: '抖动', hug: '拥抱', alert: '警示', cheer: '欢呼', spin: '旋转',
};

const moodColor = computed(() => (reaction.value ? MOOD_COLORS[reaction.value.mood] : '#7ec8ef'));
const moodLabel = computed(() => (reaction.value ? MOOD_LABELS[reaction.value.mood] : '平静'));
const animLabel = computed(() => (reaction.value ? ANIM_LABELS[reaction.value.animation] : '待机'));
const animationClass = computed(() => (reaction.value ? reaction.value.animation : 'idle'));

const mqttMode = computed(() => (mqtt.value.mode === 'remote' ? 'remote' : 'local'));
const mqttText = computed(() => (mqtt.value.mode === 'remote' ? '远程 broker' : '本地内存 broker'));

const commands = [
  { action: 'wave', icon: '👋', label: '招手' },
  { action: 'dance', icon: '💃', label: '跳舞' },
  { action: 'cheer', icon: '🎉', label: '欢呼' },
  { action: 'hug', icon: '🤗', label: '拥抱' },
  { action: 'spin', icon: '🌀', label: '转圈' },
  { action: 'alert', icon: '⚠️', label: '提醒' },
];

const MOUTH: Record<PetMood, string> = {
  happy: 'M48 78 Q64 94 80 78',
  celebrate: 'M48 76 Q64 96 80 76',
  calm: 'M52 82 Q64 88 76 82',
  sad: 'M48 86 Q64 74 80 86',
  anxious: 'M52 84 Q64 80 76 84',
  angry: 'M50 84 Q64 80 78 86',
  alert: 'M58 80 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0',
  sleep: 'M54 84 Q64 80 74 84',
};
const mouthPath = computed(() => MOUTH[reaction.value ? reaction.value.mood : 'calm']);

function fmt(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
  } catch {
    return '';
  }
}
function evLabel(t: string) {
  return { detection: '检测', risk: '风险', comfort: '安抚', advice: '建议', command: '指令', heartbeat: '心跳' }[t] || t;
}

function applyReaction(type: DeskPetEventType, r: PetReaction) {
  reaction.value = r;
  events.value.unshift({ type, reaction: r, ts: r.ts || new Date().toISOString() });
  if (events.value.length > 40) events.value.pop();
  if (r.message) {
    bubbleText.value = r.message;
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => (bubbleText.value = ''), 6000);
  }
}

async function loadStudents() {
  try {
    const res = await api.listStudents();
    students.value = res.data;
    if (!selectedStudent.value && students.value.length) selectedStudent.value = students.value[0].id;
  } catch (e) {
    console.warn('加载学生列表失败', e);
  }
}

async function connect() {
  if (!selectedStudent.value || sock.value) return;
  const s = new DeskPetSocket();
  try {
    await s.connect(auth.token || '');
    s.onReady((p) => {
      mqtt.value = p.mqtt;
    });
    s.onFeed((f) => {
      mqtt.value = f.mqtt;
      if (f.reaction) applyReaction(f.type || 'detection', f.reaction);
    });
    s.onPetState((p) => {
      if (p.studentId === selectedStudent.value) applyReaction(p.type, p.reaction);
    });
    s.subscribe(selectedStudent.value);
    sock.value = s;
    connected.value = true;
  } catch (e) {
    console.warn('桌宠连接失败', e);
    alert('桌宠 WebSocket 连接失败，请确认后端已启动。');
  }
}

function disconnect() {
  sock.value?.disconnect();
  sock.value = null;
  connected.value = false;
}

function sendCommand(action: string) {
  if (!selectedStudent.value) return;
  // 优先经 WebSocket 下发（实时），失败则走 REST
  if (sock.value) {
    sock.value.sendCommand(selectedStudent.value, action);
  } else {
    api.deskPetCommand(selectedStudent.value, { action }).catch(() => {});
  }
  // 本地即时预览
  applyReaction('command', {
    mood: 'celebrate',
    animation: (action as PetAnimation) || 'bounce',
    message: `星宝收到指令：${action}`,
    intensity: 60,
    ts: new Date().toISOString(),
  });
}

function toggleFloating() {
  floating.value = !floating.value;
  nextTick(() => {
    if (floating.value) floatPos.value = { x: window.innerWidth - 160, y: 120 };
  });
}

function startDrag(ev: PointerEvent) {
  dragging.value = true;
  const startX = ev.clientX;
  const startY = ev.clientY;
  const ox = floatPos.value.x;
  const oy = floatPos.value.y;
  const move = (e: PointerEvent) => {
    if (!dragging.value) return;
    floatPos.value = { x: ox + (e.clientX - startX), y: oy + (e.clientY - startY) };
  };
  const up = () => {
    dragging.value = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

onMounted(() => {
  loadStudents();
});
onBeforeUnmount(() => {
  disconnect();
  if (bubbleTimer) clearTimeout(bubbleTimer);
});
</script>

<style scoped>
.dp-wrap {
  max-width: 1040px;
  margin: 0 auto;
  padding: 24px;
  position: relative;
  z-index: 1;
}
/* 桌面星宝背景图 */
.dp-with-bg {
  position: relative;
  min-height: 100vh;
  background-size: cover !important;
  background-position: center !important;
  background-attachment: fixed;
  background-repeat: no-repeat;
}
.dp-bg-overlay {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg,
      rgba(255, 240, 235, 0.30) 0%,
      rgba(255, 230, 245, 0.25) 40%,
      rgba(220, 200, 240, 0.30) 100%);
}
.dp-elevate {
  background: rgba(255, 255, 255, 0.78) !important;
  backdrop-filter: blur(8px);
  border-radius: 14px;
  padding: 12px 16px;
  margin-bottom: 14px;
  box-shadow: 0 6px 18px rgba(120, 70, 160, 0.10);
  border: 1px solid rgba(255, 220, 230, 0.5);
}
.dp-wrap > .card {
  background: rgba(255, 255, 255, 0.88) !important;
  backdrop-filter: blur(6px);
}
.dp-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.dp-head h1 { margin: 0; font-size: 22px; }
.sub { margin: 4px 0 0; color: #6b7280; font-size: 13px; }
.card { background: #fff; border: 1px solid #eee; border-radius: 14px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
.controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
.controls select { padding: 6px 10px; border-radius: 8px; border: 1px solid #e0c9a6; }
.status { font-size: 12px; padding: 3px 10px; border-radius: 20px; }
.status.on { background: #e6f7ec; color: #1f9254; }
.status.off { background: #f2f2f2; color: #888; }
.status.mqtt { background: #eef3ff; color: #3366cc; }
.status.mqtt.remote { background: #e6f7ec; color: #1f9254; }
.float-btn { margin-left: auto; }
.main { display: grid; grid-template-columns: 1.1fr 1fr; gap: 16px; }
@media (max-width: 820px) { .main { grid-template-columns: 1fr; } }

.stage { display: flex; flex-direction: column; align-items: center; }
.pet-stage { position: relative; width: 260px; height: 280px; display: flex; align-items: center; justify-content: center; }
.glow { position: absolute; width: 200px; height: 200px; border-radius: 50%; filter: blur(28px); opacity: 0.5; transition: background 0.4s; }
.pet { position: relative; z-index: 1; transform-origin: 50% 60%; width: 220px; height: 220px; object-fit: contain; user-select: none; -webkit-user-drag: none; }
.pet.mini { width: 110px; height: 110px; }
.bubble {
  position: absolute; top: -6px; left: 50%; transform: translateX(-50%);
  background: #fff; border: 1px solid #ffd9a8; color: #7a4a16;
  padding: 8px 12px; border-radius: 14px; font-size: 14px; max-width: 240px; text-align: center;
  box-shadow: 0 3px 10px rgba(0,0,0,0.08); z-index: 3;
}
.mood-label { margin-top: 8px; font-size: 14px; }
.anim-label { color: #888; margin-left: 8px; }

/* 动画 */
.pet.idle { animation: pet-breathe 3s ease-in-out infinite; }
.pet.bounce { animation: pet-bounce 0.7s ease-in-out infinite; }
.pet.dance { animation: pet-dance 0.9s ease-in-out infinite; }
.pet.sway { animation: pet-sway 1.4s ease-in-out infinite; }
.pet.shake { animation: pet-shake 0.4s ease-in-out infinite; }
.pet.hug { animation: pet-hug 1.2s ease-in-out infinite; }
.pet.alert { animation: pet-alert 0.6s ease-in-out infinite; }
.pet.cheer { animation: pet-cheer 0.8s ease-in-out infinite; }
.pet.spin { animation: pet-spin 1.2s linear infinite; }

@keyframes pet-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }
@keyframes pet-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-18px); } }
@keyframes pet-dance { 0%,100% { transform: rotate(-8deg) translateY(0); } 50% { transform: rotate(8deg) translateY(-10px); } }
@keyframes pet-sway { 0%,100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
@keyframes pet-shake { 0%,100% { transform: translateX(-6px); } 50% { transform: translateX(6px); } }
@keyframes pet-hug { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
@keyframes pet-alert { 0%,100% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(255,90,90,0)); } 50% { transform: scale(1.05); filter: drop-shadow(0 0 10px rgba(255,90,90,0.7)); } }
@keyframes pet-cheer { 0%,100% { transform: translateY(0) rotate(-4deg); } 50% { transform: translateY(-22px) rotate(4deg); } }
@keyframes pet-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
@keyframes blink { 0%,92%,100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }

.side h3 { margin: 0 0 10px; font-size: 15px; }
.cmd-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.cmd { font-size: 13px; padding: 8px 4px; }
.log { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow-y: auto; }
.log li { display: flex; gap: 8px; align-items: baseline; padding: 6px 8px; border-radius: 8px; font-size: 13px; margin-bottom: 4px; background: #fafafa; }
.ev-type { flex: 0 0 44px; font-weight: 600; }
.ev-msg { flex: 1; color: #333; }
.ev-time { flex: 0 0 auto; color: #aaa; font-size: 11px; }
.ev-risk .ev-type, .ev-alert .ev-type { color: #d33; }
.ev-comfort .ev-type, .ev-celebrate .ev-type { color: #e07aa6; }
.ev-advice .ev-type { color: #3366cc; }

/* 悬浮窗 */
.floating {
  position: fixed; z-index: 9999; width: 150px; cursor: grab;
  background: rgba(255,255,255,0.95); border: 1px solid #ffd9a8; border-radius: 16px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.15); padding: 6px; user-select: none;
}
.floating-bar { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #7a4a16; }
.floating-bar .x { border: none; background: transparent; font-size: 16px; cursor: pointer; color: #999; }
.floating-pet { position: relative; display: flex; flex-direction: column; align-items: center; }
.mini-bubble { background: #fff; border: 1px solid #ffd9a8; color: #7a4a16; padding: 4px 8px; border-radius: 10px; font-size: 11px; margin-top: 4px; max-width: 130px; text-align: center; }

.bubble-enter-active, .bubble-leave-active { transition: opacity 0.3s; }
.bubble-enter-from, .bubble-leave-to { opacity: 0; }
</style>
