# M3.2 家庭服务凭据准备（2026-09-26 历史诊断）

诊断日期：2026-09-26；2026-09-27 已将凭据录入、连接验证和撤销反馈部署到 `jarvis-server:0.3.1-m32-20260927-r13`。当前没有代用户创建上游用户或服务 token，也没有把任何历史 token/password 写入 Jarvis。未读取 HA `.storage`、Frigate JWT 签名文件、Immich 认证表或包含凭据的容器日志。

2026-09-29 现状复核：生产 PostgreSQL 的加密 Integration Credential Store 中有 Home Assistant 1 条、Immich 1 条有效凭据，Frigate 0 条；检查仅统计 provider 和有效记录数，未读取凭据值。该存储与 `jarvis-integrations` Kubernetes Secret 不同。以下表格和诊断结论是 2026-09-26 的历史快照，不代表当前凭据数量，也不证明现有凭据已通过上游连通性测试。

## 2026-09-26 已核实的线上状态（历史快照）

| 项目 | 证据与结果 |
| --- | --- |
| Jarvis 凭据表 | 在线 Pod 内使用已有 DB 连接，当日有效凭据为 0；验收用临时记录已正式撤销并仅保留审计状态；未读取密文 |
| Jarvis 环境 | 当日 HA/Immich/Frigate token、FRIGATE_PASSWORD、INTEGRATION_CREDENTIAL_KEY 均为空；仅打印是否存在 |
| 服务地址 | HA `http://100.77.157.73:8123`，Immich `http://100.77.157.73:2283`；FRIGATE_URL 未配置 |
| Secret | `jarvis/jarvis-secrets` 存在，`integration-credential-key` 已准备并由 r13 加载；只读检查不输出 Secret 内容 |
| Home Assistant | 2026.5.4；挂载 `/DATA/AppData/homeassistant/config:/config`；无凭据 GET `/api/` 返回 401 |
| Frigate | 容器运行代码版本 `0.18.0-77a66e7`；挂载 `/DATA/AppData/frigate/config:/config`；认证端口 8971 自签名证书，默认 TLS 校验失败；未绕过校验登录 |
| Immich | 容器镜像 v2.7.2；无凭据 GET `/api/server/version` 返回 200，`/api/users/me` 返回 401 |

这些结果仅说明配置缺失、公开端点可达及源代码能力，不能证明认证后的读操作成功，更不能称为已部署。

## 可审查脚本

`scripts/provision-integrations.mjs` 不依赖第三方包。默认仅输出不含秘密的正式 API 请求模板与前置条件，不访问网络。服务用户和服务 token 的创建目前只有请求计划，**没有可执行创建分支**，避免在权限与数据范围未确定时创建错误凭据。

```sh
node scripts/provision-integrations.mjs --plan
KUBECONFIG=.local/m2.kubeconfig node scripts/provision-integrations.mjs --check-key
node --test scripts/provision-integrations.test.mjs
```

`--check-key` 读取指定 Secret，验证现有 key 或报告缺失；不会生成真实随机密钥。Secret API 必须返回对象，因此其他 data 字段会进入进程内存，但不会被打印、保存、解码使用或写回。未读取服务历史凭据。

以下命令已在目标集群执行；它只补齐 Jarvis 自身的加密主密钥，不创建任何上游服务账号：

```sh
KUBECONFIG=.local/m2.kubeconfig node scripts/provision-integrations.mjs --ensure-key --execute
```

该模式只操作现有 `jarvis/jarvis-secrets` 的 `data.integration-credential-key`，随后通过 `--check-key` 复核：

- 已有合法值直接复用，不生成新值、不写入。已有空值或非法值则报错，禁止自动轮换。
- 缺失时生成随机 32 字节密钥，先转 base64url（Jarvis 所需格式），再转 Kubernetes data 的 base64。
- 使用 JSON Patch，仅新增该字段；`data` 缺失时仅建立包含该字段的 data 对象。
- 同一个 patch 先 test `metadata.resourceVersion`，防止检查后并发写入造成覆盖。冲突或失败不自动重试；重新运行检查后再决定。
- patch 写入临时文件后交给 kubectl，不放进命令行；临时文件在命令结束后删除，不输出值，也不透传可能包含 patch 内容的 kubectl 错误。失败/超时可能已提交，应先重新检查，不应假设未写入。
- 不新建整个 Secret，不改其他键，不操作 Deployment，不重启 Pod，也不创建服务账号或 token。

使用前核对 kubeconfig 指向正确集群。环境变量引用的 Secret 不会自动刷新到运行中的进程；本次已单独滚动重启并确认 r13 加载成功。不可直接全量 apply 当前工作区清单以免覆盖其他线上设置。

普通用户现在可在 Jarvis 首页打开“待处理”→“家庭服务连接”，选择 Home Assistant、Frigate 或 Immich，录入上游已创建的凭据；列表只显示服务名、标签和“已加密保存”，不会回显 secret。真实 Chrome 已验证空状态和不泄露秘密。该次历史验收时三个上游凭据均为空，所以当时 live smoke 对三项 provider 为 SKIP；当前状态见本文顶部的 2026-09-29 复核。

## Home Assistant：独立只读身份可创建，但不是全 API scope token

运行容器源码确认正式 WebSocket API 支持：

1. 管理员已认证会话调用 `config/auth/create`，指定 `group_ids: ["system-read-only"]`。
2. `config/auth_provider/homeassistant/create` 为新 user_id 绑定独立用户名/新密码。不修改已有用户。
3. 通过正常登录流程进入新服务用户，调用 `auth/long_lived_access_token`（脚本模板 lifespan=365 天）。token 绑定调用者，不能在管理员会话中直接生成后声称只读。
4. 检查该账号非 owner、无其他权限组，再读取 `/api/states`。到期前通过同一正式流程轮换服务 token。

本机 `auth/permissions/system_policies.py` 的 READ_ONLY_POLICY 仅允许实体 read；普通 `system-users` 是实体全权限，不能当只读。HA 权限集中于实体，不能据此宣称所有扩展/非实体 API 均禁止写入。若要求凭据在所有 API 上严格只读，需另行审查/设计只允许必要读路由的隔离代理；此次未实现或部署。

缺少：一次由管理员本人完成的账号设置操作（或安全注入的短期会话）、新服务账号安全保管位置、全屋实体可读范围确认。无需用户向聊天粘贴管理员密码或历史 token；不猜密码、不修改 `.storage`。

依据：[HA 认证 API](https://developers.home-assistant.io/docs/auth_api/)、[HA 权限模型](https://developers.home-assistant.io/docs/auth_permissions/)，以及运行版本的 `components/config/auth.py`、`auth_provider_homeassistant.py`、`components/auth/__init__.py`。

## Immich：细分只读 key 可行，照片授权范围尚缺

v2.7.2 运行代码确认 `POST /api/api-keys` 支持 `name`、`permissions`。应在独立非管理员服务账号的正常会话中创建，最小权限为 `asset.read`（metadata/smart 搜索）和 `asset.view`（缩略图）。不授予 `all`、写入/删除或管理 API key 权限。创建操作自身需要有 `apiKey.create` 的合法会话；不应把这个权限加给最终服务 key。

API key 仍受所属用户可见数据约束，不是创建后自动可见家庭全部照片。容器 `search.service.js:getUserIdsToSearch` 当前查询本人以及开启时间线可见性的 partner 用户。单纯分享相册并不足以证明现有 Jarvis 搜索能检索该相册；新建空服务账号会返回空结果。

缺少：服务账号身份、明确允许搜索的照片所有者/库范围，以及与当前搜索适配器兼容的授权方式。若用户只同意选定相册，不能擅自升级成整个 partner 照片库授权；需要后续适配搜索路径。账号创建与授权应由管理员通过正常 UI/正式 API 完成。本次不访问 Immich Postgres 认证表。

依据：[Immich API](https://docs.immich.app/api/)、[创建 API key](https://api.immich.app/endpoints/api-keys/createApiKey)；权限和搜索可见范围已与本机 v2.7.2 controller/service 源码核对。

## Frigate：只读账号可行，持久接入目前有阻塞

运行源码确认管理员可经认证端口调用 `POST /api/users` 创建独立用户，`role: viewer`；若仅允许部分摄像头，应先通过正式配置/UI 建立对应 custom role。Viewer 可以读取全部摄像头，因此必须先确认这个范围被允许。

新账号经 `POST /api/login` 获得 cookie JWT，可用于 Bearer。它会过期，不是永久 API key。Jarvis 当前 `hermes-integrations.ts` 只发送固定 Bearer 或 Basic，没有登录/刷新与保存刷新后 token 的逻辑；Frigate 当前认证代码接受 Bearer/cookie，不能假定 Basic 能替代登录。把会话 JWT 存入 `integration_credentials` 只解决加密保存，不解决续期。

缺少：专用 viewer/custom-role 账号、授权摄像头范围、可信 TLS 地址/CA、明确的续期实现方案。当前 8971 自签名校验失败，需要安装正确 CA 或配置受信证书，不能将跳过 TLS 校验作为正式方案。5000 是无认证接口，不作为只读权限替代。也不读取 JWT 签名 secret 自行签发 token。

在不改运行代码、无独立续期机制的本次范围内，**Frigate 无法交付已验证的持久认证接入**。可后续审查独立凭据续期进程或运行适配器改造，当前不执行。

依据：[Frigate 认证与角色说明](https://docs.frigate.video/configuration/authentication/)，以及运行版本 `/opt/frigate/frigate/api/auth.py` 的 create_user/login/auth 实现。

## 后续持久化与验收（未执行）

先补齐上述身份、权限范围、TLS 和续期缺项。管理员/用户在正式服务端创建专用身份与权限受限 token，仅把新服务凭据安全提供给配置流程，不共享历史个人宽权限凭据。

主密钥生成并实际加载后，使用正确家庭成员的 Jarvis 已认证会话调用 `POST /api/v2/integration.credential.put`，provider 分别为 `home-assistant`、`immich`、`frigate`。服务 token 经现有 AES-256-GCM 存储；metadata 可记录账号、权限、上游 key ID、到期日，但不能放秘密。不要绕开身份鉴权直接 INSERT 数据库，也不要使用全局 token 环境变量作为家庭隔离替代。

首次提交前记录稳定 credential_id，重试保持同一 ID；检查是否已有有效凭据，避免自动覆盖其他凭据。当前读取逻辑使用同家庭同 provider 最新有效项，metadata 并不实施上游权限限制；应由上游实际 scope/角色保证。

验收需包括：目标家庭读取成功、其他家庭不能读取该凭据、权限与授权照片/摄像头范围一致、重启后仍可读、Frigate 超过原 JWT 有效期后仍能正常访问、凭据撤销后拒绝访问。真正的写权限拒绝验证应在隔离资源/测试环境执行，不能对家庭设备发真实开关命令来测试。这些验收本次均未完成，当前仍是准备阶段。

主密钥必须单独加密备份并长期复用；已有密文后不可删除或替换。撤销上游服务 key 与撤销 Jarvis 凭据记录是两件事，后续回滚需分别处理；此脚本没有删除或轮换操作。

2026-09-27 补充：r14 的 Frigate 凭据输入支持 Bearer token，或 `{"username":"…","password":"…"}` 形式的 viewer 账号；Jarvis 仍只保存加密密文，不创建上游账号。
