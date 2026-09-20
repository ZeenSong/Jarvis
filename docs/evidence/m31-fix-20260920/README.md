# 2026-09-20 修复与部署证据

最终部署：`jarvis-server:0.3.0-m31-fix-20260920-r6`，Hermes 原生 Dashboard 与 Gateway 同容器，由官方 s6 管理。生产测试通过现有已认证浏览器状态使用 Playwright + 无头 Chrome；私有状态文件不纳入仓库。

## 最终复验

- `final-smoke.json`：生产左侧 Hermes 入口→官方控制台实际新页打开；Gateway Running；持久化图表工作区刷新恢复；页面 JS 错误为零。
- `hermes-entry.png`、`hermes-dashboard.png`：用户入口和未经重写的 Hermes 官方界面。控制台访问经本机 port-forward；用户电脑需 SSH 隧道。
- `home.png`、`system.png`、`browser-errors.json`：首页真实状态、CasaOS 待重新认证提示、系统指标。
- `app-photos.png`、`app-family.png`：实际打开 Immich 与 Home Assistant 原应用页面。只证明入口与登录页面可达，不代表已认证后的全部业务操作通过。
- `live-chart-message.png`、`live-workspace.png`、`live-workspace-reloaded.png`：真实模型调用 system_status_read / ui_view_show，工作区持久恢复。
- `final-task.json`、`final-task-message.png`、`final-task-detail.png`：真实 task_create，run `48966e27-8f22-4ebd-a79d-05995120c5b4` 完成，结果中可见只读分析正文。数据库 `result_json.summary` 也已核对非空。

## 测试及边界

隔离测试库 54/54 服务端测试、7/7 Web 测试通过，无跳过。两套类型检查、Web 构建、Android assembleDebug 通过。日志保存在工作目录 `.local/m31-fix/`。Android 未做实体手机验证，CasaOS 集成待用户重新认证；不宣称完整 M3.1 Release Gate 通过。

`live-flows.json` 和 `flow-error.png` 保留一次连续操作自动化的失败记录：图表与刷新成功，随后发送步骤未形成新消息，等待超时。之后使用独立浏览器流程验证任务成功（`final-task.json`）；不把该超时报告写成通过。

`verified-flows.json`、`live-task-message.png`、`live-task-detail.png` 属于较早尝试，含切换会话尚未加载完的旧正文/旧结果，不作为最终任务通过依据。以 final 前缀证据和上述明确列出的截图为准。
