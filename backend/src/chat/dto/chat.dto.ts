import { IsString, IsOptional, IsIn, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class StartSessionDto {
  @IsOptional()
  @IsString()
  triggerEmotion?: string;

  @IsOptional()
  @IsIn(['DETECTION', 'MANUAL'])
  triggerSource?: 'DETECTION' | 'MANUAL';

  @IsOptional()
  @IsIn(['RULE', 'MOCK', 'OPENAI', 'ZHIPU'])
  llmProvider?: 'RULE' | 'MOCK' | 'OPENAI' | 'ZHIPU';
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  /** 浏览器端 ASR 识别产生的音频引用（可选，便于追溯） */
  @IsOptional()
  @IsString()
  audioRef?: string;
}

export class EndSessionDto {
  @IsOptional()
  @IsString()
  summary?: string;
}

export class ScriptsQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Boolean)
  includeInactive?: boolean;
}

export class SetProviderDto {
  @IsIn(['RULE', 'MOCK', 'OPENAI', 'ZHIPU'])
  provider: 'RULE' | 'MOCK' | 'OPENAI' | 'ZHIPU';
}

export class FeedbackDto {
  /** LIKE / DISLIKE / null（取消评价） */
  feedback?: 'LIKE' | 'DISLIKE' | null;
}

export class AckSafetyEventDto {
  @IsOptional()
  @IsString()
  note?: string;
}

/** 服务端 TTS 合成请求（前端"服务端语音"开关调用） */
export class TtsDto {
  @IsString()
  @IsNotEmpty()
  text: string;
}
