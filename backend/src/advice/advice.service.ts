import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DetectionService } from '../detection/detection.service';
import { ReportService } from '../report/report.service';
import { DeskPetService } from '../deskpet/deskpet.service';
import { CacheService } from '../cache/cache.service';
import {
  buildAdviceProfile,
  generateAdvice,
  buildAdvicePrompt,
  type ScoredKnowledgeSeed,
  type AdviceResult,
} from './advice.engine';
import { KNOWLEDGE_ITEMS } from './advice.knowledge';
import { normalizeSeverity, normalizeTarget, type KnowledgeCategoryKey } from './advice.taxonomy';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import type { ReportPeriodType } from './dto/advice.dto';

export interface KnowledgeView {
  id: string;
  category: string;
  title: string;
  content: string;
  summary?: string | null;
  source?: string | null;
  severity: string;
  target: string;
  applicableEmotions: string[];
  applicableBehaviors: string[];
  tags: string[];
  reference?: string | null;
  priority: number;
  isActive: boolean;
}

export interface AdviceRecordView {
  id: string;
  studentId: string;
  severity: string;
  summary: string;
  itemCount: number;
  createdAt: string;
}

@Injectable()
export class AdviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly detection: DetectionService,
    private readonly report: ReportService,
    private readonly deskpet: DeskPetService,
    private readonly cache: CacheService,
  ) {}

  // ---------------- 权限（与既有模块一致） ----------------
  async assertStudentAccess(user: AuthUser, studentId: string): Promise<void> {
    const uid = (user as any).sub ?? (user as any).userId;
    if ((user as any).role === 'STUDENT') {
      if (uid !== studentId) throw new ForbiddenException('只能查看自己的数据');
      return;
    }
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { guardians: { select: { id: true } } },
    });
    if (!student) throw new ForbiddenException('学生不存在');
    const ownerOk = student.ownerId === uid;
    const guardianOk = student.guardians.some((g: any) => g.id === uid);
    if (!ownerOk && !guardianOk) throw new ForbiddenException('无权访问该学生数据');
  }

  // ---------------- 知识库 ----------------

  /** 从种子库映射为 ScoredKnowledgeSeed（去重用 title 作为自然键）。 */
  private seedToSeed(): ScoredKnowledgeSeed[] {
    return KNOWLEDGE_ITEMS.map((k) => ({
      category: k.category,
      title: k.title,
      content: k.content,
      source: k.source,
      severity: k.severity ?? 'LOW',
      target: k.target ?? 'ALL',
      applicableEmotions: k.applicableEmotions ?? [],
      applicableBehaviors: k.applicableBehaviors ?? [],
      tags: k.tags ?? [],
      reference: k.reference,
      priority: k.priority ?? 0,
      isActive: k.isActive ?? true,
    }));
  }

  /** 查询知识库（库内条目与种子库合并视图，支持分类/对象/严重度/关键词过滤）。 */
  async getKnowledge(query: {
    category?: string;
    target?: string;
    severity?: string;
    keyword?: string;
    limit?: number;
    offset?: number;
    includeInactive?: boolean;
  }): Promise<{ total: number; items: KnowledgeView[] }> {
    // 知识库为读多写少，按查询条件缓存 60s
    const cacheKey = CacheService.key('knowledge', [
      query.category ?? '',
      query.target ?? '',
      query.severity ?? '',
      query.keyword ?? '',
      query.limit ?? 50,
      query.offset ?? 0,
      query.includeInactive ? 1 : 0,
    ]);
    const cached = await this.cache.getJSON<{ total: number; items: KnowledgeView[] }>(cacheKey);
    if (cached) return cached;

    const where: any = {};
    if (query.category) where.category = query.category as KnowledgeCategoryKey;
    if (query.target) where.target = normalizeTarget(query.target);
    if (query.severity) where.severity = normalizeSeverity(query.severity);
    if (query.includeInactive !== true) where.isActive = true;
    if (query.keyword) {
      const kw = query.keyword;
      where.OR = [
        { title: { contains: kw, mode: 'insensitive' } },
        { content: { contains: kw, mode: 'insensitive' } },
        { tags: { has: kw } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.knowledgeItem.count({ where }),
      this.prisma.knowledgeItem.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        take: query.limit ?? 50,
        skip: query.offset ?? 0,
      }),
    ]);
    const result = { total, items: rows.map((r: any) => this.mapKnowledge(r)) };
    await this.cache.setJSON(cacheKey, result, 60);
    return result;
  }

  private mapKnowledge(r: any): KnowledgeView {
    return {
      id: r.id,
      category: r.category,
      title: r.title,
      content: r.content,
      summary: r.summary,
      source: r.source,
      severity: r.severity,
      target: r.target,
      applicableEmotions: r.applicableEmotions ?? [],
      applicableBehaviors: r.applicableBehaviors ?? [],
      tags: r.tags ?? [],
      reference: r.reference,
      priority: r.priority ?? 0,
      isActive: r.isActive ?? true,
    };
  }

  /** 将种子知识库写入数据库（幂等：按 title 去重）。返回写入条数。 */
  async seedKnowledge(): Promise<{ inserted: number; total: number }> {
    const existing = await this.prisma.knowledgeItem.findMany({ select: { title: true } });
    const have = new Set(existing.map((e: any) => e.title));
    const toInsert = this.seedToSeed().filter((s) => !have.has(s.title));
    if (toInsert.length) {
      await this.prisma.knowledgeItem.createMany({
        data: toInsert.map((s) => ({
          category: s.category,
          title: s.title,
          content: s.content,
          summary: s.content.slice(0, 60),
          source: s.source ?? null,
          severity: s.severity!,
          target: s.target!,
          applicableEmotions: s.applicableEmotions!,
          applicableBehaviors: s.applicableBehaviors!,
          tags: s.tags!,
          reference: s.reference ?? null,
          priority: s.priority!,
          isActive: s.isActive ?? true,
        })) as any,
      });
    }
    const total = await this.prisma.knowledgeItem.count();
    if (toInsert.length) await this.cache.deleteByPrefix('knowledge:');
    return { inserted: toInsert.length, total };
  }

  async countKnowledge(): Promise<number> {
    return this.prisma.knowledgeItem.count({ where: { isActive: true } });
  }

  // ---------------- 建议生成 ----------------

  /**
   * 基于学生在指定周期的检测/对话数据生成专业建议：
   * 1) 复用 ReportService 聚合看板；2) 提炼画像；3) 知识库打分排序；4) 持久化 AdviceRecord。
   */
  async generateAdvice(
    studentId: string,
    opts: {
      period?: ReportPeriodType;
      from?: string;
      to?: string;
      target?: 'ALL' | 'PARENT' | 'TEACHER' | 'STUDENT';
      topN?: number;
      generatedById?: string;
    },
  ): Promise<{ result: AdviceResult; recordId: string; from: string; to: string }> {
    const dash = await this.report.getDashboard(
      studentId,
      (opts.period as any) ?? 'CUSTOM',
      opts.from,
      opts.to,
      'day',
    );
    const profile = buildAdviceProfile(dash);
    const kb = await this.prisma.knowledgeItem.findMany({
      where: { isActive: true },
      select: {
        category: true,
        title: true,
        content: true,
        source: true,
        severity: true,
        target: true,
        applicableEmotions: true,
        applicableBehaviors: true,
        tags: true,
        reference: true,
        priority: true,
      },
    });
    const seed: ScoredKnowledgeSeed[] = kb.map((k: any) => ({
      category: k.category,
      title: k.title,
      content: k.content,
      source: k.source,
      severity: normalizeSeverity(k.severity),
      target: normalizeTarget(k.target),
      applicableEmotions: k.applicableEmotions ?? [],
      applicableBehaviors: k.applicableBehaviors ?? [],
      tags: k.tags ?? [],
      reference: k.reference,
      priority: k.priority ?? 0,
      isActive: true,
    }));

    const result = generateAdvice(seed, profile, { target: opts.target, topN: opts.topN });

    const { from, to } = dash.period;
    // 用 Prisma 交互式事务保证「建议记录写入」与「审计日志写入」的原子性：
    // 任一失败整体回滚，避免出现有建议却无审计（或反之）的不一致状态。
    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.adviceRecord.create({
        data: {
          studentId,
          periodFrom: new Date(from),
          periodTo: new Date(to),
          severity: result.severity as any,
          summary: result.summary,
          items: result.topItems as any,
          generatedById: opts.generatedById ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: opts.generatedById ?? studentId,
          action: 'advice.generate',
          resource: 'AdviceRecord',
          detail: {
            studentId,
            severity: result.severity,
            itemCount: result.topItems.length,
            recordId: created.id,
          } as any,
        },
      });
      return created;
    });

    // 阶段六：把专业建议推送为桌宠反应（WebSocket + MQTT），与主流程解耦，失败不影响已提交的建议
    this.deskpet.handleAdvice(studentId, { severity: result.severity }).catch(() => {});

    return { result, recordId: record.id, from, to };
  }

  /** 构造 LLM 提示词（供阶段三可切换 LLM 进一步润色报告）。 */
  async buildPrompt(
    studentId: string,
    opts: { period?: ReportPeriodType; from?: string; to?: string; target?: 'ALL' | 'PARENT' | 'TEACHER' | 'STUDENT'; topN?: number },
  ): Promise<string> {
    const dash = await this.report.getDashboard(studentId, (opts.period as any) ?? 'CUSTOM', opts.from, opts.to, 'day');
    const profile = buildAdviceProfile(dash);
    const kb = await this.prisma.knowledgeItem.findMany({
      where: { isActive: true },
      select: { category: true, title: true, content: true, severity: true, target: true },
    });
    const seed: ScoredKnowledgeSeed[] = kb.map((k: any) => ({
      category: k.category,
      title: k.title,
      content: k.content,
      severity: normalizeSeverity(k.severity),
      target: normalizeTarget(k.target),
      applicableEmotions: [], applicableBehaviors: [], tags: [], priority: 0, isActive: true,
    }));
    const result = generateAdvice(seed, profile, { target: opts.target, topN: opts.topN });
    return buildAdvicePrompt(profile, result.topItems);
  }

  async listRecords(studentId: string, limit = 50): Promise<AdviceRecordView[]> {
    const rows = await this.prisma.adviceRecord.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, studentId: true, severity: true, summary: true, items: true, createdAt: true },
    });
    return rows.map((r: any) => ({
      id: r.id,
      studentId: r.studentId,
      severity: r.severity,
      summary: r.summary,
      itemCount: Array.isArray(r.items) ? r.items.length : 0,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
