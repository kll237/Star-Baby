import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * 零依赖安全响应头中间件（生产环境由 Nginx 边缘亦可设置，但应用层设置可覆盖开发/直连场景）：
 * - Strict-Transport-Security：仅在 HTTPS（含经代理转发的 X-Forwarded-Proto）下启用，避免本地 http 调试被锁死；
 * - X-Content-Type-Options: nosniff：禁止 MIME 嗅探；
 * - X-Frame-Options: DENY：禁止被 iframe 嵌套（防范点击劫持）；
 * - Referrer-Policy: no-referrer：减少请求头泄露；
 * - Permissions-Policy：限制隐性敏感能力；
 * - Content-Security-Policy：SPA 同源策略，WebSocket/API 同源放行。
 *
 * 注意：该中间件对所有响应生效（含 /docs 的 Swagger UI），其中样式/脚本允许 'unsafe-inline' 以保证 SPA 与 Swagger 正常渲染。
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const proto = (req.headers['x-forwarded-proto'] as string) || '';
    const isHttps = req.secure || proto === 'https';
    if (isHttps) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=63072000; includeSubDomains; preload',
      );
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Permissions-Policy',
      "geolocation=(), microphone=(self), camera=(self), payment=(), usb=()",
    );
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'",
    );
    next();
  }
}
