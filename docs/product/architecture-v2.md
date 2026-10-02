# Jarvis Product Architecture v2

> 文档状态：Architecture Baseline  
> 版本：v2.0  
> 日期：2026-09-09  
> 适用范围：M3 及后续 Jarvis 产品与工程演进  
> 目标：冻结 Jarvis 的产品边界、核心对象、分层关系与长期不变的架构原则。

---

## 1. 产品定义

Jarvis 是一个运行在个人私有云之上的 **AI Control Plane for Personal Computing**。

它不是单纯的 NAS、聊天机器人、Agent 容器平台或应用商店。Jarvis 的核心价值是把用户的数据、应用、设备、Agent 与计算节点统一抽象为可理解、可搜索、可组合、可调度的能力，并通过 Web / Android 的原生动态界面向用户呈现。

一句话定义：

> **Jarvis 让用户通过自然语言和统一界面管理自己的数字世界，并把第三方应用、AI Agent 和个人设备转化为可组合的能力。**

商业产品长期形态：

```text
Jarvis Box
+ Jarvis System
+ CasaOS Application Substrate
+ Subscription
+ AI Token Plan
```

Jarvis System 计划公开源代码；商业化前再最终确定许可证与商标策略。若许可证限制第三方商业使用，应准确称为 source-available，而非默认宣称符合 OSI 定义的 Open Source。

---

## 2. 产品边界

### 2.1 Jarvis 负责什么

Jarvis 深度负责：

- 用户与 Jarvis 的统一交互；
- 多用户身份、登录、基本角色与权限管理；
- Conversation、Memory、Search；
- Task / Run / Agent 调度；
- Capability / Resource / Action 抽象；
- 第三方 Integration 的发现、生成、验证和维护；
- Dynamic UI；
- 应用分析、管理、交互和上线；
- 平台系统状态的读取、分析、诊断与建议；
- 定时任务；
- 通知、审批、事件与审计接口；
- 后续个人计算节点的统一调度。

### 2.2 Jarvis 不负责什么

Jarvis 不重复开发成熟基础设施：

- 不自研 NAS 文件系统与 RAID；
- 不自研照片服务；
- 不自研媒体服务器；
- 不自研完整 Workflow Engine；
- 不自研文件同步引擎；
- 不自研智能家居生态；
- 不自研 NVR；
- 不自研所有 Agent Runtime；
- 不默认 Fork 第三方应用前端或后端。

对应 Provider：

```text
NAS / Apps             -> CasaOS
Photo                  -> Immich
Media                  -> Jellyfin / Plex
Smart Home             -> Home Assistant
Camera / NVR           -> Frigate
Workflow               -> n8n / Node-RED / future engines
File Sync              -> existing open-source provider
Coding / Desktop Agent -> Codex / WorkBuddy / DeepSeek Harness / future runtime
```

### 2.3 Jarvis 自身控制边界

Jarvis 可以观察和诊断自身，但不应拥有自主修改自身核心系统的权限。

```text
Jarvis 对第三方 App：
  ✓ 分析
  ✓ 安装
  ✓ 启动 / 停止
  ✓ 更新
  ✓ 配置
  ✓ 交互
  ✓ 排障
  ✓ 上线

Jarvis 对 Jarvis 自身：
  ✓ 读取状态
  ✓ 分析
  ✓ 诊断
  ✓ 提供建议

  ✗ 自主修改核心配置
  ✗ 自主更新核心系统
  ✗ 自主删除核心组件
  ✗ 自主修改安全策略
```

Jarvis 自身更新由独立 Supervisor / Updater 按 Release 执行。

---

## 3. 长期架构原则

### 3.1 AI First，但不是 Everything Through AI

确定性查询和固定操作优先走 Capability；只有需要理解、规划、组合、解释时才调用 Agent。

```text
简单读取 / 固定操作 -> Capability
复杂理解 / 规划     -> Agent
多能力组合          -> Agent + Task
高风险操作          -> Policy + Approval
```

### 3.2 Capability First，而不是 App First

用户不应该被要求理解每个应用的品牌和后台页面。

```text
photo.search
container.restart
metrics.query
home.scene.activate
media.play
file.search
app.install
```

上层只关心“能做什么”，具体由哪个 Provider 提供由 Integration Registry 决定。

### 3.3 Stable Core + Replaceable Providers

Jarvis Core 只持有稳定概念，不直接依赖 Grafana、Immich、Portainer 等产品。

外部软件、Agent Runtime、硬件设备均作为 Provider 接入。

### 3.4 No Fork by Default

接入优先级：

1. 官方 API；
2. 官方 Plugin / Extension；
3. Sidecar / Adapter；
4. MCP / HTTP / CLI Runtime Adapter；
5. 只有必要时才 Fork。

### 3.5 Server Is the Source of Truth

Conversation、Task、Run、Approval、Memory、Notification、Device、App、Resource State 等统一以服务端为事实源。

Web / Android 不需要设计复杂的“页面同步系统”；它们只订阅同一份服务端状态。

### 3.6 Protocol over Product Coupling

长期稳定的是协议：

- Core Data Model；
- Integration Contract；
- Agent / Skill / Capability Contract；
- Dynamic UI Protocol；
- Node Bridge Protocol。

具体实现可以替换。

---

## 4. 总体架构

```text
                         User
                          │
              ┌───────────┴───────────┐
              │                       │
           Android                   Web
              │                       │
              └───────────┬───────────┘
                          │
                  Experience Plane
                  Chat + Dynamic UI
                          │
                    Jarvis Gateway
                          │
                       Jarvis Core
                          │
    ┌─────────────────────┼─────────────────────┐
    │                     │                     │
 Identity / Memory     Task / Agent       Search / Schedule
    │                     │                     │
    └─────────────────────┼─────────────────────┘
                          │
                   Semantic Control Layer
             Resource / Capability / Action
                          │
                  Integration Registry
                          │
       ┌──────────────────┼──────────────────┐
       │                  │                  │
      CasaOS          Third-party Apps    Agent Runtimes
       │                  │                  │
 Apps / Storage      Grafana / Immich    Codex / Harness
 Docker / Store      HA / Portainer      Future Providers
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                   Personal Infrastructure

Future:
                          │
                    Execution Fabric
                          │
             Windows / macOS / Linux Nodes
```

---

## 5. 核心领域对象

### 5.1 Identity

```text
User
Role
Permission
Session
Device
Credential
```

M3 起支持多用户：

- 注册；
- 登录；
- 用户管理；
- 基础角色；
- 用户级数据隔离；
- 用户级 Conversation / Memory / Preference / Task。

完整安全模型在发布前专项冻结，但当前数据模型必须留下 Permission / Approval / Audit 接口。

### 5.2 Memory

Memory 属于 Jarvis Core Harness 的基础能力，而不是单独堆砌的产品页面。

三类长期记忆：

```text
User Memory
- 偏好
- 习惯
- 常用选择
- 长期上下文

Environment Memory
- 已连接设备
- 已安装应用
- 节点
- 家庭环境
- 常用数据源

Capability Memory
- Jarvis 当前拥有哪些能力
- 能力由谁提供
- 能力如何调用
- 能力适合解决什么问题
```

Memory 必须可更新、可纠正、可按用户隔离。

### 5.3 Search

Search 分为两类能力：

```text
Internal Search
- 文件
- 照片
- 笔记
- Memory
- App
- Capability
- Device
- Task
- Log
- Knowledge

Web Search
- Internet
```

Core 根据意图自动选择或组合二者，不要求用户手动切换搜索模式。

### 5.4 Resource

Resource 是 Jarvis 对“世界状态”的标准化表达。

典型资源：

```text
Application
Container
MetricSeries
Alert
File
Photo
Album
Device
Task
Run
Agent
Node
MediaItem
HomeEntity
Notification
```

Resource 应尽量稳定，不暴露 Provider 私有字段到 Core。

### 5.5 Capability

Capability 描述“系统能做什么”。

```text
app.install
app.start
app.stop

metrics.query
alert.list

container.list
container.logs
container.restart

photo.search
photo.album.create

file.search
file.share

home.device.read
home.scene.activate

agent.run
```

每个 Capability 至少包含：

```text
id
provider
input_schema
output_schema
risk_level
approval_policy
availability
version
```

### 5.6 Action

Action 是用户或 Agent 可触发的具体操作实例。

高风险 Action 必须能够进入 Approval 流程。

### 5.7 Task / Run

```text
Task
- 用户目标
- 状态
- Owner
- Plan
- Child Runs
- Artifacts
- Result

Run
- 实际执行实例
- Runtime
- Provider
- Events
- Logs
- Usage
- Result
```

Task 是用户视角；Run 是执行视角。

### 5.8 Event

统一事件模型用于：

- 状态变更；
- Agent streaming；
- App 事件；
- Task 进度；
- Approval；
- Notification；
- Integration 生命周期。

---

## 6. CasaOS 的定位

CasaOS 是 Jarvis 的个人云基础能力 Provider，不是 Jarvis 的产品 Shell。

CasaOS 负责：

- App Store；
- App 安装与生命周期；
- Docker / Compose 基础能力；
- 本地存储与文件服务相关能力；
- 基础系统与应用状态。

Jarvis 负责：

- 统一理解；
- 统一搜索；
- AI 交互；
- Capability 抽象；
- Integration；
- Dynamic UI；
- 跨应用编排；
- Task / Agent；
- 用户体验。

```text
CasaOS Store
    -> 软件如何被安装

Jarvis Integration Registry
    -> Jarvis 如何理解和使用软件
```

M3 暂定仅使用 CasaOS App Store，不引入多 Store。

---

## 7. Integration Architecture

### 7.1 Integration 的职责

一个 Integration 把第三方系统转换为 Jarvis 语义。

```text
Third-party API / Event / WebSocket / CLI
                    │
                    ▼
              Jarvis Adapter
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
    Resource    Capability      Action
                    │
                    ▼
                UI Semantics
```

### 7.2 Integration Contract

建议一个 Integration 最少包含：

```yaml
id: grafana
provider_type: application
version: 1.0.0

resources:
  - MetricSeries
  - Alert

capabilities:
  - metrics.query
  - alert.list

actions:
  - id: alert.acknowledge
    risk: medium

ui_semantics:
  MetricSeries:
    preferred:
      - line_chart
      - sparkline
      - metric

fallback:
  web_url: ...
```

### 7.3 Integration Agent

Integration Agent 的职责是“教 Jarvis 学会一个新软件”。

固定工作流：

```text
Discover
  ↓
Inspect API / Docs
  ↓
Map Resources
  ↓
Map Capabilities
  ↓
Generate Adapter
  ↓
Generate Tests
  ↓
Generate UI Semantics
  ↓
Verify
  ↓
Approval
  ↓
Register
```

生成的 Adapter 最终应固化成确定性代码或受控声明，不应在每次调用时临时让 LLM 猜测 API。

### 7.4 Integration 等级

```text
L0 Web-only
   只知道应用存在，可打开原始界面

L1 Generic
   通过通用 OpenAPI / MCP / CLI Adapter 暴露基础能力

L2 Generated
   Integration Agent 自动生成专属 Adapter

L3 Verified
   Schema / API / Error / Permission 测试通过

L4 Optimized
   原生优化的高质量 Integration
```

写操作和危险操作只能在满足相应权限与验证级别后开放。

---

## 8. Agent Architecture

### 8.1 分层

```text
Jarvis Core
    │
    ├── Coding Agent
    ├── Ops Agent
    ├── Research Agent
    └── Integration Agent
            │
        Runtime Adapter
            │
   Codex / Harness / future
```

Jarvis Core 是协调者，不绑定某一模型或 Harness。

### 8.2 Agent、Skill、Capability、Adapter 的关系

```text
Agent
  ↓
Skill
  ↓
Capability
  ↓
Adapter / Provider
```

- Adapter：具体第三方接口如何调用；
- Capability：系统能做什么；
- Skill：如何组合能力完成一种任务；
- Agent：理解目标并选择 / 执行 Skill。

Workflow Engine 是潜在应用 Provider，不深度集成到 Core。

### 8.3 Runtime 解耦

```text
Role × Runtime × Model
```

例如：

```text
role: coding
runtime: codex
model_provider: openai
```

未来可替换为其他 Harness，而上层不改变。

---

## 9. Schedule 与 Workflow

### 9.1 Schedule

Core 内置轻量 Schedule：

```text
Schedule
  ↓
Trigger
  ↓
Task
```

支持：

- 一次性定时；
- 每日 / 每周等简单周期；
- 基础条件触发接口。

不发展成复杂 Workflow 产品。

### 9.2 Workflow

n8n 等工作流平台作为 Integration：

```text
Jarvis
  -> workflow.list
  -> workflow.run
  -> workflow.create
  -> workflow.status
```

---

## 10. Experience Architecture

服务端输出：

```text
Resource
Capability
Action
UI Intent
ViewSpec
```

客户端拥有自己的 Renderer：

```text
Web     -> React Renderer
Android -> Compose Renderer
```

同一语义，不同布局。

不允许 LLM 直接生成任意 React / HTML / CSS；AI 只能选择受控的语义组件、信息层级与交互。

详见《Jarvis Experience & Dynamic UI v2》。

---

## 11. 多设备与状态一致性

所有业务状态均来自 Server。

```text
Jarvis Server
   │
   ├── Web
   ├── Android
   └── Future Clients
```

客户端通过：

```text
Initial Fetch
+ WebSocket / SSE Event Stream
```

获得一致状态。

无需额外设计“页面同步”。

客户端仅保存本地 UI 状态：

- 展开 / 收起；
- 滚动位置；
- 本地草稿；
- Theme；
- Window / Layout preference。

关键是 Protocol Versioning：

```text
ui_protocol: 2.1
client_supports: 2.0 - 2.2
```

---

## 12. Future Execution Fabric

M3 不要求交付，但架构预留：

```text
Jarvis Core
    ↓
Scheduler
    ↓
Node Registry
    ↓
Connectivity
 LAN First / Tailscale Fallback
    ↓
Windows / macOS / Linux
    ↓
Jarvis Node Bridge
    ↓
Codex / WorkBuddy / DeepSeek Harness
```

原则：

- Agent 决定“怎么做”；
- Capability 描述“要做什么”；
- Node 决定“在哪里做”。

Node Bridge 本身不是 Agent，而是 Runtime 插座。

预计 M4 / M5 落地。

---

## 13. Media 与 Smart Home

### 13.1 Media

深度 Integration：

```text
Immich  -> Photos / Memories / Search
Jellyfin -> Video / Media Library / Playback
```

长期增加 Display Capability：

```text
display.photo
display.album
display.video
display.dashboard
display.dynamic_view
```

用于数字相框、旧平板、电视等展示终端。

### 13.2 Smart Home

优先：

```text
Home Assistant -> 统一设备与自动化
Frigate        -> Camera / NVR / Event
```

不是当前 M3 核心范围。

---

## 14. 文件同步、备份、Voice、iOS

### 文件同步

复用成熟开源 Provider，只做 Integration。

### Backup

开发阶段保留必要 DB / Config Backup；完整整机灾备在 Jarvis Box 产品阶段再设计。

### Voice

保留 Input / Output Provider 接口；STT / TTS 复用开源或外部服务。

### iOS

当前不投入。商业化阶段再支持。

---

## 15. 更新与版本

```text
Jarvis Core         -> Jarvis Release
Web                 -> Jarvis Release
Android             -> Jarvis Release
UI Protocol         -> 独立协议版本
Integration         -> 独立版本
Third-party App     -> CasaOS App Store
```

Jarvis Core 不能自主更新自身。

---

## 16. 商业化边界

长期商业产品：

```text
Jarvis Box
├── Hardware
├── Jarvis System
├── CasaOS Substrate
├── Integration Ecosystem
├── Subscription
└── AI Token Plan
```

发布前专项：

- 安全模型；
- License；
- 商标；
- 账号安全；
- 供应链；
- OTA；
- Backup / Recovery；
- 隐私政策。

---

## 17. M3 之前冻结的五个核心 Contract

M3 工程工作的首要任务不是增加更多功能，而是冻结：

1. **Core Data Model**
2. **Dynamic UI v2 Protocol**
3. **Integration Contract**
4. **Agent / Skill / Capability Contract**
5. **Task / Event Contract**

Node Bridge Protocol 进入设计但不作为 M3 必须上线项。

---

## 18. 最终架构判断

Jarvis 的长期内核可以压缩为：

```text
Identity
Memory
Search
Conversation
Task
Run
Agent
Skill
Capability
Resource
Integration
Event
Schedule
Policy
Approval
View
```

其余能力均尽量由 Provider 提供。

> **Core 管理解与协调；Integration 管外部世界的能力；Agent 管复杂任务；Dynamic UI 管用户看到什么；CasaOS 管应用与基础个人云。**

这就是 Jarvis Product Architecture v2 的冻结边界。
