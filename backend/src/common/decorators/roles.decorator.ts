import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** 限制仅指定角色可访问。用法：@Roles(Role.PARENT, Role.TEACHER) */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
