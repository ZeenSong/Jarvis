# 应用连接：从 CasaOS 安装到 Jarvis 可调用

Jarvis 把「CasaOS 里装了一个应用」变成「Jarvis 能读取并调用它」，中间不再需要改代码、改 Hermes 配置或重启容器。本文是当前实现的操作与扩展说明。

## 用户视角

1. 在 CasaOS 安装应用。Jarvis 每 5 分钟同步一次应用清单；第一次同步只建立基线，之后新出现的应用会生成一条「发现新应用」通知。
2. 打开「应用」页，点开应用详情：
   - 已识别的应用显示检测到的地址、认证方式和可调用操作数量；
   - 点击「一键连接 Jarvis」，Jarvis 会写入连接配置；
   - 需要凭据时，在详情里直接粘贴 API Key（会话型应用填 `用户名:密码`）。凭据只进入服务端加密存储，不写入浏览器、对话记录或日志。
3. 也可以直接问 Jarvis：「Jellyfin 怎么接？」Jarvis 会先调用 `app_list`，再调用 `app_setup_guide`，按实际端口和认证方式给出步骤，并在你确认后调用 `app_configure`。**不要在对话里粘贴密钥**；Jarvis 会引导你到应用页或设置页填写。
4. 填完凭据后 Jarvis 调用 `app_test` 验证。验证通过后，`app_tools_list` 返回可调用操作，之后通过 `app_tool_call` 直接执行，不需要再问连接方式。

## 支持的连接方式

| 方式 | 适用 | 说明 |
| --- | --- | --- |
| HTTP 请求头 | Jellyfin、Portainer、Grafana、Gitea、Immich | 例如 `X-Emby-Token`、`X-API-Key`、`Authorization: Bearer/token` |
| HTTP 查询参数 | 部分老式 API | `?api_key=...` |
| HTTP Basic | 少量服务 | 凭据格式 `用户名:密码` |
| HTTP 会话 | qBittorrent | 先 `POST /api/v2/auth/login` 取 `SID` Cookie，之后每次调用带 Cookie；过期时只续期一次 |
| MCP Streamable HTTP | Home Assistant、支持 MCP 的应用 | 服务端完成 `initialize` → `tools/list` → `tools/call` |

`app_tool_call` 只能调用 manifest 中声明的操作名；方法、主机和路径前缀都由 manifest 固定，模型无法把它们变成任意 HTTP 代理。

## 只有一套凭据平面

家庭服务的登录信息只保存在 Jarvis 服务端：CasaOS 用 `CASAOS_SESSION_FILE` 里的会话，其它应用用 `INTEGRATION_CREDENTIAL_KEY` 加密的凭据。Hermes 的浏览器保险库（`browser_vault_*`、`hermes vault add`）和终端不属于这条路径，也不应该用来登录 CasaOS、Jellyfin、qBittorrent 等家庭服务。无头会话里 Jarvis 不需要、也不应该向用户索取密码；需要新凭据时，只引导用户到 Jarvis 应用页或「设置 → 家庭服务链接」填写。

## CasaOS 自身的管理

CasaOS 不只是应用清单的来源，也作为宿主平台提供四个管理员工具：

| 工具 | 作用 |
| --- | --- |
| `casaos_app_detail` | 读取应用的镜像、服务名和端口映射；不返回环境变量、卷或凭据 |
| `casaos_app_add_ports` | 给指定服务追加主机端口映射；先做 `dry_run` 端口冲突校验，再重建容器 |
| `casaos_app_restart` | 通过 CasaOS 重启应用 |
| `casaos_app_logs` | 读取最近日志（最多 200 行） |

这些工具复用已登录的 CasaOS 会话，因此改端口映射、重启和排查日志都不需要再登录 CasaOS。`casaos_app_add_ports` 只追加映射，不删除已有映射，也不会把 Compose 的环境变量或卷返回给模型。

## 内置配方

`packages/integrations/src/recipes.ts` 目前包含：

- Jellyfin：系统信息、搜索、最近添加、条目详情、播放会话、设备、活动日志；写操作：刷新媒体库、向会话发消息、安装/卸载/启用/禁用插件、重启服务。
- qBittorrent：版本、传输状态、种子列表/属性/tracker/文件、偏好设置；写操作：添加、暂停、恢复、删除。
- Portainer：系统状态、端点、堆栈、容器列表。
- Grafana：健康状态、仪表盘搜索、数据源、告警。
- Gitea：账户、仓库搜索、仓库详情、Issue。
- Immich：服务信息、随机照片、资源详情、元数据搜索（内置 MCP 连接仍优先）。
- Home Assistant：MCP，内置连接仍优先。
- Obsidian：MCP，`https://<host>:27124/mcp/`，作为长期记忆与思维宫殿；自签名证书按连接放宽校验，`vault_delete` 默认拒绝。详见 [Obsidian 记忆库](obsidian-memory.md)。
- Mosquitto、ImmichFrame、Jarvis 自身：明确标记为暂不支持自动连接，并给出原因。

配方是数据，不是适配器。新增一个应用通常只需要在 `recipes.ts` 增加一条记录和对应测试。

## 扩展一个新应用

1. 在 `appRecipes` 中增加 `AppRecipe`：
   - `mode: "http"` 时声明 `auth`、`healthcheck`、`credential`、`operations`；
   - `mode: "mcp"` 时声明候选路径和凭据头；MCP 不在 Web 端口时补 `port` / `scheme`，
     自签名证书用 `allow_insecure_tls: true`（只影响这一条连接）；用 `tools.read` /
     `tools.write` / `tools.deny` 给上游工具分级，未知工具默认按写处理；
   - 无法直接驱动时用 `mode: "unsupported"` 并写清 `notes`。
2. 运行 `npx tsx --test tests/app-catalog.test.ts`，确认 manifest 能通过严格 schema、读写分级正确、URL 构造不会逃逸。
3. 不需要改 `app.ts`、Hermes 配置或 Python provider。

## 安全边界

- **管理员**才能写入或移除连接配置；普通成员只能读取已配置应用的数据。
- **凭据**使用现有的 `INTEGRATION_CREDENTIAL_KEY` AES-256-GCM 存储；`app_list` / `app_tools_list` 只报告是否已配置，不回显秘密。
- **上下文令牌**默认 10 分钟过期。Hermes 在长对话里可能把旧令牌交给模型；MCP provider 收到 `hermes_context_invalid` 时会用 bridge key 向 `/internal/hermes/context/refresh` 换取新令牌并自动重试，因此用户不需要因为令牌过期重开对话。刷新只对仍然存在、且属于该令牌签名所有者的会话生效。
- **URL 限制**：自动配置只接受 CasaOS 主机、私有地址、`.local`/`.lan`/`.ts.net` 等内网主机，或 `APP_URL_ALLOWLIST`/`ALLOW_PUBLIC_APP_URLS=1` 显式放行；拒绝带用户名、查询串或片段的 URL。
- **读写分级**：HTTP 操作由 manifest 的 `read_only` 决定；MCP 未知工具默认按写操作处理并需要写权限。
- **响应上限**：默认 256 KiB，超过即截断；MCP 单次响应上限约 1 MiB。

## 故障排查

- `app_list` 显示 `casaos.status = authentication_required`：在应用页重新连接 CasaOS。
- `app_test` 返回 `credential_required`：连接已写入，但还没有填凭据；去「设置 → 家庭服务链接」或在应用详情里填写。
- `app_test` 返回 `invalid_credentials`：应用拒绝了凭据；确认 API Key 权限或 qBittorrent 用户名密码格式。
- `app_tools_list` 返回 `transport: "stdio"`：这是内置 MCP 应用（目前是 Immich），请直接调用 `mcp__immich__*`，`app_tool_call` 只代理 HTTP 与 Streamable HTTP。
- `app_configure` 返回 `app_api_unknown`：该应用没有配方，也没有提供 MCP 端点；先让 Jarvis 给出 `app_setup_guide`，再显式传 `mode: "mcp"` 与 `endpoint`。
- 应用地址不可达：确认容器在运行、端口已发布，并且从 `jarvis-server` 容器内能访问该地址。
