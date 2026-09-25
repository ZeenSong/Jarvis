# Jarvis 0.3.1 · M3.1

M3.1 版本将 Jarvis 的 Conversation、Workspace、Hermes、Task、App Bridge、Node Bridge
和 Identity 能力整合为一条可持久化的产品链路，并同步 Android 客户端。

- Android versionCode 4，支持同签名覆盖升级并保留登录/配对状态。
- Conversation 使用 Hermes durable Run；断线后通过 Run 状态恢复，不把传输中断误报为完成。
- Android 即时响应 `conversation.status`、`task.*`、`workspace.*` 和工具生命周期事件。
- Workspace 原生 Artifact、图表和任务结果可持久化并在 Web/Android 恢复。
- 保留 CasaOS、Immich、Home Assistant 的安全入口，不复制其完整领域 UI。

验证范围：TypeScript/Web 类型检查、Web 构建、Android `assembleDebug`、服务端测试和 Web
回归均应在发布前执行。当前 APK 仍为 debug 签名包，实体 Android/Tailnet Gate 和 CasaOS
重新认证需要在目标环境单独完成；不要把 debug APK 当作 Play 商店签名包。

发布包不包含凭据、数据库备份、私有配置或 Android 签名密钥。部署前保留 PostgreSQL
备份，并确认 `jarvis-server:0.3.1` 镜像已导入目标 K3s 节点。
