/**
 * 阶段六：内置内存版 MQTT Broker（零依赖、可离线运行）。
 * 实现 MQTT 主题发布/订阅语义，支持 `+`（单层）与 `#`（多层）通配符匹配，
 * 作为无外部 broker 环境下的默认传输；也可被真实 broker 客户端按同一接口替换。
 */

export type MqttHandler = (payload: any) => void;

/** 统一的 MQTT 客户端接口（本地与远程实现共用） */
export interface IMqttClient {
  mode: 'remote' | 'local';
  publish(topic: string, payload: any, opts?: { qos?: number; retain?: boolean }): void;
  subscribe(topic: string, handler: MqttHandler): () => void;
  isConnected(): boolean;
  /** 主动断开（远程客户端实现；本地 broker 可省略） */
  close?(): void;
}

/**
 * MQTT 主题匹配：支持 `+`（单层）与 `#`（多层，必须位于末段）。
 * 例：pattern `deskpet/+/detection` 匹配 `deskpet/abc/detection`；
 *     pattern `deskpet/#` 匹配 `deskpet/abc/detection` 及 `deskpet/abc`。
 */
export function topicMatches(pattern: string, topic: string): boolean {
  const p = pattern.split('/');
  const t = topic.split('/');
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    if (seg === '#') return true; // 末段 `#` 匹配其后所有层级（含零层）
    if (i >= t.length) return false;
    if (seg !== '+' && seg !== t[i]) return false;
  }
  return p.length === t.length;
}

export class LocalMqttBroker implements IMqttClient {
  mode = 'local' as const;
  private subs = new Map<string, Set<MqttHandler>>();

  publish(topic: string, payload: any): void {
    for (const [pattern, handlers] of this.subs) {
      if (topicMatches(pattern, topic)) {
        for (const h of handlers) {
          try {
            h(payload);
          } catch {
            /* 单个订阅者异常不应影响其余订阅者 */
          }
        }
      }
    }
  }

  subscribe(topic: string, handler: MqttHandler): () => void {
    let set = this.subs.get(topic);
    if (!set) {
      set = new Set<MqttHandler>();
      this.subs.set(topic, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }

  isConnected(): boolean {
    return true;
  }
}
