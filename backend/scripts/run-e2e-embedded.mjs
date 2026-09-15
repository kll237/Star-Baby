// 本地集成测试运行器（无需 Docker）：启动嵌入式 PostgreSQL -> 建表 -> 运行 e2e
import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { join } from 'path';

// 规避中文 locale 导致 initdb 失败
process.env.LC_ALL = 'C';
process.env.LANG = 'C';
process.env.LC_CTYPE = 'C';

const dataDir = join(process.cwd(), `pgdata-test-${process.pid}`);
mkdirSync(dataDir, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'spchild',
  password: 'spchild_pass',
  port: 5432,
  persistent: true,
  logging: 'error',
});

async function main() {
  console.log('▶ 初始化嵌入式 PostgreSQL ...');
  await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase('spchild');
  } catch (e) {
    // 数据库可能已随用户名自动创建，忽略
  }
  console.log('▶ PostgreSQL 已就绪 (localhost:5432/spchild)');

  console.log('▶ prisma db push ...');
  execSync('npx prisma db push --skip-generate --accept-data-loss', { stdio: 'inherit' });

  console.log('▶ 运行 e2e 集成测试 ...');
  execSync('npx jest --config ./test/jest-e2e.json --runInBand', { stdio: 'inherit' });

  await pg.stop();
  console.log('✅ e2e 完成，已停止 PostgreSQL');
}

main().catch(async (e) => {
  console.error('❌ 运行失败:', e);
  try {
    await pg.stop();
  } catch {}
  process.exit(1);
});
