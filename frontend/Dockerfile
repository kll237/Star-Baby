# 前端镜像：多阶段构建 + Nginx 托管（生产级）
# 注意：构建期通过 ARG 固定 VITE_API_BASE=/api，避免把开发用 .env 的 http://localhost:3000 打进镜像
FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=$VITE_API_BASE
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:alpine AS serve
# 移除默认配置，使用项目内生产配置（含 gzip / 限流 / WS 反代 / 443 TLS）
RUN rm -f /etc/nginx/conf.d/default.conf
# envsubst 由 gettext 提供，官方 nginx:alpine 可能未预装
RUN apk add --no-cache gettext
COPY --from=build /app/dist /usr/share/nginx/html
# 模板 + 注入脚本：启动时把 ${DOMAIN} 替换为真实域名
# 证书未签发时仅启用 80；签发后自动启用 443
COPY nginx/http.conf.template /etc/nginx/templates/http.conf.template
COPY nginx/https.conf.template /etc/nginx/templates/https.conf.template
COPY nginx/entrypoint.sh /docker-entrypoint.d/40-envsubst-domain.sh
RUN chmod +x /docker-entrypoint.d/40-envsubst-domain.sh
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
