import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthUser } from '../interfaces/auth-user.interface';

/** 角色守卫：结合 @Roles() 元数据限制访问 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;
    const request = context.switchToHttp().getRequest();
    const user: AuthUser = request.user;
    if (!user) throw new ForbiddenException('未认证');
    // ADMIN 是超级角色，放行所有受 @Roles() 保护的非公开接口。
    if (user.role === Role.ADMIN) return true;
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('当前角色无权访问该资源');
    }
    return true;
  }
}
