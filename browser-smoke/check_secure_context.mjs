import { chromium } from 'playwright';
const BASE = 'https://localhost:3300';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage({ ignoreHTTPSErrors: true });
await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
const r = await p.evaluate(() => ({
  isSecureContext: window.isSecureContext,
  mediaDevices: typeof navigator.mediaDevices,
  getUserMedia: typeof (navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  protocol: location.protocol,
}));
console.log('SECURE_CONTEXT=' + JSON.stringify(r));
await b.close();
