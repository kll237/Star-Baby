// 验证 WebSocket 流式：连接 /chat 命名空间，发消息，看 reply_chunk 顺序
import { io } from 'socket.io-client';

const API = 'http://localhost:3300';

async function getToken() {
  const r = await fetch(API + '/api/face/demo-student-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return (await r.json()).accessToken;
}

async function getStudentId(token) {
  const r = await fetch(API + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
  return (await r.json()).id;
}

(async () => {
  const token = await getToken();
  const studentId = await getStudentId(token);
  console.log('studentId:', studentId);

  const socket = io(API + '/chat', { auth: { token }, transports: ['websocket'] });
  await new Promise((r) => socket.on('ready', r));
  console.log('WS ready');

  // 准备：开一个会话
  const sc = await (await fetch(API + '/api/chat/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ studentId, triggerSource: 'MANUAL' })
  })).json();
  const sid = sc.session.id;
  console.log('session:', sid);

  // 监听流
  const chunks = [];
  const start = Date.now();
  socket.on('user_echo', (p) => console.log('  user_echo:', p.userMessage.content));
  socket.on('reply_chunk', (p) => {
    chunks.push({ t: Date.now() - start, delta: p.delta, done: p.done });
  });
  socket.on('reply', (p) => {
    console.log('  reply done at', Date.now() - start, 'ms, final:', p.assistantMessage.content.slice(0, 50));
  });

  // 发送
  console.log('--- send message ---');
  socket.emit('message', { sessionId: sid, content: '讲个故事' });
  await new Promise((r) => setTimeout(r, 5000));
  console.log('\n=== chunks timeline ===');
  for (const c of chunks) console.log(`  +${c.t}ms  done=${c.done}  delta="${c.delta}"`);
  console.log(`\n总计 ${chunks.length} 个 chunk，总耗时 ${chunks[chunks.length-1].t}ms`);
  socket.disconnect();
})();