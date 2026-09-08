import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { LlmClient } from "../packages/llm-usage/src/index.js";
const provider = process.env.LLM_PROVIDER ?? "openai";
const apiKey =
  process.env.LLM_API_KEY ??
  (process.env.LLM_API_KEY_FILE
    ? (await readFile(process.env.LLM_API_KEY_FILE, "utf8")).trim()
    : "");
const base = process.env.JARVIS_URL ?? "http://127.0.0.1:8080",
  token = process.env.JARVIS_AGENT_TOKEN;
if (!token)
  throw new Error("Set JARVIS_AGENT_TOKEN from an agent pairing code");
let current = "idle",
  stopped = false,
  ws: WebSocket,
  heartbeat: NodeJS.Timeout | undefined;
const agentId = "test-agent";
const send = (topic: string, payload: unknown) =>
  ws.send(
    JSON.stringify({ id: randomUUID(), type: "request", topic, payload }),
  );
const beat = () =>
  send("agent.heartbeat", {
    agent_id: agentId,
    status: current,
    provider: apiKey ? provider : null,
    model: process.env.LLM_MODEL ?? null,
  });
function connect() {
  ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", {
    headers: { Authorization: `Bearer ${token}` },
  });
  ws.on("open", () => {
    send("agent.register", {
      agent_id: agentId,
      name: "Test Agent",
      runtime: "typescript",
      version: "0.1.0",
      capabilities: ["system.analyze"],
    });
    heartbeat = setInterval(beat, 10000);
  });
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "error") console.error(m.payload);
  });
  ws.on("error", () => {});
  ws.on("close", () => {
    clearInterval(heartbeat);
    if (!stopped) setTimeout(connect, 3000);
  });
}
connect();
const llm = new LlmClient(
  {
    baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
    apiKey,
    provider,
    agentId,
  },
  async (usage) => {
    const response = await fetch(base + "/api/v1/llm/requests", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(usage),
    });
    if (!response.ok) throw new Error(`usage_report_${response.status}`);
  },
);
console.log(
  "Agent connecting. Press Enter to call configured LLM; Ctrl+C to stop heartbeats.",
);
process.stdin.on("data", async () => {
  if (current === "running" || ws.readyState !== 1) return;
  if (!apiKey || !process.env.LLM_MODEL) {
    console.error("Set LLM_API_KEY and LLM_MODEL to call a provider");
    return;
  }
  current = "running";
  send("agent.task.started", {
    agent_id: agentId,
    status: current,
    task_id: randomUUID(),
    provider,
    model: process.env.LLM_MODEL,
  });
  try {
    await llm.complete(process.env.LLM_MODEL, [
      {
        role: "user",
        content: "Reply with one short sentence confirming you are available.",
      },
    ]);
    current = "idle";
    send("agent.task.finished", { agent_id: agentId, status: current });
  } catch (e) {
    current = "error";
    send("agent.error", { agent_id: agentId, status: current });
    console.error(e);
  }
});
process.on("SIGINT", () => {
  stopped = true;
  clearInterval(heartbeat);
  ws.close();
  process.exit(0);
});
