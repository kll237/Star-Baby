import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { DetectionService } from './detection.service';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import {
  CreateSessionDto,
  AppendFrameDto,
  EndSessionDto,
  HistoryQueryDto,
} from './dto/detection.dto';

@Controller('detection')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DetectionController {
  constructor(
    private readonly detection: DetectionService,
    private readonly prisma: PrismaService,
  ) {}

  /** 校验当前用户能否访问/操作该学生：家长/教师需已关联，学生需为自己。 */
  private async assertStudentAccess(user: AuthUser, studentId: string): Promise<void> {
    if (user.role === 'STUDENT') {
      if (user.userId !== studentId) throw new ForbiddenException('只能操作自己的检测数据');
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
  async createSession(@CurrentUser() user: AuthUser, @Body() dto: CreateSessionDto) {
    await this.assertStudentAccess(user, dto.studentId);
    return this.detection.createSession(user.userId, dto);
  }

  @Post('sessions/frames')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async appendFrame(@CurrentUser() user: AuthUser, @Body() dto: AppendFrameDto) {
    // 视频流上传分析场景：家长/教师也可写入关联学生会话
    const session = await this.prisma.detectionSession.findUnique({ where: { id: dto.sessionId } });
    if (!session) throw new ForbiddenException('会话不存在');
    await this.assertStudentAccess(user, session.studentId);
    return this.detection.appendFrame(session.studentId, dto);
  }

  @Patch('sessions/end')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async endSession(@CurrentUser() user: AuthUser, @Body() dto: EndSessionDto) {
    const session = await this.prisma.detectionSession.findUnique({ where: { id: dto.sessionId } });
    if (!session) throw new ForbiddenException('会话不存在');
    await this.assertStudentAccess(user, session.studentId);
    return this.detection.endSession(user.userId, dto);
  }

  @Get('students/:studentId/sessions')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async listSessions(
    @CurrentUser() user: AuthUser,
    @Param('studentId', ParseIdPipe) studentId: string,
    @Query() query: HistoryQueryDto,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.detection.listSessions(studentId, query);
  }

  @Get('students/:studentId/sessions/:sessionId')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async getSessionFrames(
    @CurrentUser() user: AuthUser,
    @Param('studentId', ParseIdPipe) studentId: string,
    @Param('sessionId', ParseIdPipe) sessionId: string,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.detection.getSessionFrames(studentId, sessionId);
  }

  @Get('students/:studentId/behavior-stats')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async behaviorStats(
    @CurrentUser() user: AuthUser,
    @Param('studentId', ParseIdPipe) studentId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.detection.behaviorStats(studentId, from, to);
  }
}
