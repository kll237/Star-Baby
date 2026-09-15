/**
 * 阶段四：报告聚合纯函数。
 * 全部为无副作用函数，便于单元测试与前后端复用（前端可 import 同构逻辑）。
 */

import { BEHAVIOR_LABELS } from '../detection/detection.taxonomy';

// ---------------- 输入 / 输出类型 ----------------

export interface EmotionFrameInput {
  ts: string; // ISO 时间
  compositeScore: number; // 0-100，越高越正面
  negative: boolean;
  dominant: string; // 情绪 key，见 EMOTION_KEYS
}

export interface TrendBucket {
  bucket: string; // day: YYYY-MM-DD / week: 周一 YYYY-MM-DD / month: YYYY-MM
  frameCount: number;
  avgCompositeScore: number;
  negativeRatio: number; // 0-1
  negativeCount: number;
  dominantCounts: Record<string, number>;
}

export interface EmotionSummary {
  frameCount: number;
  negativeCount: number;
  negativeRatio: number;
  avgCompositeScore: number;
  bestScore: number;
  worstScore: number;
  dominantDistribution: Record<string, number>;
}

export interface RiskBurst {
  start: string;
  end: string;
  durationSec: number;
  frameCount: number;
  negativeCount: number;
  peakNegativeScore: number; // 段内最低综合分（最负面）
  avgCompositeScore: number;
  dominant?: string; // 段内最常见情绪
}

export interface ComfortSessionInput {
  status: string;
  triggerSource: string;
  messageCount: number;
}

export interface ComfortStats {
  sessionCount: number;
  activeCount: number;
  endedCount: number;
  triggerSourceDistribution: Record<string, number>;
  totalMessages: number;
  avgMessageCount: number;
}

export interface InterventionEffect {
  negativeBursts: number; // 风险负向段数
  comfortTriggered: number; // 由检测触发的安抚会话数
  coverageRate: number; // 覆盖率 0-1（封顶 1）
  avgMessagesWhenTriggered: number;
}

export type TrendGranularity = 'day' | 'week' | 'month';

export interface DashboardData {
  studentId: string;
  period: { from: string; to: string; type: string };
  summary: EmotionSummary;
  trend: TrendBucket[];
  riskBursts: RiskBurst[];
  comfortStats: ComfortStats;
  intervention: InterventionEffect;
  behaviorStats: Record<string, { count: number; avgConfidence: number }>;
  /** 特征 2：安抚介入后情绪回升闭环评估 */
  recovery: RecoveryStat;
  /** 特征 7：风险分级统计 */
  riskLevels: RiskLevelStat;
  /** 特征 6：自然语言周报（一句话人话摘要） */
  narrative: WeeklyNarrative;
}

// ---------------- 特征 2：安抚介入后情绪回升闭环 ----------------

export interface ComfortEpisodeInput {
  /** 介入前平均综合分（0-100） */
  preAvg: number;
  /** 介入后平均综合分（0-100） */
  postAvg: number;
}

export interface RecoveryStat {
  /** 有效介入事件数（检测触发的安抚会话，并能取到前后情绪窗口） */
  episodes: number;
  /** 其中情绪回升（介入后高于介入前）的事件数 */
  recovered: number;
  /** 回升率 0-1（recovered / episodes，无事件时为 0） */
  recoveryRate: number;
  avgPreScore: number;
  avgPostScore: number;
  avgDelta: number;
}

/** 由一组「介入前/后」情绪分差计算回升闭环指标。 */
export function computeRecovery(episodes: ComfortEpisodeInput[]): RecoveryStat {
  const n = episodes.length;
  if (!n) {
    return { episodes: 0, recovered: 0, recoveryRate: 0, avgPreScore: 0, avgPostScore: 0, avgDelta: 0 };
  }
  let recovered = 0;
  let sumPre = 0;
  let sumPost = 0;
  for (const e of episodes) {
    sumPre += e.preAvg;
    sumPost += e.postAvg;
    if (e.postAvg > e.preAvg + 3) recovered += 1; // 回升阈值：介入后比介入前高 3 分以上
  }
  return {
    episodes: n,
    recovered,
    recoveryRate: round2(recovered / n),
    avgPreScore: round2(sumPre / n),
    avgPostScore: round2(sumPost / n),
    avgDelta: round2((sumPost - sumPre) / n),
  };
}

// ---------------- 特征 7：风险分级 ----------------

export type RiskLevel = 'yellow' | 'orange' | 'red';

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  yellow: '黄色（关注）',
  orange: '橙色（需介入）',
  red: '红色（紧急）',
};

export const RISK_LEVEL_ORDER: RiskLevel[] = ['yellow', 'orange', 'red'];

/** 行为 → 风险等级映射（无姿态模型时也可分级）。 */
export function riskLevelOf(behavior: string): RiskLevel {
  switch (behavior) {
    case 'self_injury':
      return 'red';
    case 'leave_seat':
    case 'run':
    case 'jump':
    case 'stamp':
    case 'spin':
      return 'orange';
    default:
      return 'yellow';
  }
}

export interface RiskLevelStat {
  yellow: number;
  orange: number;
  red: number;
  total: number;
  topBehaviors: { behavior: string; label: string; level: RiskLevel; count: number }[];
}

/** 由行为频次统计计算风险分级汇总。 */
export function computeRiskLevels(
  behaviorStats: Record<string, { count: number; avgConfidence: number }>,
): RiskLevelStat {
  const stat: RiskLevelStat = { yellow: 0, orange: 0, red: 0, total: 0, topBehaviors: [] };
  const byLevel: Record<RiskLevel, { behavior: string; label: string; count: number }[]> = {
    yellow: [],
    orange: [],
    red: [],
  };
  for (const [behavior, v] of Object.entries(behaviorStats ?? {})) {
    const level = riskLevelOf(behavior);
    stat[level] += v.count;
    stat.total += v.count;
    byLevel[level].push({
      behavior,
      label: (BEHAVIOR_LABELS as Record<string, string>)[behavior] || behavior,
      count: v.count,
    });
  }
  stat.topBehaviors = RISK_LEVEL_ORDER.flatMap((lv) =>
    byLevel[lv].sort((a, b) => b.count - a.count).map((x) => ({ ...x, level: lv })),
  );
  return stat;
}

// ---------------- 特征 6：自然语言周报 ----------------

export interface WeeklyNarrative {
  /** 一句话人话摘要，老师可直接转发家长 */
  narrative: string;
  /** 关键洞察要点（bullet） */
  highlights: string[];
}

/**
 * 由看板数据生成一句人话周报 + 关键要点。
 * 纯函数，便于测试与前后端复用。
 */
export function buildWeeklyNarrative(d: DashboardData): WeeklyNarrative {
  const periodLabel =
    d.period.type === 'WEEKLY' ? '本周' : d.period.type === 'MONTHLY' ? '本月' : d.period.type === 'DAILY' ? '今日' : '本期';
  const negPct = Math.round((d.summary.negativeRatio ?? 0) * 100);
  const posPct = 100 - negPct;
  const avg = d.summary.avgCompositeScore ?? 0;
  const recoveryPct = Math.round((d.recovery?.recoveryRate ?? 0) * 100);

  // 找负面最集中的时段（按天桶负面占比最高）
  const worst = [...(d.trend ?? [])]
    .filter((b) => b.frameCount > 0)
    .sort((a, b) => b.negativeRatio - a.negativeRatio)[0];
  // 找风险最高行为
  const topRisk = [...(d.riskLevels?.topBehaviors ?? [])]
    .filter((b) => b.level !== 'yellow')
    .sort((a, b) => b.count - a.count)[0];

  const parts: string[] = [];
  parts.push(
    `${periodLabel}整体情绪状态${avg >= 60 ? '较好' : avg >= 40 ? '平稳' : '偏低'}（平均 ${avg.toFixed(0)} 分），正向占比约 ${posPct}%，负向占比约 ${negPct}%。`,
  );
  if (worst) {
    parts.push(`负向最集中在 ${worst.bucket}（负面占比 ${Math.round(worst.negativeRatio * 100)}%）`);
  }
  if (topRisk) {
    parts.push(`需重点关注的是「${topRisk.label}」（${RISK_LEVEL_LABELS[topRisk.level]}）。`);
  }
  if (d.recovery?.episodes > 0) {
    parts.push(`共 ${d.recovery.episodes} 次安抚介入，情绪回升率 ${recoveryPct}%。`);
  }
  // 给出可操作建议
  if (worst && topRisk) {
    parts.push(`建议把高刺激活动安排在精力较好的时段，避免在上述时段叠加感统/转换活动。`);
  } else if (negPct < 20) {
    parts.push(`孩子状态稳定，可维持现有常规并多给予正向强化。`);
  }

  const narrative = parts.join('');
  const highlights = parts.slice(1);
  return { narrative, highlights };
}

// ---------------- 时间分桶 ----------------

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

/** 返回某帧的桶 key（按 UTC 提取，保证确定性，便于测试）。 */
export function bucketKey(ts: string, granularity: TrendGranularity): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (granularity === 'month') return `${y}-${pad(m)}`;
  if (granularity === 'day') {
    const day = d.getUTCDate();
    return `${y}-${pad(m)}-${pad(day)}`;
  }
  // week：该周周一（UTC，周日为 0）
  const day = d.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(d.getTime() - diffToMonday * 86400000);
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

/** 解析周期类型为时间范围（返回 Date）。 */
export function periodRange(
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM',
  from?: string,
  to?: string,
): { from: Date; to: Date } {
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === 'DAILY') {
    const toD = to ? new Date(to) : new Date(startOfDay.getTime() + 86400000);
    return { from: from ? new Date(from) : startOfDay, to: toD };
  }
  if (period === 'WEEKLY') {
    const day = now.getUTCDay();
    const diffToMonday = (day + 6) % 7;
    const monday = new Date(startOfDay.getTime() - diffToMonday * 86400000);
    const nextMonday = new Date(monday.getTime() + 7 * 86400000);
    return { from: from ? new Date(from) : monday, to: to ? new Date(to) : nextMonday };
  }
  if (period === 'MONTHLY') {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { from: from ? new Date(from) : first, to: to ? new Date(to) : nextMonth };
  }
  // CUSTOM
  const fromD = from ? new Date(from) : new Date(now.getTime() - 30 * 86400000);
  const toD = to ? new Date(to) : now;
  return { from: fromD, to: toD };
}

// ---------------- 聚合 ----------------

/** 按粒度分桶，计算每桶平均综合分、负面占比、主导情绪分布。 */
export function bucketizeTrend(
  frames: EmotionFrameInput[],
  granularity: TrendGranularity = 'day',
): TrendBucket[] {
  const map = new Map<string, EmotionFrameInput[]>();
  for (const f of frames) {
    const k = bucketKey(f.ts, granularity);
    const arr = map.get(k) ?? [];
    arr.push(f);
    map.set(k, arr);
  }
  const buckets: TrendBucket[] = [];
  for (const [k, arr] of map) {
    let sum = 0;
    let neg = 0;
    const dom: Record<string, number> = {};
    for (const f of arr) {
      sum += f.compositeScore;
      if (f.negative) neg += 1;
      dom[f.dominant] = (dom[f.dominant] ?? 0) + 1;
    }
    buckets.push({
      bucket: k,
      frameCount: arr.length,
      avgCompositeScore: arr.length ? sum / arr.length : 0,
      negativeRatio: arr.length ? neg / arr.length : 0,
      negativeCount: neg,
      dominantCounts: dom,
    });
  }
  buckets.sort((a, b) => a.bucket.localeCompare(b.bucket));
  return buckets;
}

export function summarizeEmotion(frames: EmotionFrameInput[]): EmotionSummary {
  const dist: Record<string, number> = {};
  let sum = 0;
  let neg = 0;
  let best = Number.POSITIVE_INFINITY;
  let worst = Number.NEGATIVE_INFINITY;
  for (const f of frames) {
    sum += f.compositeScore;
    if (f.negative) neg += 1;
    dist[f.dominant] = (dist[f.dominant] ?? 0) + 1;
    if (f.compositeScore > worst) worst = f.compositeScore;
    if (f.compositeScore < best) best = f.compositeScore;
  }
  const n = frames.length;
  return {
    frameCount: n,
    negativeCount: neg,
    negativeRatio: n ? neg / n : 0,
    avgCompositeScore: n ? sum / n : 0,
    bestScore: n ? worst : 0, // worst 变量存的是最大值（最正面）
    worstScore: n ? best : 0, // best 变量存的是最小值（最负面）
    dominantDistribution: dist,
  };
}

/**
 * 将连续负向帧聚类为风险事件段。
 * 相邻负向帧间隔 < gapSec 视为同一段，否则断开。
 */
export function detectRiskBursts(
  frames: EmotionFrameInput[],
  gapSec = 60,
): RiskBurst[] {
  const neg = frames
    .filter((f) => f.negative)
    .map((f) => ({ ...f, t: new Date(f.ts).getTime() }))
    .sort((a, b) => a.t - b.t);

  const bursts: RiskBurst[] = [];
  let cur: typeof neg = [];
  for (let i = 0; i < neg.length; i++) {
    const f = neg[i];
    if (cur.length === 0) {
      cur = [f];
      continue;
    }
    const prev = cur[cur.length - 1];
    if (f.t - prev.t <= gapSec * 1000) {
      cur.push(f);
    } else {
      bursts.push(buildBurst(cur));
      cur = [f];
    }
  }
  if (cur.length) bursts.push(buildBurst(cur));
  return bursts;
}

function buildBurst(items: { ts: string; compositeScore: number; dominant: string }[]): RiskBurst {
  let sum = 0;
  let peak = Number.POSITIVE_INFINITY; // 最负面 = 最低分
  const dom: Record<string, number> = {};
  for (const f of items) {
    sum += f.compositeScore;
    if (f.compositeScore < peak) peak = f.compositeScore;
    dom[f.dominant] = (dom[f.dominant] ?? 0) + 1;
  }
  let dominant: string | undefined;
  let max = -1;
  for (const [k, v] of Object.entries(dom)) {
    if (v > max) {
      max = v;
      dominant = k;
    }
  }
  const start = new Date(items[0].ts);
  const end = new Date(items[items.length - 1].ts);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    durationSec: Math.round((end.getTime() - start.getTime()) / 1000),
    frameCount: items.length,
    negativeCount: items.length,
    peakNegativeScore: peak === Number.POSITIVE_INFINITY ? 0 : peak,
    avgCompositeScore: sum / items.length,
    dominant,
  };
}

export function computeComfortStats(sessions: ComfortSessionInput[]): ComfortStats {
  const srcDist: Record<string, number> = {};
  let active = 0;
  let ended = 0;
  let total = 0;
  for (const s of sessions) {
    srcDist[s.triggerSource] = (srcDist[s.triggerSource] ?? 0) + 1;
    if (s.status === 'ACTIVE') active += 1;
    else if (s.status === 'ENDED') ended += 1;
    total += s.messageCount;
  }
  const n = sessions.length;
  return {
    sessionCount: n,
    activeCount: active,
    endedCount: ended,
    triggerSourceDistribution: srcDist,
    totalMessages: total,
    avgMessageCount: n ? total / n : 0,
  };
}

export function computeInterventionEffect(
  bursts: RiskBurst[],
  sessions: ComfortSessionInput[],
): InterventionEffect {
  const triggered = sessions.filter((s) => s.triggerSource === 'DETECTION');
  const negativeBursts = bursts.length;
  let avgTriggered = 0;
  if (triggered.length) {
    avgTriggered =
      triggered.reduce((a, s) => a + s.messageCount, 0) / triggered.length;
  }
  const coverage = negativeBursts > 0 ? Math.min(triggered.length / negativeBursts, 1) : 0;
  return {
    negativeBursts,
    comfortTriggered: triggered.length,
    coverageRate: coverage,
    avgMessagesWhenTriggered: avgTriggered,
  };
}

// ---------------- CSV 导出 ----------------

function csvCell(v: string | number | undefined): string {
  const s = v === undefined ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvRow(cells: (string | number | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

/** 将看板数据导出为多段 CSV 文本（趋势 / 风险 / 安抚干预）。 */
export function dashboardToCsv(d: DashboardData): string {
  const lines: string[] = [];
  lines.push(`# 学生情绪报告,studentId=${d.studentId}`);
  lines.push(`# 周期,${d.period.type},${d.period.from} ~ ${d.period.to}`);
  lines.push('');
  lines.push('# 情绪趋势');
  lines.push(csvRow(['bucket', 'frameCount', 'avgCompositeScore', 'negativeRatio', 'negativeCount']));
  for (const b of d.trend) {
    lines.push(
      csvRow([
        b.bucket,
        b.frameCount,
        round2(b.avgCompositeScore),
        round2(b.negativeRatio),
        b.negativeCount,
      ]),
    );
  }
  lines.push('');
  lines.push('# 风险事件（连续负向段）');
  lines.push(
    csvRow(['start', 'end', 'durationSec', 'frameCount', 'negativeCount', 'peakNegativeScore', 'avgCompositeScore', 'dominant']),
  );
  for (const r of d.riskBursts) {
    lines.push(
      csvRow([
        r.start,
        r.end,
        r.durationSec,
        r.frameCount,
        r.negativeCount,
        round2(r.peakNegativeScore),
        round2(r.avgCompositeScore),
        r.dominant ?? '',
      ]),
    );
  }
  lines.push('');
  lines.push('# 安抚与干预');
  const c = d.comfortStats;
  const iv = d.intervention;
  lines.push(csvRow(['指标', '值']));
  lines.push(csvRow(['会话总数', c.sessionCount]));
  lines.push(csvRow(['进行中会话', c.activeCount]));
  lines.push(csvRow(['已结束会话', c.endedCount]));
  lines.push(csvRow(['总消息数', c.totalMessages]));
  lines.push(csvRow(['平均消息数', round2(c.avgMessageCount)]));
  lines.push(csvRow(['风险负向段数', iv.negativeBursts]));
  lines.push(csvRow(['检测触发安抚数', iv.comfortTriggered]));
  lines.push(csvRow(['干预覆盖率', round2(iv.coverageRate)]));
  return lines.join('\n');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
