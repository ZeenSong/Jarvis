import test from "node:test";
import assert from "node:assert/strict";
import { buildOpsGateway } from "../apps/worker-controller/src/ops-gateway.js";
test("Ops relay forwards only authenticated read tools to one fixed upstream", async () => {
  const requests: any[] = [];
  const app = buildOpsGateway(
    "http://127.0.0.1:8080",
    "test-token-long-enough",
    async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ cpu: { usage_percent: 12 } });
    },
  );
  try {
    const headers = { authorization: "Bearer test-token-long-enough" };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/internal/ops/read",
          payload: { tool: "system.status.read" },
        })
      ).statusCode,
      401,
    );
    for (const tool of ["agent.run.cancel", "agent.run.create", "shell"])
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/internal/ops/read",
            headers,
            payload: { tool },
          })
        ).statusCode,
        400,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/internal/ops/read",
          headers,
          payload: {
            tool: "system.status.read",
            args: { url: "http://other.invalid" },
          },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v2/agent.run.cancel",
          headers,
          payload: {},
        })
      ).statusCode,
      404,
    );
    const r = await app.inject({
      method: "POST",
      url: "/internal/ops/read",
      headers,
      payload: { tool: "system.status.read" },
    });
    assert.equal(r.json().cpu.usage_percent, 12);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "http://127.0.0.1:8080/internal/ops/read");
    assert.equal(requests[0].init.redirect, "error");
  } finally {
    await app.close();
  }
});
