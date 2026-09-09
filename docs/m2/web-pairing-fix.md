# HTTP Tailnet Web 配对修复（2026-09-09）

部署后的浏览器复现：`http://100.77.157.73:8080` 的 `isSecureContext` 为 false，`crypto.randomUUID` 为 undefined，点击配对报错且没有发出请求。本机 localhost 测试没有覆盖这个条件。

Web 的配对设备 ID、消息幂等键与 WebSocket 请求 ID 统一改用 `crypto.getRandomValues` 生成 UUID v4。配对码提交前去除首尾空白。没有降低服务端鉴权要求。

已通过 Web 类型检查、生产构建和端到端回归；回归测试明确禁用 `crypto.randomUUID`，覆盖配对、消息、刷新及重连。服务端镜像及交付包已重建。生产应用需要操作员执行以下命令（镜像导入需要 sudo 密码）：

```bash
bash deploy/m2/fix-web-pairing.sh
bash deploy/m2/start.sh pair
```

随后浏览器强制刷新，用新配对码进入。安卓沿用现有凭据，无需重新安装或配对。修复脚本只重启 Gateway，不运行迁移或重建 Worker 凭据。
