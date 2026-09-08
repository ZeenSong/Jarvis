# Jarvis v0.1.0 — M1 Always-On Personal Cloud

首个 M1 版本，使用者已确认 Android 真机通过 Tailscale 连接服务器，并正确读取运行状态。

- TypeScript 模块化服务端，PostgreSQL 持久化和设备配对认证。
- 系统/GPU/网络监控，WebSocket 实时状态与重连。
- Agent 注册、心跳、任务、会话和事件监控。
- 统一 LLM Wrapper、Token/错误/请求数及历史费用估算。
- Kotlin/Compose Android：Home、Server、Agents、Agent Detail、AI 用量。
- Docker 镜像、K3s 清单及单机部署脚本。

## 下载

- `jarvis-0.1.0-android-debug.apk`：M1 测试 APK，调试签名；需自行配置 Tailscale 地址并配对。
- `jarvis-server-0.1.0-linux-amd64.tar.gz`：从源码构建的服务端 Docker 镜像，不含数据库、卷、运行时配置或凭据。
- `SHA256SUMS`：下载文件校验值。

```bash
sha256sum -c SHA256SUMS
gzip -dc jarvis-server-0.1.0-linux-amd64.tar.gz | docker load
```

部署参见 README 与 docs/deployment.md。无本地 LLM；未配置模型价格时费用显示未知。Android 后台连接受系统省电及强制停止限制。

源码、APK、镜像发布前进行隐私检查，个人密钥、设备地址、本机路径、日志、用量明细及数据库不随版本发布。
