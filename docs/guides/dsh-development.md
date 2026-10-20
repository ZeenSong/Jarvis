# DeepSeek Harness 作为默认开发工具

Jarvis 的 `coding-agent` 现在默认使用 DeepSeek Harness（DSH）作为执行器。它不是一个外部链接，而是 Jarvis 任务系统里的一个 `AgentRuntime`：任务创建、执行事件、工具步骤、用量和最终结果仍然走原有的任务/工作区 UI。

## 运行方式

DSH 以 `headless --json` 模式启动：

```bash
dsh --profile headless --json "实现某个功能并跑测试"
```

Jarvis 把 NDJSON 事件映射为：

| DSH 事件 | Jarvis 事件 |
| --- | --- |
| `thinking` | `agent.thinking` |
| `tool_call` / `tool_result` | `agent.tool.started` / `agent.tool.completed` / `agent.tool.failed` |
| `text` | `agent.message.delta` |
| `status.step_end.usage` | `agent.usage.updated` |
| `final` | `agent.run.completed` |

任务完成后，`coding-agent` 的 `result_json` 包含 DSH 的最终摘要和 `session_id`；Android/Web 的任务详情会照常展示执行过程和结果。

## 部署配置

```env
DSH_ENABLED=1
DSH_BIN=/app/node_modules/.bin/dsh
DSH_HOME=/dsh-home
DSH_WORKSPACE=/workspace
DEEPSEEK_API_KEY=...
```

容器需要两个可写挂载：

- `DSH_HOME`：profile、session、工具缓存；
- `DSH_WORKSPACE`：DSH 可以读写的代码目录。**它会执行 shell 和文件修改**，不要挂载包含生产密钥的目录。

CasaOS 的 `jarvis-server` 还设置了 `cap_drop: ALL`、`no-new-privileges` 和只读 rootfs；DSH 只能写显式挂载的 workspace/home。

## 使用

直接对 Jarvis 说：

- “用 DSH 把首页的加载延迟降下来，跑测试后给我结果。”
- “检查这个仓库的 Android 构建失败原因并修复。”

Jarvis 的 `task_create` 会根据 `code.*` / `file.*` / `node.*` 能力选择 `coding-agent`，不再落到不可用的 `codex`。也可以从任务页或 Agent 页看到 `Coding Agent · dsh`。

## 验证

```bash
# 容器内二进制
docker exec jarvis-server /app/node_modules/.bin/dsh --version

# 运行时健康
docker exec jarvis-server node -e "fetch('http://127.0.0.1:8080/health/ready').then(r=>process.exit(r.ok?0:1))"
```

已实测：任务 `Create a file named dsh-task-output.txt ...` 由 DSH 执行，`/workspace/dsh-task-output.txt` 生成内容 `DSH_TASK_OK`，任务状态 `completed`，摘要 `DSH_TASK_OK`。

## 边界

- DSH 是**开发执行器**，不是无限制的服务器 root shell；它受容器权限和挂载范围约束。
- DSH 的模型由 `DEEPSEEK_API_KEY` 和 DSH profile 决定；当前默认 `deepseek-flash`。
- DSH 的 Web 控制台仍可单独运行，但 Jarvis 不依赖它；Jarvis 使用 headless 事件流。
- 不要把 `DSH_WORKSPACE` 指向包含 `.env`、私钥或客户数据的目录，除非你明确接受开发 Agent 可以读取它们。
