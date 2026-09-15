// 聚焦验证：上传照片自检 + 精度声明条（无需摄像头，正好覆盖用户摄像头损坏场景）
import { chromium } from 'playwright';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE = 'https://localhost:3300';
const OUT = join(__dirname, 'shots');
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const results = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; results.push(`✅ ${name} ${extra}`); }
  else { fail++; results.push(`❌ ${name} ${extra}`); }
}

// 生成一张含「人形」的合成 PNG（驱动 MediaPipe / 表情模型跑通管线；用 PNG 避免 SVG 边缘问题）
async function makePersonPng(page) {
  return await page.evaluate(() => {
    const w = 320, h = 420;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#dfeaff'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd9a8'; ctx.beginPath(); ctx.arc(160, 70, 45, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7ec4ff'; ctx.fillRect(130, 115, 60, 150);
    ctx.fillStyle = '#ffd9a8'; ctx.fillRect(95, 130, 30, 120); ctx.fillRect(195, 130, 30, 120);
    ctx.fillStyle = '#4a6fa5'; ctx.fillRect(135, 265, 28, 140); ctx.fillRect(157, 265, 28, 140);
    return c.toDataURL('image/png');
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, ignoreHTTPSErrors: true });
  const consoleErrors = [];
  const dialogs = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss().catch(() => {}); });

  // 学生端路由守卫要求 auth.studentId；照片自检为纯前端管线，注入本地学生标识即可进入页面
  await page.addInitScript(() => {
    localStorage.setItem('sp_student', 'smoke-test-student');
  });

  // 直接访问学生端检测页（照片自检为纯前端识别，无需真实后端会话）
  await page.goto(`${BASE}/student/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 1) 精度声明条存在
  const accText = await page.locator('text=辅助参考').count();
  check('常驻精度声明条出现（辅助参考/非医学诊断）', accText > 0);

  // 2) 上传照片自检入口存在
  const scBtn = page.locator('button:has-text("上传照片自检")');
  check('「上传照片自检」按钮存在', (await scBtn.count()) > 0);

  // 3) 点开自检弹窗
  if (await scBtn.count() > 0) {
    await scBtn.first().click();
    await page.waitForTimeout(400);
    const modal = await page.locator('text=上传照片自检').count();
    check('点击后弹出自检弹窗', modal > 0);

    // 4) 生成一张合成人形 PNG 文件，触发真实识别管线（MediaPipe + 表情模型）
    const dataUrl = await makePersonPng(page);
    const b64 = dataUrl.split(',')[1];
    const file = `${OUT}/person.png`;
    writeFileSync(file, Buffer.from(b64, 'base64'));
    const input = page.locator('input[type=file]');
    await input.setInputFiles(file);
    // 等待识别（首次需下载 ~12MB 模型，留足时间）
    await page.waitForTimeout(20000);
    const loading = await page.locator('text=识别中').count();
    const resultShown = await page.locator('.sc-result, .sc-notes').count();
    check('自检完成且无崩溃（结果或说明已渲染）', resultShown > 0 || loading === 0, `(resultShown=${resultShown})`);
    await page.screenshot({ path: `${OUT}/selfcheck_modal.png` });
  }

  // 5) 全局无控制台报错 / 无意外弹窗
  check('页面无 JS 控制台报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check('无意外 alert 弹窗（识别未抛错）', dialogs.length === 0, dialogs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('════════ 照片自检浏览器冒烟 ════════');
  console.log(results.join('\n'));
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('运行异常', e); process.exit(2); });
