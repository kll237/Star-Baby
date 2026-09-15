import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { DetectionModule } from '../detection/detection.module';
import { ReportModule } from '../report/report.module';
import { DeskPetModule } from '../deskpet/deskpet.module';
import { CacheModule } from '../cache/cache.module';
import { AdviceService } from './advice.service';
import { AdviceController } from './advice.controller';

@Module({
  imports: [PrismaModule, AuditModule, DetectionModule, ReportModule, DeskPetModule, CacheModule],
  controllers: [AdviceController],
  providers: [AdviceService],
  exports: [AdviceService],
})
export class AdviceModule {}
