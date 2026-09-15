import { AdviceService } from './advice.service';
import type { DashboardData } from '../report/report.aggregate';

const DASHBOARD: DashboardData = {
  studentId: 'stu1',
  period: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z', type: 'CUSTOM' },
  summary: {
    frameCount: 30,
    negativeCount: 15,
    negativeRatio: 0.5,
    avgCompositeScore: 35,
    bestScore: 90,
    worstScore: 10,
    dominantDistribution: { sad: 10, angry: 6, neutral: 4 },
  },
  trend: [],
  riskBursts: [],
  comfortStats: { sessionCount: 1, activeCount: 0, endedCount: 1, triggerSourceDistribution: {}, totalMessages: 4, avgMessageCount: 4 },
  intervention: { negativeBursts: 1, comfortTriggered: 1, coverageRate: 1, avgMessagesWhenTriggered: 4 },
  behaviorStats: { self_injury: { count: 2, avgConfidence: 0.9 }, stamp: { count: 1, avgConfidence: 0.8 } },
};

const KB = [
  { category: 'CRISIS_INTERVENTION', title: '自伤即时处置', content: '移除伤害源并保护', source: 'PBS', severity: 'CRITICAL', target: 'ALL', applicableEmotions: [], applicableBehaviors: ['self_injury'], tags: ['自伤'], reference: null, priority: 10 },
  { category: 'EMOTION_REGULATION', title: '情绪命名三步法', content: '共情—命名—引导', source: 'CBT', severity: 'LOW', target: 'ALL', applicableEmotions: ['sad', 'angry'], applicableBehaviors: [], tags: ['共情'], reference: null, priority: 9 },
  { category: 'SCHOOL_ADAPTATION', title: '课堂视觉提示', content: '张贴流程图', source: 'TEACCH', severity: 'LOW', target: 'TEACHER', applicableEmotions: [], applicableBehaviors: [], tags: ['视觉'], reference: null, priority: 8 },
];

function makeService(overrides: any = {}) {
  const prisma: any = {
    student: {
      findUnique: async () =>
        overrides.student !== undefined
          ? overrides.student
          : { id: 'stu1', ownerId: 'u1', guardians: [{ id: 'g1' }] },
    },
    knowledgeItem: {
      findMany: async () => overrides.knowledge ?? KB,
      count: async () => (overrides.count !== undefined ? overrides.count : 3),
      createMany: async () => ({ count: overrides.inserted ?? 0 }),
    },
    adviceRecord: {
      create: async (a: any) => ({ id: 'rec1', ...a.data }),
      findMany: async () => overrides.records ?? [],
    },
    audit: { log: async () => ({}) },
  };
  const report: any = {
    getDashboard: async () => overrides.dashboard ?? DASHBOARD,
  };
  const audit: any = { log: async () => ({}) };
  const detection: any = {};
  const deskpet: any = { handleAdvice: jest.fn().mockResolvedValue({ ok: true }) };
  const cache: any = { getJSON: async () => null, setJSON: async () => {}, delete: async () => {}, deleteByPrefix: async () => {} };
  return new AdviceService(prisma, audit, detection, report, deskpet, cache);
}

const USER = { sub: 'u1', role: 'PARENT' } as any;

describe('AdviceService', () => {
  it('generateAdvice 聚合→画像→打分→持久化记录', async () => {
    const svc = makeService();
    const out = await svc.generateAdvice('stu1', { generatedById: 'u1' });
    expect(out.result.severity).toBe('CRITICAL');
    expect(out.recordId).toBe('rec1');
    expect(out.result.topItems.length).toBeGreaterThan(0);
    expect(out.result.topItems[0].category).toBe('CRISIS_INTERVENTION');
  });

  it('generateAdvice 按 target 过滤知识库', async () => {
    const svc = makeService();
    const out = await svc.generateAdvice('stu1', { target: 'TEACHER' });
    expect(out.result.topItems.every((t) => t.target === 'ALL' || t.target === 'TEACHER')).toBe(true);
  });

  it('assertStudentAccess 拒绝无权限用户', async () => {
    const svc = makeService({ student: { id: 'stu1', ownerId: 'other', guardians: [] } });
    await expect(svc.assertStudentAccess({ sub: 'u1', role: 'PARENT' } as any, 'stu1')).rejects.toThrow();
  });

  it('seedKnowledge 按 title 去重写入', async () => {
    const inserted: any[] = [];
    const prisma: any = {
      knowledgeItem: {
        findMany: async () => [],
        count: async () => 0,
        createMany: async (a: any) => {
          inserted.push(...a.data);
          return { count: a.data.length };
        },
      },
    };
    const cache: any = { getJSON: async () => null, setJSON: async () => {}, delete: async () => {}, deleteByPrefix: async () => {} };
    const svc = new AdviceService(prisma, { log: async () => ({}) } as any, {} as any, { getDashboard: async () => DASHBOARD } as any, { handleAdvice: jest.fn().mockResolvedValue({ ok: true }) } as any, cache);
    const r = await svc.seedKnowledge();
    expect(r.inserted).toBe(inserted.length);
    expect(inserted.length).toBeGreaterThan(200); // 种子库 ≥200
    expect(inserted.every((x) => typeof x.title === 'string' && x.title.length > 0)).toBe(true);
  });

  it('getKnowledge 关键词过滤', async () => {
    const svc = makeService();
    const { total, items } = await svc.getKnowledge({ keyword: '自伤' });
    expect(total).toBeGreaterThanOrEqual(3);
    expect(items.some((i) => i.title.includes('自伤'))).toBe(true);
  });
});
