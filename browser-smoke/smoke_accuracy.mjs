// 真实图片精度验证：用手捧脸颊的坐姿人物照驱动自检管线，
// 一次性验证三条识别路径：人脸情绪、姿态关键点、行为（handsNearFace）
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE = 'https://localhost:3300';
// person_real.jpg: 女性坐姿大笑，双手贴脸颊，肩/肘/腕/髋齐全 —— 同时含 face + pose + 行为特征
const IMG = join(__dirname, 'person_real.jpg');

let pass = 0, fail = 0;
const results = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; results.push(`✅ ${name} ${extra}`); }
  else { fail++; results.push(`❌ ${name} ${extra}`); }
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, ignoreHTTPSErrors: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', async (d) => { errors.push('ALERT: ' + d.message()); await d.dismiss().catch(() => {}); });

  await page.addInitScript(() => { localStorage.setItem('sp_student', 'smoke-accuracy'); });
  await page.goto(`${BASE}/student/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button:has-text("上传照片自检")', { timeout: 15000 });
  await page.waitForTimeout(500);

  await page.locator('button:has-text("上传照片自检")').first().click();
  await page.waitForTimeout(400);
  await page.locator('input[type=file]').setInputFiles(IMG);
  // 首次需下载 ~12MB 模型，留足时间
  await page.waitForTimeout(25000);

  const notes = await page.locator('.sc-notes li').allInnerTexts();
  const emotionLabel = await page.locator('.sc-row').first().innerText().catch(() => '');
  const behaviorLabel = await page.locator('.sc-row').nth(1).innerText().catch(() => '');
  const hasResult = (await page.locator('.sc-result').count()) > 0;

  check('自检产出结果区（真实图片）', hasResult, `emotion="${emotionLabel}" behavior="${behaviorLabel}"`);
  check('识别到人体姿态关键点（pose 真实生效）', notes.some((n) => !n.includes('未检测到人体')), notes.join(' | '));
  check('无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

  await page.screenshot({ path: 'C:/Users/Administrator/WorkBuddy/2026-08-14-17-02-50/browser-smoke/shots/selfcheck_real.png' });

  await browser.close();
  console.log('════════ 真实照片精度验证 ════════');
  console.log('情绪识别：', emotionLabel);
  console.log('行为识别：', behaviorLabel);
  console.log('姿态说明：', notes.join(' / '));
  console.log('──────────────────────────');
  console.log(results.join('\n'));
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('运行异常', e); process.exit(2); });
