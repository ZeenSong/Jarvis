# Jarvis 0.3.0-preview.1

M3 当前工作版本预览，供实际使用反馈；不是 M3 完整验收版。

- Web / Android：首页、空间、应用、任务及 Jarvis 动态工作区，深浅主题。
- 接入真实 CasaOS 已安装应用，展示 Home Assistant、Immich 状态及详情。
- 保留现有配对、任务数据及 M2 Worker；不改动 CasaOS、Docker 应用或主机 APT。
- 动态 UI v2 与任务交互仍在迭代。

已知限制：空间封面是装饰素材；Immich 相册、Home Assistant 实体控制尚未接入。应用生命周期操作、多用户权限、完整审批及 M3 场景验收未完成。Grafana / Portainer 延后。界面与概念图仍有差距。

Android APK 为 debug 签名预览包，versionCode 3；同签名可覆盖安装并保留配对。不要卸载旧版来解决签名不匹配，应先核对签名。Web 沿用现有 Tailnet 地址。

源码包包含本次工作树的源码及资源，不包含凭据、数据库、私有配置或 Android 签名密钥。镜像包仅升级 Gateway，Worker 保持 0.2.0-rc.1。校验文件为 SHA256SUMS。

部署前运行 `bash deploy/m2/start.sh backup`，保留恢复验证记录。Gateway 使用私有可写目录内的 CasaOS 会话文件（0600），通过 `CASAOS_SESSION_FILE` 显式配置；刷新令牌要求目录可写。不要将该目录或凭据发布。

回退 Gateway：使用显式 `.local/m2.kubeconfig` 执行 `kubectl -n jarvis set image deployment/jarvis-server server=jarvis-server:0.2.0-rc.1` 并等待 rollout 完成。保留数据库与 PVC，不回灌旧备份、不停止现有 Worker。此为回退指引，不表示本次已演练回退。
