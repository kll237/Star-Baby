import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { CommonModule } from '../common/common.module';
import { DeskPetModule } from '../deskpet/deskpet.module';
import { AlertsModule } from '../alerts/alerts.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { LlmService } from './llm.service';
import { ZhipuLlmService } from './zhipu-llm.service';
import { TtsService } from './tts.service';
import { AsrService } from './asr.service';

@Module({
  imports: [PrismaModule, AuditModule, CommonModule, DeskPetModule, AlertsModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, LlmService, ZhipuLlmService, TtsService, AsrService],
  exports: [ChatService],
})
export class ChatModule {}
