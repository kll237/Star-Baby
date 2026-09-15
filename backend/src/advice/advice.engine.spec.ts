import {
  buildAdviceProfile,
  computeSeverity,
  matchKnowledge,
  generateAdvice,
  buildAdvicePrompt,
  scoreKnowledge,
  severityRank,
  type AdviceProfile,
  type ScoredKnowledgeSeed,
} from './advice.engine';
import type { DashboardData } from '../report/report.aggregate';

const PROFILE: AdviceProfile = {
  negativeRatio: 0.5,
  avgCompositeScore: 35,
  dominantDistribution: { sad: 10, angry: 6, neutral: 4 },
  topEmotions: ['sad', 'angry'],
  behaviorCounts: { self_injury: 2, stamp: 1 },
  presentBehaviors: ['self_injury', 'stamp'],
  riskBehaviors: ['self_injury'],
  frameCount: 30,
};

const ITEMS: ScoredKnowledgeSeed[] = [
  {
    category: 'CRISIS_INTERVENTION',
    title: '自伤即时处置',
    content: '发现自伤立即移除伤害源并保护。',
    severity: 'CRITICAL',
    target: 'ALL',
    applicableBehaviors: ['self_injury'],
    applicableEmotions: [],
    tags: ['自伤'],
    priority: 10,
  },
  {
    category: 'EMOTION_REGULATION',
    title: '情绪命名三步法',
    content: '共情—命名—引导。',
    severity: 'LOW',
    target: 'ALL',
    applicableEmotions: ['sad', 'angry'],
    applicableBehaviors: [],
    tags: ['共情'],
    priority: 9,
  },
  {
    category: 'SCHOOL_ADAPTATION',
    title: '课堂视觉提示',
    content: '张贴流程图。',
    severity: 'LOW',
    target: 'TEACHER',
    applicableEmotions: [],
    applicableBehaviors: [],
    tags: ['视觉'],
    priority: 8,
  },
  {
    category: 'FAMILY_LIFE',
    title: '家长自我照护',
    content: '家长需充电。',
    severity: 'LOW',
    target: 'PARENT',
    applicableEmotions: [],
    applicableBehaviors: [],
    tags: ['照护'],
    priority: 8,
  },
];

describe('advice.engine', () => {
  it('severityRank 单调递增', () => {
    expect(severityRank('LOW')).toBe(0);
    expect(severityRank('MEDIUM')).toBe(1);
    expect(severityRank('HIGH')).toBe(2);
    expect(severityRank('CRITICAL')).toBe(3);
  });

  it('buildAdviceProfile 从看板提炼关键字段', () => {
    const dashboard = {
      studentId: 's1',
      period: { from: '', to: '', type: 'CUSTOM' },
      summary: {
        frameCount: 30,
        negativeCount: 15,
        negativeRatio: 0.5,
        avgCompositeScore: 35,
        bestScore: 90,
        worstScore: 10,
        dominantDistribution: { sad: 10, angry: 6, neutral: 4 },
      },
      trend: [],
      riskBursts: [],
      comfortStats: {} as any,
      intervention: {} as any,
      behaviorStats: { self_injury: { count: 2, avgConfidence: 0.9 }, stamp: { count: 1, avgConfidence: 0.8 } },
    } as DashboardData;
    const p = buildAdviceProfile(dashboard);
    expect(p.negativeRatio).toBe(0.5);
    expect(p.topEmotions).toEqual(['sad', 'angry', 'neutral']);
    expect(p.presentBehaviors).toContain('self_injury');
    expect(p.riskBehaviors).toEqual(['self_injury']);
  });

  it('computeSeverity 对高危行为判定 CRITICAL', () => {
    expect(computeSeverity(PROFILE)).toBe('CRITICAL');
  });

  it('computeSeverity 按负面占比升级', () => {
    expect(computeSeverity({ ...PROFILE, presentBehaviors: [], riskBehaviors: [], negativeRatio: 0.7 })).toBe('HIGH');
    expect(computeSeverity({ ...PROFILE, presentBehaviors: [], riskBehaviors: [], negativeRatio: 0.4 })).toBe('MEDIUM');
    expect(computeSeverity({ ...PROFILE, presentBehaviors: [], riskBehaviors: [], negativeRatio: 0.1 })).toBe('LOW');
  });

  it('scoreKnowledge 情绪/行为命中累加分数', () => {
    const s = scoreKnowledge(ITEMS[1], PROFILE, 'CRITICAL');
    expect(s.score).toBeGreaterThan(ITEMS[1].priority!); // 命中 sad/angry 加成
    expect(s.matchReasons.some((r) => r.includes('情绪命中'))).toBe(true);
  });

  it('matchKnowledge 按分数降序并支持 target 过滤', () => {
    const ranked = matchKnowledge(ITEMS, PROFILE);
    expect(ranked[0].severity).toBe('CRITICAL'); // 自伤条目最高优先
    const teacherOnly = matchKnowledge(ITEMS, PROFILE, { target: 'TEACHER' });
    expect(teacherOnly.every((t) => t.target === 'ALL' || t.target === 'TEACHER')).toBe(true);
    expect(teacherOnly.every((t) => t.target === 'PARENT')).toBe(false);
  });

  it('generateAdvice 产出严重度/摘要/TopN/分组', () => {
    const r = generateAdvice(ITEMS, PROFILE, { topN: 3 });
    expect(r.severity).toBe('CRITICAL');
    expect(r.topItems.length).toBeLessThanOrEqual(3);
    expect(r.summary).toContain('紧急');
    expect(Object.keys(r.byCategory).length).toBeGreaterThan(0);
    expect(r.topItems[0].category).toBe('CRISIS_INTERVENTION');
  });

  it('buildAdvicePrompt 包含画像与候选建议', () => {
    const r = generateAdvice(ITEMS, PROFILE, { topN: 8 });
    const prompt = buildAdvicePrompt(PROFILE, r.topItems);
    expect(prompt).toContain('资深特殊儿童心理与特教顾问');
    expect(prompt).toContain('self_injury');
    expect(prompt).toContain('自伤即时处置');
  });
});
