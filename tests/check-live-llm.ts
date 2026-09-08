import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import assert from "node:assert/strict";
import { database } from "../apps/server/src/persistence.js";
import { createPairingCode, pair } from "../apps/server/src/auth.js";
import { LlmClient } from "../packages/llm-usage/src/index.js";
// Explicit opt-in command, not part of npm test. Sends only the constant prompt below.
const db = database(process.env.TEST_DATABASE_URL!);
const base = process.env.JARVIS_URL ?? "http://127.0.0.1:18080";
const provider = process.env.LLM_PROVIDER ?? "deepseek";
const model = process.env.LLM_MODEL ?? "deepseek-v4-flash";
const key = (await readFile(process.env.LLM_API_KEY_FILE!, "utf8")).trim();
let socket: WebSocket | undefined;
try {
  const auth = await pair(
    db,
    randomUUID(),
    await createPairingCode(db, "agent"),
  );
  const agentId = "live-llm-" + randomUUID();
  socket = new WebSocket(base.replace(/^http/, "ws") + "/ws", {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  await once(socket, "open");
  const ws = socket;
  function rpc(topic: string, payload: unknown): Promise<any> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off("message", receive);
        reject(new Error("gateway_timeout"));
      }, 10000);
      function receive(raw: any) {
        const m = JSON.parse(raw.toString());
        if (m.reply_to !== id) return;
        clearTimeout(timer);
        ws.off("message", receive);
        if (m.type === "error") reject(new Error(m.payload.error));
        else resolve(m.payload);
      }
      ws.on("message", receive);
      ws.send(JSON.stringify({ id, type: "request", topic, payload }));
    });
  }
  await rpc("agent.register", {
    agent_id: agentId,
    name: "DeepSeek Live Verification",
    runtime: "typescript",
  });
  await rpc("agent.task.started", {
    agent_id: agentId,
    status: "running",
    provider,
    model,
    task_id: "M1 real provider verification",
  });
  let recordedId = "";
  const client = new LlmClient(
    {
      baseUrl: process.env.LLM_BASE_URL ?? "https://api.deepseek.com",
      apiKey: key,
      provider,
      agentId,
      maxTokens: 32,
      timeoutMs: 30000,
    },
    async (usage) => {
      recordedId = usage.id;
      await rpc("llm.request.completed", usage);
    },
  );
  await client.complete(model, [{ role: "user", content: "Reply only: OK" }]);
  await rpc("agent.task.finished", { agent_id: agentId, status: "idle" });
  const summary = await rpc("llm.usage.summary", {
    range: "today",
    agent_id: agentId,
  });
  assert.equal(summary.total.requests, 1);
  assert.equal(summary.total.errors, 0);
  assert.ok(summary.total.input_tokens > 0);
  assert.ok(summary.total.output_tokens > 0);
  assert.ok(summary.total.estimated_cost_usd > 0);
  console.log(
    JSON.stringify({
      request_id: recordedId,
      provider,
      model,
      total: summary.total,
    }),
  );
} finally {
  socket?.terminate();
  await db.end();
}
