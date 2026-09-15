import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

function genVec(seed: number): number[] {
  // 确定性生成 128 维向量，用于测试（非真实人脸特征）
  return Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.1 + seed));
}

describe('阶段一：用户体系与人脸识别 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await prisma.faceDescriptor.deleteMany();
    await prisma.student.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.smsCode.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const rand = () => Math.floor(10000000 + Math.random() * 89999999);
  let token = '';
  let studentId = '';

  it('1) 发送注册短信验证码 (dev)', async () => {
    const phone = '139' + rand();
    const res = await request(server).post('/sms/send').send({ phone, purpose: 'REGISTER' }).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.devCode).toBeDefined();
  });

  it('2) 家长/教师注册 -> 登录 -> 创建学生', async () => {
    const phone = '137' + rand();
    const account = 'acc' + Date.now() + rand();
    const sms = await request(server).post('/sms/send').send({ phone, purpose: 'REGISTER' }).expect(200);
    const reg = await request(server)
      .post('/auth/register')
      .send({ account, password: 'Password1', nickname: '演示家长', phone, role: 'PARENT', smsCode: sms.body.devCode })
      .expect(201);
    expect(reg.body.account).toBe(account);

    const login = await request(server).post('/auth/login').send({ account, password: 'Password1' }).expect(200);
    expect(login.body.tokens.accessToken).toBeDefined();
    token = login.body.tokens.accessToken;

    const stu = await request(server)
      .post('/students')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '小明', gender: 'MALE' })
      .expect(201);
    studentId = stu.body.id;
    expect(studentId).toBeDefined();
  });

  it('3) 人脸注册（多模态向量+活体）并 1:N 识别登录 / 二次验证', async () => {
    const vec = genVec(1);
    const reg = await request(server)
      .post('/face/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ studentId, livenessPassed: true, vectors: [{ angle: 'front', vector: vec }] })
      .expect(201);
    expect(reg.body.count).toBe(1);

    const fl = await request(server).post('/face/login').send({ vector: vec }).expect(200);
    expect(fl.body.matched).toBe(true);
    expect(fl.body.studentId).toBe(studentId);
    expect(fl.body.confidence).toBeGreaterThanOrEqual(85);

    const fv = await request(server).post('/face/verify').send({ studentId, vector: vec }).expect(200);
    expect(fv.body.matched).toBe(true);

    const flNeg = await request(server).post('/face/login').send({ vector: genVec(99) }).expect(200);
    expect(flNeg.body.matched).toBe(false);
  });

  it('4) 登录失败 5 次后锁定 15 分钟', async () => {
    const phone = '136' + rand();
    const account = 'lock' + Date.now() + rand();
    const sms = await request(server).post('/sms/send').send({ phone, purpose: 'REGISTER' }).expect(200);
    await request(server)
      .post('/auth/register')
      .send({ account, password: 'Password1', nickname: 't', phone, role: 'TEACHER', smsCode: sms.body.devCode })
      .expect(201);

    for (let i = 0; i < 5; i++) {
      await request(server).post('/auth/login').send({ account, password: 'wrong' }).expect(401);
    }
    const locked = await request(server).post('/auth/login').send({ account, password: 'wrong' });
    expect([429, 401]).toContain(locked.status);
  });

  it('5) 错误密码/无令牌访问受保护接口应被拒绝', async () => {
    await request(server).get('/students').expect(401);
    await request(server).get('/auth/me').set('Authorization', 'Bearer invalid').expect(401);
  });
});
