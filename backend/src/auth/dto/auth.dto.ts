import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  MaxLength,
  IsEnum,
  Matches,
  IsBoolean,
  IsOptional,
} from 'class-validator';
import { Role } from '@prisma/client';

export class RegisterDto {
  @IsString()
  @MinLength(4)
  @MaxLength(32)
  account: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  nickname: string;

  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  /** 真实邮箱：危机升级短信/邮件提醒的接收渠道之一（必填）。 */
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsEnum(Role)
  role: Role;

  @IsString()
  @IsNotEmpty()
  smsCode: string;

  /** 隐私协议：必须明确勾选同意方可注册（合规要求）。 */
  @IsBoolean()
  privacyConsent: boolean;

  /** 注册时签署的隐私协议版本号（前端展示用）。 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  privacyVersion: string;
}

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  account: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class ForgotPasswordRequestDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;
}

export class ResetPasswordDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsString()
  @IsNotEmpty()
  smsCode: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  newPassword: string;
}
