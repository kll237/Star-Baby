import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MediaEngine } from './tts.service';

/**
 * ASR（语音识别）服务。
 * - browser（默认）：由前端 Web Speech API（SpeechRecognition）完成，零服务端依赖。
 * - server：预留对接云端语音识别网关（如 Azure / 讯飞）。未配置时标记不可用，由前端兜底。
 *
 * 说明：儿童语音识别对隐私与延迟敏感，默认走浏览器端；服务端仅在显式配置网关后启用。
 */
@Injectable()
export class AsrService {
  private engine: MediaEngine;

  constructor(config: ConfigService) {
    this.engine = config.get<string>('asr.engine') === 'server' ? 'server' : 'browser';
  }

  getEngine(): MediaEngine {
    return this.engine;
  }

  /** 服务端是否具备 ASR 能力（浏览器端无需此判断，直接本地识别）。 */
  isServerAvailable(): boolean {
    return this.engine === 'server' && !!process.env.ASR_ENDPOINT;
  }
}
