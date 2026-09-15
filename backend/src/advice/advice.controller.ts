import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdviceService } from './advice.service';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { GenerateAdviceDto, KnowledgeQueryDto } from './dto/advice.dto';
import type { AuthUser } from '../common/interfaces/auth-user.interface';

@Controller('advice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdviceController {
  constructor(private readonly advice: AdviceService) {}

  @Post('students/:id/generate')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async generate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: GenerateAdviceDto,
  ) {
    await this.advice.assertStudentAccess(user, id);
    const uid = (user as any).sub ?? (user as any).userId;
    return this.advice.generateAdvice(id, {
      period: dto.period,
      from: dto.from,
      to: dto.to,
      target: dto.target,
      topN: dto.topN,
      generatedById: uid,
    });
  }

  @Get('students/:id/records')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async records(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: string) {
    await this.advice.assertStudentAccess(user, id);
    return this.advice.listRecords(id);
  }

  @Post('students/:id/prompt')
  @Roles('PARENT', 'TEACHER')
  async prompt(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: GenerateAdviceDto,
  ) {
    await this.advice.assertStudentAccess(user, id);
    return { prompt: await this.advice.buildPrompt(id, dto) };
  }

  @Get('knowledge')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async knowledge(@Query() q: KnowledgeQueryDto) {
    return this.advice.getKnowledge({
      category: q.category,
      target: q.target,
      severity: q.severity,
      keyword: q.keyword,
      limit: q.limit,
      offset: q.offset,
      includeInactive: q.includeInactive,
    });
  }

  @Get('knowledge/seed')
  @Roles('PARENT', 'TEACHER')
  async seed() {
    return this.advice.seedKnowledge();
  }

  @Get('knowledge/count')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async count() {
    return { count: await this.advice.countKnowledge() };
  }
}
