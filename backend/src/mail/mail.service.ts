import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface MailSendResult {
  sent: boolean;
  error?: string;
  /** 未配置 SMTP 时的开发日志模式：已"投递"到控制台，非真实外发，也非失败 */
  devLog?: boolean;
}

/**
 * 邮件发送服务（危机升级的邮件渠道）。
 * - 生产环境：在 .env 配置 MAIL_HOST/MAIL_PORT/MAIL_USER/MAIL_PASS/MAIL_FROM 后真实发送。
 * - 开发环境（未配置 SMTP）：以控制台日志模式运行，不真实外发，便于本地验收闭环。
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private enabled = false;
  private from = '';

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('MAIL_HOST') || this.config.get<string>('SMTP_HOST');
    const port = parseInt(
      this.config.get<string>('MAIL_PORT') || this.config.get<string>('SMTP_PORT') || '465',
      10,
    );
    const user = this.config.get<string>('MAIL_USER') || this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('MAIL_PASS') || this.config.get<string>('SMTP_PASS');
    this.from = this.config.get<string>('MAIL_FROM') || user || 'no-reply@starguard.local';
    if (host && user) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user && pass ? { user, pass } : undefined,
      });
      this.enabled = true;
      this.logger.log(`[Mail] SMTP 已启用： ${host}:${port}`);
    } else {
      this.logger.warn(
        '[Mail] 未配置 SMTP，将以控制台日志模式运行（不真实发送邮件）。请在生产环境设置 MAIL_HOST/MAIL_PORT/MAIL_USER/MAIL_PASS/MAIL_FROM。',
      );
    }
  }

  async sendMail(to: string, subject: string, text: string, html?: string): Promise<MailSendResult> {
    if (!to) return { sent: false, error: 'no recipient' };
    if (!this.enabled || !this.transporter) {
      this.logger.warn(`[DEV邮件] 收件人=${to} 主题=「${subject}」\n${text}`);
      return { sent: true, devLog: true };
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        text,
        html: html ?? text,
      });
      return { sent: true };
    } catch (e: any) {
      this.logger.error(`[Mail] 发送失败: ${e?.message}`);
      return { sent: false, error: e?.message };
    }
  }
}
