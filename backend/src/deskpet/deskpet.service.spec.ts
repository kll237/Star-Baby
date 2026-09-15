import { DeskPetService } from './deskpet.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

function makeService() {
  const prisma: any = {
    deskPetDevice: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    deskPetEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    student: {
      findUnique: jest.fn(),
    },
  };
  const audit = { log: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('deskpet') };
  const mqtt = {
    publish: jest.fn(),
    subscribe: jest.fn(() => () => undefined),
    status: jest.fn().mockReturnValue({ connected: true, mode: 'local', url: null }),
    onStatusChange: jest.fn(() => () => undefined),
  };
  const bus = { emitReaction: jest.fn() };
  const redis = { tryLock: jest.fn().mockResolvedValue(true) };

  const svc = new DeskPetService(
    prisma,
    audit as any,
    config as any,
    mqtt as any,
    bus as any,
    redis as any,
  );
  return { svc, prisma, mqtt, bus, audit, redis };
}

describe('DeskPetService', () => {
  describe('registerDevice', () => {
    it('upsert 并返回视图，默认类型为 VIRTUAL', async () => {
      const { svc, prisma } = makeService();
      prisma.deskPetDevice.upsert.mockResolvedValue({
        id: 'd1',
        deviceId: 'dev-1',
        name: '桌宠-dev-1',
        studentId: 's1',
        type: 'VIRTUAL',
        topicPrefix: 'deskpet',
        isActive: true,
        lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      const view = await svc.registerDevice({ deviceId: 'dev-1', studentId: 's1' } as any);
      expect(prisma.deskPetDevice.upsert).toHaveBeenCalledTimes(1);
      expect(view.type).toBe('VIRTUAL');
      expect(view.deviceId).toBe('dev-1');
      expect(view.lastSeenAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('handleDetection', () => {
    it('risk=true → 事件类型 risk，并双主题发布 + 总线广播', async () => {
      const { svc, mqtt, bus } = makeService();
      const res = await svc.handleDetection('s1', {
        studentId: 's1',
        dominant: 'neutral',
        compositeScore: 80,
        negative: false,
        risk: true,
        ts: '2026-01-01T00:00:00Z',
      });
      expect(res.type).toBe('risk');
      expect(res.reaction.mood).toBe('alert');
      // 精确 channel 主题 + 聚合 feed 主题
      expect(mqtt.publish).toHaveBeenCalledTimes(2);
      expect(mqtt.publish.mock.calls[0][0]).toBe('deskpet/s1/risk');
      expect(mqtt.publish.mock.calls[1][0]).toBe('deskpet/s1/feed');
      expect(bus.emitReaction).toHaveBeenCalledTimes(1);
    });

    it('dominant=angry → detection 类型，mood=angry', async () => {
      const { svc } = makeService();
      const res = await svc.handleDetection('s1', {
        studentId: 's1',
        dominant: 'angry',
        compositeScore: 30,
        negative: true,
        ts: '2026-01-01T00:00:00Z',
      });
      expect(res.type).toBe('detection');
      expect(res.reaction.mood).toBe('angry');
      expect(res.reaction.animation).toBe('shake');
    });
  });

  describe('handleComfort / handleAdvice / handleCommand', () => {
    it('comfort → celebrate/cheer', async () => {
      const res = await makeService().svc.handleComfort('s1', { message: 'hi' });
      expect(res.type).toBe('comfort');
      expect(res.reaction.mood).toBe('celebrate');
    });
    it('advice HIGH → alert/intensity 80', async () => {
      const res = await makeService().svc.handleAdvice('s1', { severity: 'HIGH' });
      expect(res.reaction.intensity).toBe(80);
    });
    it('command → command 类型，双主题发布', async () => {
      const { svc, mqtt } = makeService();
      await svc.handleCommand('s1', 'dance', 'dev-9');
      expect(mqtt.publish).toHaveBeenCalledTimes(2);
      const envelope = mqtt.publish.mock.calls[0][1];
      expect(envelope.reaction.animation).toBe('dance');
    });
  });

  describe('dispatch 持久化节流', () => {
    it('连续两个 mood 相同的 detection 仅持久化一次', async () => {
      const { svc, prisma } = makeService();
      await svc.handleDetection('s1', {
        studentId: 's1',
        dominant: 'neutral',
        compositeScore: 70,
        negative: false,
        ts: '2026-01-01T00:00:00Z',
      });
      await svc.handleDetection('s1', {
        studentId: 's1',
        dominant: 'neutral',
        compositeScore: 75,
        negative: false,
        ts: '2026-01-01T00:00:01Z',
      });
      expect(prisma.deskPetEvent.create).toHaveBeenCalledTimes(1);
    });

    it('mood 变化后再次持久化', async () => {
      const { svc, prisma } = makeService();
      await svc.handleDetection('s1', {
        studentId: 's1',
        dominant: 'neutral',
        compositeScore: 70,
        negative: false,
        ts: '2026-01-01T00:00:00Z',
      });
      await svc.handleDetection('s1', {
        studentId: 's1',
        dominant: 'angry',
        compositeScore: 30,
        negative: true,
        ts: '2026-01-01T00:00:01Z',
      });
      expect(prisma.deskPetEvent.create).toHaveBeenCalledTimes(2);
    });

    it('非 detection 事件（如 comfort）必定持久化', async () => {
      const { svc, prisma } = makeService();
      await svc.handleComfort('s1', {});
      expect(prisma.deskPetEvent.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('feed / recentEvents', () => {
    it('feed 返回最新快照与 mqtt 状态', async () => {
      const { svc, mqtt } = makeService();
      await svc.handleComfort('s1', { message: 'm' });
      const f = await svc.feed('s1');
      expect(f.connected).toBe(true);
      expect(f.type).toBe('comfort');
      expect(f.mqtt).toEqual(mqtt.status());
    });

    it('recentEvents 映射回视图', async () => {
      const { svc, prisma } = makeService();
      prisma.deskPetEvent.findMany.mockResolvedValue([
        {
          id: 'e1',
          studentId: 's1',
          type: 'comfort',
          reaction: { mood: 'celebrate', animation: 'cheer', ts: 't' },
          source: 'chat',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);
      const rows = await svc.recentEvents('s1', 10);
      expect(rows[0].id).toBe('e1');
      expect(rows[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('assertStudentAccess', () => {
    it('学生访问自己 → 通过', async () => {
      const { svc } = makeService();
      await expect(
        svc.assertStudentAccess({ sub: 's1', role: 'STUDENT' } as any, 's1'),
      ).resolves.toBeUndefined();
    });

    it('学生访问他人 → 拒绝', async () => {
      const { svc } = makeService();
      await expect(
        svc.assertStudentAccess({ sub: 's1', role: 'STUDENT' } as any, 's2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('家长/教师为 owner 或 guardian → 通过', async () => {
      const { svc, prisma } = makeService();
      prisma.student.findUnique.mockResolvedValue({
        id: 's1',
        ownerId: 'u1',
        guardians: [{ id: 'u2' }],
      });
      await expect(
        svc.assertStudentAccess({ sub: 'u1', role: 'PARENT' } as any, 's1'),
      ).resolves.toBeUndefined();
      await expect(
        svc.assertStudentAccess({ sub: 'u2', role: 'TEACHER' } as any, 's1'),
      ).resolves.toBeUndefined();
    });

    it('无关联关系 → 拒绝', async () => {
      const { svc, prisma } = makeService();
      prisma.student.findUnique.mockResolvedValue({
        id: 's1',
        ownerId: 'u1',
        guardians: [{ id: 'u2' }],
      });
      await expect(
        svc.assertStudentAccess({ sub: 'uX', role: 'PARENT' } as any, 's1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('学生不存在 → 拒绝', async () => {
      const { svc, prisma } = makeService();
      prisma.student.findUnique.mockResolvedValue(null);
      await expect(
        svc.assertStudentAccess({ sub: 'uX', role: 'PARENT' } as any, 's1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('设备查询与删除', () => {
    it('getDevice 不存在 → NotFound', async () => {
      const { svc, prisma } = makeService();
      prisma.deskPetDevice.findUnique.mockResolvedValue(null);
      await expect(svc.getDevice('x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('removeDevice 不存在 → NotFound', async () => {
      const { svc, prisma } = makeService();
      prisma.deskPetDevice.findUnique.mockResolvedValue(null);
      await expect(svc.removeDevice('x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
