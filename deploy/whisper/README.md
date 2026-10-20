# 自建 Whisper 语音识别

华为 Mate X5 等无 GMS 设备没有向第三方 App 暴露 Android `RecognitionService`，系统语音识别会提示“语音识别不可用”。Jarvis 的 Android 语音页在检测到系统识别不可用时，会自动显示 **自建 Whisper** 录音入口：录音在手机上完成，音频只上传到你自己的 Jarvis 服务器，由服务器转发给本机 Whisper，不经过 OpenAI、讯飞等第三方。

```text
华为手机
  │  录音 WAV（16 kHz / 单声道 / 最长 30 秒）
  ▼
Jarvis 服务器 /api/v2/speech/transcribe   （Bearer 登录态）
  │  只走私有 Docker 网络，不暴露端口
  ▼
Speaches（faster-whisper large-v3，GPU）
  │
  ▼
转写文字 → 原语音对话继续
```

## 硬件建议

| 硬件 | 推荐配置 | 体验 |
| --- | --- | --- |
| NVIDIA GPU（≥6 GB 显存） | `latest-cuda` + `large-v3-turbo` + `float16` | 实测 RTX 5070：8 秒中文音频约 0.6 秒 |
| 仅 CPU，8 核以上 | `latest-cpu` + `small` 或 `medium` + `int8` | 可用，但响应更慢；不建议 `large-v3` |
| 低配/ARM | `latest-cpu` + `small` + `int8` | 适合短句 |

默认模型是 `deepdml/faster-whisper-large-v3-turbo-ct2`（约 1.6 GB）。它常驻 GPU（约 3 GB 显存），冷启动约 10–20 秒，预热后 8 秒中文音频约 0.6 秒。配置 `WHISPER__TTL=-1` 可禁止空闲卸载。

## 一键部署

在 Jarvis 仓库根目录：

```bash
./deploy/whisper/install.sh
```

脚本会：

1. 生成/复用 `api-key`（权限 600）；
2. 在 `jarvis_default` 网络上启动 `jarvis-whisper` 容器，**不发布主机端口**；
3. 首次运行时下载 `large-v3` 模型并预热；
4. 输出需要加入 Jarvis 服务端的环境变量。

默认使用 GPU。如果服务器没有 NVIDIA GPU：

```bash
WHISPER_IMAGE_TAG=latest-cpu \
WHISPER_DEVICE=cpu \
WHISPER_COMPUTE_TYPE=int8 \
WHISPER_MODEL=Systran/faster-whisper-small \
./deploy/whisper/install.sh
```

如果模型下载需要代理：

```bash
WHISPER_HTTPS_PROXY=http://172.23.0.1:7890 ./deploy/whisper/install.sh
```

`172.23.0.1` 是 Jarvis Docker 网络的网关；请按实际网络替换。

## 接入 Jarvis

把脚本输出的变量加入 Jarvis 服务端环境，然后重建/重启 `jarvis-server`：

```env
SPEECH_BASE_URL=http://jarvis-whisper:8000/v1
SPEECH_API_KEY=<与 Whisper 相同的 key>
SPEECH_STT_MODEL=deepdml/faster-whisper-large-v3-turbo-ct2
SPEECH_STT_LANGUAGE=zh
SPEECH_TIMEOUT_MS=120000
```

服务端暴露两个需要登录的接口：

- `GET /api/v2/speech/status`：返回 `configured`、模型和最大音频大小；
- `POST /api/v2/speech/transcribe`：JSON `{audio_base64, mime_type, language}`，返回 `{text}`。

音频上限默认 8 MB，单次录音最长 30 秒；base64 请求体上限 12 MB。Whisper 端口只在 Docker 网络内可达，公网只能通过 Jarvis 的登录态访问转写接口。

## 验证

```bash
docker ps --filter name=jarvis-whisper
docker logs --tail 50 jarvis-whisper
docker exec jarvis-server node -e "fetch('http://jarvis-whisper:8000/health',{headers:{Authorization:'Bearer '+process.env.SPEECH_API_KEY}}).then(r=>r.text().then(console.log))"
```

在 Android 语音页，系统识别不可用时会看到“云端识别 / 自建 Whisper”卡片。点“开始云端录音”，说完再点“停止并识别”，文字会作为当前语音会话的一轮发送，Jarvis 的回复仍然由手机 TTS 播报。

## 排障

- **Android 显示“服务端还没有配置 Whisper”**：检查 `SPEECH_BASE_URL` 是否加到了运行中的 `jarvis-server` 容器，并确认 `GET /api/v2/speech/status` 返回 `configured: true`。
- **504 / speech_timeout**：首次请求可能正在加载模型；把 `SPEECH_TIMEOUT_MS` 调大，或先跑一次预热。
- **502 / speech_unreachable**：两个容器不在同一 Docker 网络，或 Whisper 容器未启动。
- **中文识别成英文/乱码**：确认请求里 `language=zh`，并使用 `large-v3` 或 `medium` 中文模型。
- **显存不足**：换 `medium` 或 `small`，或使用 `latest-cpu` + `int8`；`large-v3` 需要约 4 GB 显存。
- **模型下载失败**：设置 `WHISPER_HTTPS_PROXY`，或手动执行：
  ```bash
  docker exec jarvis-whisper curl -X POST -H "Authorization: Bearer $SPEECH_API_KEY" \
    http://127.0.0.1:8000/v1/models/deepdml/faster-whisper-large-v3-turbo-ct2
  ```
- **端口安全**：不要给 Whisper 添加 `ports:`。如果必须跨主机调用，用 Tailscale/内网反向代理并加认证。

## 数据与隐私

- 模型缓存默认在 `/DATA/AppData/jarvis-whisper/cache`，重建容器不会重新下载。
- Whisper 只在内存中处理上传的音频；Jarvis 服务端也不会把音频写入数据库。
- 转写文字会进入当前 Jarvis 语音会话，与手动输入的文字一样受现有会话权限保护。
- Whisper 的 API Key 只用于 Jarvis ↔ Whisper 内部认证；Android 客户端不知道这个 Key，只使用自己的 Jarvis 登录令牌。
