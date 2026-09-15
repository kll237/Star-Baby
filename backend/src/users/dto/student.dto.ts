import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
  IsArray,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { Gender } from '@prisma/client';

export class CreateStudentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  name: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  remarks?: string;

  /** 监护人知情同意（创建自有学生时也需明确勾选） */
  @IsOptional()
  consent?: boolean;

  /** 演示账户标记：标记为 true 的学生不进入公开目录（demo 隔离） */
  @IsOptional()
  isDemo?: boolean;
}

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  name?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class LinkGuardianDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  /** 被关联家长/教师的账号 */
  @IsString()
  @IsNotEmpty()
  guardianAccount: string;
}

/** 关联学生时填写的基础画像（用于星宝个性化安抚） */
export class AssociateStudentDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  conditionType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  conditionSeverity?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symptoms?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  likes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hobbies?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  strengths?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dislikes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** 监护人知情同意：必须明确勾选 true，方可关联并处理儿童心理健康数据（合规要求） */
  @IsBoolean()
  consent: boolean;
}

export class UpdateProfileDto extends AssociateStudentDto {}
