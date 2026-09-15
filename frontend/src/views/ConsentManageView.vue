<template>
  <div class="cm">
    <header class="cm-head">
      <button class="back" @click="goBack">← 返回看板</button>
      <h1>📝 知情同意管理</h1>
      <span class="student-tag">{{ studentName }}</span>
    </header>

    <section class="card status-card">
      <h2>当前同意状态</h2>
      <div v-if="loading" class="hint">加载中…</div>
      <div v-else-if="current.valid" class="status-valid">
        <span class="dot ok"></span>
        <div>
          <div class="status-title">已签署监护人同意</div>
          <div class="status-sub">版本 {{ current.version }} · 签署于 {{ fmtDate(current.at) }}</div>
        </div>
      </div>
      <div v-else class="status-invalid">
        <span class="dot bad"></span>
        <div>
          <div class="status-title">尚未签署 / 已撤回同意</div>
          <div class="status-sub">危机升级与数据处理需监护人明确同意</div>
        </div>
      </div>

      <div class="actions">
        <button class="btn ghost" :disabled="busy || current.valid" @click="reSign">重新签署</button>
        <button class="btn danger" :disabled="busy || !current.valid" @click="revoke">撤回同意</button>
      </div>
      <p v-if="msg" class="msg" :class="msgType">{{ msg }}</p>
    </section>

    <section class="card history-card">
      <h2>知情同意记录历史</h2>
      <div v-if="loading" class="hint">加载中…</div>
      <div v-else-if="records.length === 0" class="empty">暂无记录</div>
      <ul v-else class="timeline">
        <li v-for="r in records" :key="r.id" class="tl-item">
          <span class="tl-dot" :class="'act-' + r.action.toLowerCase()"></span>
          <div class="tl-body">
            <div class="tl-top">
              <span class="tl-action" :class="'act-' + r.action.toLowerCase()">{{ actionLabel(r.action) }}</span>
              <span class="tl-version">版本 {{ r.version }}</span>
              <span class="tl-time">{{ fmtDate(r.createdAt) }}</span>
            </div>
            <div class="tl-guardian">操作人：{{ r.guardian.nickname }}（{{ roleLabel(r.guardian.role) }}）</div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '@/api';
import type { ConsentRecordView, Student } from '@/api/types';
import { useToast } from '@/composables/useToast';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const studentId = (route.params.studentId as string) || '';
const studentName = ref('');
const loading = ref(false);
const busy = ref(false);
const records = ref<ConsentRecordView[]>([]);
const current = reactive<{ valid: boolean; version?: string; at?: string }>({
  valid: false,
  version: undefined,
  at: undefined,
});
const msg = ref('');
const msgType = ref<'ok' | 'err'>('ok');

function actionLabel(a: string): string {
  return (
    { SIGNED: '签署同意', REVOKED: '撤回同意', RESIGNED: '重新签署' } as Record<string, string>
  )[a] || a;
}
function roleLabel(r: string): string {
  return ({ PARENT: '家长', TEACHER: '教师' } as Record<string, string>)[r] || r;
}
function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function load() {
  if (!studentId) return;
  loading.value = true;
  try {
    const [stuRes, recRes] = await Promise.all([
      api.getStudent(studentId).catch(() => null),
      api.consentApi.listRecords(studentId),
    ]);
    if (stuRes) studentName.value = (stuRes.data as Student).name || studentId;
    records.value = recRes.data;
    const latest = records.value[0];
    if (latest && (latest.action === 'SIGNED' || latest.action === 'RESIGNED')) {
      current.valid = true;
      current.version = latest.version;
      current.at = latest.createdAt;
    } else {
      current.valid = false;
      current.version = undefined;
      current.at = undefined;
    }
  } catch (e: any) {
    toast.error(e?.response?.data?.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function revoke() {
  if (!studentId) return;
  // 撤回同意会立即停止情绪/行为数据处理与危机升级推送，属高影响操作，需二次确认。
  const confirmed = window.confirm(
    '撤回知情同意后，系统将停止对该儿童的情绪与行为数据处理，' +
      '危机预警的短信/邮件/弹窗推送也会一并停止。\n\n确定要撤回吗？（之后可随时重新签署）',
  );
  if (!confirmed) return;
  busy.value = true;
  msg.value = '';
  try {
    await api.consentApi.revoke(studentId);
    current.valid = false;
    current.version = undefined;
    current.at = undefined;
    msg.value = '已撤回同意，危机升级与数据处理将停止。';
    msgType.value = 'ok';
    toast.success('已撤回同意');
    await load();
  } catch (e: any) {
    msg.value = e?.response?.data?.message || '撤回失败';
    msgType.value = 'err';
  } finally {
    busy.value = false;
  }
}

async function reSign() {
  if (!studentId) return;
  busy.value = true;
  msg.value = '';
  try {
    const { data } = await api.consentApi.reSign(studentId);
    current.valid = true;
    current.version = '1.0';
    current.at = data.consentAt;
    msg.value = '已重新签署同意（v1.0）。';
    msgType.value = 'ok';
    toast.success('已重新签署');
    await load();
  } catch (e: any) {
    msg.value = e?.response?.data?.message || '签署失败';
    msgType.value = 'err';
  } finally {
    busy.value = false;
  }
}

function goBack() {
  router.push('/parent/dashboard');
}

onMounted(load);
</script>

<style scoped>
.cm {
  max-width: 760px;
  margin: 0 auto;
  padding: 18px 16px 60px;
}
.cm-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.cm-head h1 { font-size: 20px; margin: 0; flex: 1; }
.back { color: #ff7a59; text-decoration: none; font-size: 14px; background: none; border: none; cursor: pointer; }
.student-tag { font-size: 13px; color: #fff; background: #ff7a59; border-radius: 10px; padding: 2px 10px; }
.card { background: #fff; border-radius: 14px; padding: 18px; margin-bottom: 16px; box-shadow: 0 2px 10px rgba(0,0,0,.05); }
.card h2 { font-size: 16px; margin: 0 0 12px; }
.hint, .empty { color: #aaa; text-align: center; padding: 16px; font-size: 14px; }

.status-valid, .status-invalid { display: flex; align-items: center; gap: 12px; }
.status-title { font-size: 15px; font-weight: 600; }
.status-sub { font-size: 12px; color: #888; }
.dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
.dot.ok { background: #2bb673; }
.dot.bad { background: #d05050; }
.actions { display: flex; gap: 12px; margin-top: 16px; }
.btn { min-height: 48px; padding: 0 22px; border-radius: 12px; font-size: 15px; font-weight: 700; cursor: pointer; border: 2px solid transparent; }
.btn.ghost { background: #fff; color: #ff7a59; border-color: #ff7a59; }
.btn.danger { background: #fff; color: #e74c3c; border-color: #e74c3c; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.msg { margin-top: 12px; font-size: 13px; }
.msg.ok { color: #2bb673; }
.msg.err { color: #e74c3c; }

.timeline { list-style: none; margin: 0; padding: 0 0 0 8px; }
.tl-item { position: relative; padding: 0 0 18px 22px; border-left: 2px solid #f0d3b3; }
.tl-item:last-child { border-left-color: transparent; }
.tl-dot { position: absolute; left: -7px; top: 2px; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; }
.tl-dot.act-signed { background: #2bb673; }
.tl-dot.act-resigned { background: #54a0ff; }
.tl-dot.act-revoked { background: #e74c3c; }
.tl-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tl-action { font-size: 14px; font-weight: 700; }
.tl-action.act-signed { color: #2bb673; }
.tl-action.act-resigned { color: #54a0ff; }
.tl-action.act-revoked { color: #e74c3c; }
.tl-version { font-size: 12px; color: #888; }
.tl-time { font-size: 12px; color: #aaa; }
.tl-guardian { font-size: 13px; color: #666; margin-top: 2px; }
</style>
