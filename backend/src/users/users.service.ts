import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { Gender, Student } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  /** 当前隐私协议版本（前端注册/同意时回传，用于留痕比对）。 */
  static readonly PRIVACY_VERSION = '1.0';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** 创建学生（由家长/教师创建，学生端无密码） */
  async createStudent(ownerId: string, dto: {
    name: string;
    gender?: Gender;
    birthDate?: string;
    avatarUrl?: string;
    remarks?: string;
    consent?: boolean;
    isDemo?: boolean;
  }): Promise<Student> {
    const data: any = { name: dto.name, ownerId };
    if (dto.gender) data.gender = dto.gender;
    if (dto.birthDate) data.birthDate = new Date(dto.birthDate);
    if (dto.avatarUrl) data.avatarUrl = dto.avatarUrl;
    if (dto.remarks) data.remarks = dto.remarks;
    if (dto.consent) data.consentAt = new Date();
    if (dto.isDemo) data.isDemo = true;
    const student = await this.prisma.student.create({ data });
    if (dto.consent) {
      await this.prisma.consentRecord.create({
        data: {
          studentId: student.id,
          guardianId: ownerId,
          action: 'SIGNED',
          version: UsersService.PRIVACY_VERSION,
        },
      });
    }
    await this.audit.log({
      userId: ownerId,
      action: 'STUDENT_CREATE',
      resource: 'student',
      detail: { studentId: student.id },
    });
    return student;
  }

  /**
   * 创建演示账户（独立演示家长 + 其名下 isDemo 学生）。
   * 演示学生被标记为 isDemo，不会出现在公开目录 listDirectory（demo 隔离）。
   * 仅开发/演示环境可调用（生产环境由 controller 拦截）。
   */
  async seedDemo(): Promise<{ already: boolean; guardianId?: string; studentId?: string }> {
    const demoAccount = 'demo_guardian@demo.sp';
    let guardian = await this.prisma.user.findUnique({ where: { account: demoAccount } });
    if (!guardian) {
      const passwordHash = await bcrypt.hash('demo1234', 10);
      guardian = await this.prisma.user.create({
        data: {
          account: demoAccount,
          nickname: '演示家长',
          phone: '13800000000',
          passwordHash,
          role: 'PARENT',
          status: 'ACTIVE',
        },
      });
    }
    const existing = await this.prisma.student.findFirst({
      where: { ownerId: guardian.id, isDemo: true },
    });
    if (existing) return { already: true, guardianId: guardian.id, studentId: existing.id };
    const student = await this.prisma.student.create({
      data: {
        name: '示例学生(演示)',
        gender: 'UNKNOWN',
        ownerId: guardian.id,
        isDemo: true,
        consentAt: new Date(),
      },
    });
    return { already: false, guardianId: guardian.id, studentId: student.id };
  }

  /** 列出当前用户可见的学生（本人创建 或 已关联为监护人） */
  async listStudents(userId: string): Promise<Student[]> {
    return this.prisma.student.findMany({
      where: {
        OR: [{ ownerId: userId }, { guardians: { some: { id: userId } } }],
      },
      include: { faceDescriptors: { select: { id: true, angle: true, createdAt: true, livenessPassed: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getStudent(userId: string, studentId: string): Promise<Student> {
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        OR: [{ ownerId: userId }, { guardians: { some: { id: userId } } }],
      },
      include: { owner: { select: { id: true, nickname: true, role: true } } },
    });
    if (!student) throw new NotFoundException('学生不存在或无权访问');
    return student;
  }

  async updateStudent(userId: string, studentId: string, dto: any): Promise<Student> {
    await this.assertOwnerOrGuardian(userId, studentId);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.birthDate !== undefined) data.birthDate = dto.birthDate ? new Date(dto.birthDate) : null;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.remarks !== undefined) data.remarks = dto.remarks;
    return this.prisma.student.update({ where: { id: studentId }, data });
  }

  async removeStudent(userId: string, studentId: string): Promise<void> {
    await this.assertOwner(userId, studentId);
    await this.prisma.student.delete({ where: { id: studentId } });
    await this.audit.log({ userId, action: 'STUDENT_DELETE', resource: 'student', detail: { studentId } });
  }

  /** 关联其他家长/教师为监护人（仅创建者可操作） */
  async linkGuardian(ownerId: string, studentId: string, guardianAccount: string): Promise<Student> {
    await this.assertOwner(ownerId, studentId);
    const guardian = await this.prisma.user.findUnique({ where: { account: guardianAccount } });
    if (!guardian) throw new BadRequestException('关联账号不存在');
    const stu = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { name: true },
    });
    // 关联成功通知：给被添加的监护人发送确认邮件（真实 SMTP 配置后生效）
    const linked = await this.prisma.user.findUnique({
      where: { id: guardian.id },
      select: { email: true, nickname: true },
    });
    if (linked?.email) {
      await this.mail.sendMail(
        linked.email,
        `【星宝守护】你已被添加为学生「${stu?.name ?? '该学生'}」的监护人`,
        `亲爱的${linked.nickname || '家长'}：\n\n你已被添加为学生「${stu?.name ?? '该学生'}」的监护人。此后该学生的动态提醒将发送到此邮箱。\n\n——星宝守护团队`,
      );
    }

    return this.prisma.student.update({
      where: { id: studentId },
      data: { guardians: { connect: { id: guardian.id } } },
    });
  }

  async unlinkGuardian(ownerId: string, studentId: string, guardianId: string): Promise<Student> {
    await this.assertOwner(ownerId, studentId);
    return this.prisma.student.update({
      where: { id: studentId },
      data: { guardians: { disconnect: { id: guardianId } } },
    });
  }

  /**
   * 学生目录：列出可被关联的全部学生（面向大众，便于家长/教师检索并选择关联）。
   * 仅返回非敏感摘要（姓名/性别/年龄/头像/病情类型），详细画像仅对关联者可见。
   */
  async listDirectory(): Promise<
    { id: string; name: string; gender: string; birthDate: string | null; avatarUrl: string | null; conditionType: string | null }[]
  > {
    const rows = await this.prisma.student.findMany({
      where: { status: { not: 'DISABLED' }, isDemo: false },
      select: {
        id: true,
        name: true,
        gender: true,
        birthDate: true,
        avatarUrl: true,
        profile: { select: { conditionType: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      gender: r.gender,
      birthDate: r.birthDate ? r.birthDate.toISOString() : null,
      avatarUrl: r.avatarUrl ?? null,
      conditionType: r.profile?.conditionType ?? null,
    }));
  }

  /**
   * 家长/教师自行关联某位学生（成为其监护人），并填写/更新该学生的基础画像。
   * 关联后即可在家长/教师端查看该学生状态，保护未关联学生的隐私。
   */
  async associateSelf(
    userId: string,
    studentId: string,
    dto: {
      conditionType?: string;
      conditionSeverity?: string;
      symptoms?: string[];
      likes?: string[];
      hobbies?: string[];
      strengths?: string[];
      dislikes?: string[];
      notes?: string;
      consent: boolean;
    },
  ): Promise<Student> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new NotFoundException('学生不存在');
    if (student.status === 'DISABLED') throw new ForbiddenException('该学生已被禁用');
    if (dto.consent !== true) throw new BadRequestException('关联学生需监护人明确知情同意');

    // 已是监护人则跳过 connect（避免唯一约束冲突）
    const already = await this.prisma.student.findFirst({
      where: { id: studentId, guardians: { some: { id: userId } } },
    });
    if (!already) {
      await this.prisma.student.update({
        where: { id: studentId },
        data: { guardians: { connect: { id: userId } } },
      });
    }

    await this.upsertProfile(userId, studentId, dto);
    await this.prisma.student.update({
      where: { id: studentId },
      data: { consentAt: new Date() },
    });
    if (dto.consent) {
      await this.prisma.consentRecord.create({
        data: {
          studentId,
          guardianId: userId,
          action: 'SIGNED',
          version: UsersService.PRIVACY_VERSION,
        },
      });
    }
    await this.audit.log({
      userId,
      action: 'STUDENT_ASSOCIATE',
      resource: 'student',
      detail: { studentId, conditionType: dto.conditionType },
    });

    // 关联成功通知：给关联者注册邮箱发送确认邮件（真实 SMTP 配置后生效）
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, nickname: true },
    });
    if (me?.email) {
      await this.mail.sendMail(
        me.email,
        `【星宝守护】你已成功关联学生「${student.name}」`,
        `亲爱的${me.nickname || '家长'}：\n\n你已成功关联学生「${student.name}」。此后该学生的危机升级等动态提醒将发送到此邮箱。\n\n——星宝守护团队`,
      );
    }

    return this.prisma.student.findUnique({
      where: { id: studentId },
      include: {
        profile: true,
        guardians: { select: { id: true, nickname: true, role: true } },
      },
    }) as Promise<Student>;
  }

  /** 获取学生基础画像（仅创建者/关联监护人可见）。 */
  async getProfile(userId: string, studentId: string) {
    await this.assertOwnerOrGuardian(userId, studentId);
    return this.prisma.studentProfile.findUnique({ where: { studentId } });
  }

  /** 创建或更新学生基础画像（仅创建者/关联监护人可写）。 */
  async upsertProfile(
    userId: string,
    studentId: string,
    dto: {
      conditionType?: string;
      conditionSeverity?: string;
      symptoms?: string[];
      likes?: string[];
      hobbies?: string[];
      strengths?: string[];
      dislikes?: string[];
      notes?: string;
    },
  ) {
    await this.assertOwnerOrGuardian(userId, studentId);
    const data: any = {};
    if (dto.conditionType !== undefined) data.conditionType = dto.conditionType;
    if (dto.conditionSeverity !== undefined) data.conditionSeverity = dto.conditionSeverity;
    if (dto.symptoms !== undefined) data.symptoms = dto.symptoms;
    if (dto.likes !== undefined) data.likes = dto.likes;
    if (dto.hobbies !== undefined) data.hobbies = dto.hobbies;
    if (dto.strengths !== undefined) data.strengths = dto.strengths;
    if (dto.dislikes !== undefined) data.dislikes = dto.dislikes;
    if (dto.notes !== undefined) data.notes = dto.notes;
    return this.prisma.studentProfile.upsert({
      where: { studentId },
      create: { studentId, ...data },
      update: data,
    });
  }

  /** 列出某学生的知情同意记录历史（签署 / 撤回 / 重新签署），含操作人信息。 */
  async listConsentRecords(userId: string, studentId: string) {
    await this.assertOwnerOrGuardian(userId, studentId);
    return this.prisma.consentRecord.findMany({
      where: { studentId },
      include: { guardian: { select: { id: true, nickname: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 撤回知情同意：记录 REVOKED，并清空学生的 consentAt（停止处理其儿童心理健康数据）。 */
  async revokeConsent(userId: string, studentId: string) {
    await this.assertOwnerOrGuardian(userId, studentId);
    await this.prisma.consentRecord.create({
      data: { studentId, guardianId: userId, action: 'REVOKED', version: UsersService.PRIVACY_VERSION },
    });
    await this.prisma.student.update({ where: { id: studentId }, data: { consentAt: null } });
    await this.audit.log({
      userId,
      action: 'CONSENT_REVOKE',
      resource: 'student',
      detail: { studentId },
    });
    return { ok: true, consentAt: null };
  }

  /** 重新签署知情同意：记录 RESIGNED，并恢复 consentAt。 */
  async reSignConsent(userId: string, studentId: string) {
    await this.assertOwnerOrGuardian(userId, studentId);
    await this.prisma.consentRecord.create({
      data: { studentId, guardianId: userId, action: 'RESIGNED', version: UsersService.PRIVACY_VERSION },
    });
    const now = new Date();
    await this.prisma.student.update({ where: { id: studentId }, data: { consentAt: now } });
    await this.audit.log({
      userId,
      action: 'CONSENT_RESIGN',
      resource: 'student',
      detail: { studentId },
    });
    return { ok: true, consentAt: now };
  }

  private async assertOwner(userId: string, studentId: string) {
    const s = await this.prisma.student.findFirst({ where: { id: studentId, ownerId: userId } });
    if (!s) throw new ForbiddenException('仅学生创建者可执行该操作');
  }

  private async assertOwnerOrGuardian(userId: string, studentId: string) {
    const s = await this.prisma.student.findFirst({
      where: { id: studentId, OR: [{ ownerId: userId }, { guardians: { some: { id: userId } } }] },
    });
    if (!s) throw new ForbiddenException('无权操作该学生');
  }
}
