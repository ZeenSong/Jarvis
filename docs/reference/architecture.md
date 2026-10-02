# 当前系统架构

> 本文描述当前代码边界。M1–M3 的历史设计与验收结论位于 `docs/milestones/`，不能替代当前实现。

Jarvis 是一个 TypeScript 模块化服务端、React Web 客户端与 Kotlin/Compose Android 客户端组成的私人 AI 云。PostgreSQL 保存身份、会话、任务、执行活动、媒体资源与用量数据；Hermes 提供模型、Skills 和 Agent Run；Jarvis 负责身份、权限、持久状态、家庭服务桥接与多端体验。

```text
Web / Android
      │ HTTP + WebSocket
      ▼
Jarvis Server ───── PostgreSQL
      │
      ├── Hermes Bridge ─── Hermes Agent / Skills
      ├── MCP Access ────── Home Assistant / Immich / 摄像头等
      └── Agent Manager ─── 受能力、风险与可用性约束的 Runtime
```

## 代码边界

| 区域 | 职责 |
| --- | --- |
| `apps/server` | HTTP、WebSocket、身份、会话、任务、媒体与集成入口 |
| `apps/web` | Web 产品界面、对话、Workspace 与动态视图 |
| `apps/android` | Android 原生客户端与后台连接 |
| `apps/hermes-mcp` | Hermes 到 Jarvis 能力层的受控 Provider |
| `packages/conversation` | 对话状态、流式事件与执行投影 |
| `packages/hermes-*` | Hermes 客户端、Runtime 与事件适配 |
| `packages/agent-*` | Agent 注册、能力路由与执行生命周期 |
| `packages/ui-*` | 跨端语义 UI 协议与降级规则 |
| `packages/integration-*` | 外部应用适配器 |

## 安全边界

- 用户通过 Jarvis 用户名/密码或已配置的 OIDC 登录；旧的一次性设备配对不再是当前用户入口。
- 集成凭据由服务端加密保存，不返回客户端，也不直接交给模型。
- MCP 与 Runtime 请求携带用户、Household、会话、scope 与过期时间上下文。
- 媒体资源按所有者、设备或会话范围授权，并通过 Jarvis 内容路由读取。
- 未声明的能力、未知动作和越权资源默认拒绝。

## 状态与恢复

任务、Turn、Activity、问题、审批和结果均以数据库状态为准。客户端可以通过事件流获得实时更新，也必须能够在刷新或短暂断线后从快照恢复；重新连接不应重复提交已经受理的消息。

更细的历史决策见 [`docs/adr/`](../adr/)，M3.3 当前完成度见 [实施与验收记录](../milestones/m3/m3.3-progress.md)。
