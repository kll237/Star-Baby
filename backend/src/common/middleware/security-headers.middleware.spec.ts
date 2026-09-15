import { SecurityHeadersMiddleware } from './security-headers.middleware';

function fakeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
  } as any;
}

describe('SecurityHeadersMiddleware', () => {
  const mw = new SecurityHeadersMiddleware();

  it('始终设置基础安全头', () => {
    const res = fakeRes();
    const next = jest.fn();
    mw.use({ headers: {} } as any, res, next);
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['X-Frame-Options']).toBe('DENY');
    expect(res.headers['Referrer-Policy']).toBe('no-referrer');
    expect(res.headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(next).toHaveBeenCalled();
  });

  it('仅当 HTTPS（含 X-Forwarded-Proto）时启用 HSTS', () => {
    const http = fakeRes();
    mw.use({ headers: {} } as any, http, jest.fn());
    expect(http.headers['Strict-Transport-Security']).toBeUndefined();

    const https = fakeRes();
    mw.use({ headers: { 'x-forwarded-proto': 'https' } } as any, https, jest.fn());
    expect(https.headers['Strict-Transport-Security']).toContain('max-age=');

    const reqSecure = fakeRes();
    mw.use({ secure: true, headers: {} } as any, reqSecure, jest.fn());
    expect(reqSecure.headers['Strict-Transport-Security']).toContain('max-age=');
  });
});
