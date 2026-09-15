import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PrismaClient } from '@prisma/client';
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { io: Client } = require(join(__dirname, '..', 'frontend', 'node_modules', 'socket.io-client'));

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
const unique = 'e2e_' + stamp;
const email = `close.loop.${stamp}@starguard.local`;
const phone = '139' + stamp;
const password = 'Test@123456';

async function main() {
  console.log('=== STEP 1: 注册（真实邮箱 + 隐私同意）===');
  const codeRes = await req('POST', '/api/sms/send', { body: { phone, purpose: 'REGISTER' } });
  console.log('send-code:', codeRes.status, JSON.stringify(codeRes.json));
  const smsCode = codeRes.json?.devCode || '000000';
  console.log('dev smsCode =', smsCode);

  const regRes = await req('POST', '/api/auth/register', {
    body: {
      account: unique, password, nickname: '验收家长', phone, email,
      role: 'PARENT', smsCode, privacyConsent: true, privacyVersion: '1.0',
    },
  });
  console.log('register:', regRes.status, JSON.stringify(regRes.json).slice(0, 220));
  const userId = regRes.json?.user?.id || regRes.json?.data?.user?.id;
  console.log('userId =', userId, '-> 注册后需登录获取 token');
  const loginRes = await req('POST', '/api/auth/login', { body: { account: unique, password } });
  const token =
    loginRes.json?.tokens?.accessToken ||
    loginRes.json?.accessToken ||
    loginRes.json?.data?.tokens?.accessToken;
  console.log('login:', loginRes.status, '| token 获取:', !!token);
  if (!token) { console.log('!! 登录未返回 token，终止'); return; }

  console.log('\n=== STEP 2: 未同意隐私协议应被拒绝 ===');
  const rejectRes = await req('POST', '/api/auth/register', {
    body: {
      account: unique + '_x', password, nickname: 'x', phone: '138' + stamp,
      email: `reject.${stamp}@starguard.local`, role: 'PARENT', smsCode: '000000',
      privacyConsent: false, privacyVersion: '1.0',
    },
  });
  console.log('privacyConsent=false 注册结果:', rejectRes.status, '(期望 400)');

  console.log('\n=== STEP 3: 创建学生 ===');
  const stuRes = await req('POST', '/api/students', { token, body: { name: '验收测试学生' } });
  console.log('createStudent:', stuRes.status, JSON.stringify(stuRes.json).slice(0, 220));
  const studentId = stuRes.json?.id || stuRes.json?.data?.id;
  if (!studentId) { console.log('!! 未拿到 studentId'); return; }
  console.log('studentId =', studentId);

  console.log('\n=== STEP 4: 监听 WebSocket /alerts ===');
  const got = {};
  const sock = Client(BASE + '/alerts', { auth: { token }, transports: ['websocket'] });
  sock.on('connect', () => console.log('  ws 已连接'));
  sock.on('crisis', (p) => { got.crisis = p; console.log('  [WS] crisis:', JSON.stringify(p).slice(0, 160)); });
  sock.on('emergency', (p) => { got.emergency = p; console.log('  [WS] emergency:', JSON.stringify(p).slice(0, 160)); });
  await new Promise((r) => setTimeout(r, 800));

  console.log('\n=== STEP 5: 演示触发危机 ===');
  const trig = await req('POST', '/api/alerts/demo-trigger', { token, body: { studentId } });
  console.log('demo-trigger:', trig.status, JSON.stringify(trig.json).slice(0, 300));

  await new Promise((r) => setTimeout(r, 1200));
  sock.close();

  console.log('\n=== STEP 6: 触达日志 ===');
  const logs = await req('GET', '/api/alerts/logs?studentId=' + studentId, { token });
  const arr = logs.json?.data || logs.json || [];
  console.log('logs status:', logs.status, '条数:', arr.length);
  const byChannel = {};
  for (const l of arr) byChannel[l.channel] = (byChannel[l.channel] || 0) + 1;
  console.log('按渠道统计:', JSON.stringify(byChannel));
  for (const l of arr.slice(0, 8)) console.log('  -', l.channel, l.level, l.status, '|', l.title, '|', (l.body || '').slice(0, 40));

  console.log('\n=== STEP 7: 监护人联系人（脱敏）===');
  const contacts = await req('GET', '/api/alerts/contacts?studentId=' + studentId, { token });
  console.log('contacts:', JSON.stringify(contacts.json).slice(0, 300));

  console.log('\n=== 结果汇总 ===');
  console.log('WS crisis 收到:', !!got.crisis, '| WS emergency 收到:', !!got.emergency);
  console.log('SMS 日志:', !!byChannel.SMS, '| EMAIL 日志:', !!byChannel.EMAIL, '| INAPP 日志:', !!byChannel.INAPP);
  console.log('未同意隐私被拒(400):', rejectRes.status === 400);

  await prisma.$disconnect();
  try {
    await prisma.alertLog.deleteMany({ where: { studentId } });
    await prisma.student.deleteMany({ where: { id: studentId } });
    await prisma.user.deleteMany({ where: { account: { in: [unique, unique + '_x'] } } });
    console.log('已清理测试数据');
  } catch (e) { console.log('清理告警:', e.message); }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
