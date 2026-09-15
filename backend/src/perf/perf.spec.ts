import { CacheService } from '../cache/cache.service';
import { mapCommandToReaction } from '../deskpet/deskpet.reaction';
import { bucketizeTrend, summarizeEmotion, detectRiskBursts } from '../report/report.aggregate';

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

/** 生成 n 条情绪帧输入，用于聚合性能测量。 */
function genFrames(n: number) {
  const out: any[] = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    out.push({
      ts: new Date(now - (n - i) * 1000).toISOString(),
      compositeScore: Math.round((Math.random() * 100)),
      negative: Math.random() < 0.4,
      dominant: ['happy', 'sad', 'angry', 'anxious'][i % 4],
    });
  }
  return out;
}

describe('性能基准（perf）', () => {
  it('缓存读写吞吐应达到基本水平', () => {
    const cache = new CacheService(new FakeRedis() as any);
    const N = 2000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) cache.setJSON(`k${i}`, { i });
    for (let i = 0; i < N; i++) cache.getJSON(`k${i}`);
    const dt = performance.now() - t0;
    const opsPerSec = (N * 2) / (dt / 1000);
    // 内存实现下应远高于此阈值（CI 环境弱也稳过）
    expect(opsPerSec).toBeGreaterThan(500);
  });

  it('桌宠反应映射吞吐', () => {
    const N = 2000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) mapCommandToReaction(['wave', 'dance', 'cheer', 'spin', 'hug', 'alert'][i % 6]);
    const dt = performance.now() - t0;
    expect((N / (dt / 1000))).toBeGreaterThan(500);
  });

  it('看板聚合（趋势分桶 + 摘要 + 风险聚类）吞吐', () => {
    const frames = genFrames(500);
    const N = 50;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      bucketizeTrend(frames, 'day');
      summarizeEmotion(frames);
      detectRiskBursts(frames);
    }
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(2000);
  });

  it('缓存命中应显著快于重新聚合（验证缓存收益）', () => {
    const cache = new CacheService(new FakeRedis() as any);
    const frames = genFrames(300);
    const recompute = () => {
      bucketizeTrend(frames, 'day');
      summarizeEmotion(frames);
      detectRiskBursts(frames);
      return { ok: true };
    };
    const key = 'perf:dashboard';
    const N = 100;
    // 冷（首次计算并写入）
    const tCold = performance.now();
    for (let i = 0; i < N; i++) {
      const r = recompute();
      cache.setJSON(key, r);
    }
    const coldMs = performance.now() - tCold;
    // 热（直接读缓存）
    const tWarm = performance.now();
    for (let i = 0; i < N; i++) {
      const r = cache.getJSON(key);
      expect(r).not.toBeNull();
    }
    const warmMs = performance.now() - tWarm;
    // 热路径（内存读取 + JSON 解析）应明显快于重复聚合
    expect(warmMs).toBeLessThan(coldMs);
  });
});
