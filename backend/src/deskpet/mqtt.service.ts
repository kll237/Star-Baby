import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalMqttBroker, IMqttClient, MqttHandler, topicMatches } from './deskpet.mqtt-broker';

export interface MqttStatus {
  connected: boolean;
  mode: 'remote' | 'local';
  url: string | null;
  clientId?: string | null;
}

export interface MqttPublishOptions {
  qos?: 0 | 1 | 2;
  retain?: boolean;
}

/**
 * MQTT 传输服务（阶段八增强：真实 MQTT 跨进程联动）。
 *
 * - 配置了 `MQTT_URL` 且运行环境可加载 `mqtt` 包 → 连接真实 broker（Mosquitto/EMQX 等），
 *   支持自动重连、QoS=1、retained 状态快照、主题通配订阅与连接状态事件；
 * - 否则回退到内置内存版 broker（LocalMqttBroker），保证开发与演示环境开箱即用、无需外部依赖。
 *
 * 无论哪种模式，对外暴露的 `publish/subscribe/status/onStatusChange` 接口保持一致，
 * 上层 DeskPetService 无需关心底层是真实 broker 还是内存 broker。
 */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private client!: IMqttClient;
  private readonly logger = new Logger(MqttService.name);
  private remoteUrl?: string;
  private clientId?: string;
  private readonly statusListeners = new Set<(s: MqttStatus) => void>();

  constructor(private readonly config: ConfigService) {
    // 默认即为本地内存 broker：保证无论 onModuleInit 调用顺序如何，
    // subscribe/publish/status 都不会因 client 尚未初始化而崩溃（阶段八修复）。
    // 若配置了 MQTT_URL 且能连上真实 broker，onModuleInit 会替换为远程客户端。
    this.client = new LocalMqttBroker();
  }

  onModuleInit(): void {
    const url = this.config.get<string>('mqtt.url');
    if (url) {
      const remote = this.tryConnectRemote(url);
      if (remote) {
        this.client = remote;
        this.remoteUrl = url;
        this.logger.log(`MQTT 已连接远程 broker: ${url} (clientId=${this.clientId})`);
        return;
      }
      this.logger.warn('远程 MQTT 连接不可用，已回退到本地内存 broker（功能不受影响）');
    }
    // 默认已在构造器中初始化为本地 broker；无 MQTT_URL 时保持本地模式。
    if (this.client.mode !== 'local') this.client = new LocalMqttBroker();
    this.logger.log('MQTT 使用本地内存 broker（开发/演示模式，无需外部 broker）');
  }

  onModuleDestroy(): void {
    try {
      this.client?.close?.();
    } catch {
      /* ignore */
    }
  }

  /** 动态加载 mqtt 包并建立远程连接；任何失败都安全返回 null 以触发降级。 */
  private tryConnectRemote(url: string): IMqttClient | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mqtt = require('mqtt');
      this.clientId = `deskpet-server-${Math.random().toString(36).slice(2, 10)}`;
      const c: any = mqtt.connect(url, {
        reconnectPeriod: 2000,
        clean: true,
        clientId: this.clientId,
        qos: 1,
        connectTimeout: 10_000,
      });

      const handlers = new Map<string, Set<MqttHandler>>();

      const notify = () => {
        const s = this.status();
        for (const cb of this.statusListeners) {
          try {
            cb(s);
          } catch {
            /* ignore */
          }
        }
      };

      c.on('connect', () => notify());
      c.on('reconnect', () => notify());
      c.on('close', () => notify());
      c.on('offline', () => notify());
      c.on('error', (e: any) => {
        this.logger.warn(`MQTT 连接错误（已自动重连）: ${e?.message || e}`);
      });

      c.on('message', (topic: string, buf: Buffer) => {
        let payload: any;
        try {
          payload = JSON.parse(buf.toString());
        } catch {
          payload = buf.toString();
        }
        // 精确订阅优先
        const exact = handlers.get(topic);
        if (exact) {
          for (const h of exact) {
            try {
              h(payload);
            } catch {
              /* 单个订阅者异常不应影响其余 */
            }
          }
        }
        // 通配订阅（一次发布可命中多个通配模式）
        for (const [pat, set] of handlers) {
          if (pat === topic) continue;
          if (topicMatches(pat, topic)) {
            for (const h of set) {
              try {
                h(payload);
              } catch {
                /* ignore */
              }
            }
          }
        }
      });

      return {
        mode: 'remote',
        isConnected: () => c.connected === true,
        publish: (topic: string, payload: any, opts?: MqttPublishOptions) => {
          try {
            const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
            c.publish(topic, data, { qos: (opts?.qos ?? 1) as any, retain: !!opts?.retain });
          } catch {
            /* ignore */
          }
        },
        subscribe: (topic: string, handler: MqttHandler) => {
          let set = handlers.get(topic);
          if (!set) {
            set = new Set<MqttHandler>();
            handlers.set(topic, set);
            try {
              c.subscribe(topic, { qos: 1 });
            } catch {
              /* ignore */
            }
          }
          set.add(handler);
          return () => {
            set!.delete(handler);
          };
        },
        close: () => {
          try {
            c.end(true);
          } catch {
            /* ignore */
          }
        },
      };
    } catch {
      return null;
    }
  }

  publish(topic: string, payload: any, opts?: MqttPublishOptions): void {
    this.client.publish(topic, payload, opts);
  }

  subscribe(topic: string, handler: MqttHandler): () => void {
    return this.client.subscribe(topic, handler);
  }

  status(): MqttStatus {
    return {
      connected: this.client.isConnected(),
      mode: this.client.mode,
      url: this.client.mode === 'remote' ? this.remoteUrl ?? null : null,
      clientId: this.client.mode === 'remote' ? this.clientId ?? null : null,
    };
  }

  /** 订阅连接状态变更（连接 / 断开 / 重连），便于上层在重连后重新发布 retained 状态。 */
  onStatusChange(cb: (s: MqttStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }
}
