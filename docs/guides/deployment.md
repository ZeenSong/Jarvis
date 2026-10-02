# 部署指南

> 当前推荐路径是 `deploy/docker/`。`deploy/k8s/` 保留给熟悉 Kubernetes 的维护者，并且必须先按目标环境补齐 Secret、持久目录和网络配置。旧 M2/M3 一次性升级脚本已移除，不能用于当前版本。

## Docker / CasaOS

需要 Docker Compose、Node.js 22+，以及可以持久保存数据的目录。

```bash
git clone https://github.com/ZeenSong/Jarvis.git
cd Jarvis
cp deploy/docker/.env.example deploy/docker/.env
```

按注释填写 `deploy/docker/.env` 以及 `/DATA/AppData/jarvis/config/` 下的服务端、数据库与 Hermes 环境文件，然后启动：

```bash
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yaml up -d
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yaml ps
```

CasaOS 安装入口与服务组成见 [`deploy/docker/README.md`](../../deploy/docker/README.md)。不要把 `.env`、模型 API Key、家庭服务 Token 或运行数据提交到 Git。

## Kubernetes

`deploy/k8s/` 是单节点部署基线，不是可直接套用到任意主机的零配置安装器。应用前至少完成：

1. 构建或推送当前 `jarvis-server` 与 Hermes 镜像，并更新清单中的镜像标签。
2. 创建 `jarvis-secrets`、`hermes-api`、`hermes-provider` 和 `hermes-bridge` 等 Secret。
3. 配置公开回调地址、家庭服务地址、持久卷和节点目录。
4. 检查 `hostNetwork`、Tailnet ACL、防火墙与存储类是否符合目标集群。
5. 使用独立数据库完成迁移与恢复演练后再接入生产数据。

```bash
kubectl apply -k deploy/k8s
kubectl -n jarvis rollout status statefulset/postgres
kubectl -n jarvis rollout status deployment/hermes-core
kubectl -n jarvis rollout status deployment/jarvis-server
```

## 首次登录

打开 `http://<jarvis-host>:8080`，选择首次注册创建管理员账户。当前版本使用账户登录；不要再运行旧的 `pair.js` 或寻找配对码。Android 同样填写服务器地址并使用 Jarvis 用户名与密码登录。

## 上线检查

- `GET /health/live` 与 `GET /health/ready` 均成功。
- 数据库备份已恢复到隔离环境并验证。
- Web 与 Android 登录、刷新和断线恢复正常。
- 家庭服务使用专用最小权限凭据，撤销后 Jarvis 立即拒绝访问。
- 公网未直接暴露明文 HTTP / WebSocket；远程访问使用 Tailnet、反向代理 TLS 或等价保护。
- 日志、截图与问题报告中不包含 Token、Cookie、内网拓扑或家庭画面。

## 升级与回退

升级前记录当前镜像摘要和数据库版本并完成备份。先在隔离数据库运行迁移，再更新单个实例。回退应用镜像不等于回退数据库；只有经过验证的数据库备份才能用于数据回退。不要删除 PostgreSQL 或 Hermes 数据卷来解决启动问题。
