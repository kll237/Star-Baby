import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ForgotPasswordRequestDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/interfaces/auth-user.interface';

@ApiTags('认证 Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private ip(req: Request): string {
    return (req.headers['x-forwarded-for'] as string) || req.ip || 'unknown';
  }

  @Post('register')
  @Throttle({ auth: { ttl: 60, limit: 10 } })
  @ApiOperation({ summary: '家长/教师注册（需先获取短信验证码）' })
  @ApiResponse({ status: 201, description: '注册成功' })
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @Throttle({ auth: { ttl: 60, limit: 10 } })
  @HttpCode(200)
  @ApiOperation({ summary: '账号+密码登录，支持记住登录' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.account, dto.password, this.ip(req), dto.remember);
  }

  @Post('refresh')
  @Throttle({ auth: { ttl: 60, limit: 10 } })
  @HttpCode(200)
  @ApiOperation({ summary: '使用刷新令牌换取新的访问令牌' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, this.ip(req));
  }

  @Post('forgot-password')
  @Throttle({ auth: { ttl: 60, limit: 10 } })
  @HttpCode(200)
  @ApiOperation({ summary: '申请找回密码（发送短信验证码）' })
  async forgotPassword(@Body() dto: ForgotPasswordRequestDto) {
    const res = await this.auth.requestReset(dto.phone);
    // dev 环境下返回验证码便于演示
    return { success: true, devCode: res.devCode };
  }

  @Post('reset-password')
  @Throttle({ auth: { ttl: 60, limit: 10 } })
  @HttpCode(200)
  @ApiOperation({ summary: '使用短信验证码重置密码' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.phone, dto.smsCode, dto.newPassword);
    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录用户信息' })
  async me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: '退出登录（吊销刷新令牌）' })
  async logout(@CurrentUser() user: AuthUser, @Body() body: { refreshToken?: string }) {
    await this.auth.logout(user.userId, body.refreshToken);
    return { success: true };
  }
}
