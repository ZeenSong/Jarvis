# Jarvis M3 / Investor Demo Milestone

> Milestone ID：M3  
> 建议版本：v0.3.0  
> 文档状态：Execution Baseline  
> 日期：2026-09-09  
> 前置：M2 Real Agent + Dynamic Experience 已具备真实 Agent、Task / Run、Web / Android、Dynamic UI v1 基础  
> 核心目标：**把 Jarvis 从“工程上可用的 AI 私有云”升级为“能够向投资人连续演示产品差异化的 Personal AI Cloud”。**

---

## 1. 一句话目标

> **M3 不追求功能数量，而要证明 Jarvis 能把 CasaOS、第三方应用和 Agent 统一为一个 AI 原生产品体验。**

M3 完成后，投资 Demo 必须让观众明确看到：

1. Jarvis 是统一入口；
2. Jarvis 能安装和管理 App；
3. Jarvis 能理解 App 的能力；
4. Jarvis 能跨 App / Agent 完成任务；
5. Jarvis 能根据任务动态生成 Web / Android 原生 UI；
6. Task / Run / Approval 全过程可观察；
7. 多用户、Memory、Search 已具备产品基础。

---

## 2. M3 不做什么

明确不纳入 M3 P0：

- Windows / macOS Node Bridge；
- 完整 Desktop App；
- iOS；
- Voice 产品化；
- Frigate / 摄像头；
- 深度 Home Assistant；
- 多 App Store；
- 自研文件同步；
- 完整 Backup / Disaster Recovery；
- Hardware Box；
- 商业 License 最终方案；
- 完整安全模型；
- 自研 Workflow Engine；
- 自研 Storage / RAID 管理。

这些不会阻碍 Investor Demo。

---

## 3. M3 的五个核心交付包

### WP1：Product Shell & Design System

目标：彻底结束当前开发者控制台式 UI。

交付：

- Jarvis Design System v1；
- Web Shell v2；
- Android Shell v2；
- Home；
- Apps；
- Tasks；
- Jarvis Conversation；
- System / Space 基础页；
- 深色主题；
- 可扩展浅色主题接口；
- 中文优先。

验收：

- Web 与 Android 风格一致但布局不同；
- 不使用 CasaOS-UI 作为主 Shell；
- 不直接套默认 Material / Ant Design 视觉；
- 首页不再以“Agent / AI 用量 / Server / 工作台”作为核心 IA。

### WP2：Dynamic UI v2

交付：

- UI Protocol v2；
- View / Section / Layout Schema；
- Component Registry；
- Web React Renderer；
- Android Compose Renderer；
- UI Intent；
- Protocol negotiation；
- Fallback；
- Task / Timeline / Approval / Action / Metric / Chart / List / Gallery / Log 等核心组件。

验收：

同一服务端 ViewSpec：

```text
Server Incident
```

Web 能渲染成多面板 Workspace；

Android 能渲染成单列 + Sheet；

二者不是同一固定布局。

### WP3：CasaOS + Integration Layer

M3 至少完成四个 Provider：

```text
CasaOS
Grafana
Portainer
Immich
```

CasaOS：

- 已安装应用列表；
- App Store；
- install；
- start / stop；
- update 状态；
- logs / metadata；
- App Detail。

Grafana：

- metrics.query；
- alert.list；
- MetricSeries；
- Alert；
- Jarvis Native Monitoring View。

Portainer：

- container.list；
- container.inspect；
- container.logs；
- container.restart；
- Container Resource；
- Jarvis Native Container View。

Immich：

- photo.search；
- album / timeline 基础读取；
- Photo Resource；
- PhotoGrid / Memory View。

验收：

日常操作不需要打开第三方 Web。

原始 Web 页面仅作为：

```text
Advanced Console
```

### WP4：Integration Agent Proof

M3 不要求自动适配所有软件，但必须证明“Jarvis 会学习新 App”的产品故事可运行。

推荐选择一个结构清晰、API 完整的小型服务作为 Demo Provider。

工作流：

```text
检测新 App
↓
读取 API / OpenAPI
↓
识别 Resource
↓
生成 Capability
↓
生成 Adapter Candidate
↓
生成 UI Semantics
↓
运行测试
↓
用户确认
↓
注册 Integration
```

至少实现：

- Read-only 自动生成；
- Sandbox；
- Integration Candidate；
- 自动测试；
- Approval；
- Registry；
- Generated Dynamic UI。

写操作不作为自动生成的强制目标。

### WP5：Core Product Foundation

交付：

- 多用户注册 / 登录；
- 基础用户管理；
- 用户级 Conversation；
- 用户级 Memory；
- Internal Search；
- Web Search 接口；
- 统一搜索入口；
- 轻量 Schedule；
- Notification / Approval 基础中心；
- Server 作为 Source of Truth。

---

## 4. M3 数据模型冻结

M3 必须冻结第一版生产语义：

```text
User
Session
Device
Memory
Conversation
Message
Task
Run
Agent
Skill
Resource
Capability
Action
Integration
Application
Event
Approval
Notification
Schedule
ViewSpec
Artifact
```

要求：

- ID 稳定；
- Provider 可替换；
- Version 明确；
- API Schema 可测试；
- Web / Android 共用。

---

## 5. Investor Demo 的 6 个场景

Demo 必须是连续的产品故事，而不是六个独立技术页面。

### Scene 1：进入 Jarvis

操作：

- 用户登录；
- 打开 Home。

看到：

- Jarvis Presence；
- 系统状态；
- 已安装 App；
- 我的空间；
- Running Tasks；
- Recent Activity。

投资人得到的结论：

> 这是一个完整私人云产品，不是聊天机器人。

### Scene 2：用自然语言查看系统异常

用户：

> “昨晚服务器有没有异常？”

Jarvis：

1. 查询 Grafana；
2. 查询 Portainer；
3. 查询系统事件；
4. 生成分析；
5. 输出 Dynamic Workspace。

Web：

- 24h 趋势；
- 异常时间线；
- 相关容器；
- 原因；
- 修复建议。

Android：

- 结论；
- 核心指标；
- Timeline；
- Action。

结论：

> Jarvis 能跨多个系统组织信息，而不是打开 Grafana。

### Scene 3：管理容器而不打开 Portainer

用户：

> “Immich 现在为什么占这么多资源？”

Jarvis 显示：

- Immich Container；
- CPU / Memory；
- Logs；
- 关联指标；
- 当前 Task。

如果需要：

```text
[重启容器]
```

进入 Approval。

结论：

> 第三方工具提供后端能力，Jarvis 提供体验。

### Scene 4：照片与 AI 搜索

用户：

> “找一下去年旅行里适合放在数字相框上的风景照片。”

Jarvis：

- Internal Search；
- Immich Integration；
- PhotoGrid；
- 推荐结果。

M3 不要求真实数字相框终端上线，但保留：

```text
[加入展示列表]
```

或 Demo Display Queue。

结论：

> Jarvis 能理解个人数据，而不仅是系统运维。

### Scene 5：Jarvis 学习一个新 App

在 CasaOS 安装一个 Demo App。

Jarvis：

```text
发现新应用
↓
Integration Agent
↓
识别 API
↓
生成 6 个 Capability
↓
生成移动 / Web 语义
↓
运行测试
↓
启用 Integration
```

完成后：

> “查看这个 App 的状态。”

直接出现 Jarvis Native UI。

结论：

> Jarvis 的能力会随着应用生态增长。

### Scene 6：Task / Agent 全过程

用户：

> “分析这个问题并给我一个修复方案。”

展示：

```text
Task
├── Core planning
├── Ops Agent
├── Metrics query
├── Container logs
└── Result
```

包括：

- progress；
- events；
- child runs；
- artifacts；
- token / usage 可放详情；
- approval；
- result。

结论：

> Jarvis 的 Agent 是被平台管理的执行资源，而不是黑盒 Chat。

---

## 6. Web M3 必须页面

P0：

```text
/login
/home
/jarvis
/tasks
/tasks/:id
/apps
/apps/:id
/spaces
/system
/integrations
```

Dynamic Workspace 可以由：

```text
/workspace/:id
```

或嵌入 Task / Conversation，不强制 URL 结构。

### Web 首页

第一屏必须包含：

- Jarvis command；
- 关键状态；
- 当前任务；
- 我的空间；
- App；
- activity。

### Web App Detail

不等于第三方 Web。

包含：

```text
Overview
Capabilities
Resources
Actions
Logs
Integration
Advanced Console
```

---

## 7. Android M3 必须页面

P0：

```text
Login
Home
Jarvis
Tasks
Task Detail
Apps
App Detail
Space / Search
Dynamic View
Approval Sheet
```

原则：

- 不用 WebView 实现核心页面；
- 原始 Web 仅作为高级 fallback；
- Compose Native；
- Dynamic UI v2；
- 通知可直接打开 Task / Approval。

---

## 8. M3 技术架构建议

```text
apps/
  web/
  android/
  server/

packages/
  core-model/
  capability/
  integration/
  integration-registry/
  ui-protocol-v2/
  task/
  memory/
  search/
  auth/

integrations/
  casaos/
  grafana/
  portainer/
  immich/

agents/
  core/
  coding/
  ops/
  integration/
```

不要求完全按此目录重构，但必须明确模块边界。

---

## 9. Web 技术路线

保持：

```text
React
TypeScript
```

建议：

- TanStack Query；
- TanStack Table；
- ECharts / Recharts；
- Radix primitives；
- Framer Motion；
- React Flow；
- Monaco（仅需要时）。

CasaOS-UI：

- 作为 UX / 数据接口参考；
- 不整体 Fork；
- 不迁移 Jarvis 到 Vue。

---

## 10. Android 技术路线

保持：

```text
Kotlin
Jetpack Compose
```

建议：

- Navigation Compose；
- ViewModel + StateFlow；
- Ktor / OkHttp；
- Room；
- DataStore；
- WorkManager；
- Coil；
- Media3；
- Vico；
- Biometric / Keystore。

M3 重点不是引入库，而是建立：

```text
design-system/
dynamic-ui/
features/
core/
```

并避免继续把 UI 堆进 MainActivity / 单一 DynamicScreen。

---

## 11. Integration Agent 的安全边界

M3 自动生成默认：

```text
read-only
sandbox
```

状态：

```text
Candidate
Verified
Trusted
```

Candidate：

- 不获得危险写权限。

Verified：

- 通过接口和 Schema 测试。

Trusted：

- 用户明确批准后才允许特定写操作。

完整安全体系发布前再专项设计，但 M3 不允许跳过基本权限边界。

---

## 12. Memory M3 最小范围

M3 只做对产品有明显价值的长期 Memory：

### User

- 用户偏好；
- 常用回答风格；
- 常用 Space / App。

### Environment

- 已安装 App；
- 设备；
- Provider；
- 最近状态。

### Capability

- 当前 Capability；
- Provider；
- 可用 / 不可用；
- 推荐用途。

必须支持：

- 用户隔离；
- 更新；
- 纠正；
- Core Harness 检索。

不做复杂 Memory UI。

---

## 13. Search M3 最小范围

### Internal

必须可搜索：

- App；
- Capability；
- Task；
- Conversation / Memory；
- 文件 Provider 基础结果；
- Immich Photo。

### Web

接入一个稳定 Web Search Provider 接口。

Core 可以一次任务同时调用 Internal + Web。

---

## 14. Schedule M3

只做：

- 一次性；
- 每天；
- 每周；
- 启用 / 禁用；
- 删除；
- 下次运行时间；
- 绑定 Task / Prompt。

不做复杂 DAG、Workflow Builder。

---

## 15. 质量门槛

### 功能

- 核心 Demo 路径无需手工改数据库；
- 不依赖 mock；
- 不要求开发者在 CLI 手动补步骤；
- 关键状态可恢复。

### UI

- Web / Android 均达到可展示产品水准；
- 中文无明显错位 / 截断；
- 无开发者 Debug 文案；
- Loading / Empty / Error 完整；
- Dynamic UI 不出现未知组件崩溃。

### Integration

- Provider 掉线可识别；
- API error 有统一状态；
- Capability availability 可更新；
- Advanced fallback 可用。

### Task / Agent

- Run 可 cancel；
- Event 可恢复；
- Parent / Child 可追踪；
- Result / Artifact 可查看；
- Approval 流可恢复。

---

## 16. M3 自动化测试

至少：

### Server

- auth；
- multi-user isolation；
- capability registry；
- integration registry；
- task / run；
- approval；
- ui protocol；
- memory；
- search；
- schedule。

### Web

- Home；
- Conversation；
- Dynamic UI；
- Apps；
- Task；
- Approval；
- Integration。

### Android

- login；
- navigation；
- dynamic renderer；
- task；
- approval；
- reconnect；
- protocol fallback。

### E2E

至少覆盖 Demo 6 scenes 中 4 个自动化路径。

---

## 17. M3 Acceptance Criteria

M3 只有同时满足以下条件才算完成：

### A. 产品

- Web 不再是开发者 Dashboard；
- Android 不再是简单卡片集合；
- Home / Jarvis / Task / Apps 构成统一产品体验。

### B. Dynamic UI

- v2 Protocol 已冻结；
- Web / Android 可渲染同一语义；
- 至少 12 个高质量 Dynamic Components；
- 支持版本协商与 fallback。

### C. CasaOS

- 可读取 Store / Installed Apps；
- 能完成至少 install / start / stop；
- App 详情进入 Jarvis UI。

### D. Integration

- Grafana、Portainer、Immich 三个真实 Integration 工作；
- 原始 Web 不是默认操作入口；
- Integration Registry 可查询。

### E. Integration Agent

- 至少一次真实自动发现 / 生成 / 验证 / 注册流程可演示。

### F. Core

- 多用户可登录；
- Memory 可被 Core 使用；
- Internal + Web Search 可组合；
- Schedule 可用。

### G. Agent

- Core -> Domain Agent -> Run 可真实执行；
- Task UI 完整；
- Approval 可用；
- Result 可回到 Conversation / Workspace。

---

## 18. Demo Freeze

在 Investor Demo 前设置 Demo Freeze。

Freeze 后禁止：

- 增加新大模块；
- 换前端框架；
- 换 CasaOS；
- 引入第二 App Store；
- 新做 Node / Desktop；
- 新做 Smart Home；
- 新做 Camera；
- 新做 Quant。

只允许：

- 修 Bug；
- 提升 UI；
- 提升稳定性；
- 优化 Demo 数据；
- 提升性能；
- 完善异常处理。

---

## 19. M3 成功后的下一步

M4 / M5 优先候选：

```text
Jarvis Node Bridge
Windows / macOS / Linux Runtime
LAN First / Tailscale Fallback
Codex / WorkBuddy / Harness Runtime Adapter
Display Node
Home Assistant / Frigate
Voice
Jarvis Box prototype
```

但这些都不应该提前侵入 M3。

---

## 20. 最终判断

M3 的成功标准不是“实现了多少功能”，而是投资人能够在一次 10-15 分钟演示后准确复述：

> **Jarvis 是一个 AI 原生个人计算控制平面。它可以安装并理解应用，把应用转化为能力，让 Agent 跨应用执行任务，并在手机和 Web 上动态生成原生体验。**

如果对方仍然认为 Jarvis 是：

> “NAS + ChatGPT”

则 M3 视为没有达到产品目标。
