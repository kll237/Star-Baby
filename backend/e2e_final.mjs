import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PrismaClient } from '@prisma/client';
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { io: Client } = require(join(__dirname, '..', 'frontend', 'node_modules', 'socket.io-client'));

const BASE = 'http://localhost:3300';
const prisma = new PrismaClient();
const pass = [];
const fail = [];
function check(name, cond, detail = '') {
  (cond ? pass : fail).push(name + (detail ? ` (${detail})` : ''));
  console.log(`  ${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function req(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const stamp = Date.now().toString().slice(-8);
const acct = 'fin_' + stamp;
const email = `final.${stamp}@starguard.local`;
const phone = '136' + stamp;
const password = 'Test@123456';
let studentId = null;

async function main() {
  console.log('════════ 星宝守护 · 功能增强最终回归 ════════\n');

  console.log('【A】注册合规：真实手机号 + 邮箱 + 隐私同意');
  const code = (await req('POST', '/api/sms/send', { body: { phone, purpose: 'REGISTER' } })).json?.devCode || '000000';
  const reg = await req('POST', '/api/auth/register', {
    body: { account: acct, password, nickname: '回归家长', phone, email, role: 'PARENT', smsCode: code, privacyConsent: true, privacyVersion: '1.0' },
  });
  check('注册成功', reg.status === 201, 'HTTP ' + reg.status);
  check('邮箱已落库', reg.json?.user?.email === email, reg.json?.user?.email || '-');
  check('手机号已落库', reg.json?.user?.phone === phone, reg.json?.user?.phone || '-');
  check('隐私同意时间已记录', !!reg.json?.user?.privacyConsentAt, reg.json?.user?.privacyConsentAt || '-');
  check('隐私协议版本已记录', reg.json?.user?.privacyConsentVersion === '1.0');

  const rej = await req('POST', '/api/auth/register', {
    body: { account: acct + '_r', password, nickname: 'r', phone: '135' + stamp, email: `rej.${stamp}@x.com`, role: 'PARENT', smsCode: '000000', privacyConsent: false, privacyVersion: '1.0' },
  });
  check('未勾选隐私协议被拒绝', rej.status === 400, 'HTTP ' + rej.status);

  const noEmail = await req('POST', '/api/auth/register', {
    body: { account: acct + '_e', password, nickname: 'e', phone: '134' + stamp, role: 'PARENT', smsCode: '000000', privacyConsent: true, privacyVersion: '1.0' },
  });
  check('缺少邮箱被拒绝', noEmail.status === 400, 'HTTP ' + noEmail.status);

  const token = (await req('POST', '/api/auth/login', { body: { account: acct, password } })).json?.tokens?.accessToken;
  if (!token) { console.log('!! 登录失败，终止'); return; }

  console.log('\n【B】创建学生并建立监护关系');
  const stu = await req('POST', '/api/students', { token, body: { name: '回归测试学生', consent: true } });
  studentId = stu.json?.id;
  check('学生创建成功', !!studentId, studentId || '-');
  if (!studentId) return;

  const recs0 = await req('GET', `/api/students/${studentId}/consent-records`, { token });
  const r0 = recs0.json?.data || recs0.json || [];
  check('创建时生成 SIGNED 同意记录', r0.some((r) => r.action === 'SIGNED'), `共 ${r0.length} 条`);

  console.log('\n【C】实时通道 /alerts 连接');
  const got = {};
  const sock = Client(BASE + '/alerts', { auth: { token }, transports: ['websocket'] });
  await new Promise((r) => { sock.on('connect', r); setTimeout(r, 2500); });
  check('WebSocket 已连接', sock.connected);
  sock.on('crisis', (p) => { got.crisis = p; });
  sock.on('emergency', (p) => { got.emergency = p; });

  console.log('\n【D】场景一：情绪危机升级（短信/邮件/站内信/实时推送）');
  const t1 = await req('POST', '/api/alerts/demo-trigger', { token, body: { studentId, scenario: 'CRISIS' } });
  check('演示触发危机接口可用', t1.status === 201, 'HTTP ' + t1.status);
  await new Promise((r) => setTimeout(r, 1500));
  check('收到实时 crisis 推送', !!got.crisis);
  check('crisis 携带 CRITICAL 等级（前端据此升级为全屏弹窗）', got.crisis?.level === 'CRITICAL', got.crisis?.level || '-');

  console.log('\n【E】场景二：自残危险行为 → 紧急弹窗');
  const t2 = await req('POST', '/api/alerts/demo-trigger', { token, body: { studentId, scenario: 'SELF_HARM' } });
  check('演示触发自残接口可用', t2.status === 201, 'HTTP ' + t2.status);
  await new Promise((r) => setTimeout(r, 1800));
  check('收到实时 emergency 紧急弹窗推送', !!got.emergency);
  check('emergency 携带等级字段', !!got.emergency?.level, got.emergency?.level || 'undefined');
  sock.close();

  console.log('\n【F】三渠道触达日志');
  const logs = await req('GET', '/api/alerts/logs?studentId=' + studentId, { token });
  const arr = logs.json?.data || logs.json || [];
  const byCh = {};
  for (const l of arr) byCh[l.channel] = (byCh[l.channel] || 0) + 1;
  const okCh = {};
  for (const l of arr) if (l.status === 'SENT') okCh[l.channel] = true;
  check('短信渠道有投递记录', !!byCh.SMS, `${byCh.SMS || 0} 条`);
  check('邮件渠道有投递记录', !!byCh.EMAIL, `${byCh.EMAIL || 0} 条`);
  check('站内信渠道有投递记录', !!byCh.INAPP, `${byCh.INAPP || 0} 条`);
  check('邮件不再误报 FAILED（开发日志模式）', !!okCh.EMAIL);

  console.log('\n【G】监护人联系方式脱敏');
  const ct = await req('GET', '/api/alerts/contacts?studentId=' + studentId, { token });
  const c0 = (ct.json?.data || ct.json || [])[0];
  check('返回监护联系人', !!c0);
  check('手机号已脱敏', !!c0?.phone && c0.phone.includes('*'), c0?.phone || '-');
  check('邮箱已脱敏', !!c0?.email && c0.email.includes('*'), c0?.email || '-');

  console.log('\n【H】知情同意：撤回 / 重新签署');
  const rv = await req('POST', `/api/students/${studentId}/consent/revoke`, { token });
  check('撤回同意成功', rv.status === 200 || rv.status === 201, 'HTTP ' + rv.status);
  const rs = await req('POST', `/api/students/${studentId}/consent/re-sign`, { token });
  check('重新签署成功', rs.status === 200 || rs.status === 201, 'HTTP ' + rs.status);
  const recs = await req('GET', `/api/students/${studentId}/consent-records`, { token });
  const rr = recs.json?.data || recs.json || [];
  const actions = rr.map((r) => r.action);
  check('同意历史含 REVOKED', actions.includes('REVOKED'), actions.join(','));
  check('同意历史含 RESIGNED', actions.includes('RESIGNED'));

  console.log('\n【I】报告导出接口（PDF 由前端 html2canvas+jsPDF 生成，此处校验数据源）');
  const dash = await req('GET', `/api/reports/students/${studentId}/dashboard?period=WEEKLY&granularity=day`, { token });
  check('看板数据接口可用（PDF 数据源）', dash.status === 200, 'HTTP ' + dash.status);

  console.log('\n════════ 汇总 ════════');
  console.log(`通过 ${pass.length} 项，失败 ${fail.length} 项`);
  if (fail.length) { console.log('\n失败项：'); for (const f of fail) console.log('  ❌ ' + f); }

  try {
    await prisma.alertLog.deleteMany({ where: { studentId } });
    await prisma.consentRecord.deleteMany({ where: { studentId } });
    await prisma.safetyEvent.deleteMany({ where: { studentId } });
    await prisma.notification.deleteMany({ where: { studentId } }).catch(() => {});
    await prisma.student.deleteMany({ where: { id: studentId } });
    await prisma.user.deleteMany({ where: { account: { startsWith: 'fin_' } } });
    console.log('\n已清理测试数据');
  } catch (e) { console.log('清理告警:', e.message); }
  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
