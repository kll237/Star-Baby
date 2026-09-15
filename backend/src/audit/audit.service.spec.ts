import { AuditService } from './audit.service';

describe('AuditService.query', () => {
  function makeService(rows: any[], total = rows.length) {
    const prisma: any = {
      auditLog: {
        findMany: jest.fn(async () => rows),
        count: jest.fn(async () => total),
      },
    };
    return { svc: new AuditService(prisma), prisma };
  }

  it('按 userId 过滤并按时间倒序', async () => {
    const rows = [
      { id: '2', userId: 'u1', action: 'A', createdAt: new Date('2026-01-02') },
      { id: '1', userId: 'u1', action: 'B', createdAt: new Date('2026-01-01') },
    ];
    const { svc, prisma } = makeService(rows);
    const res = await svc.query({ userId: 'u1' });
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.userId).toBe('u1');
    expect(res.items.map((r) => r.id)).toEqual(['2', '1']);
    expect(res.total).toBe(2);
  });

  it('按 action / resource 过滤并分页', async () => {
    const { svc, prisma } = makeService([{ id: 'x' }], 1);
    await svc.query({ action: 'login', resource: 'auth', limit: 10, offset: 20 });
    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(where.action).toBe('login');
    expect(where.resource).toBe('auth');
    expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(10);
    expect(prisma.auditLog.findMany.mock.calls[0][0].skip).toBe(20);
  });

  it('时间区间过滤映射到 createdAt.gte/lte', async () => {
    const { svc, prisma } = makeService([]);
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');
    await svc.query({ from, to });
    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(where.createdAt.gte).toBe(from);
    expect(where.createdAt.lte).toBe(to);
  });

  it('limit 超出范围被收敛到 [1,200]', async () => {
    const { svc, prisma } = makeService([]);
    await svc.query({ limit: 9999 });
    const calls = prisma.auditLog.findMany.mock.calls;
    expect(calls[calls.length - 1][0].take).toBe(200);
    await svc.query({ limit: 0 });
    expect(calls[calls.length - 1][0].take).toBe(1);
  });
});
