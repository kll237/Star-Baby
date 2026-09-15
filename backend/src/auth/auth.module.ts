import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { CommonModule } from '../common/common.module';
import { SmsModule } from '../sms/sms.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [CommonModule, SmsModule, AuditModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
