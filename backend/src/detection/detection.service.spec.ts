import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DetectionService } from './detection.service';

function makePrisma() {
  const store: any = {
    student: [],
    detectionSession: [],
    emotionFrame: [],
    behaviorEvent: [],
  };
  const prisma: any = {
    student: {
      findUnique: jest.fn(async ({ where }: any) =>
        store.student.find((s: any) => s.id === where.id) || null,
      ),
      create: jest.fn(async (a: any) => {
        const s = { id: 'stu_' + store.student.length, ...a.data };
        store.student.push(s);
        return s;
      }),
    },
    detectionSession: {
      create: jest.fn(async (a: any) => {
        const s = { id: 'ses_' + store.detectionSession.length, studentId: a.data.studentId, status: 'RUNNING', startedAt: new Date(), source: 'CAMERA', ...a.data };
        store.detectionSession.push(s);
        return s;
      }),
      findUnique: jest.fn(async ({ where }: any) =>
        store.detectionSession.find((s: any) => s.id === where.id) || null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const s = store.detectionSession.find((x: any) => x.id === where.id);
        Object.assign(s, data);
        return s;
      }),
      findMany: jest.fn(async ({ where, orderBy, take }: any) =>
        store.detectionSession
          .filter((s: any) => !where || s.studentId === where.studentId)
          .sort((a: any, b: any) => (b[orderBy?.startedAt === 'desc' ? 'startedAt' : 'id'] > a[orderBy?.startedAt === 'desc' ? 'startedAt' : 'id'] ? 1 : -1))
          .slice(0, take || 50),
      ),
    },
    emotionFrame: {
      create: jest.fn(async (a: any) => {
        const f = { id: 'fr_' + store.emotionFrame.length, ...a.data };
        store.emotionFrame.push(f);
        return f;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        store.emotionFrame
          .filter((f: any) => !where || f.sessionId === where.sessionId)
          .sort((a: any, b: any) => (a.ts > b.ts ? -1 : 1)),
      ),
    },
    behaviorEvent: {
      createMany: jest.fn(async (a: any) => {
        for (const d of a.data) store.behaviorEvent.push({ id: 'be_' + store.behaviorEvent.length, ...d });
        return { count: a.data.length };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        store.behaviorEvent.filter(
          (e: any) =>
            !where ||
            ((!where.studentId || e.studentId === where.studentId) &&
              (!where.sessionId || e.sessionId === where.sessionId)),
        ),
      ),
    },
  };
  return { prisma, store };
}

const audit = { log: jest.fn() } as any;

describe('DetectionService', () => {
  let prisma: any;
  let store: any;
  let service: DetectionService;

  beforeEach(() => {
    const m = makePrisma();
    prisma = m.prisma;
    store = m.store;
    service = new DetectionService(prisma, audit);
    // 预置一名学生
    store.student.push({ id: 'stu1', name: '小明' });
  });

  it('createSession 创建会话并返回 id', async () => {
    const res = await service.createSession('op1', { studentId: 'stu1' });
    expect(res.sessionId).toBeDefined();
    expect(res.studentId).toBe('stu1');
    expect(store.detectionSession[0].studentId).toBe('stu1');
    expect(audit.log).toHaveBeenCalled();
  });

  it('createSession 学生不存在抛 NotFound', async () => {
    await expect(service.createSession('op1', { studentId: 'nope' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('appendFrame 落库情绪帧并按规则分类综合评分', async () => {
    const { sessionId } = await service.createSession('op1', { studentId: 'stu1' });
    const res = await service.appendFrame('stu1', {
      sessionId,
      emotionScores: { happy: 90, neutral: 8, sad: 2 },
      behaviors: [{ behavior: 'clap', confidence: 0.82 }],
    });
    expect(res.compositeScore).toBeGreaterThan(85);
    expect(res.dominant).toBe('happy');
    expect(res.negative).toBe(false);
    expect(res.behaviors[0].behavior).toBe('clap');
    expect(store.emotionFrame.length).toBe(1);
    expect(store.behaviorEvent.length).toBe(1);
  });

  it('appendFrame 负向情绪标记为 negative 并触发安抚', async () => {
    const { sessionId } = await service.createSession('op1', { studentId: 'stu1' });
    const res = await service.appendFrame('stu1', {
      sessionId,
      emotionScores: { angry: 80, sad: 12, neutral: 5, fear: 3 },
    });
    expect(res.negative).toBe(true);
    expect(res.compositeScore).toBeLessThan(40);
  });

  it('appendFrame 会话与学生不匹配抛 BadRequest', async () => {
    const { sessionId } = await service.createSession('op1', { studentId: 'stu1' });
    await expect(
      service.appendFrame('other', { sessionId, emotionScores: { neutral: 100 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('endSession 置为 ENDED', async () => {
    const { sessionId } = await service.createSession('op1', { studentId: 'stu1' });
    const res = await service.endSession('op1', { sessionId, fps: 18 });
    expect(res.endedAt).toBeDefined();
    expect(store.detectionSession[0].status).toBe('ENDED');
    expect(store.detectionSession[0].fps).toBe(18);
  });

  it('getSessionFrames 返回映射后的帧与行为', async () => {
    const { sessionId } = await service.createSession('op1', { studentId: 'stu1' });
    await service.appendFrame('stu1', {
      sessionId,
      emotionScores: { neutral: 70, happy: 20 },
      behaviors: [{ behavior: 'wave', confidence: 0.7 }],
    });
    const detail = await service.getSessionFrames('stu1', sessionId);
    expect(detail.frames.length).toBe(1);
    expect(detail.behaviors.length).toBe(1);
    expect(detail.behaviors[0].behaviorLabel).toBe('挥手');
  });

  it('behaviorStats 聚合频次与平均置信度', async () => {
    const { sessionId } = await service.createSession('op1', { studentId: 'stu1' });
    await service.appendFrame('stu1', {
      sessionId,
      emotionScores: { neutral: 70 },
      behaviors: [
        { behavior: 'clap', confidence: 0.8 },
        { behavior: 'clap', confidence: 0.6 },
      ],
    });
    const stats = await service.behaviorStats('stu1');
    expect(stats.clap.count).toBe(2);
    expect(stats.clap.avgConfidence).toBeCloseTo(0.7, 1);
  });
});
