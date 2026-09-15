import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SmsService } from './sms.service';
import { SmsPurpose } from '@prisma/client';
import { IsString, Matches, IsEnum } from 'class-validator';

class SendSmsDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsEnum(SmsPurpose)
  purpose: SmsPurpose;
}

@ApiTags('短信 SMS')
@Controller('sms')
export class SmsController {
  constructor(private readonly sms: SmsService) {}

  @Post('send')
  @Throttle({ default: { ttl: 60, limit: 30 } })
  @HttpCode(200)
  @ApiOperation({ summary: '发送短信验证码（注册/找回密码）' })
  async send(@Body() dto: SendSmsDto) {
    const res = await this.sms.sendCode(dto.phone, dto.purpose);
    // dev 环境返回验证码，便于前端演示；生产环境应移除
    return { success: true, devCode: res.devCode };
  }
}
