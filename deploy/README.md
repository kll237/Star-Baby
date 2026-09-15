# 星宝守护 · 公网 HTTPS 部署说明书

本说明带你把「特殊儿童情绪及动作行为识别与智能干预系统」部署到**公网云服务器 + 真实域名 + Let's Encrypt 免费证书**，
实现：**家长/老师无论用手机 4G/5G 还是任意 Wi‑Fi，打开 `https://你的域名` 即可跨网络实时看护同一名孩子，且浏览器零证书警告、摄像头直接可用。**

---

## 一、准备资源

| 资源 | 说明 | 预估成本 |
|---|---|---|
| 云服务器 | 轻量应用服务器 / ECS，2C2G 起步（演示），4C4G 更稳 | 国内 ¥60–100/月；香港/海外更低 |
| 域名 | 任意注册商，需能做 DNS A 记录 | ¥30–80/年 |
| （国内服务器）ICP 备案 | 大陆服务器必须备案，否则 80/443 被运营商阻断 | 免费，约 1–2 周 |
| 服务器系统 | 推荐 Ubuntu 22.04 / 24.04，已装 Docker + Docker Compose | — |

> 不想备案？选**香港 / 新加坡 / 日本**等境外节点，域名**无需备案**即可用 80/443（注意内容合规）。

---

## 二、部署步骤

### 1. 上传代码到服务器
把整个项目目录拷贝到服务器（如 `/opt/starguard/`），确保包含：
`docker-compose.yml`、 `backend/`、 `frontend/`（含 `frontend/nginx/`）、 `mqtt/`、`deploy/`。

### 2. 填写生产环境变量
```bash
cd /opt/starguard
cp deploy/.env.production deploy/.env.production.local
nano deploy/.env.production.local   # 改 DOMAIN / EMAIL / 两个强密码
```
⚠️ **两个密码务必改成 24 位以上强随机值**（数据库与 Redis 直接关系数据安全）。

### 3. 准备后端环境变量文件
compose 中 `backend` 服务引用 `backend/.env`（存放 JWT 密钥、短信/LLM 等敏感配置）。
若仓库中该文件被 gitignore 而未随代码拷贝，请在服务器上先创建：
```bash
cd /opt/starguard/backend
[ -f .env ] || cp .env.example .env   # 若不存在则从示例复制
nano .env                              # 补全 JWT_SECRET / 短信平台 / LLM_API_KEY 等
```
> 注意：`docker-compose.yml` 会用 `environment:` 覆盖 `DOMAIN / DATABASE_URL / REDIS / CORS / ENABLE_HTTPS / FRONTEND_DIST` 等生产值；
> 这里只需补齐 `.env.example` 里其余业务密钥即可。

### 4. 域名 DNS + 防火墙
- 在域名控制台把 `A 记录` 指向服务器**公网 IP**（国内需备案通过后才解析生效）。
- 云厂商安全组 / 系统防火墙放行 **80** 与 **443**（入站）。80 仅用于证书验证与跳转，不能关。

### 5. 启动全部服务
```bash
docker compose --env-file deploy/.env.production.local up -d --build
```
此时 80 端口已起（HTTP 会自动 301 跳 HTTPS，但 HTTPS 尚未配置证书，先别急）。

### 6. 首次签发 Let's Encrypt 证书
```bash
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d starguard.example.com \
  --email admin@example.com --agree-tos --no-eff-email --non-interactive
```
> 把上面的域名/邮箱换成你的。成功后会生成 `/opt/starguard/certbot/conf/live/<域名>/fullchain.pem`。
> 若报错 "connection refused / timeout"，多半是 80 端口没开或 DNS 未生效，先排查再重试。

### 7. 让 Nginx 加载 443 配置
```bash
docker compose restart frontend
```
前端容器启动脚本会自动把模板里的 `${DOMAIN}` 替换成你的域名；此时证书已存在，会生成 `443-https.conf` 并校验语法。

### 8. 验证
- 浏览器打开 `https://你的域名` → 应显示绿锁、无证书警告。
- 手机 4G 下打开同一地址 → 摄像头自检 / 实时识别均可调起。
- `https://你的域名/health/ready` → 返回 200 表示依赖健康。

---

## 三、证书自动续期

`certbot` 服务已在 compose 中配置为**每约 12 小时自动 `certbot renew`**（证书剩余 <30 天时才真正续期）。
续期成功后 Nginx 需重载才能生效，可加一条定时任务：
```bash
# 每天凌晨重载前端 Nginx（证书续期后生效）
echo "0 3 * * *  cd /opt/starguard && docker compose exec -T frontend nginx -s reload" | crontab -
```
> 手动续期测试：`docker compose run --rm certbot renew --dry-run`

---

## 四、安全收敛要点（上线前必读）

1. **端口只暴露 80/443**：本 compose 已把 PostgreSQL(5432)、Redis(6379)、MQTT(1883) 改为仅容器网络内可达，**不要**把它们加回 `ports` 映射。
2. **强密码**：数据库、Redis 密码务必强随机；Redis 已启用 `requirepass`。
3. **HTTPS 全程加密**：TLS 在前端 Nginx 终止，后端只跑内网 HTTP（`ENABLE_HTTPS=false`）。
4. **HSTS 已开启**：浏览器后续只走 HTTPS，防降级。
5. **限流已就位**：登录/短信接口（nginx `login` 区 + 后端 throttle）、一般 API（`api` 区）均有速率限制，防爆破/短信轰炸。
6. **数据合规**：这是特殊儿童情绪行为敏感数据——请确保：访问需登录鉴权、日志不记敏感字段、定期备份 `pgdata` 卷、按需对上传图片做留存与删除策略。
7. **Swagger 文档**：`/docs` 已暴露，生产如需关闭，可在 `frontend/nginx/https.conf.template` 中注释对应 `location`。

---

## 五、与「局域网自签」方案的回退关系

- 本部署包**不影响**你之前在开发机上的局域网自签 HTTPS 测试（那是后端 `main.ts` 的 `ENABLE_HTTPS=true` 路径，仅本机/同 Wi‑Fi 用）。
- 上云后后端 `ENABLE_HTTPS=false`，TLS 交给 Nginx；本地开发仍可用 `backend/.env` 的自签配置。
- 若临时退回纯局域网：用旧 `docker-compose.yml` 备份或 `ENABLE_HTTPS=true` + 同 Wi‑Fi 访问 `https://<电脑IP>:3300`。

---

## 六、常见问题

**Q：手机打开仍是「连接不是私密连接」？**
A：证书未签发或域名不符。检查 `docker compose run --rm certbot certonly` 是否成功、`DOMAIN` 与访问地址是否完全一致（含 www 与否）、443 是否真的返回证书。

**Q：80 端口被占用 / 无法开放？**
A：Let's Encrypt HTTP-01 必须能访问 80。若云厂商屏蔽 80，可改用 DNS-01 验证（需域名支持 API，配置更复杂，可后续升级）。

**Q：想用 www 前缀？**
A：签发时加 `-d 你的域名 -d www.你的域名`，Nginx `server_name` 也相应调整。

**Q：换服务器/换域名？**
A：改 `deploy/.env.production.local` 的 `DOMAIN`，重新执行「步骤 5、6」签发并重启 frontend 即可；旧证书目录可保留或删除（在 `certbot/conf/live/`）。
