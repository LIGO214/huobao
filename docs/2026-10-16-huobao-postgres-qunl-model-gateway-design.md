# 火宝 PostgreSQL 与 Qunl 模型调用打通设计

日期：2026-10-16

状态：历史设计稿，已由 `2026-10-16-huobao-qunl-agent-model-simple-design.md` 简化版替代，不再作为执行依据。

说明：本稿曾经把模型网关、计费上下文、幂等请求和媒体服务间读取设计得过重，现仅保留历史追溯。当前确认的范围是：火宝保留原有用户模型配置，按用户隔离后使用各自 Key、Base URL、模型和协议调用 Qunl 公开兼容接口；不建设内部模型入口、Token 绑定、双来源、计费或复杂任务恢复。后续实施只以简化设计和执行计划第 0 节为准。

关联文档：

- `docs/2026-10-16-huobao-qunl-multi-tenant-design.md`
- `docs/2026-10-16-huobao-qunl-multi-tenant-implementation-plan.md`

## 1. 目标

本阶段只解决两个高风险基础问题：

1. 火宝正式 Web 运行使用 PostgreSQL，不再把 SQLite 作为多用户正式数据库。
2. 火宝不再保存或直接调用用户的模型 API Key，而是复用 Qunl 已有的用户模型权限、分组、渠道选择、额度和 relay 调用链。

最终效果：

```text
浏览器
  -> Qunl 登录态
  -> Qunl /huobao/* 代理
  -> 火宝租户业务与任务
  -> Qunl 内部模型网关（带当前 user_id）
  -> Qunl 现有 relay / 渠道 / 计费
  -> 上游模型服务
```

火宝仍然负责剧本、资产、分镜、任务和媒体文件；Qunl 负责账号、模型可用性、模型调用和模型侧计费。

## 2. 非目标

本阶段不做：

- 不把火宝业务表迁入 Qunl Go 服务。
- 不复制 Qunl 用户表、密码、Token 或完整 API Key。
- 不在火宝重新实现一套渠道选择、分组权限、额度扣减和渠道故障切换。
- 不允许浏览器直接拿到 Qunl 模型密钥。
- 不建设消息队列、独立模型 Worker 或复杂的计费系统。
- 不处理域名、证书和公网部署。
- 不删除旧 SQLite、旧媒体目录或旧模型配置数据。

## 3. 关键决策

### 3.1 模型调用走 Qunl，不走用户直连

火宝以前的 `ai_service_configs` 是“每个用户自己填 provider、Base URL、API Key”。Web 多租户版本不再把它作为可用配置来源。

这里的“用户配置模型”指用户在 Qunl 当前账号权限范围内选择可用模型，不表示普通用户可以在火宝里创建 Qunl 渠道或查看渠道密钥。Qunl 现有的渠道、分组和密钥仍由 Qunl 侧管理；如果以后要支持用户自己的上游凭据，也必须先在 Qunl 侧形成正式能力，再由本接口读取，不能绕过 Qunl 放进火宝。

火宝只保存：

- 当前用户选择的 Qunl 模型引用；
- 用途（text、image、video）；
- 可选的本地显示快照；
- 任务创建时使用的模型名和 Qunl 请求 ID。

真正的 API Key、渠道、分组、模型限制、额度扣减和上游请求都留在 Qunl。

### 3.2 Qunl 提供火宝专用内部模型网关

不让火宝伪造浏览器请求，也不把 Qunl Session Cookie 转发给火宝。Qunl 新增一组仅供火宝服务访问的内部接口，接口由 Qunl 和火宝共享的独立密钥签名。

内部接口按“用户 + 请求”确定调用者：

- Qunl 代理层确认 Session 用户；
- 火宝收到签名身份后建立租户上下文；
- 火宝调用 Qunl 模型网关时，使用服务间签名携带同一个 `user_id`；
- Qunl 内部网关重新查询该用户的实时状态和可用模型，再进入现有 relay。

Qunl 不信任火宝提交的模型权限、分组或额度字段，只信任签名中的用户 ID 和请求内容。

### 3.3 统一入口，业务层不感知来源

火宝保留 `ModelConfigSource` 抽象，但首版只实现 `QunlModelConfigSource`：

```text
ModelConfigSource
  listTextModels(context)
  listImageModels(context)
  listVideoModels(context)
  resolve(context, modelRef, purpose)
  chat(context, request)
  generateImage(context, request)
  submitVideo(context, request)
  pollVideo(context, taskRef)
  cancelVideo(context, taskRef)
```

Agent、图片生成和视频生成只依赖这个接口，不直接拼接 Qunl URL，也不读取环境变量中的 API Key。

### 3.4 与 Qunl 现有接口的关系

内部模型网关不是第二套模型平台，也不是复制公开 API 的业务逻辑。它只做三件事：

1. 验证火宝服务身份和当前 `user_id`。
2. 把请求转换成 Qunl 已支持的 relay 输入。
3. 把 Qunl 现有的模型列表、流式响应、错误和 usage 转回火宝。

Qunl 现有公开 `/v1/*` 接口主要依赖用户 Token，不能直接用于火宝的 Session 代理链路；因此增加内部适配入口，但底层继续调用现有用户模型过滤、渠道选择、relay 和计费代码。内部入口不得自行读取 `channels.key` 或另建渠道选择算法。

实现前必须先验证一条最小“按用户调用并扣费”的 relay 链路。如果现有 relay 只能依赖 Token ID、Token 分组或 Token 额度，内部网关不能直接上线，必须先把用户级计费上下文下沉到 service 层，并补齐一次请求只扣一次费的测试。这个验证是模型网关的前置门槛，不是上线后再补的优化。

## 4. 身份与服务间签名

### 4.1 两条链路

用户浏览器到火宝：

```text
浏览器 Cookie
  -> Qunl Session 校验
  -> Qunl 签名头
  -> 火宝
```

火宝到 Qunl 模型网关：

```text
火宝租户上下文
  -> Qunl 内部签名头
  -> Qunl 模型网关
```

两条链路使用独立密钥，不能复用 Session Secret，也不能把浏览器 Cookie、Authorization 或 `New-Api-User` 转发到火宝或模型网关。

### 4.2 签名内容

首版沿用现有火宝代理签名格式，签名覆盖：

- 协议版本；
- 用户 ID；
- HTTP 方法；
- 规范化路径；
- 查询字符串；
- 请求体 SHA-256；
- 时间戳；
- 请求 ID。

规范化字符串必须由双方共用一个实现规则，避免路径编码、空查询串和 JSON 空格造成签名不一致。

首版保持逻辑轻量：

- 时间戳只允许短时间误差；
- 请求 ID 用于日志串联；
- 暂不引入复杂密钥中心；
- Qunl 和火宝只配置一个独立服务密钥；
- 服务只监听内部地址。

如果后续需要防止同一请求重放，再增加短期 `request_id` 去重表，不在本阶段预留复杂协议。

### 4.3 Qunl 对内部请求的校验

Qunl 模型网关必须：

1. 校验签名、时间戳、方法、路径和请求体摘要。
2. 查询 `user_id` 对应用户是否存在、是否启用。
3. 不读取或接受火宝传入的 `Authorization`、`New-Api-User`、Cookie、渠道密钥和额度字段。
4. 对模型名重新执行 Qunl 当前用户的模型可用性检查。
5. 将用户身份写入 Gin Context，再调用现有 relay 服务。
6. 返回统一的 OpenAI 兼容错误结构或视频任务错误结构。

内部接口不是普通用户 API，不出现在公开文档和前端路由中。

## 5. Qunl 内部模型网关契约

路径前缀建议使用：

```text
/internal/huobao/models
/internal/huobao/chat/completions
/internal/huobao/images/generations
/internal/huobao/videos
/internal/huobao/videos/{task_id}
/internal/huobao/videos/{task_id}/cancel
```

最终路径名集中定义在 Qunl 和火宝各自的客户端常量中，不在业务代码中散落字符串。

### 5.1 用户可用模型列表

```http
GET /internal/huobao/models?purpose=text
X-Huobao-User-Id: 123
X-Huobao-Timestamp: ...
X-Huobao-Request-Id: ...
X-Huobao-Signature: ...
```

响应只返回用户可以实际调用的模型，不返回 API Key、渠道密钥、内部渠道 ID 或上游 Base URL：

```json
{
  "object": "list",
  "data": [
    {
      "id": "模型名称",
      "purpose": "text",
      "owned_by": "qunl",
      "supported_endpoints": ["chat.completions"],
      "context_window": null
    }
  ]
}
```

模型列表来源必须复用 Qunl 现有用户模型逻辑，而不是新增一套“火宝模型名单”。如果用户没有可用模型，返回空列表并让火宝明确提示“请先在 Qunl 配置或开通模型”。

列表可以短时间内存缓存，但缓存键必须包含 `user_id + purpose`，配置变更后不能继续使用其他用户的结果。首版可以不做缓存，优先保证行为正确。

### 5.2 文本与 Agent 调用

火宝向 Qunl 提交 OpenAI 兼容请求：

```json
{
  "model": "用户选择的模型",
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 16384,
  "metadata": {
    "source": "huobao",
    "purpose": "agent",
    "huobao_task_id": "..."
  }
}
```

约束：

- `model` 必须由 Qunl 再校验，不能因为火宝缓存过就直接放行。
- `stream` 由火宝按 Agent SDK 需要设置。
- 流式请求必须透传 `Content-Type`、状态码、chunk 和客户端断开信号；Qunl 不能先把完整结果缓存后再返回。
- `metadata` 只用于链路日志和账单归因，不参与权限判断。
- Qunl 不接受火宝指定渠道、Key、分组或扣费价格。
- 请求体不写入普通日志；只记录请求 ID、用户 ID、模型名、结果和耗时。

Qunl 保持现有 relay 的流式格式、错误格式和 Token 统计。火宝只负责把响应转换为 Agent SDK 或自身服务需要的结果。

### 5.3 图片调用

首版统一采用 Qunl 现有图片 relay 支持的请求格式。火宝只发送：

- model；
- prompt；
- size、quality、aspect ratio 等模型允许的参数；
- 火宝内部媒体引用（`asset_id`、类型、摘要和一次性服务间读取凭证）；
- 链路 metadata。

如果当前 Qunl relay 尚未支持某种图片参数或参考素材格式，内部接口必须按能力明确返回 `400`，不能在火宝里偷偷直连其他厂商，也不能把“已展示的模型”误报成“所有参数都可用”。模型列表可附带能力字段，火宝据此决定是否显示对应控件。

Qunl 负责：

- 校验模型是否支持图片端点；
- 使用用户可用渠道完成调用；
- 扣减用户额度；
- 返回图片 URL 或 base64；
- 返回上游 request ID 和 usage。

火宝收到结果后立即把远程媒体下载到当前用户目录，再把数据库记录写成用户私有相对路径。不能把 Qunl 上游 URL 直接当成永久用户资产，也不能把跨用户可访问的上游 URL 写入数据库。

Qunl 不直接请求浏览器可见的火宝媒体 URL，也不接受任意外部 URL。需要参考素材时，由 Qunl 使用服务间签名调用火宝内部媒体读取接口，接口同时校验 `user_id + asset_id`，只返回该用户的文件流；读取凭证短时有效、只允许指定用途，失败时不回退到公网 URL。

媒体读取接口只允许内部网络访问，例如：

```http
GET /internal/huobao/media/{asset_id}
X-Huobao-User-Id: 123
X-Huobao-Request-Id: ...
X-Huobao-Signature: ...
X-Huobao-Asset-Purpose: model-reference
```

火宝按当前用户和 `asset_id` 查询数据库，再从用户私有目录读取文件；响应使用 `Cache-Control: no-store`，不暴露服务器绝对路径。Qunl 不把这个地址返回浏览器或上游模型。

### 5.4 视频调用

视频继续使用异步任务：

```http
POST /internal/huobao/videos
```

请求携带模型、提示词、参考素材和视频参数，并必须带火宝任务生成的幂等键。Qunl 返回：

```json
{
  "task_id": "qunl-task-id",
  "status": "queued",
  "model": "模型名称",
  "request_id": "..."
}
```

火宝自己的 `sys_task` 保存：

- `user_id`；
- Qunl `task_id`；
- 模型引用和用途；
- 当前状态；
- 创建时间、截止时间；
- 失败阶段和简短错误；
- 不保存 API Key。

视频模型和参数以 Qunl 当前 relay 支持范围为准。火宝可以保留自己的任务表和轮询页面，但不复制 Qunl 的渠道任务状态机；Qunl 返回不支持的模型或参数时，火宝直接把任务置为失败并展示明确原因。

视频提交、图片提交和需要产生外部副作用的文本请求都必须携带 `Idempotency-Key`。Qunl 在短期窗口内按 `user_id + Idempotency-Key` 去重，并在同一个 POST 重试时返回原始响应（图片结果或视频任务 ID）；火宝网络超时后只能重放同一个幂等键，不能换新键重新提交。若首版暂不实现 Qunl 去重，火宝必须禁止提交后的自动重试，并把“结果未知”保留为人工处理状态。

轮询和取消必须继续通过 Qunl 内部接口，并再次校验 `user_id + qunl_task_id`。不能只凭 Qunl task ID 查询。

视频完成后，火宝服务端下载结果到当前用户目录，下载成功后才把分镜或任务标记为可用。下载失败不能把远程 URL 当作已完成资产。

## 6. Qunl relay 接入方式

### 6.1 复用已有服务，而不是复制请求逻辑

内部模型网关应在 Qunl 中薄薄包一层，核心调用复用现有：

- 用户模型列表；
- Token/用户分组模型过滤；
- 渠道选择；
- relay 适配器；
- 额度扣减；
- usage 和日志记录；
- 上游错误归一化。

不要在新接口里重新实现“按用户找渠道”或直接读取 `channels.key`。这样能避免火宝通道和 Qunl 通道出现两套行为。

### 6.2 内部用户上下文

由于现有公开 relay 主要由 `TokenAuth` 建立 Token 上下文，内部网关需要提供一个明确的“服务调用上下文构建函数”，输入只有：

- 已验证的 `user_id`；
- 请求类型；
- 模型名；
- 请求 ID；
- 必要的来源标记。

该函数负责重新加载用户状态和用户可用分组，然后调用既有 relay service。不能伪造一个浏览器 Token，也不能把火宝的数据库 ID 当成 Qunl Token ID。

如果现有 relay 的某个入口只能从 Token 上下文取额度，优先把“按用户扣减额度”的能力下沉到 service 层，再由公开 Token 入口和内部火宝入口共同调用。不要为每个用户偷偷创建一个可见 Token，也不要把同一个系统 Token 作为所有用户的计费身份。实现必须明确火宝请求使用哪一种 Qunl 用户余额来源，并验证预扣、结算、失败退款不会同时扣用户余额和 Token 余额。

### 6.3 计费归属

所有模型消耗归属 Qunl 用户：

- `user_id` 使用 Qunl 用户 ID；
- 来源标记写为 `huobao`；
- `huobao_task_id` 和请求 ID 写入 usage metadata；
- 火宝不维护第二套模型余额；
- Qunl 余额不足时直接返回明确错误，火宝任务进入失败终态。

首版具体采用“用户账户余额 + 用户当前分组”：

- 内部请求不创建隐藏 Token，计费上下文使用 `token_id=0` 或等价的无 Token 用户上下文；
- 模型列表和模型权限沿用 Qunl 当前用户分组、用户模型可见性和自定义模型限制；
- 不继承某个浏览器 Token 的 Token 分组、Token 模型白名单或 Token 独立额度；
- usage 日志保留 `user_id`、`source=huobao`、请求 ID 和火宝任务 ID，Token 字段为空或使用明确的内部来源标记；
- 预扣、结算、退款只允许走一条用户余额路径，不能同时扣用户余额和 Token 余额。

火宝日志只记录汇总字段，不记录完整 prompt、API Key 或完整上游请求正文。

## 7. 火宝模型配置改造设计

### 7.1 逻辑模型

火宝 UI 不再展示“API Key、Base URL、Provider 配置表单”。改为：

- 文本模型；
- 图片模型；
- 视频模型；
- 当前默认模型；
- 可选的任务级模型选择；
- “从 Qunl 获取可用模型”。

用户仍然可以自己选择模型，但选择动作发生在 Qunl 账号权限范围内；火宝只读取和选择 Qunl 已授权的模型。当前 Qunl 没有面向普通用户的渠道密钥编辑能力时，火宝不新增这一层表单。

### 7.2 本地表调整

`ai_service_configs` 不再作为正式调用配置。建议新增或保留轻量引用表：

```text
model_config_refs
  id
  user_id
  purpose              -- text | image | video
  model_name
  provider_snapshot    -- 可空，仅用于显示
  display_name         -- 可空
  is_default
  created_at
  updated_at
```

约束：

- `(user_id, purpose, model_name)` 唯一；
- 每个 `(user_id, purpose)` 最多一个默认项；
- 不保存 API Key、Base URL、完整 Qunl 渠道信息；
- 读取必须包含 `user_id`；
- Qunl 已禁用或删除模型时，火宝下一次解析失败，不使用旧快照继续调用。

若实际使用场景只需要一个默认模型，可以先不建引用表，直接在用户设置中保存模型名；但接口仍通过 `ModelConfigSource.resolve()` 校验，不允许把裸字符串直接交给生成服务。为后续扩展任务级配置，首选引用表方案。

### 7.3 兼容现有业务接口

现有火宝接口可以暂时保留路径，改变内部语义：

```text
GET /ai-configs              -> Qunl 可用模型列表 + 当前用户选择
POST /ai-configs/test        -> Qunl 模型连通性/权限测试
POST /ai-configs             -> 保存模型引用，不保存密钥
PUT /ai-configs/:id          -> 修改模型引用和用途
DELETE /ai-configs/:id       -> 删除本地选择
```

前端不需要一次性重写所有页面，但旧字段：

- `api_key`
- `base_url`
- `provider` 中的私有密钥信息

不再接受或返回。旧请求应返回明确的参数错误，不能静默把密钥写入新表。

## 8. PostgreSQL 数据库设计

### 8.1 运行边界

- 本地联调可以继续使用 SQLite；
- 任何多用户测试必须使用 PostgreSQL；
- 正式 Web 模式强制要求 `DATABASE_URL`；
- 火宝启动时检测到正式配置仍指向 SQLite，直接停止；
- 不等线上出现 SQLite 锁等待后再迁移。

### 8.2 Schema 要求

PostgreSQL Schema 必须满足：

- 用户业务表的 `user_id` 非空；
- 父表建立 `(user_id, id)` 唯一约束；
- 子表使用 `(user_id, parent_id)` 复合外键；
- 关联表两端都验证属于同一用户；
- 用户私有名称唯一约束改为包含 `user_id`；
- 常用查询建立 `(user_id, ...)` 复合索引；
- 任务、模型引用、Prompt、Skill 和媒体元数据都带 `user_id`。

不能只依赖 TypeScript 查询约定。数据库约束是最后一道边界，应用层仍必须显式带 `user_id`。

### 8.3 Drizzle 迁移

迁移分为四类：

1. 建立 PostgreSQL 表和索引；
2. 补齐 `user_id` 并检查空值；
3. 添加复合唯一约束和外键；
4. 删除或停用旧的全局唯一约束。

每一步都要有独立迁移文件，禁止把整库重建和业务数据迁移混在一个不可恢复脚本中。

### 8.4 SQLite 到 PostgreSQL 迁移

迁移命令必须显式指定唯一归属用户 `HUOBAO_MIGRATION_OWNER_USER_ID`，因为旧单机 SQLite 无法推断历史数据属于哪个 Qunl 用户。

顺序：

1. 停止火宝写入并进入维护模式；
2. 校验旧 SQLite 备份、表清单和行数；
3. 把旧媒体复制到临时用户目录；
4. 生成文件数量、大小和 SHA-256 清单；
5. PostgreSQL 事务导入行并补上归属用户；
6. 校验父子关系、唯一约束和行数；
7. 原子重命名临时媒体目录；
8. 写入迁移完成状态；
9. 保留旧 SQLite 和旧媒体，不自动删除。

任一步失败都停止并报告，不做猜测式归属、不自动丢弃坏数据、不静默跳过行。

## 9. 错误和状态约定

### 9.1 Qunl 模型网关错误

至少区分：

- `401`：内部签名无效；
- `403`：用户被禁用或模型无权使用；
- `404`：模型或 Qunl 任务不属于当前用户；
- `409`：任务状态冲突；
- `429`：用户额度、Qunl 限流或渠道并发限制；
- `502`：上游模型服务失败；
- `504`：上游超时。

响应中返回可展示的简短 message、`request_id` 和必要的 `code`。不返回 API Key、渠道地址和内部数据库信息。

### 9.2 火宝任务状态

火宝任务只保留统一状态：

```text
queued -> running -> completed
                 \-> failed
                 \-> cancelled
                 \-> timeout
```

Qunl 的上游状态映射到这组状态。重复轮询、重复取消和重复终态更新必须幂等。

模型配置失效时：

- 新任务立即失败；
- 已经提交到 Qunl 的任务继续按 Qunl task ID 轮询；
- 不再创建新的上游任务；
- 不回退到火宝旧 `ai_service_configs`；
- 不自动切换到其他用户或系统默认模型。

## 10. 关键安全边界

- 火宝不接收浏览器传入的 Qunl Cookie。
- Qunl 代理删除客户端伪造的身份头，再注入可信签名。
- 火宝到 Qunl 模型网关使用独立服务签名。
- 模型网关按 `user_id` 实时检查用户和模型权限。
- 火宝不保存完整 API Key，不把密钥返回前端，不写入日志。
- Qunl 不信任火宝提交的渠道、分组、价格和额度字段。
- 任务轮询和取消必须同时带用户归属。
- 图片和视频结果先落到当前用户媒体目录，再写完成状态。
- 私有媒体使用 `Cache-Control: private`；会变化或敏感内容使用 `private, no-cache`。
- Qunl 内部模型路由只注册在内部网络路由组，不经过浏览器可访问的 `/huobao/*` 代理和 Web 兜底路由。

用户被 Qunl 禁用后，禁止新模型请求；已提交的后台任务由受信任的内部清理/轮询流程继续查询或取消，但普通用户读取结果仍然拒绝。这样不会因为账号禁用而遗留无法回收的上游任务。

## 11. 实施顺序

### 阶段一：冻结契约，不改业务行为

产出：

- Qunl 内部模型网关请求/响应类型；
- 火宝 `ModelConfigSource` 接口；
- 服务间签名规范；
- 流式响应、媒体读取和幂等键契约；
- PostgreSQL 表关系和迁移清单；
- 错误码和任务状态映射表。

验收：契约测试可在没有真实上游 Key 的情况下运行。

### 阶段二：PostgreSQL 基础

产出：

- PostgreSQL Drizzle Schema；
- 迁移目录；
- 复合约束、索引和约束测试；
- SQLite 迁移命令设计和演练脚本。

验收：双用户数据隔离测试通过；正式配置不再启动 SQLite。

### 阶段三：Qunl 内部模型网关

产出：

- Qunl 内部用户模型列表；
- 文本流式调用；
- 图片调用；
- 视频提交、轮询和取消；
- 幂等提交和媒体读取接口；
- Qunl usage 归因和错误映射。

验收：同一用户通过 Qunl 控制台和火宝调用同一模型时，权限、分组、额度和错误行为一致；超时重试不会重复提交或重复扣费。

### 阶段四：火宝模型来源替换

产出：

- `QunlModelConfigSource`；
- 本地模型引用表；
- Agent、图片、视频统一走来源接口；
- 设置页改成“选择 Qunl 模型”，不再填写 API Key。

验收：替换模型来源实现时，Agent、图片和视频业务代码无需修改。

### 阶段五：迁移和双用户验收

产出：

- SQLite 到 PostgreSQL 可恢复迁移；
- 旧配置只读兼容或明确停用；
- 双用户模型权限和资产隔离测试；
- 上游不可用、额度不足、模型撤销和用户禁用测试。

在这一阶段完成前，不开启真实多用户流量。

## 12. 测试清单

### Qunl

- 内部签名错误、过期、路径不一致、请求体摘要不一致；
- 用户禁用后模型列表和调用均拒绝；
- 用户 A 不能读取或轮询用户 B 的模型任务；
- 模型不在用户分组中时返回 403；
- Qunl 余额不足时返回稳定错误；
- 流式文本响应不丢 chunk、不把错误混入正常内容；
- 网络超时重试不会重复创建图片/视频任务或重复扣费；
- Qunl 只能通过服务间凭证读取当前用户的火宝参考媒体；
- 图片结果和视频任务都带 `user_id + source=huobao` 归因；
- API Key、Cookie 和完整 prompt 不进入日志。

### 火宝

- `ModelConfigSource` 只返回当前用户可用模型；
- 用户 A 的模型引用不能被用户 B 解析；
- Agent、图片和视频都不再读取本地 API Key；
- Qunl 返回 401/403/404/429/502/504 时任务状态正确；
- 图片和视频下载失败不会标记完成；
- Qunl 模型被删除或禁用后下一次解析立即失败；
- 任务轮询和取消带上当前 `user_id`；
- Qunl 返回结果未知时，火宝不会盲目重复提交；
- PostgreSQL 复合外键阻止跨用户关联；
- PostgreSQL 并发写入不出现 SQLite 锁等待语义。

### 浏览器

- 设置页只能选择 Qunl 可用模型；
- 模型列表为空时有明确提示；
- 模型被禁用后页面显示可理解错误；
- Agent 生成、图片生成和视频生成使用同一账号和同一 Qunl 额度；
- 刷新页面和深层路由不会要求第二次登录。

## 13. 完成标准

满足以下条件才算本阶段完成：

1. 火宝正式 Web 模式只使用 PostgreSQL。
2. 火宝没有可用的本地 API Key 配置路径。
3. 文本、图片、视频和 Agent 调用都经过 Qunl 内部模型网关。
4. Qunl 按自身规则完成用户模型权限和额度判断。
5. 火宝和 Qunl 的请求都能用 `request_id + user_id + task_id` 串联。
6. 双用户不能互读模型配置、任务、媒体或生成结果。
7. SQLite 历史数据可以按指定用户可恢复迁移，失败不破坏旧数据。
8. 图片、视频和 Agent 的副作用请求具备幂等或明确的“结果未知”状态。
9. 所有关键契约和越权测试通过后，才允许打开真实多用户访问。

## 14. 本轮审查结论

设计方向可以执行，且没有重新引入独立注册、独立密钥管理、复杂沙箱或重型队列。以下三项是上线前置条件，任意一项未完成都不能开真实多用户：

1. Qunl 内部 relay 已通过“按用户余额、按用户分组、单次只扣一次费”的集成测试。
2. 火宝参考媒体使用内部签名读取接口，图片/视频提交具备幂等键或明确的结果未知状态。
3. PostgreSQL 空库迁移、旧 SQLite 单用户迁移和双用户越权测试全部通过。

除此之外，模型来源、任务状态、账号禁用和媒体落盘边界已经在本设计中固定，后续实现不应再临时增加第二套账号或模型权限逻辑。
