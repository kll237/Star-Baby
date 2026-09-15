import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { CommonModule } from '../common/common.module';
import { DeskPetService } from './deskpet.service';
import { DeskpetController } from './deskpet.controller';
import { DeskPetGateway } from './deskpet.gateway';
import { MqttService } from './mqtt.service';
import { DeskPetBus } from './deskpet.bus';

@Module({
  imports: [PrismaModule, AuditModule, CommonModule],
  controllers: [DeskpetController],
  providers: [MqttService, DeskPetBus, DeskPetService, DeskPetGateway],
  exports: [DeskPetService],
})
export class DeskPetModule {}
