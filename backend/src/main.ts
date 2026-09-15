import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join, extname, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import express from 'express';
import { AppModule } from './app.module';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';
import { RedisIoAdapter } from './redis/redis-io.adapter';

/**
 * 读取 HTTPS 自签证书（含 localhost + 局域网 IP 的 SAN），用于手机/平板摄像头安全上下文。
 * 浏览器规定 getUserMedia 只能在 HTTPS 或 localhost 下调用；手机用 http://<局域网IP> 打开时
 * 摄像头会被拦截，因此本机自签证书 + HTTPS 是移动端实测摄像头的必要前提。
 * 证书缺失或 ENABLE_HTTPS=false 时自动回退 HTTP（仅本机 localhost 演示可用）。
 */
function buildHttpsOptions(): { key: Buffer; cert: Buffer } | null {
  if (process.env.ENABLE_HTTPS === 'false') return null;
  const keyPath = process.env.HTTPS_KEY || join(__dirname, '..', 'certs', 'server.key');
  const certPath = process.env.HTTPS_CERT || join(__dirname, '..', 'certs', 'server.cert');
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    new Logger('Bootstrap').warn(
      '未找到 HTTPS 证书（backend/certs/server.key|server.cert），将以 HTTP 启动。' +
        '手机/平板摄像头需 HTTPS，请用 node 生成证书后再启用。',
    );
    return null;
  }
  try {
    return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  } catch (e) {
    new Logger('Bootstrap').warn(`读取 HTTPS 证书失败，回退 HTTP：${(e as Error).message}`);
    return null;
  }
}

async function bootstrap() {
  const httpsOptions = buildHttpsOptions();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    httpsOptions ? { httpsOptions } : {},
  );
  const config = app.get(ConfigService);

  // 全局校验管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // 阶段七：统一 API 前缀（与前端 VITE_API_BASE=/api 及 Nginx /api/ 反代保持一致）
  // 健康检查端点（存活 /health 与就绪 /health/ready）均排除前缀，便于探针直接访问。
  // NestJS 的 exclude 仅做精确匹配，故同时列出 health 与 health/ready。
  app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'docs'] });

  // 阶段七：安全响应头（CSP / HSTS / X-Frame-Options 等）
  app.use(new SecurityHeadersMiddleware().use);

  // 单端口部署（阶段八收尾）：后端直接托管前端构建产物。
  // 前端使用相对路径（/api 与 io('/detection') 等），同源托管后无需 dev 代理 / CORS。
  const frontendDist = resolve(
    config.get<string>('FRONTEND_DIST') || join(__dirname, '..', '..', 'frontend', 'dist'),
  );
  if (existsSync(frontendDist)) {
    app.useStaticAssets(frontendDist);
    // 服务端 TTS 音频缓存目录（Edge TTS 生成的 mp3），供前端 <audio> 播放
    app.use('/tts', express.static(join(process.cwd(), '.tts-cache')));
    // SPA 回退：非 API / 文档 / WebSocket 网关的 GET 请求一律返回 index.html（history 路由）
    app.use((req, res, next) => {
      const p = req.path;
      if (/^\/(api|docs|health|socket\.io|detection|deskpet|chat|alerts)\b/.test(p)) return next();
      if (req.method === 'GET' && !extname(p)) {
        return res.sendFile(join(frontendDist, 'index.html'), (err) => {
          if (err) next();
        });
      }
      next();
    });
    new Logger('Bootstrap').log(`前端静态资源已托管: ${frontendDist}`);
  } else {
    new Logger('Bootstrap').warn(
      `未找到前端构建目录 ${frontendDist}，仅启动 API 服务（请先在前端执行 npm run build）。`,
    );
  }

  // 阶段八：Socket.IO Redis 适配器（多实例时 WebSocket 广播跨进程一致；无 Redis 则回退内存）
  const redisIoAdapter = new RedisIoAdapter(app, config);
  await redisIoAdapter.connectWithRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // CORS（按环境变量限定来源）
  const corsOrigin = config.get<string>('corsOrigin') || '*';
  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(','),
    credentials: true,
  });

  // Swagger / OpenAPI 文档
  const swagger = new DocumentBuilder()
    .setTitle('特殊儿童情绪及动作行为识别与智能干预系统')
    .setDescription(
      '阶段一 API：双端用户体系（注册/登录/人脸注册/人脸登录）；阶段二：学生端实时检测引擎（情绪+动作）；阶段三：智能聊天安抚系统（负面情绪触发 / CBT·正念话术库 / 多轮对话 / 可切换 LLM / TTS·ASR）；阶段四：家长/教师数据看板与报告（情绪趋势 / 风险事件 / 行为频次 / 安抚统计 / 干预效果 / 可导出 JSON·CSV）；阶段五：专业心理建议引擎与知识库（≥200 条循证知识 / 画像驱动的建议生成 / 严重度判定 / 可切换 LLM 润色）；阶段六：桌宠硬件接口与虚拟桌宠（WebSocket/MQTT）；阶段七：部署优化 / 安全加固 / 性能（缓存 / 限流 / 安全头 / 审计）',
    )
    .setVersion('6.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('docs', app, document);

  const port = config.get<number>('port') || 3000;
  const proto = httpsOptions ? 'https' : 'http';
  await app.listen(port);
  new Logger('Bootstrap').log(`🚀 服务已启动: ${proto}://localhost:${port}`);
  new Logger('Bootstrap').log(`📚 API 文档: ${proto}://localhost:${port}/docs`);
  if (httpsOptions) {
    new Logger('Bootstrap').log(
      `📱 手机/平板请访问: ${proto}://<本机局域网IP>:${port}（首次需信任自签证书）`,
    );
  }
}

bootstrap();
