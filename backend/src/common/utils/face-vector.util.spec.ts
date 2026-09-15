import { cosineSimilarity, toConfidence, matchFace } from './face-vector.util';

describe('face-vector.util', () => {
  const vA = [1, 0, 0, 0];
  const vA2 = [1, 0.01, 0, 0];
  const vB = [0, 1, 0, 0];

  it('相同向量余弦相似度为 1', () => {
    expect(cosineSimilarity(vA, vA)).toBeCloseTo(1, 6);
  });

  it('正交向量余弦相似度为 0', () => {
    expect(cosineSimilarity(vA, vB)).toBeCloseTo(0, 6);
  });

  it('近似向量余弦接近 1', () => {
    expect(cosineSimilarity(vA, vA2)).toBeGreaterThan(0.99);
  });

  it('置信度映射正确', () => {
    expect(toConfidence(1)).toBe(100);
    expect(toConfidence(0)).toBe(0);
  });

  it('matchFace 命中最佳候选且尊重阈值', () => {
    const candidates = [
      { id: 's1', descriptorId: 'd1', vector: vB },
      { id: 's2', descriptorId: 'd2', vector: vA },
    ];
    const res = matchFace(vA, candidates, 0.85);
    expect(res.matched).toBe(true);
    expect(res.studentId).toBe('s2');
    expect(res.confidence).toBeGreaterThan(99);
  });

  it('低于阈值时不匹配', () => {
    const candidates = [{ id: 's1', descriptorId: 'd1', vector: vB }];
    const res = matchFace(vA, candidates, 0.85);
    expect(res.matched).toBe(false);
  });
});
