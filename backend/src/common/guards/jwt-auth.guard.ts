import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthUser } from '../interfaces/auth-user.interface';

/**
 * 自定义 JWT 鉴权守卫（不依赖 passport，直接使用 JwtService 校验）。
 * 解析 Authorization: Bearer <token>，校验后将用户信息挂载到 req.user。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header = request.headers['authorization'] || request.headers['Authorization'];
    if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('未提供认证令牌');
    }
    const token = header.slice(7).trim();
    try {
      const payload = this.jwt.verify(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
      const user: AuthUser = {
        userId: payload.sub,
        account: payload.account,
        role: payload.role,
        nickname: payload.nickname,
        phone: payload.phone,
      };
      request.user = user;
      return true;
    } catch (err) {
      throw new UnauthorizedException('令牌无效或已过期');
    }
  }
}
