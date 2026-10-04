# Jarvis M4 发布记录

> 历史里程碑记录，不是当前操作手册。部署请以 [`docs/guides/deployment.md`](../../guides/deployment.md) 为准。

版本：`v0.4.0`

Android：`versionCode 5` / `versionName 0.4.0`

## 本次发布

- 将 Android 首页重构为 Daily Driver：今日重点、运行任务、快捷入口、空间与应用入口。
- Android Conversation 对齐 Web 的完整交互：历史记录、Markdown、图片、Execution Stream、Skills、推理强度、Stop、Question、Approval、Result 与 Workspace。
- 增加持久通知、通知中心、任务中心和登录后可恢复的 Deep Link 导航。
- Android 相册结果支持受认证媒体、照片详情、继续查找、收藏提示和 Immich 打开动作。
- 修复 Android 实时活动订阅与 GitHub Actions Android SDK 安装，使冷环境构建可复现。

## 验证

- GitHub Actions：Server 与 Android jobs 全部通过。
- Android：`assembleDebug testDebugUnitTest lintDebug`。
- 服务端：TypeScript 类型检查、Node 测试、构建和 Server 容器构建。
- API 35 模拟器：Conversation 图片、放大预览、执行过程、Composer 和导航视觉检查。
- 发布 APK 与 `v0.3.1` APK 使用相同 Android Debug 签名，可覆盖升级。

## 已知边界

APK 仍为 Debug 签名，不是 Play 商店生产签名包。完整真实 Android Daily Driver 通知链路尚需补充实体设备证据：长任务退后台、系统通知、Deep Link 返回 Result / Workspace，以及 Question / Approval 后继续原任务。发布内容不包含凭据、数据库、私有配置或签名密钥。
