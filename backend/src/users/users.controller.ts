import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateStudentDto, UpdateStudentDto, LinkGuardianDto, AssociateStudentDto, UpdateProfileDto } from './dto/student.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { Role } from '@prisma/client';

@ApiTags('学生管理 Students')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PARENT, Role.TEACHER)
@Controller('students')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @ApiOperation({ summary: '创建学生（家长/教师）' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStudentDto) {
    return this.users.createStudent(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: '列出我关联的学生' })
  list(@CurrentUser() user: AuthUser) {
    return this.users.listStudents(user.userId);
  }

  @Get('directory')
  @ApiOperation({ summary: '学生目录：检索可关联的学生（仅摘要，保护隐私）' })
  directory() {
    return this.users.listDirectory();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个学生详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.getStudent(user.userId, id);
  }

  @Post(':id/associate')
  @ApiOperation({ summary: '家长/教师自行关联学生并填写基础画像' })
  associate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AssociateStudentDto) {
    return this.users.associateSelf(user.userId, id, dto);
  }

  @Get(':id/profile')
  @ApiOperation({ summary: '获取学生基础画像（关联者可见）' })
  profile(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.getProfile(user.userId, id);
  }

  @Put(':id/profile')
  @ApiOperation({ summary: '更新学生基础画像（关联者可写）' })
  updateProfile(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProfileDto) {
    return this.users.upsertProfile(user.userId, id, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新学生信息' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateStudentDto) {
    return this.users.updateStudent(user.userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除学生' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.removeStudent(user.userId, id).then(() => ({ success: true }));
  }

  @Post('link')
  @ApiOperation({ summary: '关联其他家长/教师为监护人' })
  link(@CurrentUser() user: AuthUser, @Body() dto: LinkGuardianDto) {
    return this.users.linkGuardian(user.userId, dto.studentId, dto.guardianAccount);
  }

  @Post('seed-demo')
  @ApiOperation({ summary: '创建演示账户与示范学生（仅开发/演示环境，生产禁用）' })
  seedDemo(@CurrentUser() user: AuthUser) {
    if (process.env.NODE_ENV === 'production') throw new ForbiddenException('生产环境禁用该接口');
    void user;
    return this.users.seedDemo();
  }

  @Get(':id/consent-records')
  @ApiOperation({ summary: '知情同意记录历史（签署 / 撤回 / 重新签署）' })
  consentRecords(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.listConsentRecords(user.userId, id);
  }

  @Post(':id/consent/revoke')
  @ApiOperation({ summary: '撤回知情同意（合规留痕，并停止处理该学生数据）' })
  revokeConsent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.revokeConsent(user.userId, id);
  }

  @Post(':id/consent/re-sign')
  @ApiOperation({ summary: '重新签署知情同意（恢复数据处理）' })
  reSignConsent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.reSignConsent(user.userId, id);
  }
}
