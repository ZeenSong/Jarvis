# M4 交付记录

> 日期：2026-10-02
> 状态：Release Candidate（功能与构建验证完成，等待真实 Android 设备验收）

## 已交付

- Daily Driver 首页：今日重点、运行任务、快捷入口、空间；系统指标移至二级页。
- Android Conversation：服务端历史恢复、Reasoning / Execution Stream、Skills、推理强度、Stop、Question、Approval、Result / Workspace。
- 持久通知：任务完成、失败、等待输入、Conversation Question 与 Approval；系统通知与通知中心读取同一服务端记录。
- Deep Link：`home`、`conversation`、`task`、`workspace`、`space`、`app`、`notification`，并在登录和连接完成后恢复待跳转目标。
- 任务中心、Space 详情与 Applications 入口形成移动端导航闭环。
- Android 版本升级为 `0.4.0`（versionCode 5）。

## 自动验证

- TypeScript 类型检查通过。
- Node 测试：94 项，81 通过，13 项因未配置外部数据库按条件跳过，0 失败。
- Android `compileDebugKotlin`、`lintDebug`、`assembleDebug` 通过。
- 使用仓库 `.local` 中已有的 Android SDK / JDK 17 与 `jarvis-m1` 模拟器完成 Conversation 视觉与交互验收：新会话、消息发送、流式处理中止态、Execution Stream、完成态自动跟随与连续追问均通过；布局已与 Web Conversation 对照。
- Debug APK：`apps/android/app/build/outputs/apk/debug/app-debug.apk`。

## 发布门禁

M4-AC-19 要求真实 Android Daily Driver 端到端实机验收。本次构建环境没有连接 Android 设备，因此不能把自动构建冒充为实机证据。发布前需在连接到真实 Jarvis 服务的 Android 设备上走通：启动长任务 → App 退后台 → 收到通知 → Deep Link 打开 Result / Workspace，以及 Question / Approval 后原任务继续。
