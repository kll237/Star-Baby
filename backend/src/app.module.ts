import { Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { SecurityModule } from './security/security.module';
import { AuditModule } from './audit/audit.module';
import { CommonModule } from './common/common.module';
import { SmsModule } from './sms/sms.module';
import { MailModule } from './mail/mail.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { FaceModule } from './face/face.module';
import { DetectionModule } from './detection/detection.module';
import { ChatModule } from './chat/chat.module';
import { ReportModule } from './report/report.module';
import { AdviceModule } from './advice/advice.module';
import { DeskPetModule } from './deskpet/deskpet.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], envFilePath: ['.env', '.env.local'] }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // 命名节流器：default 用于一般接口；auth 用于认证类接口（更严格，防暴力破解）
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('throttle.ttl') || 60,
            limit: config.get<number>('throttle.limit') || 60,
          },
          {
            name: 'auth',
            ttl: config.get<number>('throttle.authTtl') || 60,
            limit: config.get<number>('throttle.authLimit') || 10,
          },
        ],
      }),
    }),
    PrismaModule,
    RedisModule,
    SecurityModule,
    AuditModule,
    CommonModule,
    SmsModule,
    MailModule,
    AlertsModule,
    AuthModule,
    UsersModule,
    FaceModule,
    DetectionModule,
    ChatModule,
    ReportModule,
    AdviceModule,
    DeskPetModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
