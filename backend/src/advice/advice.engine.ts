/**
 * 阶段五：专业心理建议引擎纯函数。
 * 无副作用，便于单元测试与前后端复用。
 * 输入为「学生画像」(AdviceProfile)，由 ReportService 的看板数据提炼而来。
 */

import {
  EMOTION_KNOWLEDGE_PRIORITY,
  BEHAVIOR_KNOWLEDGE_PRIORITY,
  DEFAULT_SEVERITY_THRESHOLDS,
  type KnowledgeCategoryKey,
  type AdviceSeverityKey,
} from './advice.taxonomy';
import type { DashboardData } from '../report/report.aggregate';

// ---------------- 类型 ----------------

export interface AdviceProfile {
  negativeRatio: number; // 0-1
  avgCompositeScore: number; // 0-100
  dominantDistribution: Record<string, number>;
  topEmotions: string[]; // 出现最多的负向/主要情绪
  behaviorCounts: Record<string, number>; // 行为 key -> 次数
  presentBehaviors: string[]; // 出现过的行为 key
  riskBehaviors: string[]; // 高危行为（如 self_injury）
  frameCount: number;
}

export interface ScoredKnowledge {
  category: KnowledgeCategoryKey;
  title: string;
  content: string;
  source?: string;
  severity: AdviceSeverityKey;
  target: 'ALL' | 'PARENT' | 'TEACHER' | 'STUDENT';
  applicableEmotions: string[];
  applicableBehaviors: string[];
  tags: string[];
  reference?: string;
  priority: number;
  score: number;
  matchReasons: string[];
}

export interface AdviceResult {
  severity: AdviceSeverityKey;
  summary: string;
  topItems: ScoredKnowledge[];
  byCategory: Record<string, ScoredKnowledge[]>;
  generatedAt: string;
}

// ---------------- 严重度排序 ----------------

const SEVERITY_ORDER: AdviceSeverityKey[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export function severityRank(s: AdviceSeverityKey): number {
  return SEVERITY_ORDER.indexOf(s);
}

// ---------------- 从看板提炼画像 ----------------

/** 从阶段四的看板数据提炼建议引擎所需的「学生画像」。 */
export function buildAdviceProfile(dashboard: DashboardData): AdviceProfile {
  const summary = dashboard.summary ?? {
    frameCount: 0,
    negativeRatio: 0,
    avgCompositeScore: 0,
    dominantDistribution: {},
  };
  const dom = summary.dominantDistribution ?? {};
  // 主导情绪按出现次数降序，取前 3
  const topEmotions = Object.entries(dom)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  const behaviorCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(dashboard.behaviorStats ?? {})) {
    behaviorCounts[k] = v.count;
  }
  const presentBehaviors = Object.keys(behaviorCounts).filter((b) => behaviorCounts[b] > 0);
  const riskBehaviors = presentBehaviors.filter((b) => b === 'self_injury');

  return {
    negativeRatio: summary.negativeRatio ?? 0,
    avgCompositeScore: summary.avgCompositeScore ?? 0,
    dominantDistribution: dom,
    topEmotions,
    behaviorCounts,
    presentBehaviors,
    riskBehaviors,
    frameCount: summary.frameCount ?? 0,
  };
}

// ---------------- 严重度判定 ----------------

/** 依据画像与阈值计算整体严重度（CRITICAL 优先于 HIGH）。 */
export function computeSeverity(
  profile: AdviceProfile,
  thresholds = DEFAULT_SEVERITY_THRESHOLDS,
): AdviceSeverityKey {
  let sev: AdviceSeverityKey = 'LOW';
  if (profile.negativeRatio >= thresholds.negativeRatioMedium) sev = 'MEDIUM';
  if (profile.negativeRatio >= thresholds.negativeRatioHigh) sev = 'HIGH';
  if (profile.presentBehaviors.some((b) => thresholds.riskBehaviorHigh.includes(b))) sev = 'HIGH';
  if (profile.presentBehaviors.some((b) => thresholds.riskBehaviorCritical.includes(b))) {
    sev = 'CRITICAL';
  }
  // 综合分极低（情绪整体很差）也提升严重度
  if (profile.avgCompositeScore < 25 && profile.frameCount > 0) {
    sev = bumpSeverity(sev, 'HIGH');
  }
  return sev;
}

function bumpSeverity(current: AdviceSeverityKey, floor: AdviceSeverityKey): AdviceSeverityKey {
  return severityRank(current) < severityRank(floor) ? floor : current;
}

// ---------------- 匹配与打分 ----------------

/** 计算知识库某条目与画像的匹配分数与理由。 */
export function scoreKnowledge(
  item: ScoredKnowledgeSeed,
  profile: AdviceProfile,
  profileSeverity: AdviceSeverityKey,
): ScoredKnowledge {
  let score = item.priority ?? 0;
  const reasons: string[] = [];

  // 情绪命中
  const emoHit = (item.applicableEmotions ?? []).filter((e) => profile.topEmotions.includes(e));
  if (emoHit.length) {
    score += emoHit.length * 3;
    reasons.push(`情绪命中(${emoHit.join('/')})`);
  }
  // 行为命中
  const behHit = (item.applicableBehaviors ?? []).filter((b) => profile.presentBehaviors.includes(b));
  if (behHit.length) {
    score += behHit.length * 4;
    reasons.push(`行为命中(${behHit.join('/')})`);
  }
  // 类别亲和：情绪/行为映射的优先类别
  const affinityCats = new Set<KnowledgeCategoryKey>();
  for (const e of profile.topEmotions) {
    (EMOTION_KNOWLEDGE_PRIORITY[e] ?? []).forEach((c) => affinityCats.add(c));
  }
  for (const b of profile.presentBehaviors) {
    (BEHAVIOR_KNOWLEDGE_PRIORITY[b] ?? []).forEach((c) => affinityCats.add(c));
  }
  if (affinityCats.has(item.category)) {
    score += 2;
    reasons.push('类别亲和');
  }
  // 严重度匹配：与画像严重度精确匹配则加分；条目严重度远超画像（过度报警）则降权
  const itemRank = severityRank(item.severity ?? 'LOW');
  const profRank = severityRank(profileSeverity);
  if (itemRank > profRank) {
    // 过度报警：在稳定/需关注画像下推送高危/紧急条目会制造不必要的恐慌
    score -= (itemRank - profRank) * 3;
    reasons.push('严重度偏高');
  } else if (itemRank === profRank) {
    score += 1;
  }

  return {
    category: item.category,
    title: item.title,
    content: item.content,
    source: item.source,
    severity: item.severity ?? 'LOW',
    target: item.target ?? 'ALL',
    applicableEmotions: item.applicableEmotions ?? [],
    applicableBehaviors: item.applicableBehaviors ?? [],
    tags: item.tags ?? [],
    reference: item.reference,
    priority: item.priority ?? 0,
    score: Math.round(score * 10) / 10,
    matchReasons: reasons,
  };
}

export interface ScoredKnowledgeSeed {
  category: KnowledgeCategoryKey;
  title: string;
  content: string;
  source?: string;
  severity?: AdviceSeverityKey;
  target?: 'ALL' | 'PARENT' | 'TEACHER' | 'STUDENT';
  applicableEmotions?: string[];
  applicableBehaviors?: string[];
  tags?: string[];
  reference?: string;
  priority?: number;
  isActive?: boolean;
}

/** 对知识库做匹配打分并降序排序。target 指定时仅保留面向该对象的条目。 */
export function matchKnowledge(
  items: ScoredKnowledgeSeed[],
  profile: AdviceProfile,
  opts?: { target?: 'ALL' | 'PARENT' | 'TEACHER' | 'STUDENT' },
): ScoredKnowledge[] {
  const profileSeverity = computeSeverity(profile);
  const target = opts?.target;
  const scored = (items ?? [])
    .filter((it) => it.isActive !== false)
    .filter((it) => {
      if (!target || target === 'ALL') return true;
      return it.target === 'ALL' || it.target === target;
    })
    .map((it) => scoreKnowledge(it, profile, profileSeverity));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ---------------- 生成建议 ----------------

/** 生成结构化专业建议：严重度 + 摘要 + TopN 分级条目 + 按类别分组。 */
export function generateAdvice(
  items: ScoredKnowledgeSeed[],
  profile: AdviceProfile,
  opts?: { target?: 'ALL' | 'PARENT' | 'TEACHER' | 'STUDENT'; topN?: number },
): AdviceResult {
  const severity = computeSeverity(profile);
  const topN = opts?.topN ?? 14;
  const ranked = matchKnowledge(items, profile, { target: opts?.target }).slice(0, topN);

  const byCategory: Record<string, ScoredKnowledge[]> = {};
  for (const it of ranked) {
    (byCategory[it.category] ??= []).push(it);
  }

  const summary = buildSummary(profile, severity, ranked);
  return {
    severity,
    summary,
    topItems: ranked,
    byCategory,
    generatedAt: new Date().toISOString(),
  };
}

function buildSummary(
  profile: AdviceProfile,
  severity: AdviceSeverityKey,
  top: ScoredKnowledge[],
): string {
  const sevLabel = { LOW: '稳定', MEDIUM: '需关注', HIGH: '高风险', CRITICAL: '紧急' }[severity];
  const negPct = Math.round(profile.negativeRatio * 100);
  const topEmo = profile.topEmotions.slice(0, 2).join('、') || '无明显负向';
  const riskTxt = profile.riskBehaviors.length ? `存在高危行为(${profile.riskBehaviors.join('/')})，` : '';
  const headline = `整体状态：${sevLabel}（负面占比约 ${negPct}%，主导情绪：${topEmo}）。${riskTxt}`;
  const focus = top.slice(0, 3).map((t) => t.title).join('、');
  return headline + `建议优先关注：${focus || '情绪与常规支持'}。`;
}

// ---------------- LLM 提示构造 ----------------

/** 构造交给 LLM 生成专业报告的提示词（当开启了可切换 LLM 时使用）。 */
export function buildAdvicePrompt(profile: AdviceProfile, top: ScoredKnowledge[]): string {
  const sevLabel = { LOW: '稳定', MEDIUM: '需关注', HIGH: '高风险', CRITICAL: '紧急' }[
    computeSeverity(profile)
  ];
  const lines: string[] = [];
  lines.push('你是一名资深特殊儿童心理与特教顾问。请基于以下学生画像与候选专业建议，生成一段 200-300 字的专业干预建议摘要，面向家长与教师，语气专业、温暖、可操作。');
  lines.push('');
  lines.push('【学生画像】');
  lines.push(`- 整体状态：${sevLabel}`);
  lines.push(`- 负面情绪占比：${Math.round(profile.negativeRatio * 100)}%`);
  lines.push(`- 主导情绪：${profile.topEmotions.join('、') || '无明显负向'}`);
  lines.push(`- 出现的行为：${profile.presentBehaviors.join('、') || '无记录'}`);
  if (profile.riskBehaviors.length) lines.push(`- 高危行为：${profile.riskBehaviors.join('、')}`);
  lines.push('');
  lines.push('【候选专业建议（来自知识库，请整合而非逐条罗列）】');
  top.slice(0, 8).forEach((t, i) => {
    lines.push(`${i + 1}. [${t.category}] ${t.title}：${t.content}`);
  });
  return lines.join('\n');
}
