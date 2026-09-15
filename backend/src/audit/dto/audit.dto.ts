import { IsOptional, IsString, IsIn, IsInt, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class AuditQueryDto {
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() resource?: string;

  /** 仅教师可传 scope=all 查看全部；其余角色仅查看自己的日志 */
  @IsOptional() @IsIn(['self', 'all']) scope?: 'self' | 'all';

  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt() @Min(1) @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt() @Min(0)
  offset?: number;
}
