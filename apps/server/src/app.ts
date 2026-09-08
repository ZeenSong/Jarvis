import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { z } from "zod";
import { database, migrate } from "./persistence.js";
import { authenticate, pair } from "./auth.js";
import {
  envelopeSchema,
  message,
} from "../../../packages/protocol/src/index.js";
import { SystemMonitor } from "../../../packages/system-monitor/src/index.js";
import { AgentRegistry } from "../../../packages/agent-registry/src/index.js";
import {
  UsageCollector,
  type Prices,
} from "../../../packages/llm-usage/src/index.js";
export async function buildApp(options: {
  databaseUrl: string;
  logger?: boolean;
  prices?: Prices;
  hostRoot?: string;
  networkInterface?: string;
  degradedSeconds?: number;
  offlineSeconds?: number;
  retentionDays?: number;
}) {
  const db = database(options.databaseUrl);
  db.on("error", (e) => app.log.error({ err: e }, "postgres_pool_error"));
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.body.code",
            "req.body.token",
          ],
        }
      : false,
    bodyLimit: 65536,
  });
  await migrate(db);
  const monitor = new SystemMonitor(options.hostRoot, options.networkInterface);
  const sockets = new Map<WebSocket, { topics: Set<string>; alive: boolean }>();
  let sequence = 0;
  const push = (topic: string, payload: unknown) => {
    const event = { ...message("event", topic, payload), sequence: ++sequence };
    for (const [ws, s] of sockets)
      if (s.topics.has(topic) && ws.readyState === 1) {
        if (ws.bufferedAmount > 1024 * 1024) {
          ws.close(1013, "slow_consumer");
          continue;
        }
        ws.send(JSON.stringify(event));
      }
  };
  const agents = new AgentRegistry(
      db,
      push,
      options.degradedSeconds,
      options.offlineSeconds,
    ),
    usage = new UsageCollector(db, options.prices ?? {}, push);
  let schedulerAt = Date.now(),
    busy = false,
    lastPrune = 0;
  await monitor.sample();
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const old = monitor.state?.network.public_ipv6;
      await monitor.sample();
      push("system.status.changed", await systemStatus());
      if (old !== monitor.state.network.public_ipv6)
        push("network.public_ipv6.changed", {
          previous_public_ipv6: old,
          current_public_ipv6: monitor.state.network.public_ipv6,
        });
      await agents.sweep();
      if (Date.now() - lastPrune > 3600000) {
        await db.query(
          "DELETE FROM agent_events WHERE created_at<now()-$1*interval '1 day'",
          [options.retentionDays ?? 30],
        );
        await db.query("DELETE FROM pairing_codes WHERE expires_at<now()");
        lastPrune = Date.now();
      }
      schedulerAt = Date.now();
    } catch (e) {
      app.log.error({ err: e }, "scheduler_failed");
    } finally {
      busy = false;
    }
  }, 2000);
  const heartbeat = setInterval(() => {
    for (const [ws, s] of sockets) {
      if (!s.alive) {
        ws.terminate();
        continue;
      }
      s.alive = false;
      ws.ping();
    }
  }, 15000);
  async function ready() {
    let database = "healthy";
    try {
      await db.query("SELECT 1");
    } catch {
      database = "unhealthy";
    }
    const components = {
      database,
      system_monitor:
        Date.now() - monitor.lastSample < 15000 ? "healthy" : "unhealthy",
      internal_scheduler:
        Date.now() - schedulerAt < 15000 ? "healthy" : "unhealthy",
    };
    return {
      status: Object.values(components).every((v) => v === "healthy")
        ? "healthy"
        : "unhealthy",
      components,
    };
  }
  async function systemStatus() {
    const h = await ready();
    return {
      ...monitor.state,
      jarvis: {
        version: "0.1.0",
        server_status: h.status,
        db_status: h.components.database,
      },
    };
  }
  app.get("/health/live", async () => ({
    status: "healthy",
    version: "0.1.0",
  }));
  app.get("/health", async () => ({ status: "healthy", version: "0.1.0" }));
  app.get("/health/ready", async (_req, reply) => {
    const h = await ready();
    return reply.code(h.status === "healthy" ? 200 : 503).send(h);
  });
  app.get("/api/v1/health", async (_req, reply) => {
    const h = await ready();
    return reply
      .code(h.status === "healthy" ? 200 : 503)
      .send({ ...h, version: "0.1.0" });
  });
  const attempts = new Map<string, { count: number; until: number }>();
  app.post("/api/v1/pair", async (req, reply) => {
    const now = Date.now();
    for (const [ip, a] of attempts) if (a.until < now) attempts.delete(ip);
    const a = attempts.get(req.ip) ?? { count: 0, until: now + 60000 };
    attempts.set(req.ip, a);
    if (++a.count > 10)
      return reply.code(429).send({ error: "pairing_rate_limited" });
    const p = z
      .object({ device_id: z.uuid(), code: z.string().min(1).max(128) })
      .parse(req.body);
    try {
      return await pair(db, p.device_id, p.code);
    } catch {
      return reply.code(401).send({ error: "pairing_failed" });
    }
  });
  await app.register(websocket, { options: { maxPayload: 65536 } });
  await app.register(async (api) => {
    api.addHook("preValidation", async (req, reply) => {
      const identity = await authenticate(db, req.headers.authorization);
      if (!identity) return reply.code(401).send({ error: "unauthorized" });
      (req as any).identity = identity;
    });
    api.get("/api/v1/system/status", systemStatus);
    api.get("/api/v1/agents", () => agents.list());
    api.get<{ Params: { agentId: string } }>(
      "/api/v1/agents/:agentId",
      async (req, reply) => {
        const a = await agents.get(req.params.agentId);
        return a ?? reply.code(404).send({ error: "not_found" });
      },
    );
    api.get<{ Params: { agentId: string } }>(
      "/api/v1/agents/:agentId/events",
      (req) => agents.events(req.params.agentId),
    );
    api.get("/api/v1/llm/usage", (req) => usage.summary(req.query));
    api.post("/api/v1/llm/requests", async (req, reply) => {
      const identity = (req as any).identity;
      if (identity.role !== "agent")
        return reply.code(403).send({ error: "agent_required" });
      return usage.record(req.body, identity.id);
    });
    api.get("/ws", { websocket: true }, (ws, req) => {
      const identity = (req as any).identity;
      const state = {
        topics: new Set([
          "network.public_ipv6.changed",
          "agent.status.changed",
          "llm.usage.changed",
        ]),
        alive: true,
      };
      sockets.set(ws, state);
      ws.on("pong", () => {
        state.alive = true;
      });
      ws.on("close", () => sockets.delete(ws));
      ws.send(
        JSON.stringify(
          message("event", "gateway.status", {
            status: "online",
            version: 1,
            device_id: identity.id,
          }),
        ),
      );
      const replies = new Map<string, { request: string; response: string }>();
      let chain = Promise.resolve(),
        pending = 0;
      ws.on("message", (raw) => {
        if (++pending > 100) {
          ws.close(1008, "too_many_requests");
          return;
        }
        chain = chain
          .then(async () => {
            let id: string | undefined,
              topic = "gateway.error";
            try {
              const m = envelopeSchema.parse(JSON.parse(raw.toString()));
              id = m.id;
              topic = m.topic;
              if (!["request", "event"].includes(m.type))
                throw new Error("invalid_message_type");
              const encoded = JSON.stringify(m);
              const cached = replies.get(id);
              if (cached) {
                if (cached.request !== encoded)
                  throw new Error("id_reused_with_different_request");
                ws.send(cached.response);
                return;
              }
              let result: unknown;
              const p = m.payload;
              if (
                topic.startsWith("agent.") &&
                !["agent.list", "agent.get"].includes(topic) &&
                identity.role !== "agent"
              )
                throw new Error("agent_required");
              switch (topic) {
                case "gateway.ping":
                  result = { pong: true };
                  break;
                case "gateway.subscribe": {
                  const topics = z
                    .array(
                      z.enum([
                        "system.status.changed",
                        "network.public_ipv6.changed",
                        "agent.status.changed",
                        "llm.usage.changed",
                        "llm.request.completed",
                      ]),
                    )
                    .max(5)
                    .parse(p.topics);
                  state.topics = new Set(topics);
                  result = { topics };
                  break;
                }
                case "system.status.get":
                  result = await systemStatus();
                  break;
                case "agent.list":
                  result = await agents.list();
                  break;
                case "agent.get":
                  result = await agents.get(z.string().parse(p.agent_id));
                  if (!result) throw new Error("not_found");
                  break;
                case "agent.register":
                  result = await agents.register(p, identity.id);
                  break;
                case "agent.heartbeat":
                case "agent.task.started":
                case "agent.task.finished":
                case "agent.error":
                  result = await agents.heartbeat(p, identity.id, topic);
                  break;
                case "llm.usage.summary":
                  result = await usage.summary(p);
                  break;
                case "llm.request.completed":
                  if (identity.role !== "agent")
                    throw new Error("agent_required");
                  result = await usage.record(p, identity.id);
                  break;
                default:
                  throw new Error("unknown_topic");
              }
              const response = JSON.stringify(
                message(
                  "response",
                  topic === "gateway.ping" ? "gateway.pong" : topic,
                  result,
                  id,
                ),
              );
              replies.set(id, { request: encoded, response });
              if (replies.size > 256)
                replies.delete(replies.keys().next().value!);
              if (ws.readyState === 1) ws.send(response);
            } catch (e) {
              if (ws.readyState === 1)
                ws.send(
                  JSON.stringify(
                    message(
                      "error",
                      topic,
                      {
                        error:
                          e instanceof z.ZodError
                            ? "validation_error"
                            : e instanceof Error &&
                                /^(agent_|unknown_topic|invalid_|id_reused|not_found|custom_)/.test(
                                  e.message,
                                )
                              ? e.message
                              : "request_failed",
                      },
                      id,
                    ),
                  ),
                );
            }
          })
          .catch((e) => app.log.error({ err: e }, "websocket_failed"))
          .finally(() => {
            pending--;
          });
      });
    });
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: "validation_error", issues: error.issues });
    if (
      error instanceof Error &&
      /^(custom_range_requires_from_to|invalid_time_range|invalid_usage)$/.test(
        error.message,
      )
    )
      return reply.code(400).send({ error: error.message });
    if (error instanceof Error && error.message === "agent_not_owned")
      return reply.code(403).send({ error: error.message });
    if ((error as any).statusCode === 413)
      return reply.code(413).send({ error: "payload_too_large" });
    app.log.error({ err: error }, "request_failed");
    return reply.code(500).send({ error: "request_failed" });
  });
  app.addHook("onClose", async () => {
    clearInterval(timer);
    clearInterval(heartbeat);
    for (const ws of sockets.keys()) ws.terminate();
    while (busy) await new Promise((r) => setTimeout(r, 10));
    await db.end();
  });
  return { app, db, monitor, agents, usage };
}
