# 用 Obsidian 做 Jarvis 的长期记忆与思维宫殿

Obsidian 不是 Jarvis 内置的数据库，而是一个**外部的、可读可写的记忆后端**。Jarvis 通过
Obsidian 的 `Local REST API with MCP` 插件访问 vault：读索引、检索笔记、追加记忆。
这样记忆仍然是普通的 Markdown 文件，用户可以在 Obsidian 里直接查看、修改、迁移和备份。

## 1. Jarvis 里需要改哪些地方

| 层 | 位置 | 作用 |
| --- | --- | --- |
| MCP 传输 | `packages/integrations/src/mcp-http.ts` | 支持自签名证书，保留 `/mcp/` 末尾斜杠 |
| Manifest | `packages/integrations/src/manifest.ts` | `streamable-http` 新增 `allow_insecure_tls` |
| 连接描述 | `packages/integrations/src/registry.ts` | 把 `insecure_tls` 传给上游连接，不再无条件去掉末尾 `/` |
| 应用配方 | `packages/integrations/src/recipes.ts` | 新增 Obsidian：27124 端口、`https://`、`/mcp/`、读写工具分类 |
| 应用目录 | `apps/server/src/app-catalog.ts` | 按配方生成端点；新增记忆索引读取与记忆协议 |
| 对话注入 | `packages/conversation/src/index.ts` + `apps/server/src/m2.ts` | 把记忆简报带进每轮对话的 instructions |
| Hermes 代理 | `apps/hermes-mcp/jarvis_provider.py` | 直接挂载 `mcp__obsidian__*` 时同样支持自签名证书（可选） |

核心变化只有三件事：

1. **能连上**：单条连接允许跳过证书校验；端点不再被改写。
2. **能读**：每轮对话开始前读取 `Jarvis/Memory/Index.md`，以 4 KB / 4 秒为上限注入。
3. **能写**：模型通过 `vault_append` / `vault_write` 写回；写操作走 `mcp.obsidian.write` 权限。

## 2. Obsidian 侧配置

1. 安装并启用社区插件 `Local REST API with MCP`（`obsidian-local-rest-api`）。
2. 打开插件设置，确认：
   - `Enable Secure Server` 已打开，端口 `27124`；
   - 记下 `API Key`（不是 Obsidian 账户密码）。
3. 确保容器的 `27124/tcp` 映射到主机。CasaOS 可在应用详情里加端口映射：

   ```json
   [{ "target": 27124, "published": 27124, "protocol": "tcp" }]
   ```

4. 验证（把 `<host>` 换成 Jarvis 能访问到的主机地址）：

   ```bash
   curl -sk https://<host>:27124/ \
     -H "Authorization: Bearer <api-key>"
   ```

   返回 `{"status":"OK", ...}` 说明服务已启动。

> **不要用 `127.0.0.1` 填给 Jarvis。** Jarvis 运行在容器里，`127.0.0.1` 是容器自己。
> 用 CasaOS 检测到的主机地址（例如 Tailscale / 局域网 IP），或把 Obsidian 接入 Jarvis 的
> Docker 网络后使用容器名。

## 3. 在 Jarvis 里连接

应用页的“一键连接”会使用 Obsidian 配方，自动得到：

```text
endpoint: https://<host>:27124/mcp/
Authorization: Bearer <api-key>
allow_insecure_tls: true
```

如果使用对话里的 `app_configure`，只需要：

```json
{ "app_id": "obsidian", "mode": "mcp" }
```

凭据请在 Jarvis 的「设置 → 家庭服务链接」里填写，不要发在对话中。

工具分类（`tools.read` / `tools.write` / `tools.deny`）：

| 类别 | 工具 |
| --- | --- |
| 读 | `vault_list` `vault_read` `vault_get_document_map` `active_file_get_path` `search_query` `search_simple` `tag_list` `command_list` |
| 写 | `vault_write` `vault_append` `vault_patch` `vault_move` `vault_copy` `command_execute` `open_file` |
| 禁止 | `vault_delete` |

未知工具默认按写操作处理；删除被显式拒绝，避免模型误删记忆。

## 4. Vault 约定

首次使用时建议建立下面的结构（Jarvis 也可以自己创建）：

```text
Jarvis/
└── Memory/
    ├── Index.md          # 每轮对话读取的记忆入口
    ├── Profile.md        # 用户画像与偏好
    ├── Environment.md    # 家庭环境、设备与服务（不含凭据）
    ├── Projects.md       # 长期项目
    ├── Daily/
    │   └── YYYY-MM-DD.md # 每日记录
    └── Palace/
        ├── Index.md      # 思维宫殿地图
        ├── 工作间.md
        ├── 生活.md
        ├── 技术.md
        ├── 灵感.md
        └── 回忆.md
```

写入原则（已写入 `Index.md`，也包含在 Jarvis 的提示词里）：

- 先读同主题笔记，再追加，不覆盖未读内容；
- 只写有长期价值的事实（偏好、决定、计划、关系、经验），不逐字记录对话；
- 不写密码、令牌、API Key、证件号；
- 每条记忆尽量带日期；不确定的标注“待确认”。

## 5. 工作方式

### 读路径

每轮对话开始前，`AppCatalog.promptSummary()` 调用 Obsidian 的 `vault_read` 读取
`JARVIS_MEMORY_INDEX`（默认 `Jarvis/Memory/Index.md`），把内容与记忆协议拼进
Hermes 的 `instructions`。

- 4 秒超时：vault 慢或离线不会拖住回复；
- 4 KB 截断：超出部分提示模型用 `search_simple` 检索；
- 30 秒缓存：同一用户的连续对话不会重复读；
- 读失败时只注入协议，不影响本轮回答。

### 写路径

模型通过 `mcp__apps__app_tool_call` 调用：

```json
{
  "provider": "obsidian",
  "tool_name": "vault_append",
  "arguments": { "path": "Jarvis/Memory/Daily/2026-10-18.md", "content": "- 20:30 ..." }
}
```

或按主题写 `Jarvis/Memory/<主题>.md`。写操作需要 `mcp.obsidian.write`；管理员默认拥有全部权限，
普通成员默认只有 `mcp.obsidian.read`。

### 检索

`search_simple(query=...)` 走 Obsidian 内置搜索；`search_query` 支持 JsonLogic 元数据查询；
`vault_get_document_map` 返回标题树、块引用与链接，适合先看结构再读某一节。

## 6. 为什么之前一直连不上

按出现频率排序，三个独立问题：

1. **插件服务没有启动**：`data.json` 里 `enableSecureServer` 与 `enableInsecureServer` 都是
   `false`，主机端口由 Docker 代理监听但没有后端，TLS 握手被重置。
   在插件设置里打开 Secure Server 即可。
2. **自签名证书**：插件的证书 SAN 只有 `127.0.0.1`，Jarvis 用主机地址访问时 Node 报
   `DEPTH_ZERO_SELF_SIGNED_CERT`。必须按连接放宽校验（本仓库的实现），或改用 HTTP 端口
   `27123` 并加端口映射（不推荐，API Key 会走明文）。
3. **地址写错**：容器里的 `127.0.0.1` 不是宿主机；CasaOS 自动检测通常能用，但要注意
   使用 `<host>:27124` 而不是 Web UI 的 `:15323`。

另外，Jarvis 不读取 Claude Desktop 风格的 `mcpServers` JSON。那种配置只对支持该格式的客户端
有效；Jarvis 使用 manifest（应用页一键连接或 `INTEGRATIONS_DIR` 下的 JSON 文件）。

## 7. 验证清单

```bash
# 1. Obsidian 服务在监听
curl -sk https://<host>:27124/ -H "Authorization: Bearer <api-key>"

# 2. MCP 能握手并列出工具（在 Jarvis 容器内执行最有代表性）
#    预期看到 vault_read / vault_append / search_simple 等 16 个工具
```

然后：

1. `app_test(provider=obsidian)` 返回 `connected: true` 与 `tools_count`；
2. `app_tools_list(provider=obsidian)` 能看到读写分类；
3. 发一句“记住我偏好简短回答”，检查 `Jarvis/Memory/Profile.md` 是否被追加；
4. 新开一轮对话，问一个需要记忆的问题，确认回答引用了索引里的内容。

## 8. 边界

- 这是**提示词级记忆**：Jarvis 读取索引并主动检索，不是向量数据库，也没有自动事实抽取。
  高价值记忆需要模型按协议写入；如果希望“每轮自动摘要写入”，可以在 `ConversationService`
  完成回调里追加，但要自行处理敏感信息与噪音。
- 记忆按 owner（用户/设备）解析凭据；当前实现使用配置该集成的家庭凭据，尚未做到每个成员
  一个独立 vault。多用户隔离仍由 `mcp.obsidian.read/write` 权限与 Obsidian vault 本身控制。
- 思维宫殿是**约定**，不是特殊数据结构：房间就是笔记，`[[...]]` 就是走廊。
