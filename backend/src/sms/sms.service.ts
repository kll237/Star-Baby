import { Injectable, Logger, BadRequestException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SmsCode, SmsPurpose } from '@prisma/client';
import { SmsProvider, DevSmsProvider, AliyunSmsProvider, TencentSmsProvider } from './sms.provider';

export interface SendCodeResult {
  success: boolean;
  /** 仅 dev 提供方会返回明文验证码，便于演示与测试 */
  devCode?: string;
}

/** 单手机号短信验证码限流：防滥用（轰炸/刷接口）。无 Redis 时自动降级为内存计数。 */
const SMS_RL = {
  perMinute: 1, // 60 秒内最多 1 条
  perHour: 5, // 每小时最多 5 条
  perDay: 10, // 每天最多 10 条
};

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly provider: SmsProvider;
  private readonly isDev: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly dev: DevSmsProvider,
    private readonly aliyun: AliyunSmsProvider,
    private readonly tencent: TencentSmsProvider,
  ) {
    const name = (this.config.get('sms.provider') || 'dev') as string;
    this.isDev = name === 'dev';
    this.provider =
      name === 'aliyun' ? this.aliyun : name === 'tencent' ? this.tencent : this.dev;
  }

  private genCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  /**
   * 按手机号滑动窗口限流。超限直接抛 429。
   * 采用 incr + 首次设置过期的方式，天然支持窗口滚动；无 Redis 时内存降级。
   */
  private async assertRateLimit(phone: string): Promise<void> {
    const kMin = `sms:rl:${phone}:min`;
    const kHour = `sms:rl:${phone}:hour`;
    const kDay = `sms:rl:${phone}:day`;

    const min = await this.redis.incr(kMin);
    if (min === 1) await this.redis.expire(kMin, 60);
    if (min > SMS_RL.perMinute)
      throw new HttpException('发送过于频繁，请 60 秒后再试', HttpStatus.TOO_MANY_REQUESTS);

    const hour = await this.redis.incr(kHour);
    if (hour === 1) await this.redis.expire(kHour, 3600);
    if (hour > SMS_RL.perHour)
      throw new HttpException('每小时最多发送 5 条验证码', HttpStatus.TOO_MANY_REQUESTS);

    const day = await this.redis.incr(kDay);
    if (day === 1) await this.redis.expire(kDay, 86400);
    if (day > SMS_RL.perDay)
      throw new HttpException('每天最多发送 10 条验证码', HttpStatus.TOO_MANY_REQUESTS);
  }

  async sendCode(phone: string, purpose: SmsPurpose): Promise<SendCodeResult> {
    // 防滥用：先于生成验证码做按手机号限流
    await this.assertRateLimit(phone);

    const code = this.genCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 分钟有效
    await this.prisma.smsCode.create({
      data: { phone, code, purpose, expiresAt },
    });
    await this.provider.send(phone, code, purpose);
    return { success: true, devCode: this.isDev ? code : undefined };
  }

  /** 发送任意内容短信（危机升级提醒等）。dev 提供方仅控制台打印。 */
  async sendText(phone: string, content: string): Promise<void> {
    await this.provider.sendText(phone, content);
  }

  /** 校验验证码：成功则置为已消费 */
  async verifyCode(phone: string, code: string, purpose: SmsPurpose): Promise<boolean> {
    const record = await this.prisma.smsCode.findFirst({
      where: { phone, purpose, consumed: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new BadRequestException('验证码不存在或已使用');
    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('验证码已过期');
    }
    if (record.code !== code) {
      throw new BadRequestException('验证码错误');
    }
    await this.prisma.smsCode.update({
      where: { id: record.id },
      data: { consumed: true },
    });
    return true;
  }
}
