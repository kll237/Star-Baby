import { createRequire } from 'module';
import { PrismaClient } from '@prisma/client';
const require = createRequire(import.meta.url);
const { io: Client } = require('c:/Users/Administrator/WorkBuddy/2026-08-14-17-02-50/frontend/node_modules/socket.io-client');

const BASE = 'http://localhost:3300';
const prisma = new PrismaClient();

async function req(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const stamp = Date.now().toString().slice(-8);
const unique = 'sh_' + stamp;
const email = `selfharm.${stamp}@starguard.local`;
const phone = '137' + stamp;
const password = 'Test@123456';

async function main() {
  console.log('=== 场景：学生出现自残危险行为 → 紧急弹窗 ===\n');

  console.log('[1] 家长注册（真实手机号 + 邮箱 + 隐私同意）');
  const codeRes = await req('POST', '/api/sms/send', { body: { phone, purpose: 'REGISTER' } });
  const smsCode = codeRes.json?.devCode || '000000';
  const reg = await req('POST', '/api/auth/register', {
    body: {
      account: unique, password, nickname: '自残场景家长', phone, email,
      role: 'PARENT', smsCode, privacyConsent: true, privacyVersion: '1.0',
    },
  });
  console.log('    注册:', reg.status, '| 邮箱已留存:', reg.json?.user?.email);

  const login = await req('POST', '/api/auth/login', { body: { account: unique, password } });
  const token = login.json?.tokens?.accessToken;
  if (!token) { console.log('!! 登录失败，终止'); return; }
  console.log('    登录: 200 | token OK');

  console.log('\n[2] 创建关联学生');
  const stu = await req('POST', '/api/students', { token, body: { name: '自残场景学生' } });
  const studentId = stu.json?.id;
  if (!studentId) { console.log('!! 创建学生失败'); return; }
  console.log('    studentId =', studentId);

  console.log('\n[3] 家长端连接 /alerts 实时通道（模拟手机在线）');
  const got = {};
  const sock = Client(BASE + '/alerts', { auth: { token }, transports: ['websocket'] });
  sock.on('connect', () => console.log('    ws 已连接'));
  sock.on('emergency', (p) => {
    got.emergency = p;
    console.log('    🆘 [紧急弹窗 emergency] 收到！');
    console.log('       学生:', p.studentName, '| 等级:', p.level);
    console.log('       标题:', p.title);
  });
  sock.on('risk', (p) => { got.risk = p; console.log('    ⚠️  [risk] 收到:', p.title || ''); });
  sock.on('crisis', (p) => { got.crisis = p; console.log('    [crisis] 收到'); });
  await new Promise((r) => setTimeout(r, 900));

  console.log('\n[4] 触发自残危险行为（scenario=SELF_HARM）');
  const trig = await req('POST', '/api/alerts/demo-trigger', {
    token, body: { studentId, scenario: 'SELF_HARM' },
  });
  console.log('    响应:', trig.status, JSON.stringify(trig.json));

  await new Promise((r) => setTimeout(r, 1500));
  sock.close();

  console.log('\n[5] 三渠道触达日志');
  const logs = await req('GET', '/api/alerts/logs?studentId=' + studentId, { token });
  const arr = logs.json?.data || logs.json || [];
  console.log('    条数:', arr.length);
  for (const l of arr) {
    console.log(`    - ${l.channel.padEnd(5)} ${l.level.padEnd(8)} ${l.status.padEnd(6)} kind=${l.kind}`);
    if (l.error) console.log(`        备注: ${l.error}`);
  }

  console.log('\n[6] 安全事件是否落库');
  const evts = await prisma.safetyEvent.findMany({
    where: { studentId },
    select: { level: true, category: true, sourceText: true, notifyStatus: true },
  });
  for (const e of evts) {
    console.log(`    - ${e.level} / ${e.category} / notify=${e.notifyStatus}`);
    console.log(`      原文: ${e.sourceText}`);
  }

  console.log('\n=== 验收结论 ===');
  console.log('  紧急弹窗(emergency) 已推送到家长端:', got.emergency ? '✅ 是' : '❌ 否');
  const ch = {};
  for (const l of arr) ch[l.channel] = l.status;
  console.log('  短信 SMS:', ch.SMS || '无', '| 邮件 EMAIL:', ch.EMAIL || '无', '| 站内信 INAPP:', ch.INAPP || '无');
  console.log('  安全事件落库:', evts.length > 0 ? '✅ 是' : '❌ 否');

  try {
    await prisma.alertLog.deleteMany({ where: { studentId } });
    await prisma.safetyEvent.deleteMany({ where: { studentId } });
    await prisma.notification.deleteMany({ where: { studentId } }).catch(() => {});
    await prisma.student.deleteMany({ where: { id: studentId } });
    await prisma.user.deleteMany({ where: { account: unique } });
    console.log('\n已清理测试数据');
  } catch (e) { console.log('清理告警:', e.message); }
  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
