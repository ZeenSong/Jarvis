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
const ctx = await buildApp({
  databaseUrl: process.env.TEST_DATABASE_URL!,
  runtimes: controlledRegistry(),
});
await ctx.app.listen({ host: "127.0.0.1", port: 0 });
process.send?.({
  base: `http://127.0.0.1:${(ctx.app.server.address() as any).port}`,
  codes: [await createPairingCode(ctx.db), await createPairingCode(ctx.db)],
  runs: await seedControlRuns(ctx),
});
process.on("message", () => void ctx.app.close().then(() => process.exit(0)));
process.on("SIGTERM", () => void ctx.app.close().then(() => hermesStub.close(() => process.exit(0))));
