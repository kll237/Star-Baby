import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { CommonModule } from '../common/common.module';
import { ChatModule } from '../chat/chat.module';
import { DeskPetModule } from '../deskpet/deskpet.module';
import { CacheModule } from '../cache/cache.module';
import { AlertsModule } from '../alerts/alerts.module';
import { DetectionService } from './detection.service';
import { DetectionController } from './detection.controller';
import { DetectionGateway } from './detection.gateway';

@Module({
  imports: [PrismaModule, AuditModule, CommonModule, ChatModule, DeskPetModule, CacheModule, AlertsModule],
  controllers: [DetectionController],
  providers: [DetectionService, DetectionGateway],
  exports: [DetectionService],
})
export class DetectionModule {}
