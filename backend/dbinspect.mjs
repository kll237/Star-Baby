import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const users = await p.user.findMany({ select: { id:true, role:true, email:true, phone:true, account:true } });
console.log('USERS('+users.length+'):');
for (const u of users) console.log(' -', u.role, 'acct='+u.account, 'email='+(u.email||'-'), 'phone='+(u.phone||'-'), u.id);
const stus = await p.student.findMany({ select: { id:true, name:true, ownerId:true, guardians:true } });
console.log('STUDENTS('+stus.length+'):');
for (const s of stus) console.log(' -', s.name, 'owner='+s.ownerId, 'guard='+(s.guardians||[]).join(','), s.id);
await p.$disconnect();
