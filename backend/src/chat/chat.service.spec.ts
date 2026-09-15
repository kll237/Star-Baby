import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { LlmService } from './llm.service';
import { TtsService } from './tts.service';
import { AsrService } from './asr.service';
import { COMFORT_SCRIPTS } from './chat.scripts';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';

function makeConfig(): ConfigService {
  return { get: () => undefined } as unknown as ConfigService;
}

function makePrisma() {
  const store: any = {
    student: [],
    chatSession: [],
    chatMessage: [],
    comfortScript: [],
  };
  let seq = 0;
  const nid = (p: string) => `${p}_${++seq}`;

  const sortMsgs = (list: any[], ob: any) => {
    const dir = ob?.createdAt === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => (a.createdAt - b.createdAt) * dir);
  };

  const prisma: any = {
    student: {
      findUnique: jest.fn(async ({ where }: any) => store.student.find((s: any) => s.id === where.id) || null),
      create: jest.fn(async ({ data }: any) => {
        const s = { id: nid('stu'), ...data };
        store.student.push(s);
        return s;
      }),
    },
    chatSession: {
      create: jest.fn(async ({ data }: any) => {
        const s = {
          id: nid('ses'),
          status: 'ACTIVE',
          messageCount: 0,
          llmProvider: 'RULE',
          startedAt: new Date(),
          triggerEmotion: null,
          triggerSource: 'MANUAL',
          ...data,
        };
        store.chatSession.push(s);
        return s;
      }),
      findUnique: jest.fn(async ({ where }: any) => store.chatSession.find((s: any) => s.id === where.id) || null),
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        let list = store.chatSession.filter((s: any) => !where || s.studentId === where.studentId);
        list = sortMsgs(list, orderBy);
        return list[0] || null;
      }),
      findMany: jest.fn(async ({ where, orderBy, take }: any) => {
        let list = store.chatSession.filter((s: any) => !where || s.studentId === where.studentId);
        list = sortMsgs(list, orderBy);
        return take ? list.slice(0, take) : list;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const s = store.chatSession.find((x: any) => x.id === where.id);
        if (!s) return null;
        if (data.messageCount && typeof data.messageCount === 'object' && 'increment' in data.messageCount) {
          s.messageCount += data.messageCount.increment;
        } else if (data.messageCount !== undefined) {
          s.messageCount = data.messageCount;
        }
        if (data.status) s.status = data.status;
        if (data.endedAt) s.endedAt = data.endedAt;
        if (data.summary !== undefined) s.summary = data.summary;
        return s;
      }),
    },
    chatMessage: {
      create: jest.fn(async ({ data }: any) => {
        const m = { id: nid('msg'), createdAt: new Date(), ...data };
        store.chatMessage.push(m);
        return m;
      }),
      findMany: jest.fn(async ({ where, orderBy, take }: any) => {
        let list = store.chatMessage.filter((m: any) => !where || m.sessionId === where.sessionId);
        list = sortMsgs(list, orderBy);
        return take ? list.slice(0, take) : list;
      }),
    },
    comfortScript: {
      deleteMany: jest.fn(async () => {
        const n = store.comfortScript.length;
        store.comfortScript = [];
        return { count: n };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        for (const row of data) store.comfortScript.push({ id: nid('cs'), ...row });
        return { count: data.length };
      }),
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        let list = store.comfortScript.filter(
          (c: any) => !where || (where.category ? c.category === where.category : true) && (where.isActive !== undefined ? c.isActive === where.isActive : true),
        );
        list = sortMsgs(list, orderBy);
        return list;
      }),
    },
  };
  return { prisma, store };
}

describe('ChatService', () => {
  let prisma: any;
  let store: any;
  let service: ChatService;
  const studentId = 'stu_1';
  const config = makeConfig();

  beforeEach(() => {
    const m = makePrisma();
    prisma = m.prisma;
    store = m.store;
    store.student.push({ id: studentId, name: '小明' });
    const audit = new AuditService(prisma);
    const llm = new LlmService(config);
    const tts = new TtsService(config);
    const asr = new AsrService(config);
    service = new ChatService(prisma, audit, llm, tts, asr, config);
  });

  it('startSession 建立 ACTIVE 会话并生成系统+首条安抚消息', async () => {
    const res = await service.startSession(null, studentId, { triggerEmotion: 'angry', triggerSource: 'DETECTION' });
    expect(res.session.status).toBe('ACTIVE');
    expect(res.session.triggerSource).toBe('DETECTION');
    expect(res.messages.length).toBe(2);
    expect(res.messages[0].role).toBe('SYSTEM');
    expect(res.messages[1].role).toBe('ASSISTANT');
    expect(res.messages[1].content).toContain('小明');
  });

  it('startSession 学生不存在抛 NotFound', async () => {
    await expect(service.startSession(null, 'nope', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sendMessage 存储用户与助手消息并累加计数', async () => {
    const { session } = await service.startSession(null, studentId, {});
    const r = await service.sendMessage(studentId, session.id, { content: '我有点生气' });
    expect(r.userMessage.role).toBe('USER');
    expect(r.userMessage.content).toBe('我有点生气');
    expect(r.assistantMessage.role).toBe('ASSISTANT');
    expect(r.assistantMessage.content).toContain('小明');
    expect(r.tts.engine).toBe('browser');
    const sess = store.chatSession.find((s: any) => s.id === session.id);
    expect(sess.messageCount).toBe(4); // 2 (start) + 2 (send)
  });

  it('sendMessage 会话不归属该学生抛 Forbidden', async () => {
    const { session } = await service.startSession(null, studentId, {});
    await expect(service.sendMessage('other', session.id, { content: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('sendMessage 会话已结束抛 BadRequest', async () => {
    const { session } = await service.startSession(null, studentId, {});
    await service.endSession(null, studentId, session.id, {});
    await expect(service.sendMessage(studentId, session.id, { content: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('endSession 置为 ENDED', async () => {
    const { session } = await service.startSession(null, studentId, {});
    const ended = await service.endSession(null, studentId, session.id, { summary: '已安抚' });
    expect(ended.status).toBe('ENDED');
    expect(ended.summary).toBe('已安抚');
    expect(ended.endedAt).toBeDefined();
  });

  it('getSession 按时间升序返回消息', async () => {
    const { session } = await service.startSession(null, studentId, {});
    await service.sendMessage(studentId, session.id, { content: '你好' });
    const detail = await service.getSession(studentId, session.id);
    expect(detail.messages.length).toBe(4);
    expect(detail.messages[0].role).toBe('SYSTEM');
    expect(detail.messages[detail.messages.length - 1].role).toBe('ASSISTANT');
  });

  it('maybeAutoStartComfort 无近期会话时自动开启', async () => {
    const res = await service.maybeAutoStartComfort(studentId, 'angry', 30, 80);
    expect(res).not.toBeNull();
    expect(res!.session.triggerSource).toBe('DETECTION');
  });

  it('maybeAutoStartComfort 存在进行中会话时冷却不重复开启', async () => {
    await service.startSession(null, studentId, { triggerEmotion: 'sad' });
    const res = await service.maybeAutoStartComfort(studentId, 'angry', 30, 80);
    expect(res).toBeNull();
  });

  it('seedScripts 写入≥50条且 getScripts 可读取', async () => {
    const r = await service.seedScripts();
    expect(r.count).toBe(COMFORT_SCRIPTS.length);
    expect(r.count).toBeGreaterThanOrEqual(50);
    const list = await service.getScripts();
    expect(list.length).toBeGreaterThanOrEqual(50);
  });

  it('mediaStatus 返回 TTS/ASR/LLM 能力', () => {
    const s = service.mediaStatus();
    expect(s.tts).toBe('browser');
    expect(s.asr).toBe('browser');
    expect(s.llm.available).toEqual(['RULE', 'MOCK', 'OPENAI']);
  });
});
