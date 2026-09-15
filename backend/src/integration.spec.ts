/**
 * 阶段一关键逻辑集成测试（无需真实数据库 / Redis）。
 * 仅用内存版 Prisma 仓储替身，其余使用真实服务：
 *   - AuthService：注册 / 登录 / 锁定 / JWT 签发 / 找回密码
 *   - UsersService：学生创建与权限断言
 *   - FaceService：人脸注册（AES-256 加密）+ 1:N 识别登录 + 二次验证
 *   - 真实依赖：bcrypt、JWT、Redis(内存降级)、Crypto(AES-256-GCM)、SMS(Dev)
 */
import { AuthService } from './auth/auth.service';
import { UsersService } from './users/users.service';
import { FaceService } from './face/face.service';
import { CryptoService } from './security/crypto.service';
import { RedisService } from './redis/redis.service';
import { AuditService } from './audit/audit.service';
import { SmsService } from './sms/sms.service';
import { DevSmsProvider } from './sms/sms.provider';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Role, SmsPurpose, Gender, FaceAlgorithm } from '@prisma/client';

// ---------- 内存版 Prisma 替身 ----------
function createPrismaMock() {
  const store: Record<string, any[]> = {
    user: [],
    refreshToken: [],
    student: [],
    faceDescriptor: [],
    smsCode: [],
    auditLog: [],
  };
  let seq = 0;
  const nid = (p: string) => `${p}_${++seq}`;

  const prisma: any = {
    user: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where?.OR)
          return store.user.find((u) =>
            where.OR.some((c: any) => (c.account && u.account === c.account) || (c.phone && u.phone === c.phone)),
          ) || null;
        if (where?.account) return store.user.find((u) => u.account === where.account) || null;
        if (where?.phone) return store.user.find((u) => u.phone === where.phone) || null;
        if (where?.id) return store.user.find((u) => u.id === where.id) || null;
        return null;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where?.account) return store.user.find((u) => u.account === where.account) || null;
        if (where?.phone) return store.user.find((u) => u.phone === where.phone) || null;
        if (where?.id) return store.user.find((u) => u.id === where.id) || null;
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const u = { id: nid('user'), createdAt: new Date(), status: 'ACTIVE', ...data };
        store.user.push(u);
        return u;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const u = store.user.find((x) => x.id === where.id);
        if (u) Object.assign(u, data, { updatedAt: new Date() });
        return u;
      }),
    },
    refreshToken: {
      create: jest.fn(async ({ data }: any) => {
        const r = { id: nid('rt'), ...data };
        store.refreshToken.push(r);
        return r;
      }),
      findUnique: jest.fn(async ({ where }: any) => store.refreshToken.find((r) => r.token === where.token) || null),
      update: jest.fn(async ({ where, data }: any) => {
        const r = store.refreshToken.find((x) => x.token === where.token);
        if (r) Object.assign(r, data);
        return r;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let n = 0;
        for (const r of store.refreshToken) {
          if ((!where?.token || r.token === where.token) && (!where?.userId || r.userId === where.userId)) {
            Object.assign(r, data);
            n++;
          }
        }
        return { count: n };
      }),
    },
    student: {
      create: jest.fn(async ({ data }: any) => {
        const s = { id: nid('stu'), createdAt: new Date(), status: 'ACTIVE', guardianIds: [], ...data };
        store.student.push(s);
        return s;
      }),
      findUnique: jest.fn(async ({ where }: any) => store.student.find((s) => s.id === where.id) || null),
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          store.student.find((s) => {
            if (where?.id && s.id !== where.id) return false;
            if (where?.ownerId && s.ownerId !== where.ownerId) return false;
            if (where?.OR)
              return where.OR.some(
                (c: any) =>
                  (c.ownerId && s.ownerId === c.ownerId) ||
                  (c.guardians?.some?.id && s.guardianIds?.includes(c.guardians.some.id)),
              );
            return true;
          }) || null
        );
      }),
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        let list = store.student.filter((s) => {
          if (where?.OR)
            return where.OR.some(
              (c: any) =>
                (c.ownerId && s.ownerId === c.ownerId) ||
                (c.guardians?.some?.id && s.guardianIds?.includes(c.guardians.some.id)),
            );
          if (where?.ownerId) return s.ownerId === where.ownerId;
          return true;
        });
        if (orderBy?.createdAt === 'desc') list = [...list].sort((a, b) => b.createdAt - a.createdAt);
        return list;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const s = store.student.find((x) => x.id === where.id);
        if (s) Object.assign(s, data);
        return s;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = store.student.findIndex((x) => x.id === where.id);
        const [s] = store.student.splice(i, 1);
        return s;
      }),
    },
    faceDescriptor: {
      createMany: jest.fn(async ({ data }: any) => {
        let n = 0;
        for (const row of data) {
          const student = store.student.find((s) => s.id === row.studentId);
          store.faceDescriptor.push({
            id: nid('fd'),
            studentId: row.studentId,
            payload: row.payload,
            algorithm: row.algorithm,
            livenessPassed: row.livenessPassed,
            angle: row.angle,
            student: student ? { id: student.id, name: student.name, status: student.status } : undefined,
          });
          n++;
        }
        return { count: n };
      }),
      findMany: jest.fn(async ({ where, include }: any) =>
        store.faceDescriptor
          .filter((d) => (where?.student?.status ? d.student?.status === where.student.status : true))
          .filter((d) => (where?.studentId ? d.studentId === where.studentId : true))
          .map((d) =>
            include?.student ? { ...d, student: { id: d.student.id, name: d.student.name } } : { ...d },
          ),
      ),
    },
    smsCode: {
      create: jest.fn(async ({ data }: any) => {
        const r = { id: nid('sms'), consumed: false, ...data };
        store.smsCode.push(r);
        return r;
      }),
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        let list = store.smsCode.filter(
          (c) =>
            c.phone === where.phone &&
            c.purpose === where.purpose &&
            (where.consumed === undefined || c.consumed === where.consumed),
        );
        if (orderBy?.createdAt === 'desc') list = [...list].sort((a, b) => b.createdAt - a.createdAt);
        return list[0] || null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = store.smsCode.find((x) => x.id === where.id);
        if (c) Object.assign(c, data);
        return c;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        const r = { id: nid('aud'), ...data };
        store.auditLog.push(r);
        return r;
      }),
    },
  };
  return { prisma, store };
}

// ---------- 测试夹具 ----------
const cfg: Record<string, any> = {
  login: { maxFails: 5, lockSeconds: 900 },
  jwt: { accessExpiresIn: '1h', refreshExpiresIn: '30d' },
  faceMatchThreshold: 0.85,
  aesMasterKey: 'a'.repeat(64),
  sms: { provider: 'dev' },
  redis: { host: '127.0.0.1', port: 6379, password: '', db: 0 },
};
const config = { get: (k: string) => cfg[k] } as unknown as ConfigService;

function randVec(n = 128): number[] {
  return Array.from({ length: n }, () => Math.random() * 2 - 1);
}
function norm(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

describe('阶段一 集成流程（无数据库）', () => {
  let auth: AuthService;
  let users: UsersService;
  let face: FaceService;
  let sms: SmsService;
  let redis: RedisService;
  let prisma: any;
  let store: any;
  const parentPhone = '13800000001';
  const parentAccount = 'parent01';
  const parentPassword = 'Passw0rd!23';
  let parentId = '';
  let studentId = '';
  let enrolledVector: number[] = [];

  beforeAll(async () => {
    const mock = createPrismaMock();
    prisma = mock.prisma;
    store = mock.store;

    const crypto = new CryptoService(config);
    crypto.onModuleInit();
    redis = new RedisService(config as any); // 不调用 onModuleInit → 自动走内存降级
    const audit = new AuditService(prisma);
    const jwt = new JwtService({ secret: 'test-secret' });
    const devSms = new DevSmsProvider();

    sms = new SmsService(config, prisma, devSms, {} as any, {} as any);
    auth = new AuthService(prisma, jwt, redis, sms, audit, config);
    users = new UsersService(prisma, audit);
    face = new FaceService(prisma, crypto, audit, config);
  });

  const clearLock = async () => {
    await redis.del(`auth:fail:${parentAccount}`, `auth:lock:${parentAccount}`);
  };

  it('注册家长（短信验证码）成功，密码加密存储', async () => {
    const { devCode } = await sms.sendCode(parentPhone, SmsPurpose.REGISTER);
    const user = await auth.register({
      account: parentAccount,
      password: parentPassword,
      nickname: '爸爸',
      phone: parentPhone,
      role: Role.PARENT,
      smsCode: devCode!,
    });
    expect(user.account).toBe(parentAccount);
    expect(user.role).toBe(Role.PARENT);
    parentId = user.id;
    const raw = store.user.find((u: any) => u.id === parentId);
    expect(raw.passwordHash).not.toBe(parentPassword);
    expect(raw.passwordHash.startsWith('$2')).toBe(true);
  });

  it('重复账号注册应冲突', async () => {
    const { devCode } = await sms.sendCode('13800000002', SmsPurpose.REGISTER);
    await expect(
      auth.register({
        account: parentAccount,
        password: 'x',
        nickname: 'x',
        phone: '13800000002',
        role: Role.PARENT,
        smsCode: devCode!,
      }),
    ).rejects.toThrow();
  });

  it('正确密码登录成功并返回可用 JWT', async () => {
    const res = await auth.login(parentAccount, parentPassword, '127.0.0.1');
    expect(res.tokens.accessToken).toBeDefined();
    expect(res.tokens.refreshToken).toBeDefined();
    const decoded: any = new JwtService({ secret: 'test-secret' }).verify(res.tokens.accessToken);
    expect(decoded.sub).toBe(parentId);
    expect(decoded.role).toBe(Role.PARENT);
  });

  it('刷新令牌可换取新令牌', async () => {
    const { tokens } = await auth.login(parentAccount, parentPassword, '127.0.0.1');
    const refreshed = await auth.refresh(tokens.refreshToken, '127.0.0.1');
    expect(refreshed.accessToken).toBeDefined();
  });

  it('连续 5 次密码错误后账号锁定，第 6 次被拒绝', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(auth.login(parentAccount, 'wrong-password', '127.0.0.1')).rejects.toThrow();
    }
    await expect(auth.login(parentAccount, parentPassword, '127.0.0.1')).rejects.toThrow(/锁定/);
  });

  it('锁定期间任何登录均被拒绝', async () => {
    await expect(auth.login(parentAccount, parentPassword, '127.0.0.1')).rejects.toThrow(/锁定/);
  });

  it('短信验证码找回密码并成功登录', async () => {
    await clearLock();
    const { devCode } = await sms.sendCode(parentPhone, SmsPurpose.RESET_PASSWORD);
    await auth.resetPassword(parentPhone, devCode!, 'NewPassw0rd!23');
    const res = await auth.login(parentAccount, 'NewPassw0rd!23', '127.0.0.1');
    expect(res.user.id).toBe(parentId);
  });

  it('家长创建学生', async () => {
    await clearLock();
    const student = await users.createStudent(parentId, {
      name: '小明',
      gender: Gender.MALE,
      birthDate: '2018-05-01',
      remarks: 'ASD',
    });
    expect(student.id).toBeDefined();
    studentId = student.id;
  });

  it('人脸注册：活体通过 + 多模态向量加密存储', async () => {
    enrolledVector = norm(randVec(128));
    const res = await face.registerFace(parentId, {
      studentId,
      livenessPassed: true,
      algorithm: FaceAlgorithm.FACE_API_TINY,
      vectors: [
        { angle: 'front', vector: enrolledVector },
        { angle: 'left', vector: norm(randVec(128)) },
      ],
    });
    expect(res.count).toBe(2);
    const stored = store.faceDescriptor.filter((d: any) => d.studentId === studentId);
    expect(stored.length).toBe(2);
    // 向量应为加密密文，而非明文 JSON
    expect(stored[0].payload).toContain(':');
    expect(stored[0].payload).not.toContain('[');
  });

  it('人脸注册在活体未通过时拒绝', async () => {
    await expect(
      face.registerFace(parentId, {
        studentId,
        livenessPassed: false,
        vectors: [{ angle: 'front', vector: randVec(128) }],
      }),
    ).rejects.toThrow(/活体/);
  });

  it('1:N 人脸识别登录：相同向量匹配且置信度≥0.85', async () => {
    const res = await face.faceLogin(enrolledVector);
    expect(res.matched).toBe(true);
    expect(res.studentId).toBe(studentId);
    expect(res.confidence).toBeGreaterThanOrEqual(85);
  });

  it('1:N 人脸识别登录：差异过大向量不匹配', async () => {
    const res = await face.faceLogin(norm(randVec(128)));
    expect(res.matched).toBe(false);
  });

  it('选择账号后的二次人脸验证：匹配通过', async () => {
    const res = await face.faceVerify(studentId, enrolledVector);
    expect(res.matched).toBe(true);
    expect(res.studentId).toBe(studentId);
  });
});
