# M1 工程决策

依据根目录两份规划，采用一个 TypeScript 服务进程、一个 PostgreSQL、原生 Android。M2 的 NATS、Capability Registry 和审批不提前实现。

目录中 packages 是单体内部边界，统一由根 package.json 管理依赖；目前只有一个 Node 消费者，不提前构建独立发布流水线。protocol 定义入站消息/载荷校验，system-monitor 负责 Linux，agent-registry 负责状态和会话，llm-usage 负责计量，apps/server 负责 HTTP、认证、调度与数据库装配。

依赖理由：Fastify 提供 HTTP 生命周期与结构化日志；ws 提供标准 WebSocket；pg 提供 PostgreSQL 连接池；Zod 在 HTTP/WS 边界验证数据；tsx 只用于开发/测试。Android 依赖按方案采用 Compose、Coroutines、Serialization、OkHttp、Room、DataStore、Navigation，Keystore 使用系统 API。

Device 只读，Agent 可以写自己注册的 Agent 状态和用量。配对码由服务器 CLI 创建，有效 10 分钟且只能消费一次；数据库只保存配对码和 Token 的 SHA-256。Android 的 Token 经 Keystore AES-GCM 加密后存 DataStore，禁用系统备份。

M1 WebSocket 只实现 request/response/event/error，version=1。所有应答带 reply_to。订阅控制采样推送；连接内缓存最近 256 个应答以去重，重复 ID 配不同请求被拒绝。LLM 用量记录以 UUID 在数据库永久去重；重连后客户端重新读取快照，不承诺断线事件重放。M2 再扩展 streaming、完整持久化事件总线。

统计 today/month 以 UTC 分界，7d/30d 为滚动窗口，custom 为半开区间 [from,to)。缓存输入已包含在 input_tokens 内；reasoning 已包含在 output_tokens 内，不重复计费。没有本地有效价格时 cost=null，并返回 unpriced_requests，不宣称免费。价格在写入请求时固定。

CPU/RAM/GPU 每 2 秒，磁盘每 10 秒，接口每 5 秒；内存中维护最新快照。没有指标或硬件时为 null。IPv6 使用本机稳定 global 地址，不调用外部 echo 服务。公网 IPv4 同样是本机候选地址，NAT 出口未确认。

容器读取宿主机指标需要只读 host root 挂载及 hostNetwork；这扩大了可读面，适用于单人可信节点。无特权、无 root、无 service-account token。HOST 必须绑定 Tailscale IPv4，避免暴露所有接口。GPU 容器采集需节点已安装 NVIDIA Container Toolkit 并配置 runtime，将 nvidia-smi 与驱动库注入容器；未配置时 UI 明确显示不可用。

Android 前台维持连接并根据页面订阅高频状态；后台保留重要事件订阅，Home 可启用用户可见的 foreground service（specialUse，私有云监控用途）。Android Doze/强制停止仍不保证永久 Socket，恢复前台自动连接并拉取快照。未来上架应用商店需审核该前台服务用途；需要锁屏强实时提醒时再增加系统推送。
