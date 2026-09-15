import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { COMFORT_SCRIPTS } from './chat.scripts';
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
import { normalizeLlmProvider, ALL_LLM_PROVIDERS } from './chat.taxonomy';
import { ZhipuLlmService } from './zhipu-llm.service';

export type LlmProviderName = 'RULE' | 'MOCK' | 'OPENAI' | 'ZHIPU';

export interface LlmMessage {
  role: 'system' | 'assistant' | 'user';
  content: string;
}

export interface LlmRequest {
  studentName?: string;
  emotionKey?: string;
  negative?: boolean;
  compositeScore?: number;
  history: LlmMessage[];
  context: ComfortContext;
}

export interface LlmReply {
  content: string;
  technique?: string;
  category?: string;
  /** 命中的话术库条目 id（规则引擎命中时存在） */
  scriptId?: string;
  provider: LlmProviderName;
  model?: string;
  /** 是否为降级回复（如 LLM 未配置或调用失败，回退到规则话术库） */
  fallback?: boolean;
}

/**
 * LLM 提供方统一接口，便于「可切换」与「流式」。
 * - reply：完整回复（兼容老接口）
 * - replyStream：逐 token / 逐段 yield（用于 WebSocket 实时输出）
 */
export interface LlmProviderPort {
  readonly provider: LlmProviderName;
  isConfigured(): boolean;
  reply(req: LlmRequest): Promise<LlmReply>;
  replyStream(req: LlmRequest): AsyncGenerator<string, void, void>;
}

/** 规则 / 话术库引擎：无需任何外部 API，默认启用，保证系统始终可运行。 */
export class RuleLlmService implements LlmProviderPort {
  readonly provider = 'RULE' as const;
  isConfigured(): boolean {
    return true;
  }
  async reply(req: LlmRequest): Promise<LlmReply> {
    const lastUser = req.history.filter((m) => m.role === 'user').slice(-1)[0]?.content || '';

    // 1) 危机关键词优先：必须给出长篇、针对的共情 + 求助指引
    const crisis = crisisReply(lastUser, req.context);
    if (crisis) {
      return { content: crisis.content, technique: crisis.technique, category: 'CRISIS', provider: 'RULE', fallback: false };
    }

    // 2) 故事 / 歌曲（包含 restory/resong 重新生成版本）
    const intent = req.context.intent || detectIntent(lastUser);
    if (intent === 'story' || intent === 'restory') {
      const s = generateStory(req.context.profile, req.studentName, req.context.recentStorySignatures);
      return { content: s, technique: 'STORY', category: 'DISTRACTION', provider: 'RULE', fallback: false };
    }
    if (intent === 'song' || intent === 'resong') {
      const s = generateSong(req.context.profile, req.studentName);
      return { content: s, technique: 'SONG', category: 'DISTRACTION', provider: 'RULE', fallback: false };
    }

    // 3) 对话式（greeting/intro/feeling/joke/play）
    const conv = conversationalReply(lastUser, req.context);
    if (conv) {
      return { content: conv.content, category: 'CONVERSATION', provider: 'RULE', fallback: false };
    }
    // 4) 否则走安抚话术（负向情绪 / 默认兜底）
    const r = ruleReply(COMFORT_SCRIPTS, req.context);
    return { ...r, provider: 'RULE', fallback: false };
  }

  /**
   * 规则引擎的"流式"：先生成完整回复，再按 4 字/段 yield，
   * 保持学生端气泡逐字出现的手感（≥2 字/40ms 看起来像实时输出）。
   */
  async *replyStream(req: LlmRequest): AsyncGenerator<string, void, void> {
    const r = await this.reply(req);
    const text = r.content || '';
    for (let i = 0; i < text.length; i += 4) {
      yield text.slice(i, i + 4);
      await new Promise((res) => setTimeout(res, 40));
    }
  }
}

/** 测试 / 演示桩：返回稳定可预测的安抚语，不调用任何外部服务。 */
export class MockLlmService implements LlmProviderPort {
  readonly provider = 'MOCK' as const;
  isConfigured(): boolean {
    return true;
  }
  async reply(req: LlmRequest): Promise<LlmReply> {
    const lastUser = req.history.filter((m) => m.role === 'user').slice(-1)[0]?.content || '';

    const crisis = crisisReply(lastUser, req.context);
    if (crisis) {
      return { content: crisis.content, technique: crisis.technique, category: 'CRISIS', provider: 'MOCK', fallback: false };
    }
    const intent = req.context.intent || detectIntent(lastUser);
    if (intent === 'story' || intent === 'restory') {
      const s = generateStory(req.context.profile, req.studentName, req.context.recentStorySignatures);
      return { content: s, technique: 'STORY', category: 'DISTRACTION', provider: 'MOCK', fallback: false };
    }
    if (intent === 'song' || intent === 'resong') {
      const s = generateSong(req.context.profile, req.studentName);
      return { content: s, technique: 'SONG', category: 'DISTRACTION', provider: 'MOCK', fallback: false };
    }

    const conv = conversationalReply(lastUser, req.context);
    if (conv) {
      return { content: conv.content, category: 'CONVERSATION', provider: 'MOCK', fallback: false };
    }
    const name = req.studentName || '小朋友';
    return {
      content: `${name}，我听到你了。我们一起慢慢来，好吗？`,
      provider: 'MOCK',
      fallback: false,
    };
  }

  async *replyStream(req: LlmRequest): AsyncGenerator<string, void, void> {
    const r = await this.reply(req);
    const text = r.content || '';
    for (let i = 0; i < text.length; i += 4) {
      yield text.slice(i, i + 4);
      await new Promise((res) => setTimeout(res, 50));
    }
  }
}

/**
 * OpenAI 兼容接口（Chat Completions）。未配置 apiKey 时自动降级到规则引擎。
 * 主要用于 LLM_BASE_URL 配置为 OpenAI、DeepSeek、Mistral、硅基流动等兼容 OpenAI 的服务。
 */
export class OpenAiLlmService implements LlmProviderPort {
  readonly provider = 'OPENAI' as const;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly logger = new Logger(OpenAiLlmService.name);

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('llm.baseUrl') || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.apiKey = config.get<string>('llm.apiKey');
    this.model = config.get<string>('llm.model') || 'gpt-4o-mini';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async reply(req: LlmRequest): Promise<LlmReply> {
    const lastUser = req.history.filter((m) => m.role === 'user').slice(-1)[0]?.content || '';

    if (!this.apiKey) {
      return this.fallback(lastUser, req.context, { provider: 'OPENAI', fallback: true });
    }
    const messages = [
      { role: 'system', content: buildSystemPrompt(req.context) },
      ...req.history.slice(-12),
    ];
    try {
      const resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, messages, temperature: 0.7, max_tokens: 600 }),
      });
      if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);
      const data: any = await resp.json();
      const content: string = data?.choices?.[0]?.message?.content?.trim() || '';
      if (!content) throw new Error('LLM empty response');
      return { content, provider: 'OPENAI', model: this.model };
    } catch (err) {
      this.logger.warn(`OpenAI 调用失败，降级规则引擎：${(err as Error).message}`);
      return this.fallback(lastUser, req.context, { provider: 'OPENAI', fallback: true });
    }
  }

  async *replyStream(req: LlmRequest): AsyncGenerator<string, void, void> {
    const lastUser = req.history.filter((m) => m.role === 'user').slice(-1)[0]?.content || '';
    if (!this.apiKey) {
      const fb = await this.fallback(lastUser, req.context, { provider: 'OPENAI', fallback: true });
      for (let i = 0; i < fb.content.length; i += 4) {
        yield fb.content.slice(i, i + 4);
        await new Promise((res) => setTimeout(res, 40));
      }
      return;
    }
    const messages = [
      { role: 'system', content: buildSystemPrompt(req.context) },
      ...req.history.slice(-12),
    ];
    let resp: Response;
    try {
      resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, messages, temperature: 0.7, max_tokens: 600, stream: true }),
      });
    } catch (err) {
      this.logger.warn(`OpenAI 流式连接失败：${(err as Error).message}`);
      const fb = await this.fallback(lastUser, req.context, { provider: 'OPENAI', fallback: true });
      yield fb.content;
      return;
    }
    if (!resp.ok || !resp.body) {
      const fb = await this.fallback(lastUser, req.context, { provider: 'OPENAI', fallback: true });
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
          /* ignore */
        }
      }
    }
  }

  private async fallback(
    lastUser: string,
    ctx: ComfortContext,
    base: Pick<LlmReply, 'provider' | 'fallback'>,
  ): Promise<LlmReply> {
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

/**
 * 可切换 LLM 服务：持有四种提供方实例，运行期可在 RULE / MOCK / OPENAI / ZHIPU 间切换。
 * 默认按配置 llm.provider / LLM_PROVIDER 选择；缺省为 RULE（话术库），保证零依赖可运行。
 */
@Injectable()
export class LlmService {
  private readonly rule = new RuleLlmService();
  private readonly mock = new MockLlmService();
  private readonly openai: OpenAiLlmService;
  private readonly zhipu: ZhipuLlmService;
  private current: LlmProviderPort;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAiLlmService(config);
    this.zhipu = new ZhipuLlmService(config);
    const initial = normalizeLlmProvider(
      this.config.get<string>('llm.provider') ||
        this.config.get<string>('LLM_PROVIDER'),
    );
    this.current = this.pick(initial);
    // 如果没配 OPENAI 但配了 ZHIPU_API_KEY，自动切到 ZHIPU
    if (
      !this.openai.isConfigured() &&
      this.zhipu.isConfigured() &&
      (initial === 'RULE' || initial === 'MOCK')
    ) {
      this.logger.log('检测到 ZHIPU_API_KEY，自动启用智谱 GLM-4-Flash 作为默认引擎');
      this.current = this.zhipu;
    }
  }

  private readonly logger = new Logger(LlmService.name);

  private pick(name: LlmProviderName): LlmProviderPort {
    switch (name) {
      case 'ZHIPU':
        return this.zhipu;
      case 'OPENAI':
        return this.openai;
      case 'MOCK':
        return this.mock;
      default:
        return this.rule;
    }
  }

  get provider(): LlmProviderName {
    return this.current.provider;
  }

  isConfigured(): boolean {
    return this.current.isConfigured();
  }

  /** 运行期切换提供方（满足「LLM 可切换」需求）。 */
  setProvider(name: LlmProviderName): void {
    this.current = this.pick(name);
    this.logger.log(`LLM 提供方已切换为 ${name}（configured=${this.current.isConfigured()}）`);
  }

  reply(req: LlmRequest): Promise<LlmReply> {
    return this.current.reply(req);
  }

  replyStream(req: LlmRequest): AsyncGenerator<string, void, void> {
    return this.current.replyStream(req);
  }

  status() {
    return {
      provider: this.current.provider,
      configured: this.current.isConfigured(),
      available: [...ALL_LLM_PROVIDERS] as LlmProviderName[],
    };
  }
}