import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
export function buildOpsGateway(
  origin: string,
  token: string,
  transport: typeof fetch = fetch,
) {
  const base = new URL(origin);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    token.length < 16
  )
    throw Error("invalid_ops_gateway_configuration");
  const app = Fastify({ bodyLimit: 65536 });
  app.get("/health", async () => ({ healthy: true }));
  app.post("/internal/ops/read", async (req, reply) => {
    const expected = Buffer.from("Bearer " + token),
      actual = Buffer.from(req.headers.authorization ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return reply.code(401).send({ error: "unauthorized" });
    const p = z
      .object({
        tool: z.enum([
          "system.status.read",
          "system.metrics.read",
          "agent.list",
          "agent.run.read",
          "llm.usage.read",
        ]),
        args: z.record(z.string(), z.unknown()).default({}),
      })
      .strict()
      .parse(req.body);
    if (p.tool === "agent.run.read")
      p.args = z.object({ run_id: z.uuid() }).strict().parse(p.args);
    else p.args = z.object({}).strict().parse(p.args);
    const response = await transport(new URL("/internal/ops/read", base), {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify(p),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok)
      return reply.code(502).send({ error: "ops_upstream_unavailable" });
    return response.json();
  });
  app.setErrorHandler((error, _, reply) =>
    reply
      .code(error instanceof z.ZodError ? 400 : 502)
      .send({
        error:
          error instanceof z.ZodError
            ? "invalid_read_request"
            : "ops_upstream_unavailable",
      }),
  );
  return app;
}
