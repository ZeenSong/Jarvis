import test from "node:test";
import assert from "node:assert/strict";
import { deriveHermesProfileKey, hermesAgentConfig, HermesClient } from "../packages/hermes-bridge/src/index.js";
import { HermesRuntime } from "../packages/hermes-runtime/src/index.js";

test("Hermes bridge forwards authenticated session and parses SSE deltas", async () => {
  let request: Request | undefined;
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n')); c.close(); } });
  const client = new HermesClient("http://hermes:8642/p/jarvis", "secret", async (input, init) => { request = new Request(input, init); return new Response(body, { status: 200 }); });
  const values = []; for await (const value of client.stream([{ role: "user", content: "hi" }], { sessionId: "session-1", sessionKey: "jarvis:device-1", tools: [{ type: "function", function: { name: "system_status_read", parameters: { type: "object" } } }] })) values.push(value);
  assert.deepEqual(values.map((v) => v.type), ["delta", "completed"]);
  assert.equal(new URL(request!.url).pathname, "/p/jarvis/v1/chat/completions");
  assert.equal(request?.headers.get("authorization"), "Bearer secret");
  assert.equal(request?.headers.get("x-hermes-session-id"), "session-1");
  assert.equal(request?.headers.get("x-hermes-session-key"), "jarvis:device-1");
  assert.match(await request!.text(), /system_status_read/);
});

test("Hermes Agent config targets the named Jarvis profile", () => {
  const config = hermesAgentConfig({
    HERMES_URL: "http://hermes:8642/p/jarvis/",
    HERMES_PROFILE: "jarvis",
    HERMES_API_KEY: "gateway-secret",
  });
  assert.deepEqual(config, {
    url: "http://hermes:8642/p/jarvis",
    profile: "jarvis",
    apiKey: deriveHermesProfileKey("gateway-secret", "jarvis"),
  });
});

test("Hermes model options are read from the authenticated active profile", async () => {
  let request: Request | undefined;
  const client = new HermesClient("http://hermes:8642/p/jarvis", "secret", async (input, init) => {
    request = new Request(input, init);
    return Response.json({ provider: "openai", model: "gpt-5", providers: [] });
  });
  const options = await client.modelOptions();
  assert.equal(options.model, "gpt-5");
  assert.equal(new URL(request!.url).pathname, "/p/jarvis/api/model/options");
  assert.equal(request?.headers.get("authorization"), "Bearer secret");
});

test("Hermes Skills discovery is gated by the active image's per-run enforcement capability", async () => {
  const paths: string[] = [];
  const client = new HermesClient("http://hermes:8642/p/jarvis", "secret", async (input, init) => {
    const request = new Request(input, init); paths.push(new URL(request.url).pathname);
    assert.equal(request.headers.get("authorization"), "Bearer secret");
    return paths.length === 1
      ? Response.json({ features: { skills_per_run: true } })
      : Response.json({ object: "list", data: [
        { name: "家庭助手", description: "查看家庭状态", category: "家庭", path: "/private/path" },
        { name: "", description: "invalid" },
      ] });
  });
  assert.deepEqual(await client.skills(), [{ name: "家庭助手", description: "查看家庭状态", category: "家庭" }]);
  assert.deepEqual(paths, ["/p/jarvis/v1/capabilities", "/p/jarvis/v1/skills"]);

  const legacy = new HermesClient("http://hermes:8642", "secret", async () => Response.json({ features: { skills_api: true } }));
  assert.deepEqual(await legacy.skills(), []);
});

test("Hermes durable runs forward a selected reasoning effort", async () => {
  let request: Request | undefined;
  const client = new HermesClient("http://hermes:8642/p/jarvis", "secret", async (input, init) => {
    request = new Request(input, init);
    return Response.json({ run_id: "run-1", status: "queued" });
  });
  await client.startRun("请分析", { sessionId: "session-1", idempotencyKey: "request-1", model: "gpt-5", modelOptions: { reasoning_effort: "high" }, skills: ["家庭助手"] });
  assert.equal(new URL(request!.url).pathname, "/p/jarvis/v1/runs");
  const runBody = await request!.json() as any;
  assert.deepEqual(runBody.model_options, { reasoning_effort: "high" });
  assert.deepEqual(runBody.skills, ["家庭助手"]);
});

test("Hermes semantic title generation is tool-free and uses the configured model", async () => {
  let request: Request | undefined;
  const client = new HermesClient("http://hermes:8642/p/jarvis", "secret", async (input, init) => {
    request = new Request(input, init);
    return Response.json({ choices: [{ message: { content: "猫咪活动趋势" } }] });
  });
  assert.equal(await client.suggestTitle("看看猫咪今天的活动", "猫咪今天在客厅活动。", { model: "deepseek-flash" }), "猫咪活动趋势");
  const body = await request!.json() as any;
  assert.equal(new URL(request!.url).pathname, "/p/jarvis/v1/chat/completions");
  assert.equal(body.model, "deepseek-flash");
  assert.equal(body.stream, false);
  assert.equal("tools" in body, false);
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
