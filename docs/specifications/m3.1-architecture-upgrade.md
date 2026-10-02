# Jarvis M3.1 架构升级文档

**文档版本**：M3.1 Architecture Upgrade  
**状态**：架构基线候选  
**日期**：2026-09-15  
**目标**：在不推翻 M3 已有产品外壳、Dynamic UI、Agent Run、K3s Worker、CasaOS 集成等基础的前提下，重新划清 Jarvis 的产品边界、Agent 架构、Workspace 交互、应用集成方式、身份体系与部署关系，为 M3 后续迭代和 M4 奠定稳定架构。

---

## 1. 背景

M3 已经形成了可运行的 Jarvis 产品外壳：Web、Android、首页、空间、应用、任务、Jarvis 对话入口、系统监控、部分 Dynamic UI、CasaOS 应用读取、Agent Run、Worker Controller、K3s 隔离执行等能力。

但在实际体验和继续扩展过程中，暴露出几个结构性问题：

1. Jarvis 对话页仍接近“简单聊天框”，无法承担现代 AI Client 的基本体验。
2. Dynamic UI 当前主要依赖预设 `ViewSpec`，更像动态仪表盘，而不是 ChatGPT Canvas / Gemini Canvas 式持续工作区。
3. Jarvis Core 自己实现了 LLM loop、tool loop、history、delegation 等能力，长期维护成本高。
4. Agent、Runtime、Framework、Worker 等概念混杂，Pydantic AI、Codex、Hermes 的职责边界不清晰。
5. Jarvis App 有向“超级 App”演变的风险，容易重复实现 Immich、Home Assistant、Obsidian 等应用的完整功能。
6. Jarvis Agent 与具体 App 的能力接入方式尚未形成统一原则。
7. 缺少正式的 App Bridge / Deep Link 层。
8. 当前身份体系仍以设备配对和 Web Session 为主，不适合多用户，也无法保证长期稳定登录。
9. Hermes 如果作为 Jarvis Core，需要明确其部署位置，不应形成“Jarvis 依赖 CasaOS 中的一个普通 App”的倒置关系。
10. Codex 当前以 Coding Agent 形态存在，但更合理的定位应是 Node Bridge 下的一种 Coding Runtime / Capability。

M3.1 的目的不是重做 M3，而是把这些架构边界一次性理顺。

---

## 2. M3.1 核心结论

M3.1 采用以下总原则：

> **Jarvis App 负责入口、交互、Workspace、任务、搜索和跳转；Hermes 负责智能；Jarvis Kernel 负责真实能力、权限、资源和持久化任务；具体应用保留完整业务功能。**

进一步抽象为：

- **Jarvis App = User Experience**
- **Hermes = Agent / Intelligence**
- **Jarvis Kernel = Control Plane**
- **MCP = Capability Interface**
- **Skill = Procedure**
- **App Bridge = Application Navigation / Integration Gateway**
- **Node Bridge = Device Execution Gateway**
- **Codex = Node Capability / Coding Runtime**
- **AgentManager → Durable Task / Execution Manager**
- **Concrete App = Full Domain Experience**

Jarvis 的长期产品原则：

> **Jarvis 不复制应用；Jarvis 理解、连接、调用应用。**

---

## 3. 目标总体架构

```text
┌──────────────────────────────────────────────────────────────┐
│                        Jarvis App                            │
│                                                              │
│  Home   Spaces   Apps   Tasks   Search   Jarvis   Settings   │
│                                      │                       │
│                              ┌───────┴────────┐              │
│                              │ Conversation   │              │
│                              │ Workspace      │              │
│                              └───────┬────────┘              │
└──────────────────────────────────────┼───────────────────────┘
                                       │
                                Jarvis Gateway
                                       │
┌──────────────────────────────────────▼───────────────────────┐
│                       Agent Layer                            │
│                                                              │
│                      Hermes Core                             │
│                                                              │
│   Memory   Skills   Context   Tools   Provider   Delegation  │
│                                                              │
│      ├── Ops Subagent                                        │
│      ├── Research Subagent                                   │
│      ├── Integration Subagent                                │
│      └── other Hermes Subagents                              │
└──────────────────────────────────────┬───────────────────────┘
                                       │
                                Agent Bridge
                                       │
┌──────────────────────────────────────▼───────────────────────┐
│                       Jarvis Kernel                           │
│                                                              │
│ Capability Registry     Resource Model     Workspace Model    │
│ Permission / Approval   Task / Execution   Identity / User   │
│ Integration Credential Memory / Context   Event / Artifact   │
└────────────────────┬─────────────────────┬───────────────────┘
                     │                     │
             ┌───────▼────────┐    ┌───────▼─────────┐
             │   App Bridge   │    │   Node Bridge   │
             │                │    │                 │
             │ launch         │    │ filesystem      │
             │ deep link      │    │ shell           │
             │ resource map   │    │ git             │
             │ web fallback   │    │ docker          │
             └───────┬────────┘    │ process         │
                     │             │ device          │
                     │             │ codex           │
                     │             └───────┬─────────┘
                     │                     │
       ┌─────────────▼──────────┐      Physical Nodes
       │   Concrete Apps        │      Ubuntu / Mac / Windows
       │                        │
       │ Immich                 │
       │ Home Assistant         │
       │ Obsidian               │
       │ CasaOS                 │
       │ Jellyfin               │
       │ ...                    │
       └────────────────────────┘
```

---

## 4. Jarvis UI：从“聊天页”升级为 Conversation + Workspace

### 4.1 当前问题

Android 和 Web 的 Jarvis 页面目前仍主要是单纯聊天框：

- Android Jarvis 页能力弱；
- Markdown 渲染不足；
- 缺乏流式文本体验；
- 缺乏代码块、表格、图表等 Rich Content；
- 复杂任务没有独立工作面；
- Dynamic UI 和普通对话的边界不清晰。

### 4.2 M3.1 目标

Jarvis 一级入口保持不变，但其内部拆分为：

```text
Jarvis
├── Conversation
└── Workspace
```

#### Conversation 必须支持

- 真正的 chunk/token 级流式回复；
- Markdown；
- 代码块；
- 表格；
- 链接；
- Tool / Agent 状态；
- 小型结构化 Rich Component；
- Workspace Card；
- “打开工作区”操作。

#### Rich Message 与 Workspace 的边界

**Rich Message** 用于辅助理解：

- 小图表；
- 状态卡；
- 文件卡；
- 图片列表；
- 简短任务状态。

**Workspace** 用于持续工作：

- 文档；
- 数据分析；
- Dashboard；
- 代码；
- 文件；
- Gallery；
- 任务；
- Web App；
- Composite Artifact。

原则：

> Chat 中展示“摘要与入口”，Workspace 中承载“完整工作对象”。

---

## 5. Workspace / Canvas 模型

### 5.1 定位

Workspace 不等于“另一个功能页面”，而是：

> **由当前 Conversation / Task 驱动的持续工作对象。**

体验参考 ChatGPT Canvas / Gemini Canvas。

### 5.2 Web

推荐布局：

```text
┌──────────┬────────────────┬────────────────────────────┐
│ Sidebar  │ Conversation   │ Workspace                  │
│          │                │                            │
│          │                │                            │
└──────────┴────────────────┴────────────────────────────┘
```

Conversation 可收起、展开、调宽。

### 5.3 Android

由于屏幕宽度有限：

```text
Conversation
     ↓
[打开工作区]
     ↓
Workspace 全屏
     ↓
← 返回 Conversation
```

Workspace 属于 Jarvis 内部导航，不增加新的底部一级导航。

---

## 6. Workspace 成为一级持久化对象

Workspace 不能只是临时 UI 状态。

建议新增稳定模型：

```text
Workspace
├── workspace_id
├── user_id
├── conversation_id
├── task_id?
├── artifact_id
├── type
├── revision
├── status
├── metadata
├── created_at
└── updated_at
```

Conversation 与 Workspace 的关系：

```text
Conversation
├── Messages
└── Workspaces
    ├── Workspace A
    └── Workspace B
```

用户第二天可以说：

> “打开昨天那个服务器分析。”

Jarvis 应恢复：

- Conversation；
- Workspace；
- Artifact；
- 相关 Task；
- 相关 Context。

---

## 7. Dynamic UI 双轨制

M3.1 不推翻现有 `ui-protocol-v2`。

目标是形成两种互补的 Workspace Renderer。

### 7.1 Native Semantic UI

继续使用现有：

```text
ViewSpec
→ component registry
→ resource binding
→ Web React / Android Compose
```

适合：

- 系统状态；
- Agent Run；
- 任务；
- 审批；
- 文件列表；
- Gallery；
- 指标；
- 系统管理；
- 高安全性操作。

优点：

- 跨端一致；
- 权限可控；
- 原生；
- 稳定；
- 可降级。

### 7.2 Generative Web Artifact

新增：

```text
WorkspaceArtifact
  type = web
```

允许生成：

- HTML；
- CSS；
- JavaScript；
- React。

运行环境：

```text
Web     → sandbox iframe
Android → WebView
```

适合：

- 数据分析；
- 临时 Dashboard；
- 交互式报告；
- 模拟器；
- 可视化；
- 动态表单；
- 临时工具；
- 小型 Web App。

### 7.3 安全原则

AI 生成的 HTML / React 不可直接访问 Jarvis 内部 API。

只能通过 Bridge 调用：

```text
jarvis.invoke(capability, input)
```

经过：

```text
Workspace
→ Jarvis Bridge
→ Permission
→ Capability Registry
→ Provider
```

---

## 8. Dynamic UI 开源实现参考

M3.1 不从零发明完整 Runtime，优先借鉴成熟实现。

重点参考：

1. **CopilotKit OpenGenerativeUI**
   - HTML/CSS/JS 流式生成；
   - UI 边生成边显示；
   - Sandbox Bridge；
   - DOM morph。

2. **LibreChat Artifacts**
   - Chat → Artifact；
   - React / HTML；
   - Sandpack；
   - Artifact 与对话协同。

3. **Open WebUI Artifacts**
   - iframe `srcdoc`；
   - sandbox；
   - CSP；
   - Chat 右侧 Artifact。

4. **Vercel Chatbot**
   - Artifact 成为一级状态对象；
   - create / update / revision 生命周期。

5. **LangChain Open Canvas**
   - Canvas UX；
   - 文档 / Code Canvas；
   - Chat + Artifact 布局。

6. **Google A2UI**
   - 声明式 Agent-to-UI；
   - 可作为现有 Semantic UI 协议继续演进的参考。

原则：

> Native Semantic UI 负责可信系统体验；Generative Web Artifact 负责高自由度动态工作区。

---

## 9. Jarvis Core 迁移到 Hermes

### 9.1 当前问题

当前 `ConversationService` 自己实现：

- System Prompt；
- History 拼接；
- DeepSeek Streaming；
- Tool Calls；
- 最多 8 轮循环；
- Delegation；
- Usage；
- Tool Result 回填。

这实际是在维护一套自研轻量 Agent Runtime。

### 9.2 M3.1 目标

Hermes 成为 Jarvis Core 的 Agent Engine。

```text
ConversationService
      ↓
Hermes Core
      ↓
Jarvis Agent Bridge
      ↓
Jarvis Kernel
```

Hermes 负责：

- Agent Loop；
- Context；
- Memory；
- Skills；
- Tool Registry；
- Provider；
- Streaming；
- Delegation；
- Context Compression；
- Session-level reasoning。

Jarvis 保留：

- 用户身份；
- 权限；
- 数据；
- Capability；
- Integration；
- Workspace；
- Durable Task；
- Artifact；
- 审批；
- 审计。

原则：

> **Hermes 负责“智能”，Jarvis Kernel 负责“真实世界”。**

---

## 10. Hermes 统一 Agent 体系

以后 Jarvis 中“Agent”这个概念只表示：

> **基于 Hermes、拥有独立上下文 / Instructions / Skills / Tools / Memory Scope 的智能角色。**

例如：

- Jarvis Core；
- Ops Agent；
- Research Agent；
- Integration Agent；
- Home Agent。

不再采用：

```text
Ops Agent = Pydantic AI
Coding Agent = Codex
Research Agent = 另一个 Framework
```

这种一角色一框架模式。

---

## 11. Pydantic AI 退出主 Agent 架构

当前 Ops Agent：

```text
Pydantic AI
+ DeepSeek
+ Read-only Tools
```

M3.1 建议替换为：

```text
Hermes Ops Subagent
+ Read-only Capability Profile
```

Ops Agent 仍然保留角色，但不再需要独立 Pydantic AI Runtime。

允许保留 Pydantic AI 作为某些未来 Python typed workflow 的内部库，但不再定义为 Jarvis 一级 Agent Framework。

---

## 12. Codex 取消 Agent 身份

这是 M3.1 的重要修正。

Codex 不应该是：

```text
Coding Agent
```

而应该是：

> **Node Bridge 下的一种 Coding Runtime / Capability。**

正确关系：

```text
Hermes Agent
    ↓
Capability
    ↓
Node Bridge
    ↓
Codex
```

例如：

```text
node.codex.execute
node.git.read
node.git.diff
node.shell.execute
node.file.read
```

复杂 Coding Task 可以：

```text
Hermes Coding Subagent
        ↓
node.codex.execute
        ↓
Codex Runtime
```

简单任务则可以由 Core 直接调用 Codex Capability。

原则：

> **Coding Agent 是可选智能角色；Codex 是固定专业执行能力。**

Codex 不应出现在用户的 Agent 列表中。

---

## 13. Node Bridge

Node Bridge 成为 Jarvis 与真实计算设备之间的统一桥梁。

支持节点：

- Ubuntu Server；
- Mac；
- Windows；
- NAS；
- Edge Device。

Node Capability 示例：

```text
node.system.read
node.file.read
node.file.write
node.shell.execute
node.process.list
node.git.*
node.docker.*
node.device.*
node.codex.execute
```

Node Bridge 负责：

- 节点发现；
- 节点认证；
- Capability 广播；
- 任务执行；
- 本地资源访问；
- Runtime 调用；
- 状态回传；
- 安全边界。

---

## 14. AgentManager 重定位为 Durable Task / Execution 层

现有 `AgentManager + Worker Controller + Kubernetes Job` 具有实际价值，不应因 Hermes 引入而删除。

Hermes `delegate_task` 适合：

- 临时研究；
- 并行思考；
- 日志分析；
- 小型子任务。

Jarvis Durable Task 适合：

- 修改代码；
- 安装应用；
- 长时间分析；
- 跨应用工作流；
- 审批；
- Workspace 生成；
- 需要恢复 / 重试 / 审计的任务。

因此建议将现有 AgentManager 概念逐步重定位为：

```text
TaskManager
或
ExecutionManager
```

负责：

```text
queued
running
waiting
approval
completed
failed
cancelled

events
artifacts
retry
durability
```

任务元数据可包含：

```text
requested_by_agent
executor_node
capability
provider
runtime
workspace
artifacts
```

---

## 15. Jarvis App 的产品边界

Jarvis App 不应成为超级 App。

不应重做：

- Immich 完整照片管理；
- Home Assistant 完整 Dashboard；
- Obsidian 编辑器；
- Jellyfin 播放器；
- CasaOS 管理 UI；
- Portainer 完整容器管理。

Jarvis App 应负责：

- Home；
- Conversation；
- Workspace；
- Tasks；
- Search；
- Apps；
- Settings；
- 状态摘要；
- AI Action；
- 跳转具体 App。

核心原则：

> **UI-light integration, Agent-first integration.**

---

## 16. Jarvis Agent 深度访问应用

虽然 Jarvis App 不复制具体 App，但 Jarvis Agent 应能深入访问应用能力。

统一通过：

- MCP；
- Skill；
- API / Plugin；
- Capability Provider。

例如 Immich：

```text
immich.photo.search
immich.album.read
immich.album.create
immich.photo.add
```

Home Assistant：

```text
homeassistant.entity.read
homeassistant.service.call
```

Obsidian：

```text
obsidian.search
obsidian.note.read
obsidian.note.write
```

---

## 17. Skill 与 MCP 职责划分

M3.1 明确：

```text
MCP = capability
Skill = procedure
```

### MCP

回答：

> “我能调用什么外部能力？”

例如：

```text
search_photos
get_album
create_album
add_photo
```

### Skill

回答：

> “我应该怎样组合这些能力完成任务？”

例如：

```text
family-trip-album
1. 按时间地点搜索
2. 去重
3. 按人物筛选
4. 选择高质量照片
5. 创建相册
6. 打开相册
```

Hermes Core 位于 Skill 与 MCP 之上。

---

## 18. App Bridge

Jarvis 必须新增正式 App Bridge，而不是零散 URL 跳转。

每个应用注册：

```text
AppDescriptor
├── id
├── name
├── launch
├── deep_links
├── capabilities
├── resources
├── icon
└── status
```

例如：

```text
Immich
├── launch.web
├── launch.android
├── deep_link.photo
├── deep_link.album
└── deep_link.search
```

### Android

优先：

```text
Deep Link / Intent
```

失败后：

```text
Web URL fallback
```

### Web

支持：

- same window；
- new tab；
- resource-specific URL。

Workspace 和 Chat 均可提供：

```text
[在 Immich 中打开]
[在 Home Assistant 中打开]
```

---

## 19. Workspace 与具体 App 的边界

Workspace 是：

> **跨应用、任务导向、AI 生成的临时 / 持续工作面。**

Concrete App 是：

> **领域导向、长期稳定、完整功能体验。**

例如：

“帮我规划家庭聚会”

Workspace 可以组合：

- Calendar；
- Immich；
- Weather；
- Todo；
- Map；
- Home Assistant。

但当用户进入 Immich 复杂相册管理时，应跳回 Immich。

---

## 20. 身份体系重构

### 20.1 当前问题

现有体系主要依赖：

- Device Pairing；
- Device Token；
- Web Session；
- 30 天 Session；
- Android / Web 偶发重新登录。

这不适合作为长期产品身份模型。

### 20.2 新模型

明确拆分：

```text
User
= 你是谁

Device
= 哪台设备

Session
= 当前登录状态
```

建议新增：

```text
users
credentials
devices
sessions
integration_credentials
roles
permissions
```

---

## 21. 用户名 / 密码登录

Jarvis 正式采用：

```text
username
password
```

作为基础身份入口。

密码只保存：

```text
Argon2id hash
```

不保存明文，也不使用简单 SHA256(password)。

未来允许增加：

- Passkey；
- TOTP；
- Face ID / 指纹本地解锁；
- LDAP / OAuth（如有需要）。

---

## 22. 长期 Session：一次登录后不应频繁重新登录

用户体验目标：

> **登录一次，长期保持。**

但不采用永不过期 Access Token。

推荐：

```text
短期 Access Token
+
长期 Refresh Session
```

Refresh Session 使用 sliding renewal：

```text
只要设备持续正常使用
→ 自动续期
```

只有以下场景重新登录：

- 用户主动退出；
- 管理员撤销；
- 用户选择退出所有设备；
- Credential 被判定失效；
- 安全事件。

---

## 23. App 更新 / Server 更新不得导致退出登录

M3.1 加入 Release Gate。

### Android

1. 登录；
2. 关闭 App；
3. 重启手机；
4. 保持登录；
5. 覆盖安装新版 APK；
6. 保持登录；
7. Server 重启 / 升级；
8. 自动恢复 Session。

### Web

- 浏览器重启保持；
- Jarvis Server 更新保持；
- Session 自动刷新；
- 不再因为固定 30 天到期被迫重新登录。

---

## 24. Pairing Code 的新定位

Pairing 不删除，但不再等于“账户”。

未来 Pairing 用于：

- 新设备快速加入；
- 二维码登录；
- 管理员邀请；
- 恢复。

例如：

```text
Mac 显示二维码
↓
手机 Jarvis 扫描
↓
Mac 注册为当前用户的新设备
```

---

## 25. 多用户

新身份体系必须为家庭场景准备。

例如：

```text
Admin
Francesca

Member
Family Member A

Member
Family Member B
```

每个用户独立：

- Conversation；
- Workspace；
- Task；
- Memory；
- Preferences；
- App Permissions；
- Sessions。

可共享：

- Home Assistant；
- Immich；
- Server；
- Shared Files。

---

## 26. Integration Credential 与 Jarvis Login 分离

必须明确：

```text
Jarvis User
≠ Immich User
≠ Home Assistant User
≠ CasaOS User
```

Jarvis 用户拥有：

```text
Integration Credentials
├── Immich
├── Home Assistant
├── GitHub
└── ...
```

Jarvis Agent 是否可访问某个应用，由：

```text
User
→ Permission
→ Integration Credential
→ Capability
```

共同决定。

---

## 27. Hermes 部署方式

M3.1 明确：

> **Hermes 是 Jarvis 内部 Agent Engine，不是 CasaOS 中的普通 App。**

不推荐：

```text
CasaOS App Store
→ Hermes
→ Jarvis Core
```

也不推荐生产环境直接裸装到 Ubuntu Host。

推荐：

```text
Official Hermes Container
+
Jarvis K3s
```

---

## 28. 目标部署拓扑

```text
Ubuntu Server
│
├── K3s
│   │
│   ├── jarvis-gateway
│   ├── jarvis-kernel
│   ├── hermes-core
│   ├── task / execution manager
│   ├── worker-controller
│   └── node-bridge
│
└── Application Plane
    │
    ├── CasaOS
    ├── Immich
    ├── Home Assistant
    ├── Jellyfin
    └── Other Apps
```

Hermes：

- 使用官方容器；
- 内部 Service；
- 不直接暴露给手机 / Web；
- 数据使用 PVC；
- 由 Jarvis K3s 管理生命周期。

---

## 29. App Plane / Agent Plane / Node Plane

M3.1 正式引入三种外部平面。

### App Plane

具体应用：

- Immich；
- Home Assistant；
- Obsidian；
- CasaOS；
- Jellyfin。

入口：

```text
App Bridge
MCP
Integration Provider
```

### Agent Plane

智能层：

```text
Hermes Core
Hermes Subagents
Skills
Memory
Context
Delegation
```

### Node Plane

实际设备：

- Ubuntu；
- Mac；
- Windows；
- NAS。

入口：

```text
Node Bridge
```

提供：

- Shell；
- File；
- Git；
- Docker；
- Codex；
- Local App；
- Device Control。

---

## 30. 协议与事件模型建议

现有 AgentEvent 和 WebSocket 基础继续保留。

M3.1 推荐新增或统一：

```text
conversation.message.delta
conversation.tool.started
conversation.tool.completed
conversation.status

workspace.created
workspace.updated
workspace.opened
workspace.artifact.updated

task.created
task.started
task.waiting
task.completed
task.failed

node.status.changed
node.capability.changed

app.status.changed
app.resource.changed
```

Workspace 与 Task 均使用：

```text
id
revision
resource binding
```

支持断线恢复与增量更新。

---

## 31. 数据模型调整建议

建议逐步新增或调整：

### Identity

```text
users
user_credentials
devices
sessions
roles
permissions
integration_credentials
```

### Workspace

```text
workspaces
workspace_artifacts
workspace_revisions
workspace_bindings
```

### Task / Execution

现有：

```text
agent_runs
agent_instances
```

逐步抽象为：

```text
tasks
executions
execution_events
artifacts
```

### Capability

```text
capabilities
capability_providers
provider_bindings
node_capabilities
app_capabilities
```

### App Bridge

```text
apps
app_launchers
app_deep_links
app_resource_mappings
```

---

## 32. 对现有 M3 模块的影响

### 保留

- Web Shell；
- Android Shell；
- Home；
- Spaces；
- Tasks；
- Apps；
- System；
- WebSocket；
- PostgreSQL；
- Resource / revision；
- `ui-protocol-v2`；
- Web / Android Renderer；
- Agent Event；
- Artifact；
- Worker Controller；
- K3s Worker；
- CasaOS Adapter。

### 重构

- Jarvis Chat；
- ConversationService；
- Agent definition；
- AgentManager 命名与职责；
- Authentication；
- App 页面；
- Workspace 模型；
- Integration Credential；
- Dynamic UI Runtime。

### 删除 / 降级

- Pydantic AI 作为一级 Agent Runtime；
- Codex 作为 Agent；
- Device Pairing 作为主身份方式；
- CasaOS 作为 Hermes 生命周期管理者；
- Jarvis 内复制第三方 App 完整功能的方向。

---

## 33. 迁移顺序

建议 M3.1 分六步实施。

### Phase 1：Conversation v2

完成：

- Streaming；
- Markdown；
- Code；
- Table；
- Rich Message；
- Workspace Card。

不先改 Agent。

### Phase 2：Workspace

完成：

- Workspace 数据模型；
- Web Canvas 布局；
- Android Workspace 全屏；
- Conversation ↔ Workspace；
- Native Semantic Artifact。

### Phase 3：Identity v2

完成：

- User；
- Username / Password；
- Session；
- Refresh；
- Device；
- Logged-in Devices；
- Session Persistence；
- Pairing 新定位。

### Phase 4：Hermes Core

完成：

- Hermes 容器；
- Jarvis Agent Bridge；
- Tool mapping；
- Streaming callbacks；
- Memory / Skill 基础；
- 替换自研 DeepSeek tool loop。

### Phase 5：Agent / Task 重构

完成：

- Pydantic Agent 退出；
- Hermes Ops Subagent；
- AgentManager → Task / Execution；
- Codex 从 Agent 移出；
- Node Bridge 接入 Codex。

### Phase 6：Integration / App Bridge

完成：

- AppDescriptor；
- Deep Link；
- Web URL fallback；
- MCP / Skill；
- Integration Credential；
- Jarvis App UI-light integration。

---

## 34. M3.1 范围

M3.1 必须完成的架构能力：

1. Conversation v2；
2. Workspace 一级对象；
3. Chat ↔ Workspace；
4. Web / Android 基础 Workspace；
5. User / Device / Session；
6. Username / Password；
7. 长期 Session；
8. App 更新不掉登录；
9. Hermes Core 最小接入；
10. Hermes 与 Jarvis Tool Bridge；
11. Agent 体系统一原则；
12. Codex Agent 身份移除；
13. Node Bridge 设计落地；
14. App Bridge 基础；
15. Jarvis App 产品边界调整。

---

## 35. M3.1 非目标

M3.1 不要求一次完成：

- 所有 App 的 MCP；
- 所有 Skills；
- 完整多用户家庭共享 UI；
- 所有 Node Bridge Capability；
- 完整 Computer Use；
- 所有 Generative Web Artifact 能力；
- 所有 Workspace 类型；
- 全量 Integration Agent；
- 替换所有现有数据库表；
- 一次性删除所有 M2 legacy API。

原则是：

> **先冻结正确边界，再逐步迁移实现。**

---

## 36. 验收标准

### A. Conversation

- Web / Android 均支持流式回复；
- Markdown 正常；
- 代码块正常；
- 表格正常；
- 可显示结构化 Rich Message；
- 消息可打开 Workspace。

### B. Workspace

- Workspace 与 Conversation 分离；
- 可持久化；
- 可恢复；
- Web Canvas 式布局；
- Android 全屏 Workspace；
- 同一 Workspace 支持 revision 更新。

### C. Hermes

- Hermes 由 K3s 容器运行；
- Jarvis Gateway 不直接把 Hermes 暴露给客户端；
- Hermes 能通过 Tool Bridge 调用 Jarvis Capability；
- Hermes Streaming 能映射到 Conversation；
- Core 不再依赖手写固定 8 轮 tool loop。

### D. Agent

- Pydantic AI 不再作为 Jarvis 一级 Agent；
- Ops 使用 Hermes Subagent；
- Codex 不出现在 Agent 列表；
- Codex 经 Node Bridge Capability 被调用；
- Durable Task 与 Hermes 临时 delegation 有明确边界。

### E. App

- Jarvis 不复制 Immich / Home Assistant 的完整 UI；
- Apps 页面仅保留状态、摘要、AI Action、打开应用；
- 至少一个 App 支持 Deep Link；
- Android / Web 均可回到具体 App。

### F. Identity

- 用户名 / 密码登录；
- Android 登录后重启保持；
- Android 覆盖更新后保持；
- Server 重启后保持；
- Web 浏览器重启保持；
- Access 自动 refresh；
- 已登录设备可查看；
- 可主动撤销某设备 Session。

### G. Security

- AI 生成 Web Artifact 无法直接访问 Jarvis 内部 API；
- Capability 必须经过 Permission；
- Integration Credential 与 Jarvis Credential 分离；
- Hermes 不裸露公网；
- Node Bridge Capability 有权限边界。

---

## 37. M3.1 最终目标

M3.1 不是继续把更多功能堆进 Jarvis，而是让 Jarvis 的结构真正稳定下来：

```text
Jarvis App
= 一个入口

Hermes
= 一个智能层

Jarvis Kernel
= 一个控制面

Workspace
= 一个任务工作面

App Bridge
= 连接应用

Node Bridge
= 连接设备

MCP
= 暴露能力

Skill
= 复用方法

Concrete App
= 保留完整专业体验
```

最终产品愿景：

> **Jarvis 不是把所有应用重新做一遍，而是成为用户与整个数字生活之间的 AI 交互层。**

> **一个入口理解你的意图，一个 Agent 层组织智能，一个 Kernel 统一权限和资源，再通过 App Bridge 与 Node Bridge 去连接真实世界。**

---

## 38. M3 → M3.1 的核心变化摘要

| M3 当前倾向 | M3.1 调整 |
|---|---|
| Jarvis 对话页 | Conversation v2 |
| Dynamic UI 页面 | Workspace / Canvas |
| 预设 ViewSpec | Native Semantic + Generative Web Artifact |
| Core 自研 Agent Loop | Hermes Core |
| Pydantic Ops Agent | Hermes Ops Subagent |
| Codex Coding Agent | Node Bridge Coding Runtime |
| AgentManager | Durable Task / Execution Manager |
| App 原生化倾向 | UI-light Integration |
| Integration | Skill + MCP + Capability |
| URL 跳转 | App Bridge / Deep Link |
| Device Pairing | User / Device / Session |
| 30 天 Web Session | Refresh Session + Sliding Renewal |
| CasaOS Hermes | K3s Hermes Internal Service |
| 单一 App/Agent 思路 | App Plane / Agent Plane / Node Plane |

---

## 39. M3.1 架构判断

Jarvis 下一阶段的重点不应是继续扩充页面和 Agent 数量，而应优先完成 **Conversation、Workspace、Hermes、Identity、App Bridge、Node Bridge** 六条主干。

一旦这六条边界稳定，后续 Integration、Skill、MCP、Computer Use、Memory、多用户和更多应用接入都可以在不推翻架构的情况下持续扩展。
