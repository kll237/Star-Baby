#!/bin/sh
set -e

echo "▶ 等待数据库并应用迁移..."
# 优先使用迁移；若尚未生成迁移文件则退化为 db push
npx prisma migrate deploy || npx prisma db push --accept-data-loss

echo "▶ 启动服务..."
exec node dist/main.js
