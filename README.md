<div align="center">

# JARVIS

### 把散落在家里的应用、设备与数据，变成一个真正能行动的私人 AI 云

**一句话交代目标，Jarvis 负责理解、规划、调用工具、持续执行并呈现结果。**

[快速开始](#快速开始) · [核心能力](#不止是聊天更是行动) · [系统架构](#为私有云而生) · [文档中心](docs/README.md)

</div>

![Jarvis 私人云首页](docs/assets/readme/home.webp)

Jarvis 是一个面向家庭与个人场景的开源 AI 工作台。它把 Hermes Agent、Skills、MCP、家庭服务和你的私有数据放进统一体验：对话不是终点，而是任务的入口；回答不只是文字，还可以是照片、监控画面、可交互工作区和可追踪的执行过程。

> 当前版本：`0.4.3`。项目处于积极开发阶段，适合自托管体验、二次开发与家庭实验环境。

## 不止是聊天，更是行动

| 能力 | Jarvis 能做什么 |
| --- | --- |
| **多步 Agent 执行** | 拆解目标、调用工具、展示推理与执行阶段；任务状态可持久化并在断线后恢复 |
| **照片智能检索** | 连接 Immich，结合语义、时间、地点与媒体元数据查找照片，并以内联画廊呈现 |
| **家庭状态感知** | 通过 Home Assistant 与摄像头服务读取家庭状态、事件和画面，汇总成自然语言结果 |
| **长期记忆与思维宫殿** | 连接 Obsidian：每轮对话注入记忆索引，按主题追加笔记，用双向链接组织可长期维护的第二大脑 |
| **Skills + MCP** | 按任务选择 Hermes Skills，通过受控 MCP 能力桥接外部服务；权限与 Household 上下文随请求传递 |
| **动态工作区** | 同一套语义结果可渲染为图库、图表、任务卡片、日志或 Workspace，而不局限于聊天气泡 |
| **私有与可控** | 数据、身份、会话、媒体和集成凭据留在自己的基础设施中；敏感凭据加密保存，能力默认收敛 |
| **跨端体验** | Web 与 Kotlin/Compose Android 客户端，共享协议、任务状态和动态界面能力 |

## 你的照片，会真正变得可检索

不必记住文件名或相册。你可以说“找出赛里木湖的照片”，Jarvis 会使用媒体元数据定位结果；也可以让它从大量照片中筛选最符合描述的几张。

![按地点查找私人照片](docs/assets/readme/location-search.webp)

## 你的家庭，会真正变得可理解

Jarvis 不只是打开一个设备面板。它可以组合摄像头画面、Home Assistant 状态和任务上下文，用一次对话完成跨服务查询，并把每一步执行过程清晰展示出来。

![查看家庭摄像头最新画面](docs/assets/readme/camera-monitoring.webp)

## 结果不只是一段文字

来自 Immich 的图片以受保护的媒体资源进入当前会话；结果可以继续“查看更多”“收藏”或安全跳转到原应用。媒体访问与用户、设备和会话范围绑定。

![Immich 智能选片与内联画廊](docs/assets/readme/immich-gallery.webp)

## 为私有云而生

```text
Web / Android
      │
      ▼
Jarvis Gateway ─── PostgreSQL（身份、会话、任务、媒体、审计）
      │
      ▼
Hermes Agent ─── Skills / MCP ─── Immich · Home Assistant · 摄像头 · 更多服务
      │
      └── Agent Runtime / Worker（隔离执行、能力路由、状态恢复）
```

- **TypeScript 模块化单体**：服务端、协议、能力注册、Agent Runtime 与 UI 协议可独立演进。
- **Hermes 原生执行链路**：支持持久 Run、流式回复、推理强度、按轮 Skills 与停止任务。
- **最小权限桥接**：工具按能力、用户、Household、会话和 scope 约束，不把第三方密钥交给模型。
- **可恢复体验**：任务、活动、问题、审批和结果均有持久状态，刷新或短暂掉线不等于任务丢失。
- **多形态交付**：同一结果可以在桌面端展开为 Workspace，也可以在移动端降级为适合触屏的操作界面。

进一步了解：[架构说明](docs/reference/architecture.md) · [API / WebSocket 协议](docs/reference/protocol.md) · [M3.3 实施记录](docs/milestones/m3/m3.3-progress.md)

## 快速开始

### 环境要求

- Node.js 22+
- Docker（用于 PostgreSQL）
- 可选：Hermes、Immich、Home Assistant 等家庭服务

### 启动本地服务

```bash
git clone https://github.com/ZeenSong/Jarvis.git
cd Jarvis
npm ci

POSTGRES_PASSWORD=change-me docker compose -f deploy/compose.yaml up -d
export DATABASE_URL=postgres://jarvis:change-me@127.0.0.1:5432/jarvis

npm run build
npm start
```

打开 `http://127.0.0.1:8080`，首次注册的账户会成为管理员。默认服务仅监听本机；远程访问推荐使用 Tailscale 等受保护网络，不要把明文 HTTP / WebSocket 端口直接暴露到公网。

完整配置项见 [.env.example](.env.example)。Docker / CasaOS 与 Hermes 组合部署见 [部署说明](deploy/docker/README.md)，K3s 生产部署见 [部署手册](docs/guides/deployment.md)。

## Android

Android 客户端与 Web 共享同一套 Gateway 协议、持久会话、任务、动态视图和账户体系，并针对触屏重新组织：

- **完整产品面**：首页、空间、应用中心、任务/审批/定时任务、Jarvis 对话、执行过程、动态结果、工作区、Hermes、系统指标与 AI 用量、设置与用户管理、通知与深链。
- **豆包式语音通话**：全屏光球、流式识别与流式回复、按句 TTS 播报、轻触打断、自动续听、静音、扬声器、键盘输入、语速与通话计时；云端识别使用 `large-v3-turbo`，热态约 0.8 秒。
- **系统语音优先，自建 Whisper 兜底**：有系统语音服务时使用设备 ASR/TTS；华为 Mate X5 等无 GMS 设备可自动切换到自建 Whisper，音频只进入自己的 Jarvis 服务器，不经过第三方 ASR。
- **图片对话**：Web 与 Android 均可上传图片，Jarvis 用多模态模型理解画面和图中文字后再执行任务。
- **首次注册与邀请**：不必先去网页版，可在 App 内注册第一个管理员或接受邀请。
- **连接韧性**：前台与网络恢复后自动重连、指数退避、状态缓存和后台连接服务；系统强制停止后仍需重新打开应用恢复连接。

| Android 首页（浅色） | 语音通话 |
| --- | --- |
| ![Android 首页](docs/assets/readme/android-home-light.webp) | ![Android 语音通话](docs/assets/readme/android-voice.webp) |

使用 Android Studio 打开 `apps/android`，需要 JDK 17 与 Android SDK 35：

```bash
cd apps/android
./gradlew assembleDebug testDebugUnitTest
```

更完整的功能对照、语音状态机和排障说明见 [Android 体验](docs/guides/android-experience.md)；无 GMS 设备的云端识别部署见 [自建 Whisper](deploy/whisper/README.md)，开发 Agent 见 [DSH 开发工作台](docs/guides/dsh-development.md)。

## 开发与验证

```bash
npm run typecheck
npm run typecheck:web
npm test
npm run build:web
```

如需运行 PostgreSQL 集成测试，请提供独立测试数据库：

```bash
TEST_DATABASE_URL=postgres://jarvis:password@127.0.0.1:5432/jarvis_test npm test
```

未提供 `TEST_DATABASE_URL` 时，数据库集成用例会明确跳过。真实上游服务检查和模型调用不会包含在默认测试中，避免意外访问家庭数据或产生 API 费用。

## 当前边界

Jarvis 已具备核心对话、任务、动态 UI、Hermes、Skills/MCP 和家庭服务适配能力，但仍在持续收尾。部分端到端家庭场景需要使用者提供自己的服务与凭据；浏览器协议夹具不代表真实家庭数据已验证。生产部署前请阅读 [M3.3 未完成项](docs/milestones/m3/m3.3-progress.md#尚未完成必须继续) 与安全配置说明。

## 参与项目

欢迎通过 Issue 提交场景、问题与集成建议。提交代码前请至少运行类型检查与默认测试，并避免提交 `.env`、API Key、数据库转储、构建产物或家庭数据。

## 许可证

Jarvis 以 **GNU General Public License v3.0 或更高版本（GPL-3.0-or-later）** 发布。许可证全文见 [LICENSE](LICENSE)。

Copyright (C) 2026 ZeenSong

这意味着：

- 你可以自由运行、研究、修改和分发本项目，包括用于商业目的；
- 分发修改后的版本时，必须以同一许可证公开相应源码，并附带本许可证与版权声明；
- 软件按"现状"提供，不附带任何担保。

如果你的使用场景是把它作为网络服务提供给第三方，而希望这类使用也必须回馈源码，可以考虑改用 AGPL-3.0；如只接受 GPL v3 而不含"或更高版本"，把本段与 `package.json` 中的 `GPL-3.0-or-later` 改为 `GPL-3.0-only` 即可。

<div align="center">

**More Life. Less Work.**

</div>
