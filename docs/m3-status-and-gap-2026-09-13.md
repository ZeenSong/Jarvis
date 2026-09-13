# M3 开发进度与验收差距（2026-09-13）

## 1. 当前结论与统计口径

**当前阶段：M3 预览版已上线，进入实际使用反馈阶段；M3 尚未完成，也未进入最终 Demo Freeze。**

已经交付的是“产品外壳 + 部分动态 UI + 真实 CasaOS 应用只读入口 + 延续 M2 的任务执行基础”，还不是“安装应用 → 转化为能力 → 跨应用执行 → 审批 → 原生结果 → Memory”的完整产品闭环。

| 项目 | 截至本次核对的事实 |
| --- | --- |
| 已发布版本 | `v0.3.0-preview.1`，源码提交 `8017564`；GitHub Pre-release，非 Draft |
| 发布内容 | Android debug APK、Gateway 镜像包、源码包、发布说明、SHA256SUMS |
| 线上服务 | 现有单节点 K3s 已升级 Gateway；2026-09-13 只读复查 Pod 为 `1/1 Running`、0 次重启，readiness healthy |
| 数据与 Worker | 沿用原数据库、配对及 M2 Worker；发布前数据库备份在隔离 PostgreSQL 中恢复验证成功；没有回灌旧库 |
| CasaOS | 原生 CasaOS 0.4.15 已安装并认证；上线时双端读到 Home Assistant、Immich，线上 Web 详情确认 Immich 4 个服务 |
| Android | versionCode 3，与上一版 debug APK 签名一致，可覆盖安装；模拟器验证不等于用户真机验收 |
| 验收结论 | 原始 M3 §17 的 A–G 七组条件，目前没有一组具备全部通过证据；不以代码量、组件名数量或单测数量计算完成百分比 |

状态定义：**已完成（限定项）**只用于有明确交付证据的窄范围；**部分完成**表示有实现但缺功能或端到端验收；**未完成**不否认相关底层代码存在；**暂缓**表示用户调整执行顺序，不自动改变原始 M3 范围。

本次是代码、历史测试记录、运行截图与线上只读状态核对，没有重新运行完整测试套件，也没有执行应用安装、启停或修改生产数据的验收。

## 2. 对照基线

| 基线 | 用途与冲突处理 |
| --- | --- |
| [M3 Investor Demo Milestone](../dev_guidlines/Jarvis_M3_Investor_Demo_Milestone.md) | 工作包、六个 Demo 场景、测试范围与 A–G 最终验收的主基线 |
| [Product Architecture v2](../dev_guidlines/Jarvis_Product_Architecture_v2.md) | 用户隔离、Capability / Resource / Integration、服务端事实源和五类 Contract 边界 |
| [Experience & Dynamic UI v2](../dev_guidlines/Jarvis_Experience_Dynamic_UI_v2.md) | 双端原生重排、Design System、第三方应用原生化、版本协商与降级 |
| [2026-09-09 概念图](../dev_guidlines/Jarvis_Product_Concept_Images_2026-09-09/) | 视觉和场景参考；不是所有远期示意能力都属于 M3 P0，也不要求复制示意数据 |
| 用户最新安排 | 先发布当前版本，依据实际使用再调整；Grafana / Portainer 暂缓。不得因此宣称原始四 Provider 要求已满足 |

体验文档将 Integration Agent 等列为 P1，但 M3 里程碑将其列入最终验收。因此本报告仍把它们视为 M3 必须补齐的交付，不自行缩减范围。Home Assistant 深度控制、Node Bridge、Voice、Frigate 等不列为当前 M3 阻塞项。

## 3. 五个工作包差距表

| 工作包 / 要求 | 当前实现与证据 | 状态 | 距离 M3 还缺什么 |
| --- | --- | --- | --- |
| WP1：Web Shell、Home、中文 IA | React 首页、空间、应用、任务、Jarvis、系统入口；真实状态、应用、活动；已部署并截图 | 部分完成 | 统一登录、审批/通知、完整 Integration 页；页面内容和视觉质量验收 |
| WP1：Android Shell | 原生 Compose Home / Apps / Tasks / Jarvis，原生应用详情 Sheet，空间入口，主题与导航 | 部分完成 | 真机完整路径；顶部留白、控件风格、信息密度、任务与审批完整体验 |
| WP1：Design System、深浅主题 | Web CSS、Android JarvisTheme、共享视觉方向、原生图标、装饰封面；双端主题可切换 | 部分完成 | 完整 Token / 组件状态规范、跨端视觉检查；不能把配色一致等同于设计系统验收 |
| WP1：Space / System | 系统监控基础已有；六类空间入口和说明 Sheet | 部分完成 | 空间缺真实资源内容与操作。照片封面不是个人照片，文件入口不是文件浏览器 |
| WP2：协议、Intent、View / Section / Layout | `ui-protocol-v2` 有 2.0 候选 Schema、角色、资源路径/版本绑定、Intent、布局规则 | 部分完成 | 协议与数据语义正式冻结、兼容矩阵、Integration UI Semantics 与 Composer 完整链路 |
| WP2：双端 Renderer | Web 多面板及可调整侧栏；Android 单列与 Sheet；部分组件沿用 v1 映射，另有专用 Task / List / Log / Timeline / Gallery | 部分完成 | 同一真实 Server Incident ViewSpec 的双端场景验收；不能用 v1 桥接或 Schema 名称证明全部组件已交付 |
| WP2：协商、fallback、异常隔离 | 协议范围、组件版本、feature 检查；未知组件降级；部分畸形数据与长列表测试 | 部分完成 | 全核心组件数据边界、重连恢复和跨版本矩阵；≥12 个“高质量双端组件”的逐项证据 |
| WP2：Action / Approval | 有动作分组、危险动作客户端确认及既有任务输入/取消 | 部分完成 | 服务端持久化审批、授权、幂等执行、审计、重启恢复及双端待办；确认弹窗不等于 Approval 系统 |
| WP3：CasaOS 安装与认证 | 原生安装完成；会话私有保存，刷新重试；生产显式挂载专用可写会话目录 | 已完成（限定项） | 当前仍是单一配对所有者桥接，后续需用户身份、凭据管理和长期异常处理 |
| WP3：CasaOS Installed / Detail | 已上线真实应用列表、状态、服务数量及原生只读详情；不向客户端发送 Compose 凭据 | 已完成（只读子集） | 完整 App Detail 的 Capabilities / Resources / Actions / Logs / Integration / Advanced Console |
| WP3：CasaOS Store / install / start / stop / update / logs | Adapter 有商店、更新、日志及生命周期方法；历史真实商店读取验证已有记录 | 部分完成 | 商店产品界面、授权动作、审批/Task/事件及真实安装启停验收；API 方法存在不代表用户能使用 |
| WP3：Immich | 服务已安装；Adapter 有 search / albums / timeline / thumbnail、Photo 归一化；双端 Gallery 与短期媒体接口有基础 | 部分完成 | 用户级凭据与照片权限、运行时 Provider → 媒体发布 → Gallery 接线、真实照片搜索/相册/时间线与推荐场景 |
| WP3：Grafana | 未交付真实 metrics.query / alert.list 与原生 Monitoring 场景 | 暂缓 / 未完成 | 待用户恢复优先级后补真实指标、告警与跨应用查询；现有宿主监控不等于 Grafana Integration |
| WP3：Portainer | 未交付真实 container.list / inspect / logs / restart 与原生 Container 场景 | 暂缓 / 未完成 | Provider、资源模型、日志与有审批的重启；现有 Worker 控制器不等于 Portainer Integration |
| WP3：统一 Integration / Capability Registry | 当前已有专用 Adapter 与固定入口，但未形成通用可查询 Registry | 未完成 | 稳定 Contract、Provider 替换、版本、风险/审批策略、availability、资源语义及管理界面 |
| WP4：Integration Agent Proof | 现有 Core / Coding / Ops 不构成 Integration Agent；没有完整自动适配证据 | 未完成 | 新 App 发现 → API/OpenAPI → 只读 Candidate → Sandbox → 自动测试 → Approval → Registry → 原生 UI，真实跑通一次 |
| WP5：多用户与身份 | 当前仍为设备配对、设备令牌和 Web session；CasaOS / Immich 账号不是 Jarvis 用户体系 | 未完成 | Jarvis 注册/登录、管理员/成员、用户管理、用户级 Conversation / Task / Memory 隔离及旧数据归属迁移 |
| WP5：Memory | 既有会话上下文/摘要可复用，但没有满足要求的用户/环境/能力长期 Memory | 未完成 | 持久化、用户隔离、更新纠正、Core 实际检索使用 |
| WP5：Internal + Web Search | 有任务列表搜索及命令入口；不等于跨资源统一检索 | 未完成 | App / Capability / Task / Conversation / Memory / 文件 / Photo 检索与稳定 Web Provider，同任务组合调用 |
| WP5：Schedule | 有内部定时采样/清理机制，不是用户可管理的 Schedule 产品 | 未完成 | 一次性/每日/每周、启停删除、下次运行、Task/Prompt 绑定与恢复 |
| WP5：Notification / Approval 中心 | 部分任务状态和前端动作基础已有 | 未完成 | 服务端待办/通知、审批生命周期、Android Task / Approval 通知跳转 |
| 横切：Core → Domain Agent → Run | 继承 M2 真实执行基础、事件/子 Run/Artifact、取消与结果展示；当前 Worker 保留 | 部分完成 | 与 M3 Provider / 用户权限 / Approval 集成的完整 Task UI 和连续真实验收 |
| 横切：发布与回退 | 预览版构建、部署、GitHub 附件、校验、备份恢复验证已执行 | 已完成（预览交付） | 最终 M3 验收报告、真实场景回归、最终版本冻结；本次没有演练线上回退 |

## 4. A–G 最终验收核对

| M3 §17 | 判断 | 已有基础 | 尚未满足的关键条件 |
| --- | --- | --- | --- |
| A 产品 | 部分达成，未验收 | Home / Jarvis / Task / Apps 已组成可用外壳 | Android 仍偏卡片堆叠，空间和统一处理中心内容不足；概念图视觉验收未通过 |
| B Dynamic UI | 部分达成，未验收 | v2 候选、原生 Renderer、协商与 fallback | 协议冻结、≥12 个高质量组件清单、同一真实 Incident 跨端验收 |
| C CasaOS | 部分达成，未验收 | 已安装应用与原生只读详情；商店 API 基础 | 用户能在 Jarvis 内完成 Store → install → start / stop |
| D Integration | 未达成 | Immich Adapter 和 UI/媒体基础 | Grafana / Portainer / Immich 三个完整真实 Integration、可查询 Registry、原生默认操作路径 |
| E Integration Agent | 未达成 | 可复用现有 Agent 执行基础 | 至少一次真实发现、生成、验证、审批、注册与生成 UI |
| F Core | 未达成 | 既有 Conversation、内部调度、设备认证基础 | 多用户登录、Core 使用 Memory、Internal + Web Search、用户 Schedule |
| G Agent | 部分达成，未验收 | M2 真实 Core/Domain 执行与当前任务 UI | M3 完整 Task / Approval / Provider 过程及结果回到 Conversation / Workspace |

因此，**当前可发布给用户试用，但不能标记“v0.3.0 正式 M3 完成”**。用户暂缓两个 Provider 是排期调整；若将来决定缩减 M3，需要显式修订基线。

## 5. 概念体验与当前界面的差距

| 对照维度 | 当前实际效果 | 与概念/体验要求的差距 | 验收方式 |
| --- | --- | --- | --- |
| Web 首页（概念 05） | 已有侧栏、山景命令区、状态卡、六空间、应用、任务和活动 | 缺个性化用户区、通知/审批；指标趋势/网络信息与空间真实数量不足，应用仍是只读入口 | 固定桌面视口逐区域截图对照，数据均来自真实服务 |
| Android 首页（概念 01/04） | 原生底部导航、Orb、主题、状态与空间卡 | 最新运行截图仍有较大顶部留白、显眼主题按钮、默认 Material 风格残留；首屏信息密度和层级需调整 | 真机/模拟器统一尺寸，检查首屏、滚动、字体缩放、触控与主题 |
| 原生应用体验（概念 02/03/04） | HA / Immich 运行状态及只读详情 | 尚无照片浏览、容器分析、指标/日志操作；仅状态卡不足以证明 L1/L2，甚至未覆盖完整 L0 的启停/日志/fallback | 用户不打开第三方后台即可完成核心任务 |
| Dynamic Workspace（概念 05） | 多面板、任务摘要、时间线、资源/动作及布局持久化 | 主要是 Task 视图；尚无 Grafana + Portainer + 系统事件组成的真实异常分析 Workspace | 一个服务端 Incident ViewSpec 同时在 Web 与 Android 展示并操作 |
| 空间内容 | 装饰封面与诚实的未接入说明 | 照片/文件/知识/家庭/媒体尚非真实空间产品；不能把封面当用户照片或把导航当能力 | 以 M3 必需照片/搜索场景为先，其他远期空间不扩大为强制范围 |
| 任务全过程 | 取消、输入、事件、子任务和结果有基础 | 后端审批、通知待办、跨应用步骤与完整恢复尚缺 | 真实任务中断/重连后可观察，审批只能按权限执行一次 |

概念图中的应用数量、照片数量和人物信息是示意，不作为上线数据目标。视觉改进必须同时保持真实数据和明确空状态。

## 6. 六个 Demo 场景差距

| 场景 | 现状 | 不能宣称完成的原因 |
| --- | --- | --- |
| 1 登录 → Home | 部分跑通；设备配对后 Home 真实可用 | 不是 M3 多用户登录，缺审批/通知基础；不计作完整 M3 Scene 1 |
| 2 昨晚服务器是否异常 | 系统监控与任务分析基础存在 | 无 Grafana + Portainer + 系统事件联合查询及真实 24h Incident 双端结果 |
| 3 Immich 资源分析 → 重启审批 | 可看到 Immich 运行状态与服务数 | 缺容器资源/日志关联、原因分析、服务端审批及重启动作 |
| 4 旅行照片搜索与推荐 | Adapter、Gallery、媒体接口基础 | 没有真实照片搜索到原生结果的闭环；没有 Display Queue 产品路径 |
| 5 学习新 App | 未跑通 | 缺发现、生成六个 Capability、Sandbox 测试、审批、Registry 与生成 UI |
| 6 Task / Agent 全过程 | M2 执行与任务展示基础较多 | M3 跨应用、完整 Approval 与连续 Demo 证据不足 |

原始要求是“至少四个自动化 Demo 路径”。目前已有页面/组件/任务专项测试，**尚无四个完整 M3 场景自动化通过证据**，不能将这些专项测试直接相加替代。

## 7. 数据模型与架构 Contract 差距

| 要求 | 当前基础 | 冻结前必须补齐 |
| --- | --- | --- |
| Core Data Model | Device、Conversation / Message、Agent / Run、Event、Resource、View、Artifact 等已有表或协议 | User / Memory / Integration / Capability / Approval / Notification / Schedule 等完整语义；用户归属、版本和 Schema 测试 |
| Dynamic UI v2 Contract | View / Section / Layout、Intent、协商、资源修订绑定 | 稳定组件数据协议、双端支持矩阵、迁移/降级约定与正式冻结记录 |
| Integration Contract | CasaOS、Immich 专用客户端及部分归一化 | 通用 Provider / Resource / Capability / Action / UI Semantics 与可查询 Registry |
| Agent / Skill / Capability Contract | M2 Agent Registry、运行时解耦和固定工具 | 通用 Capability 的 input/output schema、risk、approval_policy、availability、version 与 Skill 组合 |
| Task / Event Contract | Run 持久化、父子关系、事件和结果恢复基础 | 用户权限、Approval / Notification 与跨 Provider 事件统一；重连/重启的完整恢复验收 |
| 服务端事实源 | 任务/会话大体以服务端为准，客户端保存主题和布局 | 新增 Memory/审批/通知等也须服务端持久化；媒体临时授权目前仅设备级、内存态，不等于用户级照片权限 |

## 8. 证据及其适用范围

| 证据 | 已证明 | 未证明 |
| --- | --- | --- |
| 2026-09-12 发布前 `npm test`：38 passed、0 skipped | 已覆盖的服务端协议、任务、迁移、媒体访问等回归通过 | 多用户、Memory、Search、Schedule、Registry 等未实现模块不因测试通过而完成 |
| 发布前 TypeScript/Web 检查、镜像构建与 APK 构建 | 当前发布产物能够构建 | 完整功能与视觉验收 |
| Web 真 CasaOS 专项与 Android `M3ApplicationsEndToEndTest` | 隔离 Jarvis 测试库连接真实 CasaOS 的应用读取、详情等路径 | Android 生产连接/用户真机全路径，六个 M3 Demo |
| DynamicV2 / Gallery / Timeline 等专项 | 部分协商、fallback、滚动、错误状态与交互 | 全组件质量、真实 Immich 照片成功加载；Gallery 失败状态测试不等于真实相册验收 |
| 线上 Web smoke（2026-09-12 23:38 +08:00） | 生产首页、封面解码、HA / Immich、原生详情，无页面脚本错误 | 未执行应用写操作、照片搜索或完整 Agent Demo |
| 2026-09-13 Pod / readiness 复查 | 服务当前健康；Release 非草稿、附件已上传 | 每个 Provider 当前都健康、长期稳定性或回退演练 |
| 数据库备份与隔离恢复验证 | 本次升级前备份能恢复，校验涉及的 M1 数据未被迁移改变 | 完整整机灾备；不扩大为 M3 之外的灾备承诺 |

主要代码入口：

| 范围 | 源码 |
| --- | --- |
| 产品外壳 | [Web product.tsx](../apps/web/src/product.tsx)、[Android ProductScreens.kt](../apps/android/app/src/main/java/cloud/jarvis/app/features/ProductScreens.kt) |
| Dynamic UI | [协议](../packages/ui-protocol-v2/src/index.ts)、[Web Renderer](../apps/web/src/dynamic-v2.tsx)、[Compose Renderer](../apps/android/app/src/main/java/cloud/jarvis/app/dynamicui/SemanticView.kt) |
| CasaOS | [Adapter](../packages/integration-casaos/src/index.ts)、[服务端桥接](../apps/server/src/applications.ts) |
| Immich / 媒体 | [Immich Adapter](../packages/integration-immich/src/index.ts)、[临时媒体接口基础](../apps/server/src/media.ts)、[Gallery](../apps/web/src/gallery-view.tsx) |
| 数据模型 | [M2 增量表](../apps/server/src/m2-migration.ts) |
| 发布 | [发布说明](../deploy/m3/release-notes.md)、[预览部署脚本](../deploy/m3/deploy-preview.mjs)、[打包脚本](../deploy/m3/package.mjs) |

发布产物：[GitHub v0.3.0-preview.1](https://github.com/ZeenSong/Jarvis/releases/tag/v0.3.0-preview.1)。

以下证据仅存在开发主机的 git-ignored `.local`，不包含在公共源码包；新克隆仓库中链接不可用。生产截图可能含私人活动，未上传公共 Release：

- [生产 Web 首页](../.local/m3-release-0.3.0-preview.1/production-web-home.png)
- [生产 Immich 详情](../.local/m3-release-0.3.0-preview.1/production-web-immich.png)
- [生产 smoke 记录](../.local/m3-release-0.3.0-preview.1/smoke.json)
- [Android 真实 CasaOS 测试首页](../.local/evidence/m3-android-live-home.png)
- [Android 真实 CasaOS 测试详情](../.local/evidence/m3-android-live-app-detail.png)

## 9. 下一轮建议（待实际使用反馈确定，不代表本次开始实施）

| 顺序 | 建议工作 | 完成判据 |
| --- | --- | --- |
| 1 | 先处理预览版实际使用阻塞：连接/刷新、崩溃、布局、空错误状态、任务入口 | 用户可稳定完成已有功能；双端真实截图与回归记录 |
| 2 | 收敛用户身份、数据归属与服务端 Approval 最小闭环 | 不再用设备配对代替多用户；写操作可授权、审批、恢复、审计 |
| 3 | 完成 CasaOS 管理纵切 | 商店 → 安装审批 → Task → App Detail → stop / start → Activity，无 CLI 补步骤 |
| 4 | 完成 Immich 照片纵切与统一检索基础 | 用户授权照片 → 搜索 → 原生 Gallery/详情；Core 实际使用，非装饰图 |
| 5 | 补 Memory、Search、Schedule、通知与 Registry | 满足 WP5 最小功能，并有持久化、隔离及恢复测试 |
| 6 | Integration Agent 只读证明 | 一个真实 App 完整自动发现/生成/测试/审批/注册，产生原生 UI |
| 暂缓项 | Grafana / Portainer | 等用户恢复优先级；最终按原始 M3 验收仍需补齐 |
| 收尾 | 统一 Incident、六场景连续演示、≥4 场景自动化、≥12 组件与视觉验收 | A–G 逐项通过后再标记正式 M3 完成并 Demo Freeze |

本报告记录的是截至 2026-09-13 的发布后快照；[历史开发流水](m3-progress.md)保留各阶段记录，其中早期“未安装”“未部署”“Renderer pending”等描述不可作为当前状态使用。
