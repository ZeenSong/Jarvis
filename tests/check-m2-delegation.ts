// Opt-in, billable integration: real Core + real containerized domain workers.
// This Docker harness is test-only; production always uses the Kubernetes controller.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { buildApp } from "../apps/server/src/app.js";
import { pair, createPairingCode } from "../apps/server/src/auth.js";
import { RuntimeRegistry } from "../packages/agent-runtime/src/index.js";
import { ControllerRuntime } from "../packages/agent-runtime-remote/src/index.js";
import { buildOpsGateway } from "../apps/worker-controller/src/ops-gateway.js";

if (
  process.env.M2_LIVE_ACCEPTANCE !== "1" ||
  !process.env.TEST_DATABASE_URL ||
  !process.env.LLM_API_KEY_FILE
)
  throw Error(
    "Requires M2_LIVE_ACCEPTANCE=1, TEST_DATABASE_URL and LLM_API_KEY_FILE",
  );
if (process.env.CODING_MODEL !== "gpt-5.6-luna")
  throw Error("Acceptance requires cheapest verified model gpt-5.6-luna");
for (const key of [
  "CORE_MODEL",
  "OPS_MODEL",
  "CODING_REPOSITORY",
  "CODING_COMMIT",
])
  if (!process.env[key]) throw Error(key + " required");
process.env.DEEPSEEK_API_KEY = (
  await readFile(process.env.LLM_API_KEY_FILE, "utf8")
).trim();
process.env.OPS_TOKEN = randomBytes(32).toString("hex");
const docker = async (args: string[]) =>
  (
    await promisify(execFile)("docker", args, {
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout.trim();
const network = process.env.WORKER_TEST_NETWORK ?? "jarvis-m2-worker-test";
const networkInfo = JSON.parse(
  await docker(["network", "inspect", network]),
)[0];
assert.equal(
  networkInfo.Internal,
  true,
  "Worker test network must be internal",
);
const gateway = networkInfo.IPAM.Config[0].Gateway;
const prefix = "m2-delegate-" + randomUUID().slice(0, 8);
const controllerToken = randomBytes(32).toString("hex");
const workers = new Map<
  string,
  { name: string; ip: string; token: string; volume: string; type: string }
>();
const temp = await mkdtemp(join(tmpdir(), "jarvis-m2-live-"));
const evidence = process.env.M2_EVIDENCE_DIR ?? ".local/evidence";
await mkdir(evidence, { recursive: true });
const controller = Fastify();
controller.addHook("onRequest", async (req, reply) => {
  if (req.headers.authorization !== "Bearer " + controllerToken)
    return reply.code(401).send({ error: "unauthorized" });
});
controller.get("/health", async () => ({ healthy: true }));
controller.post("/runs", async (req) => {
  const p = req.body as any;
  assert.match(p.id, /^[a-f0-9-]{36}$/);
  assert.ok(["codex", "pydantic"].includes(p.type));
  if (workers.has(p.id)) return { id: p.id };
  if (p.type === "codex") assert.equal(p.model, "gpt-5.6-luna");
  const name = prefix + "-" + p.id,
    volume = name,
    token = randomBytes(32).toString("hex");
  await docker(["volume", "create", volume]);
  await docker([
    "run",
    "--rm",
    "--user",
    "0:0",
    "--network",
    "none",
    "--mount",
    `type=volume,src=${volume},dst=/workspace`,
    "--entrypoint",
    "chown",
    "jarvis-codex-worker:0.2.0-rc.1",
    "1000:1000",
    "/workspace",
  ]);
  const env: Record<string, string> = {
    RUN_INPUT: JSON.stringify(p),
    WORKER_TOKEN: token,
    WORKER_TIMEOUT_MS: "180000",
    JARVIS_WORKER_SANDBOX: "container-test",
    CODEX_AUTH_WRITEBACK: "1",
    HTTP_PROXY: "http://jarvis-m2-egress:3128",
    HTTPS_PROXY: "http://jarvis-m2-egress:3128",
    http_proxy: "http://jarvis-m2-egress:3128",
    https_proxy: "http://jarvis-m2-egress:3128",
    NO_PROXY: gateway,
    no_proxy: gateway,
  };
  if (p.type === "pydantic")
    Object.assign(env, {
      OPS_MODEL: process.env.OPS_MODEL,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      OPS_TOKEN: process.env.OPS_TOKEN,
      OPS_GATEWAY: `http://${gateway}:18084`,
    });
  const envPath = join(temp, p.id);
  await writeFile(
    envPath,
    Object.entries(env)
      .map(([k, v]) => k + "=" + v)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  try {
    await docker([
      "run",
      "-d",
      "--name",
      name,
      "--network",
      network,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--memory",
      "2g",
      "--cpus",
      "2",
      "--pids-limit",
      "256",
      "--tmpfs",
      "/tmp:rw,uid=1000,gid=1000",
      "--mount",
      `type=volume,src=${volume},dst=/workspace`,
      ...(p.type === "codex"
        ? ["--mount", "type=volume,src=jarvis-m2-auth-test,dst=/credentials"]
        : []),
      "--env-file",
      envPath,
      p.type === "codex"
        ? "jarvis-codex-worker:0.2.0-rc.1"
        : "jarvis-ops-worker:0.2.0-rc.1",
    ]);
  } finally {
    await rm(envPath, { force: true });
  }
  const ip = JSON.parse(
    await docker([
      "inspect",
      "--format",
      "{{json .NetworkSettings.Networks}}",
      name,
    ]),
  )[network].IPAddress;
  workers.set(p.id, { name, ip, token, volume, type: p.type });
  return { id: p.id };
});
controller.route({
  method: ["GET", "POST"],
  url: "/runs/:id/:operation",
  handler: async (req, reply) => {
    const { id, operation } = req.params as any;
    const w = workers.get(id);
    if (!w) return reply.code(404).send({ error: "not_found" });
    assert.ok(
      ["events", "send", "resume", "cancel", "dispose"].includes(operation),
    );
    const cursor = (req.query as any).cursor ?? "0";
    try {
      const response = await fetch(
        `http://${w.ip}:8091/${operation}${operation === "events" ? "?cursor=" + encodeURIComponent(cursor) : ""}`,
        {
          method: req.method,
          headers: {
            authorization: "Bearer " + w.token,
            "content-type": "application/json",
          },
          ...(req.method === "POST"
            ? { body: JSON.stringify(req.body ?? {}) }
            : {}),
          signal: AbortSignal.timeout(20000),
        },
      );
      const result = await response.json();
      if (operation === "dispose" && response.ok) {
        await writeFile(
          join(evidence, `${prefix}-${w.type}-events.ndjson`),
          (await docker(["logs", w.name])) + "\n",
        );
      }
      return reply.code(response.status).send(result);
    } catch (e) {
      if (operation === "events" && cursor === "0")
        return { events: [], done: false };
      throw e;
    }
  },
});
const address = await controller.listen({ host: "127.0.0.1", port: 0 });
const runtimes = new RuntimeRegistry();
for (const type of ["codex", "pydantic"] as const)
  runtimes.register(
    type,
    new ControllerRuntime(type, address, controllerToken),
  );
const ctx = await buildApp({
  databaseUrl: process.env.TEST_DATABASE_URL,
  runtimes,
});
const opsGateway = buildOpsGateway(
  `http://${gateway}:18083`,
  process.env.OPS_TOKEN!,
);
try {
  await ctx.app.listen({ host: gateway, port: 18083 });
  await opsGateway.listen({ host: gateway, port: 18084 });
  const auth = await pair(
    ctx.db,
    randomUUID(),
    await createPairingCode(ctx.db),
  );
  const c: any = await ctx.m2.handle(
    "conversation.create",
    { title: "真实领域委派验收 " + prefix },
    auth.device_id,
  );
  const prompts = [
    "请委派 Ops Agent 做一次简短运行分析。必须读取当前系统、指标历史、智能体列表、LLM 用量，以及列表中一个真实 Run 的详情（没有 Run 就明确说明）。分析历史覆盖是否足够，不要杜撰趋势。只委派一次，最后用两句话汇总。",
    "请委派 Coding Agent 做一次小型隔离验证，只委派一次：读取 package.json；新增 docs/m2-worker-smoke.md，内容为「隔离 Worker 验证」；执行 node -e \"const fs=require('fs');if(!fs.readFileSync('docs/m2-worker-smoke.md','utf8').includes('隔离'))process.exit(1)\"。不要安装依赖、提交、推送、部署或读取凭据。完成后简短汇总测试和 Diff。",
  ];
  const results = [];
  for (const content of prompts.filter(
    (_, i) =>
      !process.env.M2_LIVE_ROLE ||
      process.env.M2_LIVE_ROLE === (i === 0 ? "ops" : "coding"),
  )) {
    const accepted: any = await ctx.m2.conversations.accept(auth.device_id, {
      conversation_id: c.id,
      content,
      idempotency_key: randomUUID(),
    });
    let message: any;
    for (let i = 0; i < 600; i++) {
      message = (await ctx.m2.conversations.get(c.id)).messages.find(
        (m: any) => m.id === accepted.reply_id,
      );
      if (["completed", "failed"].includes(message?.status)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(message?.status, "completed", message?.content);
    const parent = await ctx.m2.manager.get(message.run_id);
    assert.equal(parent.run.status, "completed");
    const child = parent.tree.find(
      (r: any) => r.parent_run_id === parent.run.id,
    );
    assert.ok(child, "Core must actually delegate");
    const run = await ctx.m2.manager.get(child.id);
    assert.equal(
      run.run.status,
      "completed",
      JSON.stringify(run.run.error_json ?? run.run.result_json),
    );
    assert.ok(run.usage.input_tokens > 0 && run.usage.output_tokens > 0);
    if (child.agent_id === "coding-agent") {
      assert.match(run.run.result_json.diff, /隔离 Worker 验证/);
      assert.ok(
        run.events.some(
          (e: any) =>
            e.type === "agent.tool.completed" && e.payload.exit_code === 0,
        ),
      );
    }
    results.push({
      reply: message.content,
      parent_id: parent.run.id,
      child_id: child.id,
      agent: child.agent_id,
      usage: run.usage,
      tools: run.events
        .filter((e: any) => e.type === "agent.tool.completed")
        .map((e: any) => e.payload.tool),
      artifacts: run.artifacts.map((a: any) => a.name),
    });
    console.log(JSON.stringify(results.at(-1)));
    await writeFile(
      join(evidence, `${prefix}-results.json`),
      JSON.stringify({ conversation_id: c.id, results }, null, 2) + "\n",
    );
  }
  const report = {
    status: "passed",
    environment: "isolated Docker, not Kubernetes",
    conversation_id: c.id,
    results,
  };
  await writeFile(
    join(evidence, "m2-real-delegation.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
} finally {
  await ctx.app.close();
  await opsGateway.close();
  for (const [id, w] of workers) {
    try {
      await writeFile(
        join(evidence, `${prefix}-${w.type}-events.ndjson`),
        (await docker(["logs", w.name])) + "\n",
      );
    } catch {}
    await docker(["rm", "-f", w.name]).catch(() => {});
    await docker(["volume", "rm", w.volume]).catch(() => {});
  }
  await controller.close();
  await rm(temp, { recursive: true, force: true });
}
