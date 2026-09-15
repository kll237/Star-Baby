import {
  IsString,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FaceAlgorithm } from '@prisma/client';

export class FaceVectorInput {
  @IsString()
  @IsNotEmpty()
  angle: string; // front / left / right / up / down

  @IsArray()
  @IsNumber({}, { each: true })
  vector: number[];
}

export class RegisterFaceDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsBoolean()
  livenessPassed: boolean;

  @IsOptional()
  @IsEnum(FaceAlgorithm)
  algorithm?: FaceAlgorithm;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FaceVectorInput)
  vectors: FaceVectorInput[];
}

export class FaceLoginDto {
  @IsArray()
  @IsNumber({}, { each: true })
  vector: number[];

  @IsOptional()
  @IsEnum(FaceAlgorithm)
  algorithm?: FaceAlgorithm;
}

export class FaceVerifyDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsArray()
  @IsNumber({}, { each: true })
  vector: number[];
}
