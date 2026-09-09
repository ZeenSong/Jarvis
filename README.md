# Jarvis

个人私有云骨架：TypeScript 模块化单体 + PostgreSQL + Kotlin/Compose Android。实现目标以 [M1 方案](Jarvis_M1_常驻服务与移动监控.md) 为准；真实环境验收进度见 [验收记录](docs/m1-acceptance.md)。

M2 预发布版本 `0.2.0-rc.1` 已增加真实对话、分层 Agent、隔离 Worker 与 Web/Android 动态界面。交付与启动见 [M2 操作指导](deploy/m2/README.md)，通过项和上线前剩余检查见 [M2 验收记录](docs/m2/acceptance.md)。下方 v0.1.0 Release 仍为已验收的正式版本。

## 下载与镜像

- Android APK 与可离线导入的服务镜像：[v0.1.0 Release](https://github.com/ZeenSong/Jarvis/releases/tag/v0.1.0)
- 容器镜像：`ghcr.io/zeensong/jarvis-server:0.1.0`

当前 APK 是 M1 调试签名构建，适合自用测试；升级正式签名版本前应先卸载它，或使用相同签名密钥。

## 本地运行

需要 Node.js 22+、Docker。命令在仓库根目录执行：

```bash
npm ci
POSTGRES_PASSWORD=change-me docker compose -f deploy/compose.yaml up -d
export DATABASE_URL=postgres://jarvis:change-me@127.0.0.1:5432/jarvis
npm run build
npm start
```

默认只监听 `127.0.0.1:8080`。从 Android 访问时设置 `HOST=<服务器 Tailscale IPv4>`，并确认手机、服务器在同一 Tailnet。应用不依赖公网 IPv6。Node 不自动读取 `.env`，请由 shell 或服务管理器传入环境变量；配置项见 [.env.example](.env.example)。

创建 10 分钟有效的一次性设备配对码：

```bash
npm run pair
```

Android 首次输入 `http://100.x.x.x:8080` 和该码。生成的是 device 角色，只允许监控读取。不要在公网直接暴露明文 HTTP/WS 端口；Tailnet 内传输由 Tailscale 加密。

## 测试 Agent 与 LLM

```bash
npm run pair -- --agent
```

使用该码调用 `POST /api/v1/pair`，JSON 为 `{"device_id":"<新 UUID>","code":"<一次性码>"}`，返回 Token。将 Token 仅配置给 Agent：

```bash
export JARVIS_URL=http://127.0.0.1:8080
export JARVIS_AGENT_TOKEN='<返回的 token>'
npm run demo
```

示例每 10 秒心跳，停止后 30 秒 degraded、90 秒 offline。配置 `LLM_API_KEY`（或 `LLM_API_KEY_FILE`）、`LLM_MODEL`（可选 `LLM_BASE_URL`、`LLM_PROVIDER`）后，按 Enter 发起一次真实模型请求并自动计量。不会自动发起付费调用。兼容接口也支持 DeepSeek 的 `prompt_cache_hit_tokens`，字段依据 [DeepSeek API 文档](https://api-docs.deepseek.com/api/create-chat-completion/)。

服务端通过 `PRICES_FILE` 读取 JSON：

```json
{
  "your-provider": {
    "your-model": {
      "input_per_million": 2,
      "output_per_million": 8,
      "cached_input_per_million": 0.2,
      "valid_from": "2026-01-01"
    }
  }
}
```

数值只是格式示例，不是供应商报价。请填写实际模型价格；未配置价格时费用显示未知，历史费用不会因改价重算。统计日期以 UTC 为准。

## Android

Android Studio 打开 `apps/android`，使用 JDK 17、SDK 35。首次构建前确认 SDK 路径（`ANDROID_HOME` 或 `local.properties`）。

```bash
cd apps/android
./gradlew assembleDebug testDebugUnitTest
```

APK 输出在 `apps/android/app/build/outputs/apk/debug/app-debug.apk`。应用支持启动/前台/网络变化自动连接、指数退避和心跳超时，断线显示最近缓存。Home 可开启带常驻通知的后台连接服务；Android 系统休眠、强制停止仍可能暂停 Socket，前台恢复后会重连并刷新快照。

## 验证

```bash
npm run typecheck
npm test
TEST_DATABASE_URL=postgres://jarvis:password@127.0.0.1:5432/jarvis_test npm test
npm run build
kubectl kustomize deploy/k8s
```

不传 TEST_DATABASE_URL 时明确跳过数据库集成测试。应使用独立测试数据库，测试会写入唯一标识的设备、Agent 和请求记录。

Android 端到端测试需先启动独立测试服务、模拟器并构建 `assembleDebug assembleDebugAndroidTest`，再运行：

```bash
ADB=/path/to/adb TEST_DATABASE_URL=postgres://jarvis:password@127.0.0.1:5432/jarvis_test npm run test:android-e2e
```

默认模拟器访问 `http://10.0.2.2:18080`，可通过 `ANDROID_TEST_SERVER` 修改。此测试会清空模拟器中 Jarvis 应用数据以验证首次配对，不应在日常使用的手机执行。服务恢复检查脚本 `tests/check-android-recovery.ts` 只操作名为 `jarvis-m1-test-server` 的测试容器。`tests/check-live-llm.ts` 是显式调用的真实供应商检查，会产生少量 API 用量，不包含在 npm test 中。

部署步骤见 [部署手册](docs/deployment.md)，协议见 [API/WS](docs/protocol.md)，架构与边界见 [工程决策](docs/architecture.md)。
