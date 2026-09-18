# M3.11 复验证据说明

日期：2026-09-16。结论以 [状态与计划](../../M3.11_status_and_plan.md) 为准。

## 证据分类

- `system-status.json`：最新生产只读快照；`system-review.mjs` 可重跑。首轮采集器误用 fetch.status()，已修正为 status 并重新采集，不把该脚本错误当服务故障。
- `live-ui.json`、`01`–`03`、`05`、`08` PNG：真实生产浏览器及 Hermes；PNG 为页面截图，不是 mockup。`05/08-*-streaming` 为中间态，其余为终态。`live-ui.mjs` 需要本机私有审计配置和 kubeconfig，不在证据中复制凭据。
- `live-ui-error.png`：早期使用失效临时凭据的探索失败截图，不是最新生产流程结果；没有 `04/06/07` 是因为本轮未成功捕获应用新页、未生成 Workspace 卡，不补造成功截图。
- `isolated-results.json`、`10`–`15` PNG：独立数据库、真实产品代码/UI。模型是确定性 fixture，Node 为只记录参数的 Mock。未实际执行 Codex。WS 热重连测试通过浏览器 WebSocket 包装记录连接后关闭它，未替换页面和产品逻辑。
- `empty-provider.json`：独立模型空 SSE→DONE 故障注入；用 auth/login→conversation.create→conversation.message（内容 M311_EMPTY_PROVIDER）→conversation.get 复现。只记录最终业务结果，不保存 token。
- `20`–`24` PNG/XML：模拟器真实 ADB 截图与 UI hierarchy。20 为启动现有生产连接；21 登录表单；22 隔离登录；23 展示切换后旧消息残留；24 选择 fixture 后的 Markdown 和残留错误。
- `unit-tests.txt`、`web-regression.txt`、`typecheck.txt`、`build-web.txt`：自动测试/构建；fixture 测试不能证明模型质量或安全边界完整。

## 复现入口与影响

`review-server.ts` 只用于本次隔离环境：PostgreSQL 127.0.0.1:55449、应用 55450、模型 127.0.0.1:55451。源码中的固定密码/bridge key 都是专用本地测试值，不是生产凭据，禁止用于正式部署。应用监听所有地址仅为模拟器访问，测试后停止。

`isolated-review.mjs` 配合上述服务运行；会创建专用用户、会话、2099 年 schedule 和 Mock Node。生产没有创建这些对象。`android-ui.mjs snapshot <name>` 使用 ADB 保存当前真实屏幕，`tap <text>` 根据实时 hierarchy 定位。

生产只添加只读测试对话及临时配对设备，未删除用户资料或更改生产配置。原有工作树修改、旧证据和 Luna 的测试容器保持原样。

清理：结束前停止本轮专用 Server、模拟器和 `jarvis-m311-review-20260916` PostgreSQL 容器；保留容器及数据供复核，不删除原有测试容器。实际停止结果见 `cleanup.txt`。

`fingerprints.txt` 固定关键源码/包的 SHA-256；证据中的私网地址、用户/会话标识仍应视为内部材料，不建议原样公开。
