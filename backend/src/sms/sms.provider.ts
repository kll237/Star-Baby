import { Injectable, Logger } from '@nestjs/common';
import { SmsPurpose } from '@prisma/client';

/**
 * 短信发送提供方统一接口。
 * 阶段一内置 Dev 实现（仅控制台打印验证码）；可扩展阿里云/腾讯云。
 */
export interface SmsProvider {
  readonly name: string;
  send(phone: string, code: string, purpose: SmsPurpose): Promise<void>;
  /** 发送任意内容的短信（危机升级等场景），非验证码。 */
  sendText(phone: string, content: string): Promise<void>;
}

@Injectable()
export class DevSmsProvider implements SmsProvider {
  private readonly logger = new Logger('Sms:Dev');
  readonly name = 'dev';

  async send(phone: string, code: string, purpose: SmsPurpose): Promise<void> {
    this.logger.warn(`[DEV短信] 手机号 ${phone} 的${purpose}验证码为：${code}（生产环境请接入真实短信服务）`);
  }

  async sendText(phone: string, content: string): Promise<void> {
    this.logger.warn(`[DEV短信] → ${phone}：${content}（开发环境仅打印，未真实发送）`);
  }
}

/**
 * 阿里云短信（占位实现，接入时补充签名/模板/密钥）。
 * 文档：https://help.aliyun.com/document_detail/101414.html
 */
@Injectable()
export class AliyunSmsProvider implements SmsProvider {
  private readonly logger = new Logger('Sms:Aliyun');
  readonly name = 'aliyun';

  async send(phone: string, code: string, purpose: SmsPurpose): Promise<void> {
    // TODO: 接入 Dysmsapi 2020-01-11 SendSms，使用 accessKey/accessSecret 签名。
    this.logger.warn(`Aliyun SMS not implemented for ${phone}/${purpose} (code=${code})`);
    throw new Error('Aliyun SMS provider not implemented yet');
  }

  async sendText(phone: string, content: string): Promise<void> {
    // TODO: 接入 Dysmsapi SendSms，选用「告警通知」类模板，content 作为模板参数传入。
    this.logger.warn(`Aliyun SMS sendText not implemented for ${phone}`);
    throw new Error('Aliyun SMS provider not implemented yet');
  }
}

/**
 * 腾讯云短信（占位实现）。
 */
@Injectable()
export class TencentSmsProvider implements SmsProvider {
  private readonly logger = new Logger('Sms:Tencent');
  readonly name = 'tencent';

  async send(phone: string, code: string, purpose: SmsPurpose): Promise<void> {
    // TODO: 接入 tencentcloud-sdk-nodejs sms 模块。
    this.logger.warn(`Tencent SMS not implemented for ${phone}/${purpose} (code=${code})`);
    throw new Error('Tencent SMS provider not implemented yet');
  }

  async sendText(phone: string, content: string): Promise<void> {
    // TODO: 接入 tencentcloud-sdk-nodejs sms 模块。
    this.logger.warn(`Tencent SMS sendText not implemented for ${phone}`);
    throw new Error('Tencent SMS provider not implemented yet');
  }
}
