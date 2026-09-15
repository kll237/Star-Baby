import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SmsService } from '../sms/sms.service';
import { AuditService } from '../audit/audit.service';
import { User, Role, SmsPurpose } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // 秒
  tokenType: 'Bearer';
}

export interface SafeUser {
  id: string;
  account: string;
  nickname: string;
  phone: string;
  email: string | null;
  role: Role;
  status: string;
  privacyConsentAt: Date | null;
  privacyConsentVersion: string | null;
  createdAt: Date;
}

function toSafeUser(u: User): SafeUser {
  return {
    id: u.id,
    account: u.account,
    nickname: u.nickname,
    phone: u.phone,
    email: u.email,
    role: u.role,
    status: u.status,
    privacyConsentAt: u.privacyConsentAt ?? null,
    privacyConsentVersion: u.privacyConsentVersion ?? null,
    createdAt: u.createdAt,
  };
}

function parseExpiresIn(str: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(str.trim());
  if (!m) return 604800;
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    default:
      return 604800;
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get failKey() {
    return (account: string) => `auth:fail:${account}`;
  }
  private get lockKey() {
    return (account: string) => `auth:lock:${account}`;
  }

  // ---------------- 注册（家长/教师） ----------------
  async register(dto: {
    account: string;
    password: string;
    nickname: string;
    phone: string;
    email: string;
    role: Role;
    smsCode: string;
    privacyConsent: boolean;
    privacyVersion: string;
  }): Promise<{ user: SafeUser; tokens: TokenPair }> {
    if (dto.privacyConsent !== true) {
      throw new BadRequestException('注册前须阅读并同意隐私协议');
    }
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ account: dto.account }, { phone: dto.phone }, { email: dto.email }] },
    });
    if (exists) {
      throw new ConflictException(
        exists.account === dto.account
          ? '账号已存在'
          : exists.phone === dto.phone
            ? '手机号已被注册'
            : '邮箱已被注册',
      );
    }
    await this.sms.verifyCode(dto.phone, dto.smsCode, SmsPurpose.REGISTER);

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        account: dto.account,
        passwordHash,
        nickname: dto.nickname,
        phone: dto.phone,
        email: dto.email,
        role: dto.role,
        privacyConsentAt: new Date(),
        privacyConsentVersion: dto.privacyVersion,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'USER_REGISTER',
      resource: 'user',
      detail: { role: dto.role, privacyVersion: dto.privacyVersion },
    });
    // 注册成功直接签发令牌，便于立即进入「关联学生」流程
    const tokens = await this.issueTokens(user, false);
    return { user: toSafeUser(user), tokens };
  }

  // ---------------- 登录 ----------------
  async login(
    account: string,
    password: string,
    ip: string,
    remember = false,
  ): Promise<{ tokens: TokenPair; user: SafeUser }> {
    // 锁定检查
    const lockTtl = await this.redis.ttl(this.lockKey(account));
    if (lockTtl > 0) {
      throw new HttpException(
        { message: '账号已锁定，请稍后再试', retryAfter: lockTtl },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 登录标识支持 账号 / 邮箱 / 手机号 任一（避免用户记不住 account 而反复登录失败）
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ account }, { email: account }, { phone: account }] },
    });
    if (!user) {
      this.recordFail(account);
      throw new UnauthorizedException('账号或密码错误');
    }
    if (user.status === 'DISABLED') {
      throw new ForbiddenException('账号已被禁用，请联系管理员');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      this.recordFail(account);
      throw new UnauthorizedException('账号或密码错误');
    }

    // 登录成功：清除失败计数
    await this.redis.del(this.failKey(account));
    await this.redis.del(this.lockKey(account));
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.issueTokens(user, remember);
    await this.audit.log({ userId: user.id, action: 'USER_LOGIN', ip, resource: 'auth' });
    return { tokens, user: toSafeUser(user) };
  }

  private async recordFail(account: string) {
    const max = this.config.get<number>('login.maxFails') || 5;
    const lockSec = this.config.get<number>('login.lockSeconds') || 900;
    const key = this.failKey(account);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, lockSec);
    }
    if (count >= max) {
      await this.redis.set(this.lockKey(account), '1', 'EX', lockSec);
      await this.redis.del(key);
    }
  }

  private async issueTokens(user: User, remember: boolean): Promise<TokenPair> {
    const accessExpiresIn = this.config.get<string>('jwt.accessExpiresIn') || '7d';
    const expiresIn = parseExpiresIn(accessExpiresIn);
    const payload = {
      sub: user.id,
      account: user.account,
      role: user.role,
      nickname: user.nickname,
      phone: user.phone,
      email: user.email,
    };
    const accessToken = this.jwt.sign(payload, { expiresIn });
    const refreshExpiresMs = remember
      ? parseExpiresIn(this.config.get<string>('jwt.refreshExpiresIn') || '30d') * 1000
      : expiresIn * 1000;
    const refreshToken = uuidv4();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + refreshExpiresMs),
      },
    });
    return { accessToken, refreshToken, expiresIn, tokenType: 'Bearer' };
  }

  // ---------------- 刷新令牌 ----------------
  async refresh(refreshToken: string, ip: string): Promise<TokenPair> {
    const record = await this.prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!record || record.revoked || record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('刷新令牌无效或已过期');
    }
    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user || user.status === 'DISABLED') {
      throw new UnauthorizedException('用户不可用');
    }
    // 令牌轮换
    await this.prisma.refreshToken.update({
      where: { token: refreshToken },
      data: { revoked: true },
    });
    const tokens = await this.issueTokens(user, true);
    await this.audit.log({ userId: user.id, action: 'TOKEN_REFRESH', ip, resource: 'auth' });
    return tokens;
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { token: refreshToken, userId },
        data: { revoked: true },
      });
    } else {
      await this.prisma.refreshToken.updateMany({
        where: { userId },
        data: { revoked: true },
      });
    }
    await this.audit.log({ userId, action: 'USER_LOGOUT', resource: 'auth' });
  }

  // ---------------- 找回密码 ----------------
  async requestReset(phone: string): Promise<{ devCode?: string }> {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) throw new BadRequestException('该手机号未注册');
    const res = await this.sms.sendCode(phone, SmsPurpose.RESET_PASSWORD);
    return { devCode: res.devCode };
  }

  async resetPassword(phone: string, smsCode: string, newPassword: string): Promise<void> {
    await this.sms.verifyCode(phone, smsCode, SmsPurpose.RESET_PASSWORD);
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) throw new BadRequestException('该手机号未注册');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    // 重置后吊销所有会话
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { revoked: true },
    });
    await this.audit.log({ userId: user.id, action: 'PASSWORD_RESET', resource: 'user' });
  }

  async me(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');
    return toSafeUser(user);
  }

  /**
   * 为学生端签发访问令牌（学生无密码，登录由人脸 1:N 通过后签发）。
   * 角色固定 STUDENT，sub 为学生 ID；有效期与 access 一致。
   * 用于在检测/WebSocket 等接口上标识身份。
   */
  issueStudentToken(studentId: string, studentName?: string): string {
    // 学生端令牌默认有效期较长（演示场景，避免频繁过期重登）；可用 JWT_STUDENT_EXPIRES_IN 调整。
    const studentExpiresIn = this.config.get<string>('jwt.studentExpiresIn') || '365d';
    const expiresIn = parseExpiresIn(studentExpiresIn);
    return this.jwt.sign(
      { sub: studentId, role: 'STUDENT', name: studentName ?? null },
      { expiresIn },
    );
  }
}
