# Jarvis Experience & Dynamic UI v2

> 文档状态：Experience Baseline  
> 版本：v2.0  
> 日期：2026-09-09  
> 适用端：Web、Android；未来可扩展 Tablet / Display / Desktop  
> 目标：定义 Jarvis 的统一体验语言，以及 Dynamic UI v2 的语义协议、组件体系与第三方应用重构原则。

---

## 1. Experience 定位

Jarvis 的 Web 与 Android 都不是传统“管理后台”。

Jarvis Experience 的目标是：

> **把用户的数据、应用、Agent、设备和任务组织成一个统一的 Personal AI Cloud Experience。**

用户面对的是 Jarvis，而不是 CasaOS、Grafana、Portainer、Immich、Home Assistant 的拼接界面。

产品体验必须做到：

- 中文优先；
- 信息可视化优先；
- 少字、强层级；
- 页面不是开发者 Dashboard；
- AI 不是孤立 Chat 页；
- 任务过程与结果可视；
- 第三方 Web UI 只作为高级入口；
- 同一资源在 Web / Android 上按照设备重新组织，而不是简单响应式缩放。

---

## 2. Experience 的三个核心 Surface

### 2.1 Home

回答：

> “我的数字世界现在怎么样？”

展示：

- Jarvis Presence；
- 当前重要状态；
- 系统 / 存储 / 网络；
- 我的空间；
- 最近活动；
- 运行中的任务；
- 需要审批的事项；
- 常用应用；
- 推荐动作。

Home 不是监控大屏，而是个人云首页。

### 2.2 Jarvis / Conversation

回答：

> “我要 Jarvis 帮我做什么？”

Conversation 不应复制 ChatGPT。

对话中可以直接出现：

- 指标图；
- 文件；
- 相册；
- App；
- Task；
- Run；
- Timeline；
- Approval；
- Diff；
- Log；
- Action；
- Dynamic View。

### 2.3 Workspace

回答：

> “这件事正在发生什么，我应该如何操作？”

Workspace 是 Web 的核心差异化区域。

例如分析服务器异常时，Workspace 可以同时显示：

- Grafana 指标；
- Portainer 容器；
- system logs；
- Jarvis 分析；
- 时间线；
- 修复建议；
- Action；
- Approval。

---

## 3. Web 与 Android 的角色

### 3.1 Android

定位：

> **Personal AI Cloud Super App**

优势：

- 随时可用；
- 原生通知；
- 快速审批；
- 简洁状态；
- 照片 / 家庭 / 任务；
- 移动端 Dynamic UI；
- Jarvis 随时呼出。

典型结构：

```text
Home
Cloud / Space
Jarvis
Tasks
Apps
```

导航名称可迭代，但产品必须保持“少入口、统一体验”。

### 3.2 Web

定位：

> **Personal AI Cloud Desktop + Dynamic Workspace**

Web 用于：

- 全局概览；
- 大屏信息密度；
- 深度任务分析；
- 应用管理；
- 容器 / 指标 / 日志；
- 文件；
- 多面板 Workspace；
- Integration 管理；
- Jarvis 交互。

Web 不是 CasaOS UI Fork，也不是传统 Admin Console。

---

## 4. 为什么不 Fork CasaOS-UI

CasaOS 前端是 NAS 产品前端，Jarvis 是 AI Control Plane。

Jarvis 可以借鉴 CasaOS 的：

- App Launcher；
- App Store UX；
- Widget；
- Storage UX；
- App 安装 / 启停 / 更新流程；
- 消费级私人云设计语言。

但不直接复用：

- 整套 Desktop Shell；
- Routing；
- State；
- Vue 技术栈；
- CasaOS API binding；
- Window management；
- Theme。

Jarvis Web 保持 React / TypeScript。

原则：

> **复用 CasaOS 的后端能力和成熟 UX 经验，而不是让 CasaOS 的前端决定 Jarvis 的产品形态。**

---

## 5. 第三方应用的统一体验原则

传统方式：

```text
Jarvis
  -> 打开 Grafana Web
  -> 打开 Portainer Web
  -> 打开 Immich Web
```

Jarvis 方式：

```text
Third-party App
      ↓
Integration
      ↓
Resource + Capability + Action + UI Semantics
      ↓
Dynamic UI
      ↓
Web React / Android Compose
```

### 5.1 第三方前端不是主路径

默认：

- 数据来自第三方；
- 能力来自第三方；
- UI 属于 Jarvis。

原始 Web / Native App 只作为 Advanced / Fallback。

### 5.2 例：Grafana

Jarvis 不默认嵌入 Grafana Dashboard。

Adapter 暴露：

```text
metrics.query
alert.list
dashboard.list
```

Resource：

```text
MetricSeries
Alert
```

Jarvis Native UI：

- 指标卡；
- 趋势图；
- 异常点；
- 告警时间线；
- AI 解释。

### 5.3 例：Portainer

Adapter：

```text
container.list
container.inspect
container.restart
container.stop
container.logs
container.metrics
stack.list
```

Jarvis UI：

- 原生容器列表；
- 状态；
- CPU / RAM；
- Logs；
- Restart / Stop；
- 失败原因分析。

复杂 Compose / Stack 编辑再进入 Portainer Advanced Console。

### 5.4 例：Immich

Adapter：

```text
photo.search
photo.timeline
album.list
album.create
person.search
```

Jarvis UI：

- PhotoGrid；
- MemoryCarousel；
- AlbumHero；
- AI Search；
- Display / Digital Frame 动作。

---

## 6. Dynamic UI v2 的定义

Dynamic UI v2 不是“让 AI 写前端代码”。

它是：

> **由服务端输出语义级 ViewSpec，客户端通过受控组件 Registry 生成平台原生界面。**

```text
User Intent
    ↓
Jarvis Core
    ↓
Resource + Capability + Context
    ↓
UI Intent
    ↓
Dynamic UI Composer
    ↓
ViewSpec
    ↓
┌──────────────┬──────────────┐
│ React Web    │ Compose      │
│ Renderer     │ Renderer     │
└──────────────┴──────────────┘
```

AI 可以决定：

- 信息优先级；
- 使用什么组件；
- 哪些资源组合；
- 哪些 Action 暴露；
- 哪些区域折叠。

AI 不可以直接生成任意：

- HTML；
- CSS；
- JavaScript；
- React component source；
- Compose source。

---

## 7. Dynamic UI v2 语义树

建议基础结构：

```text
View
├── Page
├── Section
├── Grid
├── Stack
├── Split
├── Carousel
├── Tabs
├── Sheet
├── Detail
└── Overlay
```

内容组件：

```text
Metric
MetricGroup
Sparkline
LineChart
BarChart
Donut
Gauge
Progress
Status
StatusGrid
List
DataTable
Timeline
Alert
Card
Gallery
PhotoGrid
Media
File
FileList
Log
Terminal
CodeDiff
Task
Run
RunGraph
Approval
Form
Markdown
Action
App
Device
EmptyState
ErrorState
```

Web 专属增强：

```text
SplitPane
Inspector
Topology
ResizablePanel
LargeTimeSeries
AdvancedDataTable
Terminal
CodeEditor
```

Android 专属表现：

```text
BottomSheet
CompactMetric
TouchAction
SwipeAction
MobileGallery
CompactTimeline
Carousel
```

语义相同，具体组件名可以由 Renderer 映射。

---

## 8. ViewSpec 建议结构

示意：

```yaml
protocol: "2.0"
view:
  id: "server_incident"
  intent: "investigate_failure"
  title: "昨晚服务器异常"

  context:
    device_class: "mobile"
    priority: "incident"

  layout:
    type: "page"

  sections:
    - id: "summary"
      role: "summary"
      component: "metric_group"
      source: "incident.metrics"

    - id: "trend"
      role: "primary"
      component: "line_chart"
      source: "incident.timeseries"

    - id: "timeline"
      role: "activity"
      component: "timeline"
      source: "incident.events"

    - id: "actions"
      role: "actions"
      component: "action_group"
      actions:
        - "container.restart"
        - "alert.create"
```

关键：ViewSpec 表达语义，不表达固定像素。

---

## 9. Responsive ≠ Shrink

同一 View：

```text
intent = investigate_failure
resource = Incident
```

Android：

```text
Summary
Trend
Timeline
Action
Detail -> Bottom Sheet
```

Web：

```text
Left: Timeline
Center: Trend + Analysis
Right: Resources + Actions + Inspector
```

Tablet：

```text
2-column adaptive
```

Dynamic UI 的目标是“重新编排”，而不是把 Web 三列压成手机一列。

---

## 10. UI Context

Composer 应考虑：

```text
device_class
screen_size
interaction_mode
user_role
task_state
risk
resource_volume
latency
streaming
priority
```

未来可增加：

```text
display_mode
voice_mode
car_mode
kiosk_mode
```

---

## 11. UI State 与业务 State

业务 State 在 Server：

```text
Task
Run
Approval
Resource
Notification
Conversation
```

客户端 Local UI State：

```text
expanded
selected
scroll
draft
theme
layout_preference
```

Web / Android 不同步页面本身，只共享业务状态。

---

## 12. Protocol Versioning

每个 ViewSpec 必须带协议版本：

```text
ui_protocol: 2.0
```

客户端握手：

```text
renderer:
  platform: android
  supports:
    min: 2.0
    max: 2.2

components:
  - line_chart@2
  - task@2
  - approval@1
```

服务端必须支持：

- 协议降级；
- 未知组件 fallback；
- Capability negotiation；
- feature flag。

---

## 13. Design System

Dynamic UI 只能使用 Jarvis Design System。

### 13.1 视觉原则

- 深色 / 浅色均支持；
- 投资级产品完成度；
- 克制的蓝 / 青 / 紫 AI 氛围；
- 避免绿色开发者控制台风格；
- 少用大面积边框；
- 高层级靠留白、字体、背景层级建立；
- 图表和状态优先；
- 高风险操作必须视觉突出。

### 13.2 基础 Tokens

```text
Color
Typography
Spacing
Radius
Elevation
Motion
Icon
State
```

### 13.3 核心组件

```text
JarvisSurface
JarvisCard
JarvisGlass
JarvisOrb
JarvisDock
CommandBar
ContextBar
MetricWidget
StorageWidget
TaskWidget
AppWidget
PhotoWidget
ApprovalCard
RunTimeline
AgentGraph
DynamicSheet
```

所有 App Integration 通过同一套组件语言呈现。

---

## 14. Web 信息架构

建议一级 IA：

```text
首页
空间
应用
任务
Jarvis
系统
```

其中“空间”可根据最终产品测试调整为：

```text
文件 / 照片 / 知识 / 家庭 / 媒体 / 开发
```

不要恢复为：

```text
首页 / 智能体 / AI 用量 / 服务器 / 工作台
```

这种工程控制台 IA。

### Web 首页

内容：

1. Jarvis Command；
2. 系统总览；
3. My Spaces；
4. Running Tasks；
5. Apps；
6. Recent Activity；
7. Approval / Notification。

### Web Workspace

Workspace 支持：

- 多列；
- Split Pane；
- Inspector；
- Timeline；
- Detail；
- Live Event；
- Dynamic Action。

---

## 15. Android 信息架构

Android 不是 Web 的缩小版。

推荐长期结构：

```text
首页
空间
Jarvis
任务
应用
```

Jarvis 入口应始终明显，允许未来用中央 Orb / Floating Dock 表达。

### Android 首页

第一屏回答：

```text
现在正常吗？
Jarvis 在做什么？
有什么需要我处理？
我最近最关心什么？
```

避免堆 10+ 系统小卡片。

### Android Tasks

Task 是核心功能，不是普通列表。

详情至少包括：

- 目标；
- 当前阶段；
- Agent；
- Child Runs；
- Timeline；
- Artifacts；
- Approval；
- Result；
- Actions。

---

## 16. Conversation 与 Dynamic UI

Conversation Message 可以包含：

```text
Text
Resource Card
Dynamic View
Task
Approval
Artifact
Action
Gallery
Metric
Timeline
```

例如：

> 用户：昨晚服务器为什么卡？

Jarvis 回复不应只是长段文字，而是：

```text
[结论]
[24h 曲线]
[异常时间线]
[相关容器]
[原因]
[修复建议]
[创建告警] [查看日志]
```

---

## 17. Search Experience

统一 Search Bar：

```text
Search / Ask Jarvis
```

允许：

- 搜本地文件；
- 搜照片；
- 搜 App；
- 搜 Capability；
- 搜 Memory；
- 搜 Task；
- 搜 Internet。

用户无需选择 Provider。

系统在结果中可标记来源：

```text
我的文件
我的照片
Jarvis Memory
Web
```

---

## 18. Integration UI Semantics

Integration 不直接提交一整套 UI。

它声明：

```text
Resource Type
Preferred Component
Supported Action
Detail Semantics
Fallback
```

示例：

```yaml
MetricSeries:
  preferred:
    - line_chart
    - sparkline

Container:
  preferred:
    - status_list
    - resource_card

Photo:
  preferred:
    - photo_grid
    - memory_carousel

Alert:
  preferred:
    - alert
    - timeline
```

Composer 根据 Intent 组合。

---

## 19. App 的四种用户体验等级

### L0：Web Fallback

只提供：

- App 状态；
- 启停；
- 日志；
- 打开原始 Web。

### L1：Capability Integration

Jarvis 可以读取 / 操作核心能力，并生成基础 Dynamic UI。

### L2：Deep Integration

例如 Immich、Home Assistant：

- 原生资源模型；
- 原生页面；
- AI 语义搜索；
- Cross-App Task。

### L3：Jarvis Native Experience

Provider 品牌几乎退到后台，用户只感知“照片”“家庭”“监控”等场景。

M3 至少证明 L1/L2。

---

## 20. Investor Demo 体验原则

Demo 必须展示“Jarvis 不只是 NAS + Chat”。

推荐连续路径：

```text
登录
↓
Home
↓
自然语言提出任务
↓
Jarvis 调用多个 App / Agent
↓
动态生成原生 Workspace
↓
需要时审批
↓
任务完成
↓
结果进入 Activity / Memory
```

重点展示：

1. 一个入口；
2. 多 App 协作；
3. App 被转化为 Capability；
4. Dynamic UI；
5. Task 可观察；
6. Jarvis 能学习新的 Integration。

---

## 21. M3 实现优先级

P0：

- Jarvis Design System；
- Web Shell 重构；
- Android Shell 重构；
- Dynamic UI v2 Schema；
- React Renderer；
- Compose Renderer；
- Task / Approval / Timeline；
- Grafana Integration；
- Portainer Integration；
- CasaOS Integration；
- Immich Integration；
- UI Protocol Versioning。

P1：

- Integration Agent；
- Search UI；
- Memory Context View；
- App Detail；
- Notification Center。

P2：

- Home Assistant；
- Media / Display；
- Advanced App Editor；
- Desktop / Node UI。

---

## 22. 最终体验原则

> **第三方 App 的后端尽量复用，第三方 App 的前端尽量不复用。**

> **AI 决定信息与行为，Design System 决定视觉。**

> **同一语义在 Web / Android 上由各自原生 Renderer 重构，而不是把 Web 页面缩小。**

> **用户看到的是场景和任务，而不是一堆割裂的应用。**
