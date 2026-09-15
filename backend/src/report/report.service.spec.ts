import { ReportService } from './report.service';
import type { AuthUser } from '../common/interfaces/auth-user.interface';

function makeService(overrides: any = {}) {
  const prisma: any = {
    student: {
      findUnique: async () =>
        overrides.student !== undefined
          ? overrides.student
          : { id: 'stu1', ownerId: 'u1', guardians: [{ id: 'g1' }] },
    },
    emotionFrame: {
      findMany: async () => overrides.frames ?? [],
    },
    chatSession: {
      findMany: async () => overrides.sessions ?? [],
    },
    reportRecord: {
      create: async (args: any) => ({ id: 'rec1', ...args.data }),
      findMany: async () => overrides.records ?? [],
    },
  };
  const audit: any = { log: async () => ({}) };
  const detection: any = { behaviorStats: async () => overrides.behavior ?? {} };
  const cache: any = { getJSON: async () => null, setJSON: async () => {}, delete: async () => {}, deleteByPrefix: async () => {} };
  return new ReportService(prisma, audit, detection, cache);
}

const FRAMES = [
  { ts: new Date('2026-08-10T01:00:00.000Z'), compositeScore: 80, negative: false, dominant: 'happy' },
  { ts: new Date('2026-08-10T02:00:00.000Z'), compositeScore: 20, negative: true, dominant: 'sad' },
  { ts: new Date('2026-08-10T02:00:30.000Z'), compositeScore: 25, negative: true, dominant: 'angry' },
];
const SESSIONS = [
  { status: 'ENDED', triggerSource: 'DETECTION', messageCount: 6 },
  { status: 'ACTIVE', triggerSource: 'MANUAL', messageCount: 2 },
];

describe('ReportService', () => {
  describe('getDashboard', () => {
    it('聚合情绪趋势 / 风险事件 / 安抚统计 / 干预效果', async () => {
      const svc = makeService({ frames: FRAMES, sessions: SESSIONS });
      const dash = await svc.getDashboard('stu1', 'CUSTOM', '2026-08-10T00:00:00.000Z', '2026-08-11T00:00:00.000Z');
      expect(dash.summary.frameCount).toBe(3);
      expect(dash.summary.negativeRatio).toBeCloseTo(2 / 3, 5);
      expect(dash.trend).toHaveLength(1);
      expect(dash.trend[0].bucket).toBe('2026-08-10');
      expect(dash.riskBursts).toHaveLength(1); // 连续负向段（2帧）
      expect(dash.comfortStats.sessionCount).toBe(2);
      expect(dash.intervention.comfortTriggered).toBe(1);
      expect(dash.intervention.coverageRate).toBeCloseTo(1 / 1, 5);
    });

    it('按周粒度分桶', async () => {
      const svc = makeService({ frames: FRAMES });
      const dash = await svc.getDashboard('stu1', 'CUSTOM', '2026-08-10T00:00:00.000Z', '2026-08-11T00:00:00.000Z', 'week');
      expect(dash.trend[0].bucket).toBe('2026-08-10');
    });
  });

  describe('exportReport', () => {
    it('生成 CSV 并写入导出记录', async () => {
      const svc = makeService({ frames: FRAMES, sessions: SESSIONS });
      const res = await svc.exportReport('stu1', 'CSV', 'CUSTOM', '2026-08-10T00:00:00.000Z', '2026-08-11T00:00:00.000Z', 'u1');
      expect(res.mime).toContain('text/csv');
      expect(res.filename.endsWith('.csv')).toBe(true);
      expect(res.recordId).toBe('rec1');
      expect(res.content).toContain('# 情绪趋势');
    });
    it('生成 JSON 完整看板', async () => {
      const svc = makeService({ frames: FRAMES, sessions: SESSIONS });
      const res = await svc.exportReport('stu1', 'JSON', 'CUSTOM', '2026-08-10T00:00:00.000Z', '2026-08-11T00:00:00.000Z');
      expect(res.mime).toBe('application/json');
      const parsed = JSON.parse(res.content);
      expect(parsed.summary.frameCount).toBe(3);
    });
  });

  describe('listRecords', () => {
    it('返回导出记录', async () => {
      const svc = makeService({ records: [{ id: 'rec1', type: 'CUSTOM', format: 'CSV' }] });
      const list = await svc.listRecords('stu1');
      expect(list).toHaveLength(1);
    });
  });

  describe('assertStudentAccess', () => {
    const parent: AuthUser = { userId: 'u1', account: 'p', role: 'PARENT' as any, nickname: 'p', phone: '1' } as AuthUser;
    const studentSelf: AuthUser = { userId: 'stu1', account: 's', role: 'STUDENT' as any, nickname: 's', phone: '1' } as AuthUser;
    const studentOther: AuthUser = { userId: 'stu2', account: 's2', role: 'STUDENT' as any, nickname: 's2', phone: '1' } as AuthUser;

    it('学生仅能查看自己', async () => {
      const svc = makeService();
      await expect(svc.assertStudentAccess(studentSelf, 'stu1')).resolves.toBeUndefined();
      await expect(svc.assertStudentAccess(studentOther, 'stu1')).rejects.toThrow('只能查看自己的数据');
    });

    it('家长/教师需为 owner 或 guardian', async () => {
      const svc = makeService({ student: { id: 'stu1', ownerId: 'u1', guardians: [] } });
      await expect(svc.assertStudentAccess(parent, 'stu1')).resolves.toBeUndefined();
      const stranger: AuthUser = { userId: 'x9', account: 'x', role: 'PARENT' as any, nickname: 'x', phone: '1' } as AuthUser;
      await expect(svc.assertStudentAccess(stranger, 'stu1')).rejects.toThrow('无权访问该学生数据');
    });

    it('学生不存在时抛错', async () => {
      const svc = makeService({ student: null });
      await expect(svc.assertStudentAccess(parent, 'stu1')).rejects.toThrow('学生不存在');
    });
  });
});
