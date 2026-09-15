#!/usr/bin/env node
/**
 * 轻量级 HTTP 压测脚本（零依赖，使用 Node 内置 fetch，需 Node 18+）。
 *
 * 用途：对运行中的服务做并发压测，输出 RPS / 延迟分位(p50/p95/p99) / 错误率。
 * 仅做只读或幂等的健康检查类请求（不依赖登录态即可跑 /health；其余接口可传 TOKEN）。
 *
 * 用法：
 *   BASE_URL=http://localhost:3000 \
 *   TARGETS='["/api/health","/health"]' \
 *   CONCURRENCY=20 DURATION_MS=10000 \
 *   node scripts/loadtest.mjs
 *
 * 带鉴权（可选）：设置 TOKEN=<JWT> 会对每个请求附加 Authorization: Bearer。
 */
import process from 'node:process';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TARGETS = JSON.parse(process.env.TARGETS || '["/health"]');
const CONCURRENCY = Number(process.env.CONCURRENCY || 20);
const DURATION_MS = Number(process.env.DURATION_MS || 10000);
const TOKEN = process.env.TOKEN || '';

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[pos];
}

async function worker(stats) {
  const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
  const deadline = Date.now() + DURATION_MS;
  while (Date.now() < deadline) {
    const path = TARGETS[stats.idx++ % TARGETS.length];
    const url = BASE_URL.replace(/\/$/, '') + path;
    const start = performance.now();
    try {
      const res = await fetch(url, { headers, redirect: 'manual' });
      const ms = performance.now() - start;
      stats.latencies.push(ms);
      stats.count++;
      if (res.status >= 400) stats.errors++;
    } catch (e) {
      const ms = performance.now() - start;
      stats.latencies.push(ms);
      stats.count++;
      stats.errors++;
      stats.lastError = String(e);
    }
  }
}

async function main() {
  console.log(`▶ 压测开始：BASE_URL=${BASE_URL} TARGETS=${JSON.stringify(TARGETS)} 并发=${CONCURRENCY} 时长=${DURATION_MS}ms`);
  const stats = { idx: 0, count: 0, errors: 0, latencies: [], lastError: '' };
  const workers = Array.from({ length: CONCURRENCY }, () => worker(stats));
  const t0 = Date.now();
  await Promise.all(workers);
  const elapsed = (Date.now() - t0) / 1000;

  const lat = stats.latencies.slice().sort((a, b) => a - b);
  const rps = stats.count / elapsed;
  const errRate = stats.count ? (stats.errors / stats.count) * 100 : 0;

  console.log('──────── 结果 ────────');
  console.log(`总请求数 : ${stats.count}`);
  console.log(`耗时(s)  : ${elapsed.toFixed(2)}`);
  console.log(`吞吐 RPS : ${rps.toFixed(1)}`);
  console.log(`错误数   : ${stats.errors} (${errRate.toFixed(2)}%)`);
  if (lat.length) {
    console.log(`延迟 p50 : ${quantile(lat, 0.5).toFixed(1)} ms`);
    console.log(`延迟 p95 : ${quantile(lat, 0.95).toFixed(1)} ms`);
    console.log(`延迟 p99 : ${quantile(lat, 0.99).toFixed(1)} ms`);
    console.log(`延迟 max : ${lat[lat.length - 1].toFixed(1)} ms`);
  }
  if (stats.lastError) console.log(`最近错误 : ${stats.lastError}`);
  console.log('───────────────');
}

main().catch((e) => {
  console.error('压测脚本异常:', e);
  process.exit(1);
});
