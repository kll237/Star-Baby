<template>
  <div class="pd pd-with-bg" :style="{ backgroundImage: `url(${bgUrl})` }">
    <div class="pd-bg-overlay"></div>
    <header class="pd-head pd-elevate">
      <div>
        <h1>📊 情绪与干预数据看板</h1>
        <p class="sub">家长 / 教师视角 · 情绪趋势 · 风险事件 · 安抚与干预效果</p>
      </div>
      <div style="display: flex; gap: 8px; align-items: center">
        <NotificationBell ref="notifBell" />
        <router-link to="/deskpet" class="back" style="text-decoration: none">🐾 桌面星宝</router-link>
        <router-link to="/dashboard" class="back">← 返回概览</router-link>
      </div>
    </header>

    <!-- 筛选条 -->
    <section class="filters card">
      <label>
        学生
        <select v-model="studentId" :disabled="loading">
          <option v-for="s in students" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label>
        周期
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
      <label>
        粒度
        <select v-model="granularity">
          <option value="day">按天</option>
          <option value="week">按周</option>
          <option value="month">按月</option>
        </select>
      </label>
      <button class="primary" :disabled="loading || !studentId" @click="load">刷新</button>
      <span class="spacer" />
      <button class="ghost" :disabled="!studentId" @click="exportAs('CSV')">导出 CSV</button>
      <button class="ghost" :disabled="!studentId" @click="exportAs('JSON')">导出 JSON</button>
      <button
        class="primary sm"
        style="background:#e74c3c"
        :disabled="!studentId || !!demoLoading"
        @click="triggerDemo('CRISIS')"
      >
        {{ demoLoading === 'CRISIS' ? '触发中…' : '🚨 演示触发危机' }}
      </button>
      <button
        class="primary sm"
        style="background:#8e44ad"
        :disabled="!studentId || !!demoLoading"
        @click="triggerDemo('SELF_HARM')"
      >
        {{ demoLoading === 'SELF_HARM' ? '触发中…' : '🆘 演示自残紧急' }}
      </button>
      <button class="ghost sm" :disabled="!studentId || pdfBusy" @click="exportReportPdf('WEEKLY')">
        {{ pdfBusy ? '生成中…' : '导出周报 PDF' }}
      </button>
      <button class="ghost sm" :disabled="!studentId || pdfBusy" @click="exportReportPdf('MONTHLY')">
        {{ pdfBusy ? '生成中…' : '导出月报 PDF' }}
      </button>
    </section>

    <StateBlock
      v-if="error || loading"
      :state="error ? 'error' : 'loading'"
      loading-text="正在加载数据看板…"
      error-text="看板加载失败"
      @retry="load"
    />

    <template v-if="dash && !loading && !error">
      <!-- 关键指标卡片 -->
      <section class="kpis">
        <div class="kpi card">
          <div class="k-label">平均情绪状态</div>
          <div class="k-value" :class="scoreClass(dash.summary.avgCompositeScore)">
            {{ dash.summary.avgCompositeScore.toFixed(1) }}
          </div>
          <div class="k-foot">满分 100</div>
        </div>
        <div class="kpi card">
          <div class="k-label">负面情绪占比</div>
          <div class="k-value" :class="scoreClass(100 - dash.summary.negativeRatio * 100)">
            {{ (dash.summary.negativeRatio * 100).toFixed(1) }}%
          </div>
          <div class="k-foot">{{ dash.summary.negativeCount }} / {{ dash.summary.frameCount }} 帧</div>
        </div>
        <div class="kpi card">
          <div class="k-label">风险负向段</div>
          <div class="k-value warn">{{ dash.riskBursts.length }}</div>
          <div class="k-foot">需关注的情绪低谷</div>
        </div>
        <div class="kpi card">
          <div class="k-label">安抚会话</div>
          <div class="k-value">{{ dash.comfortStats.sessionCount }}</div>
          <div class="k-foot">其中检测触发 {{ dash.intervention.comfortTriggered }}</div>
        </div>
        <div class="kpi card">
          <div class="k-label">干预覆盖率</div>
          <div class="k-value" :class="dash.intervention.coverageRate >= 1 ? 'good' : 'warn'">
            {{ (dash.intervention.coverageRate * 100).toFixed(0) }}%
          </div>
          <div class="k-foot">负面段 → 安抚触发</div>
        </div>
        <div class="kpi card">
          <div class="k-label">情绪回升率</div>
          <div class="k-value" :class="dash.recovery.recoveryRate >= 0.5 ? 'good' : 'mid'">
            {{ dash.recovery.episodes ? (dash.recovery.recoveryRate * 100).toFixed(0) + '%' : '—' }}
          </div>
          <div class="k-foot">{{ dash.recovery.recovered }}/{{ dash.recovery.episodes }} 次安抚后好转</div>
        </div>
        <div class="kpi card">
          <div class="k-label">风险分级</div>
          <div class="k-value warn">
            <span style="color:#d9603b">{{ dash.riskLevels.red }}</span> /
            <span style="color:#e8833a">{{ dash.riskLevels.orange }}</span> /
            <span style="color:#caa400">{{ dash.riskLevels.yellow }}</span>
          </div>
          <div class="k-foot">红 / 橙 / 黄 事件数</div>
        </div>
      </section>

      <!-- 聊天陪伴概览（近 30 天） -->
      <section class="card summary-card" v-if="summary">
        <h2>💬 聊天陪伴概览（近 30 天）</h2>
        <div class="sum-grid">
          <div class="sum-item">
            <div class="sum-num">{{ summary.totalSessions }}</div>
            <div class="sum-lbl">安抚会话</div>
          </div>
          <div class="sum-item" :class="summary.crisisEvents > 0 ? 'warn' : 'good'">
            <div class="sum-num">{{ summary.crisisEvents }}</div>
            <div class="sum-lbl">危机预警</div>
          </div>
          <div class="sum-item">
            <div class="sum-num small">{{ summary.lastActiveAt ? fmtDate(summary.lastActiveAt) : '—' }}</div>
            <div class="sum-lbl">最近活跃</div>
          </div>
        </div>
        <div v-if="summary.techniqueBreakdown.length" class="sum-tech">
          <span class="sum-tech-title">常用安抚技术：</span>
          <span v-for="t in summary.techniqueBreakdown" :key="t.technique || 'unknown'" class="chip">
            {{ t.technique || '未标注' }} ×{{ t._count }}
          </span>
        </div>
        <p v-else class="profile-note">近 30 天暂无安抚对话记录。</p>
      </section>

      <!-- 学生基础画像（关联时填写，用于星宝针对性安抚） -->
      <section class="card profile-card" v-if="profile">
        <div class="profile-head">
          <h2>🧸 学生基础画像</h2>
          <button class="ghost sm" @click="router.push(`/students/${studentId}/profile`)">编辑画像</button>
        </div>
        <div class="profile-row">
          <span class="pl">基础状况</span>
          <span class="pv">
            {{ profile.conditionType || '其他' }}
            <template v-if="profile.conditionSeverity && profile.conditionSeverity !== '未知'">（{{ profile.conditionSeverity }}）</template>
          </span>
        </div>
        <template v-if="profile.symptoms?.length">
          <div class="profile-row"><span class="pl">其他症状</span><span class="pv"><span v-for="t in profile.symptoms" :key="t" class="chip">{{ t }}</span></span></div>
        </template>
        <template v-if="profile.likes?.length">
          <div class="profile-row"><span class="pl">喜欢</span><span class="pv"><span v-for="t in profile.likes" :key="t" class="chip like">{{ t }}</span></span></div>
        </template>
        <template v-if="profile.hobbies?.length">
          <div class="profile-row"><span class="pl">爱好</span><span class="pv"><span v-for="t in profile.hobbies" :key="t" class="chip like">{{ t }}</span></span></div>
        </template>
        <template v-if="profile.strengths?.length">
          <div class="profile-row"><span class="pl">擅长</span><span class="pv"><span v-for="t in profile.strengths" :key="t" class="chip good">{{ t }}</span></span></div>
        </template>
        <template v-if="profile.dislikes?.length">
          <div class="profile-row"><span class="pl">不喜欢</span><span class="pv"><span v-for="t in profile.dislikes" :key="t" class="chip bad">{{ t }}</span></span></div>
        </template>
        <template v-if="profile.notes">
          <div class="profile-row"><span class="pl">补充</span><span class="pv">{{ profile.notes }}</span></div>
        </template>
        <p class="profile-note">星宝会依据画像进行「针对性」安抚、讲故事与唱歌。</p>
      </section>
      <section class="card profile-card empty" v-else>
        <div class="profile-head">
          <h2>🧸 学生基础画像</h2>
          <button class="ghost sm" @click="router.push(`/students/${studentId}/profile`)">填写画像</button>
        </div>
        <p class="profile-note">尚未填写基础画像。填写后，星宝可按孩子的病情与喜好进行针对性安抚。</p>
      </section>

      <!-- 趋势图 -->
      <section class="card">
        <h2>情绪趋势（{{ granularityText }}）</h2>
        <div v-if="dash.trend.length === 0" class="empty">该周期暂无检测数据</div>
        <svg v-else :viewBox="`0 0 ${W} ${H}`" class="trend" preserveAspectRatio="none">
          <line :x1="0" :x2="W" :y1="H - PAD" :y2="H - PAD" class="axis" />
          <line :x1="0" :x2="W" :y1="midY" :y2="midY" class="axis faint" />
          <path :d="scorePath" class="line-score" />
          <path :d="negPath" class="line-neg" />
          <circle
            v-for="(p, i) in scorePts"
            :key="'s' + i"
            :cx="p.x"
            :cy="p.y"
            r="3"
            class="dot-score"
          />
        </svg>
        <div class="legend">
          <span class="lg score">● 平均情绪状态</span>
          <span class="lg neg">● 负面占比</span>
        </div>
      </section>

      <div class="grid2">
        <!-- 情绪主导分布 -->
        <section class="card">
          <h2>主导情绪分布</h2>
          <div v-if="Object.keys(dash.summary.dominantDistribution).length === 0" class="empty">无数据</div>
          <div v-for="(val, key) in dash.summary.dominantDistribution" :key="key" class="bar-row">
            <span class="bar-label">{{ emotionLabel(key) }}</span>
            <span class="bar-track">
              <span class="bar-fill" :style="{ width: pct(val, maxDom) + '%' }" />
            </span>
            <span class="bar-val">{{ val }}</span>
          </div>
        </section>

        <!-- 行为频次 -->
        <section class="card">
          <h2>行为频次</h2>
          <div v-if="Object.keys(dash.behaviorStats).length === 0" class="empty">无行为事件</div>
          <div v-for="(val, key) in dash.behaviorStats" :key="key" class="bar-row">
            <span class="bar-label">{{ behaviorLabel(key as string) }}</span>
            <span class="bar-track">
              <span class="bar-fill alt" :style="{ width: pct(val.count, maxBeh) + '%' }" />
            </span>
            <span class="bar-val">{{ val.count }}（{{ (val.avgConfidence * 100).toFixed(0) }}%）</span>
          </div>
        </section>
      </div>

      <!-- 风险事件 -->
      <section class="card">
        <h2>风险事件（连续负向情绪段）</h2>
        <div v-if="dash.riskBursts.length === 0" class="empty">该周期未检测到明显风险事件 🎉</div>
        <table v-else class="tbl">
          <thead>
            <tr><th>起始</th><th>时长</th><th>帧数</th><th>峰值负向分</th><th>平均状态分</th><th>主导情绪</th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in dash.riskBursts" :key="i">
              <td>{{ fmt(r.start) }}</td>
              <td>{{ r.durationSec }}s</td>
              <td>{{ r.frameCount }}</td>
              <td :class="r.peakNegativeScore < 40 ? 'warn' : ''">{{ r.peakNegativeScore.toFixed(1) }}</td>
              <td>{{ r.avgCompositeScore.toFixed(1) }}</td>
              <td>{{ emotionLabel(r.dominant) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 安抚与干预效果 -->
      <section class="card">
        <h2>安抚与干预效果</h2>
        <div class="interv">
          <div class="iv-item">
            <div class="iv-num">{{ dash.comfortStats.sessionCount }}</div>
            <div class="iv-lbl">安抚会话总数</div>
          </div>
          <div class="iv-item">
            <div class="iv-num">{{ dash.comfortStats.endedCount }}</div>
            <div class="iv-lbl">已结束</div>
          </div>
          <div class="iv-item">
            <div class="iv-num">{{ dash.comfortStats.avgMessageCount.toFixed(1) }}</div>
            <div class="iv-lbl">平均对话轮次</div>
          </div>
          <div class="iv-item">
            <div class="iv-num">{{ dash.intervention.comfortTriggered }}</div>
            <div class="iv-lbl">检测自动触发</div>
          </div>
        </div>
        <div class="coverage">
          <div class="cov-label">干预覆盖率（风险负向段中获得安抚的比例）</div>
          <div class="cov-track">
            <div class="cov-fill" :class="dash.intervention.coverageRate >= 1 ? 'good' : 'warn'"
                 :style="{ width: (dash.intervention.coverageRate * 100) + '%' }" />
          </div>
          <div class="cov-text">
            {{ dash.intervention.negativeBursts }} 段风险 · {{ dash.intervention.comfortTriggered }} 段已触达 ·
            覆盖率 {{ (dash.intervention.coverageRate * 100).toFixed(0) }}%
          </div>
        </div>
        <div class="src">
          <span class="src-title">触发来源：</span>
          <span v-for="(v, k) in dash.comfortStats.triggerSourceDistribution" :key="k" class="chip">
            {{ k === 'DETECTION' ? '检测触发' : k === 'MANUAL' ? '手动发起' : k }} ×{{ v }}
          </span>
        </div>
      </section>

      <!-- 特征 6：自然语言周报 -->
      <section class="card narrative">
        <h2>📝 一句话周报（可直接转发家长）</h2>
        <div class="nar-actions">
          <button class="ghost sm" :disabled="streaming || !dash" @click="streamNarrative">
            {{ streaming ? '生成中…' : '⚡ 流式生成' }}
          </button>
          <button v-if="streaming" class="ghost sm" @click="stopStream">停止</button>
        </div>
        <p v-if="streamingNarrative" class="nar-text nar-stream">{{ streamingNarrative }}<span v-if="streaming" class="caret">▋</span></p>
        <template v-else>
          <p class="nar-text">{{ dash.narrative.narrative || '该周期暂无可汇总的数据。' }}</p>
          <ul v-if="dash.narrative.highlights.length" class="nar-list">
            <li v-for="(h, i) in dash.narrative.highlights" :key="i">{{ h }}</li>
          </ul>
        </template>
      </section>

      <!-- 特征 7：风险分级总结 -->
      <section class="card">
        <h2>风险分级总结</h2>
        <div v-if="dash.riskLevels.total === 0" class="empty">该周期未记录到风险行为 🎉</div>
        <div v-else>
          <div class="risk-bars">
            <div class="rb-row">
              <span class="rb-label" style="color:#d9603b">红色（紧急）</span>
              <span class="rb-track"><span class="rb-fill" style="background:#d9603b" :style="{ width: pct(dash.riskLevels.red, dash.riskLevels.total) + '%' }" /></span>
              <span class="rb-val">{{ dash.riskLevels.red }}</span>
            </div>
            <div class="rb-row">
              <span class="rb-label" style="color:#e8833a">橙色（需介入）</span>
              <span class="rb-track"><span class="rb-fill" style="background:#e8833a" :style="{ width: pct(dash.riskLevels.orange, dash.riskLevels.total) + '%' }" /></span>
              <span class="rb-val">{{ dash.riskLevels.orange }}</span>
            </div>
            <div class="rb-row">
              <span class="rb-label" style="color:#caa400">黄色（关注）</span>
              <span class="rb-track"><span class="rb-fill" style="background:#f1c40f" :style="{ width: pct(dash.riskLevels.yellow, dash.riskLevels.total) + '%' }" /></span>
              <span class="rb-val">{{ dash.riskLevels.yellow }}</span>
            </div>
          </div>
          <div class="top-risk">
            <span class="src-title">高频风险行为：</span>
            <span v-for="b in dash.riskLevels.topBehaviors.slice(0, 6)" :key="b.behavior" class="chip"
                  :style="{ borderColor: b.level === 'red' ? '#d9603b' : b.level === 'orange' ? '#e8833a' : '#f1c40f' }">
              {{ b.label }} ×{{ b.count }}
            </span>
          </div>
        </div>
      </section>

      <!-- 危机安全事件（闭环留痕） -->
      <section class="card safety-card">
        <div class="safety-head">
          <h2>🚨 危机安全事件</h2>
          <label class="chk"><input type="checkbox" v-model="safetyUnackOnly" @change="loadSafety" /> 仅看未处理</label>
        </div>
        <div v-if="safetyLoading" class="hint">加载中…</div>
        <div v-else-if="safetyEvents.length === 0" class="empty">暂无危机安全事件记录 🎉</div>
        <ul v-else class="safety-list">
          <li v-for="ev in safetyEvents" :key="ev.id" class="safety-item" :class="'lv-' + ev.level.toLowerCase()">
            <div class="safety-row">
              <span class="safety-level" :class="'lv-' + ev.level.toLowerCase()">{{ levelLabel(ev.level) }}</span>
              <span class="safety-time">{{ fmt(ev.createdAt) }}</span>
              <span v-if="ev.acknowledged" class="safety-ack">已处理</span>
            </div>
            <div class="safety-src"><b>触发原文：</b>{{ ev.sourceText }}</div>
            <div class="safety-reply"><b>星宝回应：</b>{{ ev.replySummary }}</div>
            <div v-if="ev.note" class="safety-note"><b>处置备注：</b>{{ ev.note }}</div>
            <div class="safety-actions" v-if="!ev.acknowledged">
              <input class="safety-input" v-model="ev.note" placeholder="处置备注（可选）" />
              <button class="primary sm" :disabled="ackBusy[ev.id]" @click="ackEvent(ev)">标记已处理</button>
            </div>
          </li>
        </ul>
      </section>

      <!-- 知情同意状态 -->
      <section class="card consent-card">
        <div class="consent-head">
          <h2>📝 知情同意状态</h2>
          <button class="ghost sm" @click="goConsent">管理知情同意</button>
        </div>
        <div v-if="consentLoading" class="hint">加载中…</div>
        <div v-else-if="currentConsent.valid" class="consent-valid">
          <span class="dot ok"></span> 已签署监护人同意（版本 {{ currentConsent.version }}）
          <span class="consent-time" v-if="currentConsent.at">· 签署于 {{ fmtDate(currentConsent.at) }}</span>
        </div>
        <div v-else class="consent-invalid">
          <span class="dot bad"></span> 尚未签署 / 已撤回同意
        </div>
        <p class="profile-note">在危机升级与数据处理前，需获得监护人明确同意。可在管理页查看记录历史，或撤回 / 重新签署。</p>
      </section>

      <!-- 触达记录 / Alert Logs -->
      <section class="card alertlog-card">
        <div class="alertlog-head">
          <h2>📨 触达记录（短信 / 邮件 / 站内信）</h2>
          <button class="ghost sm" :disabled="alertLogsLoading" @click="loadAlertLogs">刷新</button>
        </div>
        <div v-if="alertLogsLoading" class="hint">加载中…</div>
        <div v-else-if="alertLogs.length === 0" class="empty">暂无触达记录 🎉</div>
        <table v-else class="tbl">
          <thead>
            <tr><th>渠道</th><th>等级</th><th>标题</th><th>状态</th><th>时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="log in alertLogs" :key="log.id">
              <td>{{ channelLabel(log.channel) }}</td>
              <td>{{ levelLabel(log.level) }}</td>
              <td class="log-title">{{ log.title }}</td>
              <td>
                <span class="status" :class="log.status === 'SENT' ? 'st-sent' : log.status === 'FAILED' ? 'st-failed' : 'st-pending'">
                  {{ statusLabel(log.status) }}
                </span>
                <span v-if="log.status === 'FAILED' && log.error" class="log-err" :title="log.error">⚠</span>
              </td>
              <td>{{ fmt(log.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, reactive } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '@/api';
import type {
  Student,
  DashboardData,
  StudentProfile,
  ChatSummary,
  SafetyEventView,
  AlertLogView,
} from '@/api/types';
import { EMOTION_LABELS, BEHAVIOR_LABELS, EMOTION_EMOJI } from '@/utils/behavior';
import NotificationBell from '@/components/NotificationBell.vue';
import StateBlock from '@/components/StateBlock.vue';
import { useToast } from '@/composables/useToast';
import { useNotifyStore } from '@/store/notify';
import { connectAlerts, disconnectAlerts } from '@/utils/alerts';

const route = useRoute();
const router = useRouter();
// 背景图（用户上传素材）
const bgUrl = '/backgrounds/bg-workbench.jpg';
const W = 600;
const H = 220;
const PAD = 24;
const midY = H / 2;

const students = ref<Student[]>([]);
const studentId = ref<string>('');
const period = ref<'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM'>('WEEKLY');
const granularity = ref<'day' | 'week' | 'month'>('day');
const fromD = ref('');
const toD = ref('');
const loading = ref(false);
const error = ref('');
const toast = useToast();
const notify = useNotifyStore();
watch(error, (v) => {
  if (v) toast.error(v);
});
const dash = ref<DashboardData | null>(null);
const profile = ref<StudentProfile | null>(null);

// 情绪分析报告 SSE 流式输出（与 WebSocket 告警通道形成双通道）
const streamingNarrative = ref('');
const streaming = ref(false);
let streamAbort: AbortController | null = null;

// 聊天陪伴概览（近 30 天）
const summary = ref<ChatSummary | null>(null);
// 危机安全事件（闭环留痕）
const safetyEvents = ref<SafetyEventView[]>([]);
const safetyUnackOnly = ref(false);
const safetyLoading = ref(false);
const ackBusy = reactive<Record<string, boolean>>({});
const notifBell = ref<InstanceType<typeof NotificationBell> | null>(null);

// 演示触发危机（值为当前正在触发的场景，null 表示空闲）
const demoLoading = ref<'CRISIS' | 'SELF_HARM' | null>(null);
// 触达记录
const alertLogs = ref<AlertLogView[]>([]);
const alertLogsLoading = ref(false);
// 知情同意状态
const consentLoading = ref(false);
const currentConsent = reactive<{ valid: boolean; version?: string; at?: string }>({
  valid: false,
  version: undefined,
  at: undefined,
});

async function loadProfile() {
  if (!studentId.value) {
    profile.value = null;
    return;
  }
  try {
    profile.value = (await api.getStudentProfile(studentId.value)).data;
  } catch {
    profile.value = null;
  }
}

/**
 * 订阅后端 SSE 端点（reports/students/:id/analysis-stream），以流式方式渲染
 * 情绪分析报告。EventSource 无法携带 Authorization 头，这里用 fetch + 流式
 * 读取（同样消费 text/event-stream），按 `data:` 帧累加文本，收到 [DONE] 结束。
 */
async function streamNarrative() {
  if (!studentId.value || streaming.value) return;
  streaming.value = true;
  streamingNarrative.value = '';
  streamAbort = new AbortController();
  const token = localStorage.getItem('sp_token');
  const params = new URLSearchParams({ period: period.value, granularity: granularity.value });
  if (fromD.value) params.set('from', fromD.value);
  if (toD.value) params.set('to', toD.value);
  try {
    const resp = await fetch(`${import.meta.env.VITE_API_BASE || '/api'}/reports/students/${studentId.value}/analysis-stream?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: streamAbort.signal,
    });
    if (!resp.ok || !resp.body) throw new Error(`SSE ${resp.status}`);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          streaming.value = false;
          return;
        }
        streamingNarrative.value += payload;
      }
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError') streamingNarrative.value = '流式生成失败，请查看下方完整周报。';
  } finally {
    streaming.value = false;
    streamAbort = null;
  }
}

function stopStream() {
  streamAbort?.abort();
  streaming.value = false;
}

const granularityText = computed(() => ({ day: '按天', week: '按周', month: '按月' }[granularity.value]));

function emotionLabel(k?: string): string {
  if (!k) return '—';
  return (EMOTION_LABELS as Record<string, string>)[k] || k;
}
function behaviorLabel(k: string): string {
  return (BEHAVIOR_LABELS as Record<string, string>)[k] || k;
}
function scoreClass(s: number): string {
  if (s >= 60) return 'good';
  if (s >= 40) return 'mid';
  return 'warn';
}
function pct(v: number, max: number): number {
  return max > 0 ? Math.round((v / max) * 100) : 0;
}
function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const maxDom = computed(() => {
  const d = dash.value?.summary.dominantDistribution || {};
  return Math.max(1, ...Object.values(d));
});
const maxBeh = computed(() => {
  const b = dash.value?.behaviorStats || {};
  return Math.max(1, ...Object.values(b).map((v) => v.count));
});

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function levelLabel(l: string): string {
  return ({ CRITICAL: '紧急', HIGH: '高危', MEDIUM: '中度', LOW: '轻度' } as Record<string, string>)[l] || l;
}
function channelLabel(c: string): string {
  return ({ SMS: '短信', EMAIL: '邮件', INAPP: '站内信' } as Record<string, string>)[c] || c;
}
function statusLabel(s: string): string {
  return ({ SENT: '已送达', FAILED: '失败', PENDING: '待发送' } as Record<string, string>)[s] || s;
}

// 聊天陪伴概览
async function loadSummary() {
  if (!studentId.value) return;
  try {
    summary.value = (await api.getChatSummary(studentId.value)).data;
  } catch (e) {
    console.warn('聊天摘要加载失败', e);
  }
}

// 危机安全事件列表（监护人闭环）
async function loadSafety() {
  if (!studentId.value) {
    safetyEvents.value = [];
    return;
  }
  safetyLoading.value = true;
  try {
    safetyEvents.value = (await api.listSafetyEvents(studentId.value, safetyUnackOnly.value)).data;
  } catch (e) {
    console.warn('安全事件加载失败', e);
  } finally {
    safetyLoading.value = false;
  }
}

async function ackEvent(ev: SafetyEventView) {
  ackBusy[ev.id] = true;
  try {
    await api.ackSafetyEvent(ev.id, ev.note || undefined);
    ev.acknowledged = true;
    ev.resolved = true;
    ev.resolvedAt = new Date().toISOString();
    notifBell.value?.loadUnread();
  } catch (e) {
    console.warn('确认失败', e);
  } finally {
    ackBusy[ev.id] = false;
  }
}

// ---------------- 演示触发危机（闭环验证） ----------------
async function triggerDemo(scenario: 'CRISIS' | 'SELF_HARM' = 'CRISIS') {
  if (!studentId.value) return;
  demoLoading.value = scenario;
  try {
    const { data } = await api.alertApi.demoTrigger(studentId.value, scenario);
    toast.success(
      (scenario === 'SELF_HARM' ? '已触发自残紧急事件：' : '已触发危机升级：') +
        (data.message || '请查看其他设备的弹窗与触达记录'),
    );
    await loadAlertLogs();
  } catch (e: any) {
    toast.error(e?.response?.data?.message || '触发失败');
  } finally {
    demoLoading.value = null;
  }
}

// ---------------- 触达记录 ----------------
async function loadAlertLogs() {
  if (!studentId.value) {
    alertLogs.value = [];
    return;
  }
  alertLogsLoading.value = true;
  try {
    alertLogs.value = (await api.alertApi.listLogs(studentId.value)).data;
  } catch (e) {
    console.warn('触达记录加载失败', e);
  } finally {
    alertLogsLoading.value = false;
  }
}

// ---------------- 知情同意状态 ----------------
async function loadConsent() {
  if (!studentId.value) return;
  consentLoading.value = true;
  try {
    const records = (await api.consentApi.listRecords(studentId.value)).data;
    const latest = records[0];
    if (latest && (latest.action === 'SIGNED' || latest.action === 'RESIGNED')) {
      currentConsent.valid = true;
      currentConsent.version = latest.version;
      currentConsent.at = latest.createdAt;
    } else {
      currentConsent.valid = false;
      currentConsent.version = undefined;
      currentConsent.at = undefined;
    }
  } catch (e) {
    console.warn('知情同意状态加载失败', e);
  } finally {
    consentLoading.value = false;
  }
}

function goConsent() {
  if (studentId.value) router.push(`/consent/${studentId.value}`);
}

// ---------------- 导出周报 / 月报 PDF ----------------
// 说明：jsPDF 内置字体不含中文字形，直接 doc.text() 写中文会出现空白/乱码。
// 因此这里先在离屏容器中渲染一份"打印版"HTML（由浏览器负责中文排版），
// 再用 html2canvas 光栅化，最后按 A4 自动分页写入 PDF，可保证中文完整可读。
const pdfBusy = ref(false);

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildReportHtml(periodType: 'WEEKLY' | 'MONTHLY'): string {
  const d = dash.value!;
  const name = students.value.find((s) => s.id === studentId.value)?.name || studentId.value;
  const periodLabel = periodType === 'WEEKLY' ? '周报' : '月报';

  const metricRows = [
    ['平均情绪状态', d.summary.avgCompositeScore.toFixed(1) + ' / 100'],
    ['负面情绪占比', (d.summary.negativeRatio * 100).toFixed(1) + '%'],
    ['风险负向段', String(d.riskBursts.length)],
    ['安抚会话数', String(d.comfortStats.sessionCount)],
    ['干预覆盖率', (d.intervention.coverageRate * 100).toFixed(0) + '%'],
    ['风险分级（红/橙/黄）', `${d.riskLevels.red} / ${d.riskLevels.orange} / ${d.riskLevels.yellow}`],
  ];

  const behRows = Object.entries(d.behaviorStats).map(([k, v]) => [
    behaviorLabel(k),
    String(v.count),
    (v.avgConfidence * 100).toFixed(0) + '%',
  ]);

  const evRows = safetyEvents.value.map((ev) => [
    fmt(ev.createdAt),
    levelLabel(ev.level),
    ev.sourceText,
    ev.replySummary,
  ]);

  const table = (head: string[], rows: (string | number)[][], color: string) => `
    <table style="width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:12px;">
      <thead><tr>${head
        .map(
          (h) =>
            `<th style="background:${color};color:#fff;text-align:left;padding:7px 9px;border:1px solid #e3e3e3;font-weight:600;">${esc(h)}</th>`,
        )
        .join('')}</tr></thead>
      <tbody>${rows
        .map(
          (r) =>
            `<tr>${r
              .map(
                (c) =>
                  `<td style="padding:6px 9px;border:1px solid #e3e3e3;vertical-align:top;line-height:1.5;">${esc(c)}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('')}</tbody>
    </table>`;

  return `
    <div style="padding:34px 38px;font-family:'Microsoft YaHei','PingFang SC','Hiragino Sans GB','Noto Sans CJK SC',sans-serif;color:#222;background:#fff;">
      <div style="border-bottom:3px solid #ff7a59;padding-bottom:12px;margin-bottom:18px;">
        <div style="font-size:21px;font-weight:700;">星宝守护 · ${esc(name)} 情绪与干预${periodLabel}</div>
        <div style="font-size:11px;color:#777;margin-top:7px;">
          统计周期：${esc(d.period.from.slice(0, 10))} ~ ${esc(d.period.to.slice(0, 10))}
          &nbsp;&nbsp;|&nbsp;&nbsp; 生成时间：${esc(new Date().toLocaleString('zh-CN'))}
        </div>
      </div>

      <div style="font-size:14px;font-weight:700;margin:4px 0;">一、关键指标</div>
      ${table(['关键指标', '数值'], metricRows, '#ff7a59')}

      <div style="font-size:14px;font-weight:700;margin:4px 0;">二、行为识别统计</div>
      ${behRows.length ? table(['行为', '次数', '平均置信度'], behRows, '#4a90d9') : '<div style="font-size:12px;color:#888;margin:8px 0 18px;">本周期内无行为识别记录。</div>'}

      <div style="font-size:14px;font-weight:700;margin:4px 0;">三、安全事件与干预记录</div>
      ${evRows.length ? table(['时间', '等级', '触发原文', '星宝回应'], evRows, '#e67e22') : '<div style="font-size:12px;color:#888;margin:8px 0 18px;">本周期内无安全事件，状态良好。</div>'}

      ${
        d.narrative.narrative
          ? `<div style="font-size:14px;font-weight:700;margin:4px 0;">四、${periodLabel}小结</div>
             <div style="font-size:12.5px;line-height:1.85;background:#fff7f4;border-left:4px solid #ff7a59;padding:12px 14px;border-radius:4px;">${esc(d.narrative.narrative)}</div>`
          : ''
      }

      <div style="margin-top:26px;padding-top:10px;border-top:1px dashed #ddd;font-size:10px;color:#999;line-height:1.7;">
        本报告由「星宝守护」系统自动生成，仅用于家庭与学校之间的沟通参考，不构成医学诊断依据。
        报告含儿童个人敏感信息，请依据已签署的知情同意书妥善保管与使用。
      </div>
    </div>`;
}

async function exportReportPdf(periodType: 'WEEKLY' | 'MONTHLY') {
  if (!studentId.value || !dash.value) {
    toast.warn('请先加载看板数据');
    return;
  }
  if (pdfBusy.value) return;
  pdfBusy.value = true;

  // 离屏渲染容器：宽度按 A4 96dpi（794px）铺满，保证排版比例正确
  const holder = document.createElement('div');
  holder.style.cssText =
    'position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1;';
  holder.innerHTML = buildReportHtml(periodType);
  document.body.appendChild(holder);

  try {
    const [{ jsPDF }, h2cMod] = await Promise.all([
      import('jspdf') as any,
      import('html2canvas') as any,
    ]);
    const html2canvas = h2cMod.default || h2cMod;

    const canvas = await html2canvas(holder, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 28;
    const imgW = pageW - margin * 2;
    // 画布像素 → PDF 点的换算比例
    const pxPerPt = canvas.width / imgW;
    const pageContentPx = Math.floor((pageH - margin * 2) * pxPerPt);

    let offset = 0;
    let page = 0;
    while (offset < canvas.height) {
      const sliceH = Math.min(pageContentPx, canvas.height - offset);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceH;
      const ctx = slice.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, offset, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

      if (page > 0) doc.addPage();
      doc.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, imgW, sliceH / pxPerPt);
      offset += sliceH;
      page += 1;
    }

    const name = students.value.find((s) => s.id === studentId.value)?.name || studentId.value;
    const stamp = new Date().toISOString().slice(0, 10);
    doc.save(`星宝守护_${name}_${periodType === 'WEEKLY' ? '周报' : '月报'}_${stamp}.pdf`);
    toast.success(`PDF 已生成（共 ${page} 页），开始下载`);
  } catch (e: any) {
    console.warn('PDF 生成失败', e);
    toast.error('PDF 生成失败：' + (e?.message || e));
  } finally {
    holder.remove();
    pdfBusy.value = false;
  }
}

// ---------------- 趋势 SVG ----------------
const scorePts = computed(() => {
  const t = dash.value?.trend || [];
  if (!t.length) return [];
  const n = t.length;
  return t.map((b, i) => ({
    x: PAD + (i * (W - 2 * PAD)) / Math.max(1, n - 1),
    y: H - PAD - (b.avgCompositeScore / 100) * (H - 2 * PAD),
  }));
});
const negPts = computed(() => {
  const t = dash.value?.trend || [];
  if (!t.length) return [];
  const n = t.length;
  return t.map((b, i) => ({
    x: PAD + (i * (W - 2 * PAD)) / Math.max(1, n - 1),
    y: H - PAD - b.negativeRatio * (H - 2 * PAD),
  }));
});
function toPath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}
const scorePath = computed(() => toPath(scorePts.value));
const negPath = computed(() => toPath(negPts.value));

// ---------------- 数据加载 ----------------
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

async function load() {
  if (!studentId.value) return;
  loading.value = true;
  error.value = '';
  try {
    const params: any = { period: period.value, granularity: granularity.value };
    if (period.value === 'CUSTOM') {
      if (fromD.value) params.from = new Date(fromD.value).toISOString();
      if (toD.value) params.to = new Date(toD.value + 'T23:59:59').toISOString();
    }
    dash.value = (await api.reportDashboard(studentId.value, params)).data;
    await loadProfile();
    await Promise.all([loadSummary(), loadSafety(), loadAlertLogs(), loadConsent()]);
  } catch (e: any) {
    error.value = '加载看板失败：' + (e?.response?.data?.message || e?.message || e);
    dash.value = null;
  } finally {
    loading.value = false;
  }
}

async function exportAs(format: 'JSON' | 'CSV') {
  if (!studentId.value) return;
  try {
    const params: any = { format, period: period.value, granularity: granularity.value };
    if (period.value === 'CUSTOM') {
      if (fromD.value) params.from = new Date(fromD.value).toISOString();
      if (toD.value) params.to = new Date(toD.value + 'T23:59:59').toISOString();
    }
    const blob = await api.exportReport(studentId.value, params);
    const url = URL.createObjectURL(blob as any);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${studentId.value}_${period.value}_${Date.now()}.${format.toLowerCase()}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e: any) {
    error.value = '导出失败：' + (e?.message || e);
  }
}

watch([studentId, period, granularity, fromD, toD], () => {
  if (studentId.value) load();
});

// ---------------- 实时告警：连接 / 刷新 ----------------
function isViewedStudent(p: { studentId?: string } | null): boolean {
  return !!p && !!studentId.value && p.studentId === studentId.value;
}
watch(
  () => notify.latestEmergency,
  (p) => {
    if (isViewedStudent(p)) {
      toast.error(`紧急事件 · ${p!.studentName || ''}：${p!.title}`);
      loadSafety();
    }
  },
);
watch(
  () => notify.latestCrisis,
  (p) => {
    if (isViewedStudent(p)) {
      toast.error(`危机预警 · ${p!.studentName || ''}：${p!.title}`);
      loadSafety();
    }
  },
);
watch(
  () => notify.latestRisk,
  (p) => {
    if (isViewedStudent(p)) {
      toast.warn(`风险提示 · ${p!.studentName || ''}：${p!.title}`);
      loadSafety();
    }
  },
);
watch(
  () => notify.lastSummary,
  (p) => {
    if (isViewedStudent(p)) loadSummary();
  },
);

onMounted(async () => {
  await loadStudents();
  if (studentId.value) await load();
  // 鉴权后接入危机告警 WebSocket（单例，App.vue 亦可能已连接，引用计数安全）
  const token = JSON.parse(localStorage.getItem('sp_token') || 'null') as string | null;
  if (token) connectAlerts(token);
});
onBeforeUnmount(() => {
  // 视图卸载仅释放本视图的引用；若 App.vue 仍持有全局连接则不真正断开
  disconnectAlerts();
  stopStream();
});
</script>

<style scoped>
.pd {
  max-width: 1080px;
  margin: 0 auto;
  padding: 18px 16px 60px;
  color: #2c2c2c;
  position: relative;
  background-size: cover !important;
  background-position: center !important;
  background-attachment: fixed;
  background-repeat: no-repeat;
  min-height: 100vh;
}
.pd-with-bg {
  /* 背景图由 :style 绑定注入 */
}
.pd-bg-overlay {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg,
      rgba(255, 240, 235, 0.30) 0%,
      rgba(255, 230, 245, 0.25) 40%,
      rgba(220, 200, 240, 0.30) 100%);
}
/* 头部与卡片浮在背景之上 */
.pd-head,
.pd > .pd-elevate {
  position: relative;
  z-index: 2;
}
.pd > .filters,
.pd > section.card {
  position: relative;
  z-index: 1;
}
/* 头部磨砂白底 */
.pd-elevate {
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(8px);
  border-radius: 14px;
  padding: 12px 16px;
  margin-bottom: 14px;
  box-shadow: 0 6px 18px rgba(120, 70, 160, 0.10);
}
/* 卡片半透明 */
.pd > .filters,
.pd > section.card {
  background: rgba(255, 255, 255, 0.88) !important;
  backdrop-filter: blur(6px);
}
.pd-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.pd-head h1 { font-size: 22px; margin: 0; }
.sub { color: #888; margin: 4px 0 0; font-size: 13px; }
.back { color: #ff7a59; text-decoration: none; font-size: 14px; }
.card { background: #fff; border-radius: 14px; padding: 16px; margin-bottom: 16px; box-shadow: 0 2px 10px rgba(0,0,0,.05); }
.filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.filters label { font-size: 13px; color: #555; display: flex; flex-direction: column; gap: 4px; }
.filters select, .filters input { padding: 7px 9px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }
.spacer { flex: 1; }
button.primary { background: #ff7a59; color: #fff; border: 0; border-radius: 8px; padding: 9px 16px; font-size: 14px; cursor: pointer; }
button.ghost { background: #fff; color: #ff7a59; border: 1px solid #ff7a59; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
button:disabled { opacity: .5; cursor: not-allowed; }
.hint, .err { padding: 10px 4px; color: #666; }
.err { color: #e23; }
h2 { font-size: 16px; margin: 0 0 12px; }

.kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 16px; }
.kpi { text-align: center; padding: 14px 8px; }
.k-label { font-size: 12px; color: #888; }
.k-value { font-size: 30px; font-weight: 700; margin: 6px 0; }
.k-foot { font-size: 11px; color: #aaa; }
.good { color: #2bb673; }
.mid { color: #e6a23c; }
.warn { color: #e74c3c; }

.trend { width: 100%; height: 220px; }
.axis { stroke: #ccc; stroke-width: 1; }
.axis.faint { stroke: #eee; }
.line-score { fill: none; stroke: #ff7a59; stroke-width: 2.5; }
.line-neg { fill: none; stroke: #4a90d9; stroke-width: 2; stroke-dasharray: 4 3; }
.dot-score { fill: #ff7a59; }
.legend { font-size: 12px; color: #777; margin-top: 6px; }
.lg { margin-right: 16px; }
.lg.score { color: #ff7a59; }
.lg.neg { color: #4a90d9; }

.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.bar-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; }
.bar-label { width: 84px; color: #555; flex-shrink: 0; }
.bar-track { flex: 1; background: #f0f0f0; border-radius: 6px; height: 14px; overflow: hidden; }
.bar-fill { display: block; height: 100%; background: #ff7a59; border-radius: 6px; }
.bar-fill.alt { background: #4a90d9; }
.bar-val { width: 76px; text-align: right; color: #888; flex-shrink: 0; }

.empty { color: #aaa; text-align: center; padding: 18px; font-size: 14px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th, .tbl td { padding: 8px 10px; border-bottom: 1px solid #eee; text-align: left; }
.tbl th { color: #888; font-weight: 600; }

.interv { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.iv-item { text-align: center; background: #fafafa; border-radius: 10px; padding: 12px; }
.iv-num { font-size: 24px; font-weight: 700; color: #ff7a59; }
.iv-lbl { font-size: 12px; color: #888; margin-top: 4px; }
.coverage { margin: 10px 0; }
.cov-label { font-size: 13px; color: #555; margin-bottom: 6px; }
.cov-track { background: #f0f0f0; border-radius: 8px; height: 16px; overflow: hidden; }
.cov-fill { height: 100%; background: #e74c3c; border-radius: 8px; transition: width .3s; }
.cov-fill.good { background: #2bb673; }
.cov-text { font-size: 12px; color: #888; margin-top: 6px; }
.src { margin-top: 12px; font-size: 13px; }
.src-title { color: #888; }
.chip { display: inline-block; background: #fff0ec; color: #ff7a59; border-radius: 12px; padding: 3px 10px; margin: 0 6px 6px 0; font-size: 12px; border: 1px solid transparent; }

/* 特征 6：周报 */
.narrative { background: #f3f8ff; }
.nar-actions { display: flex; gap: 8px; margin-bottom: 10px; }
.nar-stream { white-space: pre-wrap; }
.caret { animation: blink 1s steps(2, start) infinite; }
@keyframes blink { to { visibility: hidden; } }
.nar-text { font-size: 16px; line-height: 1.8; color: #2c3e50; margin: 0 0 10px; }
.nar-list { margin: 0; padding-left: 18px; font-size: 13px; color: #555; line-height: 1.9; }

/* 特征 7：风险分级条 */
.risk-bars { margin: 6px 0 12px; }
.rb-row { display: flex; align-items: center; gap: 10px; margin: 8px 0; font-size: 13px; }
.rb-label { width: 110px; flex-shrink: 0; font-weight: 600; }
.rb-track { flex: 1; background: #f0f0f0; border-radius: 6px; height: 16px; overflow: hidden; }
.rb-fill { display: block; height: 100%; border-radius: 6px; }
.rb-val { width: 30px; text-align: right; color: #888; }
.top-risk { font-size: 13px; margin-top: 8px; }

/* 学生基础画像卡片 */
.profile-card .profile-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.profile-card h2 { margin: 0; }
.profile-row { display: flex; gap: 10px; margin: 8px 0; font-size: 14px; align-items: flex-start; }
.profile-row .pl { width: 72px; color: #888; flex-shrink: 0; }
.profile-row .pv { flex: 1; }
.chip.like { background: #e8f6ee; color: #2b8a5a; }
.chip.good { background: #e8f6ee; color: #2b8a5a; }
.chip.bad { background: #fdeaea; color: #d05050; }
.ghost.sm { padding: 4px 12px; font-size: 12px; }
.profile-note { font-size: 12px; color: #aaa; margin: 10px 0 0; }

/* 聊天陪伴概览 */
.summary-card .sum-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
.sum-item { text-align: center; background: #fafafa; border-radius: 10px; padding: 14px 8px; }
.sum-num { font-size: 26px; font-weight: 700; color: #ff7a59; }
.sum-num.small { font-size: 16px; }
.sum-item.warn .sum-num { color: #e74c3c; }
.sum-item.good .sum-num { color: #2bb673; }
.sum-lbl { font-size: 12px; color: #888; margin-top: 4px; }
.sum-tech { font-size: 13px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sum-tech-title { color: #888; }

/* 危机安全事件 */
.safety-card .safety-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.safety-card .safety-head h2 { margin: 0; }
.safety-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.safety-item { border: 1px solid #eee; border-left-width: 4px; border-radius: 10px; padding: 12px 14px; background: #fff; }
.safety-item.lv-critical { border-left-color: #c0392b; background: #fff5f4; }
.safety-item.lv-high { border-left-color: #e67e22; background: #fff8f1; }
.safety-item.lv-medium { border-left-color: #e0a000; background: #fffdf2; }
.safety-item.lv-low { border-left-color: #9bbf6b; background: #f7fbf0; }
.safety-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.safety-level { font-size: 12px; font-weight: 700; border-radius: 8px; padding: 2px 8px; color: #fff; }
.safety-level.lv-critical { background: #c0392b; }
.safety-level.lv-high { background: #e67e22; }
.safety-level.lv-medium { background: #e0a000; }
.safety-level.lv-low { background: #9bbf6b; }
.safety-time { font-size: 12px; color: #aaa; }
.safety-ack { font-size: 12px; color: #2bb673; background: #e8f6ee; border-radius: 8px; padding: 1px 8px; }
.safety-src, .safety-reply, .safety-note { font-size: 13px; color: #555; margin-top: 4px; line-height: 1.6; word-break: break-word; }
.safety-actions { display: flex; gap: 8px; margin-top: 8px; }
.safety-input { flex: 1; border: 1px solid #eee; border-radius: 8px; padding: 6px 10px; font-size: 13px; }
button.primary.sm { padding: 6px 14px; font-size: 13px; }
button.primary { background: #ff7a59; color: #fff; border: 0; border-radius: 8px; cursor: pointer; }

/* 知情同意状态 */
.consent-card .consent-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.consent-card .consent-head h2 { margin: 0; }
.consent-valid, .consent-invalid { font-size: 14px; display: flex; align-items: center; gap: 8px; }
.consent-valid { color: #2bb673; }
.consent-invalid { color: #d05050; }
.consent-time { color: #888; font-size: 12px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.dot.ok { background: #2bb673; }
.dot.bad { background: #d05050; }

/* 触达记录 */
.alertlog-card .alertlog-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.alertlog-card .alertlog-head h2 { margin: 0; }
.log-title { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-err { color: #e74c3c; margin-left: 4px; cursor: help; }
.status { font-size: 12px; border-radius: 8px; padding: 1px 8px; font-weight: 600; }
.status.st-sent { color: #2bb673; background: #e8f6ee; }
.status.st-failed { color: #e74c3c; background: #fdeaea; }
.status.st-pending { color: #e6a23c; background: #fff7e6; }

@media (max-width: 760px) {
  .kpis, .interv { grid-template-columns: repeat(2, 1fr); }
  .grid2 { grid-template-columns: 1fr; }
}
</style>
