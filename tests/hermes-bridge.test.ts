import test from "node:test";
import assert from "node:assert/strict";
import { HermesClient } from "../packages/hermes-bridge/src/index.js";
import { HermesRuntime } from "../packages/hermes-runtime/src/index.js";

test("Hermes bridge forwards authenticated session and parses SSE deltas", async () => {
  let request: Request | undefined;
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n')); c.close(); } });
  const client = new HermesClient("http://hermes:8642", "secret", async (input, init) => { request = new Request(input, init); return new Response(body, { status: 200 }); });
  const values = []; for await (const value of client.stream([{ role: "user", content: "hi" }], { sessionId: "session-1", tools: [{ type: "function", function: { name: "system_status_read", parameters: { type: "object" } } }] })) values.push(value);
  assert.deepEqual(values.map((v) => v.type), ["delta", "completed"]);
  assert.equal(request?.headers.get("authorization"), "Bearer secret");
  assert.equal(request?.headers.get("x-hermes-session-id"), "session-1");
  assert.match(await request!.text(), /system_status_read/);
});

test("Hermes bridge reconstructs streamed tool calls for the Kernel loop", async () => {
  const body = new ReadableStream({ start(c) {
    c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"system_status_read","arguments":"{}"}}]}}]}\n\n'));
    c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\ndata: [DONE]\n\n')); c.close();
  } });
  const client = new HermesClient("http://hermes:8642", "secret", async () => new Response(body, { status: 200 }));
  const result = await client.complete([{ role: "user", content: "status" }], [{ type: "function", function: { name: "system_status_read", parameters: { type: "object" } } }], { sessionId: "s", report: async (usage) => assert.deepEqual(usage, { provider: "hermes", model: "hermes-agent", input_tokens: 3, output_tokens: 1, cached_input_tokens: 0 }) });
  assert.equal(result.calls[0].function.name, "system_status_read");
  assert.equal(result.calls[0].function.arguments, "{}");
});

test("Hermes runtime executes only the bound Kernel tool bridge", async () => {
  let calls = 0;
  const client = {
    complete: async (_messages: unknown[], _tools: unknown[], options: any) => {
      calls++;
      if (calls === 1) return { content: "", calls: [{ id: "c1", type: "function", function: { name: "system_status_read", arguments: "{}" } }] };
      await options.delta?.("只读结论");
      return { content: "只读结论", calls: [] };
    },
    health: async () => true,
  } as unknown as HermesClient;
  const runtime = new HermesRuntime(client, {
    tools: [{ type: "function", function: { name: "system_status_read", parameters: { type: "object" } } }],
    invoke: async (name, _args, owner) => {
      assert.equal(name, "system_status_read");
      assert.equal(owner, "device-1");
      return { cpu: { usage_percent: 12 } };
    },
  });
  const run = await runtime.start({ id: "r1", goal: "状态", owner_device_id: "device-1" });
  const events = [];
  for await (const event of runtime.events(run.id)) events.push(event);
  assert.ok(events.some((event) => event.type === "agent.tool.completed"));
  assert.ok(events.some((event) => event.type === "agent.message.delta"));
  assert.equal(events.at(-1)?.type, "agent.run.completed");
});


test("Hermes durable tasks retain the final result and reject empty success", async () => {
  for (const content of ["read-only result", ""]) {
    const runtime = new HermesRuntime({ complete: async () => ({content, calls: []}) } as unknown as HermesClient);
    const run = await runtime.start({id:"result-test",goal:"read state"});
    const events = []; for await (const event of runtime.events(run.id)) events.push(event);
    const final = events.at(-1)!;
    assert.equal(final.type, content ? "agent.run.completed" : "agent.run.failed");
    if (content) assert.equal(final.payload.summary, content);
    else assert.equal(final.payload.error, "hermes_empty_response");
    await runtime.dispose(run.id);
  }
});
