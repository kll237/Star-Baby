import { DeskPetService } from './deskpet.service';
import { DeskPetBus } from './deskpet.bus';

/**
 * 阶段八：真实 MQTT 跨进程联动的核心逻辑单测。
 * 通过 mock MQTT 客户端捕获 onModuleInit 注册的订阅处理，验证：
 *  1) 跨实例反应按 origin 去重（自己的回环不重复驱动 WS 总线）；
 *  2) 真实硬件上行指令经 Redis 锁去重后处理并下行 cmd_down；
 *  3) 硬件心跳刷新设备在线时间。
 */
function build() {
  const prisma: any = {
    deskPetDevice: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
      delete: jest.fn(),
    },
    deskPetEvent: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    student: { findUnique: jest.fn() },
  };
  const audit = { log: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('deskpet') };

  // 捕获订阅：topic -> handler[]
  const subs: Record<string, Array<(p: any) => void>> = {};
  const mqtt: any = {
    publish: jest.fn(),
    subscribe: jest.fn((t: string, h: (p: any) => void) => {
      (subs[t] ||= []).push(h);
      return () => {
        subs[t] = (subs[t] || []).filter((x) => x !== h);
      };
    }),
    status: jest.fn().mockReturnValue({ connected: true, mode: 'remote', url: 'mqtt://x', clientId: 'c1' }),
    onStatusChange: jest.fn(() => () => undefined),
  };
  const bus = new DeskPetBus();

  const redis = { tryLock: jest.fn().mockResolvedValue(true) };

  const svc = new DeskPetService(prisma, audit as any, config as any, mqtt, bus, redis as any);
  svc.onModuleInit();
  return { svc, prisma, mqtt, bus, audit, redis, subs };
}

describe('DeskPetService 跨进程联动', () => {
  it('onModuleInit 订阅 feed / cmd_up / hb 三个通配主题', () => {
    const { subs } = build();
    expect(subs['deskpet/+/feed']).toBeDefined();
    expect(subs['deskpet/+/cmd_up']).toBeDefined();
    expect(subs['deskpet/+/hb']).toBeDefined();
  });

  it('跨实例 feed：origin != 本实例 → 驱动本地 WS 总线', () => {
    const { subs, bus } = build();
    const emit = jest.spyOn(bus, 'emitReaction');
    const handler = subs['deskpet/+/feed'][0];
    handler({ studentId: 's1', type: 'risk', reaction: { mood: 'alert' }, ts: 't', origin: 'OTHER-INST' });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].studentId).toBe('s1');
  });

  it('跨实例 feed：origin == 本实例（回环）→ 不重复驱动总线', () => {
    const { subs, bus, svc } = build();
    const emit = jest.spyOn(bus, 'emitReaction');
    const handler = subs['deskpet/+/feed'][0];
    const before = emit.mock.calls.length;
    handler({ studentId: 's1', type: 'risk', reaction: { mood: 'alert' }, ts: 't', origin: svc.instanceId });
    expect(emit.mock.calls.length).toBe(before);
  });

  it('真实硬件 cmd_up：抢锁成功后处理指令并下行 cmd_down 主题', async () => {
    const { subs, mqtt, audit } = build();
    const handler = subs['deskpet/+/cmd_up'][0];
    await handler({ studentId: 's1', action: 'dance', deviceId: 'robot-1', ts: 't' });

    // 经 Redis 锁去重
    expect(mqtt.publish).toHaveBeenCalledWith(
      'deskpet/s1/cmd_down',
      expect.objectContaining({ studentId: 's1', action: 'dance', deviceId: 'robot-1' }),
    );
    // 审计记录
    expect(audit.log).toHaveBeenCalled();
  });

  it('真实硬件 cmd_up：抢锁失败则不重复处理', async () => {
    const { subs, mqtt, redis } = build();
    redis.tryLock.mockResolvedValueOnce(false);
    const handler = subs['deskpet/+/cmd_up'][0];
    await handler({ studentId: 's1', action: 'dance', deviceId: 'robot-1', ts: 't' });
    const cmdDownCalls = mqtt.publish.mock.calls.filter((c: any[]) => c[0] === 'deskpet/s1/cmd_down');
    expect(cmdDownCalls.length).toBe(0);
  });

  it('硬件 hb：刷新设备 lastSeenAt', async () => {
    const { subs, prisma } = build();
    const handler = subs['deskpet/+/hb'][0];
    await handler({ studentId: 's1', deviceId: 'robot-1', ts: 't' });
    expect(prisma.deskPetDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studentId: 's1', deviceId: 'robot-1' } }),
    );
  });

  it('handleCommand 在远程模式额外下行 cmd_down 主题', async () => {
    const { svc, mqtt } = build();
    await svc.handleCommand('s1', 'spin', 'robot-1');
    const topics = mqtt.publish.mock.calls.map((c: any[]) => c[0]);
    expect(topics).toContain('deskpet/s1/cmd_down');
    expect(topics).toContain('deskpet/s1/feed');
  });
});
