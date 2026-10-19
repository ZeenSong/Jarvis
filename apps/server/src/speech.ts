/**
 * Self-hosted speech-to-text proxy.
 *
 * Jarvis does not send audio to a third-party ASR key by default. The server
 * talks to a local Whisper-compatible HTTP service (Speaches / faster-whisper)
 * over the private Docker network, while Android only sees the authenticated
 * Jarvis endpoint.
 */
export interface SpeechConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  language: string;
  timeoutMs: number;
  maxAudioBytes: number;
}

export class SpeechError extends Error {
  constructor(
    readonly code: string,
    readonly status = 502,
  ) {
    super(code);
  }
}

const MIN_AUDIO_BYTES = 512;
const DEFAULT_MAX_AUDIO_BYTES = 8 * 1024 * 1024;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function speechConfig(env: NodeJS.ProcessEnv = process.env): SpeechConfig | null {
  const raw = env.SPEECH_BASE_URL?.trim();
  if (!raw) return null;
  let baseUrl: string;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    baseUrl = raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
  const timeout = Number(env.SPEECH_TIMEOUT_MS ?? 60_000);
  const maxAudio = Number(env.SPEECH_MAX_AUDIO_BYTES ?? DEFAULT_MAX_AUDIO_BYTES);
  return {
    baseUrl,
    apiKey: env.SPEECH_API_KEY?.trim() || undefined,
    model: env.SPEECH_STT_MODEL?.trim() || "Systran/faster-whisper-large-v3",
    language: env.SPEECH_STT_LANGUAGE?.trim() || "zh",
    timeoutMs: Number.isFinite(timeout) ? clamp(timeout, 5_000, 180_000) : 60_000,
    maxAudioBytes: Number.isFinite(maxAudio) ? clamp(maxAudio, MIN_AUDIO_BYTES, 12 * 1024 * 1024) : DEFAULT_MAX_AUDIO_BYTES,
  };
}

function extensionFor(mimeType: string) {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim();
  switch (normalized) {
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
      return "speech.m4a";
    case "audio/mpeg":
    case "audio/mp3":
      return "speech.mp3";
    case "audio/ogg":
    case "audio/opus":
      return "speech.ogg";
    case "audio/webm":
      return "speech.webm";
    case "audio/flac":
    case "audio/x-flac":
      return "speech.flac";
    default:
      return "speech.wav";
  }
}

/**
 * Forward one audio clip to the OpenAI-compatible transcription endpoint.
 * The response shape is `{ text }` for Speaches/faster-whisper and most
 * OpenAI-compatible servers; plain-text responses are accepted as well.
 */
export async function transcribeSpeech(
  config: SpeechConfig,
  audio: Buffer,
  mimeType = "audio/wav",
  language?: string,
): Promise<string> {
  if (audio.length < MIN_AUDIO_BYTES) throw new SpeechError("audio_too_short", 400);
  if (audio.length > config.maxAudioBytes) throw new SpeechError("audio_too_large", 413);
  const normalizedMime = mimeType.split(";")[0]?.trim().toLowerCase() || "audio/wav";
  if (!normalizedMime.startsWith("audio/")) throw new SpeechError("invalid_audio_type", 415);

  const form = new FormData();
  const audioPart = new Uint8Array(audio.length);
  audioPart.set(audio);
  form.append("file", new Blob([audioPart], { type: normalizedMime }), extensionFor(normalizedMime));
  form.append("model", config.model);
  if (language || config.language) form.append("language", language || config.language);
  form.append("response_format", "json");
  // faster-whisper otherwise hallucinates subtitle credits on silence/noise.
  // This is supported by Speaches and is harmless for OpenAI-compatible
  // servers that ignore unknown multipart fields.
  form.append("vad_filter", "true");

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
      body: form,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new SpeechError("speech_timeout", 504);
    throw new SpeechError("speech_unreachable", 502);
  }
  if (!response.ok) {
    // Do not surface the upstream body: it may contain the provider URL or
    // model paths. The status code is enough for the client and logs.
    throw new SpeechError(`speech_upstream_${response.status}`, response.status === 401 || response.status === 403 ? 502 : 502);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const value = (await response.json()) as { text?: unknown };
    return typeof value.text === "string" ? value.text.trim() : "";
  }
  return (await response.text()).trim();
}
