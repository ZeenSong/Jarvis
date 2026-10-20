import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DshRuntime } from "../packages/agent-runtime-dsh/src/index.js";

test("DshRuntime maps headless NDJSON into Jarvis agent events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-runtime-"));
  const bin = join(dir, "fake-dsh");
  await writeFile(bin, `#!/usr/bin/env node
const lines = [
  { type: "session", sessionId: "session-test" },
  { type: "status", phase: "step_start", turn: 1, step: 1 },
  { type: "thinking", text: "inspect" },
  { type: "tool_call", callId: "call-1", tool: "bash", input: { command: "pwd" } },
  { type: "tool_result", callId: "call-1", status: "completed", result: "/workspace" },
  { type: "status", phase: "step_end", usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 1 } },
  { type: "text", text: "done" },
  { type: "status", phase: "turn_end", reason: { kind: "completed" } },
  { type: "final", text: "done" }
];
for (const line of lines) console.log(JSON.stringify(line));
`);
  await chmod(bin, 0o755);
  const runtime = new DshRuntime({ bin, profile: "headless", workspace: dir });
  assert.deepEqual(await runtime.health(), { healthy: true });
  const started = await runtime.start({ id: "run-test", goal: "test" });
  const events: any[] = [];
  for await (const event of runtime.events(started.id)) {
    events.push(event);
    if (event.type === "agent.run.completed") break;
  }
  assert.ok(events.some((event) => event.type === "agent.run.started"));
  assert.ok(events.some((event) => event.type === "agent.thinking" && event.payload.text === "inspect"));
  assert.ok(events.some((event) => event.type === "agent.tool.started" && event.payload.name === "bash"));
  assert.ok(events.some((event) => event.type === "agent.tool.completed" && event.payload.name === "bash"));
  assert.ok(events.some((event) => event.type === "agent.message.delta" && event.payload.text === "done"));
  assert.ok(events.some((event) => event.type === "agent.usage.updated" && event.payload.input_tokens === 10));
  assert.ok(events.some((event) => event.type === "agent.run.completed" && event.payload.summary === "done"));
  await runtime.dispose(started.id);
});
