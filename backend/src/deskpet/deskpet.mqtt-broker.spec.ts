import { topicMatches, LocalMqttBroker } from './deskpet.mqtt-broker';

describe('deskpet.mqtt-broker', () => {
  describe('topicMatches', () => {
    it('精确匹配', () => {
      expect(topicMatches('deskpet/abc/detection', 'deskpet/abc/detection')).toBe(true);
    });
    it('层级数不同 → 不匹配', () => {
      expect(topicMatches('deskpet/abc/detection', 'deskpet/abc')).toBe(false);
    });
    it('单层通配 + 命中', () => {
      expect(topicMatches('deskpet/+/detection', 'deskpet/abc/detection')).toBe(true);
    });
    it('单层通配 + 层级不符 → 不匹配', () => {
      expect(topicMatches('deskpet/+/detection', 'deskpet/abc/def')).toBe(false);
    });
    it('多层通配 # 命中含子层级', () => {
      expect(topicMatches('deskpet/#', 'deskpet/abc/detection')).toBe(true);
    });
    it('多层通配 # 命中零子层级', () => {
      expect(topicMatches('deskpet/#', 'deskpet/abc')).toBe(true);
    });
    it('正常段与通配混排', () => {
      expect(topicMatches('deskpet/+/+/risk', 'deskpet/x/y/risk')).toBe(true);
      expect(topicMatches('deskpet/+/+/risk', 'deskpet/x/risk')).toBe(false);
    });
  });

  describe('LocalMqttBroker', () => {
    it('发布到精确订阅者', () => {
      const broker = new LocalMqttBroker();
      const received: any[] = [];
      const off = broker.subscribe('a/b/c', (p) => received.push(p));
      broker.publish('a/b/c', { v: 1 });
      expect(received).toEqual([{ v: 1 }]);
      off();
    });

    it('单层通配订阅可接收匹配发布', () => {
      const broker = new LocalMqttBroker();
      const received: any[] = [];
      broker.subscribe('a/+/c', (p) => received.push(p));
      broker.publish('a/x/c', 42);
      broker.publish('a/y/c', 43);
      expect(received).toEqual([42, 43]);
    });

    it('多层通配订阅接收所有子级', () => {
      const broker = new LocalMqttBroker();
      const received: string[] = [];
      broker.subscribe('a/#', (p) => received.push(p as string));
      broker.publish('a/x/c', '1');
      broker.publish('a/x', '2');
      expect(received).toEqual(['1', '2']);
    });

    it('非匹配主题不投递', () => {
      const broker = new LocalMqttBroker();
      const received: any[] = [];
      broker.subscribe('a/b/c', (p) => received.push(p));
      broker.publish('a/b/d', { v: 9 });
      expect(received).toHaveLength(0);
    });

    it('取消订阅后不再接收', () => {
      const broker = new LocalMqttBroker();
      const received: any[] = [];
      const off = broker.subscribe('a/b/c', (p) => received.push(p));
      broker.publish('a/b/c', 1);
      off();
      broker.publish('a/b/c', 2);
      expect(received).toEqual([1]);
    });

    it('单个订阅者异常不影响其余订阅者', () => {
      const broker = new LocalMqttBroker();
      const good: any[] = [];
      broker.subscribe('a', () => {
        throw new Error('boom');
      });
      broker.subscribe('a', (p) => good.push(p));
      expect(() => broker.publish('a', 1)).not.toThrow();
      expect(good).toEqual([1]);
    });

    it('isConnected 恒为 true', () => {
      expect(new LocalMqttBroker().isConnected()).toBe(true);
    });
  });
});
