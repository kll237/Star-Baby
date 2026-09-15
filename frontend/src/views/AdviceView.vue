<template>
  <div class="pd pd-tone">
    <header class="pd-head pd-elevate">
      <div>
        <h1>🧠 专业心理建议与知识库</h1>
        <p class="sub">家长 / 教师视角 · 基于检测数据的循证干预建议 · 200+ 条特教知识库</p>
      </div>
      <router-link to="/parent/dashboard" class="back">← 返回数据看板</router-link>
    </header>

    <!-- 筛选条 -->
    <section class="filters card">
      <label>学生
        <select v-model="studentId" :disabled="loading">
          <option v-for="s in students" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label>周期
        <select v-model="period">
          <option value="DAILY">今日</option>
          <option value="WEEKLY">本周</option>
          <option value="MONTHLY">本月</option>
          <option value="CUSTOM">自定义</option>
        </select>
      </label>
      <template v-if="period === 'CUSTOM'">
        <label>从 <input type="date" v-model="fromD" /></label>
        <label>到 <input type="date" v-model="toD" /></label>
      </template>
      <label>对象
        <select v-model="target">
          <option value="ALL">全部</option>
          <option value="PARENT">家长</option>
          <option value="TEACHER">教师</option>
          <option value="STUDENT">学生</option>
        </select>
      </label>
      <button class="primary" :disabled="loading || !studentId || generating" @click="generate">
        {{ generating ? '生成中…' : '生成专业建议' }}
      </button>
    </section>

    <!-- 建议结果 -->
    <template v-if="advice">
      <section class="sev-banner" :class="sevClass(advice.result.severity)">
        <div class="sev-left">
          <span class="sev-dot" />
          <div>
            <div class="sev-title">整体状态：{{ sevLabel(advice.result.severity) }}</div>
            <div class="sev-sum">{{ advice.result.summary }}</div>
          </div>
        </div>
        <div class="sev-meta">
          <div>建议条目 {{ advice.result.topItems.length }}</div>
          <div>生成于 {{ fmt(advice.result.generatedAt) }}</div>
        </div>
      </section>

      <section class="card">
        <h2>分级干预建议</h2>
        <div v-if="advice.result.topItems.length === 0" class="empty">该周期数据不足，暂无可生成建议</div>
        <div
          v-for="(it, i) in advice.result.topItems"
          :key="i"
          class="ai-item"
        >
          <div class="ai-head">
            <span class="rank">#{{ i + 1 }}</span>
            <span class="cat" :title="it.category">{{ catLabel(it.category) }}</span>
            <span class="sev-tag" :class="sevClass(it.severity)">{{ sevLabel(it.severity) }}</span>
            <span class="ai-title">{{ it.title }}</span>
            <span v-if="it.source" class="src">· {{ it.source }}</span>
          </div>
          <div class="ai-content">{{ it.content }}</div>
          <div class="ai-reasons">
            <span v-for="(r, j) in it.matchReasons" :key="j" class="chip">{{ r }}</span>
            <span v-for="(t, j) in it.tags" :key="'t' + j" class="chip ghost">{{ t }}</span>
          </div>
        </div>
      </section>

      <section class="card" v-if="records.length">
        <h2>历史建议记录</h2>
        <table class="tbl">
          <thead>
            <tr><th>时间</th><th>严重度</th><th>摘要</th><th>条目</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in records" :key="r.id">
              <td>{{ fmt(r.createdAt) }}</td>
              <td><span class="sev-tag" :class="sevClass(r.severity)">{{ sevLabel(r.severity) }}</span></td>
              <td class="sum">{{ r.summary }}</td>
              <td>{{ r.itemCount }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <!-- 知识库检索 -->
    <section class="card">
      <div class="kb-head">
        <h2>📚 专业特教知识库</h2>
        <span class="kb-count">共 {{ kbTotal }} 条</span>
      </div>
      <div class="kb-filters">
        <input v-model="kw" placeholder="搜索关键词（标题/内容/标签）" @keyup.enter="searchKb" />
        <select v-model="kbCat" @change="searchKb">
          <option value="">全部分类</option>
          <option v-for="c in categories" :key="c" :value="c">{{ catLabel(c as any) }}</option>
        </select>
        <select v-model="kbSev" @change="searchKb">
          <option value="">全部严重度</option>
          <option value="LOW">低</option>
          <option value="MEDIUM">中</option>
          <option value="HIGH">高</option>
          <option value="CRITICAL">紧急</option>
        </select>
        <button class="ghost" @click="searchKb">搜索</button>
        <span class="spacer" />
        <button v-if="kbTotal === 0" class="primary" :disabled="seeding" @click="seed">
          {{ seeding ? '播种中…' : '初始化知识库' }}
        </button>
      </div>
      <div v-if="kbItems.length === 0 && !kbLoading" class="empty">无匹配条目</div>
      <div v-for="(it, i) in kbItems" :key="it.id || i" class="kb-item">
        <div class="kb-head2">
          <span class="cat">{{ catLabel(it.category) }}</span>
          <span class="sev-tag" :class="sevClass(it.severity)">{{ sevLabel(it.severity) }}</span>
          <span class="kb-title">{{ it.title }}</span>
          <span v-if="it.source" class="src">· {{ it.source }}</span>
        </div>
        <div class="kb-content">{{ it.content }}</div>
        <div class="ai-reasons">
          <span v-for="(t, j) in it.tags" :key="j" class="chip ghost">{{ t }}</span>
          <span v-if="it.reference" class="chip ghost">📖 {{ it.reference }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import api from '@/api';
import { useToast } from '@/composables/useToast';
import type {
  Student,
  GenerateAdviceResult,
  AdviceRecordView,
  KnowledgeView,
  KnowledgeCategory,
  AdviceSeverity,
  AdviceTarget,
} from '@/api/types';

const route = useRoute();

const students = ref<Student[]>([]);
const studentId = ref<string>('');
const period = ref<'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM'>('WEEKLY');
const target = ref<AdviceTarget>('ALL');
const fromD = ref('');
const toD = ref('');
const loading = ref(false);
const generating = ref(false);
const seeding = ref(false);
const error = ref('');
const toast = useToast();
watch(error, (v) => {
  if (v) toast.error(v);
});

const advice = ref<GenerateAdviceResult | null>(null);
const records = ref<AdviceRecordView[]>([]);

const categories: KnowledgeCategory[] = [
  'EMOTION_REGULATION', 'SOCIAL_SKILL', 'BEHAVIOR_INTERVENTION', 'SENSORY_INTEGRATION',
  'COMMUNICATION', 'FAMILY_LIFE', 'SCHOOL_ADAPTATION', 'CRISIS_INTERVENTION',
  'PARENT_GUIDANCE', 'TEACHER_STRATEGY', 'COGNITIVE_TRAINING', 'ROUTINE_BUILDING',
];

const CAT_LABELS: Record<KnowledgeCategory, string> = {
  EMOTION_REGULATION: '情绪调节', SOCIAL_SKILL: '社交技能', BEHAVIOR_INTERVENTION: '行为干预',
  SENSORY_INTEGRATION: '感觉统合', COMMUNICATION: '沟通表达', FAMILY_LIFE: '家庭生活',
  SCHOOL_ADAPTATION: '学校适应', CRISIS_INTERVENTION: '危机干预', PARENT_GUIDANCE: '家长指导',
  TEACHER_STRATEGY: '教师策略', COGNITIVE_TRAINING: '认知训练', ROUTINE_BUILDING: '常规建立',
};
function catLabel(c: KnowledgeCategory): string {
  return CAT_LABELS[c] || c;
}

const SEV_LABELS: Record<AdviceSeverity, string> = { LOW: '低', MEDIUM: '中', HIGH: '高', CRITICAL: '紧急' };
function sevLabel(s: AdviceSeverity): string {
  return SEV_LABELS[s] || s;
}
function sevClass(s: AdviceSeverity): string {
  return { LOW: 'low', MEDIUM: 'mid', HIGH: 'warn', CRITICAL: 'crit' }[s] || 'low';
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------------- 知识库 ----------------
const kbItems = ref<KnowledgeView[]>([]);
const kbTotal = ref(0);
const kbLoading = ref(false);
const kw = ref('');
const kbCat = ref('');
const kbSev = ref('');

async function searchKb() {
  kbLoading.value = true;
  try {
    const res = await api.listKnowledge({
      keyword: kw.value || undefined,
      category: kbCat.value || undefined,
      severity: (kbSev.value || undefined) as any,
      limit: 100,
    });
    kbItems.value = res.data.items;
    kbTotal.value = res.data.total;
  } catch (e: any) {
    error.value = '知识库加载失败：' + (e?.message || e);
  } finally {
    kbLoading.value = false;
  }
}

async function seed() {
  seeding.value = true;
  try {
    await api.seedKnowledge();
    await searchKb();
  } catch (e: any) {
    error.value = '知识库初始化失败：' + (e?.message || e);
  } finally {
    seeding.value = false;
  }
}

// ---------------- 建议生成 ----------------
async function generate() {
  if (!studentId.value) return;
  generating.value = true;
  error.value = '';
  try {
    const dto: any = { period: period.value, target: target.value };
    if (period.value === 'CUSTOM') {
      if (fromD.value) dto.from = new Date(fromD.value).toISOString();
      if (toD.value) dto.to = new Date(toD.value + 'T23:59:59').toISOString();
    }
    advice.value = (await api.generateAdvice(studentId.value, dto)).data;
    records.value = (await api.listAdviceRecords(studentId.value)).data;
  } catch (e: any) {
    error.value = '生成建议失败：' + (e?.response?.data?.message || e?.message || e);
    advice.value = null;
  } finally {
    generating.value = false;
  }
}

async function loadStudents() {
  try {
    students.value = (await api.listStudents()).data;
    const q = route.query.studentId as string | undefined;
    if (q) studentId.value = q;
    else if (!studentId.value && students.value.length) studentId.value = students.value[0].id;
  } catch (e: any) {
    error.value = '加载学生列表失败：' + (e?.message || e);
  }
}

onMounted(async () => {
  await loadStudents();
  await searchKb();
  if (studentId.value) await generate();
});
</script>

<style scoped>
.pd {
  max-width: 1080px;
  margin: 0 auto;
  padding: 18px 16px 60px;
  color: #2c2c2c;
  position: relative;
  min-height: 100vh;
}
/* 专业建议：与其他图同色系（暖紫粉橙渐变） */
.pd-tone {
  background:
    radial-gradient(ellipse at top left,
      rgba(255, 220, 235, 0.55) 0%,
      rgba(255, 220, 235, 0) 60%),
    radial-gradient(ellipse at top right,
      rgba(255, 210, 175, 0.45) 0%,
      rgba(255, 210, 175, 0) 60%),
    radial-gradient(ellipse at bottom right,
      rgba(215, 180, 240, 0.40) 0%,
      rgba(215, 180, 240, 0) 60%),
    linear-gradient(135deg,
      #fde4ec 0%,
      #fbe1d4 35%,
      #eedcf3 70%,
      #e8d6f3 100%);
  background-attachment: fixed;
}
.pd-elevate {
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(8px);
  border-radius: 14px;
  padding: 12px 16px;
  margin-bottom: 14px;
  box-shadow: 0 6px 18px rgba(120, 70, 160, 0.10);
}
.pd > .filters,
.pd > section.card {
  background: rgba(255, 255, 255, 0.88) !important;
  backdrop-filter: blur(6px);
  position: relative;
  z-index: 1;
}
.pd-head {
  position: relative;
  z-index: 1;
}
.pd-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.pd-head h1 { font-size: 22px; margin: 0; }
.sub { color: #888; margin: 4px 0 0; font-size: 13px; }
.back { color: #ff7a59; text-decoration: none; font-size: 14px; }
.card { background: #fff; border-radius: 14px; padding: 16px; margin: 14px 0; box-shadow: 0 2px 10px rgba(0,0,0,.05); }
.filters { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.filters label { font-size: 13px; color: #666; display: flex; gap: 6px; align-items: center; }
.filters select, .filters input { padding: 6px 8px; border: 1px solid #e2e2e2; border-radius: 8px; font-size: 13px; }
.spacer { flex: 1; }
button { cursor: pointer; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; }
button.primary { background: #ff7a59; color: #fff; }
button.ghost { background: #f1f3f5; color: #444; }
button:disabled { opacity: .6; cursor: not-allowed; }
.err { color: #d6453d; background: #fdecea; padding: 10px 12px; border-radius: 8px; }
.empty { color: #aaa; text-align: center; padding: 18px; font-size: 14px; }

.sev-banner { display: flex; justify-content: space-between; align-items: center; border-radius: 14px; padding: 16px; margin: 14px 0; color: #fff; }
.sev-banner.low { background: linear-gradient(135deg,#4a90e2,#5cb3ff); }
.sev-banner.mid { background: linear-gradient(135deg,#e6a23c,#f0c97a); }
.sev-banner.warn { background: linear-gradient(135deg,#e8773c,#f5a25d); }
.sev-banner.crit { background: linear-gradient(135deg,#d6453d,#e8675f); }
.sev-left { display: flex; gap: 12px; align-items: center; }
.sev-dot { width: 14px; height: 14px; border-radius: 50%; background: #fff; opacity: .9; }
.sev-title { font-weight: 700; font-size: 16px; }
.sev-sum { font-size: 13px; opacity: .95; margin-top: 4px; max-width: 720px; line-height: 1.5; }
.sev-meta { font-size: 12px; opacity: .9; text-align: right; white-space: nowrap; }

.ai-item, .kb-item { border: 1px solid #f0f0f0; border-radius: 12px; padding: 12px 14px; margin: 10px 0; background: #fafbfc; }
.ai-head, .kb-head2 { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.rank { font-weight: 700; color: #ff7a59; }
.cat { font-size: 12px; background: #eef3ff; color: #3b6fd4; padding: 2px 8px; border-radius: 6px; }
.ai-title, .kb-title { font-weight: 600; font-size: 15px; }
.src { color: #999; font-size: 12px; }
.ai-content, .kb-content { margin: 8px 0; font-size: 14px; line-height: 1.6; color: #444; }
.sev-tag { font-size: 12px; padding: 2px 8px; border-radius: 6px; color: #fff; }
.sev-tag.low { background: #4a90e2; }
.sev-tag.mid { background: #e6a23c; }
.sev-tag.warn { background: #e8773c; }
.sev-tag.crit { background: #d6453d; }
.ai-reasons { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { font-size: 12px; background: #fff3ee; color: #d2603f; padding: 3px 8px; border-radius: 6px; }
.chip.ghost { background: #f1f3f5; color: #888; }

.kb-head { display: flex; justify-content: space-between; align-items: center; }
.kb-count { color: #999; font-size: 13px; }
.kb-filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 12px 0; }
.kb-filters input, .kb-filters select { padding: 6px 8px; border: 1px solid #e2e2e2; border-radius: 8px; font-size: 13px; }
.kb-filters input { flex: 1; min-width: 200px; }

.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th, .tbl td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #f0f0f0; }
.tbl .sum { color: #666; max-width: 520px; }
</style>
