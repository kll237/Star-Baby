import { Controller, Post, Body, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { FaceService } from './face.service';
import { AuthService } from '../auth/auth.service';
import { RegisterFaceDto, FaceLoginDto, FaceVerifyDto } from './dto/face.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { Role } from '@prisma/client';

@ApiTags('人脸 Face')
@Controller('face')
export class FaceController {
  constructor(
    private readonly face: FaceService,
    private readonly auth: AuthService,
  ) {}

  @Post('register')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PARENT, Role.TEACHER)
  @ApiOperation({ summary: '人脸注册（家长/教师为关联学生注册，需活体检测通过）' })
  @ApiResponse({ status: 201, description: '注册成功' })
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterFaceDto) {
    return this.face.registerFace(user.userId, dto);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '学生端人脸识别登录（1:N 比对，阈值≥0.85），成功后签发学生端访问令牌' })
  async faceLogin(@Body() dto: FaceLoginDto) {
    const result = await this.face.faceLogin(dto.vector);
    if (result.matched && result.studentId) {
      const accessToken = this.auth.issueStudentToken(result.studentId, result.studentName);
      return { ...result, accessToken };
    }
    return result;
  }

  @Post('verify')
  @HttpCode(200)
  @ApiOperation({ summary: '选择账号后的二次人脸验证（登录失败回退方案）' })
  async faceVerify(@Body() dto: FaceVerifyDto) {
    const result = await this.face.faceVerify(dto.studentId, dto.vector);
    if (result.matched && result.studentId) {
      const accessToken = this.auth.issueStudentToken(result.studentId, result.studentName);
      return { ...result, accessToken };
    }
    return result;
  }

  @Post('demo-student-login')
  @HttpCode(200)
  @ApiOperation({
    summary: '演示学生免刷脸登录（无摄像头演示专用）：仅命中「演示学生-小明」并返回学生端令牌；其余学生仍走正常刷脸',
  })
  async demoStudentLogin() {
    const { studentId, studentName } = await this.face.resolveDemoStudent();
    const accessToken = this.auth.issueStudentToken(studentId, studentName);
    return {
      matched: true,
      studentId,
      studentName,
      accessToken,
      confidence: 1,
      threshold: 0.85,
    };
  }
}
