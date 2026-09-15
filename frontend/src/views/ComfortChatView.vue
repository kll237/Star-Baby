<template>
  <div class="center-screen chat-with-bg" :style="{ backgroundImage: `url(${bgUrl})` }">
    <div class="chat-bg-overlay"></div>
    <!-- 装饰用星宝角标（左下角，让背景中的位置能看到星宝意象） -->
    <img class="chat-deco-star" src="/images/xingbao.jpg" alt="" aria-hidden="true" />

    <div class="card chat-card" style="position: relative; z-index: 1">
      <!-- 头部 -->
      <header class="chat-head">
        <div class="chat-head-left">
          <div class="chat-avatar">🤗</div>
          <div>
            <h1 class="title chat-title">星宝陪聊室</h1>
            <p class="hint chat-sub">
              当前引擎：{{ llmProvider }}
              <span v-if="media" class="dot" :class="media.llm.configured ? 'ok' : 'warn'"></span>
            </p>
          </div>
        </div>
        <div class="chat-head-right">
          <label class="chk"><input type="checkbox" v-model="ttsEnabled" /> 🔊 朗读</label>
          <label class="chk"><input type="checkbox" v-model="serverVoice" @change="onServerVoiceChange" /> 🖥 服务端语音</label>
          <select class="mini-select" v-model="selectedVoice" @change="onVoiceChange" title="声线">
            <option value="">默认（童声优先）</option>
            <option v-for="v in voices" :key="v.name" :value="v.name">{{ voiceLabel(v) }}</option>
          </select>
          <select :value="llmProvider" @change="switchProvider(($event.target as HTMLSelectElement).value)" class="mini-select" title="引擎">
            <option v-for="p in providers" :key="p" :value="p">{{ providerLabel(p) }}</option>
          </select>
          <button class="btn ghost btn-mini" @click="endSession">结束</button>
        </div>
      </header>

      <!-- 消息区 -->
      <div ref="scrollEl" class="chat-scroll">
        <div v-for="m in messages" :key="m.id" class="row" :class="m.role === 'USER' ? 'right' : 'left'">
          <div class="bubble" :class="m.role">
            <div class="bubble-text">
              <span v-if="m.role === 'ASSISTANT' && m.id === streamingId" class="caret">▍</span>
              {{ m.content }}
            </div>
            <div v-if="m.technique" class="bubble-tech">🧩 {{ m.technique }}</div>
            <button
              v-if="m.role === 'ASSISTANT' && m.content"
              class="speak-btn"
              :class="{ active: speakingId === m.id }"
              @click="toggleSpeak(m)"
            >
              {{ speakingId === m.id ? '⏹ 停止' : (isSong(m) ? '🎵 哼唱' : '🔊 朗读') }}
            </button>
            <div
              v-if="m.role === 'ASSISTANT' && m.content && !m.id.startsWith('stream-')"
              class="fb"
            >
              <button class="fb-btn" :class="{ active: currentFeedback(m) === 'LIKE' }" :disabled="feedbackBusy[m.id]" @click="setFeedback(m, 'LIKE')">👍</button>
              <button class="fb-btn" :class="{ active: currentFeedback(m) === 'DISLIKE' }" :disabled="feedbackBusy[m.id]" @click="setFeedback(m, 'DISLIKE')">👎</button>
            </div>
          </div>
        </div>
        <div v-if="messages.length === 0" class="hint" style="text-align: center; margin-top: 24px">
          正在连接星宝…
        </div>
      </div>

      <!-- 输入区 -->
      <div class="chat-inputbar">
        <div class="chat-textarea-wrap">
          <textarea
            v-model="input"
            class="chat-input"
            :rows="listening ? 3 : 2"
            :placeholder="listening ? '🎙 正在聆听…点击麦克风结束' : '说说你的感受，或让星宝讲个故事、唱首歌～'"
            @keydown.enter.exact.prevent="send"
          ></textarea>
          <span v-if="listening" class="rec-pulse"></span>
        </div>
        <button
          class="btn ghost mic"
          :class="{ recording: listening }"
          :title="listening ? '点击停止录音' : '点击开始说话'"
          @click="toggleMic"
        >
          {{ listening ? '⏹' : '🎤' }}
        </button>
        <button class="btn btn-send" :disabled="sending || !input.trim()" @click="send">发送</button>
      </div>
      <p class="hint chat-foot">
        ✨ 星宝会陪你慢慢聊，还会讲故事、唱歌给你听～想听就说「讲个故事」或「唱首歌」吧。
      </p>
    </div>
    <MobileTabBar />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/store/auth';
import api from '@/api';
import MobileTabBar from '@/components/MobileTabBar.vue';
import {
  ComfortChatSocket,
  speakText,
  cancelSpeech,
  startListening,
  getChineseVoices,
  looksLikeSong,
  playServerTtsSentences,
  stopServerTts,
  splitSentences,
  streamSpeakStart,
  streamSpeakPush,
  streamSpeakEnd,
  streamSpeakStop,
  type ReplyChunkPayload,
  type UserEchoPayload,
  type ReplyPayload,
} from '@/utils/chat';
import type { ChatMessageView, MediaStatus, FeedbackKind } from '@/api/types';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

// 背景图（用户上传素材）- 让背景中的"星宝角"仍隐约透出
const bgUrl = '/backgrounds/bg-chat.jpg';

const messages = ref<ChatMessageView[]>([]);
const sessionId = ref('');
const input = ref('');
const sending = ref(false);
const ttsEnabled = ref(true);
const serverVoice = ref(localStorage.getItem('sp_server_voice') === '1');
const listening = ref(false);
const speakingId = ref('');
const llmProvider = ref('RULE');
const providers = ref<string[]>(['RULE', 'MOCK', 'ZHIPU', 'OPENAI']);

/** 把引擎 key 翻译成中文标签，RULE/MOCK 之外加上推荐/付费提示。 */
const PROVIDER_LABELS: Record<string, string> = {
  RULE: 'RULE · 规则话术',
  MOCK: 'MOCK · 演示桩',
  ZHIPU: 'ZHIPU · 智谱免费',
  OPENAI: 'OPENAI · 兼容 OpenAI',
};
function providerLabel(p: string): string {
  return PROVIDER_LABELS[p] || p;
}
const media = ref<MediaStatus | null>(null);
const scrollEl = ref<HTMLElement | null>(null);

// 多声线
const voices = ref<SpeechSynthesisVoice[]>([]);
const selectedVoice = ref<string>(localStorage.getItem('sp_voice') || '');

// 流式
const streamingId = ref<string>('');
let currentStreamMsg: ChatMessageView | null = null;
let streamBuf = '';
// 已收到但尚未送 TTS 的尾部片段（按句切分后剩余的不完整句）
let streamUnspoken = '';

const sock = new ComfortChatSocket();
let stopMic: (() => void) | null = null;

function scrollToBottom() {
  nextTick(() => {
    if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
  });
}

function voiceLabel(v: SpeechSynthesisVoice): string {
  const tag = /(女|female|girl|童|child)/i.test(v.name) ? '👧' : /(男|male|boy)/i.test(v.name) ? '👦' : '🎤';
  const lang = v.lang || '';
  return `${tag} ${v.name} (${lang})`;
}

function loadVoices() {
  voices.value = getChineseVoices();
  if (voices.value.length === 0) {
    // 浏览器声线列表是异步加载的
    const w = window as any;
    const synth = w.speechSynthesis || w.webkitSpeechSynthesis;
    synth?.addEventListener?.('voiceschanged', () => {
      voices.value = getChineseVoices();
    });
  }
}

function onVoiceChange() {
  localStorage.setItem('sp_voice', selectedVoice.value);
}

function isSong(m: ChatMessageView): boolean {
  return looksLikeSong(m.content || '');
}

async function loadSession(id: string) {
  try {
    const res = await api.getChatSession(id);
    sessionId.value = id;
    messages.value = res.data.messages;
    syncFeedback(res.data.messages);
    scrollToBottom();
  } catch (e) {
    console.error('加载会话失败', e);
  }
}

async function init() {
  if (!auth.studentId) {
    router.replace('/student/face-login');
    return;
  }
  loadVoices();

  try {
    media.value = (await api.getMedia()).data;
    llmProvider.value = media.value.llm.provider;
    providers.value = media.value.llm.available;
  } catch (e) {
    console.warn('获取媒体状态失败', e);
  }

  const qid = route.query.sessionId as string | undefined;
  if (qid) {
    await loadSession(qid);
  } else {
    try {
      const res = await api.startChat(auth.studentId, { triggerSource: 'MANUAL' });
      sessionId.value = res.data.session.id;
      messages.value = res.data.messages;
    } catch (e) {
      console.error('开启安抚会话失败', e);
    }
  }
  scrollToBottom();

  // 监听 WS 事件
  try {
    await sock.connect(auth.token || '');
    sock.onSessionStarted((p) => {
      sessionId.value = p.session.id;
      messages.value = p.messages;
      syncFeedback(p.messages);
      scrollToBottom();
    });
    sock.onUserEcho((p: UserEchoPayload) => {
      // 用户消息回显
      if (p.userMessage && !messages.value.find((m) => m.id === p.userMessage!.id)) {
        messages.value.push(p.userMessage);
        scrollToBottom();
      }
    });
    sock.onReply((p: ReplyPayload) => {
      // 用真实持久化的助手消息 id 回填流式占位消息，使反馈能绑定到正确记录
      const am = p.assistantMessage;
      if (!am) return;
      const idx = messages.value.findIndex((mm) => mm.role === 'ASSISTANT' && mm.id.startsWith('stream-'));
      if (idx >= 0) {
        messages.value[idx].id = am.id;
        if (am.technique) messages.value[idx].technique = am.technique;
        if (am.feedback) feedbackMap[am.id] = am.feedback;
      }
    });
    sock.onReplyChunk((p: ReplyChunkPayload) => {
      handleChunk(p);
    });
  } catch (e) {
    console.warn('聊天 WebSocket 连接失败', e);
  }
}

function handleChunk(p: ReplyChunkPayload) {
  if (p.done) {
    streamingId.value = '';
    if (currentStreamMsg) {
      // 最终化：标记技术/声线按钮可点
      scrollToBottom();
      if (ttsEnabled.value && currentStreamMsg.content) {
        // 把剩余尾部（可能的不完整句）作为最后一句推入，并结束流式朗读
        const tailParts = splitSentences(streamUnspoken);
        for (const s of tailParts) streamSpeakPush(s);
        streamSpeakEnd();
      }
    }
    currentStreamMsg = null;
    streamBuf = '';
    streamUnspoken = '';
    sending.value = false;
    return;
  }
  // 起始：建一个 placeholder 助手消息
  if (!currentStreamMsg) {
    const placeholder: ChatMessageView = {
      id: 'stream-' + Date.now(),
      role: 'ASSISTANT',
      content: '',
      createdAt: new Date().toISOString(),
    };
    messages.value.push(placeholder);
    currentStreamMsg = placeholder;
    streamingId.value = placeholder.id;
    streamBuf = '';
    streamUnspoken = '';
    // 新回复：开启流式朗读（边生成边按句播放）
    if (ttsEnabled.value) {
      speakingId.value = placeholder.id;
      streamSpeakStart({
        serverVoice: serverVoice.value,
        voiceName: selectedVoice.value || undefined,
        song: isSong(placeholder),
        onEnd: () => {
          if (speakingId.value === placeholder.id) speakingId.value = '';
        },
      });
    }
  }
  streamBuf += p.delta;
  streamUnspoken += p.delta;
  if (currentStreamMsg) {
    currentStreamMsg.content = streamBuf;
    scrollToBottom();
    if (ttsEnabled.value) {
      // 把已完成的短句送入流式播放器，尾部不完整句留在 streamUnspoken
      const parts = splitSentences(streamUnspoken);
      if (parts.length > 1) {
        const completed = parts.slice(0, parts.length - 1);
        streamUnspoken = parts[parts.length - 1];
        for (const s of completed) streamSpeakPush(s);
      }
    }
  }
}

function send() {
  const text = input.value.trim();
  if (!text || sending.value || !sessionId.value) return;
  sending.value = true;
  input.value = '';
  // 通过 WS 发：流式走 reply_chunk
  if (sock && (sock as any).socket?.connected) {
    sock.sendMessage({ sessionId: sessionId.value, content: text });
  } else {
    // 兜底走 HTTP
    fallbackHttpSend(text);
  }
}

async function fallbackHttpSend(text: string) {
  try {
    const res = await api.sendChat(sessionId.value, text);
    messages.value.push(res.data.userMessage);
    messages.value.push(res.data.assistantMessage);
    syncFeedback([res.data.assistantMessage]);
    if (ttsEnabled.value) speak(res.data.assistantMessage);
    scrollToBottom();
  } catch (e) {
    console.error('发送失败', e);
  } finally {
    sending.value = false;
  }
}

// ---------------- 回复质量反馈 👍/👎 ----------------
const feedbackMap = reactive<Record<string, FeedbackKind>>({});
const feedbackBusy = reactive<Record<string, boolean>>({});

function currentFeedback(m: ChatMessageView): FeedbackKind {
  return feedbackMap[m.id] ?? m.feedback ?? null;
}

function syncFeedback(list: ChatMessageView[]) {
  for (const m of list) {
    if (m.role === 'ASSISTANT' && m.feedback) feedbackMap[m.id] = m.feedback;
  }
}

async function setFeedback(m: ChatMessageView, value: 'LIKE' | 'DISLIKE') {
  const id = m.id;
  if (!id || id.startsWith('stream-')) return;
  const next: FeedbackKind = currentFeedback(m) === value ? null : value;
  feedbackMap[id] = next; // 乐观更新
  feedbackBusy[id] = true;
  try {
    await api.setMessageFeedback(id, next);
  } catch (e) {
    console.warn('反馈提交失败', e);
    feedbackMap[id] = m.feedback ?? null; // 回滚
  } finally {
    feedbackBusy[id] = false;
  }
}

// ---------------- 语音（浏览器 / 服务端 Edge TTS） ----------------
let serverAudio: HTMLAudioElement | null = null;
const serverPlaying = ref(false);

function speak(m: ChatMessageView) {
  streamSpeakStop(); // 停止可能进行中的流式朗读，避免与整段重播重叠
  if (!m.content) return;
  speakingId.value = m.id;
  if (serverVoice.value) playServerTts(m.content, m.id);
  else speakBrowser(m);
}

function speakBrowser(m: ChatMessageView) {
  cancelSpeech();
  speakingId.value = m.id;
  speakText(m.content, {
    voiceName: selectedVoice.value || undefined,
    onEnd: () => {
      if (speakingId.value === m.id) speakingId.value = '';
    },
    song: isSong(m),
  });
}

async function playServerTts(text: string, id: string) {
  try {
    // 逐句 WebAudio 播放：更连贯、可中断；任一节失败自动回退 new Audio(url)
    await playServerTtsSentences(text, {
      onSentenceStart: () => {
        serverPlaying.value = true;
      },
      onEnd: () => {
        serverPlaying.value = false;
        if (speakingId.value === id) speakingId.value = '';
      },
      onError: () => {
        serverPlaying.value = false;
        if (speakingId.value === id) speakingId.value = '';
        // 整段失败，回退浏览器端语音
        speakBrowser({ id, content: text, role: 'ASSISTANT', createdAt: new Date().toISOString() } as ChatMessageView);
      },
    });
  } catch (e) {
    console.warn('服务端语音失败，回退浏览器', e);
    speakBrowser({ id, content: text, role: 'ASSISTANT', createdAt: new Date().toISOString() } as ChatMessageView);
  }
}

function cancelServerAudio() {
  // 中断逐句播放（立即停止当前音频源）
  stopServerTts();
  if (serverAudio) {
    try {
      serverAudio.pause();
    } catch {
      /* ignore */
    }
    serverAudio = null;
  }
  serverPlaying.value = false;
}

function onServerVoiceChange() {
  localStorage.setItem('sp_server_voice', serverVoice.value ? '1' : '0');
  if (!serverVoice.value) cancelServerAudio();
}

function toggleSpeak(m: ChatMessageView) {
  if (speakingId.value === m.id) {
    streamSpeakStop();
    if (serverVoice.value) cancelServerAudio();
    else cancelSpeech();
    speakingId.value = '';
  } else {
    speak(m);
  }
}

function toggleMic() {
  if (listening.value) {
    // 用户主动停
    stopMic?.();
    listening.value = false;
    stopMic = null;
    return;
  }
  // 启动连续模式，由用户点击停止
  const stop = startListening(
    (text) => {
      input.value = text;
    },
    (msg) => {
      if (msg === 'ended') {
        listening.value = false;
        stopMic = null;
      }
    },
    { continuous: true },
  );
  if (!stop) {
    alert('当前浏览器不支持语音识别，请手动输入。');
    return;
  }
  stopMic = stop;
  listening.value = true;
}

async function switchProvider(p: string) {
  try {
    const res = await api.setLlmProvider(p as any);
    llmProvider.value = res.data.provider;
    providers.value = res.data.available;
  } catch (e) {
    console.warn('切换引擎失败', e);
  }
}

async function endSession() {
  if (!sessionId.value) {
    router.replace('/student/dashboard');
    return;
  }
  try {
    await api.endChat(sessionId.value, '学生主动结束');
  } catch (e) {
    console.warn('结束会话失败', e);
  }
  streamSpeakStop();
  cancelSpeech();
  cancelServerAudio();
  router.replace('/student/dashboard');
}

onMounted(init);
onBeforeUnmount(() => {
  streamSpeakStop();
  cancelSpeech();
  cancelServerAudio();
  stopMic?.();
  sock.disconnect();
});
</script>

<style scoped>
/* 聊天背景图：左右装饰星宝角 + 中央暖色光晕，保证聊天泡清晰 */
.chat-with-bg {
  position: relative;
  flex-direction: column;
  align-items: stretch;
  background-size: cover !important;
  background-position: center !important;
  background-attachment: fixed;
  background-repeat: no-repeat;
  overflow: hidden;
}
.chat-bg-overlay {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  /* 中间暖色光晕，让聊天区在视觉上"浮"出来 */
  background:
    radial-gradient(ellipse at 50% 55%,
      rgba(255, 250, 240, 0.45) 0%,
      rgba(255, 240, 220, 0.25) 35%,
      rgba(180, 130, 200, 0.35) 80%);
}
/* 星宝角标：左下角半透明显示，呼应背景中的星宝靠垫 */
.chat-deco-star {
  position: fixed;
  left: 24px;
  bottom: 24px;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  object-fit: cover;
  opacity: 0.55;
  z-index: 0;
  pointer-events: none;
  filter: drop-shadow(0 4px 14px rgba(255, 180, 100, 0.4));
  animation: starBob 6s ease-in-out infinite;
}
@keyframes starBob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
.chat-card {
  background: rgba(255, 252, 248, 0.92) !important;
  backdrop-filter: blur(8px);
  box-shadow: 0 16px 48px rgba(120, 70, 160, 0.22);
  width: 760px;
  max-width: 96%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  height: 86vh;
  padding: 14px 18px 18px;
}
.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid #fbe7d2;
}
.chat-head-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.chat-head-right {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.chat-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffd6a5, #ffadad);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  box-shadow: 0 2px 8px rgba(255, 158, 87, 0.25);
}
.chat-title { margin: 0; font-size: 20px; }
.chat-sub { margin: 2px 0 0; }
.chk {
  font-size: 12px;
  color: #8b6239;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #fff5ea;
  border-radius: 8px;
  padding: 4px 8px;
}
.btn-mini {
  min-height: 32px;
  padding: 4px 10px;
  font-size: 13px;
}
.chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 14px 6px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: linear-gradient(180deg, #fff7f0 0%, #fff 60%);
  border-radius: 14px;
  margin-top: 12px;
}
.row { display: flex; width: 100%; }
.row.left { justify-content: flex-start; }
.row.right { justify-content: flex-end; }
.bubble {
  max-width: 78%;
  padding: 11px 14px;
  border-radius: 18px;
  font-size: 15px;
  line-height: 1.6;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  word-break: break-word;
}
.bubble.ASSISTANT,
.bubble.SYSTEM,
.bubble.SCRIPT {
  background: #fff;
  border-bottom-left-radius: 4px;
  border: 1px solid #fde6cf;
}
.bubble.USER {
  background: linear-gradient(135deg, #ffd9a8, #ffc28a);
  border-bottom-right-radius: 4px;
  color: #5b3a14;
}
.caret {
  display: inline-block;
  margin-right: 2px;
  color: #ff8a3d;
  animation: blink 0.8s steps(1) infinite;
}
@keyframes blink { 50% { opacity: 0; } }
.bubble-tech {
  margin-top: 6px;
  font-size: 12px;
  color: #b06a2c;
}
.speak-btn {
  margin-top: 8px;
  border: none;
  background: #ffe2c2;
  color: #9a5a1f;
  border-radius: 10px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.speak-btn:hover { background: #ffd0a3; }
.speak-btn.active {
  background: #ff9e57;
  color: #fff;
}
.fb { display: flex; gap: 6px; margin-top: 8px; }
.fb-btn {
  border: 1px solid #eee;
  background: #fff;
  border-radius: 10px;
  padding: 2px 10px;
  font-size: 14px;
  cursor: pointer;
  line-height: 1.4;
}
.fb-btn:hover { background: #fff3ea; }
.fb-btn.active { background: #ffe2c2; border-color: #ff9e57; }
.fb-btn:disabled { opacity: .5; cursor: not-allowed; }
.chat-inputbar {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  align-items: flex-end;
}
.chat-textarea-wrap {
  flex: 1;
  position: relative;
}
.chat-input {
  width: 100%;
  resize: none;
  border: 1px solid #f0d3b3;
  border-radius: 14px;
  padding: 12px 14px;
  font-size: 15px;
  outline: none;
  font-family: inherit;
  background: #fff;
  box-sizing: border-box;
}
.chat-input:focus { border-color: #ff9e57; }
.rec-pulse {
  position: absolute;
  top: 12px;
  right: 14px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ff4d4d;
  box-shadow: 0 0 0 0 rgba(255, 77, 77, 0.7);
  animation: pulse-ring 1.4s infinite;
}
@keyframes pulse-ring {
  0% { box-shadow: 0 0 0 0 rgba(255, 77, 77, 0.6); }
  70% { box-shadow: 0 0 0 10px rgba(255, 77, 77, 0); }
  100% { box-shadow: 0 0 0 0 rgba(255, 77, 77, 0); }
}
.mic {
  font-size: 22px;
  width: 52px;
  height: 52px;
  padding: 0;
  border-radius: 14px;
}
.mic.recording {
  background: #ff4d4d;
  color: #fff;
  border-color: #ff4d4d;
}
.btn-send {
  height: 52px;
  padding: 0 22px;
  font-size: 15px;
}
.chat-foot { margin: 8px 0 0; text-align: center; }
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: 4px;
}
.dot.ok { background: #3aa757; }
.dot.warn { background: #e0a000; }
.mini-select {
  border: 1px solid #f0d3b3;
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 12px;
  background: #fff;
  max-width: 180px;
}
</style>