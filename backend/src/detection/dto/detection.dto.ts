import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsObject,
  IsIn,
  Min,
  Max,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EMOTION_KEYS, BEHAVIOR_KEYS } from '../detection.taxonomy';

export class CreateSessionDto {
  @IsString()
  studentId: string;

  @IsOptional()
  @IsEnum(['CAMERA', 'VIDEO_UPLOAD'])
  source?: 'CAMERA' | 'VIDEO_UPLOAD';

  @IsOptional()
  @IsString()
  deviceInfo?: string;
}

export class FrameBehaviorDto {
  @IsIn(BEHAVIOR_KEYS as readonly string[])
  behavior: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  confidence: number;

  @IsOptional()
  @IsString()
  source?: string;
}

export class AppendFrameDto {
  @IsString()
  sessionId: string;

  /** 7 类情绪置信度（0-100），键为 EMOTION_KEYS */
  @IsObject()
  emotionScores: Record<string, number>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FrameBehaviorDto)
  behaviors?: FrameBehaviorDto[];

  /** 客户端时间戳（毫秒），缺省使用服务端时间 */
  @IsOptional()
  @IsNumber()
  ts?: number;
}

export class EndSessionDto {
  @IsString()
  sessionId: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(240)
  fps?: number;
}

export class HistoryQueryDto {
  @IsOptional()
  @IsString()
  from?: string; // ISO 时间

  @IsOptional()
  @IsString()
  to?: string; // ISO 时间

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(500)
  limit?: number;
}

export class DetectionFrameView {
  id: string;
  ts: string;
  scores: Record<string, number>;
  dominant: string;
  compositeScore: number;
  negative: boolean;
}

export class BehaviorEventView {
  id: string;
  ts: string;
  behavior: string;
  confidence: number;
  source: string;
}
