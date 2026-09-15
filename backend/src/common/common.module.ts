import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<string>('jwt.accessExpiresIn') },
      }),
    }),
  ],
  providers: [
    JwtAuthGuard,
    RolesGuard,
    // 全局启用 JWT 守卫；公开接口用 @Public() 跳过（见下文 PublicGuard 设计可省略）
    // 这里不全局挂 JwtAuthGuard，由各 Controller 显式 @UseGuards(JwtAuthGuard)
  ],
  exports: [JwtModule, JwtAuthGuard, RolesGuard],
})
export class CommonModule {}
