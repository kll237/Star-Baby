import { chromium } from 'playwright';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, statSync, mkdirSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 载入 backend/.env（Prisma 清理需要 DATABASE_URL）——路径相对本脚本，移动项目不受影响
try {
  const envText = readFileSync(join(__dirname, '..', 'backend', '.env'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}

const BASE = 'https://localhost:3300';
const SHOT_DIR = join(__dirname, 'shots');
mkdirSync(SHOT_DIR, { recursive: true });

const require = createRequire(join(__dirname, '..', 'backend', 'package.json'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
}

async function apiReq(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function makeAccount(role) {
  const suffix = String(Math.floor(Math.random() * 90000000) + 10000000); // 8 位，保证手机号共 11 位
  const account = `smoke_${role.toLowerCase()}_${suffix}`;
  const email = `smoke.${role.toLowerCase()}.${suffix}@starguard.local`;
  const phone = '139' + suffix;
  const password = 'Test@123456';
  const sms = await apiReq('POST', '/sms/send', { body: { phone, purpose: 'REGISTER' } });
  const smsCode = sms.json?.devCode || '000000';
  const reg = await apiReq('POST', '/auth/register', {
    body: {
      account, password,
      nickname: role === 'PARENT' ? '冒烟家长' : '冒烟教师',
      phone, email, role,
      smsCode, privacyConsent: true, privacyVersion: '1.0',
    },
  });
  if (reg.status !== 201) throw new Error('注册失败 ' + reg.status + ' ' + JSON.stringify(reg.json).slice(0, 200));
  const login = await apiReq('POST', '/auth/login', { body: { account, password } });
  const token = login.json?.tokens?.accessToken;
  if (!token) throw new Error('登录未返回 token');
  const stu = await apiReq('POST', '/students', { token, body: { name: role + '冒烟学生' } });
  const studentId = stu.json?.id;
  return { account, password, token, studentId, email, phone };
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const created = [];

try {
  // ===== 家长：完整闭环（返回按钮 + 危机弹窗 + 自残弹窗 + PDF） =====
  const parent = await makeAccount('PARENT');
  created.push(parent);
  {
    const ctx = await browser.newContext({ acceptDownloads: true, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await page.fill('input[placeholder="请输入账号"]', parent.account);
    await page.fill('input[placeholder="请输入密码"]', parent.password);
    await page.click('button.btn:has-text("登录")');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    check('家长 登录成功并跳转 /dashboard', true, page.url());

    // 我的学生页：返回按钮
    await page.goto(BASE + '/students', { waitUntil: 'domcontentloaded' });
    const backBtn = page.locator('button:has-text("返回")').first();
    await backBtn.waitFor({ state: 'visible', timeout: 10000 });
    const backText = (await backBtn.innerText()).trim();
    check('家长「我的学生」显示返回按钮', backText.includes('返回家长工作台'), backText);
    await page.screenshot({ path: SHOT_DIR + '/parent_students.png', fullPage: false });

    // 点击返回 → /parent/dashboard
    await backBtn.click();
    await page.waitForURL('**/parent/dashboard**', { timeout: 15000 });
    await page.waitForSelector('text=情绪与干预数据看板', { timeout: 15000 });
    check('家长 点击返回按钮 → 跳转 /parent/dashboard（家长工作台）', page.url().includes('/parent/dashboard'), page.url());
    await page.screenshot({ path: SHOT_DIR + '/parent_workbench.png', fullPage: false });

    // 等待学生自动选中、演示按钮可用
    await page.waitForSelector('button:has-text("🚨 演示触发危机"):not([disabled])', { timeout: 20000 });
    check('家长 工作台已加载学生并启用演示按钮', true);

    // 演示触发危机 → 全屏紧急弹窗
    await page.click('button:has-text("🚨 演示触发危机")');
    const dlg1 = page.locator('[role="alertdialog"]');
    await dlg1.waitFor({ state: 'visible', timeout: 20000 });
    const crisisTitle = (await dlg1.locator('.cam-title').innerText().catch(() => '')).trim();
    check('家长 演示触发危机 → 全屏紧急弹窗出现', true, crisisTitle);
    await page.screenshot({ path: SHOT_DIR + '/parent_crisis_modal.png', fullPage: false });
    await page.click('.cam-btn');
    await dlg1.waitFor({ state: 'hidden', timeout: 10000 });
    check('家长 危机弹窗可关闭（我已了解）', true);

    // 演示自残紧急 → 弹窗
    await page.click('button:has-text("🆘 演示自残紧急")');
    const dlg2 = page.locator('[role="alertdialog"]');
    await dlg2.waitFor({ state: 'visible', timeout: 20000 });
    check('家长 演示自残紧急 → 紧急弹窗出现', true);
    await page.screenshot({ path: SHOT_DIR + '/parent_selfharm_modal.png', fullPage: false });
    await page.click('.cam-btn');
    await dlg2.waitFor({ state: 'hidden', timeout: 10000 });

    // 导出周报 PDF → 下载
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 40000 }),
      page.click('button:has-text("导出周报 PDF")'),
    ]);
    const pdfPath = SHOT_DIR + '/report.pdf';
    await download.saveAs(pdfPath);
    const pdfOk = existsSync(pdfPath) && statSync(pdfPath).size > 0;
    check('家长 导出周报 PDF → 触发下载且文件非空', pdfOk, pdfOk ? statSync(pdfPath).size + ' bytes' : '未下载');
    await page.screenshot({ path: SHOT_DIR + '/parent_after_pdf.png', fullPage: false });

    await ctx.close();
  }

  // ===== 教师：返回按钮 =====
  const teacher = await makeAccount('TEACHER');
  created.push(teacher);
  {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await page.fill('input[placeholder="请输入账号"]', teacher.account);
    await page.fill('input[placeholder="请输入密码"]', teacher.password);
    await page.click('button.btn:has-text("登录")');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    check('教师 登录成功并跳转 /dashboard', true, page.url());

    await page.goto(BASE + '/students', { waitUntil: 'domcontentloaded' });
    const backBtn = page.locator('button:has-text("返回")').first();
    await backBtn.waitFor({ state: 'visible', timeout: 10000 });
    const backText = (await backBtn.innerText()).trim();
    check('教师「我的学生」显示返回按钮', backText.includes('返回教师工作台'), backText);
    await page.screenshot({ path: SHOT_DIR + '/teacher_students.png', fullPage: false });

    await backBtn.click();
    await page.waitForSelector('text=家长 / 教师工作台', { timeout: 15000 });
    check('教师 点击返回按钮 → 进入教师工作台（/dashboard）', page.url().includes('/dashboard'), page.url());
    await page.screenshot({ path: SHOT_DIR + '/teacher_workbench.png', fullPage: false });

    await ctx.close();
  }
} catch (e) {
  console.error('FATAL', e);
  check('脚本执行未抛异常', false, e.message);
} finally {
  await browser.close();
  // 清理测试数据
  try {
    for (const c of created) {
      if (c.studentId) {
        await prisma.alertLog.deleteMany({ where: { studentId: c.studentId } });
        await prisma.safetyEvent.deleteMany({ where: { studentId: c.studentId } });
        await prisma.student.deleteMany({ where: { id: c.studentId } });
      }
    }
    await prisma.user.deleteMany({ where: { account: { in: created.map((c) => c.account) } } });
    console.log('已清理测试账号与数据');
  } catch (e) {
    console.log('清理告警：', e.message);
  }
  await prisma.$disconnect();
}

const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log('\n════════ 浏览器手点冒烟汇总 ════════');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail > 0 ? 1 : 0);
