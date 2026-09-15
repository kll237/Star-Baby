import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';
import { DevSmsProvider, AliyunSmsProvider, TencentSmsProvider } from './sms.provider';

@Module({
  imports: [ConfigModule],
  controllers: [SmsController],
  providers: [SmsService, DevSmsProvider, AliyunSmsProvider, TencentSmsProvider],
  exports: [SmsService],
})
export class SmsModule {}
