/**
 * 人脸特征向量工具：余弦相似度计算与 1:N 比对。
 * 使用纯 TS 实现，避免引入重依赖；实际生产可替换为 Faiss / 向量数据库。
 */

export function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** 余弦相似度，范围 [-1, 1] */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 将余弦相似度映射到 0-100 的置信度分数 */
export function toConfidence(cosine: number): number {
  const c = Math.max(0, Math.min(1, cosine)) * 100;
  return Math.round(c * 100) / 100;
}

export interface Candidate {
  id: string; // 关联实体（学生）ID
  descriptorId: string;
  vector: number[];
}

export interface FaceMatchResult {
  matched: boolean;
  studentId?: string;
  descriptorId?: string;
  confidence: number; // 0-100
  bestCosine: number;
}

/**
 * 在候选向量集合中寻找最佳匹配（1:N 比对）。
 * @param query 待比对向量
 * @param candidates 候选向量（按学生聚合，每人可多个角度）
 * @param threshold 匹配置信度阈值（0-1 的余弦阈值，如 0.85）
 */
export function matchFace(
  query: number[],
  candidates: Candidate[],
  threshold: number,
): FaceMatchResult {
  let best: { studentId: string; descriptorId: string; cos: number } | null = null;
  for (const c of candidates) {
    const cos = cosineSimilarity(query, c.vector);
    if (!best || cos > best.cos) {
      best = { studentId: c.id, descriptorId: c.descriptorId, cos };
    }
  }
  const bestCosine = best ? best.cos : 0;
  const matched = best !== null && bestCosine >= threshold;
  return {
    matched,
    studentId: best?.studentId,
    descriptorId: best?.descriptorId,
    confidence: toConfidence(bestCosine),
    bestCosine,
  };
}
