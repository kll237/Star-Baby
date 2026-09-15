import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  LlmService,
  type LlmProviderName,
  type LlmReply,
} from './llm.service';
import { TtsService } from './tts.service';
import { AsrService } from './asr.service';
import { AlertService } from '../alerts/alerts.service';
import { COMFORT_SCRIPTS } from './chat.scripts';
import {
  ruleReply,
  collectRecentTechniques,
  detectIntent,
  fingerprint,
  crisisReply,
  crisisLevel,
  type ComfortContext,
} from './chat.util';
import { normalizeLlmProvider } from './chat.taxonomy';
import type { StartSessionDto, SendMessageDto, EndSessionDto } from './dto/chat.dto';

export interface ChatMessageView {
  id: string;
  role: string;
  content: string;
  technique?: string | null;
  audioUrl?: string | null;
  feedback?: string | null;
  createdAt: string;
}

export interface SessionView {
  id: string;
  studentId: string;
  triggerEmotion?: string | null;
  triggerSource: string;
  status: string;
  llmProvider: string;
  startedAt: string;
  endedAt?: string | null;
  messageCount: number;
  summary?: string | null;
}

export interface StartResult {
  session: SessionView;
  messages: ChatMessageView[];
}

const HISTORY_LIMIT = 12;
const COOLDOWN_MS_DEFAULT = 5 * 60 * 1000;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: LlmService,
    private readonly tts: TtsService,
    private readonly asr: AsrService,
    private readonly config: ConfigService,
    private readonly alerts: AlertService,
  ) {}

  // ---------------- 会话生命周期 ----------------

  async startSession(operatorUserId: string | null, studentId: string, dto: StartSessionDto): Promise<StartResult> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId }, include: { profile: true } });
    if (!student) throw new NotFoundException('学生不存在');

    const llmProvider = normalizeLlmProvider(dto.llmProvider || this.llm.provider);
    const session = await this.prisma.chatSession.create({
      data: {
        studentId,
        triggerEmotion: dto.triggerEmotion ?? null,
        triggerSource: dto.triggerSource ?? 'MANUAL',
        llmProvider,
      },
    });

    const messages: ChatMessageView[] = [];
    // 系统开场白
    const sys = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        studentId,
        role: 'SYSTEM',
        content: '星宝已上线，陪你聊聊天、放松一下～',
      },
    });
    messages.push(this.toView(sys));

    // 若由情绪触发，自动给出首条安抚（否则温和询问，结合学生画像）
    const firstCtx: ComfortContext = {
      emotionKey: dto.triggerEmotion,
      negative: dto.triggerSource === 'DETECTION',
      studentName: student.name,
      profile: student.profile ?? null,
      turnCount: 0,
    };
    let opener: { content: string; technique?: string; category?: string; scriptId?: string };
    if (dto.triggerEmotion) {
      opener = this.ruleReplyFor(firstCtx);
    } else {
      const like = student.profile?.likes?.[0] || student.profile?.hobbies?.[0];
      const content = like
        ? `${student.name}，你喜欢${like}对不对？今天还好吗？想和星宝说点什么、或者听个故事唱首歌都可以哦。`
        : `${student.name}，今天还好吗？想和星宝说点什么都可以哦。`;
      opener = { content, technique: undefined, category: undefined, scriptId: undefined };
    }

    const assistant = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        studentId,
        role: 'ASSISTANT',
        content: opener.content,
        technique: opener.technique ?? null,
        scriptId: opener.scriptId ?? null,
      },
    });
    messages.push(this.toView(assistant));

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: { messageCount: 2 },
    });

    await this.audit.log({
      userId: operatorUserId ?? undefined,
      action: 'chat.session.start',
      resource: 'ChatSession',
      detail: { sessionId: session.id, studentId, operatorUserId, trigger: dto.triggerSource, emotion: dto.triggerEmotion },
    });

    return { session: this.toSessionView(session), messages };
  }

  async sendMessage(
    studentId: string,
    sessionId: string,
    dto: SendMessageDto,
  ): Promise<{ userMessage: ChatMessageView; assistantMessage: ChatMessageView; tts: { engine: string } }> {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.studentId !== studentId) throw new ForbiddenException('无权操作该会话');
    if (session.status === 'ENDED') throw new BadRequestException('会话已结束');

    const student = await this.prisma.student.findUnique({ where: { id: studentId }, include: { profile: true } });

    const userMsg = await this.prisma.chatMessage.create({
      data: { sessionId, studentId, role: 'USER', content: dto.content },
    });

    // 组装上下文：历史消息 + 近期技术 + 轮次 + 学生画像 + 意图
    const prev = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    });
    const history = prev
      .reverse()
      .map((m) => ({
        role: (m.role === 'USER' ? 'user' : m.role === 'SYSTEM' ? 'system' : 'assistant') as
          | 'user'
          | 'system'
          | 'assistant',
        content: m.content,
      }));

    const assistantMsgs = prev.filter((m) => m.role === 'ASSISTANT');
    const recentTechniques = collectRecentTechniques(
      assistantMsgs.map((m) => m.technique),
      4,
    );

    // 已讲过的故事签名（避免再次讲同一篇）
    const recentStorySignatures = collectRecentTechniques(
      assistantMsgs
        .filter((m) => m.technique === 'STORY')
        .map((m) => fingerprint(m.content)),
      4,
    );

    const intent = detectIntent(dto.content);
    const ctx: ComfortContext = {
      emotionKey: session.triggerEmotion ?? undefined,
      negative: session.triggerSource === 'DETECTION',
      studentName: student?.name,
      profile: student?.profile ?? null,
      intent,
      recentTechniques,
      recentStorySignatures,
      turnCount: assistantMsgs.length,
    };

    // 危机预检测（统一拦截所有 provider，确保 ZHIPU 真实流式也能命中）
    const crisis = crisisReply(dto.content, ctx);
    if (crisis) {
      let audioUrl: string | null = null;
      const ttsResult = await this.tts.synthesize(crisis.content);
      if (ttsResult.engine === 'server' && ttsResult.audioUrl) audioUrl = ttsResult.audioUrl;
      const assistantMsg = await this.prisma.chatMessage.create({
        data: {
          sessionId,
          studentId,
          role: 'ASSISTANT',
          content: crisis.content,
          technique: crisis.technique ?? null,
          scriptId: null,
          audioUrl,
        },
      });
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: { messageCount: { increment: 2 } },
      });
      await this.recordCrisis(studentId, sessionId, dto.content, crisis.content);
      return {
        userMessage: this.toView(userMsg),
        assistantMessage: this.toView(assistantMsg),
        tts: { engine: ttsResult.engine },
      };
    }

    const reply: LlmReply = await this.llm.reply({
      studentName: student?.name,
      emotionKey: session.triggerEmotion ?? undefined,
      negative: session.triggerSource === 'DETECTION',
      history,
      context: ctx,
    });

    let audioUrl: string | null = null;
    const ttsResult = await this.tts.synthesize(reply.content);
    if (ttsResult.engine === 'server' && ttsResult.audioUrl) audioUrl = ttsResult.audioUrl;

    const assistantMsg = await this.prisma.chatMessage.create({
      data: {
        sessionId,
        studentId,
        role: 'ASSISTANT',
        content: reply.content,
        technique: reply.technique ?? null,
        scriptId: reply.scriptId ?? null,
        audioUrl,
      },
    });

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { messageCount: { increment: 2 } },
    });

    return {
      userMessage: this.toView(userMsg),
      assistantMessage: this.toView(assistantMsg),
      tts: { engine: ttsResult.engine },
    };
  }

  /**
   * 流式发送消息：先生成完整回复（调用 LLM），再以小粒度 chunked 推送给回调，
   * 用于 WebSocket 实时推送（学生端逐字看到气泡生成）。
   * 这样既兼容 RULE/MOCK（无流式 API），又能在 OPENAI/ZHIPU 配置时使用真正的流式（见 OpenAiLlmService / ZhipuLlmService）。
   */
  async sendMessageStream(
    studentId: string,
    sessionId: string,
    dto: SendMessageDto,
    onChunk: (delta: string) => void,
  ): Promise<{ userMessage: ChatMessageView; assistantMessage: ChatMessageView; tts: { engine: string } }> {
    const result = await this.sendMessage(studentId, sessionId, dto);
    const content = result.assistantMessage.content;
    // 分块推送：2 字/段、35ms 间隔 → 看上去像实时输出（≈每字 18ms，光标移动明显）
    const charsPerChunk = 2;
    for (let i = charsPerChunk; i <= content.length; i += charsPerChunk) {
      const delta = content.slice(Math.max(0, i - charsPerChunk), i);
      onChunk(delta);
      await new Promise((r) => setTimeout(r, 35));
    }
    // 推送最终完整版（防客户端漏掉尾部）
    onChunk(content);
    return result;
  }

  /**
   * 真实流式路径（用于 WebSocket）：
   * 由 gateway 调用顺序组合：
   *   1) persistUserMessage  →  广播 user_echo
   *   2) streamAssistantReply →  持续推送 reply_chunk，结束时拿到 assistantMessage
   * 这里的方法已被拆分为两段（见 persistUserMessage + streamAssistantReply）。
   * 保留本方法以兼容 REST 调用：单次返回 user+assistant+tts。
   */
  async streamLlmReply(
    studentId: string,
    sessionId: string,
    dto: SendMessageDto,
    onDelta: (delta: string) => void,
  ): Promise<{ userMessage: ChatMessageView; assistantMessage: ChatMessageView; tts: { engine: string }; provider: string }> {
    const userMessage = await this.persistUserMessage(sessionId, studentId, dto.content);
    const result = await this.streamAssistantReply(studentId, sessionId, onDelta);
    return {
      userMessage,
      assistantMessage: result.assistantMessage,
      tts: result.tts,
      provider: result.provider,
    };
  }

  async endSession(
    operatorUserId: string | null,
    studentId: string,
    sessionId: string,
    dto: EndSessionDto,
  ): Promise<SessionView> {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.studentId !== studentId) throw new ForbiddenException('无权操作该会话');
    const updated = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { status: 'ENDED', endedAt: new Date(), summary: dto.summary ?? null },
    });
    await this.audit.log({
      userId: operatorUserId ?? undefined,
      action: 'chat.session.end',
      resource: 'ChatSession',
      detail: { sessionId, studentId, operatorUserId },
    });
    return this.toSessionView(updated);
  }

  async listSessions(studentId: string, limit = 20) {
    return this.prisma.chatSession.findMany({
      where: { studentId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        studentId: true,
        triggerEmotion: true,
        triggerSource: true,
        status: true,
        llmProvider: true,
        startedAt: true,
        endedAt: true,
        messageCount: true,
        summary: true,
      },
    });
  }

  async getSession(studentId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.studentId !== studentId) throw new ForbiddenException('无权访问该会话');
    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      session: this.toSessionView(session),
      messages: messages.map((m) => this.toView(m)),
    };
  }

  /**
   * 仅持久化用户消息（用于 WebSocket 流式：先 echo 用户消息，再订阅 LLM 流）。
   * 不做 LLM 调用。
   */
  async persistUserMessage(
    sessionId: string,
    studentId: string,
    content: string,
  ): Promise<ChatMessageView> {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.studentId !== studentId) throw new ForbiddenException('无权操作该会话');
    if (session.status === 'ENDED') throw new BadRequestException('会话已结束');
    const userMsg = await this.prisma.chatMessage.create({
      data: { sessionId, studentId, role: 'USER', content },
    });
    return this.toView(userMsg);
  }

  /**
   * 仅流式生成 + 持久化助手消息（用户消息已由调用方提前持久化）。
   * 调用场景：WebSocket 接收用户消息 → 先调用 persistUserMessage 拿到 echo 数据广播给前端 →
   * 再调用本方法生成流式回复，结束时拿到 assistantMessage 广播 reply 事件。
   */
  async streamAssistantReply(
    studentId: string,
    sessionId: string,
    onDelta: (delta: string) => void,
  ): Promise<{ assistantMessage: ChatMessageView; tts: { engine: string }; provider: string }> {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.studentId !== studentId) throw new ForbiddenException('无权操作该会话');

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { profile: true },
    });

    const prev = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    });
    const history = prev
      .reverse()
      .map((m) => ({
        role: (m.role === 'USER' ? 'user' : m.role === 'SYSTEM' ? 'system' : 'assistant') as
          | 'user'
          | 'system'
          | 'assistant',
        content: m.content,
      }));
    // 找出最近一条 USER（刚 persist 的那条）
    const lastUser = [...prev].reverse().find((m) => m.role === 'USER');

    // 危机预检测（统一拦截所有 provider；ZHIPU 真实流式路径原不检测，此处兜底）
    if (lastUser) {
      const crisis = crisisReply(lastUser.content, { studentName: student?.name } as any);
      if (crisis) {
        const text = crisis.content;
        for (let i = 2; i <= text.length; i += 2) {
          onDelta(text.slice(Math.max(0, i - 2), i));
          await new Promise((r) => setTimeout(r, 35));
        }
        onDelta(text);
        let audioUrl: string | null = null;
        const ttsResult = await this.tts.synthesize(text);
        if (ttsResult.engine === 'server' && ttsResult.audioUrl) audioUrl = ttsResult.audioUrl;
        const assistantMsg = await this.prisma.chatMessage.create({
          data: {
            sessionId,
            studentId,
            role: 'ASSISTANT',
            content: text,
            technique: crisis.technique ?? null,
            scriptId: null,
            audioUrl,
          },
        });
        await this.prisma.chatSession.update({
          where: { id: sessionId },
          data: { messageCount: { increment: 1 } },
        });
        await this.recordCrisis(studentId, sessionId, lastUser.content, text);
        return {
          assistantMessage: this.toView(assistantMsg),
          tts: { engine: ttsResult.engine },
          provider: this.llm.provider,
        };
      }
    }

    const assistantMsgs = prev.filter((m) => m.role === 'ASSISTANT');
    const recentTechniques = collectRecentTechniques(
      assistantMsgs.map((m) => m.technique),
      4,
    );
    const recentStorySignatures = collectRecentTechniques(
      assistantMsgs
        .filter((m) => m.technique === 'STORY')
        .map((m) => fingerprint(m.content)),
      4,
    );

    const intent = lastUser ? detectIntent(lastUser.content) : null;
    const ctx: ComfortContext = {
      emotionKey: session.triggerEmotion ?? undefined,
      negative: session.triggerSource === 'DETECTION',
      studentName: student?.name,
      profile: student?.profile ?? null,
      intent,
      recentTechniques,
      recentStorySignatures,
      turnCount: assistantMsgs.length,
    };

    const llmReq: import('./llm.service').LlmRequest = {
      studentName: student?.name,
      emotionKey: session.triggerEmotion ?? undefined,
      negative: session.triggerSource === 'DETECTION',
      history,
      context: ctx,
    };

    const fullBuf: string[] = [];
    let firstChunkSeen = false;
    for await (const delta of this.llm.replyStream(llmReq)) {
      if (!delta) continue;
      firstChunkSeen = true;
      fullBuf.push(delta);
      onDelta(delta);
    }
    const finalContent = firstChunkSeen && fullBuf.length
      ? fullBuf.join('')
      : '星宝在这陪着你，再和我说一句好吗？';

    let audioUrl: string | null = null;
    const ttsResult = await this.tts.synthesize(finalContent);
    if (ttsResult.engine === 'server' && ttsResult.audioUrl) audioUrl = ttsResult.audioUrl;

    const assistantMsg = await this.prisma.chatMessage.create({
      data: {
        sessionId,
        studentId,
        role: 'ASSISTANT',
        content: finalContent,
        technique: null,
        scriptId: null,
        audioUrl,
      },
    });

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { messageCount: { increment: 1 } },
    });

    return {
      assistantMessage: this.toView(assistantMsg),
      tts: { engine: ttsResult.engine },
      provider: this.llm.provider,
    };
  }

  // ---------------- 话术库 ----------------

  /** 将内置话术库写入数据库（幂等：先清空再批量插入）。 */
  async seedScripts(): Promise<{ count: number }> {
    await this.prisma.comfortScript.deleteMany({});
    await this.prisma.comfortScript.createMany({
      data: COMFORT_SCRIPTS.map((s) => ({
        category: s.category,
        technique: s.technique,
        triggerEmotion: s.triggerEmotion ?? null,
        content: s.content,
        followUp: s.followUp ?? null,
        tone: s.tone ?? 'warm',
        tags: s.tags ?? [],
        priority: s.priority ?? 0,
        isActive: s.isActive ?? true,
      })),
    });
    return { count: COMFORT_SCRIPTS.length };
  }

  async getScripts(category?: string, includeInactive = false) {
    return this.prisma.comfortScript.findMany({
      where: {
        ...(category ? { category: category as any } : {}),
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ priority: 'desc' }, { category: 'asc' }],
    });
  }

  /** 媒体（TTS/ASR/LLM）能力状态，供前端决定走浏览器还是服务端。 */
  mediaStatus() {
    return {
      tts: this.tts.getEngine(),
      asr: this.asr.getEngine(),
      llm: this.llm.status(),
    };
  }

  /** 运行期切换 LLM 提供方（满足「LLM 可切换」需求）。 */
  setLlmProvider(name: LlmProviderName): void {
    this.llm.setProvider(name);
  }

  // ---------------- 检测触发（阶段三接入阶段二） ----------------

  /**
   * 由检测网关在持续负向情绪时调用：若近期无进行中/刚结束的会话，则自动开启一段安抚对话。
   * 返回新建会话，或 null（被冷却期拦截）。
   */
  async maybeAutoStartComfort(
    studentId: string,
    emotionKey?: string,
    compositeScore?: number,
    dominantScore?: number,
  ): Promise<StartResult | null> {
    const recent = await this.prisma.chatSession.findFirst({
      where: { studentId },
      orderBy: { startedAt: 'desc' },
    });
    const cooldownMs = this.config.get<number>('chat.cooldownMs') || COOLDOWN_MS_DEFAULT;
    if (recent) {
      const tooSoon =
        recent.status === 'ACTIVE' ||
        recent.startedAt.getTime() > Date.now() - cooldownMs;
      if (tooSoon) return null;
    }
    return this.startSession(null, studentId, {
      triggerEmotion: emotionKey,
      triggerSource: 'DETECTION',
    });
  }

  // ---------------- 工具 ----------------

  private ruleReplyFor(ctx: ComfortContext): { content: string; technique?: string; category?: string; scriptId?: string } {
    return ruleReply(COMFORT_SCRIPTS, ctx);
  }

  // ---------------- 安全事件 / 危机闭环 ----------------

  /** 危机命中后落库安全事件 + 给监护人/owner 推送站内信告警。 */
  private async recordCrisis(studentId: string, sessionId: string, sourceText: string, replyContent: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { owner: { select: { id: true } }, guardians: { select: { id: true } } },
    });
    if (!student) return;
    const level = crisisLevel(sourceText);
    const evt = await this.prisma.safetyEvent.create({
      data: {
        studentId,
        sessionId,
        level,
        sourceText: sourceText.slice(0, 500),
        replySummary: replyContent.slice(0, 300),
        category: 'CRISIS_SUPPORT',
        notifyStatus: 'PENDING',
      },
    });
    const recipients = [student.owner, ...student.guardians].filter(Boolean) as { id: string }[];
    for (const r of recipients) {
      await this.prisma.notification.create({
        data: {
          userId: r.id,
          type: 'CRISIS_ALERT',
          title: `⚠️ ${student.name} 触发了危机关怀`,
          body: '星宝检测到孩子表达了强烈的负面情绪，并已给出安抚与求助热线。请尽快关注孩子状态。',
          relatedStudentId: studentId,
        },
      });
    }
    // 升级：短信 + 邮件 + WebSocket 实时推送（多级监护人提醒闭环）
    void this.alerts
      .escalateCrisis({
        studentId,
        safetyEventId: evt.id,
        sourceText,
        replySummary: replyContent,
        level,
        kind: 'CRISIS',
      })
      .catch((e) => console.error(`危机升级失败: ${(e as Error).message}`));
    await this.prisma.safetyEvent.update({
      where: { id: evt.id },
      data: { notifyStatus: 'SENT', notifiedAt: new Date() },
    });
  }

  /** 监护人查询某学生的安全事件（含未确认提醒）。 */
  async listSafetyEvents(studentId: string, onlyUnack = false) {
    return this.prisma.safetyEvent.findMany({
      where: { studentId, ...(onlyUnack ? { acknowledged: false } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 监护人确认/处理某安全事件。 */
  async ackSafetyEvent(id: string, handledBy: string, note?: string) {
    return this.prisma.safetyEvent.update({
      where: { id },
      data: {
        acknowledged: true,
        acknowledgedAt: new Date(),
        handledBy,
        ...(note !== undefined ? { note } : {}),
      },
    });
  }

  // ---------------- 家长端：聊天趋势摘要 ----------------

  /** 聚合近期对话：会话数、危机事件数、安抚技术分布、最近活跃。 */
  async chatSummary(studentId: string, days = 30) {
    const since = new Date(Date.now() - days * 86400000);
    const [techniqueAgg, crisisCount, sessionCount, lastSession] = await Promise.all([
      this.prisma.chatMessage.groupBy({
        by: ['technique'],
        where: { studentId, role: 'ASSISTANT', createdAt: { gte: since } },
        _count: true,
      }),
      this.prisma.safetyEvent.count({ where: { studentId } }),
      this.prisma.chatSession.count({ where: { studentId } }),
      this.prisma.chatSession.findFirst({ where: { studentId }, orderBy: { startedAt: 'desc' } }),
    ]);
    return {
      periodDays: days,
      totalSessions: sessionCount,
      crisisEvents: crisisCount,
      techniqueBreakdown: techniqueAgg,
      lastActiveAt: lastSession?.startedAt ?? null,
    };
  }

  /** 服务端 TTS：生成音频并返回 audioUrl（前端"服务端语音"开关调用）。 */
  async ttsForText(text: string) {
    return this.tts.synthesize(text);
  }

  // ---------------- 回复质量反馈 ----------------

  /** 学生对星宝回复的 👍/👎（仅 ASSISTANT 消息）。归属校验由 controller 保证。 */
  async setMessageFeedback(messageId: string, feedback: 'LIKE' | 'DISLIKE' | null) {
    if (!['LIKE', 'DISLIKE', null].includes(feedback as any)) {
      throw new BadRequestException('feedback 取值非法');
    }
    const msg = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('消息不存在');
    if (msg.role !== 'ASSISTANT') throw new BadRequestException('只能评价星宝的回复');
    await this.prisma.chatMessage.update({ where: { id: messageId }, data: { feedback } });
    return { ok: true };
  }

  private toView(m: any): ChatMessageView {
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      technique: m.technique ?? null,
      audioUrl: m.audioUrl ?? null,
      feedback: m.feedback ?? null,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private toSessionView(s: any): SessionView {
    return {
      id: s.id,
      studentId: s.studentId,
      triggerEmotion: s.triggerEmotion ?? null,
      triggerSource: s.triggerSource,
      status: s.status,
      llmProvider: s.llmProvider,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
      messageCount: s.messageCount,
      summary: s.summary ?? null,
    };
  }
}
