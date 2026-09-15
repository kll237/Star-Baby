import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 从请求对象中提取当前登录用户（由 JwtAuthGuard 注入的 req.user）。
 * 用法：@CurrentUser() user: AuthUser
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
