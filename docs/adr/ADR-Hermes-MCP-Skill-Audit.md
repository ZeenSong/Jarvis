# Hermes MCP / Skills Audit · M3.2

## 结论

M3.2 继续使用唯一 `Hermes profile: jarvis`，其中注册四个 MCP server：`jarvis` 只负责 Kernel，
`homeassistant`、`immich` 和 `frigate` 是分别可见的家庭服务 MCP。Home Assistant 和 Immich
在实际调用时启动对应的官方/开源上游 MCP；Frigate 使用独立的只读策略门控适配器，不能混入
Jarvis Kernel。
家庭服务凭据由 Jarvis 服务端按家庭读取，成员能力由独立的成员能力表决定，不进入
OIDC token 或浏览器。当前链路是：

| 用户场景 | Hermes tool | Jarvis scope | 结果形态 |
| --- | --- | --- | --- |
| Home Assistant | `mcp_tools_list` + `mcp_tool_call` | `mcp.homeassistant.read/write` | 官方 `/api/mcp` 的原始工具和结果 |
| 昨晚监控 | `frigate_events_read` / `frigate_event_snapshot_read` | `mcp.frigate.read` | 事件摘要 + Gateway 临时隔离截图 |
| Immich | `mcp_tools_list` + `mcp_tool_call` | `mcp.immich.read/write` | 开源 ImmichMCP 的原始工具和结果 |
| 定时检查 | `schedule_create` | `conversation.write` | 持久化 Schedule + Conversation 事件 |
| 需要选择 | `conversation_question_create` | `conversation.write` | 当前 Turn 的 Inline Question |
| 服务器状态 | `system_status_read` / `system_metrics_read` | `system.read` | 实际采样/状态 |

## 需要真实环境确认的项目

代码和测试验证了 profile、短期 context token、scope 检查、MCP bridge 和事件落库；
本轮现场 provider probe 已用临时、自动撤销的 Immich API key 和短期 Home Assistant
access token 验证 HA（191 个实体）、Frigate（事件 + JPEG snapshot）和 Immich（照片）
三条真实 adapter 链路。未配置凭据时各 Provider 明确返回 `*_not_configured`，不会伪造成功数据。
仍待在当前 M3.2 部署中验证 Authentik 登录和 Hermes 模型的自然语言 Tool Selection。

Hermes MCP 已能发现 Jarvis provider；Tool Selection 与自然语言质量依赖 Hermes
模型配置，不能用静态能力列表代替现场结果。MCP 作为低层工具，Skill 作为高层
任务编排；本阶段不引入独立 Workflow Engine 或 API Gateway。

## 规范问题结论

1. Provider 通过 Hermes `jarvis` profile 的 MCP server 配置发现；源码与部署
   ConfigMap 由测试保持同步。
2. Tool selection 已通过 scope/参数/结果契约验证；模型实际选择质量仍必须现场 smoke。
3. Skill 适合把“每日检查”等高层意图拆成多步任务，MCP 负责受限的单步能力。
4. 每次调用都带短期、签名的 context token，Tool Result 会落为 Activity。
5. Dynamic UI 和 Workspace 只接收平台无关的 ViewSpec/Resource，不接收 React 组件。
6. Approval 与 Question 通过 Conversation Turn 关联，并在 Conversation 内完成。
7. Home Assistant 和 Immich 不再通过少数领域 wrapper 暴露；工具清单、schema 和结果
   由上游 MCP 提供，Jarvis 只执行成员权限检查和家庭凭据转交。
8. Frigate 不属于 Jarvis Kernel；它拥有独立的 `frigate` MCP 入口和 `mcp.frigate.read` 成员权限。
9. Schedule 已使用现有持久化 control plane；没有提前建设 Workflow Engine。

## 权限边界

`context_token` 包含 actor、household、session、scopes 和过期时间，由 Jarvis
签名并在每个 MCP 请求验证。Authentik token 只证明人类登录身份，不能直接调用
第三方服务；Home Assistant、Frigate、Immich 使用家庭级 service credential。成员级
差异由 `household_member_capabilities` 实施；外部 MCP 不接触 Jarvis 登录 token。
