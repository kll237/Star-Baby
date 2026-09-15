import {
  mapDetectionToReaction,
  mapRiskToReaction,
  mapComfortToReaction,
  mapAdviceToReaction,
  mapCommandToReaction,
  clampScore,
  type DetectionBroadcast,
} from './deskpet.reaction';

describe('deskpet.reaction', () => {
  describe('clampScore', () => {
    it('收敛到 0-100 整数区间', () => {
      expect(clampScore(150)).toBe(100);
      expect(clampScore(-5)).toBe(0);
      expect(clampScore(42.6)).toBe(43);
    });
    it('非数字返回 0', () => {
      expect(clampScore(NaN)).toBe(0);
    });
  });

  describe('mapDetectionToReaction', () => {
    const base = (over: Partial<DetectionBroadcast> = {}): DetectionBroadcast => ({
      studentId: 's1',
      dominant: 'neutral',
      compositeScore: 70,
      negative: false,
      ts: '2026-01-01T00:00:00.000Z',
      ...over,
    });

    it('happy → celebrate / dance', () => {
      const r = mapDetectionToReaction(base({ dominant: 'happy', compositeScore: 90 }));
      expect(r.mood).toBe('celebrate');
      expect(r.animation).toBe('dance');
    });
    it('angry → angry / shake', () => {
      const r = mapDetectionToReaction(base({ dominant: 'angry', compositeScore: 30 }));
      expect(r.mood).toBe('angry');
      expect(r.animation).toBe('shake');
    });
    it('fear → anxious / hug', () => {
      const r = mapDetectionToReaction(base({ dominant: 'fear' }));
      expect(r.mood).toBe('anxious');
      expect(r.animation).toBe('hug');
    });
    it('sad → sad / sway', () => {
      const r = mapDetectionToReaction(base({ dominant: 'sad' }));
      expect(r.mood).toBe('sad');
      expect(r.animation).toBe('sway');
    });
    it('risk 标志 → alert', () => {
      const r = mapDetectionToReaction(base({ risk: true }));
      expect(r.mood).toBe('alert');
      expect(r.animation).toBe('alert');
    });
    it('behaviors 含 self_injury → alert', () => {
      const r = mapDetectionToReaction(base({ behaviors: [{ behavior: 'self_injury', confidence: 0.9 }] }));
      expect(r.mood).toBe('alert');
    });
    it('compositeScore<40 → anxious', () => {
      const r = mapDetectionToReaction(base({ dominant: 'neutral', compositeScore: 20 }));
      expect(r.mood).toBe('anxious');
    });
    it('默认（平静高分）→ calm / idle', () => {
      const r = mapDetectionToReaction(base({ dominant: 'neutral', compositeScore: 70 }));
      expect(r.mood).toBe('calm');
      expect(r.animation).toBe('idle');
    });
    it('ts 缺失时回退到当前时间', () => {
      const r = mapDetectionToReaction(base({ ts: undefined }));
      expect(typeof r.ts).toBe('string');
      expect(Number.isNaN(Date.parse(r.ts))).toBe(false);
    });
  });

  describe('其它映射', () => {
    it('mapRiskToReaction 返回 alert 且含行为名', () => {
      const r = mapRiskToReaction('self_injury');
      expect(r.mood).toBe('alert');
      expect(r.message).toContain('self_injury');
    });
    it('mapComfortToReaction 默认文案 → celebrate / cheer', () => {
      const r = mapComfortToReaction();
      expect(r.mood).toBe('celebrate');
      expect(r.animation).toBe('cheer');
      expect(r.message).toContain('星宝');
    });
    it('mapAdviceToReaction HIGH → alert 且 intensity 80', () => {
      const r = mapAdviceToReaction('HIGH');
      expect(r.mood).toBe('alert');
      expect(r.intensity).toBe(80);
    });
    it('mapAdviceToReaction LOW → calm', () => {
      const r = mapAdviceToReaction('LOW');
      expect(r.mood).toBe('calm');
    });
    it('mapCommandToReaction dance → dance', () => {
      expect(mapCommandToReaction('dance').animation).toBe('dance');
    });
    it('mapCommandToReaction 未知动作 → bounce', () => {
      expect(mapCommandToReaction('unknown').animation).toBe('bounce');
    });
  });
});
