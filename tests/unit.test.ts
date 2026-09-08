import test from "node:test";
import assert from "node:assert/strict";
import { selectNetwork } from "../packages/system-monitor/src/index.js";
import { effectiveStatus } from "../packages/agent-registry/src/index.js";
import {
  estimateCost,
  bounds,
  LlmClient,
} from "../packages/llm-usage/src/index.js";
import { envelopeSchema } from "../packages/protocol/src/index.js";
import { createServer } from "node:http";
test("IPv6 selector excludes privacy, deprecated, virtual and link-local addresses", () => {
  const network = selectNetwork([
    {
      ifname: "docker0",
      addr_info: [{ family: "inet6", local: "240e::bad", scope: "global" }],
    },
    {
      ifname: "eth0",
      addr_info: [
        { family: "inet6", local: "fe80::1", scope: "link" },
        { family: "inet6", local: "240e::2", scope: "global", temporary: true },
        {
          family: "inet6",
          local: "240e::3",
          scope: "global",
          preferred_life_time: 0,
        },
        {
          family: "inet6",
          local: "240e::4",
          scope: "global",
          flags: ["tentative"],
        },
        { family: "inet6", local: "240e::5", scope: "global" },
      ],
    },
    {
      ifname: "tailscale0",
      addr_info: [
        { family: "inet", local: "100.80.1.1" },
        { family: "inet6", local: "fd7a:115c:a1e0::1", scope: "global" },
      ],
    },
  ]);
  assert.equal(network.public_ipv6, "240e::5");
  assert.equal(network.tailscale_ipv4, "100.80.1.1");
  assert.equal(selectNetwork([]).public_ipv6, null);
});
test("Agent timeout boundaries and recovery preserve reported state", () => {
  const last = new Date(0);
  assert.equal(effectiveStatus("running", last, 30000), "running");
  assert.equal(effectiveStatus("running", last, 30001), "degraded");
  assert.equal(effectiveStatus("idle", last, 90001), "offline");
  assert.equal(effectiveStatus("idle", new Date(100000), 100001), "idle");
});
test("cached inputs replace normal input pricing; missing price remains unknown", () => {
  const u = {
    input_tokens: 1000000,
    cached_input_tokens: 250000,
    output_tokens: 100000,
  };
  assert.equal(
    estimateCost(u, {
      input_per_million: 2,
      output_per_million: 8,
      cached_input_per_million: 0.2,
      valid_from: "2026-01-01",
    }),
    2.35,
  );
  assert.equal(estimateCost(u), null);
});
test("UTC ranges and custom validation", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  assert.equal(
    bounds({ range: "month" }, now).from.toISOString(),
    "2026-09-01T00:00:00.000Z",
  );
  assert.equal(
    bounds({ range: "7d" }, now).from.toISOString(),
    "2026-08-31T12:00:00.000Z",
  );
  assert.throws(() => bounds({ range: "custom" }));
  assert.throws(() =>
    bounds({
      range: "custom",
      from: "2026-09-08T00:00:00Z",
      to: "2026-09-07T00:00:00Z",
    }),
  );
});
test("envelope rejects unknown version and invalid payload", () => {
  assert.equal(
    envelopeSchema.parse({ id: "1", type: "request", topic: "gateway.ping" })
      .version,
    1,
  );
  assert.equal(
    envelopeSchema.safeParse({
      id: "1",
      version: 2,
      type: "request",
      topic: "x",
    }).success,
    false,
  );
  assert.equal(
    envelopeSchema.safeParse({
      id: "1",
      type: "request",
      topic: "x",
      payload: [],
    }).success,
    false,
  );
});
test("LLM transport records response usage, HTTP errors and timeout without real API spend", async () => {
  let mode = "ok";
  const server = createServer((_req, res) => {
    if (mode === "timeout") return;
    if (mode === "error") {
      res.writeHead(429);
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        id: "provider-1",
        model: "test",
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          prompt_tokens_details: { cached_tokens: 20 },
          completion_tokens_details: { reasoning_tokens: 10 },
        },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const records: any[] = [];
  const client = new LlmClient(
    {
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: "test",
      provider: "test",
      agentId: "test-agent",
      timeoutMs: 100,
    },
    async (u) => {
      records.push(u);
    },
  );
  try {
    await client.complete("test", [{ role: "user", content: "hello" }]);
    assert.equal(records[0].cached_input_tokens, 20);
    assert.equal(records[0].reasoning_tokens, 10);
    mode = "error";
    await assert.rejects(client.complete("test", []));
    assert.equal(records[1].error_type, "provider_http_429");
    mode = "timeout";
    await assert.rejects(client.complete("test", []));
    assert.equal(records[2].error_type, "timeout");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
