# 自建 Whisper 与无 GMS 设备语音识别

Android 的 `SpeechRecognizer` 依赖系统提供的 `RecognitionService`。TTS 与 ASR 是两套独立服务：华为 Mate X5、荣耀等没有 GMS 的设备通常能正常 TTS，但第三方 App 调用系统识别时会得到“语音识别不可用”。

Jarvis 从 v0.4.2 起提供自建 Whisper 兜底：

1. 手机端检测到系统识别不可用时显示“云端识别”卡片；
2. 手机录 16 kHz 单声道 WAV，最长 30 秒；
3. 音频以 base64 JSON 上传到 `POST /api/v2/speech/transcribe`；
4. Jarvis 服务端通过私有 Docker 网络转发给 Speaches（faster-whisper）；
5. 转写文字作为当前语音会话的一轮发送，回复仍由手机 TTS 播报。

音频不会发送给第三方 ASR，Whisper 端口也不暴露到公网。完整部署步骤、GPU/CPU 选型、模型下载和排障见：

- [deploy/whisper/README.md](../../deploy/whisper/README.md)

## 服务端接口

两个接口都使用现有的 Jarvis Bearer 登录态：

```http
GET /api/v2/speech/status
```

```json
{
  "configured": true,
  "provider": "whisper",
  "model": "Systran/faster-whisper-large-v3",
  "language": "zh",
  "max_audio_bytes": 8388608
}
```

```http
POST /api/v2/speech/transcribe
Content-Type: application/json

{
  "audio_base64": "...",
  "mime_type": "audio/wav",
  "language": "zh"
}
```

```json
{ "text": "你好，我是贾维斯。" }
```

未配置时 `status.configured` 为 `false`，`transcribe` 返回 `503 speech_not_configured`；音频太短/太大分别返回 `audio_too_short` / `audio_too_large`。

## 环境变量

```env
SPEECH_BASE_URL=http://jarvis-whisper:8000/v1
SPEECH_API_KEY=<shared secret>
SPEECH_STT_MODEL=Systran/faster-whisper-large-v3
SPEECH_STT_LANGUAGE=zh
SPEECH_TIMEOUT_MS=120000
SPEECH_MAX_AUDIO_BYTES=8388608
```

`SPEECH_BASE_URL` 指向 OpenAI 兼容根路径，Jarvis 会调用 `/audio/transcriptions`。

## Android 行为

- 系统识别可用：沿用原来的流式识别，不显示云端入口。
- 系统识别不可用：显示“云端识别 / 自建 Whisper”卡片；服务端未配置时提示并保留键盘输入。
- 识别过程中遇到语言包不支持、服务端断开等错误，重试后仍失败时自动切换到云端模式。
- 录音上限 30 秒；点“开始云端录音”，说完再点“停止并识别”。
- 麦克风权限被拒绝时，云端录音同样不可用；需要在系统设置中授权。

## 隐私边界

- Whisper 只接收手机上传的音频，不接收通讯录、通知或其他数据。
- Jarvis 服务端不持久化音频，只保留转写文字进入当前会话。
- Whisper 的 `SPEECH_API_KEY` 只用于服务端之间认证，不下发到 Android。
- 不要把 Whisper 的 8000 端口映射到公网；需要跨主机时使用 Tailscale 或带认证的反向代理。
