import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { DeskPetService } from './deskpet.service';
import { RegisterDeviceDto, UpdateDeviceDto, CommandDto, DeviceQueryDto } from './dto/deskpet.dto';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';

/** 桌宠设备与事件 REST 接口（设备管理 / 轮询 feed / 下发指令 / 事件回溯）。 */
@Controller('deskpet')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeskpetController {
  constructor(private readonly deskpet: DeskPetService) {}

  @Post('devices')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async register(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto) {
    await this.deskpet.assertStudentAccess(user, dto.studentId);
    return this.deskpet.registerDevice(dto);
  }

  @Get('devices')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async list(@CurrentUser() user: AuthUser, @Query() q: DeviceQueryDto) {
    if (q.studentId) await this.deskpet.assertStudentAccess(user, q.studentId);
    return this.deskpet.listDevices(q.studentId, q.includeInactive);
  }

  @Get('devices/:id')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async get(@Param('id', ParseIdPipe) id: string) {
    return this.deskpet.getDevice(id);
  }

  @Patch('devices/:id')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async update(@Param('id', ParseIdPipe) id: string, @Body() dto: UpdateDeviceDto) {
    return this.deskpet.updateDevice(id, dto);
  }

  @Delete('devices/:id')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async remove(@Param('id', ParseIdPipe) id: string) {
    return this.deskpet.removeDevice(id);
  }

  @Get('students/:studentId/feed')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async feed(@CurrentUser() user: AuthUser, @Param('studentId', ParseIdPipe) studentId: string) {
    await this.deskpet.assertStudentAccess(user, studentId);
    return this.deskpet.feed(studentId);
  }

  @Get('students/:studentId/mqtt-status')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async mqtt(@CurrentUser() user: AuthUser, @Param('studentId', ParseIdPipe) studentId: string) {
    await this.deskpet.assertStudentAccess(user, studentId);
    return this.deskpet.mqttStatus();
  }

  @Post('students/:studentId/command')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async command(
    @CurrentUser() user: AuthUser,
    @Param('studentId', ParseIdPipe) studentId: string,
    @Body() dto: CommandDto,
  ) {
    await this.deskpet.assertStudentAccess(user, studentId);
    return this.deskpet.handleCommand(studentId, dto.action, dto.deviceId);
  }

  @Get('students/:studentId/events')
  @Roles('PARENT', 'TEACHER', 'STUDENT')
  async events(
    @CurrentUser() user: AuthUser,
    @Param('studentId', ParseIdPipe) studentId: string,
    @Query('limit') limit?: string,
  ) {
    await this.deskpet.assertStudentAccess(user, studentId);
    return this.deskpet.recentEvents(studentId, limit ? Number(limit) : 30);
  }
}
