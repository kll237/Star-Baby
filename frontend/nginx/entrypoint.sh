#!/bin/sh
# 前端 Nginx 容器启动前注入真实域名到配置模板
# 仅替换 ${DOMAIN}，避免误伤 nginx 自身的 $host/$request_uri/$binary_remote_addr 等变量
set -e

export DOMAIN="${DOMAIN:-localhost}"
echo "[entrypoint] DOMAIN=${DOMAIN}"

# HTTP server 始终启用（ACME 验证目录 + 80→443 跳转）
envsubst '${DOMAIN}' < /etc/nginx/templates/http.conf.template > /etc/nginx/conf.d/80-http.conf

# HTTPS server 仅在 Let's Encrypt 证书已签发时启用
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
if [ -f "$CERT" ]; then
  envsubst '${DOMAIN}' < /etc/nginx/templates/https.conf.template > /etc/nginx/conf.d/443-https.conf
  echo "[entrypoint] 已启用 HTTPS (443)"
else
  echo "[entrypoint] 未找到证书 ${CERT}，仅启用 80。请运行 'docker compose run --rm certbot certonly' 签发后 restart frontend。"
fi

# 校验生成的配置语法（非 0 退出会阻止 nginx 启动，便于排查）
nginx -t
