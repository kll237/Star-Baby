import { IsOptional, IsString, IsIn, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export type ReportPeriodType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
export type TrendGranularityType = 'day' | 'week' | 'month';
export type ReportFormatType = 'JSON' | 'CSV';

export class ReportQueryDto {
  @IsOptional()
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'])
  period?: ReportPeriodType;

  @IsOptional()
  @IsString()
  from?: string; // ISO 时间

  @IsOptional()
  @IsString()
  to?: string; // ISO 时间

  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  granularity?: TrendGranularityType;
}

export class ExportReportDto {
  @IsIn(['JSON', 'CSV'])
  format: ReportFormatType;

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
  @IsIn(['day', 'week', 'month'])
  granularity?: TrendGranularityType;

  @IsOptional()
  @IsString()
  generatedById?: string;
}
