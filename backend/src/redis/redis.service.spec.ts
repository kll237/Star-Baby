import { RedisService } from './redis.service';
import { ConfigService } from '@nestjs/config';

function makeService(): RedisService {
  const config = { get: jest.fn().mockReturnValue({}) } as any as ConfigService;
  // 不调用 onModuleInit → 保持内存降级模式（client = null）
  return new RedisService(config);
}

describe('RedisService.tryLock', () => {
  it('内存降级：同 key 首次抢锁成功，再次失败（去重）', async () => {
    const svc = makeService();
    expect(await svc.tryLock('k1', 5)).toBe(true);
    expect(await svc.tryLock('k1', 5)).toBe(false);
    // 不同 key 互不影响
    expect(await svc.tryLock('k2', 5)).toBe(true);
  });

  it('真实 Redis：调用 SET key 1 NX EX ttl，返回 OK 视为抢锁成功', async () => {
    const svc = makeService();
    const fakeSet = jest.fn().mockResolvedValue('OK');
    (svc as any).client = { set: fakeSet } as any;
    const ok = await svc.tryLock('rk', 7);
    expect(ok).toBe(true);
    expect(fakeSet).toHaveBeenCalledWith('rk', '1', 'NX', 'EX', 7);
  });

  it('真实 Redis：SET 返回非 OK（已被占用）→ 抢锁失败', async () => {
    const svc = makeService();
    (svc as any).client = { set: jest.fn().mockResolvedValue(null) } as any;
    expect(await svc.tryLock('rk', 7)).toBe(false);
  });
});
