import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../security/crypto.service';
import { AuditService } from '../audit/audit.service';
import { FaceAlgorithm } from '@prisma/client';
import { Candidate, matchFace, FaceMatchResult } from '../common/utils/face-vector.util';

export interface RegisterFaceInput {
  studentId: string;
  livenessPassed: boolean;
  algorithm?: FaceAlgorithm;
  vectors: { angle: string; vector: number[] }[];
}

export interface FaceLoginResult {
  matched: boolean;
  studentId?: string;
  studentName?: string;
  confidence: number;
  threshold: number;
}

/** 演示学生名称（仅用于无摄像头演示直登，不与真实刷脸注册流程耦合） */
export const DEMO_STUDENT_NAME = '演示学生-小明';

@Injectable()
export class FaceService {
  private readonly logger = new Logger(FaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get threshold(): number {
    return this.config.get<number>('faceMatchThreshold') || 0.85;
  }

  /** 校验当前用户对某学生有管理权限（创建者或监护人） */
  private async assertManage(userId: string, studentId: string) {
    const s = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        OR: [{ ownerId: userId }, { guardians: { some: { id: userId } } }],
      },
    });
    if (!s) throw new ForbiddenException('无权为该学生注册人脸');
  }

  /** 人脸注册：多模态向量加密存储 + 活体标记 */
  async registerFace(userId: string, dto: RegisterFaceInput): Promise<{ count: number }> {
    await this.assertManage(userId, dto.studentId);
    if (!dto.livenessPassed) {
      throw new BadRequestException('活体检测未通过，无法注册');
    }
    if (!dto.vectors || dto.vectors.length === 0) {
      throw new BadRequestException('未提供任何人脸特征向量');
    }
    const algorithm = dto.algorithm || FaceAlgorithm.FACE_API_TINY;
    const rows = dto.vectors.map((v) => ({
      studentId: dto.studentId,
      payload: this.crypto.encryptVector(v.vector),
      algorithm,
      livenessPassed: true,
      angle: v.angle || 'front',
    }));
    await this.prisma.faceDescriptor.createMany({ data: rows });
    await this.audit.log({
      userId,
      action: 'FACE_REGISTER',
      resource: 'face',
      detail: { studentId: dto.studentId, angles: dto.vectors.map((v) => v.angle) },
    });
    return { count: rows.length };
  }

  /** 1:N 人脸识别登录 */
  async faceLogin(vector: number[]): Promise<FaceLoginResult> {
    const descriptors = await this.prisma.faceDescriptor.findMany({
      where: { student: { status: 'ACTIVE' } },
      include: { student: { select: { id: true, name: true } } },
    });
    const candidates: Candidate[] = descriptors
      .map((d) => {
        try {
          return {
            id: d.student.id,
            descriptorId: d.id,
            vector: this.crypto.decryptVector(d.payload),
          };
        } catch (err) {
          this.logger.warn(`跳过损坏的人脸特征记录: descriptorId=${d.id}, 学生=${d.student.name}, 原因: ${err.message}`);
          return null;
        }
      })
      .filter((c): c is Candidate => c !== null);
    const result: FaceMatchResult = matchFace(vector, candidates, this.threshold);
    if (result.matched && result.studentId) {
      const student = descriptors.find((d) => d.student.id === result.studentId)?.student;
      await this.audit.log({
        action: 'FACE_LOGIN',
        resource: 'face',
        detail: { studentId: result.studentId, confidence: result.confidence },
      });
      return {
        matched: true,
        studentId: result.studentId,
        studentName: student?.name,
        confidence: result.confidence,
        threshold: this.threshold,
      };
    }
    return { matched: false, confidence: result.confidence, threshold: this.threshold };
  }

  /** 选择账号后的二次人脸验证（登录失败回退方案） */
  async faceVerify(studentId: string, vector: number[]): Promise<FaceLoginResult> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, status: true },
    });
    if (!student) throw new NotFoundException('学生不存在');
    if (student.status !== 'ACTIVE') throw new ForbiddenException('该学生账号已禁用');

    const descriptors = await this.prisma.faceDescriptor.findMany({ where: { studentId } });
    const candidates: Candidate[] = descriptors
      .map((d) => {
        try {
          return {
            id: d.studentId,
            descriptorId: d.id,
            vector: this.crypto.decryptVector(d.payload),
          };
        } catch (err) {
          this.logger.warn(`跳过损坏的人脸特征记录: descriptorId=${d.id}, studentId=${d.studentId}, 原因: ${err.message}`);
          return null;
        }
      })
      .filter((c): c is Candidate => c !== null);
    const result = matchFace(vector, candidates, this.threshold);
    await this.audit.log({
      action: 'FACE_VERIFY',
      resource: 'face',
      detail: { studentId, matched: result.matched, confidence: result.confidence },
    });
    return {
      matched: result.matched,
      studentId: result.matched ? student.id : undefined,
      studentName: result.matched ? student.name : undefined,
      confidence: result.confidence,
      threshold: this.threshold,
    };
  }

  /**
   * 演示学生免刷脸登录：仅命中 seed 中的「演示学生-小明」，用于摄像头损坏时的无设备演示。
   * 不影响其它学生的正常刷脸注册 / 登录链路。
   */
  async resolveDemoStudent(): Promise<{ studentId: string; studentName: string }> {
    const student = await this.prisma.student.findFirst({
      where: { name: DEMO_STUDENT_NAME, status: 'ACTIVE' },
    });
    if (!student) {
      throw new NotFoundException(`未找到演示学生「${DEMO_STUDENT_NAME}」，请先由家长端创建该学生`);
    }
    return { studentId: student.id, studentName: student.name };
  }
}
