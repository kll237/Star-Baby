import { IsString, IsOptional, IsIn, IsBoolean, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['VIRTUAL', 'ROBOT', 'SCREEN'])
  type?: 'VIRTUAL' | 'ROBOT' | 'SCREEN';

  @IsOptional()
  @IsString()
  topicPrefix?: string;
}

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['VIRTUAL', 'ROBOT', 'SCREEN'])
  type?: 'VIRTUAL' | 'ROBOT' | 'SCREEN';

  @IsOptional()
  @IsString()
  topicPrefix?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CommandDto {
  @IsString()
  @IsNotEmpty()
  action: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  payload?: any;
}

export class DeviceQueryDto {
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @Type(() => Boolean)
  includeInactive?: boolean;
}
