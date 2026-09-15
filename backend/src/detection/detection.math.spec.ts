import {
  computeCompositeScore,
  isNegativeState,
  normalizeScores,
  classifyBehavior,
} from './detection.math';

describe('detection.math', () => {
  describe('normalizeScores', () => {
    it('fills 0 for missing emotions and clamps to 0-100', () => {
      const n = normalizeScores({ happy: 200, sad: -5 });
      expect(n.happy).toBe(100);
      expect(n.sad).toBe(0);
      expect(n.angry).toBe(0);
      expect(n.neutral).toBe(0);
    });
  });

  describe('computeCompositeScore', () => {
    it('returns high score for happy-dominant input', () => {
      const r = computeCompositeScore({ happy: 90, neutral: 8, sad: 2 });
      expect(r.dominant).toBe('happy');
      expect(r.compositeScore).toBeGreaterThan(85);
      expect(r.negative).toBe(false);
    });

    it('returns low score and negative for angry-dominant input', () => {
      const r = computeCompositeScore({ angry: 80, sad: 12, neutral: 5, fear: 3 });
      expect(r.dominant).toBe('angry');
      expect(r.compositeScore).toBeLessThan(40);
      expect(r.negative).toBe(true);
    });

    it('treats neutral as calm baseline (~70)', () => {
      const r = computeCompositeScore({ neutral: 100 });
      expect(r.compositeScore).toBeCloseTo(70, 0);
      expect(r.negative).toBe(false);
    });

    it('does NOT flag negative for mild negative emotion (threshold tightened to 45)', () => {
      // 阈值由 35 收紧到 45：天生低表达/轻微负向不再被误判为需要安抚
      const r = computeCompositeScore({ neutral: 60, fear: 36, sad: 4 });
      expect(r.negative).toBe(false);
    });

    it('flags negative when a negative emotion exceeds 45 threshold', () => {
      const r = computeCompositeScore({ neutral: 50, fear: 50, sad: 4 });
      expect(r.negative).toBe(true);
    });
  });

  describe('isNegativeState', () => {
    it('uses compositeFloor default 45', () => {
      expect(isNegativeState({ neutral: 50, sad: 10 }, 44)).toBe(true);
      expect(isNegativeState({ neutral: 50, sad: 10 }, 46)).toBe(false);
    });
    it('respects custom threshold options', () => {
      expect(isNegativeState({ angry: 20 }, 60, { negativeEmotionThreshold: 50 })).toBe(false);
    });
  });

  describe('classifyBehavior', () => {
    it('detects self_injury as top priority', () => {
      const r = classifyBehavior({ selfHit: 0.8, motionEnergy: 0.9 });
      expect(r.behavior).toBe('self_injury');
    });
    it('detects clap via handClap', () => {
      const r = classifyBehavior({ handClap: 0.8, motionEnergy: 0.4 });
      expect(r.behavior).toBe('clap');
    });
    it('detects cover_face', () => {
      const r = classifyBehavior({ handsNearFace: 0.9 });
      expect(r.behavior).toBe('cover_face');
    });
    it('detects spin via angular', () => {
      const r = classifyBehavior({ angular: 0.7, motionEnergy: 0.6 });
      expect(r.behavior).toBe('spin');
    });
    it('detects shake_head via headSway', () => {
      const r = classifyBehavior({ headSway: 0.8 });
      expect(r.behavior).toBe('shake_head');
    });
    it('detects run for large horizontal motion', () => {
      const r = classifyBehavior({ motionEnergy: 0.8, dx: 0.6, dy: 0.1 });
      expect(r.behavior).toBe('run');
    });
    it('detects jump for large vertical motion', () => {
      const r = classifyBehavior({ motionEnergy: 0.9, dx: 0.1, dy: 0.8 });
      expect(r.behavior).toBe('jump');
    });
    it('detects leave_seat', () => {
      const r = classifyBehavior({ offSeat: 0.8 });
      expect(r.behavior).toBe('leave_seat');
    });
    it('defaults to sit_still when still', () => {
      const r = classifyBehavior({ stillness: 0.95 });
      expect(r.behavior).toBe('sit_still');
    });
    it('falls back to sit_still when no confident behavior', () => {
      const r = classifyBehavior({ motionEnergy: 0.05, dx: 0.02 });
      expect(r.behavior).toBe('sit_still');
    });
  });
});
