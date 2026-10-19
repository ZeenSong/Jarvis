import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { speechConfig, transcribeSpeech, SpeechError } from "../apps/server/src/speech.js";

test("speech config is disabled without an endpoint and rejects non-http URLs", () => {
  assert.equal(speechConfig({}), null);
  assert.equal(speechConfig({ SPEECH_BASE_URL: "ftp://example.test/v1" }), null);
  assert.equal(speechConfig({ SPEECH_BASE_URL: "not a url" }), null);
});

test("speech config applies safe defaults and clamps limits", () => {
  const config = speechConfig({
    SPEECH_BASE_URL: "http://whisper:8000/v1/",
    SPEECH_API_KEY: " local-key ",
    SPEECH_TIMEOUT_MS: "999999",
    SPEECH_MAX_AUDIO_BYTES: "1",
  });
  assert.ok(config);
  assert.equal(config!.baseUrl, "http://whisper:8000/v1");
  assert.equal(config!.apiKey, "local-key");
  assert.equal(config!.model, "Systran/faster-whisper-large-v3");
  assert.equal(config!.language, "zh");
  assert.equal(config!.timeoutMs, 180_000);
  assert.equal(config!.maxAudioBytes, 512);
});

test("transcribeSpeech forwards audio and auth to an OpenAI-compatible endpoint", async () => {
  let authorization = "";
  let contentType = "";
  let body = Buffer.alloc(0);
  const server = createServer((req, res) => {
    authorization = String(req.headers.authorization ?? "");
    contentType = String(req.headers["content-type"] ?? "");
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      body = Buffer.concat(chunks);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: " 你好，Jarvis。 " }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const config = speechConfig({
    SPEECH_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    SPEECH_API_KEY: "secret",
    SPEECH_STT_MODEL: "Systran/faster-whisper-large-v3",
  });
  assert.ok(config);
  const audio = Buffer.alloc(2048, 1);
  const text = await transcribeSpeech(config!, audio, "audio/wav", "zh");
  server.close();
  assert.equal(text, "你好，Jarvis。");
  assert.equal(authorization, "Bearer secret");
  assert.match(contentType, /^multipart\/form-data; boundary=/);
  assert.equal(body.includes(audio), true);
  assert.match(body.toString("latin1"), /name="vad_filter"\r\n\r\ntrue/);
});

test("transcribeSpeech refuses tiny audio before calling upstream", async () => {
  const config = speechConfig({ SPEECH_BASE_URL: "http://127.0.0.1:9/v1" })!;
  await assert.rejects(
    () => transcribeSpeech(config, Buffer.from("tiny")),
    (error: unknown) => error instanceof SpeechError && error.code === "audio_too_short" && error.status === 400,
  );
});
