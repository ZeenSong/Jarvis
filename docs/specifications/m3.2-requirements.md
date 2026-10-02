# Jarvis M3.2 开发需求与实施规范

## 1. 文档目的

本文档用于明确 Jarvis M3.2 阶段的产品目标、架构原则、技术约束、开发范围、开源复用要求、实施顺序和验收标准。

M3.2 不是继续堆叠大量新功能，而是在 M3.1 已经完成 Jarvis 与 Hermes 基础接入、可以进行简单对话的基础上，解决当前最影响后续发展的几个核心问题：

1. Jarvis、Hermes Dashboard、CasaOS、Immich、Home Assistant、Frigate、摄像头后台等系统仍然拥有相互独立的身份和认证入口；
2. Jarvis 当前 Conversation 仍然只是基础 Chat UI，无法承载真正的 Agent 工作过程；
3. Hermes 已经接入，但其原生 MCP、Skills 等能力还没有通过真实家庭和私有云场景验证；
4. Dynamic UI、Workspace、Conversation 三者之间的产品关系仍然没有真正收敛；
5. Web 与 Android 同时开发导致重复工作，而当前产品形态仍在快速变化；
6. Jarvis 目前部分能力存在自行重新实现成熟基础设施的倾向，需要正式建立“开源优先、集成优先”的开发原则。

因此 M3.2 的总体定位为：

> **统一身份，重构 Conversation，验证 Hermes 原生能力，建立 Open-Source-First 的产品开发方式。**

M3.2 完成以后，Jarvis 应从：

> “一个能够调用 Hermes、连接若干私有云应用的管理系统”

进一步演进为：

> **以一个长期存在的 Jarvis 数字管家为核心，通过统一对话入口连接家庭成员、设备、应用、数据、Agent、MCP 和 Skills 的私人 AI 操作系统原型。**

---

# 2. M3.2 的核心产品原则

以下原则属于 M3.2 的硬性要求。

后续开发人员、Codex、其他 Agent 或贡献者不得自行修改这些原则。

---

## 2.1 一个家庭只有一个 Jarvis

Jarvis 的定位是一个家庭或私人云中的统一数字管家。

不是每一个用户拥有一个独立 AI 助手。

正确模型：

```text
Household
   │
   ├── User A
   ├── User B
   ├── User C
   │
   └── Jarvis
          │
          └── Hermes Profile: jarvis
```

错误模型：

```text
User A → Jarvis A
User B → Jarvis B
User C → Jarvis C
```

所有被授权家庭成员使用的是：

- 同一个 Jarvis；
- 同一个人格；
- 同一个 Agent 身份；
- 同一个 Hermes Profile；
- 同一套 Skills；
- 同一套 MCP；
- 同一个家庭级能力体系。

用户不同，只表示：

> **当前是谁在跟 Jarvis 说话。**

而不代表要创建另一个 Jarvis。

---

# 3. Human Identity 与 Agent Identity 必须分离

M3.2 必须明确两个概念。

## 3.1 Human Identity

表示当前用户。

例如：

```text
actor = user-francesca
actor = user-family-02
```

Human Identity 用于：

- 登录；
- 审计；
- 通知；
- “我”“我的”等语义；
- 个人任务；
- 个人设备；
- 个人会话；
- 后续必要的私人数据隔离。

---

## 3.2 Agent Identity

表示真正执行任务的 Agent。

当前只有：

```text
agent = Jarvis
hermes_profile = jarvis
```

无论哪个家庭成员发出指令，真正执行任务的仍然是同一个 Jarvis。

---

# 4. Household 作为一级概念

M3.2 应正式引入 Household 概念。

即使当前部署只有一个家庭，也应该从架构上预留：

```text
Household
│
├── Members
├── Jarvis
├── Devices
├── Applications
├── Shared Memory
├── Shared Data
└── Shared Resources
```

建议至少建立：

```text
households
household_members
```

当前默认可以只有：

```text
household_id = default-household
```

但不得继续默认：

```text
user == household
```

未来 Jarvis 应能够区分：

```text
Personal Context
Household Context
System Context
```

---

# 5. Jarvis 是统一入口，而不是后台导航器

当前已有：

- Jarvis；
- Hermes Dashboard；
- CasaOS；
- Immich；
- Home Assistant；
- Frigate；
- 摄像头后台；
- 后续其他服务。

M3.2 不应该继续强化：

```text
应用列表
  ↓
点击应用
  ↓
跳转第三方后台
```

这种产品方式。

长期产品方向必须是：

> **用户尽可能通过 Jarvis 完成操作，第三方后台主要作为管理员和高级用户的配置入口。**

例如：

```text
查看摄像头
```

应优先：

```text
用户
 ↓
Jarvis
 ↓
Hermes / MCP
 ↓
Frigate / HA / Camera
 ↓
Jarvis Conversation / Dynamic UI
```

而不是首先跳转到摄像头原生后台。

---

# 6. Open Source First：M3.2 的最高开发原则之一

Jarvis 的定位不是重新开发：

- NAS；
- Agent Runtime；
- Chat Framework；
- 身份认证；
- 家庭自动化；
- NVR；
- 相册；
- Workflow；
- API 平台；

而是：

> **把成熟能力统一组织成一个真正可用的私人 AI OS。**

因此 M3.2 正式确立：

> **Open Source First, Integration Before Reimplementation。**

即：

```text
已有成熟开源组件
        ↓
优先调研
        ↓
优先集成
        ↓
通过 Adapter 接入 Jarvis
        ↓
只开发 Jarvis 独有部分
```

不得采用：

```text
看一下别人怎么做
      ↓
理解设计
      ↓
自己重新写一套
```

这种开发方式。

“参考了开源项目”不等于“复用了开源项目”。

如果已有成熟、许可证合适、架构可接入的组件，应优先直接使用。

---

# 7. 所有重大基础能力开发前必须完成开源评估

包括但不限于：

```text
Conversation
Authentication
Authorization
API Management
Workflow
Search
File Sync
Photo
Monitoring
Home Automation
Camera/NVR
Notification
Scheduling
Agent UI
Dynamic UI
```

在自行实现之前，都必须首先回答：

1. 是否已有成熟开源实现？
2. 是否可以通过 Adapter 使用？
3. License 是否适合 Jarvis？
4. 引入成本是否明显低于长期自研维护成本？
5. 它是否会与 Jarvis 已有架构产生重复平台？

只有回答完这些问题以后才能决定自研。

---

# 8. M3.2 总体范围

M3.2 包含以下六条主线：

```text
1. Identity & Access Foundation
2. Jarvis → Hermes → MCP Execution Context
3. Conversation V2
4. Workspace / Dynamic UI Integration
5. Hermes MCP / Skills Validation
6. Web First / Android Maintenance
```

---

# 9. Identity & Access Foundation

M3.2 引入统一身份认证体系。

首选：

```text
Authentik
```

Authentik 用于：

- 用户；
- 登录；
- MFA；
- 用户组；
- OIDC；
- OAuth2；
- 应用访问策略；
- 必要的 Forward Auth。

Authentik 的定位是：

> **Jarvis 私有云的 Identity Provider。**

---

# 10. Authentik 不替代 Jarvis 权限体系

必须区分：

```text
Authentication
```

和：

```text
Authorization
```

Authentik 负责：

> 这个人是谁？

Jarvis 负责：

> 这个人在当前 Jarvis 上下文中可以做什么？

因此不得把：

- Capability 权限；
- 高风险操作；
- 审批；
- Household 资源；
- Tool Scope；

全部交给 Authentik。

---

# 11. 初期用户角色只保留 admin / member

M3.2 不建设复杂企业级 RBAC。

仅保留：

```text
admin
member
```

## member

默认可以：

- 使用 Jarvis；
- 使用智能家居；
- 查看家庭状态；
- 使用照片；
- 查看摄像头；
- 使用普通 Skills；
- 创建普通任务；
- 创建自动化；
- 使用家庭数据。

## admin

拥有 member 的全部能力，并额外允许：

- 管理用户；
- 管理 Jarvis；
- 管理 Hermes；
- 管理 MCP；
- 管理 Skills；
- 管理系统配置；
- 管理密钥；
- 管理 CasaOS；
- 管理底层服务；
- 执行高风险运维操作。

---

# 12. Jarvis 接入 Authentik

Jarvis Web 应逐步从当前本地用户名密码迁移为 Authentik OIDC。

推荐：

```text
Authorization Code Flow + PKCE
```

但必须保留：

```text
Break-glass Local Admin
```

用于 Authentik 故障时紧急恢复。

---

# 13. 内部 user_id 必须保留

当前 Jarvis 已经大量使用：

```text
user_id
owner_user_id
```

作为资源稳定归属。

不得推翻。

建议增加：

```text
user_identities
```

结构可包含：

```text
id
user_id
issuer
subject
preferred_username
email
created_at
```

唯一约束：

```text
(issuer, subject)
```

流程：

```text
Authentik
   ↓
issuer + subject
   ↓
user_identities
   ↓
Jarvis user_id
```

后续 Conversation、Task、Approval、Credential 等继续引用 Jarvis 自己的 `user_id`。

---

# 14. 应用认证策略

M3.2 不要求所有应用一次性做到完全一致的 SSO。

应根据应用能力分层处理。

---

## 14.1 Jarvis

必须接入 Authentik OIDC。

---

## 14.2 Immich

优先验证原生 OIDC。

---

## 14.3 Hermes Dashboard

Hermes Dashboard 是：

> Jarvis Agent 的管理员 / 调试界面。

不是普通家庭成员的核心产品界面。

因此没有必要让 Hermes 维护多个家庭用户 Agent。

可以继续使用 Jarvis 的统一 Service Identity。

---

## 14.4 Home Assistant

优先保证：

```text
Jarvis → Home Assistant API
```

调用安全可靠。

不要求 M3.2 强行解决 Home Assistant 内部完整 SSO。

---

## 14.5 CasaOS

CasaOS 是系统管理后台。

默认仅 admin 使用。

M3.2 不要求重写其身份体系。

---

## 14.6 摄像头后台

四个摄像头原生后台属于：

```text
Device Maintenance Backend
```

不属于普通用户主要产品体验。

不要求 M3.2 为每个摄像头做完整统一 SSO。

正常用户通过：

```text
Jarvis
 → Home Assistant
 → Frigate
```

查看和控制。

---

# 15. Service Credential 与用户登录必须分离

用户通过 Authentik 登录 Jarvis。

但是 Jarvis 后台调用：

```text
Home Assistant
Immich
Frigate
CasaOS
Camera
```

不能简单复用浏览器 OIDC Token。

必须使用：

- API Token；
- Refresh Token；
- OAuth Client；
- Service Account；
- Application Credential；

等机器身份。

---

# 16. IntegrationCredentialStore

现有：

```text
IntegrationCredentialStore
```

方向正确，应继续发展。

它负责：

```text
Jarvis
  ↓
加密服务凭据
  ↓
第三方系统
```

要求：

- Secret 加密；
- 前端不可直接读取；
- 可按 household / integration 管理；
- 支持未来刷新 Token；
- 支持 Service Account；
- Jarvis Kernel 执行时获取。

---

# 17. Hermes 的身份设计

Hermes 继续保持唯一：

```text
profile = jarvis
```

结构：

```text
User A ─┐
User B ─┼─→ Jarvis → Hermes profile: jarvis
User C ─┘
```

禁止：

```text
jarvis-user-a
jarvis-user-b
jarvis-user-c
```

---

# 18. context_token 的正式定位

`context_token` 必须继续存在。

不得被 Authentik Token 替代。

三类 Token / Credential 必须明确：

```text
Authentik Token
= 谁登录了 Jarvis

Hermes / Service Credential
= Jarvis 是否可以调用 Hermes 或其他服务

context_token
= Hermes 当前是在代表哪个 Jarvis 上下文执行
```

---

# 19. context_token 最低要求

当前至少：

```text
owner
session
exp
```

未来建议扩展为：

```text
actor
household
session
run
scopes
exp
```

例如：

```text
actor = user-123
household = household-main
session = conversation-456
run = run-789

scopes:
- home.read
- camera.read
- home.control
```

context_token 必须：

- Jarvis 签发；
- Hermes 无法伪造；
- 短期有效；
- MCP 调用时传回；
- Jarvis MCP 验证；
- 能追踪当前 actor/session。

---

# 20. Conversation V2 是 M3.2 的核心产品工作

Conversation 不再是系统里的一个普通页面。

M3.2 后必须明确：

> **Conversation 是 Jarvis 的主要操作界面。**

目前：

```text
Conversation List
Messages
Textarea
Send
```

不足以承担 Jarvis。

需要升级为：

> **Agent Interaction Surface。**

---

# 21. Conversation V2 禁止从零造 Chat Framework

这是 Conversation 开发中的硬性要求。

在创建：

```text
Transcript
Composer
Thread
Message
Scroll
Tool UI
Approval UI
Attachment UI
```

之前，必须优先复用成熟开源实现。

---

# 22. Conversation V2 首选开源基础：assistant-ui

M3.2 必须首先对：

```text
assistant-ui/assistant-ui
```

进行真实 PoC。

License：

```text
MIT
```

assistant-ui 应作为 Conversation V2 的**首选实际基础库**，而不是单纯参考项目。

---

# 23. assistant-ui 优先复用范围

应优先复用其已有：

```text
Thread
ThreadList
Message
Message Parts
Composer
ActionBar

Streaming
Auto Scroll
Retry
Attachment
Markdown
Keyboard Interaction
Voice

Tool UI
Human-in-the-loop
Approval
Generative UI
Accessibility
Responsive behavior
```

这些能力原则上不应重复实现。

---

# 24. assistant-ui 不替代 Jarvis / Hermes

正确关系：

```text
Jarvis Web
   ↓
assistant-ui
   ↓
Jarvis Adapter
   ↓
Jarvis Gateway
   ↓
Jarvis Server
   ↓
Hermes
   ↓
MCP / Skills
```

assistant-ui 只承担：

> Presentation / Interaction Layer。

不得成为：

```text
Agent Runtime
LLM Router
Identity Provider
Memory System
Tool Executor
```

---

# 25. 不允许为了 assistant-ui 重构 Agent 架构

禁止：

```text
浏览器直接调用模型
```

禁止：

```text
assistant-ui → Vercel API → LLM
```

替换当前：

```text
assistant-ui
 → Jarvis
 → Hermes
```

结构。

M3.2 应通过 Adapter 适配 Jarvis。

不是让 Jarvis 去适配另一个 Agent 平台。

---

# 26. Runtime Adapter

开发时必须优先评估 assistant-ui 提供的 Custom Runtime 接口。

目标结构：

```text
Jarvis Event
   ↓
JarvisAssistantAdapter
   ↓
assistant-ui Runtime
   ↓
Conversation UI
```

例如：

```text
conversation.message.delta
      ↓
assistant text streaming

activity.started
      ↓
tool-call part

activity.completed
      ↓
tool-result

approval.created
      ↓
approval state

artifact.created
      ↓
artifact part
```

---

# 27. 不得重新实现基础 Chat UX

以下能力如 assistant-ui 可以满足，禁止重新开发：

```text
输入框自动高度

Enter 发送
Shift + Enter 换行

Draft
Retry
Send loading

Streaming

Auto-scroll
Scroll lock
Jump to latest

Attachment base UI

Message Action

Tool Call loading/result/error

Approval base UI
```

Jarvis 自研代码应该集中在：

> **Jarvis 独有能力。**

---

# 28. Jarvis 自己真正需要开发的 Conversation 能力

主要包括：

```text
Jarvis Activity Group
Jarvis Capability Labels
Jarvis Dynamic UI Renderer
Jarvis Workspace Integration
Jarvis Household Context
Jarvis Approval Backend
Jarvis Tool Aggregation
Jarvis Advanced Debug Mode
```

而不是重新造 Chat 框架。

---

# 29. 其他开源项目的定位

## Codex

用于研究：

```text
Active Turn
Tool Call Event Model
Streaming Activity
Approval
Execution State
Transcript
```

Codex 是重要交互模型参考。

---

## Claude Code

主要学习：

```text
Tool Grouping
Tool Compression
Queued
Running
Waiting Permission
Completed
Failed
```

尤其是：

> 大量底层工具调用不应该污染用户对话。

---

## WorkBuddy

重点学习：

```text
ChatPanel
ChatComposer
ChatMessageList
ConversationChat

Workspace coupling
Context accessory
Unread
Scroll state
```

但由于 License 为：

```text
GPL-3.0
```

不得直接复制代码进入 Jarvis。

---

## CopilotKit

主要用于研究：

```text
AG-UI
Generative UI
Shared State
Human-in-the-loop
Agent/UI Protocol
```

M3.2 默认不整体引入。

原因是：

Jarvis 已经拥有：

```text
Hermes
Gateway
Dynamic UI
MCP
Capability execution
```

整体引入容易形成重复平台。

---

## Vercel AI SDK

可以作为：

- Streaming；
- Tool Message Part；
- assistant-ui Adapter；

的参考或依赖。

但不得因此替换 Hermes 架构。

---

# 30. Open-Source Reuse ADR

M3.2 必须增加：

```text
docs/adr/ADR-Conversation-UI.md
```

记录：

```text
候选项目
版本
License
能力
缺失能力
集成成本
是否采用
采用范围
自研范围
```

如果最终不采用 assistant-ui，必须给出实际 PoC 证据。

不能以：

```text
自己写更灵活
接入比较麻烦
目前代码已经能用
```

作为拒绝复用的理由。

---

# 31. Conversation 数据模型

Conversation 应从：

```text
message[]
```

升级为：

```text
Conversation
   ↓
Turn
```

一个 Turn 可以包含：

```text
Turn
├── user_message
├── assistant_text
├── activity_group
├── approval
├── question
├── artifact
├── dynamic_view
└── assistant_text
```

---

# 32. Activity 成为一等事件

Tool Call 不再只是附属状态。

每个 Activity 至少关联：

```text
conversation_id
turn_id
activity_id
tool_call_id
capability
status
started_at
completed_at
```

状态包括：

```text
queued
running
waiting_approval
completed
failed
cancelled
```

---

# 33. Active Turn

必须建立：

```text
Active Turn
```

概念。

当前正在工作的 Turn 可以实时更新：

```text
Assistant Text
Activity
Progress
Approval
Question
Artifact
```

Turn 完成后再进入稳定历史。

不要继续通过：

```text
append message
append card
append status
```

模拟 Agent 执行过程。

---

# 34. Activity Group

底层可能连续调用：

```text
frigate.list_events
frigate.get_event
frigate.get_event
frigate.get_snapshot
frigate.get_snapshot
```

普通用户不能看到五条工具调用。

应聚合为：

```text
✓ 检查昨晚监控
  分析 12 个事件
  获取 3 个相关录像
```

展开后才能查看技术详情。

---

# 35. 普通模式与 Developer Mode

普通模式应该显示：

```text
Jarvis 在做什么
```

而不是：

```text
Jarvis 调用了什么 API
```

Developer / Admin Mode 才显示：

```text
Hermes
Profile
Model
Skill
MCP
Tool Name
Tool Parameters
Tool Result
Latency
context_token metadata
```

---

# 36. Jarvis 回复的视觉方向

Jarvis 回复不应继续全部显示成大卡片。

建议：

```text
用户
→ 右侧轻量 Bubble

Jarvis
→ 左侧自然正文

Activity
→ 轻量可折叠 Activity

Approval
→ Inline Action

Artifact
→ Artifact Card
```

避免出现“后台 Dashboard 中一堆矩形框”的感觉。

---

# 37. Inline Approval

审批必须进入 Conversation。

例如：

```text
Jarvis

需要重启 Frigate 才能应用配置。

┌─────────────────────────┐
│ 重启 Frigate            │
│ 预计监控中断数秒        │
│                         │
│ [批准一次]   [取消]     │
└─────────────────────────┘
```

现有 Control Plane 继续保留。

但它用于：

```text
历史审批
全部待处理
通知
系统控制
```

而不是唯一审批入口。

---

# 38. Inline Question

Hermes 需要选择时，应该返回结构化 UI。

例如：

```text
你希望查看哪个时间范围？

[最近1小时]
[今天]
[昨晚]
[自定义]
```

M3.2 至少支持：

```text
boolean
single choice
```

---

# 39. Composer V2

Composer 优先基于 assistant-ui。

必须具备：

```text
自动高度
Enter Send
Shift+Enter Newline
Retry
Draft
失败不丢内容
Send loading
Stop
```

UI 预留：

```text
+
Attachment
Voice
@ Context
/ Skill
Send / Stop
```

---

# 40. 不向普通用户暴露模型

正常用户使用的是：

```text
Jarvis
```

不是：

```text
Claude
GPT
DeepSeek
Hermes
```

因此普通 Conversation 不需要模型选择器。

模型和 Provider 属于：

```text
Jarvis Internal Routing
```

只有 Debug Mode 可以查看。

---

# 41. Scroll 与长会话体验

优先复用 assistant-ui 能力。

必须做到：

```text
Auto Scroll
Scroll Lock
Unread
Jump to Latest
Streaming 不抢滚动
用户发送后自动回最新
```

---

# 42. Conversation History

左侧会话历史后续应支持：

```text
今天
昨天
更早
```

并预留：

```text
搜索
重命名
删除
固定
Archive
```

M3.2 不要求一次全部做完。

---

# 43. Workspace 不再是独立产品入口

Workspace 应改为：

> **Conversation 的扩展工作区。**

正确结构：

```text
Conversation
        +
Workspace / Canvas
```

而不是：

```text
Conversation Page
Workspace Page
```

完全分裂。

---

# 44. Workspace 交互

Conversation 中：

```text
Jarvis

昨晚检测到 3 个值得关注的事件。

[查看监控时间线 →]
```

点击后：

```text
┌──────── Conversation ────────┬──── Workspace ────┐
│                              │                    │
│ Jarvis Conversation          │ Frigate Timeline   │
│                              │                    │
└──────────────────────────────┴────────────────────┘
```

---

# 45. Workspace 可以承载

包括：

```text
Dashboard
Chart
Camera
Video
Frigate Timeline
Photo
Immich Gallery
File
Markdown
HTML Artifact
Document
Table
Task
System Status
Dynamic UI
```

---

# 46. Dynamic UI 不得绑定 React

Jarvis 后端不能输出：

```text
React Component
```

作为协议。

而应继续使用平台无关：

```text
ViewSpec
Resource
Action
Artifact
Semantic UI
```

目标：

```text
            Jarvis UI Protocol
                   │
        ┌──────────┴──────────┐
        │                     │
     Web React           Android Compose
```

---

# 47. assistant-ui 与 Dynamic UI 的边界

assistant-ui 可以作为：

```text
Web renderer
```

但不能成为 Jarvis 跨平台协议。

例如：

```text
Jarvis ViewSpec
      ↓
Web Adapter
      ↓
assistant-ui Tool UI
      ↓
React
```

未来 Android：

```text
Jarvis ViewSpec
      ↓
Android Renderer
      ↓
Compose
```

---

# 48. Hermes 原生 MCP / Skills 优先验证

M3.2 暂缓 API Gateway。

原因：

当前首先需要判断：

```text
Hermes MCP
Hermes Skills
```

到底能做到什么程度。

不得因为：

> “未来可能需要”

就提前建设：

```text
API Gateway
Capability Platform
Tool Registry Platform
Workflow Platform
```

---

# 49. 必须验证的真实场景

## 场景 1：家庭状态

用户：

```text
看看家里现在什么情况。
```

Jarvis 应能够：

```text
Hermes
 ↓
Home Assistant
 ↓
Camera / Frigate
 ↓
Jarvis
```

并返回家庭状态。

---

## 场景 2：昨晚监控

用户：

```text
看看昨晚有没有异常。
```

应：

- 查询 Frigate；
- 分析事件；
- 找录像；
- 返回摘要；
- 提供截图；
- Workspace 展示时间线。

---

## 场景 3：服务器状态

用户：

```text
看看服务器今天有没有异常。
```

至少能够查询：

```text
CPU
RAM
Disk
GPU
Docker
Network
Services
```

---

## 场景 4：照片搜索

用户：

```text
找一下最近出去玩的照片。
```

通过：

```text
Immich
```

完成搜索，并返回照片 UI。

---

## 场景 5：定时任务

用户：

```text
每天早上帮我检查服务器和家里的状态。
```

Jarvis 应创建 Schedule。

---

# 50. Hermes 能力验证必须回答的问题

M3.2 结束前必须得到实际结论：

1. Hermes 能否稳定发现 MCP？
2. Tool Selection 是否可靠？
3. Skills 是否适合作为高层能力？
4. MCP 与 Skill 如何分工？
5. context_token 是否稳定？
6. Tool Result 是否足够生成 Dynamic UI？
7. Approval 是否能够挂入 Conversation？
8. Tool 数量增加后是否需要 Registry？
9. 是否真的需要 API Gateway？
10. 是否真的需要 Workflow Engine？

---

# 51. 不得提前建设 API Gateway

M3.2 明确：

> **不建设独立 API Gateway。**

只有完成 Hermes MCP / Skills 实测以后，确认存在：

```text
能力发现困难
权限无法控制
协议不统一
审计困难
流量治理需要
```

等真实问题，才进入下一阶段评估。

---

# 52. Android 开发策略

M3.2 暂停 Android 新功能开发。

Android 进入：

```text
Maintenance Mode
```

仅保留：

```text
能够启动
能够登录
能够连接 Jarvis
已有基础状态可用
严重 Bug 修复
```

不与 Web 同步开发：

```text
Conversation V2
Dynamic UI V2
Workspace V2
Identity New UI
MCP UI
Skill UI
```

---

# 53. 为什么暂停 Android

当前仍在快速变化：

```text
Identity
Conversation
Workspace
Dynamic UI
Hermes
MCP
Permission
```

此时 Web + Android 同时开发会导致：

```text
Web 做一遍
Android 做一遍
产品变化
Web 重构
Android 重构
```

大量重复工作。

因此：

> **Web 成为 M3.2 唯一主验证客户端。**

---

# 54. 暂停 Android 不代表 Web-only 架构

所有新协议必须平台无关。

允许：

```text
turn
activity
approval
question
artifact
resource
action
view
```

禁止使用：

```text
render_html
open_react_component
browser_only_action
```

作为核心协议。

---

# 55. Docker 优先

M3.2 新增基础服务默认使用：

```text
Docker / Docker Compose
```

不继续扩大 k3s 依赖。

旧 k3s 配置可以保留兼容，但不作为未来默认方向。

---

# 56. M3.2 明确不做什么

以下内容不属于 M3.2。

## 不做独立 API Gateway

除非真实验证证明需要。

## 不做大型 RBAC

不引入：

```text
OPA
Casbin
Zanzibar-like
```

重型体系。

## 不重做 Android

Android 只维护。

## 不创建多个 Jarvis

一个家庭只有一个。

## 不创建多个 Hermes Jarvis Profile

保持：

```text
jarvis
```

## 不重写 Home Assistant

## 不重写 Immich

## 不重写 Frigate

## 不重写 CasaOS

## 不重新开发通用 Chat Framework

优先 assistant-ui。

## 不深度建设 Workflow Platform

先验证需求。

---

# 57. M3.2 推荐实施顺序

## M3.2.0 Open Source Architecture Spike

必须首先完成。

包括：

```text
assistant-ui PoC
Conversation ADR
Authentik Deployment PoC
Hermes MCP / Skill Capability Audit
```

这一步不是正式大规模开发。

目的是避免选错方向。

---

## M3.2.1 Identity Foundation

完成：

```text
Authentik
OIDC
admin/member
user_identities
household
Break-glass
```

---

## M3.2.2 Execution Context

完成：

```text
actor
household
session
run
context_token
Integration Credential
Hermes Profile
```

---

## M3.2.3 Conversation OSS Integration

首先：

```text
assistant-ui
   ↓
Jarvis Runtime Adapter
```

验证：

```text
send
history
stream
retry
scroll
tool call
approval
```

---

## M3.2.4 Conversation Event Model

完成：

```text
Turn
Activity
Approval
Question
Artifact
Active Turn
```

---

## M3.2.5 Jarvis Conversation UX

在开源基础上增加：

```text
Activity Group
Jarvis Capability Labels
Household Context
Inline Approval
Dynamic UI Adapter
Workspace
Developer Mode
```

---

## M3.2.6 Hermes MCP / Skills Validation

完成：

```text
HA
Frigate
System
Immich
Schedule
```

真实场景。

---

## M3.2.7 Cleanup

完成：

- 移除旧 Chat UI；
- 移除重复实现；
- 收敛旧 Hermes 逻辑；
- 收敛 Credentials；
- 补测试；
- 更新文档。

---

# 58. Conversation Open Source PoC 验收要求

assistant-ui PoC 必须至少完成：

```text
Jarvis history
Jarvis message send
Streaming
Reconnect
Tool Call
Tool Result
Approval
```

如果可行，则直接作为正式基础。

如果不可行，必须输出：

```text
具体缺失能力
实际代码验证
不可解决原因
替代方案
```

才能改用其他实现。

---

# 59. 测试要求

M3.2 必须补充：

```text
Identity integration tests
OIDC mapping tests
context_token tests
MCP authorization tests

Conversation event tests
Turn lifecycle tests
Activity lifecycle tests
Approval tests
Streaming reconnect tests

assistant-ui adapter tests
```

---

# 60. M3.2 最终目标架构

```text
                         Authentik
                            │
                     Human Identity
                            │
                            ▼
                    ┌──────────────┐
                    │    Jarvis    │
                    │ Unified UI   │
                    └──────┬───────┘
                           │
                    Conversation
                           │
                  assistant-ui Web
                           │
                  Jarvis UI Adapter
                           │
                      Gateway
                           │
                    Jarvis Kernel
                           │
              ┌────────────┴────────────┐
              │                         │
         Dynamic UI                  Hermes
              │                         │
         Workspace                 MCP / Skills
                                        │
        ┌────────────┬────────────┬──────┴──────┐
        │            │            │             │
       HA         Frigate       Immich       System
        │            │
     Devices       Cameras
```

---

# 61. 身份与执行链

```text
Human
  │
  │ Authentik
  ▼
Jarvis
  │
  │ internal user_id
  ▼
actor + household
  │
  │ context_token
  ▼
Hermes
  │
  │ MCP / Skill
  ▼
Jarvis Capability
  │
  │ Service Credential
  ▼
Third-party System
```

---

# 62. M3.2 验收标准

## AC-01

多个家庭成员可以统一登录 Jarvis。

## AC-02

所有成员使用同一个 Jarvis。

## AC-03

Hermes Profile 仍然只有一个：

```text
jarvis
```

## AC-04

Jarvis 可以明确识别当前 actor。

## AC-05

Household 模型正式存在。

## AC-06

context_token 正确传递 actor/session。

## AC-07

Integration Credential 与用户登录分离。

## AC-08

Conversation V2 首先完成成熟开源方案评估。

## AC-09

assistant-ui 完成真实 PoC。

## AC-10

如果没有使用 assistant-ui，存在完整 ADR 和技术证据。

## AC-11

不得无理由自研 Scroll、Composer、Streaming、Tool UI 等已有成熟能力。

## AC-12

Conversation 支持 Turn。

## AC-13

支持 Active Turn。

## AC-14

Tool Call 是一等 Activity。

## AC-15

Activity 支持：

```text
queued
running
waiting_approval
completed
failed
```

## AC-16

Activity 可以 Group / Collapse。

## AC-17

Approval 可以直接在 Conversation 完成。

## AC-18

至少支持 boolean / single-choice Inline Question。

## AC-19

Workspace 可以从 Conversation 展开。

## AC-20

Dynamic UI Protocol 保持平台无关。

## AC-21

至少三个真实系统可以通过 Hermes MCP / Skill 操作。

目标系统：

```text
HA
Frigate
Immich
System
```

## AC-22

定时任务可以通过自然语言创建。

## AC-23

普通用户不需要理解：

```text
MCP
Skill
Hermes
Model
API
```

即可使用 Jarvis。

## AC-24

Developer Mode 可以查看必要底层执行信息。

## AC-25

Android 不参与 M3.2 新功能验收。

## AC-26

M3.2 不新增独立 API Gateway。

---

# 63. M3.2 成功标准

M3.2 最终不是以：

```text
完成多少页面
增加多少 API
增加多少代码
```

衡量成功。

真正的成功标准是：

> **多个家庭成员可以通过统一身份登录同一个 Jarvis；Jarvis 通过 Hermes 原生 MCP / Skills 完成真实任务；整个执行过程能够通过成熟的开源 Conversation 基础设施自然呈现；用户看到的是 Jarvis 在理解、行动和反馈，而不是一堆底层服务、API、MCP 和管理后台。**

---

# 64. M3.2 开发执行特别要求

所有参与 M3.2 的开发 Agent 和开发者必须遵守：

1. **Open Source First。**
2. 已有成熟能力必须先评估复用。
3. 不得以“自己写方便”为由重新造轮子。
4. Conversation 首先做 assistant-ui PoC。
5. 不得为了 assistant-ui 改掉 Hermes 架构。
6. Jarvis 后端协议保持平台无关。
7. 一个家庭只有一个 Jarvis。
8. 一个 Jarvis 只有一个 Hermes Profile。
9. Authentik 只负责身份，不接管所有业务权限。
10. context_token 与 OIDC Token 不得混用。
11. Service Credential 与 Human Login 分离。
12. 不提前建设 API Gateway。
13. Web 是 M3.2 主客户端。
14. Android 进入维护状态。
15. Dynamic UI 不绑定 React。
16. 第三方应用优先集成，不复制功能。
17. GPL 或许可证不明确的代码不得直接复制。
18. 所有重大自研基础组件必须说明为什么现有开源实现不可用。

---

# 65. 最终产品原则

整个 M3.2 开发过程中必须始终用下面这句话判断设计是否正确：

> **一个家庭，一个 Jarvis，一个统一入口。**

同时遵守第二条原则：

> **别人已经成熟解决的问题，就集成；只有 Jarvis 独有的问题，才自研。**

Jarvis 的真正差异化不在于重新开发 Chat、NAS、Home Assistant、NVR、相册或身份认证。

Jarvis 真正应该投入研发资源的地方是：

> **如何让一个统一的 AI 管家理解家庭、理解用户、理解设备、理解应用，并通过对话、Agent、MCP、Skills 和 Dynamic UI，把这些原本割裂的能力组织成一个整体。**