# M3.1 验收 evidence · 2026-09-16

结论与逐条复验意见见 [M3.1验收问题清单](../../milestones/m3/m3.1-acceptance-issues.md)。本目录中的 PNG 均来自真实 Chrome、生产浏览器验收会话或 API 35 模拟器操作，没有生成式图片或重绘；XML 是 Android 截图同时取得的 UI hierarchy。每个问题都必须同时有真实操作记录和截图；JSON、SSE、日志或源码摘录只用于补充截图中看不全的状态。

## 主要证据

| 主题 | 文件 |
|---|---|
| 生产真实对话、流式、Workspace、Hermes HTTP 与 Ops Durable | `15-live-conversation.png`、`live-results.json`、`hermes-wire.json`、`stream-live-current.json`、`conversation-workspace-live.json`、`hermes-http-capability-live.json`、`ops-durable-live.json`、`hermes-provider-error.txt` |
| Web Markdown / 新建崩溃 / 编辑器 | `02`–`07` PNG、`web-results.json` |
| Web Markdown 当前独立复验 | `a2-web-markdown-current.png`、`a2-web-markdown-live.json` |
| 精确 Session 撤销、Cookie 刷新与设备列表 | `17-web-revocation-confirmed.png`、`18-web-refresh-fails.png`、`f7-sessions-current.png`、`auth-results.json`、`auth-live-current.json`、`auth-sessions-live.json` |
| 生产 App / Hermes / Agent / Node 状态 | `11`、`12`、`19` PNG、`release-live-current.json`、`live-status.json`、`app-resolve-live.json`、`node-codex-live.json`、`node-boundary-live-current.json` |
| Android 登录、渲染与 Workspace | 历史 `20`–`26` PNG/XML；当前源码 APK 的 `52`、`57`、`59`、`60`、`61`–`74` PNG/XML |
| 沙箱 / 跨用户边界 / 凭据分离 | `30-web-sandbox-network-denied.png`、`security-results.json`、`storage-results.json` |
| Server / App 重启、覆盖安装、refresh | 当前轮 `31`–`36` PNG/XML、`restart-results.json` |
| Android 跨版本覆盖更新 | `f3-android-before-upgrade.png`、`f3-android-after-upgrade.png` |
| Web 浏览器进程重启 | `f5-web-before-process-close.png`、`f5-web-after-process-restart.png`、`f5-web-process-restart-live.json` |
| 整机重启现场与历史异常 | 当前 `34-android-device-reboot.png`；历史 `37-android-reboot-observation.png`（Pixel Launcher ANR） |
| 当前源码与构建 | `source-review.txt`、`source-fingerprints.json`、`build-validation.txt` |
| 现有自动回归 | `unit-tests.txt`（52/52）、`web-regression.txt`（6/6） |
| 文件完整性 | `manifest.json`：文件大小与 SHA-256；不含 manifest 自身 |

## 逐项真实操作与截图索引

下面的“截图”是实际操作结束时保存的画面；“结果”是同一轮操作写出的机器可读记录。历史截图仍保留原始失败现场；当前实现状态以问题清单、源码构建结果和新增 live evidence 为准。

| 问题 | 真实操作 | 截图 | 结果 / 当前结论 |
|---|---|---|---|
| Q01 生产模型链路 | 历史失败现场；当前生产真实对话另见 Workspace/stream evidence | `15-live-conversation.png`、`live-fatal.png` | 历史 `live-results.json`/`hermes-wire.json` 记录 provider 未配置；当前 `conversation-workspace-live.json` 已完成 |
| Q02 Web 新建崩溃 | 历史复现：隔离库中点击“＋ 新建” | `04-web-create-crash.png`、`04-web-create-save-noop.png` | 历史失败现场；当前 create 响应规范化已修复，见源码与构建检查 |
| Q03 Web Access 到期刷新 | 历史复现：隔离库回拨 Session 并比较 Cookie/body refresh | `18-web-refresh-fails.png`、`10-web-expired-reconnect.png` | 历史失败现场；统一 Cookie 解析已修复；`auth-live-current.json` 已通过 Cookie refresh=200 |
| Q04 撤销既有 WebSocket | 历史复现：撤销受害 Session 后使用旧连接发消息 | `17-web-revocation-confirmed.png` | 历史失败现场；连接绑定 Session 并在撤销时关闭已实现；`auth-live-current.json` 已验证 close code 4001 |
| Q05 Android 富文本 | 先复现进入对话崩溃，再安装修复 APK 重新进入并加载消息 | `57-android-markdown-current-apk.png`、`71-android-fixed-conversation.png`、`android-crash-before-fix.txt` | 根因是 Markdown 内联正则缺少闭合括号；修复后最新 APK 可进入 Jarvis 并显示已有 Markdown 回复 |
| Q06 Web Markdown | 历史复现：Web 检查预置渲染样本 DOM | `02-web-markdown.png` | 当前 renderer 已补粗斜体、列表与引用，并通过构建和现有 Web 回归 |
| Q07 Conversation ↔ Workspace | 历史 Web/Android 工作区操作；最新 APK 重新进入 Workspace | `03-web-workspace-layout.png`、`59-android-open-workspace-current-apk.png`、`60-android-workspace-current-apk.png`、`67-android-latest-workspace-fullscreen.png` | 当前 Web 已三栏同屏，Android 已导航并渲染 Workspace；`conversation-workspace-live.json` 已证明真实回复持久化 `workspace_id`/`view_id` |
| Q08 App Bridge 深链 | 历史 UI 失败现场；当前生产 resolver 传入 Immich album 与 Home Assistant entity；最新 APK 打开 Immich 资源链接 | `12-live-app-detail.png`、`19-live-app-open-failure.png`、`65-android-latest-app-detail.png`、`74-android-deeplink.png` | 当前实时结果见 `live-status.json`：四项 HTTP 200 并返回 Tailscale HTTP deep link；Android Chrome 地址栏显示目标 URL，Immich 返回资源 404，说明请求已到达目标服务 |
| Q09 Hermes 职责边界 | 历史 Core/Agent 观测；当前真实 Core、Ops 与 Hermes 任务见新增 evidence | `11-live-home.png`、`15-live-conversation.png` | 历史 `live-results.json`/`hermes-mcp-live.json` 保留 provider 未配置现场；当前 `live-status.json`、`stream-live-current.json`、`hermes-http-capability-live.json`、`ops-durable-live.json`、`release-live-current.json` 已完成 |
| Q10 Codex Node Capability | 读取节点能力，创建/批准执行审批，经 Gateway 调用真实 Codex | — | `node-codex-live.json`：node.codex.execute 已广播，审批后 HTTP 200、exit_code=0、stdout=OK |
| Q11 Artifact 跨对象污染 | 历史复现：保存 V1/V2 后切换 Workspace | `06-web-artifact-revision.png`、`07-web-source-leaks-to-next-workspace.png` | 当前切换同步 source，upsert 传现有 artifact_id，修复跨对象污染 |
| Q12 设备不可辨认 | 隔离环境双设备登录与设备列表 | `08-web-sessions.png`、`f7-sessions-current.png`、`52-android-fresh-login-current.png` | 当前 Web/Android 已使用持久化/生成 UUID device_id；两个全新设备登录和控制面板列表回归通过，最新 APK 已完成生产配对 |

## 本轮重启与持久化操作

本轮在 Android 重新登录后执行隔离 Server 重启、App force-stop/start、整机 reboot、同签名 APK `adb install -r` 覆盖安装，并将 Access 时间回拨后重启 App。所有步骤均在线恢复，数据库证据显示 Workspace ID、revision 和 Artifact 数量保留：

| 操作 | 截图 | 结果 |
|---|---|---|
| Server 重启后 Web 会话与 Workspace | `31-web-server-restart.png` | `restart-results.json`：`webSessionStatus=200`、Workspace ID 集合相同 |
| Android Server 重启 / App 重启 | `32-android-server-restart.png`、`33-android-app-restart.png` | `restart-results.json`：均 `online=true` |
| Android 整机重启 | `34-android-device-reboot.png` | `restart-results.json`：`online=true`；本轮未复现此前 Pixel Launcher ANR |
| 同 APK 覆盖安装 | `35-android-apk-overlay.png` | `restart-results.json`：安装成功且 `online=true` |
| Android Access 到期自动刷新 | `36-android-access-refresh.png` | `restart-results.json`：`lastSeenAdvanced=true` |

早期探索保留了 `web-fatal.png`、`04-web-create-save-noop.png` 和 `09-web-revoked-session-still-active.png`。**Q04/Q03 以独立的 `auth-results.json` 与 17/18 截图为准**。早期 broad runner 与 Android 登录并发，第一次撤销未命中预期 Session，不能用该次 HTTP 200 支持漏洞结论。生产 `audit-live.mjs` 已修正 API 诊断请求的 Origin；本轮生产浏览器 state 已过期，`live-fatal.png` 记录了实际登录页，生产模型链路仍以同日已保存的 15、SSE 和 Hermes 日志为准。

`audit-live-status.mjs` 已在本轮重新执行；`live-status.json`、`release-live-current.json` 记录当前生产观测。`hermes-mcp-live.json`、`node-codex-live.json` 保留真实链路证据，App resolver 当前结果也写入 `live-status.json`。最新 APK 的生产配对、App 详情、AI Action、Workspace、修复后对话和 Deep Link 现场在 `63`–`74`；`android-crash-before-fix.txt` 保留了修复前崩溃，`71`–`73` 是修复后 Android 对话回归。

## 复现脚本与范围

所有脚本从仓库根目录运行，需要已安装依赖、Chrome、Docker。不要把其数据库地址改为生产。示例账户凭据是明确的隔离 fixture，不是生产凭据。

```bash
docker run -d --name jarvis-m31-acceptance-20260916 \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=jarvis_audit \
  -p 127.0.0.1:55439:5432 postgres:17-alpine
docker exec jarvis-m31-acceptance-20260916 createdb -U postgres jarvis_tests
npm run build:web
npx tsx docs/evidence/m3.1-20260916/audit-server.ts
```

若同名容器已经存在，应检查并复用，不要重复创建或删除。Server 为前台进程，另一终端运行：

```bash
node docs/evidence/m3.1-20260916/audit-web.mjs
node docs/evidence/m3.1-20260916/audit-auth.mjs
node docs/evidence/m3.1-20260916/audit-security.mjs
npx tsx docs/evidence/m3.1-20260916/audit-storage.ts
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/jarvis_tests npm test
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/jarvis_tests npm run test:web
```

- `audit-web.mjs`：真实 UI 登录、渲染、Workspace 新建/保存、浏览器进程重启；显式记录产品错误而非隐藏失败。若后续修复改变界面结构，需相应更新定位器。
- `audit-auth.mjs`：单独运行，精确映射 Session 列表顺序和目标 ID；期间不要并发登录新设备。验证撤销后 HTTP 与既存 WS 差异、Cookie/body refresh 差异。
- `audit-security.mjs`：测试环境创建 Artifact 和第二用户，执行沙箱/跨用户负向检查。第二用户使用随机测试名。
- `audit-storage.ts`：隔离库中测试 IntegrationCredentialStore；进程内随机加密 key、不输出 key，测试项最后撤销。
- `android-ui.mjs snapshot <name>`：保存当前截图/XML；`tap <可见文字>`：从真实 hierarchy 解析点击坐标。本次账户/Server 输入通过 ADB input 完成，向测试 `http://10.0.2.2:55440` 登录。
- `audit-restart.mjs <隔离 audit-server 的 PID>`：只允许 command line 含 audit-server.ts 的进程。先在 Android 新登录，再单独运行；测试过程中会终止/重新启动该测试 Server、重启指定模拟器、覆盖安装同 APK。最新测试 Session 必须是 Android，以便准确模拟其 Access 过期。本轮所有重启步骤均恢复 `online=true`；若后续再次出现系统 Launcher ANR，应保留现场并单独标记环境异常。
- `audit-live.mjs` / `audit-live-status.mjs`：依赖已有私有测试浏览器 state 和 kubeconfig（未复制到 evidence）。前者新增只读验收对话；后者读取部署/应用/节点状态，并对目标节点执行无审批 Codex 能力负向探针。不能把离线 fixture 当作它们的替代；若 state 过期，脚本会保存登录页现场并在结果中记录失败。

原始结果中的时间为 UTC；中国标准时间需加 8 小时。测试结束后专用容器停止保留，生产 Deployment、Secret、节点配置均未修改。
