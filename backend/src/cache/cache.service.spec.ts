import { CacheService } from './cache.service';

/** 内存版 Redis 替身，覆盖 get/set/del/delByPrefix，便于离线单测。 */
class FakeRedis {
  private mem = new Map<string, string>();
  async get(k: string) {
    return this.mem.has(k) ? this.mem.get(k)! : null;
  }
  async set(k: string, v: string) {
    this.mem.set(k, v);
    return 'OK';
  }
  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) if (this.mem.delete(k)) n++;
    return n;
  }
  async delByPrefix(prefix: string) {
    let n = 0;
    for (const k of [...this.mem.keys()]) {
      if (k.startsWith(prefix)) {
        this.mem.delete(k);
        n++;
      }
    }
    return n;
  }
}

describe('CacheService', () => {
  let redis: FakeRedis;
  let cache: CacheService;

  beforeEach(() => {
    redis = new FakeRedis();
    cache = new CacheService(redis as any);
  });

  it('应能写入并读回 JSON 对象', async () => {
    await cache.setJSON('k1', { a: 1, b: 'x' }, 30);
    const got = await cache.getJSON<{ a: number; b: string }>('k1');
    expect(got).toEqual({ a: 1, b: 'x' });
  });

  it('未命中返回 null（调用方应回源）', async () => {
    expect(await cache.getJSON('missing')).toBeNull();
  });

  it('解析损坏数据时安全回退为 null，不抛错', async () => {
    await redis.set('spc:cache:bad', '{not-json');
    expect(await cache.getJSON('bad')).toBeNull();
  });

  it('delete 能删除指定键', async () => {
    await cache.setJSON('k2', { v: 1 });
    await cache.delete('k2');
    expect(await cache.getJSON('k2')).toBeNull();
  });

  it('deleteByPrefix 能按前缀批量失效', async () => {
    await cache.setJSON('dash:stu1:a', { x: 1 });
    await cache.setJSON('dash:stu1:b', { x: 2 });
    await cache.setJSON('other:stu1', { x: 3 });
    await cache.deleteByPrefix('dash:stu1:');
    expect(await cache.getJSON('dash:stu1:a')).toBeNull();
    expect(await cache.getJSON('dash:stu1:b')).toBeNull();
    expect(await cache.getJSON('other:stu1')).not.toBeNull();
  });

  it('key() 静态方法按命名空间拼接', () => {
    expect(CacheService.key('ns', ['a', 1, undefined])).toBe('ns:a:1:');
  });

  it('setJSON 失败不应抛出（仅告警）', async () => {
    const broken = new FakeRedis();
    (broken as any).set = async () => {
      throw new Error('boom');
    };
    const c = new CacheService(broken as any);
    await expect(c.setJSON('x', { a: 1 })).resolves.toBeUndefined();
  });
});
