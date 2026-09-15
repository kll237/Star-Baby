import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { ChatService } from './chat.service';
import {
  StartSessionDto,
  SendMessageDto,
  EndSessionDto,
  ScriptsQueryDto,
  SetProviderDto,
  FeedbackDto,
  AckSafetyEventDto,
  TtsDto,
} from './dto/chat.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly prisma: PrismaService,
  ) {}

  /** 校验当前用户能否访问该学生（家长/教师需已关联，学生需为自己）。 */
  private async assertStudentAccess(user: AuthUser, studentId: string): Promise<void> {
    if (user.role === 'STUDENT') {
      if (user.userId !== studentId) throw new ForbiddenException('只能操作自己的对话');
      return;
    }
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { guardians: { select: { id: true } } },
    });
    if (!student) throw new ForbiddenException('学生不存在');
    const ownerOk = student.ownerId === user.userId;
    const guardianOk = student.guardians.some((g: any) => g.id === user.userId);
    if (!ownerOk && !guardianOk) throw new ForbiddenException('无权访问该学生数据');
  }

  @Post('sessions')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async startSession(@CurrentUser() user: AuthUser, @Body() dto: StartSessionDto & { studentId: string }) {
    if (!dto.studentId) throw new BadRequestException('studentId 必填');
    await this.assertStudentAccess(user, dto.studentId);
    // 操作者即当前登录用户；学生本人开会话时无 User 记录，userId 留空（detail 仍记录 studentId）
    const operatorUserId = user.role === 'STUDENT' ? null : user.userId;
    return this.chat.startSession(operatorUserId, dto.studentId, dto);
  }

  @Post('sessions/:sessionId/messages')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @Param('sessionId', ParseIdPipe) sessionId: string,
    @Body() dto: SendMessageDto,
  ) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new ForbiddenException('会话不存在');
    await this.assertStudentAccess(user, session.studentId);
    return this.chat.sendMessage(session.studentId, sessionId, dto);
  }

  @Get('students/:studentId/sessions')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async listSessions(
    @CurrentUser() user: AuthUser,
    @Param('studentId', ParseIdPipe) studentId: string,
    @Query('limit') limit?: string,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.chat.listSessions(studentId, limit ? Number(limit) : 20);
  }

  @Get('sessions/:sessionId')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async getSession(
    @CurrentUser() user: AuthUser,
    @Param('sessionId', ParseIdPipe) sessionId: string,
  ) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new ForbiddenException('会话不存在');
    await this.assertStudentAccess(user, session.studentId);
    return this.chat.getSession(session.studentId, sessionId);
  }

  @Patch('sessions/:sessionId/end')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async endSession(
    @CurrentUser() user: AuthUser,
    @Param('sessionId', ParseIdPipe) sessionId: string,
    @Body() dto: EndSessionDto,
  ) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new ForbiddenException('会话不存在');
    await this.assertStudentAccess(user, session.studentId);
    const operatorUserId = user.role === 'STUDENT' ? null : user.userId;
    return this.chat.endSession(operatorUserId, session.studentId, sessionId, dto);
  }

  @Get('scripts')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async listScripts(@CurrentUser() user: AuthUser, @Query() query: ScriptsQueryDto) {
    return this.chat.getScripts(query.category, query.includeInactive);
  }

  @Post('scripts/seed')
  @Roles('PARENT', 'TEACHER')
  async seedScripts() {
    return this.chat.seedScripts();
  }

  @Post('llm/provider')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async setProvider(@Body() dto: SetProviderDto) {
    this.chat.setLlmProvider(dto.provider);
    return this.chat.mediaStatus().llm;
  }

  @Get('media')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async media() {
    return this.chat.mediaStatus();
  }

  // ---- 危机安全事件（监护人可见，闭环留痕）----
  @Get('students/:studentId/safety-events')
  @Roles('PARENT', 'TEACHER')
  async listSafetyEvents(
    @CurrentUser() user: AuthUser,
    @Param('studentId', ParseIdPipe) studentId: string,
    @Query('unack') unack?: string,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.chat.listSafetyEvents(studentId, unack === 'true');
  }

  @Patch('safety-events/:id/ack')
  @Roles('PARENT', 'TEACHER')
  async ackSafetyEvent(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: AckSafetyEventDto,
  ) {
    const evt = await this.prisma.safetyEvent.findUnique({ where: { id } });
    if (!evt) throw new NotFoundException('安全事件不存在');
    await this.assertStudentAccess(user, evt.studentId);
    return this.chat.ackSafetyEvent(id, user.userId, dto.note);
  }

  // ---- 家长端：聊天趋势摘要 ----
  @Get('students/:studentId/chat-summary')
  @Roles('PARENT', 'TEACHER')
  async chatSummary(
    @CurrentUser() user: AuthUser,
    @Param('studentId', ParseIdPipe) studentId: string,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.chat.chatSummary(studentId);
  }

  // ---- 回复质量反馈 👍/👎 ----
  @Post('messages/:messageId/feedback')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async feedback(
    @CurrentUser() user: AuthUser,
    @Param('messageId', ParseIdPipe) messageId: string,
    @Body() dto: FeedbackDto,
  ) {
    const msg = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('消息不存在');
    await this.assertStudentAccess(user, msg.studentId);
    return this.chat.setMessageFeedback(messageId, dto.feedback ?? null);
  }

  // ---- 监护人站内信（危机告警红点）----
  @Get('my-notifications')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async myNotifications(@CurrentUser() user: AuthUser, @Query('unread') unread?: string) {
    return this.prisma.notification.findMany({
      where: { userId: user.userId, ...(unread === 'true' ? { read: false } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Patch('notifications/:id/read')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async markNotificationRead(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== user.userId) throw new ForbiddenException('无权操作');
    return this.prisma.notification.update({ where: { id }, data: { read: true } });
  }

  // ---- 服务端 TTS（前端"服务端语音"开关调用，返回 audioUrl）----
  @Post('tts')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async tts(@CurrentUser() user: AuthUser, @Body() dto: TtsDto) {
    void user;
    if (!dto.text || !dto.text.trim()) throw new BadRequestException('text 必填');
    return this.chat.ttsForText(dto.text);
  }
}
