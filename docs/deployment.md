# 单节点 K3s 部署

前提：目标 Linux 已有 Tailscale、K3s、可用存储类，服务由 systemd 开机启动；GPU 节点已安装驱动。不要把开发机现有集群上下文误当作目标环境。

## 构建与导入

```bash
docker build -f apps/server/Dockerfile -t jarvis-server:0.1.0 .
docker save jarvis-server:0.1.0 -o jarvis-server-0.1.0.tar
sudo k3s ctr images import jarvis-server-0.1.0.tar
```

若使用镜像仓库，修改 deploy/k8s/server.yaml 的 image 为实际地址。单节点默认一个副本，Recreate 避免 hostNetwork 端口冲突。

## Secret

先创建 namespace，再在目标服务器创建 Secret；不要提交真实凭据：

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl -n jarvis create secret generic jarvis-secrets \
  --from-literal=postgres-password='<强随机密码>' \
  --from-literal=database-url='postgres://jarvis:<URL编码后的密码>@postgres:5432/jarvis' \
  --from-literal=tailscale-ip='100.x.x.x'
kubectl apply -k deploy/k8s
kubectl -n jarvis rollout status statefulset/postgres
kubectl -n jarvis rollout status deployment/jarvis-server
```

HOST 只绑定给定 Tailscale IPv4。Postgres 仅 ClusterIP，无 NodePort。hostNetwork 网络策略行为取决于 CNI；宿主机 nftables/Tailnet ACL 应限制访问者。配置中保留 readiness、liveness、startup probe 和资源限制；日志为 stdout JSON。

GPU：K3s 中已定义 NVIDIA RuntimeClass 后，使用 `kubectl apply -k deploy/k8s-nvidia`。该 overlay 指定 `runtimeClassName: nvidia` 并启用 utility capability，不为监控独占整张 GPU。部署后必须检查 `gpu` 返回真实型号和数值；null 表示未成功采集，不能勾选 GPU 验收。

```bash
kubectl -n jarvis exec deployment/jarvis-server -- node dist/apps/server/src/pair.js
kubectl -n jarvis exec deployment/jarvis-server -- node dist/apps/server/src/pair.js --agent
```

## 重启与故障验收

使用 `docs/m1-acceptance.md` 记录实际结果。依次执行 Jarvis 容器终止、PostgreSQL 重启、K3s 重启、目标服务器重启；每次确认 live/ready、手机恢复在线、历史记录仍存在。仅在目标机维护窗口执行 K3s/宿主机重启。

故障定位：`kubectl -n jarvis get pods`、`kubectl -n jarvis logs deployment/jarvis-server`、`kubectl -n jarvis describe pod ...`。数据库不可达时 ready=503，但 live 仍为 200，避免将数据库故障误判为进程死亡。

备份：使用 pg_dump 输出到独立存储，验证恢复后再安排定期执行。卸载 Deployment 不应删除 PostgreSQL PVC；删除 PVC 会丢失设备、Agent、事件及用量历史，需单独明确处理。
