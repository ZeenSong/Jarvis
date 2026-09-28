# Authentik 部署

## 当前主机的持久化部署

入口：`http://100.77.157.73:9000/`（仅绑定 Tailnet 地址）。Jarvis 登录页的
“使用 Authentik 登录”通过 OIDC 返回 `http://100.77.157.73:8080/`。

```bash
node scripts/authentik-live.mjs up
node scripts/authentik-live.mjs status
node scripts/authentik-live.mjs configure
```

`up` 首次生成数据库密钥、服务密钥和管理员 `akadmin` 的随机初始密码，保存在
`jarvis` namespace 的 `jarvis-authentik` Secret。后续运行复用这些值，不重置密码。
`configure` 创建 Jarvis OIDC 应用并更新 Jarvis 部署的认证环境变量，不改变其镜像。
数据库位于 `jarvis-authentik_authentik-postgres` 持久卷，不能按临时测试数据清理。
密码字段为 `AUTHENTIK_BOOTSTRAP_PASSWORD`；通过集群管理权限读取后首次登录应修改。
Authentik 管理员身份不会自动提升为 Jarvis 管理员，本地 Jarvis 管理员账号继续保留。

以下为其他环境部署和隔离验证说明。

M3.2 的身份提供商边界已落到 Jarvis 配置和 OIDC Contract：Authentik 负责
认证、MFA 和 OIDC；Jarvis 仍负责 `admin/member`、Household、Capability、Approval
和 Service Credential。

## 配置

### Docker PoC

本目录提供一个不依赖 k3s 的最小 Compose 栈。先复制 `.env.example`，填入随机的
`AUTHENTIK_POSTGRES_PASSWORD` 和至少 50 字符的 `AUTHENTIK_SECRET_KEY`，再执行：

```bash
docker compose --env-file .env -f deploy/authentik/compose.yaml up -d
```

首次启动后打开 `http://127.0.0.1:9000/if/flow/initial-setup/` 完成 Authentik
管理员初始化；不要把初始化密码写入 Compose 文件。停止并清理这个 PoC 时只针对该
Compose 项目执行 `docker compose ... down`，是否删除 `authentik-postgres` 数据卷应由
部署者明确决定。

在 Authentik 中创建一个 OIDC Provider/Application，并把回调地址配置为：

```text
https://<jarvis-host>/api/v2/auth/oidc/callback
```

Provider 需要绑定 Authentik 内置的 `openid`、`profile`、`email` scope mappings，
否则 userinfo 端点不会返回 Jarvis 所需的用户声明。客户端可以使用 public + PKCE；
若部署选择 confidential client，再同时填写 `AUTHENTIK_CLIENT_SECRET`。

Jarvis 服务端设置：

```text
AUTHENTIK_ISSUER=https://<authentik-host>/application/o/jarvis
AUTHENTIK_CLIENT_ID=<provider-client-id>
AUTHENTIK_CLIENT_SECRET=<provider-client-secret>
AUTHENTIK_REDIRECT_URI=https://<jarvis-host>/api/v2/auth/oidc/callback
AUTHENTIK_OIDC_SCOPES=openid profile email
```

启动后检查 `GET /api/v2/auth/oidc/status`，再从
`GET /api/v2/auth/oidc/start` 开始 Authorization Code + PKCE 流程。回调会：

1. 通过 discovery 获取 authorization/token/userinfo endpoints；
2. 用一次性 state 和 S256 PKCE verifier 防止回调重放；
3. 通过 `(issuer, subject)` 映射到稳定 Jarvis `user_id`；
4. 将用户加入默认 Household，并发行 Jarvis 自己的 session；
5. 不把 Authentik access token 当作 Home Assistant/Immich/CasaOS 凭据。

## Break-glass

`/api/v2/auth/login` 的本地管理员登录保留为故障恢复入口。它与 OIDC 映射共用
`users`、`user_sessions` 和 `household_members`，因此恢复后不会产生第二个 Jarvis
或第二套用户资源归属。

## 不在此 PoC 中做的事

不把 Authentik group 直接当作 Jarvis Capability 权限，不为每个家庭成员创建
Hermes profile，也不要求 M3.2 重写 CasaOS、Home Assistant 或 Hermes Dashboard
的内部身份系统。
