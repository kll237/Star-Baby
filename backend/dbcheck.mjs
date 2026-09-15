import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  const a = await p.alertLog.count();
  const c = await p.consentRecord.count();
  const u = await p.user.count();
  console.log('OK tables reachable. AlertLog=', a, 'ConsentRecord=', c, 'User=', u);
} catch (e) {
  console.log('DB ERROR:', e.message);
} finally { await p.$disconnect(); }
