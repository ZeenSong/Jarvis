import { randomUUID } from "node:crypto";
import { hashPassword } from "../apps/server/src/identity.js";
import { buildApp } from "../apps/server/src/app.js";
import { controlledRegistry, seedControlRuns } from "./controlled-runtime.js";
import { createServer } from "node:http";

const hermesRuns = new Map<string, { answer: string; status: string }>();
const hermesStub = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "healthy" }));
    return;
  }
  if (req.method === "POST" && req.url === "/v1/runs") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const input = JSON.parse(body).input ?? "";
      const runId = `hermes-test-${hermesRuns.size + 1}`;
      const answer = String(input).includes("CPU")
        ? "当前 CPU 使用率为 0%，这是测试环境的 Hermes 流式回复。"
        : "测试环境的 Hermes 流式回复已完成。";
      hermesRuns.set(runId, { answer, status: "queued" });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ run_id: runId, status: "queued" }));
    });
    return;
  }
  const eventMatch = req.method === "GET" && req.url?.match(/^\/v1\/runs\/([^/]+)\/events$/);
  if (eventMatch) {
    const run = hermesRuns.get(decodeURIComponent(eventMatch[1]));
    if (!run) { res.writeHead(404); res.end(); return; }
    run.status = "completed";
    res.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive", "cache-control": "no-cache" });
    res.write(`data: ${JSON.stringify({ event: "message.delta", delta: run.answer })}\n\n`);
    res.write(`data: ${JSON.stringify({ event: "run.completed", status: "completed", output: run.answer })}\n\n`);
    res.end();
    return;
  }
  const statusMatch = req.method === "GET" && req.url?.match(/^\/v1\/runs\/([^/]+)$/);
  if (statusMatch) {
    const run = hermesRuns.get(decodeURIComponent(statusMatch[1]));
    if (!run) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ run_id: statusMatch[1], status: run.status, output: run.status === "completed" ? run.answer : undefined }));
    return;
  }
  if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const request = JSON.parse(body);
    const text = request.messages?.at(-1)?.content ?? "";
    if (request.stream === false) {
      const title = String(text).includes("CPU") ? "CPU 使用率查询" : "家庭助手对话";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: title } }] }));
      return;
    }
    const answer = String(text).includes("CPU")
      ? "当前 CPU 使用率为 0%，这是测试环境的 Hermes 流式回复。"
      : "测试环境的 Hermes 流式回复已完成。";
    res.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "keep-alive",
      "cache-control": "no-cache",
    });
    for (const delta of [answer.slice(0, 12), answer.slice(12)])
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise<void>((resolve) => hermesStub.listen(0, "127.0.0.1", resolve));
const hermesPort = (hermesStub.address() as any).port;
process.env.HERMES_ENABLED = "1";
process.env.HERMES_URL = `http://127.0.0.1:${hermesPort}`;
process.env.HERMES_API_KEY = "web-test-hermes";
process.env.HERMES_BRIDGE_KEY = "web-test-hermes-bridge-key";
process.env.IMMICH_URL = "http://127.0.0.1:2283";
process.env.HOME_ASSISTANT_URL = "http://127.0.0.1:8123";
const ctx = await buildApp({
  databaseUrl: process.env.TEST_DATABASE_URL!,
  runtimes: controlledRegistry(),
});
const runs = await seedControlRuns(ctx);
const logins = [0, 1].map(() => ({username: `web-${randomUUID()}`, password: "isolated-browser-regression-2026"}));
for (const login of logins) {
  const userId = randomUUID();
  await ctx.db.query("INSERT INTO users(id,username,role) VALUES($1,$2,'member')", [userId,login.username]);
  await ctx.db.query("INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)", [userId,await hashPassword(login.password)]);
}
// Bind the first browser account to the seeded task owner so the task
// regression exercises the same owner-scoped identity as the current UI.
let boundRuns = false;
ctx.app.addHook("onSend", async (request, reply, payload) => {
  if (request.url === "/api/v2/auth/login" && reply.statusCode === 200 && !boundRuns && (request.body as any)?.username === logins[0].username) {
    boundRuns = true;
    const device = (request.body as any).device_id;
    await ctx.db.query("UPDATE agent_runs SET requested_by=$1 WHERE requested_by=$2", [device, runs.owner]);
  }
  return payload;
});
await ctx.app.listen({ host: "127.0.0.1", port: 0 });
process.send?.({
  base: `http://127.0.0.1:${(ctx.app.server.address() as any).port}`,
  runs, login: logins[0], otherLogin: logins[1], logins,
});
process.on("message", () => void ctx.app.close().then(() => process.exit(0)));
process.on("SIGTERM", () => void ctx.app.close().then(() => hermesStub.close(() => process.exit(0))));
