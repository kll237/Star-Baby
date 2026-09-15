import { io, Socket } from 'socket.io-client';
import api from '@/api';
import type { ChatMessageView, ChatSessionView } from '@/api/types';

/**
 * 智能安抚对话 WebSocket 客户端（命名空间 /chat）。
 */
export interface ReplyPayload {
  sessionId: string;
  studentId: string;
  userMessage: ChatMessageView;
  assistantMessage: ChatMessageView;
  tts: { engine: string };
  provider?: string;
}

export interface SessionStartedPayload {
  session: ChatSessionView;
  messages: ChatMessageView[];
}

export interface UserEchoPayload {
  sessionId: string;
  studentId: string;
  userMessage?: ChatMessageView;
}

export interface ReplyChunkPayload {
  sessionId: string;
  studentId: string;
  delta: string;
  done: boolean;
}

export class ComfortChatSocket {
  private socket: Socket | null = null;

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io('/chat', {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
      });
      this.socket.on('connect', () => resolve());
      this.socket.on('connect_error', (err) => reject(err));
      this.socket.on('ready', () => resolve());
    });
  }

  onReply(cb: (p: ReplyPayload) => void) {
    this.socket?.on('reply', cb);
  }

  onSessionStarted(cb: (p: SessionStartedPayload) => void) {
    this.socket?.on('session_started', cb);
  }

  onUserEcho(cb: (p: UserEchoPayload) => void) {
    this.socket?.on('user_echo', cb);
  }

  onReplyChunk(cb: (p: ReplyChunkPayload) => void) {
    this.socket?.on('reply_chunk', cb);
  }

  sendMessage(payload: { sessionId?: string; studentId?: string; content: string }) {
    this.socket?.emit('message', payload);
  }

  sendTrigger(payload: { studentId: string; emotionKey?: string; compositeScore?: number; dominantScore?: number }) {
    this.socket?.emit('trigger', payload);
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}

// ---------------- TTS（浏览器端 Web Speech API） ----------------
type SpeechSynthesisWindow = Window & { speechSynthesis?: SpeechSynthesis; webkitSpeechSynthesis?: SpeechSynthesis };

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  voiceName?: string;
  onEnd?: () => void;
  /** 歌词模式：使用单 utterance + 内部停顿，读起来连贯通顺，更像哼唱。 */
  song?: boolean;
  /** 歌词模式下整体速度倍率（默认 0.78）。 */
  songRate?: number;
}

/** 列出浏览器可用的中文声线（含童声）。 */
export function getChineseVoices(): SpeechSynthesisVoice[] {
  const w = window as SpeechSynthesisWindow;
  const synth = w.speechSynthesis || w.webkitSpeechSynthesis;
  if (!synth) return [];
  return synth.getVoices().filter((v) =>
    /zh|Chinese|中文|Yue|Cantonese|Mandarin/i.test(v.lang) ||
    /chinese|中文|Mandarin|Cantonese|Yaoyao|Yue|Xiaoxiao|Ting|Han|Mei|child|童/i.test(v.name),
  );
}

/** 简易"歌声"判断：内容含 ♪ 或每行长度短/押韵。 */
export function looksLikeSong(text: string): boolean {
  if (!text) return false;
  if (/♪|♫|♬|🎵|🎶/.test(text)) return true;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 3 && lines.every((l) => l.length <= 14)) return true;
  return false;
}

/**
 * 会话令牌（每次 speak/cancel 自增）。所有 in-flight 的 onend/onstart 回调
 * 拿创建时的 token 与当前 token 对比，不匹配就放弃执行 —— 这是"点击停止后还在读"
 * 的根本解决办法：合成接口 cancel 后仍有 onend 顺势触发下一段被它阻止。
 */
let _speakSession = 0;

/**
 * 朗读文本。
 * - 默认温柔女声/童声，rate 0.95、pitch 1.05（不破音）
 * - song=true 时使用单 utterance + 内部 `，` `——` `…` 自然停顿，避免被拆成多段造成顿挫
 *   · pitch 在 1.0~1.12 之间轻微波动，绝不超过 1.2 以防破音
 *   · rate 0.78（比对话更慢，模拟哼唱）
 *   · 优先挑选童声/女声
 *   【技术限制】浏览器 Web Speech API 没有真实歌声合成（SVS），这里通过 pitch + 节奏
 *   模拟"哼唱感"；听感会比直接朗读更接近歌声，但无法做到歌手级音色与专业编曲。
 */
export function speakText(text: string, opts?: SpeakOptions): boolean {
  const w = window as SpeechSynthesisWindow;
  const synth = w.speechSynthesis || w.webkitSpeechSynthesis;
  if (!synth) return false;
  try {
    _speakSession += 1;
    const mySession = _speakSession;
    synth.cancel();
    // 让浏览器把上一个队列清掉，再准备新的
    setTimeout(() => {
      if (mySession !== _speakSession) return; // 期间被取消了
      if (opts?.song) return speakAsSong(text, mySession, opts);
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      utter.rate = opts?.rate ?? 0.95;
      utter.pitch = opts?.pitch ?? 1.05;
      const voice = pickVoice(opts?.voiceName);
      if (voice) utter.voice = voice;
      utter.onend = () => {
        if (mySession !== _speakSession) return;
        opts?.onEnd?.();
      };
      utter.onerror = () => {
        if (mySession !== _speakSession) return;
        opts?.onEnd?.();
      };
      synth.speak(utter);
    }, 30);
    return true;
  } catch {
    return false;
  }
}

/**
 * "哼唱"模式：把歌词去符号后用中文标点 `，` `——` `…` `。` 重新拼接为**单个**
 * `SpeechSynthesisUtterance`。这样浏览器引擎内部按标点自然断句、连续合成，
 * 听感像一段连贯的音乐，而不是一段一段拼起来的朗读。
 *
 * pitch 0.95~1.12 窄幅波动（避免破音），rate 0.78 模拟哼唱速度。
 */
function speakAsSong(text: string, session: number, opts?: SpeakOptions): boolean {
  const w = window as SpeechSynthesisWindow;
  const synth = w.speechSynthesis || w.webkitSpeechSynthesis;
  if (!synth) return false;
  if (session !== _speakSession) return false;

  const voice = pickVoice(opts?.voiceName);
  // 清洗：去除音乐符号与换行，保留中文标点（`，` `。` `；` `——` `…`）作为内部停顿
  const cleaned = text
    .replace(/[♪♫♬🎵🎶]/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('，');
  if (!cleaned) return false;

  const utter = new SpeechSynthesisUtterance(cleaned);
  utter.lang = 'zh-CN';
  utter.rate = opts?.songRate ?? 0.78;
  utter.pitch = 1.05;
  if (voice) utter.voice = voice;
  // Chrome 的 pitch 在 1.0~1.2 是听感甜区；过高会变调破音
  utter.onend = () => {
    if (session !== _speakSession) return;
    opts?.onEnd?.();
  };
  utter.onerror = () => {
    if (session !== _speakSession) return;
    opts?.onEnd?.();
  };
  synth.speak(utter);
  return true;
}

function pickVoice(name?: string): SpeechSynthesisVoice | null {
  const w = window as SpeechSynthesisWindow;
  const synth = w.speechSynthesis || w.webkitSpeechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices();
  if (name) {
    const exact = voices.find((v) => v.name === name);
    if (exact) return exact;
  }
  // 童声 / 女声 / 童 优先
  const prefer = voices.find((v) =>
    /zh|Chinese|中文/i.test(v.lang) &&
    /(child|童|xiaoxiao|Xiaoxiao|Yaoyao|Yaoyao|Ting|Ting|Mandy|Mei|Female|女|晓晓|瑶瑶|Tingting)/i.test(v.name),
  );
  const anyZh = voices.find((v) => /zh|Chinese|中文/i.test(v.lang));
  return prefer || anyZh || null;
}

/**
 * 取消朗读。会话计数器自增，所有正在飞行的 onend/onstart 检测到不匹配即放弃执行。
 * 这彻底解决"点击暂停以后还一直在读"的问题。
 */
export function cancelSpeech() {
  const w = window as SpeechSynthesisWindow;
  const synth = w.speechSynthesis || w.webkitSpeechSynthesis;
  synth?.cancel();
  // 关键：让所有在飞行的回调在下一次 tick 检测到 token 变更
  _speakSession += 1;
}

// ---------------- 服务端 TTS：逐句 WebAudio 播放 ----------------
/**
 * 逐句服务端语音：把文本按中英文句末标点切成短句，每句分别请求 /api/chat/tts
 * 得到 audioUrl，fetch 为 arraybuffer 后用 AudioContext 解码并顺序播放，听感比整段
 * 一次性播放更连贯、可中断。任意一句 WebAudio 解码/播放失败则回退 `new Audio(url)`，
 * 保证播放永不整体中断。
 */
let _webAudioCtx: AudioContext | null = null;
let _webAudioSource: AudioBufferSourceNode | null = null;
let _webAudioSession = 0; // 每次 stop 自增，飞行中的播放检测到不匹配即放弃

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  if (!_webAudioCtx) {
    try {
      _webAudioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  return _webAudioCtx;
}

/** 按中英文句末标点切句（保留标点，避免拆断语义）。 */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    cur += ch;
    if ('。！？!?.；;'.includes(ch)) {
      const t = cur.trim();
      if (t) out.push(t);
      cur = '';
    }
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out.length ? out : [text];
}

function decodeAndPlay(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ctx = getAudioContext();
    if (!ctx) {
      resolve(false);
      return;
    }
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('tts fetch ' + r.status);
        return r.arrayBuffer();
      })
      .then((buf) => ctx.decodeAudioData(buf))
      .then(
        (audioBuf) =>
          new Promise<void>((res) => {
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            const src = ctx.createBufferSource();
            src.buffer = audioBuf;
            src.connect(ctx.destination);
            _webAudioSource = src;
            src.onended = () => {
              if (_webAudioSource === src) _webAudioSource = null;
              res();
            };
            src.start(0);
          }),
      )
      .then(() => resolve(true))
      .catch(() => resolve(false));
  });
}

function playViaAudioElement(url: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const a = new Audio(url);
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve());
    } catch {
      resolve();
    }
  });
}

export interface ServerTtsOptions {
  onSentenceStart?: (sentence: string, index: number) => void;
  onEnd?: () => void;
  onError?: (e: unknown) => void;
}

/** 逐句播放服务端 TTS；返回 Promise 在全部自然播放完毕（或中断）后 resolve。 */
export async function playServerTtsSentences(text: string, opts?: ServerTtsOptions): Promise<void> {
  const sentences = splitSentences(text);
  const session = ++_webAudioSession;
  try {
    for (let i = 0; i < sentences.length; i++) {
      if (session !== _webAudioSession) return; // 已被 stop()
      const sentence = sentences[i];
      opts?.onSentenceStart?.(sentence, i);
      let ok = false;
      try {
        const res = await api.synthesizeTts(sentence);
        const d = res.data;
        if (session !== _webAudioSession) return;
        if (d.engine === 'server' && d.audioUrl) {
          ok = await decodeAndPlay(d.audioUrl);
          if (session !== _webAudioSession) return;
        }
      } catch {
        ok = false;
      }
      // WebAudio 解码/播放失败 → 回退 new Audio(url) 逐句播放
      if (!ok) {
        try {
          const res = await api.synthesizeTts(sentence);
          if (session !== _webAudioSession) return;
          if (res.data.engine === 'server' && res.data.audioUrl) {
            await playViaAudioElement(res.data.audioUrl);
          }
        } catch {
          /* skip 这一句，继续下一句 */
        }
      }
      if (session !== _webAudioSession) return;
    }
    if (session === _webAudioSession) opts?.onEnd?.();
  } catch (e) {
    opts?.onError?.(e);
  }
}

/** 立即中断逐句播放：停止当前 AudioBufferSource 并令所有飞行回调失效。 */
export function stopServerTts() {
  _webAudioSession += 1;
  try {
    _webAudioSource?.stop();
  } catch {
    /* ignore */
  }
  _webAudioSource = null;
}

// ---------------- 流式逐句朗读（边生成边播放，减小首字延迟、更连贯） ----------------
/**
 * 与"整段生成完才朗读"不同，流式播放器在 LLM 边吐字时，按中英文句末标点把已完成的
 * 短句逐句送入 TTS 并顺序播放：第一句往往在第一句话说完就开声，后续句子与前一段
 * 生成重叠进行，听感明显更连贯、静音间隔更短。
 *
 * 设计要点：
 * - 单一会话计数器 `_ssSession`：仅在「新回复开始(start)」与「主动停止(stop)」时自增，
 *   飞行中的 onend 比对失败即放弃，避免「停止后还一直读」。
 * - 自维护队列 `_ssQueue` + 泵 `_ssPump`：同一时刻只播放一句，上句 onend 触发下一句，
 *   因此浏览器与服务端模式都不需要依赖底层原生队列，停/续完全可控。
 */
let _ssSession = 0;
let _ssVoiceName = '';
let _ssServer = false;
let _ssSong = false;
let _ssOnEnd: (() => void) | null = null;
let _ssQueue: string[] = [];
let _ssBusy = false;
let _ssFinished = false;

/**
 * 保留原文标点，由浏览器/服务端 TTS 自然处理停顿层次：
 * 逗号短停顿、句号稍长停顿（用户要求"句号比逗号稍多一下停顿"，标点不读出字音）。
 */
function _ssSoftEnding(sentence: string): string {
  return sentence.trim();
}

function _ssBrowserPlay(sentence: string, session: number) {
  const w = window as SpeechSynthesisWindow;
  const synth = w.speechSynthesis || w.webkitSpeechSynthesis;
  if (!synth) {
    if (session === _ssSession) {
      _ssBusy = false;
      _ssPump();
    }
    return;
  }
  const utter = new SpeechSynthesisUtterance(_ssSoftEnding(sentence));
  utter.lang = 'zh-CN';
  if (_ssSong) {
    utter.rate = 0.78;
    utter.pitch = 1.05;
  } else {
    utter.rate = 0.95;
    utter.pitch = 1.05;
  }
  const v = pickVoice(_ssVoiceName);
  if (v) utter.voice = v;
  utter.onend = () => {
    if (session !== _ssSession) return;
    _ssBusy = false;
    _ssPump();
  };
  utter.onerror = () => {
    if (session !== _ssSession) return;
    _ssBusy = false;
    _ssPump();
  };
  synth.speak(utter);
}

function _ssPump() {
  if (_ssBusy) return;
  if (_ssQueue.length === 0) {
    if (_ssFinished) {
      const cb = _ssOnEnd;
      _ssOnEnd = null;
      cb?.();
    }
    return;
  }
  const sentence = _ssQueue.shift()!;
  _ssBusy = true;
  const session = _ssSession;
  if (_ssServer) {
    (async () => {
      const fallback = () => {
        if (session !== _ssSession) return;
        _ssBrowserPlay(sentence, session);
      };
      try {
        const res = await api.synthesizeTts(_ssSoftEnding(sentence));
        if (session !== _ssSession) return;
        if (res.data.engine === 'server' && res.data.audioUrl) {
          const ok = await decodeAndPlay(res.data.audioUrl);
          if (session !== _ssSession) return;
          if (ok) {
            _ssBusy = false;
            _ssPump();
          } else fallback();
        } else fallback();
      } catch {
        fallback();
      }
    })();
  } else {
    _ssBrowserPlay(sentence, session);
  }
}

/** 开始一段新回复的流式朗读（作废上一段可能的残留会话）。 */
export function streamSpeakStart(opts: {
  serverVoice?: boolean;
  voiceName?: string;
  song?: boolean;
  onEnd?: () => void;
}) {
  _ssSession += 1;
  _ssVoiceName = opts.voiceName || '';
  _ssServer = !!opts.serverVoice;
  _ssSong = !!opts.song;
  _ssOnEnd = opts.onEnd || null;
  _ssQueue = [];
  _ssBusy = false;
  _ssFinished = false;
}

/** 推入一句已完成的文本（无需句末标点，内部按到达顺序排队播放）。 */
export function streamSpeakPush(sentence: string) {
  if (!sentence || !sentence.trim()) return;
  _ssQueue.push(sentence.trim());
  _ssPump();
}

/** 标记本回复不再有新句；队列自然播放完后触发 onEnd。 */
export function streamSpeakEnd() {
  _ssFinished = true;
  _ssPump();
}

/** 立即停止所有流式朗读（新回复开始 / 用户点停止 / 离开页面时调用）。 */
export function streamSpeakStop() {
  _ssSession += 1;
  _ssQueue = [];
  _ssFinished = false;
  _ssBusy = false;
  const w = window as SpeechSynthesisWindow;
  w.speechSynthesis?.cancel();
  _webAudioSession += 1;
  try {
    _webAudioSource?.stop();
  } catch {
    /* ignore */
  }
  _webAudioSource = null;
}

// ---------------- ASR（浏览器端 Web Speech API） ----------------
type SpeechRecognitionCtor = new () => any;
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};

/**
 * 启动浏览器端语音识别，把识别结果通过回调返回。
 * - 连续模式：用户说完不停，由用户点击"停止"结束
 * - interimResults：边说边返回临时结果
 * 返回停止函数。若浏览器不支持则返回 null。
 */
export function startListening(
  onResult: (text: string, isFinal: boolean) => void,
  onError?: (msg: string) => void,
  opts?: { continuous?: boolean },
): (() => void) | null {
  const w = window as SpeechRecognitionWindow;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'zh-CN';
  rec.interimResults = true;
  rec.continuous = opts?.continuous ?? true;
  rec.onresult = (ev: any) => {
    let text = '';
    let final = false;
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      text += ev.results[i][0].transcript;
      if (ev.results[i].isFinal) final = true;
    }
    onResult(text, final);
  };
  rec.onerror = (ev: any) => onError?.(ev?.error || 'asr-error');
  rec.onend = () => onError?.('ended');
  try {
    rec.start();
  } catch {
    return null;
  }
  return () => rec.stop();
}
