import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type MediaEngine = 'browser' | 'server';

export interface TtsResult {
  /** browser：由前端 Web Speech API 合成；server：返回 audioUrl */
  engine: MediaEngine;
  audioUrl?: string;
  voiceHint?: string;
}

/**
 * TTS 服务。
 * - browser（默认）：不占用服务端资源，前端用 Web Speech API 朗读，兼容性最佳。
 * - server + Edge TTS：调用免费的微软 Edge 在线 TTS（无需 key）生成 mp3，返回 audioUrl；
 *   失败自动回退浏览器，保证任何部署下安抚对话都能「出声」。
 * - server + 自定义网关：向 tts.endpoint POST { text, voice } 取得音频流/URL。
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private engine: MediaEngine;
  private endpoint?: string;
  private apiKey?: string;
  private voiceHint?: string;
  private edgeEnabled = false;
  private cacheDir: string;
  private edgeTTSClass: any = null;

  constructor(config: ConfigService) {
    this.engine = config.get<string>('tts.engine') === 'server' ? 'server' : 'browser';
    this.endpoint = config.get<string>('tts.endpoint');
    this.apiKey = config.get<string>('tts.apiKey');
    this.voiceHint = config.get<string>('tts.voice') || 'zh-CN-XiaoxiaoNeural';
    this.edgeEnabled =
      config.get<string>('tts.edge') === '1' || config.get<string>('TTS_EDGE') === '1';
    this.cacheDir = path.join(process.cwd(), '.tts-cache');
    if (this.engine === 'server' && this.edgeEnabled) {
      try {
        // 延迟加载，避免默认（浏览器）路径下引入 ESM/CJS 解析问题
        const mod: any = require('edge-tts-universal');
        this.edgeTTSClass =
          mod.EdgeTTS || (mod.default && mod.default.EdgeTTS) || mod.default;
        if (!this.edgeTTSClass) throw new Error('EdgeTTS 导出未找到');
      } catch (e) {
        this.logger.warn(`Edge TTS 模块加载失败，将回退浏览器合成：${(e as Error).message}`);
      }
    }
  }

  getEngine(): MediaEngine {
    return this.engine;
  }

  async synthesize(text: string): Promise<TtsResult> {
    if (this.engine !== 'server') {
      return { engine: 'browser', voiceHint: this.voiceHint };
    }

    // 1) Edge TTS（免费，无需 key）
    if (this.edgeEnabled && this.edgeTTSClass) {
      try {
        await fs.promises.mkdir(this.cacheDir, { recursive: true });
        const file = `${crypto.randomBytes(8).toString('hex')}.mp3`;
        const outPath = path.join(this.cacheDir, file);
        const tts = new this.edgeTTSClass(text, this.voiceHint, {
          rate: '+0%',
          // edge-tts-universal 校验 pitch 必须为 `+NHz`/`-NHz` 形式（rate/volume 才用 %）
          pitch: '+0Hz',
          volume: '+0%',
        });
        const result: any = await tts.synthesize();
        const audio: any = result?.audio;
        let buf: Buffer;
        if (Buffer.isBuffer(audio)) {
          buf = audio;
        } else if (audio instanceof ArrayBuffer) {
          buf = Buffer.from(audio);
        } else if (audio && typeof audio.arrayBuffer === 'function') {
          // edge-tts-universal v1.4 返回 Blob（Node 18+ 全局 Blob / undici Blob 均有 arrayBuffer()）
          buf = Buffer.from(await audio.arrayBuffer());
        } else if (typeof audio === 'string') {
          // 某些网关可能返回 base64 字符串
          buf = Buffer.from(audio, 'base64');
        } else {
          throw new Error('未知的音频返回类型');
        }
        await fs.promises.writeFile(outPath, buf);
        return { engine: 'server', audioUrl: `/tts/${file}`, voiceHint: this.voiceHint };
      } catch (err) {
        this.logger.warn(`Edge TTS 合成失败，回退：${(err as Error).message}`);
      }
    }

    // 2) 自定义 TTS 网关
    if (this.endpoint) {
      try {
        const resp = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({ text, voice: this.voiceHint }),
        });
        if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}`);
        const data: any = await resp.json();
        const audioUrl: string | undefined = data?.audioUrl || data?.url;
        if (!audioUrl) throw new Error('TTS no audioUrl');
        return { engine: 'server', audioUrl, voiceHint: this.voiceHint };
      } catch (err) {
        this.logger.warn(`服务端 TTS 失败，回退浏览器合成：${(err as Error).message}`);
      }
    }

    return { engine: 'browser', voiceHint: this.voiceHint };
  }
}
