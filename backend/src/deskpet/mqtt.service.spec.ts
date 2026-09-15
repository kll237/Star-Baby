jest.mock('mqtt', () => ({ connect: jest.fn() }), { virtual: true });

import { MqttService } from './mqtt.service';
import { ConfigService } from '@nestjs/config';

function makeFakeClient() {
  const listeners: Record<string, Array<(...a: any[]) => void>> = {};
  const client: any = {
    connected: false,
    on: (evt: string, cb: (...a: any[]) => void) => {
      (listeners[evt] ||= []).push(cb);
    },
    subscribe: jest.fn(),
    publish: jest.fn(),
    end: jest.fn(),
    /** 测试辅助：触发 broker 事件 */
    _emit: (evt: string, ...args: any[]) => (listeners[evt] || []).forEach((cb) => cb(...args)),
  };
  return client;
}

function makeConfig(url?: string): any {
  return { get: (k: string) => (k === 'mqtt.url' ? url : undefined) };
}

describe('MqttService', () => {
  afterEach(() => jest.clearAllMocks());

  it('本地模式：无 MQTT_URL 时使用内存 broker，状态为 local', () => {
    const svc = new MqttService(makeConfig(undefined));
    svc.onModuleInit();
    const s = svc.status();
    expect(s.mode).toBe('local');
    expect(s.connected).toBe(true);
    expect(s.url).toBeNull();
  });

  it('本地模式：发布可经内存 broker 被订阅者收到', () => {
    const svc = new MqttService(makeConfig(undefined));
    svc.onModuleInit();
    const got: any[] = [];
    svc.subscribe('deskpet/+/feed', (p) => got.push(p));
    svc.publish('deskpet/s1/feed', { hello: 'world' });
    expect(got).toEqual([{ hello: 'world' }]);
  });

  it('远程模式：连接成功、状态事件触发、发布 JSON、通配订阅分发', () => {
    const fake = makeFakeClient();
    const mqttMod = require('mqtt');
    (mqttMod.connect as jest.Mock).mockReturnValue(fake);

    const svc = new MqttService(makeConfig('mqtt://localhost:1883'));
    const events: string[] = [];
    svc.onStatusChange((s) => events.push(`${s.mode}:${s.connected}`));

    svc.onModuleInit();

    // 触发 broker 的 connect 事件
    fake.connected = true;
    fake._emit('connect');

    expect(svc.status().mode).toBe('remote');
    expect(svc.status().connected).toBe(true);
    expect(events).toContain('remote:true');
    expect(svc.status().clientId).toBeTruthy();

    // 发布应为 JSON 字符串，且带 qos/retain 选项
    svc.publish('deskpet/s1/feed', { a: 1 }, { retain: true });
    expect(fake.publish).toHaveBeenCalledWith(
      'deskpet/s1/feed',
      JSON.stringify({ a: 1 }),
      expect.objectContaining({ qos: 1, retain: true }),
    );

    // 通配订阅 + 消息分发（topicMatches 命中 deskpet/+/feed）
    const got: any[] = [];
    svc.subscribe('deskpet/+/feed', (p) => got.push(p));
    expect(fake.subscribe).toHaveBeenCalledWith('deskpet/+/feed', { qos: 1 });

    fake._emit('message', 'deskpet/s1/feed', Buffer.from(JSON.stringify({ x: 2 })));
    expect(got).toEqual([{ x: 2 }]);
  });

  it('远程模式：连接失败自动回退本地 broker', () => {
    const mqttMod = require('mqtt');
    (mqttMod.connect as jest.Mock).mockImplementation(() => {
      throw new Error('cannot connect');
    });
    const svc = new MqttService(makeConfig('mqtt://unreachable:1883'));
    svc.onModuleInit();
    expect(svc.status().mode).toBe('local');
  });
});
