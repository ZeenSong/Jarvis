import { randomUUID } from "node:crypto";
import { hashPassword } from "../apps/server/src/identity.js";
import { buildApp } from "../apps/server/src/app.js";
import { createPairingCode } from "../apps/server/src/auth.js";
import { controlledRegistry, seedControlRuns } from "./controlled-runtime.js";
import { createServer } from "node:http";

const hermesStub = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "healthy" }));
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
    const text = JSON.parse(body).messages?.at(-1)?.content ?? "";
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
const login = {username: `web-${randomUUID()}`, password: "isolated-browser-regression-2026"};
const userId = randomUUID();
await ctx.db.query("INSERT INTO users(id,username,role) VALUES($1,$2,'member')", [userId,login.username]);
await ctx.db.query("INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)", [userId,await hashPassword(login.password)]);
// Explicitly bind only the first paired test device to the seeded task owner.
// Other devices remain isolated; production pairing does not inherit ownership.
let firstPair = true;
ctx.app.addHook("onSend", async (request, reply, payload) => {
  if (request.url === "/api/v1/pair" && reply.statusCode === 200 && firstPair) {
    firstPair = false;
    const device = (request.body as any).device_id;
    await ctx.db.query("UPDATE agent_runs SET requested_by=$1 WHERE requested_by=$2", [device, runs.owner]);
  }
  return payload;
});
await ctx.app.listen({ host: "127.0.0.1", port: 0 });
process.send?.({
  base: `http://127.0.0.1:${(ctx.app.server.address() as any).port}`,
  codes: [await createPairingCode(ctx.db), await createPairingCode(ctx.db)],
  runs, login,
});
process.on("message", () => void ctx.app.close().then(() => process.exit(0)));
process.on("SIGTERM", () => void ctx.app.close().then(() => hermesStub.close(() => process.exit(0))));
