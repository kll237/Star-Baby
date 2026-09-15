import * as fs from 'fs';
import * as path from 'path';

/**
 * 全局配置对象（由 ConfigModule 加载 .env 后注入）。
 * 同时支持从 .env 与进程环境变量读取。
 */
export interface AppConfig {
  env: string;
  port: number;
  appBaseUrl: string;
  databaseUrl: string;
  redis: {
    host: string;
    port: number;
    password: string;
    db: number;
  };
  jwt: {
    secret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
  aesMasterKey: string;
  sms: {
    provider: 'dev' | 'aliyun' | 'tencent';
    accessKey: string;
    accessSecret: string;
    signName: string;
    templateCode: string;
  };
  login: {
    maxFails: number;
    lockSeconds: number;
  };
  throttle: {
    ttl: number;
    limit: number;
    authTtl: number;
    authLimit: number;
  };
  faceMatchThreshold: number;
  corsOrigin: string;
  // 阶段三：智能聊天安抚
  llm: {
    provider: 'RULE' | 'MOCK' | 'OPENAI';
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  tts: { engine: 'browser' | 'server'; endpoint: string; apiKey: string; voice: string };
  asr: { engine: 'browser' | 'server' };
  chat: { cooldownMs: number };
  // 阶段六：桌宠硬件接口（WebSocket + MQTT）
  mqtt: {
    url?: string; // 远程 broker 地址；留空则使用内置内存 broker（开发/演示）
    topicPrefix: string; // 主题前缀，形如 {prefix}/{studentId}/{channel}
  };
}

export default (): AppConfig => {
  const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' ? Number(v) : d);
  return {
    env: process.env.NODE_ENV || 'development',
    port: num(process.env.PORT, 3000),
    appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
    databaseUrl: process.env.DATABASE_URL || '',
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: num(process.env.REDIS_PORT, 6379),
      password: process.env.REDIS_PASSWORD || '',
      db: num(process.env.REDIS_DB, 0),
    },
    jwt: {
      secret: process.env.JWT_SECRET || 'dev-only-change-me',
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '7d',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    },
    aesMasterKey: process.env.AES_MASTER_KEY || '',
    sms: {
      provider: (process.env.SMS_PROVIDER as any) || 'dev',
      accessKey: process.env.SMS_ACCESS_KEY || '',
      accessSecret: process.env.SMS_ACCESS_SECRET || '',
      signName: process.env.SMS_SIGN_NAME || '',
      templateCode: process.env.SMS_TEMPLATE_CODE || '',
    },
    login: {
      maxFails: num(process.env.LOGIN_MAX_FAILS, 5),
      lockSeconds: num(process.env.LOGIN_LOCK_SECONDS, 900),
    },
    throttle: {
      ttl: num(process.env.THROTTLE_TTL, 60),
      limit: num(process.env.THROTTLE_LIMIT, 60),
      authTtl: num(process.env.THROTTLE_AUTH_TTL, 60),
      authLimit: num(process.env.THROTTLE_AUTH_LIMIT, 10),
    },
    faceMatchThreshold: num(process.env.FACE_MATCH_THRESHOLD, 0.85),
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    // 阶段三：智能聊天安抚
    llm: {
      provider: (process.env.LLM_PROVIDER as any) || 'RULE',
      baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.LLM_API_KEY || '',
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
    },
    tts: {
      engine: (process.env.TTS_ENGINE as any) || 'browser',
      endpoint: process.env.TTS_ENDPOINT || '',
      apiKey: process.env.TTS_API_KEY || '',
      voice: process.env.TTS_VOICE || 'zh-CN-female-child',
    },
    asr: {
      engine: (process.env.ASR_ENGINE as any) || 'browser',
    },
    chat: {
      cooldownMs: num(process.env.CHAT_COOLDOWN_MS, 5 * 60 * 1000),
    },
    // 阶段六：桌宠硬件接口
    mqtt: {
      url: process.env.MQTT_URL || undefined,
      topicPrefix: process.env.MQTT_TOPIC_PREFIX || 'deskpet',
    },
  };
};
