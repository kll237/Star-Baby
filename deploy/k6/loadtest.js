// k6 压测脚本（需安装 k6：https://k6.io/docs/get-started/installation/）
//
// 运行：
//   k6 run -e BASE_URL=http://localhost:3000 deploy/k6/loadtest.js
// 或分阶段加压：
//   k6 run -u 50 -d 30s deploy/k6/loadtest.js
//
// 说明：默认对所有目标路径做匿名只读压测（/health、/api/health）。
// 若需压测受保护接口，先在 setup 中通过 /api/auth/login 获取 token 并写入 header。

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  // 阶段式加压：30s 预热 → 30s 峰值 → 20s 回落
  stages: [
    { duration: '30s', target: 20 },
    { duration: '30s', target: 100 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% 请求 < 500ms
    http_req_failed: ['rate<0.01'], // 错误率 < 1%
  },
};

const targets = [`${BASE}/health`, `${BASE}/api/health`];

export default function () {
  for (const url of targets) {
    const res = http.get(url);
    check(res, {
      'status is 200': (r) => r.status === 200,
      'body has ok': (r) => r.body && r.body.includes('ok'),
    });
  }
  sleep(0.5);
}
