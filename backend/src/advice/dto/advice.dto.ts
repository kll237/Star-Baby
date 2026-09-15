import { IsOptional, IsString, IsIn, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export type ReportPeriodType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
export type AdviceTargetType = 'ALL' | 'PARENT' | 'TEACHER' | 'STUDENT';

// 生成建议请求
export class GenerateAdviceDto {
  @IsOptional()
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'])
  period?: ReportPeriodType;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsIn(['ALL', 'PARENT', 'TEACHER', 'STUDENT'])
  target?: AdviceTargetType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  topN?: number;
}

// 知识库查询
export class KnowledgeQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  target?: AdviceTargetType;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  keyword?: string; // 标题/内容/标签模糊匹配

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Boolean)
  includeInactive?: boolean;
}
