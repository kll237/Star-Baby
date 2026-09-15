import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  COMFORT_SCRIPTS,
} from './chat.scripts';
import {
  ruleReply,
  buildSystemPrompt,
  detectIntent,
  generateStory,
  generateSong,
  conversationalReply,
  crisisReply,
  type ComfortContext,
} from './chat.util';
import type { LlmRequest, LlmReply, LlmProviderPort } from './llm.service';

/**
 * 智谱 BigModel 接入（GLM-4-Flash 免费 + 流式）。
 *
 * - Endpoint: https://open.bigmodel.cn/api/paas/v4/chat/completions
 * - Model:    glm-4-flash（默认；可在 .env 用 LLM_MODEL=glm-4-air / glm-4-plus 切换）
 * - Auth:     Authorization: Bearer <ZHIPU_API_KEY>
 *
 * 流式响应遵循 OpenAI SSE 协议：每行 "data: {...}"，delta.content 即新 token，
 * 收到 "data: [DONE]" 表示结束。
 *
 * 未配置 ZHIPU_API_KEY 时自动降级到规则引擎（保持系统始终可运行）。
 */
@Injectable()
export class ZhipuLlmService implements LlmProviderPort {
  readonly provider = 'ZHIPU' as const;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly logger = new Logger(ZhipuLlmService.name);

  constructor(config: ConfigService) {
    // 同时支持 LLM_API_KEY（与 OpenAI 复用）和 ZHIPU_API_KEY 两个变量名
    this.apiKey =
      config.get<string>('zhipu.apiKey') ||
      config.get<string>('ZHIPU_API_KEY') ||
      config.get<string>('llm.apiKey');
    this.baseUrl = (
      config.get<string>('zhipu.baseUrl') ||
      'https://open.bigmodel.cn/api/paas/v4'
    ).replace(/\/$/, '');
    this.model =
      config.get<string>('ZHIPU_MODEL') ||
      config.get<string>('zhipu.model') ||
      'glm-4-flash';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * 非流式回复（兼容旧接口）。实现内部其实就是先调一次非流式并 await 完整结果。
   * 但更推荐使用 replyStream 走 WebSocket。
   */
  async reply(req: LlmRequest): Promise<LlmReply> {
    const lastUser = req.history.filter((m) => m.role === 'user').slice(-1)[0]?.content || '';
    if (!this.apiKey) {
      return this.fallback(lastUser, req.context, { provider: 'ZHIPU', fallback: true });
    }
    const messages = this.buildMessages(req);
    try {
      const resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.7,
          max_tokens: 600,
          stream: false,
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`Zhipu HTTP ${resp.status}: ${txt.slice(0, 200)}`);
      }
      const data: any = await resp.json();
      const content: string = data?.choices?.[0]?.message?.content?.trim() || '';
      if (!content) throw new Error('Zhipu empty response');
      return { content, provider: 'ZHIPU', model: this.model };
    } catch (err) {
      this.logger.warn(`智谱调用失败，降级规则引擎：${(err as Error).message}`);
      return this.fallback(lastUser, req.context, { provider: 'ZHIPU', fallback: true });
    }
  }

  /**
   * 真实流式回复（SSE）。每个 yield 是一段 delta 文本。
   * 未配置 key 时直接 yield 整段降级文本（让调用方无感知）。
   */
  async *replyStream(req: LlmRequest): AsyncGenerator<string, void, void> {
    const lastUser = req.history.filter((m) => m.role === 'user').slice(-1)[0]?.content || '';
    if (!this.apiKey) {
      const fb = this.fallback(lastUser, req.context, { provider: 'ZHIPU', fallback: true });
      // 把降级文本拆成小段输出，保持流式手感
      const text = fb.content;
      for (let i = 0; i < text.length; i += 4) {
        yield text.slice(i, i + 4);
        await sleep(40);
      }
      return;
    }
    const messages = this.buildMessages(req);
    let resp: Response;
    try {
      resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.7,
          max_tokens: 600,
          stream: true,
        }),
      });
    } catch (err) {
      this.logger.warn(`智谱连接失败：${(err as Error).message}`);
      const fb = this.fallback(lastUser, req.context, { provider: 'ZHIPU', fallback: true });
      yield fb.content;
      return;
    }

    if (!resp.ok || !resp.body) {
      const txt = await resp.text().catch(() => '');
      this.logger.warn(`智谱 HTTP ${resp.status}: ${txt.slice(0, 200)}`);
      const fb = this.fallback(lastUser, req.context, { provider: 'ZHIPU', fallback: true });
      yield fb.content;
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 按行切分
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        if (!payload) continue;
        try {
          const obj = JSON.parse(payload);
          const delta = obj?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) yield delta;
        } catch {
          /* ignore parse error */
        }
      }
    }
  }

  // ---------------- 私有 ----------------

  private buildMessages(req: LlmRequest) {
    return [
      { role: 'system', content: buildSystemPrompt(req.context) },
      ...req.history.slice(-12),
    ];
  }

  /** 统一降级（crisis > restory/resong > conversational > ruleReply）。 */
  private fallback(lastUser: string, ctx: ComfortContext, base: Pick<LlmReply, 'provider' | 'fallback'>): LlmReply {
    const crisis = crisisReply(lastUser, ctx);
    if (crisis) {
      return { content: crisis.content, technique: crisis.technique, category: 'CRISIS', ...base };
    }
    const intent = ctx.intent || detectIntent(lastUser);
    if (intent === 'story' || intent === 'restory') {
      return {
        content: generateStory(ctx.profile, ctx.studentName, ctx.recentStorySignatures),
        technique: 'STORY',
        category: 'DISTRACTION',
        ...base,
      };
    }
    if (intent === 'song' || intent === 'resong') {
      return {
        content: generateSong(ctx.profile, ctx.studentName),
        technique: 'SONG',
        category: 'DISTRACTION',
        ...base,
      };
    }
    const conv = conversationalReply(lastUser, ctx);
    if (conv) {
      return { content: conv.content, category: 'CONVERSATION', ...base };
    }
    const r = ruleReply(COMFORT_SCRIPTS, ctx);
    return { ...r, ...base };
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}