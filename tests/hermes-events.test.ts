import test from "node:test";
import assert from "node:assert/strict";
import { HermesActivityIds, terminalHermesEvents } from "../packages/conversation/src/hermes-events.js";
import { HermesClient } from "../packages/hermes-bridge/src/index.js";

test("Hermes no-ID tool events correlate outstanding calls without merging completed repetitions", () => {
  const ids = new HermesActivityIds();
  const first = ids.resolve({ event: "tool.started", tool: "terminal" });
  const second = ids.resolve({ event: "tool.started", tool: "terminal" });
  assert.notEqual(first, second);
  assert.equal(ids.resolve({ event: "tool.completed", tool: "terminal" }), first);
  assert.equal(ids.resolve({ event: "tool.failed", tool: "terminal" }), second);
  assert.notEqual(ids.resolve({ event: "tool.started", tool: "terminal" }), first);
  assert.equal(ids.resolve({ event: "tool.started", tool: "terminal", tool_call_id: "upstream-id" }), "upstream-id");
  assert.equal(terminalHermesEvents.has("run.started"), false);
  assert.equal(terminalHermesEvents.has("run.completed"), true);
});

test("Hermes SSE handles split UTF-8 and CRLF, and closes the reader after terminal consumption", async () => {
  let cancelled = false;
  const bytes = new TextEncoder().encode('data: {"event":"reasoning.delta","delta":"真实"}\r\n\r\ndata: {"event":"reasoning.available","text":"真实推理"}\r\n\r\ndata: {"event":"run.completed","output":"完成"}\r\n\r\n');
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset)); },
    cancel() { cancelled = true; },
  });
  const client = new HermesClient("http://hermes.test", "test-key", (async () => new Response(body)) as typeof fetch);
  const events = [];
  for await (const event of client.runEvents("run")) { events.push(event); if (event.event === "run.completed") break; }
  assert.equal(events[0].delta, "真实");
  assert.equal(events[1].text, "真实推理");
  assert.equal(events[2].output, "完成");
  assert.equal(cancelled, true);
});
