# 架构与数据库设计说明（阶段一 + 阶段二）

## 1. 分层架构

```
┌─────────────────────────────────────────────┐
│              前端 (Vue 3 SPA)                │
│  登录/注册/学生管理/人脸注册/刷脸登录/看板    │
│  · 学生端实时检测（face-api.js 情绪 + 动作）  │
│  · WebSocket(/socket.io) 接收实时情绪推送     │
└───────────────┬─────────────────────────────┘
                │  HTTPS + JWT(Bearer)
                │  WS   + JWT(Bearer, query)
┌───────────────▼─────────────────────────────┐
│               NestJS 后端 (BFF/API)          │
│  AuthModule · UsersModule · FaceModule ·     │
│  SmsModule · SecurityModule · AuditModule ·  │
│  DetectionModule(API + WebSocket Gateway)    │
└───────┬───────────────┬───────────────┬─────┘
        │               │               │
   ┌────▼────┐     ┌────▼────┐     ┌─────▼─────┐
   │PostgreSQL│    │  Redis  │     │ 对象存储   │
   │ (Prisma) │    │限流/会话│     │(人脸图/报告)│
   └─────────┘    └─────────┘     └───────────┘
```

- **客户端人脸特征提取**：face-api.js 在浏览器侧完成检测与 128 维向量计算，后端只存储与比对加密向量，避免原始人脸图像外传，符合未成年人数据最小化原则。
- **1:N 比对**：后端加载全部学生的加密向量 → 解密 → 余弦相似度比对，取最佳候选；置信度 = cosine×100，阈值默认 0.85。后续可平滑替换为 Faiss / pgvector 向量库。
- **实时检测管线（阶段二）**：浏览器使用 face-api.js（表情）与 MediaPipe/运动学启发式（动作）本地推理，`compositeScore` 由 `detection.math.ts` 的纯函数计算；每帧通过 REST 写入 `EmotionFrame`，同时经 **WebSocket Gateway 实时推送**给关联家长/教师端（游戏内 <200ms）。关键算法（综合评分、负向判定）抽离为纯函数，便于单元测试与后续服务端推理迁移。

## 2. 数据库 ER 关系（PostgreSQL）

```
┌───────────┐       ┌──────────────┐       ┌──────────────────┐
│   User    │1    * │   Student    │1    * │  FaceDescriptor  │
│-----------│──────▶│--------------│──────▶│------------------│
│ id (PK)   │       │ id (PK)      │       │ id (PK)          │
│ account(UQ)│      │ name         │       │ studentId (FK)   │
│ passwordHash│     │ gender       │       │ payload(AES-GCM) │
│ phone (UQ) │       │ birthDate    │       │ algorithm        │
│ role       │       │ ownerId (FK) │       │ livenessPassed   │
│ status     │       │ status       │       │ angle            │
│ lockedUntil│       └──────────────┘       └──────────────────┘
└─────┬─────┘             ▲
      │ *               * │ 多对多（监护人）
      └───────────────────┘
      (User.guardianStudents ⟷ Student.guardians)

┌───────────┐   ┌──────────────┐   ┌──────────────┐
│  SmsCode   │   │ RefreshToken │   │   AuditLog   │
│-----------│   │--------------│   │--------------│
│ id (PK)   │   │ id (PK)      │   │ id (PK)      │
│ phone     │   │ userId (FK)  │   │ userId (FK?) │
│ code      │   │ token (UQ)   │   │ action       │
│ purpose   │   │ expiresAt    │   │ resource     │
│ expiresAt │   │ revoked      │   │ detail(JSON) │
│ consumed  │   └──────────────┘   │ ip           │
└───────────┘                     └──────────────┘
```

### 实体职责

| 表 | 用途 |
| --- | --- |
| `User` | 家长/教师账号（账号唯一、手机唯一、bcrypt 密码、角色、锁定时间） |
| `Student` | 学生档案（由家长/教师创建；owner 为创建者，guardians 为关联的多位监护人） |
| `FaceDescriptor` | 学生人脸特征向量（AES-256-GCM 加密的 JSON，含算法/角度/活体标记） |
| `SmsCode` | 短信验证码（注册/找回密码，5 分钟有效，消费后失效） |
| `RefreshToken` | 刷新令牌（记住登录最长 30 天，可吊销） |
| `AuditLog` | 审计日志（登录、人脸注册、查看/导出等，支持审计追溯） |

## 3. 安全要点

- **密码**：bcrypt（cost=10），数据库仅存哈希。
- **令牌**：JWT access 7 天；refresh token 入库可吊销；「记住登录」延长 refresh 至 30 天。
- **人脸数据**：仅存特征向量（非原始图像），AES-256-GCM 加密（密钥来自 `AES_MASTER_KEY`）。
- **登录防护**：失败计数存 Redis，5 次锁定 15 分钟；全局 Throttler 限流。
- **未成年人合规**：数据最小化（向量而非照片）、脱敏、审计留痕，预留二次验证（查看/导出报告）。

## 4. 阶段三：智能聊天安抚（ChatModule）

### 4.1 模块组成

```
ChatModule
 ├─ ChatController    REST：会话 CRUD / 话术库查阅 / LLM 切换 / 媒体状态
 ├─ ChatGateway       WebSocket(/chat)：实时安抚对话 + 自动触发广播
 ├─ ChatService       会话生命周期 + 多轮上下文 + 触发判定（纯业务逻辑）
 ├─ LlmService        可切换 LLM 策略：RULE(话术库) / MOCK / OPENAI(兼容)
 ├─ TtsService/AsrService  媒体引擎开关（默认 browser = Web Speech API）
 └─ chat.util.ts      纯函数：shouldTriggerComfort / selectScript / ruleReply
```

### 4.2 关键设计

- **负面情绪自动触发**：`DetectionGateway` 在每帧检测到持续负向（`compositeScore<40` 或主导负向情绪且置信≥35）时，调用 `ChatService.maybeAutoStartComfort()`；该方法内置**冷却节流**（默认 5 分钟，避免刷屏式重复开会话），开启会话后向 `chat:{studentId}` 房间广播 `comfort` 事件。前端检测大屏据此弹出「星宝陪我聊聊」引导，家长/教师端同房间可旁听。
- **CBT/正念话术库**：`ComfortScript` 表 + 内置 `COMFORT_SCRIPTS`（58 条，覆盖 CBT/正念/呼吸/着陆/共情/鼓励/转移/常规 8 类）。`selectScript()` 按「情绪精确命中 → 偏好类别 → 多轮升级(着陆/呼吸) → 通用」优先级挑选，并规避近期已用技术，保证多轮多样性。
- **可切换 LLM**：`LlmService` 持有三种提供方实例，运行期可经 `POST /chat/llm/provider` 在 `RULE`(零依赖默认) / `MOCK` / `OPENAI`(兼容接口) 间切换；`OPENAI` 未配置密钥时自动降级到话术库，保证任何部署都「有问必答」。
- **TTS / ASR**：默认 `browser` 引擎，由前端 Web Speech API 完成童声朗读与语音识别，零服务端依赖、延迟最低、隐私最佳；预留 `server` 引擎开关对接云端 TTS/ASR 网关，未配置安全回退浏览器端。
- **多轮对话与历史**：`ChatSession` + `ChatMessage` 持久化；`sendMessage` 携带最近 12 条历史与近期技术列表生成回复，支持上下文连续与升级策略。

### 4.3 数据表（阶段三新增）

| 表 | 用途 |
| --- | --- |
| `ComfortScript` | 安抚话术库（类别/技术/触发情绪/正文/追问/语气/标签/优先级/启用） |
| `ChatSession` | 安抚会话（学生/触发情绪/触发来源/状态/LLM/起止时间/消息数/小结） |
| `ChatMessage` | 对话消息（角色 USER/ASSISTANT/SYSTEM/SCRIPT、技术、命中话术、TTS 音频） |

### 4.4 阶段四：家长/教师数据看板与报告（ReportModule）

看板与报告完全由**实时聚合**产出，不引入新增业务表（仅保留 `ReportRecord` 导出历史用于合规追溯）。所有聚合逻辑下沉到纯函数 `report.aggregate.ts`，便于单元测试与前后端复用。

- **聚合纯函数（无副作用，14 项单测）**：
  - `bucketizeTrend`：按日/周/月分桶，计算每桶平均综合情绪分、负面占比、主导情绪分布；
  - `summarizeEmotion`：总帧数、负面占比、均值、最正面/最负面极值、主导情绪分布；
  - `detectRiskBursts`：将相邻间隔 < 60s 的连续负向帧聚为「风险段」（时长、峰值负向分、主导情绪）；
  - `computeComfortStats` / `computeInterventionEffect`：安抚会话统计、干预覆盖率（风险段 → 检测触发安抚）；
  - `dashboardToCsv`：将看板导出为多段 CSV（趋势/风险/安抚干预）。
- **ReportService**：注入 `DetectionService` 复用 `behaviorStats`；按 `periodRange`（DAILY/WEEKLY/MONTHLY/CUSTOM）切片 `EmotionFrame` 与 `ChatSession`，组装 `DashboardData`；`exportReport` 生成 JSON/CSV 并写入 `ReportRecord`；`assertStudentAccess` 复用既有学生归属校验。
- **ReportController**：`/reports/students/:id/{dashboard,trend,risk-events,comfort-stats,intervention,records}` + `POST .../export`（直接返回文件下载）。前端 `ParentDashboardView.vue` 提供趋势 SVG 折线图、情绪/行为分布、风险事件表、干预覆盖率与一键导出。

### 4.5 阶段五：专业心理建议引擎与知识库（AdviceModule）

- **知识库（≥200 条）**：`advice.knowledge.ts` 内置 **211 条** 循证特教/心理建议，覆盖 12 大类别（情绪调节 / 社交技能 / 行为干预 / 感觉统合 / 沟通表达 / 家庭生活 / 学校适应 / 危机干预 / 家长指导 / 教师策略 / 认知训练 / 常规建立），每条标注来源（ABA / TEACCH / 正念 / CBT / 社交故事 / 感觉统合 / DIR·Floortime / SCERTS / PECS / PBS 等）、适用情绪/行为、目标人群、严重度与文献出处；持久化到 `KnowledgeItem`。
- **建议引擎（纯函数，8 项单测）** `advice.engine.ts`：
  - `buildAdviceProfile`：从阶段四 `DashboardData` 提炼「学生画像」（负面占比/主导情绪/行为频次/高危行为）；
  - `computeSeverity`：依据负面占比阈值与高危行为自动判定严重度（LOW/MEDIUM/HIGH/CRITICAL，自伤→CRITICAL）；
  - `scoreKnowledge` / `matchKnowledge`：加权打分（情绪命中 +3、行为命中 +4、类别亲和 +2、严重度匹配），并抑制「过度报警」（稳定画像下不推高危条目）；
  - `generateAdvice`：产出严重度 + 摘要 + TopN 分级条目（含匹配理由）+ 按类别分组；
  - `buildAdvicePrompt`：基于画像 + Top 建议构造 LLM 润色提示词（复用阶段三可切换 LLM）。
- **AdviceService**：注入 `ReportService` 取画像、`PrismaService` 读写知识库与建议记录；`generateAdvice` 生成并写入 `AdviceRecord`；`seedKnowledge` 按 `title` 幂等播种；`getKnowledge` 支持分类/对象/严重度/关键词过滤；`assertStudentAccess` 复用既有归属校验。
- **AdviceController**：`POST /advice/students/:id/generate`（生成并持久化）、`GET .../records`、`POST .../prompt`（LLM 提示词）、`GET /advice/knowledge`、`GET /advice/knowledge/seed`、`GET /advice/knowledge/count`。前端 `AdviceView.vue` 提供严重度横幅 + 分级建议卡 + 历史记录 + 可检索知识库。

### 4.6 阶段六：桌宠硬件接口与虚拟桌宠（DeskPetModule）

- **反应映射（纯函数，17 项单测）** `deskpet.reaction.ts`：把检测/风险/安抚/建议/指令事件映射为统一 `PetReaction`（心情 `PetMood` + 动画 `PetAnimation` + 文案 + 强度 + 时间戳）。风险行为（`self_injury` 等）与 `risk` 标志优先 `alert`；负向情绪驱动 `angry/shake`、`anxious/hug`、`sad/sway`；正向 `happy/celebrate/dance`。
- **内置内存 MQTT Broker（15 项单测）** `deskpet.mqtt-broker.ts`：实现 MQTT 主题发布/订阅与 `+`（单层）/ `#`（多层）通配符匹配；`MqttService` 在配置 `MQTT_URL` 且可加载 `mqtt` 包时连接真实 broker，否则降级至内存 broker（离线/演示开箱即用，零外部依赖）。
- **统一分发** `DeskPetService.dispatch`：① MQTT 发布（精确 channel 主题 + 聚合 `feed` 主题，远程模式额外发布 retained `state`）② 经 `DeskPetBus`（进程内事件总线，解耦网关）③ 更新 latest 快照 ④ 持久化（`DeskPetEvent`，detection 按 mood 变化节流，其余必存）。`DeskPetDevice` 支持 VIRTUAL/ROBOT/SCREEN 三类设备注册与回溯。阶段八在其基础上实现跨实例反应同步与真实硬件上下行（见 4.8 节）。
- **桌宠 WebSocket 网关** `deskpet.gateway.ts`：`/deskpet` 命名空间，按 `student:{id}` 房间广播 `reaction`；与 `DeskPetBus` 解耦，避免与 `DeskPetService` 循环依赖。
- **管线深度集成**：`DetectionGateway`（`risk`/持续负向→`comfort`）、`ChatGateway`（会话开始/回复/安抚）、`AdviceService`（生成建议后）均调用 `DeskPetService` 对应入口，实现检测→安抚→建议→桌宠的实时联动。
- **REST** `deskpet.controller.ts`：设备注册/查询/更新/删除、聚合 `feed`、`mqtt-status`、事件回溯、`command` 下发；`assertStudentAccess` 复用既有归属校验。
- **前端** `views/DeskPetView.vue`：动画 SVG「星宝」按心情/动画切换，支持手动指令、事件日志与悬浮陪伴模式；路由 `/student/deskpet`，并在家长/教师概览加入口。

### 4.7 阶段七：部署优化 / 安全加固 / 性能（CacheModule / SecurityHeadersMiddleware / Audit 查询 / Nginx / Docker）

- **统一 API 前缀**：`main.ts` 调用 `setGlobalPrefix('api', { exclude: ['health','docs'] })`，与前端 `VITE_API_BASE=/api`、Nginx `/api/` 反代保持一致，消除部署路径错位（WebSocket 命名空间与 `/health` 不受影响）。
- **安全响应头中间件（2 项单测）** `common/middleware/security-headers.middleware.ts`：零依赖注入 CSP / HSTS（仅 HTTPS 或 `X-Forwarded-Proto=https` 时）/ `X-Frame-Options: DENY` / `X-Content-Type-Options: nosniff` / `Referrer-Policy` / `Permissions-Policy`。
- **限流分层** `app.module.ts` 的 `ThrottlerModule` 配置命名节流器 `default`（60s/60）与 `auth`（60s/10）；`auth.controller.ts` 的注册/登录/刷新/找回/重置统一套用 `auth` 节流。
- **审计增强** `audit.service.ts` 新增 `query`（按用户/动作/资源/时间区间过滤 + 分页，`4 项单测`）；`audit.controller.ts` 暴露 `GET /api/audit`（教师 `scope=all` 查全部，其余仅自己）；`DeskPetService.handleCommand` 与 `ReportService.exportReport` 等补记审计。
- **缓存层（6 项单测）** `cache/cache.service.ts`：基于 `RedisService`（自动降级内存）的 JSON 序列化 + TTL + `delByPrefix` 失效封装。`ReportService.getDashboard` 缓存 30s、`AdviceService.getKnowledge` 缓存 60s；`DetectionGateway` 在写入检测帧后调用 `report.invalidateDashboard` 触发写时失效，保证最终一致。
- **Nginx 反代** `frontend/nginx/default.conf`：gzip、认证接口 `limit_req`（10r/m，突发 5）、一般 API 30r/s、WebSocket `/socket.io/` 升级 + 长超时、静态资源长期缓存、SPA 回退、`client_max_body_size 8m`、`server_tokens off`。
- **Docker 编排** `docker-compose.yml`：Postgres + Redis（持久化卷）+ 后端（非 root 镜像 + 健康检查）+ 前端 Nginx，统一 bridge 网络；`backend/.env.example` 提供完整变量清单；前后端均补 `.dockerignore`。
- **性能与压测** `src/perf/perf.spec.ts`（缓存读写/反应映射/看板聚合/命中 vs 重算，4 组基准）；`scripts/loadtest.mjs`（零依赖 Node HTTP 压测，输出 RPS / p50·p95·p99 / 错误率）；`deploy/k6/loadtest.js`（分阶段加压）。

### 4.8 阶段八：真实 MQTT 跨进程联动（可水平扩展）

- **健壮化 MqttService**：配置 `MQTT_URL` 且可加载 `mqtt` 包即连接真实 broker（Mosquitto/EMQX），支持自动重连、QoS=1、retained 状态、`onStatusChange` 状态事件；不可用时安全降级到内置内存 broker（`LocalMqttBroker`），对外接口一致。
- **跨实例反应同步（fan-out + 去重）**：`DeskPetService` 每个实例持有唯一 `instanceId`，反应信封带 `origin`；`onModuleInit` 订阅 `deskpet/+/feed`，来自**其他实例**的反应按 `origin` 去重后驱动本地 `DeskPetBus`（进而广播到本地 WebSocket 客户端），避免回环重复处理；源头实例已持久化，故转发不再落地。
- **真实硬件 ingestion（上行）**：订阅 `deskpet/+/cmd_up`（设备主动下发指令）与 `deskpet/+/hb`（心跳）。`cmd_up` 经 **Redis 分布式锁 `RedisService.tryLock`** 去重（多实例同订阅时仅一个实例执行，不重复持久化）；`hb` 刷新设备 `lastSeenAt`。
- **指令下行（cmd_down）**：`handleCommand` 在远程模式向 `deskpet/{studentId}/cmd_down` 发布动作指令，真实设备可订阅执行；`dispatch` 在远程模式额外发布 retained `state` 快照，新接入设备/实例立即获得最新状态。
- **Socket.IO Redis 适配器（跨实例 WebSocket）** `redis/redis-io.adapter.ts`：配置 `REDIS_HOST` 即启用 `@socket.io/redis-adapter`，使 WebSocket 广播（如桌宠 `pet_state`）在多后端实例间一致；未配置则回退内存适配器（单机/开发）。`main.ts` 在 `bootstrap` 中装配。
- **部署落地**：`mqtt/mosquitto.conf` + `docker-compose.yml` 的 `mqtt` 服务（暴露 1883 + 健康检查）+ 编排内 `MQTT_URL=mqtt://mosquitto:1883`；`backend/package.json` 增加 `mqtt` / `@socket.io/redis-adapter`；`.env.example` 增加 `MQTT_URL` / `MQTT_TOPIC_PREFIX`。
- **测试** 累计 **22 套件 / 194 项** 全绿（阶段八新增 mqtt.service 4 + deskpet 跨进程 7 + redis tryLock 3）。

## 5. 阶段演进映射

| 阶段 | 新增模块 | 数据表扩展 |
| --- | --- | --- |
| 一（已完成） | Auth/Users/Face/Sms/Security/Audit | 见上 |
| 二（已完成） | `Detection` 模块（情绪/动作推理 + WebSocket 实时推送） | `DetectionSession`、`EmotionFrame`、`BehaviorEvent` |
| 三（已完成） | `Chat` 模块（智能聊天安抚：话术库/可切换 LLM/TTS·ASR/实时对话） | `ComfortScript`、`ChatSession`、`ChatMessage` |
| 四（已完成） | `Report` 模块（数据看板与报告） | `ReportRecord`（导出历史） |
| 五（已完成） | `Advice` 模块（专业心理建议引擎与知识库） | `KnowledgeItem`、`AdviceRecord` |
| 六（已完成） | `DeskPet` 模块（WebSocket/MQTT + 虚拟桌宠） | `DeskPetDevice`、`DeskPetEvent` |
| 七（已完成） | `Cache` 模块 + 安全中间件 + 审计查询 + Nginx/Docker 编排 | 复用 `AuditLog` |
| 八（已完成） | 真实 MQTT 跨进程联动（MqttService 加固 + 跨实例同步 + 硬件 ingestion + Socket.IO Redis 适配器） | 复用 `DeskPetDevice`、`DeskPetEvent` |
