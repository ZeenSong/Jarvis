# ADR: Conversation UI 基础设施

状态：Accepted · M3.2

## 决策

Web Conversation V2 采用 `@assistant-ui/react` 作为交互与展示层，并通过
`apps/web/src/assistant-ui-adapter.ts` 中的 `JarvisAssistantAdapter` 接入 Jarvis，
由 `apps/web/src/assistant-ui-poc.tsx` 负责渲染
Gateway。assistant-ui 不调用模型、Hermes 或第三方应用；服务端仍是身份、上下文、
执行、事件和权限的事实源。

## 候选评估

| 候选 | 版本/许可证 | 已有能力 | M3.2 结论 |
| --- | --- | --- | --- |
| assistant-ui | `@assistant-ui/react@0.15.22` · MIT | Thread、Composer、Streaming runtime、自动滚动、Retry、Tool/HITL/Generative UI 原语、无障碍 | 采用 |
| Vercel AI SDK | 由 assistant-ui Adapter 支持 · Apache-2.0 | 流式消息和 Tool parts | 不替换 Hermes；仅作为未来协议参考 |
| CopilotKit | AGPL-3.0 | AG-UI、Shared State、HITL | 不整体引入，避免重复 Jarvis/Hermes/Dynamic UI 平台 |
| WorkBuddy | GPL-3.0 | ChatPanel、Workspace coupling | 不复制代码；仅参考交互模型 |
| 自研 Chat UI | 无 | 可完全定制 | 不采用；会重复实现成熟基础 UX |

## 实际 PoC 验证

PoC 的 Adapter 已通过 Web TypeScript 检查和 Vite 构建，验证了以下链路：

```text
assistant-ui message
  → JarvisAssistantAdapter
  → Gateway conversation.message
  → 服务端 Hermes durable run
  → Gateway conversation.get polling
  → assistant-ui streaming message
```

已覆盖的 PoC 能力：历史消息初始化、消息发送、服务端流式结果、Gateway 中断后的
耐心重连/恢复、取消信号、服务端失败结果、Tool Call/Result、Inline Approval 和
boolean/single-choice Question。Composer 的 Enter/Shift+Enter、Stop 和
Thread/Message 渲染由 assistant-ui 原语提供。Tool/Approval 的跨端事实模型由
Jarvis 的 `conversation_activities`、`conversation_questions` 和 `approvals` 表
提供，不把 React 组件写入平台无关的 Dynamic UI Protocol。

Conversation V2 默认且唯一使用该 PoC；旧 renderer 已从 Conversation 页面移除，
避免继续维护重复的 Composer、Scroll、Streaming 和 Tool UI 实现。

## Jarvis 自研边界

自研内容只包括 Gateway Adapter、Turn/Activity/Question 持久化、Household Context、
Hermes context token、Inline Approval 后端和 Dynamic UI/Workspace 连接。不得把
assistant-ui 当作 Agent Runtime、身份提供商、权限系统或 Tool Executor。

## 许可证与升级约束

assistant-ui 依赖锁定在 `package-lock.json`，升级必须重新核对许可证、runtime API
和 Web 构建。任何替换决定必须更新本 ADR，并提供同等真实 PoC 证据。
