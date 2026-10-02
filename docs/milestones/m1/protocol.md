# M1 HTTP / WebSocket 协议

> 历史里程碑记录，不是当前操作手册。命令、镜像标签和环境状态只代表当时版本；部署请以 [`docs/guides/deployment.md`](../../guides/deployment.md) 为准。

所有受保护的 `/api/v1/*` 及 `/ws` 握手要求 `Authorization: Bearer <token>`。用户网页登录使用 HttpOnly 会话 Cookie；禁止 Token 放 URL。一次性配对接口已停用。

## HTTP

| 方法 / 路径 | 内容 |
| --- | --- |
| GET /health、/health/live | 进程存活 |
| GET /health/ready、/api/v1/health | PostgreSQL / System Monitor / Scheduler；异常 503 |
| GET /api/v2/auth/registration | 返回首次注册是否开放 |
| POST /api/v2/auth/register | 首次注册 Jarvis 账户；第一个账户自动成为管理员 |
| POST /api/v2/auth/login | 用户名密码登录 |
| POST /api/v2/auth/logout | 注销当前会话 |
| GET /api/v1/system/status | server/cpu/memory/disks/gpu/network/jarvis 完整快照 |
| GET /api/v1/agents | Agent 数组 |
| GET /api/v1/agents/:id | Agent + session_start，缺失 404 |
| GET /api/v1/agents/:id/events | 最近 100 条，按时间倒序 |
| GET /api/v1/llm/usage | range/group_by/from/to/agent_id |
| POST /api/v1/llm/requests | 仅 Agent，用量日志；UUID 去重 |

范围 `today / 7d / 30d / month / custom`；group_by 为 `provider / model / agent`。custom 必填 ISO8601 UTC from/to。响应包含 total、groups，provider 分组还含 providers。总计为 input_tokens/output_tokens/cached_input_tokens/reasoning_tokens/requests/errors/estimated_cost_usd/unpriced_requests/p95_latency_ms。

## WS envelope

```json
{"id":"unique-request-id","version":1,"type":"request","topic":"system.status.get","payload":{}}
```

成功返回 `type=response`、`reply_to=<请求 ID>`；失败返回 `type=error`、`payload.error`。事件带服务进程内递增 sequence；重启会重置，不能作为持久事件游标。当前不支持 streaming。解析与字段限制的事实源为 `packages/protocol/src/index.ts`。

| Topic | Payload / 行为 |
| --- | --- |
| gateway.ping | `{}` → gateway.pong |
| gateway.subscribe | `{topics:[...]}` 替换当前订阅 |
| system.status.get | `{}` → 最新完整快照 |
| agent.list | `{}` → 数组 |
| agent.get | `{agent_id}` → 单个 Agent |
| agent.register | `{agent_id,name,runtime?,version?,capabilities?}` |
| agent.heartbeat | `{agent_id,status,provider?,model?,task_id?}` |
| agent.task.started / finished / error | heartbeat 载荷；服务端分别设置 running/idle/error，finished 清理 task |
| llm.usage.summary | HTTP query 同名 JSON 字段 |
| llm.request.completed | usageSchema 字段；持久化后触发用量更新 |

可订阅事件：system.status.changed、network.public_ipv6.changed、agent.status.changed、llm.usage.changed、llm.request.completed。默认订阅后三类中的 Agent/usage 变化及 IPv6 变化；高频 system 状态需要显式订阅。gateway.status 在握手成功后推送。

服务端每 15 秒 WebSocket ping，未响应的连接在下一轮终止。Android 每 15 秒应用 ping，10 秒请求超时，重连退避 1/2/4/8/16/30 秒加抖动，重新连接即重新订阅并获取快照。

Agent 状态 starting/online/idle/running/waiting/error/degraded/offline；last_seen_at 使用服务器时间，避免信任 Agent 时钟。30/90 秒阈值可配置。Session 在首次注册/离线恢复时打开，offline 时关闭。Agent 事件默认保留 30 天。
