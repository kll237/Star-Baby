import { Module } from '@nestjs/common';
import { AlertService } from './alerts.service';
import { AlertGateway } from './alerts.gateway';
import { AlertController } from './alerts.controller';
import { SmsModule } from '../sms/sms.module';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [PrismaModule, SmsModule, MailModule, CacheModule],
  controllers: [AlertController],
  providers: [AlertService, AlertGateway],
  exports: [AlertService, AlertGateway],
})
export class AlertsModule {}
