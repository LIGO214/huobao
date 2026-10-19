# 火宝 Web 接入 Qunl 多租户执行计划

日期：2026-10-16

> 修订：2026-10-19。当前只执行第 0 节；第 1 至 15 节是历史计划，包含已撤销的内部模型入口、绑定 Token、双来源、取消恢复和删号联动，不再作为待办。第 16 至 16.4 节保留历史事实，最新结果见 16.5。

本轮范围：保留原配置页和公开模型协议，仅完善用户隔离。视频参考素材下一阶段处理，不重复付费实测，不修改真实 Qunl 用户和 Token。

关联设计：`docs/2026-10-16-huobao-qunl-multi-tenant-design.md`

涉及仓库：

- 火宝：`D:\MMMMYYYYHHHH\huobao`
- Qunl：`D:\MMMMYYYYHHHH\qunl-api`

## 0. 当前执行计划

依据：主设计及模型简化设计第 0 节。所有者、地址和限额不写死；不要再实施后文已撤销的历史任务。

### 0.1 接口与维护边界

- 登录：浏览器经 Qunl Session 与 `/huobao/*` 代理，以签名身份进入火宝。
- 模型：火宝用本人保存的 Key、Base URL、模型和协议调用 Qunl 公开接口，不使用登录签名或自动选 Token。
- 配置数据：`data/tenant/model-configs.ts` 是配置 CRUD 与运行读取入口；协议组合集中在 `data/system/model-provider-rules.ts`，协议 URL 复用现有函数。
- Agent、图片、视频只依赖配置数据接口和既有 SDK/Adapter，不新增来源平台、计费、模型目录或 Qunl 绑定表。
- PostgreSQL 约束、租户数据模块、纯文本指令、私有媒体与轻量限额继续执行，不因简化模型流程而放松。

### 0.2 实施与状态

| 步骤 | 内容 | 当前状态 |
| --- | --- | --- |
| 1 | 配置 CRUD 与读取收口租户数据层；缺身份拒绝，跨用户 404 | 已实现并自动化验证 |
| 2 | 用途/协议严格校验，更新行锁内检查最终组合；已被剧集引用不能删或改用途 | 已实现，针对性回归和全量集成通过 |
| 3 | 配置响应只返回 has_api_key，编辑留空保留；不允许传 user_id 改归属 | 已实现并自动化验证 |
| 4 | Agent 使用本人配置调用公开文本接口；显式配置失效不回退 | 已实现，实际 SDK 和正常 Session 下双用户模拟上游验收通过 |
| 5 | 图片/视频使用本人捕获配置，火山统一 v3，后台身份与媒体发布保持隔离 | 已实现，正常 Session 到容器的双用户模拟上游验收通过 |
| 6 | Qunl 启动停止注册旧内部模型入口，保留 Session 代理 | 已实现，真实路由注册测试通过 |
| 7 | 设置页保留原配置操作，模型选项按配置 ID 区分；失效选择不静默换默认 | 已实现，浏览器新增、编辑、启停、删除及双用户隔离验收通过，见 16.5 |
| 8 | 重启仅标本地中断失败，保留上游 ID，不恢复轮询或重新提交 | 已实现并自动化验证 |
| 9 | 统一部署模板 user 模式，移除内部模型 URL；业务仍用 PostgreSQL | 最新镜像构建成功，应用和 PostgreSQL 17 独立 Compose 验收通过 |
| 10 | 文档冲突同步、Review 查 Bug、检查能否简化 | 本轮已复核；业务未增加复杂流程，测试准备与正式环境分开 |
| 11 | 原配置按明确所有者迁移，核对 root 旧模型 Key 与实际媒体源 | 未完成，不凭素材 Token 猜测 |
| 12 | 真实 Qunl Session、入口、部署与双用户完整业务验收 | 独立库正常密码登录、Session、侧栏、双用户业务和容器验收通过；正式账号及真实付费上游端到端未完成 |

### 0.3 行为要求

配置新增必须有 Key；更新省略 Key 保留原值，显式空值拒绝。API、日志、迁移清单不能返回或记录 Key。字段保持白名单，零和 false 不丢失。无效/停用/跨用户/用途错误的显式选择直接失败，不回退本人其他配置或共享 Key。未显式选择时沿用本人优先级和剧集锁定规则。

模型 Key 的权限由 Qunl 公开接口判断，火宝不复制 Token 所有权逻辑。配置 ID 与 Qunl Token ID 不混用，不在运行代码写用户 1/87。已确认 root 旧配置归 1，测试 Key 归 87、Token 2054；只读归属核对不是已执行迁移，root 原 Key 尚待逐值核对。

用户级与全局任务准入采用短事务锁，单实例文件按用户互斥检查。上传实际字节/像素/在途数量及所有派生和临时文件都受限。失败、基本超时、重启中断结束本地任务并释放本地名额，保留已有上游 ID，不自动重提；不声称上游停止，本地限额不覆盖已失联的上游工作。复杂取消、租约、自动恢复和核对平台不做。

Qunl 禁用/删除后拒绝新访问；在途任务不逐步查账号，不阻塞 Qunl 删除，不承诺同步清理火宝资产。用户指令快照冻结，Agent 模型配置尚非完整快照；图片视频使用本次捕获的配置。视频参考素材入口关闭，图片只读取本人站内图片。

### 0.4 验收与暂停点

自动化分别执行 `npm run typecheck`、`npm run test:unit`、`npm run test:structure`、设置独立测试库后的 `npm run test:integration`、前端 `npm run build`，Qunl 执行相关 Go 包测试。每批如实记录数量，不能用历史通过数替代本轮或删断言掩盖失败。

浏览器用独立临时 PostgreSQL 与假 Key 验证新增、编辑留空、启停、删除、双用户切换、桌面和手机无越界。模型端到端使用本地模拟上游，覆盖 Agent 实际工具写入、图片、Mini 视频和私有媒体；不重复付费生成，不把测试签名入口当正常 Qunl 登录。

本地隔离验收通过不等于正式 SaaS 上线。旧数据/root 配置迁移、正式账号和真实付费上游端到端仍未完成，正式环境 `HUOBAO_ENABLED` 保持关闭。测试进程单独开启代理，不修改正式 `.env`。归属不明、真实数据源缺失、越权测试失败或部署条件缺失时明确记录，不自动换库、换 Key 或推测旧数据。

## 1. 历史执行目标

> 第 1 至 15 节保留历史方案以便追溯，不再作为当前执行清单；当前只执行第 0 节。

将火宝改造成由 Qunl 统一登录入口管理的 Web 多用户应用，完成 PostgreSQL 数据隔离、媒体隔离、Agent 工具隔离、用户 Prompt/Skill、用户模型配置和必要的资源限制。

本计划优先保证边界清晰和后续可维护性，但不建设通用多租户框架、复杂权限系统、消息队列、沙箱或独立认证中心。

## 2. 实现原则

### 2.1 单一身份来源

- Qunl 是唯一账号和登录状态来源。
- 火宝只接收 Qunl 签名后的稳定 `userId`，不读取 Qunl 数据库和 Session Cookie。
- 火宝业务代码不能从请求头自行解析用户 ID，只能读取认证中间件生成的 `TenantContext`。

### 2.2 单一租户访问入口

- 路由、Service、Agent 工具不能直接导入数据库连接处理用户数据。
- 所有用户数据通过 `backend/src/data/tenant/` 下的领域模块访问。
- 领域函数第一个参数统一为 `TenantContext`。
- 系统共享数据放在 `backend/src/data/system/`，不与用户数据接口混用。

### 2.3 集中配置

新增 `backend/src/config/env.ts`，使用 Zod 在启动时一次性解析环境变量。配置缺失或格式错误时启动失败，不在业务代码里散落默认值。

至少集中管理：

- `DATABASE_URL`
- `HUOBAO_PROXY_SECRET`
- `HUOBAO_DATA_DIR`
- Agent、生成任务和 FFmpeg 的用户级、全局并发上限
- 任务超时时间
- 单用户媒体存储上限
- 请求体、单文件、图片解码像素和用户级/全局在途上传上限

Qunl 侧集中管理：

- `HUOBAO_ENABLED`
- `HUOBAO_UPSTREAM_URL`
- `HUOBAO_PROXY_SECRET`

产品路径 `/huobao/` 和身份协议版本属于双方接口契约，可以固定；服务器地址、密钥和限额不能写死。

扩展点只放在跨模块边界：身份协议、模型配置来源、租户数据模块、文件存储和 Agent 注册表。业务路由不直接依赖具体实现，也不通过全局变量隐藏租户条件；新增模型来源或 Agent 类型时只增加适配器和注册项。

Qunl 素材库属于外部租户资源边界，同样通过类型化客户端访问。火宝现有的全局 `NEW_API_ASSET_TOKEN` 和 `NEW_API_ASSET_GROUP_ID` 不能继续用于多用户 Web。

### 2.4 显式失败

- 身份、数据库、配置或迁移错误直接失败，不回退到旧全局数据、其他用户配置或 SQLite。
- 达到并发、任务或存储限制时返回明确错误，不自动借用其他用户额度。
- PostgreSQL 不可用时火宝不能启动。

### 2.5 Qunl 改动边界

- Qunl 只增加模块入口、Session 专用代理鉴权、内部模型配置契约和删除联动，不承载火宝业务表。
- Qunl 新增数据库查询必须继续兼容 SQLite、MySQL 和 PostgreSQL，优先使用现有 GORM 模式，不引入仅 PostgreSQL 可用的 SQL。
- Qunl 业务 JSON 编解码继续使用 `common/json.go` 封装。
- 代理、内部接口和删除联动共享同一套火宝集成配置，不能各自维护地址、开关或密钥。

### 2.6 模型调用身份契约

火宝浏览器请求和火宝服务调用 Qunl 是两条链路，不能混用：

```text
浏览器 --Qunl Session--> Qunl /huobao/* 代理 --签名 user_id--> 火宝
火宝 --内部签名 user_id--> Qunl 模型转发入口 --> 现有 relay/channel --> 上游模型
```

Qunl 来源使用轻量内部入口，不向火宝提供长期 Key。沿用 v1 签名，覆盖版本、`user_id`、方法、实际路径、规范查询串、请求 ID 和时间戳。不新增请求体摘要、重放表或密钥轮换；依赖可信内部网络，不声称防重放。部署必须拒绝公网访问内部路径。

模型列表统一为 `/internal/huobao/models?purpose=text|image|video`，返回 `id`、`purpose`、`protocol`、`enabled` 和可选已知能力；调用路径统一为：

- `/internal/huobao/v1/chat/completions`
- `/internal/huobao/v1/images/generations`、`/internal/huobao/v1/images/edits`
- `/internal/huobao/api/v3/contents/generations/tasks` 及 `/internal/huobao/api/v3/contents/generations/tasks/:id`

Qunl 在现有用户设置中明确绑定火宝使用的现有 Token ID，验证归属、状态和权限。模型列表、生成、查询和取消统一按当前账号及绑定 Token 鉴权；未绑定或失效直接报错，不挑选第一个可用 Token，不增加旧任务鉴权例外。已有视频额外按 `user_id + task_id` 验证归属，复用既有任务服务；配置变化不自动重提任务。入口继续复用 relay、渠道和计费。

用户显式选择 `legacy_private` 时，由只读历史来源读取其已迁移的私有 Key 和 Base URL，复用同一隔离、任务和 Adapter 边界；不自动切换来源，不开放新增凭据页面。

Qunl 同一内部路由组提供签名 `GET /internal/huobao/user-status`，已存在用户返回 `{ "enabled": true|false }`，不存在返回 404，查询异常返回错误，不依赖模型 Token。仅供迁移所有者验证及历史来源每次模型调用前检查，只接受明确的 true；普通 CRUD 不逐次追加状态查询，清理不另建状态核对协议。

## 3. 阶段一：建立测试与配置基础

### 任务 1：补齐火宝测试入口

修改：

- `backend/package.json`
- `backend/package-lock.json`
- 新增 `backend/tests/helpers/`
- 新增 `docker-compose.test.yml`

步骤：

1. 增加统一脚本：`test`、`test:unit`、`test:integration`、`test:structure`。
2. 单元和结构测试使用 Node Test Runner；TypeScript 测试通过 `tsx --test` 执行。
3. 集成测试使用独立 PostgreSQL 数据库，不允许检测不到数据库时静默跳过。
4. 为每次测试生成独立 schema 或数据库名，测试结束清理自己的数据。
5. 将现有 `.mjs` 结构测试纳入统一入口；与新架构冲突的断言说明原因后更新，不放宽断言掩盖越权，删除测试文件须先获用户同意。
6. 生成现有 HTTP 路由、后台任务入口、数据库表、文件写入点和直接数据库导入的基线清单，后续每个条目必须归类为“租户私有、系统共享、内部接口、Web 禁用”之一。
7. 基线至少覆盖 `assetLibrary.ts`、`upload.ts`、`aiConfigs.ts`、`agent.ts`、`prompts.ts`、`skills.ts` 和 `serverUpdate.ts`，不能只检查主要 CRUD 路由。

验证：

```powershell
cd D:\MMMMYYYYHHHH\huobao\backend
npm run typecheck
npm run test:unit
npm run test:structure
```

完成标准：现有测试全部进入统一入口，测试数据库缺失时明确失败。

### 任务 2：建立集中配置模块

新增：

- `backend/src/config/env.ts`
- `backend/tests/config-env.test.ts`

修改：

- `backend/src/index.ts`
- `backend/src/utils/paths.ts`
- 读取端口、目录和密钥的现有模块

步骤：

1. 定义 `AppConfig`，启动时一次性解析并冻结。
2. 区分开发测试配置和正式配置；正式模式禁止空密钥和默认密钥。
3. 业务模块只依赖类型化配置对象，不直接调用 `process.env`。
4. 为数值范围、URL、字节数和时长增加严格校验。
5. 用集中注册表声明 `qunl`、只读 `legacy_private` 来源和支持协议，用户选择记录决定实际来源；未知值失败，不使用全局单一来源开关，不自动回退。
6. 建表前冻结按用途模型列表、选择引用、协议、Token 绑定和内部调用契约，不设计读取 Qunl Key 的接口；历史来源另做明确归属校验。契约未完成不能继续依赖临时字段实施。

测试：覆盖缺失密钥、非法 URL、负数限额、测试配置和正式配置。

## 4. 阶段二：切换 PostgreSQL

### 任务 3：替换数据库驱动和 Schema

修改：

- `backend/package.json`
- `backend/package-lock.json`
- `backend/src/db/index.ts`
- `backend/src/db/schema.ts`
- `backend/src/index.ts`
- `backend/src/services/app-settings.ts`
- `backend/src/utils/dirsize.ts`
- `backend/Dockerfile` 或仓库根 `Dockerfile`
- `docker-compose.yml`

新增：

- `backend/drizzle.config.ts`
- `backend/src/db/migrations/`
- `backend/tests/db/postgres-smoke.test.ts`

步骤：

1. 使用 `pg` 和 `drizzle-orm/node-postgres`，创建有上限的连接池。
2. 将 `sqliteTable` 全部转换为 `pgTable`，保留现有字段语义。
3. 用 Drizzle migration 管理结构，不再启动时执行手写建表 SQL。
4. 将同步 `.get()/.run()`、`lastInsertRowid`、`changes` 改为异步 PostgreSQL 返回值。
5. 移除运行路径中的 `PRAGMA`、SQLite 文件统计和启动自动建表。
6. Docker Compose 增加 PostgreSQL 服务、健康检查和独立数据卷。
7. 火宝容器等待 PostgreSQL 健康后启动；连接失败直接退出。

注意：

- `backend/src/db/sqlite-schema.ts` 和 `backend/src/db/mysql-import.ts` 先停止引用并保留，实际删除前单独征得用户确认。
- 桌面端本次不适配 PostgreSQL，不进入新版 Web 启动链路。

验证：

```powershell
docker compose -f docker-compose.test.yml up -d postgres
cd D:\MMMMYYYYHHHH\huobao\backend
npm run typecheck
npm run test:integration
```

完成标准：空 PostgreSQL 可以通过 migration 启动，现有核心 CRUD 冒烟测试通过，运行时不再打开 SQLite。

### 任务 4：建立多租户数据库约束

修改：

- `backend/src/db/schema.ts`
- `backend/src/db/migrations/`

新增表：

- `user_agent_prompts`
- `user_agent_skills`
- `model_config_refs`（字段见模型简化设计第 5.1 节；`user_id + slot` 唯一，区分来源、用途、协议，Qunl 来源不保存 Key）
- `task_admission_locks`（系统表，每类任务预建一行，只用于短事务准入锁）
- 必要的迁移记录表

步骤：

1. 给设计文档列出的用户表增加非空 `user_id`；迁移清单必须逐表列出并与当前 Schema 自动比对，新增业务表默认判定为用户表，明确标记为系统共享后才能例外。
2. 父表增加 `(user_id, id)` 唯一约束。
3. 子表和关联表增加包含 `user_id` 的复合外键。
4. 用户私有唯一约束全部包含 `user_id`。
5. 列表、详情、任务轮询和配置查询建立以 `user_id` 开头的复合索引。
6. 系统共享表不增加伪造的用户归属字段。
7. `style_presets` 明确采用“系统预设 `user_id IS NULL` + 用户预设带 `user_id`”，分别建立不会互相冲突的唯一约束，查询只返回系统预设与当前用户预设。
8. `app_settings` 主键改为 `(user_id, key)`；旧全局语言只迁给指定所有者，其他用户使用代码默认值。
9. `ai_service_configs` 作为历史私有表增加非空 `user_id` 和 `(user_id, id)` 唯一约束；历史模型引用通过复合外键关联，不能引用其他用户凭据。
10. 任务增加恢复所需用户、请求、模型选择快照、上游 ID、截止时间及 `released_at`。占用统计覆盖各类现有任务表，按 `released_at IS NULL` 判断，不仅按显示状态或单张表统计。

测试：

- 用户 A 的子资源不能引用用户 B 的父资源。
- 用户 A、B 可以创建各自同名的私有配置。
- 删除或软删除父资源时关系行为符合现有业务语义。
- Schema 中每张表都出现在租户分类清单中，不允许出现未分类的新表。

完成标准：绕过 API 直接写入跨用户关系也会被 PostgreSQL 拒绝。

## 5. 阶段三：身份契约和 Qunl 代理

### 任务 5：定义可版本化身份契约

新增：

- `docs/contracts/huobao-identity-v1.md`
- `backend/src/security/qunl-signature.ts`
- `backend/tests/security/qunl-signature.test.ts`
- Qunl 对应签名测试文件

契约字段：

- `X-Qunl-Auth-Version: 1`
- `X-Qunl-User-Id`
- `X-Qunl-Timestamp`
- `X-Qunl-Request-Id`
- `X-Qunl-Signature`

步骤：

1. 明确定义规范字符串、UTF-8 编码、换行符、路径和查询串排序方式。
2. Go 和 TypeScript 使用同一组固定测试向量。
3. 使用常量时间比较签名。
4. 只允许很短的时间误差；不实现重放缓存和密钥轮换。
5. 用户名、角色、Cookie、Token 和请求体摘要不进入 v1 签名。浏览器代理签去前缀路径，模型请求签完整内部路径；签名路径必须等于接收方实际收到的路径。
6. 签名校验模块只负责协议验证，不负责查询用户状态；用户是否存在、是否启用仍由 Qunl Session 层决定。

完成标准：Go 生成的测试签名由 TypeScript 验证通过，反向也通过。

### 任务 6：实现 Qunl Session 专用鉴权和反向代理

新增：

- `D:\MMMMYYYYHHHH\qunl-api\middleware\huobao_auth.go`
- `D:\MMMMYYYYHHHH\qunl-api\middleware\huobao_auth_test.go`
- `D:\MMMMYYYYHHHH\qunl-api\service\huobao_proxy.go`
- `D:\MMMMYYYYHHHH\qunl-api\service\huobao_proxy_test.go`
- `D:\MMMMYYYYHHHH\qunl-api\router\huobao-router.go`
- `D:\MMMMYYYYHHHH\qunl-api\router\huobao_router_test.go`

修改：

- `D:\MMMMYYYYHHHH\qunl-api\router\main.go`
- Qunl 配置初始化位置
- 正式环境 Session Cookie 配置

步骤：

1. 专用中间件直接读取 Qunl Session，并重新查询用户是否存在、是否启用。
2. 不调用现有要求 `New-Api-User` 的 `UserAuth()`。
3. 代理在 Web 静态兜底路由之前注册 `/huobao` 和 `/huobao/*path`。
4. 去掉 `/huobao` 前缀后转发到 `HUOBAO_UPSTREAM_URL`。
5. 转发前删除 Cookie、Authorization、客户端身份头和转发头，再写入可信签名头。
6. 写请求校验 `Origin` 与当前 Qunl 站点一致。
7. 删除火宝响应中的 `Set-Cookie`。
8. 代理配置连接、响应头和整体超时；长耗时生成任务通过异步任务接口完成，不能长期占用代理请求。
9. `HUOBAO_ENABLED=false` 时不注册入口和代理路由。
10. 复用 Qunl 现有限流基础设施，为火宝写请求和任务创建接口增加按用户计数的轻量限流；限流数值进入集中配置。
11. 代理保留火宝返回的私有缓存策略，不得把用户媒体改写为公共缓存。
12. 写请求缺失或带 `null` Origin 时同样拒绝；来源判断使用可信站点配置或受控 Host，不能信任客户端转发头。
13. 部署明确屏蔽对外 `/internal/huobao/*`；本地回环直接测试，正式对外流量经受控入口。不能把公网 Gin 路由命名为 internal 就算完成网络隔离。
14. 代理保留流式输出、断开信号、媒体 Range 和条件请求语义；长任务异步化不等于缓冲文本流。
15. 浏览器代理拒绝去前缀后的 `/internal/*` 和维护路径，不能给浏览器访问清理接口签名；增加绕过路径编码的拒绝测试。用户业务 API/入口 HTML 保留 `private, no-store`。
16. 上传路由在转发和解析前限制实际请求字节，不只相信 `Content-Length`；分块或无长度请求超限同样终止。火宝按相同集中配置设第二层限制。

测试：

- 未登录、禁用用户和伪造头被拒绝。
- 页面、API、媒体路径正确改写。
- Qunl Cookie 不到达测试上游。
- 非同源写请求被拒绝。
- 上游不可用时返回明确的 502。
- 通过 Qunl 代理访问用户媒体时仍然得到 `Cache-Control: private`，达到用户请求限制时返回 429。

### 任务 7：实现火宝认证中间件

新增：

- `backend/src/types/tenant.ts`
- `backend/src/middleware/tenant-auth.ts`
- `backend/src/security/request-context.ts`
- `backend/tests/middleware/tenant-auth.test.ts`

修改：

- `backend/src/index.ts`
- `backend/src/middleware/logger.ts`

步骤：

1. 验证身份协议版本、签名和时间。
2. 构造不可变 `TenantContext { userId, requestId }`。
3. 给 Hono Context 增加类型声明，业务代码通过统一 helper 获取上下文。
4. 缺少上下文时业务接口立即失败，不允许传入默认用户。
5. 健康检查只允许内部访问；业务 API、用户媒体和前端入口均需经过 Qunl。
6. 日志自动带上 `request_id` 和 `user_id`。

完成标准：路由测试不能通过手工请求头绕过签名验证。

## 6. 阶段四：租户数据访问层

### 任务 8：建立领域数据模块和结构约束测试

新增目录：

- `backend/src/data/tenant/`
- `backend/src/data/system/`
- `backend/tests/tenant-boundary-structure.test.mjs`

建议领域模块：

- `dramas.ts`
- `episodes.ts`
- `assets.ts`
- `storyboards.ts`
- `tasks.ts`
- `model-config-refs.ts`
- `agent-customizations.ts`
- `settings.ts`

步骤：

1. 每个公开函数第一个参数是 `TenantContext`。
2. 详情、更新、删除在同一条 SQL 中组合资源 ID 和 `user_id`。
3. 创建子资源时验证父资源属于同一用户。
4. 更新和删除检查受影响行数，零行统一映射为 404。
5. 系统共享 provider、内置预设等放在 `data/system`。
6. 结构测试禁止路由、工具和普通 Service 直接导入数据库；租户/系统数据模块、迁移与测试基础设施，以及明确列出的准入、启动恢复、清理模块可访问数据库。维护模块不能暴露无范围全局 CRUD。
7. 结构测试扫描完整 `backend/src`，新增目录不会自动绕过规则；允许项使用明确文件清单，不使用宽泛目录通配。
8. `scopedWhere`、`scopedValues` 等旧可选过滤不能继续用于用户数据；传入空、缺失或非法租户上下文必须在查询前失败。只读系统数据使用独立函数，不能用共享查询取到用户数据。
9. 关联表同时验证两端用户和父资源关系；批量写入使用字段白名单，不允许请求体覆盖用户 ID、父 ID、资源 ID 或系统字段。
10. 同属一用户不等于允许跨项目关联，继续验证原有项目/剧集关系。内部幂等清理单独测试，已清理不使用普通 CRUD 的零行 404 规则。

不要建立“万能 repository”或自动注入租户条件的隐式 ORM Hook。领域函数显式表达查询条件，更容易审查。

### 任务 9：按领域迁移全部业务路由

修改：

- `backend/src/routes/dramas.ts`
- `backend/src/routes/episodes.ts`
- `backend/src/routes/characters.ts`
- `backend/src/routes/scenes.ts`
- `backend/src/routes/props.ts`
- `backend/src/routes/storyboards.ts`
- `backend/src/routes/tasks.ts`
- `backend/src/routes/merge.ts`
- `backend/src/routes/stylePresets.ts`
- `backend/src/routes/settings.ts`
- `backend/src/routes/storage.ts`
- `backend/src/routes/assetLibrary.ts`
- `backend/src/routes/upload.ts`
- `backend/src/routes/agent.ts`
- 相关 Service

执行顺序：

1. 项目和剧集。
2. 角色、场景、道具和关联表。
3. 分镜和资产。
4. 图片、视频、合并和任务轮询。
5. 设置和用户预设。
6. 资产库、上传、存储统计和所有批量接口。
7. Agent 路由先只改为租户安全的数据入口，具体工具隔离在阶段六完成。

`aiConfigs.ts` 在任务 16 统一替换为模型配置来源接口；`prompts.ts`、`skills.ts` 在任务 13 和任务 14 替换；`serverUpdate.ts` 属于桌面更新能力，在 Web 启动链路中停止注册。每迁移一个领域都增加用户 A/B 越权测试，再禁止旧查询入口被其他模块调用。

完成标准：基线清单中的每个路由和 Service 都已完成分类；租户业务路由、后台任务和 Agent 工具不存在未限定 `user_id` 的用户数据访问函数。

## 7. 阶段五：媒体和文件隔离

### 任务 10：建立 TenantStorage

新增：

- `backend/src/storage/tenant-storage.ts`
- `backend/src/storage/media-response.ts`
- `backend/tests/storage/tenant-storage.test.ts`

修改：

- `backend/src/utils/storage.ts`
- `backend/src/utils/paths.ts`
- `backend/src/routes/upload.ts`
- `backend/src/services/generation.ts`
- `backend/src/services/ffmpeg-merge.ts`
- `backend/src/services/new-api-assets.ts`
- `backend/src/index.ts`

外部 Qunl 素材库不纳入首版必做范围。只有确认火宝生成流程必须直接复用 Qunl 素材组时，才新增 `tenant-asset-library.ts`、`qunl-asset-library.ts` 和对应内部接口；首版先保证火宝自己的用户媒体和工作区隔离。

接口只暴露业务动作，例如：

- `saveGeneratedImage(context, bytes, extension)`
- `saveGeneratedVideo(context, bytes, extension)`
- `resolveMediaForRead(context, relativePath)`
- `deleteTenantMedia(context, relativePath)`
- `getTenantUsage(context)`

步骤：

1. 根目录固定为 `data/users/{userId}/static`。
2. 文件名由服务器生成，数据库只保存用户根目录内相对路径。
3. 统一执行规范化和越界检查，业务模块不能自行 `path.join(DATA_ROOT, userInput)`。
4. 用户媒体改为认证路由，不再全局 `serveStatic(DATA_ROOT)`。
5. 私有媒体统一使用 `Cache-Control: private, no-cache`，先授权再处理条件请求和 Range；同一浏览器切换账号不能读到上一账号缓存。
6. 只有带哈希的公共 Nuxt 构建资源长期公共缓存，入口 HTML 不设 immutable。
7. 单实例文件写入按用户互斥，重新统计当前字节再检查新增大小；未知长度下载逐块限制，同盘临时文件写完再原子发布。启动先处理遗留临时文件，写入失败不标记成功。
8. 首版只处理火宝本地用户媒体；所有生成结果和上传文件必须落在当前用户目录。
9. `NEW_API_ASSET_TOKEN`、`NEW_API_ASSET_GROUP_ID` 不能作为多用户 Web 的全局凭据；需要复用 Qunl 素材库时另行增加用户级接口。
10. 首版停止注册依赖全局 Qunl 素材凭据的路由；不能仅在文档写不做却保留可调用入口。
11. 参考素材校验资产归属后读取字节，图片保留已有 multipart。视频参考图、data URL 兼容性及素材上传接入移到下一阶段设计和实测，不作为本阶段完成前提，也不能称已验证；本阶段不开放未验证的视频参考入口，不发送需 Cookie 的媒体地址、不公开目录、不静默丢素材。
12. 远程结果下载限制目标、字节数和时长，不能任意客户端 URL 下载到服务器；落盘校验成功才标记完成。
13. 文件解析拒绝符号链接/目录联接绕出用户目录。前端账号变化清除用户内存状态，不缓存上一账号业务数据。
14. 请求体和在途上传限制必须先于 multipart/JSON 解析及 `arrayBuffer()`；检查实际字节、单文件大小、文件内容类型和图片像素，不能只依赖后缀或 MIME。业务媒体响应固定允许类型及 `nosniff`，不内联返回 HTML、SVG 或脚本。
15. 将字幕、缩略图、视频海报、FFmpeg 合并及临时文件纳入同一存储限制，不允许第三方库或子进程直接写正式目录。FFmpeg 使用可中止的限长输出流，采用兼容流式写入的封装参数，超限终止且不发布截断文件；验证完整性和浏览器播放后再记成功。

测试：路径穿越、编码路径、绝对路径、跨用户同名文件、切换账号缓存、Range、并发存储额度、下载中断和删除范围；另覆盖超大/分块/并发上传、解码像素、伪造类型、派生文件与 FFmpeg 超限和截断拒绝。首版验证旧全局素材路由已关闭；将来启用用户级素材库时再增加跨用户素材组测试。

## 8. 阶段六：Agent 隔离

### 任务 11：扩展 Agent RequestContext

修改：

- `backend/src/agents/context.ts`
- `backend/src/routes/agent.ts`
- `backend/src/services/extraction.ts`
- `backend/src/services/final-prompt.ts`
- `backend/src/services/video-prompts.ts`

步骤：

1. 增加 `userId`、请求 ID、模型配置 ID 和用户指令快照。
2. 所有 Agent 启动前通过租户数据模块验证 drama、episode 和模型配置关系。
3. 后台 Agent 任务记录创建时写入 `user_id`。
4. Agent 运行期间使用创建任务时的不可变上下文快照，不读取全局当前用户。
5. 任务记录保存恢复执行所需的资源 ID 和配置引用；定时器、轮询回调和 Promise 后台链路必须从任务记录显式重建 `TenantContext`，不能依赖 HTTP 请求对象或进程级“当前用户”。
6. 启动恢复仅查询已有上游 ID 的视频，不重新提交；中断的 Agent/FFmpeg 和没有可查询 ID 的提交明确标记中断或结果未知，不自动重跑。
7. Agent、Prompt/Skill 和模型选择均冻结本次运行快照；用户运行中修改只影响下次任务。迟到回调必须检查终态，不能覆盖取消、超时或再次写结果。

### 任务 12：逐个收紧 Agent 工具

修改：

- `backend/src/agents/tools/script-tools.ts`
- `backend/src/agents/tools/extract-tools.ts`
- `backend/src/agents/tools/storyboard-tools.ts`
- `backend/src/agents/tools/image-prompt-tools.ts`

步骤：

1. 工具只能调用 `data/tenant`，不能直接导入数据库。
2. 工具从 RequestContext 取得 `userId`，不存在立即失败。
3. 保存操作同时限制用户、项目、剧集和资源 ID。
4. 模型返回跨用户或不存在资源 ID 时返回明确工具错误。
5. 增加并发运行用户 A/B Agent 的隔离测试。
6. 测试覆盖请求已经结束后仍继续运行的 Agent 工具，确认后台回调不会丢失或串用租户上下文。

### 任务 13：移除运行时可写 Workspace

修改：

- `backend/src/agents/skills.ts`
- `backend/src/agents/prompts.ts`
- `backend/src/agents/index.ts`
- `backend/src/routes/prompts.ts`
- `backend/src/routes/skills.ts`

步骤：

1. Agent 实例不再挂载带文件读写能力的 Workspace。
2. 内置 Prompt/Skill 从只读仓库文件加载，可在启动时缓存。
3. 用户 Prompt/Skill 从 PostgreSQL 读取并作为纯文本注入。
4. 建立 Agent 类型注册表，集中定义 agent key、内置 Prompt、内置 Skill 和允许工具，新增 Agent 不需要修改多个 switch。
5. 用户内容使用明确分隔和长度限制，最终不可变约束始终最后追加。
6. 注册表启动时校验 Agent key 唯一、Prompt/Skill 文件存在、工具名称有效；校验失败直接停止启动。

删除旧 Workspace 写接口和文件前需要用户确认；在确认前先停止路由注册和运行时引用。

## 9. 阶段七：用户 Prompt、Skill 和模型配置

### 任务 14：实现用户 Prompt/Skill API

新增：

- `backend/src/routes/agent-customizations.ts`
- `backend/src/data/tenant/agent-customizations.ts`
- `backend/src/services/agent-instructions.ts`
- 对应测试

步骤：

1. Prompt 使用 `(user_id, agent_type)` 唯一约束。
2. Skill 支持新增、编辑、启停和排序，ID 使用数据库生成值。
3. Agent 类型必须来自集中注册表，不能接受任意字符串创建未知 Agent。
4. 内容只接受 UTF-8 文本；字符、数量和总长度从集中配置读取。
5. 不接受文件、URL 引用、脚本入口或任意工具定义。
6. 指令合成由单一 `agent-instructions` Service 完成，路由和 Agent 不自行拼接。

### 任务 15：改造火宝设置界面

修改：

- `frontend/app/pages/settings.vue`
- `frontend/app/composables/useApi.ts`
- `frontend/app/locales/*.json`
- 相关组件

步骤：

1. 内置 Prompt/Skill 只读展示。
2. 用户补充 Prompt 与 Skill 单独编辑，明确显示启用状态和字符数。
3. 不提供上传、导入目录、脚本或插件入口。
4. 保存失败时保留用户输入，显示后端明确错误。
5. 页面只调用新的用户配置接口，不再调用文件 Workspace 写接口。

### 任务 16：接入用户模型配置来源

新增：

- `backend/src/services/model-config-source.ts`
- `backend/src/services/qunl-model-config-source.ts`
- `backend/tests/services/model-config-source.test.ts`
- Qunl 现有内部模型入口、按用途列表和明确 Token 绑定及对应测试
- 只读历史私有来源及归属测试

修改：

- `backend/src/routes/aiConfigs.ts`
- `backend/src/data/tenant/model-config-refs.ts`
- `backend/src/agents/index.ts`
- 生成相关 Service

步骤：

1. 定义 `ModelConfigSource.list(context, purpose)` 和 `resolve(context, selectionRef)`；列表只输出安全字段，解析返回仅供服务端使用的类型化调用描述。
2. 注入集中注册的 `qunl` 和只读 `legacy_private` 来源；业务代码不读环境变量、不按来源写分支，失败不自动切换。
3. `model_config_refs` 按 `(user_id, slot)` 保存来源、用途、模型、协议和可选历史配置引用；同一用户可为各类 Agent、图片、视频分别选择。
4. 火宝本地引用按用户查；Qunl 校验用户及其绑定 Token，不把火宝数据库 ID 当作 Qunl 配置 ID。历史配置按用户和引用同时查询。
5. 在 Qunl 现有用户设置和 Token 选择界面提供一个明确绑定，不保存明文 Key；覆盖未绑定、失效、多 Token、跨用户绑定测试，不挑选首个 Token。
6. Qunl 按用途返回 `id`、`purpose`、`protocol`、`enabled` 和已知能力，列表与实际路由权限一致。火宝按协议选 Adapter，不按 `dreamina-*` 前缀切换旧接口。
7. Qunl 来源统一使用第 2.6 节完整内部路径，根地址只在客户端集中管理；不默认附加厂商路径，不取得 Qunl 长期 Key，不重做计费。
8. 历史 Key、Base URL 原值保留，仅所有者显式选择；不擅自迁到 Qunl、不开放新增或修改凭据表单、不返回完整 Key。
9. 模型选择、Agent、图片和视频使用统一来源解析和鉴权；已有视频 GET/DELETE 同样校验当前账号及绑定 Token，并按用户与任务 ID 验证归属。账号不可用或 Token 失效直接报错，不增加特殊收尾通道或自动换来源。
10. 流式文本、工具调用、multipart 参考图、视频提交/轮询和错误透传分别做契约测试；可选字段显式为零或 false 时不能丢失。
11. 设置页改为模型选择，展示所有者的历史配置名称而非密钥；不支持的能力明确展示，不把后端拒绝旧字段当作前端已完成。
12. 增加仅返回账号状态的签名内部接口，在历史来源每次模型请求前调用，包含 Agent 后续步骤和任务查询；账号不可用或状态查询失败就停止调用，不允许旧 Key 绕过 Qunl 账号状态。
13. 测试账号或 Token 失效时模型创建、查询及取消均明确失败，跨用户 GET/DELETE 拒绝；失败不自动重提、不切换来源，也不把本地查询失败显示成上游已终止。

完成标准：替换来源测试实现不需要修改业务代码；跨用户配置引用返回 404；按用途协议、明确 Token 绑定、旧配置保留和三类兼容调用测试通过。真实生成另在最终双用户火宝验收执行，不在每阶段反复消耗付费模型。

## 10. 阶段八：资源限制、日志和账号清理

### 任务 17：实现轻量资源策略

新增：

- `backend/src/policies/resource-limits.ts`
- `backend/src/services/task-admission.ts`
- 对应测试

步骤：

1. 将 Agent、图片、视频、FFmpeg 的用户级和全局上限建模为类型化配置。
2. 各任务类型预建一条 `task_admission_locks` 记录。`READ COMMITTED` 事务先 `SELECT ... FOR UPDATE` 锁定该类型，再统计用户及全局占用并创建任务；达到上限拒绝。锁不覆盖实际执行，不能用普通 count/insert 事务冒充原子准入。
3. 首版只运行一个火宝后端实例，不引入新队列和跨实例任务租约。
4. 每类任务记录开始时间和截止时间；统一执行器负责超时和取消，Agent/HTTP 请求使用 `AbortController`，FFmpeg 子进程必须真正终止。
5. 取消、异常、进程中断和正常完成通过统一状态入口更新，实际本地执行停止才释放占用；迟到回调不能覆盖终态或重复发布结果。
6. 取消先复用 Qunl 已有 DELETE 和 Adapter 能力判断，确认取消或终态才释放。上游不支持或取消结果未知时保留上游 ID 及占用，正常鉴权下查询终态才释放；账号或 Token 失效时停止本轮调用并标记待核对，不另建收尾通道，不把停止轮询写成上游已取消。
7. 提交结果未知或查询超时保留待核对和占用，不自动重提；启动恢复只在正常鉴权下查已有 ID，不重跑 Agent/FFmpeg。恢复有效账号及 Token 后可显式继续原 ID 查询，不自动重新提交。
8. 用户存储限制在实际写入入口调用任务 10 的按用户互斥检查，不仅定义环境变量。
9. 显示为取消/超时但上游未停止的任务仍占用；提供仅运维可用的按用户与任务 ID 核对释放命令，要求先确认上游终止，不新增管理平台、不按超时猜测释放。删号按任务 19 停止本地执行后直接清理，不等待上游终态。
10. 上传在解析前取得用户级及全局许可，结束或中断后释放；字节、图片像素和派生文件限制按任务 10 执行。覆盖全局内存压力入口，不能认为任务并发或磁盘额度已限制上传解析。

测试：并发创建同/不同用户任务不突破用户及全局上限；本地取消停止执行后释放名额，上游视频未终止不提前释放；重启不重复提交，迟到回调不覆盖终态，并发存储写入不超限。

### 任务 18：统一结构化日志

修改：

- `backend/src/middleware/logger.ts`
- `backend/src/utils/task-logger.ts`
- 任务和 Agent Service

步骤：

1. 统一字段：`request_id`、`user_id`、`resource_id`、`task_id`、动作、结果和耗时。
2. 增加日志脱敏测试，禁止 API Key、完整 Prompt、Skill 和请求正文进入日志。
3. 不增加独立审计数据库和日志平台。

### 任务 19：实现 Qunl 用户删除联动

新增：

- 火宝内部清理路由和 Service
- Qunl 调用 Client 和测试

修改：

- Qunl `DeleteUser`、`DeleteSelf`、`ManageUser(action=delete)`
- 火宝租户数据模块和 TenantStorage

步骤：

1. 内部清理接口复用 Qunl 签名，但不注册到普通 `/api/v1` 用户路由。
2. Qunl 三种删除入口共用一个按用户清理服务：先禁用账号并使缓存状态一致，再调用火宝；失败时保持禁用并允许重新调用，不增加清理标记或重新启用互斥。
3. 火宝停止该用户已登记的本地 Agent、HTTP、FFmpeg 和视频轮询；本地尚未停止时返回“稍后重试”，停止后继续清理。不等待上游终态，也不声称上游已取消。
4. 本阶段不处理删号与在途普通 CRUD/上传请求的特殊竞态，不增加用户操作门闩、排他清理许可或普通写入口的二次账号状态检查。
5. 清理先将 `data/users/{userId}` 原子重命名到同一磁盘的内部待删除目录，使媒体立即不可访问；不存在目录视为已完成该步。
6. 再按 `user_id` 在数据库事务中删除租户表数据；共享表和其他用户目录不受影响。
7. 最后删除待删除目录；失败时返回失败，重复调用从待删除目录继续，不需要建立第二套账号状态。
8. 接口幂等：该用户业务数据、正式目录和待删除目录都已不存在时返回成功，即使 Qunl 已完成删号；此时不能重新创建任何记录或目录。
9. 火宝清理成功后 Qunl 才完成既有软删除或硬删除，原有权限校验和其他素材清理继续保留；任何入口不能直接调用模型删除方法跳过该服务。

完成标准：禁用后新请求被 Qunl 拒绝，三种删除入口均按用户停止本地执行并清理，可安全重试且不影响其他用户；不增加删号并发竞态、重新启用联锁或失效 Token 特殊收尾验收。

## 11. 阶段九：Qunl 模块入口

### 任务 20：新增可配置侧栏模块

修改：

- `D:\MMMMYYYYHHHH\qunl-api\web\src\components\layout\SiderBar.jsx`
- `D:\MMMMYYYYHHHH\qunl-api\web\src\hooks\common\useSidebar.js`
- `D:\MMMMYYYYHHHH\qunl-api\web\src\helpers\render.jsx`
- `D:\MMMMYYYYHHHH\qunl-api\web\src\pages\Setting\Operation\SettingsSidebarModulesAdmin.jsx`
- `D:\MMMMYYYYHHHH\qunl-api\web\src\components\settings\personal\cards\NotificationSettings.jsx`
- `D:\MMMMYYYYHHHH\qunl-api\controller\user.go`
- `D:\MMMMYYYYHHHH\qunl-api\web\src\i18n\locales\*.json`

步骤：

1. 在 console 区域增加模块键 `huobao`。
2. 默认配置、管理员全局配置和用户侧栏配置使用同一模块定义，避免三处名单继续漂移。
3. 将侧栏模块元数据抽成集中常量，包含 key、标题、图标、区域、路径和跳转方式。
4. 火宝使用 `Clapperboard` 图标。
5. 使用普通 `<a href="/huobao/">` 完成整页跳转，不进入 React Router。
6. `HUOBAO_ENABLED=false` 时不显示模块。
7. 使用现有 i18n 工具同步各语言文件。

验证：

```powershell
cd D:\MMMMYYYYHHHH\qunl-api\web
bun run i18n:lint
bun run lint
bun run build
```

## 12. 阶段十：旧数据迁移和部署

### 任务 21：实现 SQLite 到 PostgreSQL 迁移命令

新增：

- `backend/scripts/migrate-sqlite-to-postgres.ts`
- `backend/src/migration/legacy-sqlite.ts`
- `backend/tests/migration/legacy-sqlite.test.ts`

步骤：

1. 显式传入 `HUOBAO_MIGRATION_OWNER_USER_ID`，确认 Qunl 用户存在且启用，不硬编码用户或按首个访问者认领。
2. 使用迁移记录状态控制可重复执行。
3. 迁移在火宝业务服务停止或维护模式下独占执行，禁止迁移期间继续写入旧库或媒体目录。
4. 文件先复制到同一文件系统下的临时用户目录，生成包含相对路径、大小和 SHA-256 的清单并逐项校验。
5. PostgreSQL 事务导入业务、设置和历史私有模型配置，补齐用户，校验关系、重置序列，同时写 `database_imported` 标记。旧 Key、Base URL、模型原值保留，不强制迁到 Qunl。
6. 提交后原子发布目录，再写完成状态；迁移 ID、所有者和源 SHA-256 清单固定。重启识别已完成重命名，不重复导入，不覆盖冲突目录。
7. 启动业务服务前再次检查迁移状态、数据库行数和正式媒体目录，状态不完整时拒绝启动。
8. 不删除旧 SQLite 和旧媒体。
9. 任何校验失败都停止，不执行启发式修复。
10. 用测试私有 Key 比对迁移前后值一致，校验归属、协议、行数及文件清单；日志只报告数量、用户和状态，不输出 Key。
11. 旧 Prompt/Skill 只迁移已允许的文本，脚本/附件不进入 Agent。遇到无法按文本表达的依赖明确报错，不自动丢弃后声称迁移成功。
12. 租户迁移固定为已知单用户源到空目标业务库的离线导入；schema 和系统预设可已初始化。目标已有用户业务行、迁移所有者变更或源清单变化则停止，不自行合并或重编号。

### 任务 22：更新部署配置

修改：

- `Dockerfile`
- `docker-compose.yml`
- `docker/entrypoint.sh`
- `.env.example`
- `deploy/` 下当前服务器配置

步骤：

1. 前端构建固定注入 `NUXT_APP_BASE_URL=/huobao/`。
2. 火宝容器不再对公网发布端口，只暴露给 Qunl 所在内部网络。
3. PostgreSQL 使用独立卷和健康检查。
4. 数据卷只保存用户媒体和必要运行文件，不再保存可写 Agent Workspace。
5. 健康检查与业务鉴权分离，但只在内部网络可访问。
6. 补充启动所需环境变量清单，密钥不写入镜像和仓库。
7. 第一阶段部署固定为单个火宝后端实例，并在部署说明中写明水平扩容前必须先实现任务租约和跨实例取消。
8. `HUOBAO_ENABLED` 默认关闭；只有最终自动化和双用户验收全部通过后才开启侧栏和代理入口。
9. 替换当前 development + SQLite 的过渡 Compose；正式 Compose 显式 production、PostgreSQL、迁移就绪与应用健康检查，本地联调同样用 PostgreSQL。
10. 对外入口禁止内部模型、状态和清理路径；Qunl、火宝与数据库在可信内部网络互通。

## 13. 最终验收

### 13.1 自动化验证

火宝：

```powershell
cd D:\MMMMYYYYHHHH\huobao\backend
npm run typecheck
npm run test

cd D:\MMMMYYYYHHHH\huobao\frontend
npm run build
```

Qunl：

```powershell
cd D:\MMMMYYYYHHHH\qunl-api
go test ./middleware ./service ./router ./controller

cd D:\MMMMYYYYHHHH\qunl-api\web
bun run i18n:lint
bun run lint
bun run build
```

另外执行结构检查并核对任务 1 生成的基线清单：所有路由、后台入口、数据库表和文件写入点必须已经分类且有对应测试；存在未分类项时验收失败。

### 13.2 双用户验收

使用用户 A、B 验证：

1. 两个用户从 Qunl 进入火宝，不出现第二次登录。
2. 项目、资产、任务、模型配置、Prompt 和 Skill 完全隔离。
3. 手工替换所有可见资源 ID 均返回 404。
4. 并发运行 Agent 不串用户上下文。
5. 私有媒体不能跨用户读取，响应没有公共缓存头。
6. 达到用户级并发和存储限制时只影响当前用户。
7. Qunl 禁用用户后立即不能访问火宝。
8. Qunl 三种删号入口均先禁用，停止火宝本地执行和轮询后清理该用户数据，可安全重试；账号或 Token 失效统一报错，不增加特殊收尾或删号并发竞态验收。
9. 用户 A、B 经真实 Qunl Session 在火宝分别完成 Agent 工具写入、图片、低成本 Mini 视频创建/轮询、落盘与预览；公网接口直测不能替代。内部用户、模型和任务归属正确。
10. 旧配置原值保留给显式所有者，其他用户无法列出、测试或调用；来源失败不切换。Qunl 多 Token 用户明确绑定，不随机挑选。
11. 文本流式、图片参考图、文生视频、视频下载和 FFmpeg 验收通过；视频参考图另在下一阶段接入和实测，不阻塞本阶段，也不开放未验证入口。并发、存储、重启、取消和超时符合真实资源状态，上传及派生文件不能绕过限制。

### 13.3 浏览器验收

使用桌面和移动视口检查：

- Qunl 侧栏入口显示、隐藏和整页跳转。
- `/huobao/` 刷新和深层路由刷新。
- 设置页 Prompt、Skill 和模型配置。
- 项目、剧集、生成任务和媒体预览。
- 未登录、Session 失效、上游不可用和达到限额时的错误展示。

## 14. 执行顺序和暂停点

严格按以下顺序推进：

1. 测试入口与集中配置。
2. PostgreSQL 驱动、Schema 和复合约束。
3. Qunl 身份契约、代理和火宝认证中间件。
4. 租户数据访问层和全部业务路由。
5. 媒体隔离。
6. Agent 工具隔离。
7. Prompt、Skill 和模型配置。
8. 资源限制、日志和账号清理。
9. Qunl 模块入口。
10. 旧数据迁移、部署和完整验收。

全部阶段与最终验收完成前，不开放真实多用户入口。前六阶段完成不等于可以上线。

以下情况必须停止并暴露问题，不能继续用补丁绕过：

- PostgreSQL Schema 无法表达现有业务关系。
- 存在无法确定归属的旧数据。
- 路由或 Agent 工具无法通过统一租户数据层完成操作。
- Qunl 用户删除与火宝运行任务无法保持一致。
- 双用户越权测试出现任何一项失败。

## 15. 设计要求对照

| 设计要求 | 执行任务 | 验收证据 |
| --- | --- | --- |
| Qunl 统一登录和账号状态 | 5、6、7、19、20 | 未登录、禁用、删除用户测试 |
| PostgreSQL 用户数据隔离 | 3、4、8、9 | Schema 约束测试、双用户越权测试、结构扫描 |
| 用户媒体隔离与旧全局素材入口关闭 | 10 | 路径穿越、跨用户读取、切换账号缓存、Range 与关闭旧入口测试 |
| 共享 Agent 不串用户 | 11、12 | 并发 Agent 与后台回调上下文测试 |
| 内置 Prompt/Skill 只读 | 13、14、15 | Workspace 不可写、用户文本隔离测试 |
| 模型来源、协议、旧 Key 和归属明确 | 2、4、16、21 | 按用途列表、Token 统一鉴权、历史配置原值保留及跨用户引用测试；视频参考图下一阶段验收 |
| 用户与全局资源限制 | 10、17、22 | 并发超发、上传解析与派生输出超限、超时、取消和单实例部署检查 |
| 简易日志和 Qunl 生命周期 | 18、19 | 日志脱敏、禁用访问拦截、三种删号入口按用户清理及重试测试 |
| SQLite 仅作迁移来源 | 3、21 | 运行时无 SQLite、可恢复迁移测试 |

每个任务完成时更新此表对应的测试证据。所有行都有自动化或双用户验收结果后，才允许把 `HUOBAO_ENABLED` 改为开启。

## 16. 当前执行记录

日期：2026-10-17

已完成代码接入（不代表真实上游与完整多租户验收通过）：

本节保留先前执行与测试结果，不将其重写为通过。下述“不再接受本地配置”等表述仅描述当时 Qunl 模式代码，不代表已满足最新历史私有配置保留方案；目标要求见前文及主设计第 21 节。容器运行状态与镜像信息为当时记录，本轮未重新检查。

本轮文档已补齐但代码仍待落实：无上下文默认拒绝、PostgreSQL 约束与迁移、后台身份恢复、明确 Token 绑定与协议列表、历史 Key 私有保留、用户设置/文本定制、真实并发与存储限制、取消/收尾和账号清理。此前公网模型成功记录不能抵消这些缺项。

- Qunl 新增火宝专用模型内部入口，复用现有用户 Token、模型权限、渠道选择和计量链路。
- 火宝文本 Agent 通过 Qunl 内部 `/v1/chat/completions` 调用模型。
- 火宝图片生成通过 Qunl 内部 `/v1/images/generations`、`/v1/images/edits` 调用。
- 火宝火山视频通过 Qunl 内部 `/api/v3/contents/generations/tasks` 及轮询接口调用。
- 火宝正式 Qunl 模式下不再接受或保存本地 API Key、Base URL 和渠道配置；`/ai-configs` 只读返回当前 Qunl 可用模型。
- 图片、视频仍复用原有任务表、适配器、轮询和用户媒体落盘逻辑，没有新增队列或独立模型网关。
- 增加 Qunl 模型请求签名和凭据剥离测试。

验证：

- 火宝单元测试：14/14 通过。
- Qunl `service`、`middleware`、`router` 测试通过。
- Docker 干净依赖环境内完整类型检查通过，单元测试 14 通过、0 失败。
- 结构测试 37 通过、14 失败，完整测试未通过，未改断言绕过。

未完成：

- PostgreSQL 驱动、Schema 和迁移命令尚未替换完成；当前火宝仍禁止带 `DATABASE_URL` 启动。
- Qunl 真实登录、双用户真实浏览器验收、图片/视频真实上游调用和生产部署验收尚未完成。
- 设置页仍有本地 API Key 输入和旧配置操作，与只读 Qunl 接入要求不一致；后端拒绝写入不等于前端已完成。

本地 Docker：

```powershell
cd D:\MMMMYYYYHHHH\huobao
docker compose --env-file .env.local -f docker-compose.local.yml build
docker compose --env-file .env.local -f docker-compose.local.yml up -d --wait
```

本地 Docker 引擎已恢复，镜像 `huobao-drama:local` 已成功构建，容器 `huobao-app-1` 正在运行且健康。

- 当前镜像 ID：`sha256:42b971a16a9e9504b4fa4fa66d9af247729985dbc05e40bf1b29e4143ec673d4`。
- 本地仅监听 `127.0.0.1:5679`，使用独立数据卷 `huobao_huobao-local-data`，需要 `.env.local` 内的代理密钥。
- 该 Compose 明确使用 development + SQLite，仅验收当前镜像运行能力，不是已确认的 PostgreSQL SaaS 交付版本。
- HTTP 检查 16 通过、0 失败；重启持久化 1 通过、0 失败；媒体工具 2 通过、0 失败；浏览器基础检查 4 通过、0 失败。
- 浏览器通过临时回环测试身份代理检查，验收后关闭。该结果不算 Qunl Session / SSO 验收。
- 宿主机 3000 端口没有 Qunl 服务，模型列表请求连接被拒绝，真实模型调用未验收。
- 直接打开业务首页返回 401 是签名保护的预期行为；健康检查为 `http://localhost:5679/api/v1/health`。
- 验收修复了 Windows 入口脚本换行、生产运行依赖缺失、私有图片 Content-Type、存储统计共用缓存和手机导航挤压问题。

结论：本地镜像构建和基础运行验收通过；完整设计验收未通过，仍不得开启真实多用户入口。

### 16.1 公网模型接口实测补充

日期：2026-10-17。用户提供临时测试凭据，Base URL 为 `https://video.chrouter.com/`。凭据未写入仓库、配置文件或文档。

用户最新确认：遗留 API Key 配置视为首个用户的私有配置，不作为系统共享配置。迁移时必须绑定明确的 Qunl 用户 ID，不能根据第一个访问者自动分配。本次仅确认归属规则，未执行遗留配置迁移，也未将测试 Key 设置为所有用户的凭据。

实际公网请求结果：

- `GET /v1/models` 成功，返回 70 个模型。
- `POST /v1/chat/completions` 使用 `gpt-5.6-terra` 成功返回指定文本。
- 同一文本接口的强制工具调用检查成功，返回正确的函数名与 JSON 参数；这属于协议检查，不是火宝 Agent 工具执行验收。
- `POST /v1/images/generations` 使用 `gpt-image-2.5` 成功返回 1 张 base64 图片；未输出图片正文或保存凭据。
- `gpt-5.4-mini` 返回 400，`deepseek-v4-flash` 返回 404，`qwen3.5-flash` 返回 400，`gpt-image-1.5` 返回 404。模型列表不能直接视为可调用能力清单。
- 火山视频查询路径 `/api/v3/contents/generations/tasks/<不存在的测试ID>` 返回 `404 task_not_found`，只确认路径有业务响应，不代表生成成功。
- 首轮仅依据通用模型列表未发现 Seedance，未提交视频任务。该判断不能证明视频模型不可用，已通过下述火山兼容接口实测纠正。

本轮外部检查：4 通过、4 失败；视频生成未执行。没有改动正式模型接入方式。公网 Bearer Key 接口与现有 `/internal/huobao/*` 用户签名接口不是同一契约，不能只替换 Base URL 就视为完成共享登录、用户隔离和火宝业务联调。PostgreSQL、真实 SSO 和完整 Agent 业务验收仍未完成。

### 16.2 火山兼容视频实测纠正

核对 Qunl `router/api-router.go`、`controller/volcengine_video.go`、`service/volcengine_video_routing.go` 以及火山兼容接口使用手册后，使用用户提供的公网测试凭据提交真实任务。

- 创建：`POST https://video.chrouter.com/api/v3/contents/generations/tasks`。
- 查询：`GET https://video.chrouter.com/api/v3/contents/generations/tasks/{id}`。
- 请求使用 `model` + `content`，参数为 `duration=4`、`resolution=480p`、`ratio=16:9`、`generate_audio=false`，没有使用旧 `/v1/video/generations` 入口。
- `doubao-seedance-2-0-260128`：任务 `cgt_6689fcc5da5645e6946997bf9eb12adc` 最终 `succeeded`，返回视频 URL。
- 用户随后指定的便宜模型 `dreamina-seedance-2-0-mini-260615`：任务 `cgt_71a9ce85f23f4483b8f4ffc13829c6a8` 最终 `succeeded`，返回视频 URL，24 FPS。后续真实视频验收优先使用该模型，不重复创建昂贵模型任务。
- 视频真实生成检查：2 通过、0 失败。未保存 Key 或带签名的视频地址到文档。
- 上述记录未包含参考图/data URL 的真实请求验收，不能据此标记视频参考图可用；按最新确认，该项放到下一阶段，不作为本阶段隔离验收前提。
- Mini 视频地址使用 GET 验证返回 HTTP 200、`video/mp4`，长度 684306 字节；仅 HEAD 请求返回 403，不能据此判定 GET 下载或播放失败。未下载视频文件。

纠正结论：通用 `/v1/models` 的枚举结果不能用于断言火山兼容视频模型不可调用。本次两个模型均实际生成成功，具体分组和显示过滤差异仍需结合线上配置判断。

这些结果证明公网 Qunl 视频创建与查询链路可用，不代表火宝内部完整流程已经接通。火宝现有适配器仍按 Dreamina 模型前缀选择旧 `/v1/video/generations`，而 Qunl 火宝内部视频路由仅注册火山 v3 路径；后续统一接入时必须显式匹配接口协议，不能只靠模型前缀推断。

### 16.3 当前执行进度

日期：2026-10-18。历史 16、16.1、16.2 保留，不改写为当前通过。

已完成或已验证：PostgreSQL 租户 CRUD、复合归属约束、媒体隔离和用户级资源限制；文本 Agent、资产提取、批量视频提示词和最终图片提示词共用 Agent 准入；图片参考图只接受本人站内图片，视频参考素材入口关闭；Dreamina 与 Doubao Seedance 使用火山兼容 v3；Mini 模型公网生成成功；视频生成在下载、缩略图/海报和落盘完成后才发布成功；视频制作页六种宽度通过横向越界和生成按钮可达性检查，显式选择 Mini 后请求未携带参考素材字段。

自动化结果：TypeScript 类型检查通过；后端单元 34 通过、0 失败；PostgreSQL 集成 63 通过、0 失败；前端生产构建通过；浏览器本批 15 通过、0 失败。结构测试 52 通过、4 失败，原因是旧断言与当前实现/文件布局冲突：合并是否允许部分镜头、MiniMax 历史残留断言、旧 MySQL schema 文件路径、`routes/aiConfigs.ts` 与 `services/ai.ts` 尚未完全迁移到租户数据层；没有修改断言绕过。

仍未完成，不能开启真实多用户入口：Qunl 真实 Session、侧栏入口和双用户业务联调；模型列表、明确 Token 绑定、历史私有配置和旧 Key 前端收口；取消/超时/任务租约与重启恢复；账号删除联动；SQLite 到 PostgreSQL 的可恢复迁移。`HUOBAO_ENABLED` 继续保持关闭。

### 16.4 当前简化方案执行记录

日期：2026-10-18。按用户最终确认，旧的内部模型入口、Token 绑定、双来源、复杂取消恢复和删号联动不再执行；上述 16 至 16.3 的旧事实保留，仅供追溯。

本轮完成：

- 火宝继续使用 `ai_service_configs`，每个用户的 Key、Base URL、模型、用途和协议按 `user_id` 隔离；API 列表和详情不返回 Key，编辑留空保留原 Key。
- 文本 Agent 的真实 SDK mock 双用户调用通过：用户 1 和 87 的请求分别携带各自 Key，均进入公开 `/v1/chat/completions`，没有内部签名头，没有跨用户回退。
- 图片、Mini 视频、私有媒体目录、任务状态、上传/派生文件限制和 PostgreSQL 租户约束集成测试通过；视频统一走火山 v3，参考素材入口仍关闭。
- 配置用途/协议集中规则、行锁内最终组合校验、被剧集引用配置不可删除或改用途已补回归；显式配置失效直接失败。
- Qunl 启动不再调用旧自动选 Token 模型路由；新增路由测试确认 `/internal/huobao/*` 不注册，Session 代理和公开模型路由仍存在。
- 重启处理将本地 processing 任务标记失败，保留上游 ID，不轮询、不重提。Agent 请求的 fetch 也拒绝重定向。
- 设置页浏览器检查通过：新建配置不回显 Key；编辑 Key 输入框为空，留空保存不发送 `api_key`，原 Key 仍保留；模型选择按配置 ID 区分。
- 设计和执行计划已补充“当前简化方案”作为唯一执行依据，历史复杂章节明确标注为追溯内容。

本轮验证：后端类型检查通过；单元测试 34/34 通过；PostgreSQL 集成测试 69/69 通过；模型配置隔离测试 7/7 通过；前端生产构建通过；Qunl `router/service/middleware` Go 测试通过；浏览器配置新增和编辑留空保留 Key 检查通过，当时尚未完成启停、删除和双用户浏览器检查；结构测试 56/56 通过。结构检查已按当前规则确认：合并允许已有镜头先合并，MiniMax 代码保留为可选视频提供方但不进入快捷默认配置，Web 使用 PostgreSQL 初始化和租户约束。Docker 引擎未运行，本轮未更新镜像。

仍未完成：真实 Qunl Session、侧栏入口、旧数据/root 配置迁移、生产 PostgreSQL Compose 和真实双用户端到端验收。`HUOBAO_ENABLED` 继续关闭，不能称为完整 SaaS 上线。

### 16.5 本地 Session、浏览器与容器验收

日期：2026-10-19。详细环境与复现入口见 `docs/2026-10-19-huobao-local-acceptance.md`。

本轮未改业务行为，补充了独立测试准备、正常 Session 业务检查、模型模拟上游和容器持久化检查。Qunl 使用新建本地测试库及合成账号 `acceptance1`、`acceptance87`，ID 分别为 1、87；它们不是正式 root/87 账号的登录凭据或数据副本。

| 验证范围 | 通过 | 失败 |
| --- | ---: | ---: |
| 全量 PostgreSQL 集成测试 | 70 | 0 |
| 镜像内单元测试 | 34 | 0 |
| 正常 Qunl Session 与双用户 HTTP 业务隔离 | 33 | 0 |
| Session 到容器的 Agent、图片、Mini 视频模拟上游 | 13 | 0 |
| 浏览器桌面、手机、双账号及容器页面复查 | 30 | 0 |
| PostgreSQL Compose 应用基础检查 | 16 | 0 |
| 容器身份、内置文件只读、媒体工具和重启持久化 | 4 | 0 |

另外，两端前端构建、Qunl 完整编译、镜像内后端类型检查、Compose 配置校验通过。结构测试本轮未重跑，上一批结果为 56 通过、0 失败，不混入本轮数量。

Qunl 密码登录与侧栏整页进入火宝、退出后拒绝访问已用浏览器验证。项目、配置、Prompt、Skill、图片/视频任务与媒体均检查本人访问及跨用户拒绝；设置页新增、编辑空 Key、启停、删除、内置文本只读及手机页面已完成。模型测试通过真实 Agent SDK 和工具保存剧本、公开协议请求、任务创建/轮询、FFmpeg 派生、落盘和媒体读取，但上游响应由本地测试服务生成，没有调用付费模型。

最新镜像：`huobao-drama:acceptance-20261019`，镜像 ID `sha256:69f0ef02dbc3c87a879165769caf9572e734b3d088c213910a6b3b022261ef6e`。独立 Compose 项目为 `huobao-acceptance-20261019`，应用端口 `127.0.0.1:15681`，PostgreSQL 17 只在 Compose 网络提供服务；数据库和用户媒体使用独立卷。应用以 `node` 用户运行，内置 Prompt 文件不可写。按计划重启数据库和应用后，记录数量、用户媒体文件摘要及本人项目响应保持一致。

测试 Qunl 当前监听 `127.0.0.1:3300`，代理到上述应用容器。本轮解决了本机旧容器自动启动与测试端口冲突，未将访问旧容器时的 401 当作新版本缺陷。宿主机后端测试端口为 `15680`，最终代理使用容器 `15681`。

本地隔离及部署验收通过；正式数据/root 旧 Key 迁移、正式用户登录与真实付费模型完整业务验收仍未执行。测试账号结果不能替代这些事项，正式入口继续关闭。
