import {
  bucketKey,
  periodRange,
  bucketizeTrend,
  summarizeEmotion,
  detectRiskBursts,
  computeComfortStats,
  computeInterventionEffect,
  dashboardToCsv,
  type DashboardData,
  type EmotionFrameInput,
} from './report.aggregate';

describe('report.aggregate', () => {
  describe('bucketKey', () => {
    it('day / week / month 分桶正确', () => {
      // 2026-08-14 是周五（UTC）；周一为 2026-08-10
      const friday = '2026-08-14T10:00:00.000Z';
      expect(bucketKey(friday, 'day')).toBe('2026-08-14');
      expect(bucketKey(friday, 'month')).toBe('2026-08');
      expect(bucketKey(friday, 'week')).toBe('2026-08-10');
    });
  });

  describe('periodRange', () => {
    it('DAILY 默认返回今天 00:00 ~ 明天 00:00', () => {
      const { from, to } = periodRange('DAILY');
      expect(to.getTime() - from.getTime()).toBe(86400000);
    });
    it('CUSTOM 支持显式 from/to', () => {
      const { from, to } = periodRange('CUSTOM', '2026-08-01T00:00:00.000Z', '2026-08-08T00:00:00.000Z');
      expect(from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(to.toISOString()).toBe('2026-08-08T00:00:00.000Z');
    });
  });

  describe('bucketizeTrend', () => {
    const frames: EmotionFrameInput[] = [
      { ts: '2026-08-10T01:00:00.000Z', compositeScore: 80, negative: false, dominant: 'happy' },
      { ts: '2026-08-10T02:00:00.000Z', compositeScore: 60, negative: false, dominant: 'calm' },
      { ts: '2026-08-11T01:00:00.000Z', compositeScore: 30, negative: true, dominant: 'sad' },
    ];
    it('按天分桶并计算均值/负面占比', () => {
      const t = bucketizeTrend(frames, 'day');
      expect(t).toHaveLength(2);
      expect(t[0].bucket).toBe('2026-08-10');
      expect(t[0].frameCount).toBe(2);
      expect(t[0].avgCompositeScore).toBeCloseTo(70, 5);
      expect(t[0].negativeRatio).toBe(0);
      expect(t[1].negativeRatio).toBe(1);
      expect(t[1].dominantCounts).toEqual({ sad: 1 });
    });
    it('按月分桶合并跨天数据', () => {
      const t = bucketizeTrend(frames, 'month');
      expect(t).toHaveLength(1);
      expect(t[0].frameCount).toBe(3);
    });
  });

  describe('summarizeEmotion', () => {
    it('汇总负面占比/均值/极值', () => {
      const frames: EmotionFrameInput[] = [
        { ts: '2026-08-10T01:00:00.000Z', compositeScore: 90, negative: false, dominant: 'happy' },
        { ts: '2026-08-10T02:00:00.000Z', compositeScore: 20, negative: true, dominant: 'sad' },
        { ts: '2026-08-10T03:00:00.000Z', compositeScore: 50, negative: false, dominant: 'calm' },
      ];
      const s = summarizeEmotion(frames);
      expect(s.frameCount).toBe(3);
      expect(s.negativeCount).toBe(1);
      expect(s.negativeRatio).toBeCloseTo(1 / 3, 5);
      expect(s.avgCompositeScore).toBeCloseTo(160 / 3, 5);
      expect(s.bestScore).toBe(90); // 最正面
      expect(s.worstScore).toBe(20); // 最负面
    });
    it('空帧返回零值而非 NaN', () => {
      const s = summarizeEmotion([]);
      expect(s.avgCompositeScore).toBe(0);
      expect(s.negativeRatio).toBe(0);
    });
  });

  describe('detectRiskBursts', () => {
    it('将间隔 < gap 的连续负向帧合并为一段', () => {
      const frames: EmotionFrameInput[] = [
        { ts: '2026-08-10T10:00:00.000Z', compositeScore: 20, negative: true, dominant: 'sad' },
        { ts: '2026-08-10T10:00:30.000Z', compositeScore: 15, negative: true, dominant: 'sad' },
        { ts: '2026-08-10T10:01:00.000Z', compositeScore: 25, negative: true, dominant: 'angry' },
      ];
      const bursts = detectRiskBursts(frames, 60);
      expect(bursts).toHaveLength(1);
      expect(bursts[0].frameCount).toBe(3);
      expect(bursts[0].durationSec).toBe(60);
      expect(bursts[0].peakNegativeScore).toBe(15); // 最低分（最负面）
      expect(bursts[0].dominant).toBe('sad');
    });
    it('间隔 > gap 拆分为多段', () => {
      const frames: EmotionFrameInput[] = [
        { ts: '2026-08-10T10:00:00.000Z', compositeScore: 20, negative: true, dominant: 'sad' },
        { ts: '2026-08-10T10:10:00.000Z', compositeScore: 22, negative: true, dominant: 'angry' },
      ];
      const bursts = detectRiskBursts(frames, 60);
      expect(bursts).toHaveLength(2);
    });
    it('非负向帧不产生风险事件', () => {
      const frames: EmotionFrameInput[] = [
        { ts: '2026-08-10T10:00:00.000Z', compositeScore: 80, negative: false, dominant: 'happy' },
      ];
      expect(detectRiskBursts(frames)).toHaveLength(0);
    });
  });

  describe('computeComfortStats', () => {
    it('统计会话数/状态/触发来源/平均消息', () => {
      const stats = computeComfortStats([
        { status: 'ENDED', triggerSource: 'DETECTION', messageCount: 8 },
        { status: 'ACTIVE', triggerSource: 'MANUAL', messageCount: 2 },
        { status: 'ENDED', triggerSource: 'DETECTION', messageCount: 4 },
      ]);
      expect(stats.sessionCount).toBe(3);
      expect(stats.endedCount).toBe(2);
      expect(stats.activeCount).toBe(1);
      expect(stats.totalMessages).toBe(14);
      expect(stats.avgMessageCount).toBeCloseTo(14 / 3, 5);
      expect(stats.triggerSourceDistribution).toEqual({ DETECTION: 2, MANUAL: 1 });
    });
  });

  describe('computeInterventionEffect', () => {
    it('覆盖率 = min(检测触发会话 / 负向段数, 1)', () => {
      const bursts = detectRiskBursts([
        { ts: '2026-08-10T10:00:00.000Z', compositeScore: 20, negative: true, dominant: 'sad' },
        { ts: '2026-08-10T12:00:00.000Z', compositeScore: 22, negative: true, dominant: 'angry' },
      ]);
      const sessions = [
        { status: 'ENDED', triggerSource: 'DETECTION', messageCount: 6 },
      ];
      const iv = computeInterventionEffect(bursts, sessions);
      expect(iv.negativeBursts).toBe(2);
      expect(iv.comfortTriggered).toBe(1);
      expect(iv.coverageRate).toBe(0.5);
      expect(iv.avgMessagesWhenTriggered).toBe(6);
    });
    it('无负向段时覆盖率为 0', () => {
      const iv = computeInterventionEffect([], []);
      expect(iv.coverageRate).toBe(0);
    });
  });

  describe('dashboardToCsv', () => {
    it('生成含趋势/风险/安抚三段的多段 CSV', () => {
      const dash: DashboardData = {
        studentId: 'stu1',
        period: { from: '2026-08-10T00:00:00.000Z', to: '2026-08-11T00:00:00.000Z', type: 'CUSTOM' },
        summary: summarizeEmotion([]),
        trend: bucketizeTrend([
          { ts: '2026-08-10T01:00:00.000Z', compositeScore: 80, negative: false, dominant: 'happy' },
        ]),
        riskBursts: detectRiskBursts([
          { ts: '2026-08-10T10:00:00.000Z', compositeScore: 20, negative: true, dominant: 'sad' },
        ]),
        comfortStats: computeComfortStats([
          { status: 'ENDED', triggerSource: 'DETECTION', messageCount: 4 },
        ]),
        intervention: computeInterventionEffect([], []),
        behaviorStats: { rocking: { count: 3, avgConfidence: 0.8 } },
      };
      const csv = dashboardToCsv(dash);
      expect(csv).toContain('# 情绪趋势');
      expect(csv).toContain('# 风险事件');
      expect(csv).toContain('# 安抚与干预');
      expect(csv).toContain('stu1');
      expect(csv).toContain('2026-08-10');
    });
  });
});
