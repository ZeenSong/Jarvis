# M2 启动、升级与回退

交付版本为 **0.2.0-rc.1**。真实 Core、Ops、Codex 与双端本地验收已执行；生产 K3s 网络隔离、升级和真机验收尚未执行，详情见 [验收记录](../../docs/m2/acceptance.md)。本套启动脚本针对当前机器的单节点 K3s 与已运行的 M1，不会使用默认 minikube context。

## 当前机器上需要你执行的第一步

```bash
cd /home/root2023/Codes/Projects/Jarvis
bash deploy/m2/start.sh prepare
```

这一步需要输入 sudo 密码：把 root 专属的 K3s kubeconfig 复制为当前用户可读的 `.local/m2.kubeconfig`，权限为 0600。原文件权限和默认 minikube 配置都不变。当前 agent 无法读取原配置，所以生产操作尚未进行。执行后可以让 agent 继续部署，或按下面步骤自行操作。

## 配置与启动

当前机器已准备 `.local/m2.env` 与独立登录文件。搬到其他机器时先复制 `operator.env.example` 为 `.local/m2.env`，填写密钥文件路径和有效 ChatGPT 登录文件路径。凭据文件不包含在交付包内。Codex 默认固定 `gpt-5.6-luna`，low、标准服务，不自动升级模型。

需要专门为 M2 重新登录时，可在首次部署前执行 `CODEX_HOME="$PWD/.local/m2-login" codex login --device-auth`，按终端提示完成浏览器登录。仅复制旧 refresh token 可能因轮换而失效；不要用旧 auth.json 覆盖已续期的专用文件。已初始化的 K3s 登录卷不会被 seed Job 自动覆盖，重置前须停止 Coding 任务并保留当前文件备份。

```bash
# 备份实际数据库，恢复到新建的隔离 PostgreSQL，并验证 M2 迁移不改变 M1 数据。
bash deploy/m2/start.sh backup

# 导入镜像、配置固定 Worker/只读代理、增量升级 Gateway。
bash deploy/m2/start.sh deploy

# 为 Web 或 Android 分别生成一次性配对码。
bash deploy/m2/start.sh pair
bash deploy/m2/start.sh status
```

`deploy` 要求本集群 24 小时内的备份与恢复验证成功记录。Node.js 22、Docker、kubectl、gzip 与本机 K3s 必须可用；镜像导入也需要 sudo。服务地址沿用原 M1 Tailnet 地址，Web 直接打开 `http://<Tailnet IP>:8080`。已配对 Android 设备可同签名覆盖安装 APK，保留原配对与缓存。完成 [双端 Demo](../../docs/m2/demo.md) 后再把版本标记为正式上线。

在新目录解压源码时先运行 `npm ci`。镜像包与 APK 位于 `artifacts/`；进入该目录运行 `sha256sum -c M2-SHA256SUMS` 可核对交付文件。重新打包使用 `node deploy/m2/package.mjs`。

脚本会自动读取原 Tailnet 监听地址和 Gateway Pod 的节点源地址；不会把二者混用。`render.mjs` 生成 `.local/m2-deploy/`，可在应用前检查。实际 CNI 对 hostNetwork 的策略行为仍须验证；Docker 验收不替代 Kubernetes 验收。

## 凭据与隔离边界

- Gateway 保留 M1 数据库、宿主只读监控与配对能力，不持有 Kubernetes token。
- Controller 仅有 `jarvis-workers` 内 Jobs、PVC、Pod/日志的有限权限，不接收任意镜像、命令或挂载。
- Ops 只连接独立的 `ops-read-gateway`；该代理只转发五类已鉴权只读工具，拒绝其他路径、任意 URL 和重定向。Ops Worker 不直接访问生产 Gateway 或数据库。
- Coding 独立工作卷只拉取配置的 HTTPS 仓库和 40 位提交，不复制当前未提交内容。Worker 无宿主目录、Docker socket、数据库或 Kubernetes 凭据。
- `codex-auth` 是专用持久卷，仅保存必要登录字段。初始 Secret 只负责首次导入，不覆盖已有续期文件；Worker 原子保存刷新后的登录，避免下一次重复使用失效的旧 refresh token。不要用旧备份覆盖当前登录。凭据失效会明确报错，需要提供重新登录后有效的 auth.json。
- 默认 Coding/Ops 各并发 1；任务超时为 30/5 分钟，工作区 24 小时，详细事件与产物 30 天；消息、摘要与用量长期保存。模型读取压缩摘要，双端仍能查询完整 Diff 与日志。

Worker Host 在收到归档确认前保持可查询；取消中断模型后仍导出产物。数据库提交后再推送事件，日志序号去重，迟到结果不会覆盖取消状态。重启会明确失败未完成任务并归档、清理存活 Worker；已完成但未清理的 Worker 同样会回收。清理失败保留 `cleanup_pending`，后台继续尝试，不宣称无损恢复执行。

## 回退

```bash
bash deploy/m2/start.sh rollback
bash deploy/m2/start.sh status
```

回退使用备份前记录的服务镜像，保留 M2 增量表与所有 PVC，不回灌旧备份覆盖新数据。回退前若 Gateway 可用，应先在任务页面取消活动任务并等待结果归档。若 Gateway 已不可用，回退后检查活动 Job；控制器停止期间尚存 Job 最迟受 30/5 分钟 deadline 限制，工作卷保留供检查。生产故障下的这一流程尚待演练。

## 验证脚本

- `preflight.mjs`：显式 K3s 核对、记录原镜像和备份，不升级服务。
- `verify-backup.mjs`：在新建的无网络 PostgreSQL 中恢复并校验数据，结束后删除测试容器和卷。
- `render.mjs`：只生成清单，不访问集群、不输出凭据。
- `tests/check-m2-delegation.ts`：显式启用的真实模型验收，使用独立 Docker Worker；会消耗模型额度。
