# 火宝本地验收记录

日期：2026-10-19。

## 结论与边界

当前代码在独立 PostgreSQL、正常 Qunl 密码登录和 Docker 应用环境下通过本地用户隔离验收。首次验收没有修改业务功能，后续界面调整与修复见文末；没有修改正式 Qunl 用户、Token 或 `.env`，没有调用付费上游。

测试库内的 `acceptance1`、`acceptance87` 是合成账号，ID 为 1、87。账号 ID 与正式用户相同只是为测试明确归属，不能把它们描述为正式 root/87 登录成功。测试模型 Key 全是假值，本地模拟上游已在验收结束时关闭；这些配置不提供真实生成服务。

正式旧数据和 root 旧 Key 尚未迁移，正式账号与真实付费上游完整业务验收尚未执行。正式 `HUOBAO_ENABLED` 保持原关闭状态，只有本轮独立测试进程开启代理。

## 结果

| 检查 | 通过 | 失败 |
| --- | ---: | ---: |
| PostgreSQL 全量集成 | 70 | 0 |
| 镜像内单元 | 34 | 0 |
| 正常 Qunl Session 和双用户 HTTP | 33 | 0 |
| 正常 Session 到容器的模型模拟上游 | 13 | 0 |
| 浏览器 | 30 | 0 |
| Docker 应用基础检查 | 16 | 0 |
| 容器运行和持久化 | 4 | 0 |

两端前端构建、Qunl 完整编译、镜像内类型检查和 Compose 配置校验也通过。上批结构测试 56 通过、0 失败，本轮未重复执行，不计入以上结果。宿主机和容器重复执行的同一组检查只列一次。

浏览器结果包含两个账号正常密码登录与侧栏进入，配置新增、编辑不回显/不提交空 Key、启停、删除，个人 Prompt 保存、个人 Skill 创建、内置文本只读，跨用户不可见，项目创建与深层页面刷新，退出后拒绝访问，以及桌面、平板和手机检查。截图保存在 `output/playwright/session-*.png`。最后在 Docker 环境中按顺序创建用户 1 的项目、Prompt 和 Skill，等待用户 87 的页面加载完成后再次确认不可见；这是重复验证，不另计数量。该次手机截图为 `output/playwright/docker-session-user87-mobile.png`。

模型检查使用正常 Qunl 登录产生的 Session，不用自制身份头替代登录。真实 Agent SDK 执行保存工具；图片请求走 `/v1/images/generations`，Mini 视频创建与查询走 `/api/v3/contents/generations/tasks`。请求携带各自测试 Key，错误配置与跨用户资源直接拒绝。图片、视频、缩略图/海报和媒体访问经过实际文件处理；模型内容由本地测试服务生成，不是公网生成结果。

容器检查包括匿名访问拒绝、签名身份、双用户项目与媒体隔离、私有缓存、存储统计、非 root 进程、内置文件拒绝写入及 FFmpeg/FFprobe 可用。按计划重启 PostgreSQL 与应用后，数据库记录数量、媒体文件内容摘要和本人项目响应一致。

## 当前运行环境

- 登录入口：`http://127.0.0.1:3300/login`；登录后从侧栏进入火宝，地址为 `http://127.0.0.1:3300/huobao/`。未登录直接访问火宝会返回 401。
- 测试 Qunl：本地完整编译的 `qunl-api/.tmp-gotmp/huobao-acceptance.exe`，监听 `127.0.0.1:3300`。
- 火宝镜像：`huobao-drama:acceptance-20261019`；`huobao-drama:local` 已更新为同一镜像。
- 当前镜像 ID：`sha256:041ae017b7fa9e4f3608c65d39ba3d62c86c0588cb7a21912d7399a0f47001e6`。
- Compose 项目：`huobao-acceptance-20261019`；应用 `127.0.0.1:15681`，PostgreSQL 17 无宿主机端口。
- Compose 数据卷：`huobao-acceptance-20261019_postgres`、`huobao-acceptance-20261019_media`。
- Qunl 测试库：本机 `127.0.0.1:55432` 的 `qunl_huobao_acceptance_20261019`。
- 宿主机火宝预检库：同一测试 PostgreSQL 下的 `huobao_acceptance_20261019`；当前代理已使用容器库。
- Qunl 启动依赖的独立测试 MinIO：`huobao-acceptance-minio-20261019`，监听 `127.0.0.1:59000`。

仅用于上述隔离环境的测试账号为 `acceptance1`、`acceptance87`，测试密码为 `HuobaoTest20261019!`。它不是任何正式账号的密码。启动器清空继承环境，在专用目录读取空 `.env`，显式使用本地测试数据库和测试密钥，不加载仓库的正式连接信息。

本机旧 `huobao-app-1` 仍属于之前的环境。Docker 启动后曾自动恢复它，占用 `5679`；本轮用独立端口和项目名避开冲突，没有迁移或覆盖它的数据。

## 复现入口

测试准备工具放在 `D:\MMMMYYYYHHHH\qunl-api\output\huobao-acceptance`：

- `prepare.go` 只接受 `127.0.0.1:55432` 且库名前缀为 `qunl_huobao_acceptance_` 的目标；首次准备要求空库。
- `prepare.go --storage-only` 为同一隔离环境准备 Qunl 启动依赖的测试存储。
- `start.ps1 -Docker` 启动独立 Qunl，代理到 `15681`。不带参数时代理到宿主机火宝测试进程 `15680`。

火宝工作区的检查入口：

```powershell
docker compose -p huobao-acceptance-20261019 -f output/tools/docker-compose.acceptance.yml up -d --wait

$env:HUOBAO_ACCEPTANCE_BACKEND_URL='http://127.0.0.1:15681'
node output/tools/session-acceptance.mjs

$env:HUOBAO_ACCEPTANCE_MODEL_HOST='host.docker.internal'
node output/tools/model-session-acceptance.mjs

node output/tools/docker-runtime-checks.mjs
```

这些检查会在本轮隔离测试库中增加测试记录；模型检查会启动并关闭本地模拟上游，持久化检查会按计划重启测试应用及 PostgreSQL。它们不是生产数据迁移或线上验收命令。浏览器截图与准备工具也只包含合成测试数据。

## 后续界面调整验收

Qunl 侧栏和管理员模块设置中的显示名称统一为 `qunl短剧`。短剧项目页、设置页和分集工作台增加 `返回 Qunl` 入口，通过同域 `/console` 返回控制台，不依赖浏览器历史或配置域名。

检查分集工作台时发现既有模型选择存储键引用了未定义的 `episodeId`，导致页面空白。已改为使用路由中的项目 ID 和集数生成存储键，保持不同项目、不同集的选择相互独立。

本次补充检查 16 项通过、0 项失败，覆盖页面名称、返回路径、四种屏幕尺寸下入口可见且未被遮挡、分集工作台实际加载，以及返回控制台后保持原账号并再次进入短剧。两端前端构建、Qunl 编译和 Docker 镜像构建通过；上述首次验收结果未在本次全量重跑。

`huobao-drama:local` 与 `huobao-drama:acceptance-20261019` 均已更新，测试应用已使用新镜像。截图为 `output/playwright/qunl-drama-navigation-{1440,390}.png` 和 `output/playwright/qunl-drama-workbench-navigation-{1440,390}.png`。
