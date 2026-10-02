# 协议入口与兼容边界

> 本文只提供当前协议入口。完整字段与校验规则以代码中的 Zod schema、路由实现和测试为事实源，避免手写文档与实现再次漂移。

## 身份与会话

- `POST /api/v2/auth/register`：首次注册；第一个账户成为管理员。
- `POST /api/v2/auth/login`、`POST /api/v2/auth/logout`：本地账户会话。
- `/api/v2/auth/oidc/*`：启用 OIDC 时的登录状态、开始与回调入口。
- Web 使用 HttpOnly 会话 Cookie；不得把 Token 放入 URL。
- 一次性设备配对接口已经停用，不应出现在新的安装指南中。

## 服务状态

- `GET /health/live`：进程存活。
- `GET /health/ready`：数据库、系统监控与内部调度器就绪状态。
- 受保护的 API 与 WebSocket 请求必须使用有效的 Jarvis 身份上下文。

## 对话与任务

对话请求通过 Gateway 进入持久化 Turn，并以事件形式返回文本增量、Reasoning、工具活动、问题、审批、结果和终态。客户端必须按 revision 去重并忽略状态回退；断线恢复读取服务端快照，而不是重新发送原请求。

当前事实源：

- 基础消息封装与主题：[`packages/protocol/src/index.ts`](../../packages/protocol/src/index.ts)
- 对话状态和事件：[`packages/conversation/src/`](../../packages/conversation/src/)
- Web 适配：[`apps/web/src/jarvis-conversation.tsx`](../../apps/web/src/jarvis-conversation.tsx)
- 服务端路由：[`apps/server/src/app.ts`](../../apps/server/src/app.ts)

## 动态视图

服务端只接受协议允许的组件、字段和动作。未知组件应降级为惰性文本；任意脚本、任意网络地址和未授权资源引用必须拒绝。协议实现位于 `packages/ui-protocol*`，跨端语义保持一致，但 Web 和 Android 可以采用不同布局。

## 版本维护规则

新增或修改协议时，应同时更新 schema、服务端、至少一个客户端适配与相应测试。除非路由测试和 schema 都存在，否则不要仅凭本文宣称某个 Topic 或字段可用。
