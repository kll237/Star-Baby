import { Role } from '@prisma/client';

/** 经 JWT 校验后挂载到 req.user 的登录用户信息 */
export interface AuthUser {
  userId: string;
  account: string;
  role: Role;
  nickname: string;
  phone: string;
  [key: string]: any;
}
