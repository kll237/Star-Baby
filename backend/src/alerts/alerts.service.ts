import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { MailService } from '../mail/mail.service';
import { AlertGateway } from './alerts.gateway';

export interface GuardianContact {
  userId: string;
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
  isOwner: boolean;
}

export interface EscalateInput {
  studentId: string;
  safetyEventId?: string;
  sourceText: string;
  replySummary: string;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  kind?: 'CRISIS' | 'RISK' | 'SUMMARY';
}

/**
 * 危机/风险升级服务：将危机与高危风险事件升级为「短信 + 邮件 + 站内信 + WebSocket 实时弹窗」的
 * 多级监护人提醒闭环，并对每一次触达落库 AlertLog 以便追溯投递状态。
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly mail: MailService,
    private readonly gateway: AlertGateway,
  ) {}

  /** 解析学生的全部监护联系人（创建者 owner + 关联监护人 guardians），用于多级提醒。 */
  async resolveContacts(studentId: string): Promise<GuardianContact[]> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: {
        owner: { select: { id: true, nickname: true, role: true, phone: true, email: true } },
        guardians: { select: { id: true, nickname: true, role: true, phone: true, email: true } },
      },
    });
    if (!student) throw new NotFoundException('学生不存在');
    const list: GuardianContact[] = [];
    if (student.owner) {
      list.push({
        userId: student.owner.id,
        name: student.owner.nickname,
        role: student.owner.role,
        phone: student.owner.phone,
        email: student.owner.email,
        isOwner: true,
      });
    }
    for (const g of student.guardians ?? []) {
      if (g.id === student.owner?.id) continue;
      list.push({
        userId: g.id,
        name: g.nickname,
        role: g.role,
        phone: g.phone,
        email: g.email,
        isOwner: false,
      });
    }
    return list;
  }

  private mask(s?: string | null): string {
    if (!s) return '';
    if (s.includes('@')) {
      const [u, d] = s.split('@');
      return (u.length <= 2 ? u : u.slice(0, 2) + '***') + '@' + d;
    }
    return s.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
  }

  /** 危机命中后的升级：短信 + 邮件 + 站内信(审计) + WebSocket 实时推送。 */
  async escalateCrisis(input: EscalateInput) {
    const contacts = await this.resolveContacts(input.studentId);
    const student = await this.prisma.student.findUnique({
      where: { id: input.studentId },
      select: { name: true },
    });
    const studentName = student?.name ?? '孩子';
    const levelText = this.levelText(input.level);
    const title = `【星宝守护·${levelText}预警】${studentName}需要关注`;
    const body = `星宝守护检测到 ${studentName} 出现${levelText}情况。${input.replySummary || ''}\n如情况紧急，请立即联系孩子或拨打心理援助热线（如希望24热线 400-161-9995）。`;

    for (const c of contacts) {
      await this.prisma.alertLog.create({
        data: {
          userId: c.userId,
          studentId: input.studentId,
          channel: 'INAPP',
          level: input.level,
          kind: input.kind ?? 'CRISIS',
          title,
          body,
          status: 'SENT',
          sentAt: new Date(),
        },
      });

      if (c.phone) {
        let smsStatus = 'FAILED';
        let smsError: string | undefined;
        let sentAt: Date | undefined;
        try {
          await this.sms.sendText(c.phone, `【星宝守护】${title}\n${body}`);
          smsStatus = 'SENT';
          sentAt = new Date();
        } catch (e: any) {
          smsError = e?.message;
        }
        await this.prisma.alertLog.create({
          data: {
            userId: c.userId,
            studentId: input.studentId,
            channel: 'SMS',
            level: input.level,
            kind: input.kind ?? 'CRISIS',
            title,
            body,
            status: smsStatus,
            error: smsError,
            sentAt,
          },
        });
      }

      if (c.email) {
        const r = await this.mail.sendMail(c.email, title, body);
        await this.prisma.alertLog.create({
          data: {
            userId: c.userId,
            studentId: input.studentId,
            channel: 'EMAIL',
            level: input.level,
            kind: input.kind ?? 'CRISIS',
            title,
            body,
            status: r.sent ? 'SENT' : 'FAILED',
            error: r.devLog ? '开发日志模式：未配置 SMTP，未真实外发' : r.error,
            sentAt: new Date(),
          },
        });
      }

      this.gateway.emitCrisis(c.userId, {
        studentId: input.studentId,
        studentName,
        level: input.level,
        title,
        body,
        safetyEventId: input.safetyEventId,
        createdAt: new Date().toISOString(),
      });
    }

    if (input.safetyEventId) {
      await this.prisma.safetyEvent
        .update({
          where: { id: input.safetyEventId },
          data: { notifyStatus: 'SENT', notifiedAt: new Date() },
        })
        .catch(() => {});
    }
    return { notified: contacts.length };
  }

  /** 实时风险行为（如自残/伤害）升级：站内信 + 短信 + 邮件 + 紧急弹窗。 */
  async recordRisk(opts: {
    studentId: string;
    kind: string;
    riskLevel: string;
    sourceText: string;
    emergency?: boolean;
    sessionId?: string;
  }) {
    const level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = opts.emergency
      ? 'CRITICAL'
      : opts.riskLevel === 'red'
        ? 'HIGH'
        : 'MEDIUM';
    const evt = await this.prisma.safetyEvent.create({
      data: {
        studentId: opts.studentId,
        sessionId: opts.sessionId,
        level,
        sourceText: opts.sourceText.slice(0, 500),
        replySummary: opts.emergency ? '检测到高危风险行为（自残/伤害）' : '检测到风险行为',
        category: 'RISK_BEHAVIOR',
        notifyStatus: 'PENDING',
      },
    });

    const contacts = await this.resolveContacts(opts.studentId);
    const student = await this.prisma.student.findUnique({
      where: { id: opts.studentId },
      select: { name: true },
    });
    const studentName = student?.name ?? '孩子';
    const title = `【星宝守护·${opts.emergency ? '紧急' : '风险'}预警】${studentName} 出现${opts.emergency ? '自残/高危' : '风险'}行为`;
    const body = `实时检测系统发现 ${studentName} 出现${opts.emergency ? '自残/高危' : '风险'}行为（${opts.kind}）。请立即关注孩子安全，必要时联系老师或专业机构。`;

    for (const c of contacts) {
      await this.prisma.notification.create({
        data: {
          userId: c.userId,
          type: 'CRISIS_ALERT',
          title,
          body,
          relatedStudentId: opts.studentId,
        },
      });
      await this.prisma.alertLog.create({
        data: {
          userId: c.userId,
          studentId: opts.studentId,
          channel: 'INAPP',
          level,
          kind: 'RISK',
          title,
          body,
          status: 'SENT',
          sentAt: new Date(),
        },
      });
      if (c.phone) {
        let st = 'FAILED';
        let err: string | undefined;
        let at: Date | undefined;
        try {
          await this.sms.sendText(c.phone, `【星宝守护】${title}\n${body}`);
          st = 'SENT';
          at = new Date();
        } catch (e: any) {
          err = e?.message;
        }
        await this.prisma.alertLog.create({
          data: {
            userId: c.userId,
            studentId: opts.studentId,
            channel: 'SMS',
            level,
            kind: 'RISK',
            title,
            body,
            status: st,
            error: err,
            sentAt: at,
          },
        });
      }
      if (c.email) {
        const r = await this.mail.sendMail(c.email, title, body);
        await this.prisma.alertLog.create({
          data: {
            userId: c.userId,
            studentId: opts.studentId,
            channel: 'EMAIL',
            level,
            kind: 'RISK',
            title,
            body,
            status: r.sent ? 'SENT' : 'FAILED',
            error: r.devLog ? '开发日志模式：未配置 SMTP，未真实外发' : r.error,
            sentAt: new Date(),
          },
        });
      }
      if (opts.emergency) {
        this.gateway.emitEmergency(c.userId, {
          studentId: opts.studentId,
          studentName,
          kind: opts.kind,
          level,
          title,
          body,
          safetyEventId: evt.id,
          createdAt: new Date().toISOString(),
        });
      } else {
        this.gateway.emitRisk(c.userId, {
          studentId: opts.studentId,
          studentName,
          kind: opts.kind,
          level: opts.riskLevel,
          title,
          body,
          safetyEventId: evt.id,
          createdAt: new Date().toISOString(),
        });
      }
    }

    await this.prisma.safetyEvent
      .update({ where: { id: evt.id }, data: { notifyStatus: 'SENT', notifiedAt: new Date() } })
      .catch(() => {});
    return evt;
  }

  /** 演示触发危机：生成一条 CRITICAL 危机事件并走完整升级闭环，便于验收。 */
  async demoTrigger(studentId: string, scenario: 'CRISIS' | 'SELF_HARM' = 'CRISIS') {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { name: true },
    });
    if (!student) throw new NotFoundException('学生不存在');

    // 场景二：自残等危险行为 —— 走风险上报通道，触发"紧急弹窗"(emergency)
    if (scenario === 'SELF_HARM') {
      await this.recordRisk({
        studentId,
        kind: 'self_injury',
        riskLevel: 'red',
        sourceText: '（演示）行为识别检测到自伤动作，持续 3 秒以上。',
        emergency: true,
      });
      return {
        ok: true,
        scenario,
        message: '已触发演示「自残紧急事件」，相关监护人将收到短信/邮件/站内信与紧急弹窗。',
      };
    }

    const evt = await this.prisma.safetyEvent.create({
      data: {
        studentId,
        level: 'CRITICAL',
        category: 'CRISIS_SUPPORT',
        sourceText: '（演示）我感到很绝望，不知道该怎么办……',
        replySummary: '（演示）星宝已给出安抚与求助建议。',
        notifyStatus: 'PENDING',
      },
    });
    await this.escalateCrisis({
      studentId,
      safetyEventId: evt.id,
      sourceText: '（演示）危机触发',
      replySummary: '（演示）星宝已给出安抚与求助建议。',
      level: 'CRITICAL',
      kind: 'CRISIS',
    });
    return {
      ok: true,
      scenario,
      safetyEventId: evt.id,
      message: '已触发演示危机，相关监护人将收到短信/邮件/站内信与实时弹窗。',
    };
  }

  /** 推送聊天摘要到监护人的实时通道。 */
  async pushChatSummary(studentId: string, summary: any) {
    const contacts = await this.resolveContacts(studentId);
    for (const c of contacts) {
      this.gateway.emitSummary(c.userId, {
        studentId,
        summary,
        createdAt: new Date().toISOString(),
      });
    }
    return { pushed: contacts.length };
  }

  async listLogs(studentId: string, userId: string) {
    const ok = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        OR: [{ ownerId: userId }, { guardians: { some: { id: userId } } }],
      },
    });
    if (!ok) throw new NotFoundException('无权查看该学生的触达记录');
    return this.prisma.alertLog.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getContacts(studentId: string, userId: string) {
    const ok = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        OR: [{ ownerId: userId }, { guardians: { some: { id: userId } } }],
      },
    });
    if (!ok) throw new NotFoundException('无权查看该学生');
    const contacts = await this.resolveContacts(studentId);
    return contacts.map((c) => ({
      userId: c.userId,
      name: c.name,
      role: c.role,
      isOwner: c.isOwner,
      phone: this.mask(c.phone),
      email: this.mask(c.email),
      hasPhone: !!c.phone,
      hasEmail: !!c.email,
    }));
  }

  private levelText(level: string): string {
    return (
      { LOW: '轻度', MEDIUM: '中度', HIGH: '高度', CRITICAL: '紧急' }[level] ?? level
    );
  }
}
