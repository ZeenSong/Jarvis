# M4 — Android Daily Driver

> 日期：2026-10-02  
> 状态：计划中  
> 范围原则：M4 以**功能开发和移动端产品闭环**为主，不以代码重构、目录整理或性能微优化为目标。

## 1. 里程碑定位

M3.3 已完成 Jarvis 核心对话、Hermes Agent、Skills/MCP、Reasoning、Execution Stream、Result / Workspace、持久状态和真实家庭服务链路的关键验收。M4 不再以“补齐底座能力”为中心，而是把这些能力组织成一个真正可日常使用的 Android 产品。

M4 的目标不是把 Jarvis 做成手机里的通用 AI 助手，也不是复制“拍照问 AI、文件随手问、系统级万能入口”这一类能力。Jarvis 的 Android 客户端应明确定位为：

> **私人云的日常主入口：查看今天需要关注的事项、跟踪 Jarvis 正在执行的工作、处理待确认任务，并进入自己的空间、应用、结果与会话。**

M4 完成后，Android 应从“能够连接 Jarvis 的客户端”升级为“用户日常使用 Jarvis 的首要入口”。

## 2. 产品原则

1. **Jarvis ≠ 通用手机 AI 助手。** 不以拍照识别、通用图片问答、文件万能理解等“豆包化”能力作为 M4 产品方向。
2. **Android 与 Web 共享任务和结果语义，但不要求布局一致。** 同一个 Turn、Task、Result、Workspace 在两端应表示同一件事，移动端可以采用更适合触屏和纵向浏览的布局。
3. **首页首先回答“今天有什么值得我关注”。** CPU、内存、Token、Agent 监控等开发/运维信息保留，但降为二级系统页面，不再主导首页。
4. **通知只服务 Jarvis 域内的真实事件。** 重点是任务完成、任务失败、等待确认、结果就绪、空间/应用的重要状态变化。
5. **通知必须可继续操作。** 系统通知通过 Deep Link 精确回到对应 Conversation、Task、Workspace、Space、App 或 Notification。
6. **Frigate 不属于 M4 新功能范围。** M4 不新增 Frigate 依赖或围绕 Frigate 建立新的产品主线。
7. **功能优先。** 除非阻塞新功能交付，本阶段不以 Repository 拆分、协议重构、目录清理和大规模代码优化作为交付目标。

## 3. Android 首页概念

![M4 Android 首页概念图](../../product/concept-images/07_Jarvis_M4_Android_Home_Daily_Driver.jpg)

该图用于确定 M4 首页的信息架构和视觉方向，不作为逐像素实现规范。继续沿用当前 Android 客户端的深色海军蓝、蓝色 Orb、圆角卡片和五栏底部导航设计语言。

首页应由“系统监控 Dashboard”转为“私人云 Daily Driver”，主要层级如下：

- 顶部：JARVIS、连接状态、主题入口。
- Hero：“你的私人云”，同时承担今日状态摘要，而不是纯装饰。
- Jarvis 快速入口：“问 Jarvis，或说说你的想法……”。
- 今日重点：任务结果、待确认事项、重要状态等。
- Jarvis 正在工作：当前实际运行中的任务及进度。
- 快捷入口：通知、任务、空间、应用。
- 我的空间：个人、家庭、知识、媒体、开发等空间。
- 底部导航继续保持：首页 / 空间 / Jarvis / 任务 / 应用。

---

## 4. M4.1 — 首页产品化

### 目标

把 Android 首页从服务器/资源监控入口改造成 Jarvis 的日常总览。

### 功能要求

**今日重点**应从 Jarvis 已有的持久任务、结果、审批、通知和服务状态中生成可点击条目，优先展示：

- 已完成且值得查看的结果；
- 等待用户确认或回答的事项；
- 失败或异常的 Jarvis 任务；
- 私人云中值得注意的状态变化。

首页不得为了“显得智能”而生成没有事实来源的提醒。没有重点事项时，应明确显示“一切正常”或简洁空状态。

**Jarvis 正在工作**展示真实运行任务：

- 任务标题；
- 当前状态；
- 可获得时显示进度；
- 点击直接进入任务详情或关联 Conversation；
- 任务完成后转入结果/历史，不继续显示为运行中。

**系统指标降级**：

CPU、内存、GPU、服务器状态、Agent、LLM Usage 等能力继续保留，但进入“系统/管理”二级页面，不占据首页首屏核心区域。

### 验收

- 首页可在真实数据下展示今日重点和运行任务。
- 首页所有重点卡片均能进入对应真实对象。
- 无任务、无提醒时有稳定空状态。
- 底部五栏导航保持：首页 / 空间 / Jarvis / 任务 / 应用。

---

## 5. M4.2 — Android Jarvis Conversation 完整化

### 目标

Android 的 Jarvis 页完整承接 M3.3 已在 Web 建立的任务型对话体验，而不是退化为普通聊天窗口。

### 功能范围

Android Conversation 支持：

- 持久会话历史和语义标题；
- 文本流式输出；
- Provider 实际返回的 Reasoning 流；
- 有序 Execution Stream；
- Tool / Processing / Render / Result 状态；
- Skills 选择；
- 推理强度选择；
- Stop；
- Structured Question；
- Approval；
- Result；
- UI Protocol V2 动态结果；
- Workspace；
- 刷新、断线和重新进入后的服务端快照恢复。

移动端不要求复刻 Web 的横向布局。Execution Stream 可采用纵向时间线，Workspace 可使用全屏页面或适合手机的分层详情页。

### Dynamic UI

优先支持现有 UI Protocol V2 中对移动端有明确价值的语义组件：

- Gallery；
- Timeline；
- Metric；
- Chart；
- Table；
- Task；
- Alert；
- Question；
- Approval。

简单结果应尽量在 Conversation 内原生展示；复杂结果再进入全屏 Workspace。

### 验收

- Android 与 Web 打开同一 Conversation 时，核心 Turn / Task / Result 状态一致。
- 断线恢复不得重复提交原请求。
- Structured Question / Approval 操作后原任务可继续执行。
- Stop 使用真实服务端停止链路，不仅改变本地 UI。
- Android 能完整查看任务最终 Result / Workspace。

---

## 6. M4.3 — Android 通知

### 目标

让用户无需持续打开 Jarvis，也能知道“Jarvis 做完了什么”和“什么时候需要我处理”。

### 通知类型

第一阶段仅实现与 Jarvis 产品闭环直接相关的通知：

1. **任务通知**
   - 任务完成；
   - 任务失败；
   - 任务等待确认/回答。

2. **结果通知**
   - Result / Workspace 已生成；
   - 用户此前发起的长任务已有可查看结果。

3. **重要状态通知**
   - Jarvis 已连接应用或私人云服务发生真正需要用户关注的异常；
   - 不把普通监控指标变化变成噪声通知。

### 要求

- 通知持久对象必须在服务端有稳定 ID。
- 通知中不得暴露密钥、原始工具参数或敏感调试信息。
- 点击通知必须通过 Deep Link 回到准确上下文。
- 系统通知不是唯一事实源；App 重新打开后仍能看到相同通知状态。

---

## 7. M4.4 — Deep Link

### 目标

建立 Android 中统一、可恢复、可鉴权的对象级跳转能力。

第一阶段支持：

```text
jarvis://home
jarvis://conversation/{id}
jarvis://task/{id}
jarvis://workspace/{id}
jarvis://space/{id}
jarvis://app/{id}
jarvis://notification/{id}
```

### 验收

- App 已运行时可正确跳转。
- 冷启动时可正确恢复目标页面。
- 未登录时先完成认证，认证后继续原目标，而不是丢失跳转。
- 对象不存在、已删除或无权限时展示明确错误/回退页。
- Deep Link 不能绕过服务端 owner / Household / permission 校验。

---

## 8. M4.5 — 通知中心

### 目标

系统通知与 App 内信息形成同一个持久化处理闭环。

通知中心至少提供：

- 全部；
- 待处理；
- 已完成；
- 系统提醒。

通知条目支持：

- 已读 / 未读；
- 查看详情；
- 跳转关联 Conversation / Task / Workspace / Space / App；
- 对允许直接处理的事项提供“立即处理”入口。

待确认事项的最终确认仍应进入正式 Approval / Question 流程，不应在通知层重新实现一套权限逻辑。

---

## 9. M4.6 — 任务中心增强

### 目标

让 Android 可以独立完成 Jarvis 任务的日常查看、处理与回看。

任务中心至少区分：

- 进行中；
- 等待确认；
- 已完成；
- 失败。

任务详情应展示：

- 标题与目标；
- 当前状态；
- 开始时间 / 最近更新时间；
- 可获得时的进度；
- Execution / Activity 摘要；
- Stop / Retry 等服务端实际支持的动作；
- 关联 Conversation；
- 最终 Result / Workspace。

App 重启后，任务列表和任务详情仍以服务端持久状态恢复。

---

## 10. M4.7 — 空间与应用体验补齐

### 空间

M4 不重新定义 Space 数据模型，重点把已有能力做成稳定移动入口：

- 空间卡片；
- 最近更新；
- 与任务、结果的关联入口；
- Deep Link 直达空间；
- 适合 Android 的内容列表与详情。

### 应用

应用页继续承担私人云服务入口，而不是 Android 通用 Launcher：

- 展示已注册/已连接应用；
- 展示基本可用状态；
- 打开原应用；
- “询问 Jarvis 关于这个应用”；
- 在能力已声明时展示 Jarvis 可使用的相关能力。

---

## 11. 明确非目标

M4 **不包含**以下产品方向：

- 新增 Frigate 相关功能或把 Frigate 作为家庭场景主线；
- 拍照后通用 AI 识别；
- 相册/图片的通用手机助手入口；
- 通用文件“分享给 Jarvis 然后什么都能问”；
- 替代 Android 系统助手；
- 大型 Watch / Trigger / Automation 平台；
- Agent Runtime 大重构；
- Server / Protocol 重新设计；
- 为拆分而拆分 `M2Repository`；
- 大规模目录整理、代码清理、微性能优化。

若某项工程修改是实现 M4 功能的必要前提，可以最小化实施，但不得反客为主。

---

## 12. 验收标准

| ID | 验收项 |
| --- | --- |
| M4-AC-01 | Android 首页按照“今日重点 / Jarvis 正在工作 / 快捷入口 / 我的空间”形成真实数据闭环 |
| M4-AC-02 | CPU、内存、GPU、Agent、LLM Usage 不再占据首页核心信息区，仍可从二级管理页访问 |
| M4-AC-03 | Android Conversation 支持真实 Reasoning 和有序 Execution Stream |
| M4-AC-04 | Android 支持 Skills 与推理强度选择，并进入真实 Hermes Run |
| M4-AC-05 | Android 支持 Stop、Structured Question 与 Approval |
| M4-AC-06 | UI Protocol V2 结果可在 Android 原生展示，复杂结果可进入 Workspace |
| M4-AC-07 | Android 断线、切后台和重新进入后从服务端恢复，不重复提交已受理任务 |
| M4-AC-08 | 长任务完成时 Android 能收到任务完成通知 |
| M4-AC-09 | 任务等待确认/回答时 Android 能收到可定位到原任务的通知 |
| M4-AC-10 | 通知点击可通过 Deep Link 直接打开对应对象 |
| M4-AC-11 | Deep Link 在前台、冷启动、未登录再登录三种情况下均可正确恢复 |
| M4-AC-12 | 通知中心与系统通知共享同一持久状态，支持未读及待处理状态 |
| M4-AC-13 | 任务中心完整覆盖进行中、等待确认、完成、失败及结果回看 |
| M4-AC-14 | Space 可由首页和 Deep Link 进入，并展示真实内容/最近更新 |
| M4-AC-15 | Applications 可稳定展示集成状态、打开应用并“询问 Jarvis 关于这个应用” |
| M4-AC-16 | M4 Android 的正常运行不依赖 Frigate |
| M4-AC-17 | M4 不新增面向通用手机 AI 助手的相机/图片/文件主入口 |
| M4-AC-18 | Android 版本随 M4 正式交付更新，不继续停留在旧的 0.3.1 产品标识 |
| M4-AC-19 | 至少完成一次真实 Android Daily Driver 端到端实机验收 |

---

## 13. 推荐实施顺序

```text
M4.1 首页产品化
        ↓
M4.2 Android Conversation 完整化
        ↓
M4.3 通知 ───── M4.4 Deep Link
        ↓
M4.5 通知中心
        ↓
M4.6 任务中心
        ↓
M4.7 空间 / 应用
        ↓
真实 Android Daily Driver 验收
```

通知与 Deep Link 应作为同一阶段开发，避免先产生“点开只能回首页”的半成品通知体验。

## 14. Done Definition

M4 只有在下面的真实移动端流程能够成立时才算完成：

1. 用户打开 Android，首页直接看到当天需要关注的事项和 Jarvis 正在执行的工作，而不是先看到服务器资源指标。
2. 用户从 Android 启动一个真实 Jarvis 长任务，随后退出或切到其他 App；任务继续在服务端执行。
3. 任务完成后 Android 收到系统通知，点击通知直接进入对应 Result / Workspace。
4. 若任务需要用户确认，通知能够直接进入对应 Approval / Question；确认后原任务继续，而不是创建一个新任务。
5. Android 被杀进程或网络短暂中断后重新打开，原 Conversation / Task 从服务端恢复，不产生重复执行。
6. 用户可从首页进入通知、任务、空间、应用，并能从这些对象继续回到相关 Jarvis 会话或结果。
7. 上述核心流程不依赖 Frigate，也不要求实现通用相机/图片/文件 AI 助手能力。

M4 的最终判断标准不是“Android 功能数量变多”，而是：

> **Jarvis Android 已经足以成为用户每天打开私人云时的默认入口。**
