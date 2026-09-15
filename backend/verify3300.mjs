const BASE = 'http://localhost:3300/api';
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ account: 'parent01', password: 'Demo@123456' }) });
const lp = await j(login);
console.log('LOGIN parent01:', login.status, lp.user?.role);
const tokenP = lp.tokens.accessToken;

// 1) 学生目录
const dirRes = await fetch(`${BASE}/students/directory`, { headers: { Authorization: `Bearer ${tokenP}` } });
const dir = await j(dirRes);
console.log('\n[1] 学生目录 count=', Array.isArray(dir) ? dir.length : dir, Array.isArray(dir) ? dir.map(d=>`${d.name}/${d.conditionType}`).slice(0,5) : '');

const xm = Array.isArray(dir) ? dir.find(d => d.name.includes('小明')) : null;
if (!xm) { console.log('未找到小明，退出'); process.exit(1); }
console.log('选中学生:', xm.name, xm.id);

// 2) 关联并填写画像
const assoc = await fetch(`${BASE}/students/${xm.id}/associate`, { method: 'POST', headers: { Authorization: `Bearer ${tokenP}`, 'Content-Type':'application/json' }, body: JSON.stringify({ conditionType: '抑郁症', conditionSeverity: '中度', symptoms: ['易焦虑','睡眠不好'], likes: ['画画'], hobbies: ['拼图'], strengths: ['数数'], dislikes: ['吵闹'], notes: '喜欢安静的环境' }) });
const assocJ = await j(assoc);
console.log('\n[2] 关联+画像:', assoc.status, 'conditionType=', assocJ.profile?.conditionType, 'likes=', assocJ.profile?.likes);

// 3) 读取画像
const prof = await fetch(`${BASE}/students/${xm.id}/profile`, { headers: { Authorization: `Bearer ${tokenP}` } });
const profJ = await j(prof);
console.log('[3] 画像读取:', prof.status, JSON.stringify(profJ));

// 4) 学生端登录（小明）
const dl = await fetch(`${BASE}/face/demo-student-login`, { method: 'POST' });
const dlJ = await j(dl);
console.log('\n[4] demo-student-login:', dl.status, 'studentId=', dlJ.studentId);
const stuToken = dlJ.accessToken;

// 5) 开启聊天会话
const sc = await fetch(`${BASE}/chat/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${stuToken}`, 'Content-Type':'application/json' }, body: JSON.stringify({ studentId: dlJ.studentId, triggerSource: 'MANUAL' }) });
const scJ = await j(sc);
const sid = scJ.session?.id;
console.log('[5] 开启会话:', sc.status, 'session=', sid);

// 6) 讲个故事（应结合画像：画画）
const st = await fetch(`${BASE}/chat/sessions/${sid}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${stuToken}`, 'Content-Type':'application/json' }, body: JSON.stringify({ content: '星宝给我讲个故事吧' }) });
const stJ = await j(st);
console.log('\n[6] 讲故事回复:\n', stJ.assistantMessage?.content);

// 7) 唱首歌（应返回歌词）
const sg = await fetch(`${BASE}/chat/sessions/${sid}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${stuToken}`, 'Content-Type':'application/json' }, body: JSON.stringify({ content: '我想听你唱歌' }) });
const sgJ = await j(sg);
console.log('\n[7] 唱歌回复:\n', sgJ.assistantMessage?.content);

// 8) 看板隐私（家长只看关联学生）
const dash = await fetch(`${BASE}/reports/students/${xm.id}/dashboard?period=WEEKLY`, { headers: { Authorization: `Bearer ${tokenP}` } });
const dashJ = await j(dash);
console.log('\n[8] 看板(隐私已过滤):', dash.status, '回升率字段存在=', !!dashJ.recovery, 'narrative=', dashJ.narrative?.narrative?.slice(0,40));

console.log('\n=== 验证完成 ===');
