import { M2, m2Topics, m2Events } from "./m2.js";
import { permitted } from "./permissions.js";
import { hash } from "./auth.js";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RuntimeRegistry } from "../../../packages/agent-runtime/src/index.js";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { z } from "zod";
import { database, migrate } from "./persistence.js";
import { authenticate, pair } from "./auth.js";
import { bootstrapUser, loginUser, refreshUserSession, authenticateUserAccess, listUserSessions, revokeUserSession, createInvite, acceptInvite } from "./identity.js";
import { MediaStore } from "./media.js";
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
import { ownerUserId } from "./ownership.js";
import { verifyHermesContextToken } from "../../../packages/hermes-bridge/src/index.js";
const SERVER_VERSION = "0.3.0-preview.1";
export async function buildApp(options: {
  databaseUrl: string;
  runtimes?: RuntimeRegistry;
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
            "req.headers.cookie",
            "req.body.code",
            "req.body.token",
          ],
        }
      : false,
    bodyLimit: 65536,
  });
  await migrate(db);
  const media = new MediaStore();
  const monitor = new SystemMonitor(options.hostRoot, options.networkInterface);
  const sockets = new Map<WebSocket, { topics: Set<string>; alive: boolean; sessionId?: string }>();
  const nodeSockets = new Map<string, WebSocket>();
  const nodePending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const invokeNode = async (owner: string, nodeId: string, capability: string, input: Record<string, unknown>) => {
    const user = await ownerUserId(db, owner);
    const record = await db.query("SELECT 1 FROM agents a WHERE a.id=$1 AND a.status IS DISTINCT FROM 'offline' AND (a.owner_device_id=$2 OR a.owner_user_id=$3 OR ($3 IS NULL AND a.owner_user_id IS NULL))", [nodeId, owner, user ?? null]);
    if (!record.rowCount) throw Error("node_not_found");
    const ws = nodeSockets.get(nodeId);
    if (!ws || ws.readyState !== 1) throw Error("node_bridge_unavailable");
    const id = randomBytes(16).toString("hex");
    const request = { id, version: 1, type: "request", topic: "node.invoke", timestamp: new Date().toISOString(), payload: { capability, input } };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { nodePending.delete(id); reject(Error("node_invoke_timeout")); }, 120000);
      nodePending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify(request), (error) => {
        if (error) { clearTimeout(timer); nodePending.delete(id); reject(error); }
      });
    });
  };
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
  const m2 = new M2(
    db,
    push,
    async (name, args, owner) => {
      if (name === "system.status.read") return systemStatus();
      if (name === "llm.usage.read") return usage.summary(args ?? {}, owner);
      throw Error("tool_not_allowed");
    },
    options.runtimes,
    options.prices,
    invokeNode,
  );
  const hermesBridgeKey = process.env.HERMES_BRIDGE_KEY?.trim() ?? "";
  const hermesCapabilityInput = z.object({
    tool: z.string().min(1).max(100),
    context_token: z.string().min(20).max(2000),
    arguments: z.record(z.string(), z.unknown()).default({}),
  }).strict();
  app.post("/internal/hermes/capability", async (req, reply) => {
    if (!hermesBridgeKey || req.headers["x-jarvis-bridge-key"] !== hermesBridgeKey)
      return reply.code(401).send({ error: "hermes_bridge_unauthorized" });
    try {
      const input = hermesCapabilityInput.parse(req.body);
      const context = verifyHermesContextToken(hermesBridgeKey, input.context_token);
      if (!context) return reply.code(401).send({ error: "hermes_context_invalid" });
      const args = input.arguments;
      const toolCallId = `mcp-${randomBytes(12).toString("hex")}`;
      const conversationId = z.uuid().safeParse(context.session).success ? context.session : undefined;
      if (conversationId) push("conversation.tool.started", {
        conversation_id: conversationId,
        tool_call_id: toolCallId,
        capability: input.tool,
        arguments: args,
      });
      let result: unknown;
      switch (input.tool) {
        case "system_status_read":
          result = await m2.readForAgent("system.status.read", undefined, context.owner);
          break;
        case "system_metrics_read":
          result = await m2.readForAgent("system.metrics.read", undefined, context.owner);
          break;
        case "agent_list":
          result = await m2.readForAgent("agent.list", undefined, context.owner);
          break;
        case "llm_usage_read":
          result = await m2.readForAgent("llm.usage.read", undefined, context.owner);
          break;
        case "agent_run_status":
          result = await m2.readForAgent("agent.run.read", args, context.owner);
          break;
        case "ui_view_show":
          {
            const view = await m2.show({ type: "view.show", ...args }, context.owner);
            let workspace = conversationId
              ? (await m2.workspaces.list(context.owner, conversationId))[0]
              : undefined;
            if (conversationId && !workspace)
              workspace = await m2.workspaces.create(context.owner, {
                conversation_id: conversationId,
                type: "native",
                title: "Jarvis 工作区",
              });
            if (conversationId) {
              await db.query(
                "UPDATE conversation_messages SET view_id=$2,workspace_id=$3,content_type='rich' WHERE id=(SELECT id FROM conversation_messages WHERE conversation_id=$1 AND role='jarvis' AND status='streaming' ORDER BY sequence DESC LIMIT 1)",
                [conversationId, view.id, workspace?.id ?? null],
              );
              push("conversation.updated", { conversation_id: conversationId });
            }
            result = { ...view, workspace_id: workspace?.id };
            break;
          }
        default:
          return reply.code(404).send({ error: "hermes_capability_not_allowed" });
      }
      if (conversationId) push("conversation.tool.completed", {
        conversation_id: conversationId,
        tool_call_id: toolCallId,
        capability: input.tool,
        result,
      });
      return result;
    } catch (error) {
      // The MCP provider receives the HTTP error body and Hermes can report it
      // as a failed capability call without exposing bridge credentials.
      return reply.code(400).send({ error: error instanceof Error ? error.message : "hermes_capability_invalid" });
    }
  });
  await m2.start();
  let lastMetric = 0;
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
      if (Date.now() - lastMetric > 30000) {
        await m2.sample(await systemStatus());
        lastMetric = Date.now();
      }
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
        await m2.cleanup();
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
        version: SERVER_VERSION,
        server_status: h.status,
        db_status: h.components.database,
      },
    };
  }
  app.get("/health/live", async () => ({
    status: "healthy",
    version: SERVER_VERSION,
  }));
  app.get("/health", async () => ({
    status: "healthy",
    version: SERVER_VERSION,
  }));
  app.get("/health/ready", async (_req, reply) => {
    const h = await ready();
    return reply.code(h.status === "healthy" ? 200 : 503).send(h);
  });
  app.get("/api/v1/health", async (_req, reply) => {
    const h = await ready();
    return reply
      .code(h.status === "healthy" ? 200 : 503)
      .send({ ...h, version: SERVER_VERSION });
  });
  function validOrigin(req: any) {
    return (
      req.headers.origin ===
      (process.env.WEB_ORIGIN ?? `${req.protocol}://${req.headers.host}`)
    );
  }
  app.addHook("onRequest", async (req, reply) => {
    if (req.headers.origin && !validOrigin(req))
      return reply.code(403).send({ error: "origin_forbidden" });
  });
  for (const path of ["/", "/login", "/home", "/spaces", "/apps", "/apps/:id", "/tasks", "/tasks/:id", "/jarvis", "/system", "/integrations", "/workspace"]) app.get(path, async (_req, reply) => {
    try {
      return reply
        .type("text/html")
        .send(await readFile(resolve("apps/web/dist/index.html")));
    } catch {
      return reply.code(503).send({ error: "web_not_built" });
    }
  });
  app.get<{ Params: { "*": string } }>("/assets/*", async (req, reply) => {
    const name = req.params["*"];
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return reply.code(404).send();
    try {
      return reply
        .type(
          name.endsWith(".js")
            ? "application/javascript"
            : name.endsWith(".css")
              ? "text/css"
              : "application/octet-stream",
        )
        .send(await readFile(resolve("apps/web/dist/assets", name)));
    } catch {
      return reply.code(404).send();
    }
  });
  app.get<{ Params: { name: string } }>("/artwork/:name", async (req, reply) => {
    const name = req.params.name;
    if (!/^(alpine-dusk|files|knowledge|family|media|development)-v1\.png$/.test(name)) return reply.code(404).send();
    try {
      return reply.type("image/png").header("Cache-Control", "public, max-age=86400")
        .send(await readFile(resolve("apps/web/dist/artwork", name)));
    } catch { return reply.code(404).send(); }
  });
  app.get<{ Params: { name: string } }>("/app-icons/:name", async (req, reply) => {
    if (!["homeassistant.svg", "immich.svg"].includes(req.params.name)) return reply.code(404).send();
    try {
      return reply.type("image/svg+xml").header("Content-Security-Policy", "default-src 'none'; sandbox")
        .header("X-Content-Type-Options", "nosniff").header("Cache-Control", "public, max-age=86400")
        .send(await readFile(resolve("apps/web/dist/app-icons", req.params.name)));
    } catch { return reply.code(404).send(); }
  });
  const attempts = new Map<string, { count: number; until: number }>();
  const cookieValue = (req: any, name: string) => {
    const prefix = `${name}=`;
    return req.headers.cookie?.split(";").map((v: string) => v.trim()).find((v: string) => v.startsWith(prefix))?.slice(prefix.length);
  };
  const userIdentity = async (req: any) => {
    const value = cookieValue(req, "jarvis_access");
    const bearer = req.headers.authorization ?? (value ? `Bearer ${value}` : undefined);
    return authenticateUserAccess(db, bearer);
  };
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
      const result = await pair(db, p.device_id, p.code);
      if (req.headers.origin) {
        if (!validOrigin(req))
          return reply.code(403).send({ error: "origin_forbidden" });
        const identity = await authenticate(db, `Bearer ${result.token}`);
        if (identity?.role !== "device")
          return reply.code(403).send({ error: "device_required" });
        const session = randomBytes(32).toString("base64url");
        await db.query(
          "INSERT INTO web_sessions(token_hash,device_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
          [hash(session), result.device_id],
        );
        reply.header(
          "Set-Cookie",
          `jarvis_session=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${req.protocol === "https" ? "; Secure" : ""}`,
        );
        return { device_id: result.device_id };
      }
      return result;
    } catch {
      return reply.code(401).send({ error: "pairing_failed" });
    }
  });
  app.post("/api/v2/auth/bootstrap", async (req, reply) => {
    let identity = await authenticate(db, req.headers.authorization);
    if (!identity) {
      const session = req.headers.cookie?.split(";").map((v) => v.trim()).find((v) => v.startsWith("jarvis_session="))?.slice(15);
      if (session) identity = (await db.query("SELECT d.id,d.role FROM web_sessions s JOIN devices d ON d.id=s.device_id WHERE s.token_hash=$1 AND s.expires_at>now()", [hash(session)])).rows[0];
    }
    if (!identity || identity.role !== "device") return reply.code(401).send({ error: "device_required" });
    try { return await bootstrapUser(db, identity.id, req.body); }
    catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : "bootstrap_failed" }); }
  });
  app.post("/api/v2/auth/login", async (req, reply) => {
    try {
      const device = await authenticate(db, req.headers.authorization);
      let deviceId = device?.role === "device" ? device.id : undefined;
      if (!deviceId) {
        const session = req.headers.cookie?.split(";").map((v) => v.trim()).find((v) => v.startsWith("jarvis_session="))?.slice(15);
        if (session) deviceId = (await db.query("SELECT d.id FROM web_sessions s JOIN devices d ON d.id=s.device_id WHERE s.token_hash=$1 AND s.expires_at>now() AND d.role='device'", [hash(session)])).rows[0]?.id;
      }
      const result = await loginUser(db, req.body, deviceId);
      reply.header("Cache-Control", "no-store").header("Set-Cookie", [`jarvis_access=${result.access_token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900${req.protocol === "https" ? "; Secure" : ""}`, `jarvis_refresh=${result.refresh_token}; Path=/api/v2/auth; HttpOnly; SameSite=Strict; Max-Age=2592000${req.protocol === "https" ? "; Secure" : ""}`]);
      return result;
    } catch (e) { return reply.code(401).send({ error: e instanceof Error ? e.message : "invalid_credentials" }); }
  });
  app.post("/api/v2/auth/refresh", async (req, reply) => {
    try {
      const body = req.body && typeof req.body === "object" && "refresh_token" in req.body
        ? z.object({ refresh_token: z.string().min(20).max(200) }).strict().parse(req.body).refresh_token
        : cookieValue(req, "jarvis_refresh");
      if (!body) throw Error("invalid_session");
      const result = await refreshUserSession(db, body);
      reply.header("Cache-Control", "no-store").header("Set-Cookie", [`jarvis_access=${result.access_token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900${req.protocol === "https" ? "; Secure" : ""}`, `jarvis_refresh=${result.refresh_token}; Path=/api/v2/auth; HttpOnly; SameSite=Strict; Max-Age=2592000${req.protocol === "https" ? "; Secure" : ""}`]);
      return result;
    }
    catch { return reply.code(401).send({ error: "invalid_session" }); }
  });
  app.post("/api/v2/auth/invites", async (req, reply) => {
    const identity = await userIdentity(req); if (!identity || identity.role !== "admin") return reply.code(403).send({ error: "admin_required" });
    try { return await createInvite(db, identity.user_id, req.body); } catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : "invite_failed" }); }
  });
  app.post("/api/v2/auth/invites/accept", async (req, reply) => {
    try { return await acceptInvite(db, req.body); } catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : "invite_invalid" }); }
  });
  app.get("/api/v2/auth/me", async (req, reply) => {
    const identity = await userIdentity(req); if (!identity) return reply.code(401).send({ error: "unauthorized" });
    return { user: { id: identity.user_id, username: identity.username, role: identity.role }, session_id: identity.session_id, device_id: identity.device_id, sessions: await listUserSessions(db, identity.user_id) };
  });
  app.get("/api/v2/auth/sessions", async (req, reply) => {
    const identity = await userIdentity(req); if (!identity) return reply.code(401).send({ error: "unauthorized" }); return listUserSessions(db, identity.user_id);
  });
  app.post("/api/v2/auth/logout", async (req, reply) => {
    const identity = await userIdentity(req);
    if (identity) {
      await revokeUserSession(db, identity.user_id, identity.session_id);
      for (const [ws, state] of sockets) if (state.sessionId === identity.session_id) ws.close(4001, "session_revoked");
    }
    reply.header("Set-Cookie", ["jarvis_access=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict", "jarvis_refresh=; Path=/api/v2/auth; Max-Age=0; HttpOnly; SameSite=Strict"]); return { logged_out: true };
  });
  app.delete<{ Params: { id: string } }>("/api/v2/auth/sessions/:id", async (req, reply) => {
    const identity = await userIdentity(req); if (!identity) return reply.code(401).send({ error: "unauthorized" });
    try {
      const sessionId = z.uuid().parse(req.params.id);
      const result = await revokeUserSession(db, identity.user_id, sessionId);
      for (const [ws, state] of sockets) if (state.sessionId === sessionId) ws.close(4001, "session_revoked");
      return result;
    } catch { return reply.code(404).send({ error: "not_found" }); }
  });
  app.post("/internal/ops/read", async (req, reply) => {
    const expected = Buffer.from("Bearer " + (process.env.OPS_TOKEN ?? "")),
      actual = Buffer.from(req.headers.authorization ?? "");
    if (
      !process.env.OPS_TOKEN ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
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
    return m2.readForAgent(p.tool, p.args);
  });
  await app.register(websocket, { options: { maxPayload: 65536 } });
  await app.register(async (api) => {
    // Routes in this encapsulated plugin need their own handler: the
    // websocket plugin captures the child error boundary before the root
    // handler is installed, otherwise ordinary HTTP RPC errors become 500s.
    api.setErrorHandler((error, _req, reply) => {
      if (error instanceof Error && /^(id_reused|invalid_parent|delegation_depth|invalid_run_state)/.test(error.message))
        return reply.code(409).send({ error: error.message });
      if (error instanceof Error && error.message === "not_found")
        return reply.code(404).send({ error: error.message });
      if (error instanceof Error && error.message === "approval_cannot_elevate_permissions")
        return reply.code(403).send({ error: error.message });
      if (error instanceof Error && error.message === "user_login_required")
        return reply.code(401).send({ error: error.message });
      if (error instanceof Error && /^(integration_credentials_key_)/.test(error.message))
        return reply.code(503).send({ error: error.message });
      if (error instanceof z.ZodError)
        return reply.code(400).send({ error: "validation_error", issues: error.issues });
      if (error instanceof Error && /^(custom_range_requires_from_to|invalid_time_range|invalid_usage|artifact_unsafe_source|artifact_network_forbidden|artifact_too_large)$/.test(error.message))
        return reply.code(400).send({ error: error.message });
      if (error instanceof Error && error.message === "agent_not_owned")
        return reply.code(403).send({ error: error.message });
      if (error instanceof Error && error.message === "approval_required")
        return reply.code(403).send({ error: error.message });
      if (error instanceof Error && error.message === "path_outside_allowed_root")
        return reply.code(400).send({ error: error.message });
      if (error instanceof Error && error.message === "node_not_found")
        return reply.code(404).send({ error: error.message });
      if (error instanceof Error && error.message === "node_capability_unavailable")
        return reply.code(403).send({ error: error.message });
      if (error instanceof Error && error.message === "node_bridge_unavailable")
        return reply.code(503).send({ error: error.message });
      if ((error as any).statusCode === 413)
        return reply.code(413).send({ error: "payload_too_large" });
      app.log.error({ err: error }, "request_failed");
      return reply.code(500).send({ error: "request_failed" });
    });
    api.addHook("preValidation", async (req, reply) => {
      let identity: { id: string; role: "agent" | "device"; session_id?: string } | undefined = (await authenticate(db, req.headers.authorization)) ?? undefined;
      if (!identity) {
        const access = cookieValue(req, "jarvis_access");
        const userIdentity = await authenticateUserAccess(db, access ? `Bearer ${access}` : req.headers.authorization);
        if (userIdentity) identity = { id: userIdentity.device_id ?? `user-${userIdentity.user_id}`, role: "device", session_id: userIdentity.session_id };
      }
      if (!identity) {
        const token = cookieValue(req, "jarvis_session");
        if (token)
          identity = (
            await db.query(
              "SELECT d.id,d.role FROM web_sessions s JOIN devices d ON d.id=s.device_id WHERE s.token_hash=$1 AND s.expires_at>now()",
              [hash(token)],
            )
          ).rows[0];
        // Sliding renewal keeps an actively used browser session alive across
        // server restarts without issuing an immortal access credential.
        if (identity && token)
          await db.query("UPDATE web_sessions SET expires_at=now()+interval '30 days' WHERE token_hash=$1", [hash(token)]);
        if (
          identity &&
          ((req.url === "/ws" && !validOrigin(req)) ||
            (req.method !== "GET" && !validOrigin(req)))
        )
          return reply.code(403).send({ error: "origin_forbidden" });
      }
      if (!identity) return reply.code(401).send({ error: "unauthorized" });
      if (
        identity.role === "agent" &&
        req.method === "GET" &&
        req.url !== "/ws"
      )
        return reply.code(403).send({ error: "device_required" });
      (req as any).identity = identity;
    });
    api.post<{ Params: { topic: string } }>(
      "/api/v2/:topic",
      async (req, reply) => {
        const identity = (req as any).identity;
        if (
          identity.role !== "device" ||
          !(m2Topics as readonly string[]).includes(req.params.topic)
        )
          return reply.code(403).send({ error: "forbidden" });
        return m2.handle(req.params.topic, req.body ?? {}, identity.id);
      },
    );
    api.get("/api/v2/session", async (req, reply) => {
      if ((req as any).identity.role !== "device")
        return reply.code(403).send({ error: "device_required" });
      return { authenticated: true };
    });
    api.get<{ Params: { id: string } }>("/api/media/:id/thumbnail", async (req, reply) => {
      reply.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff");
      const identity = (req as any).identity;
      if (identity.role !== "device") return reply.code(403).send({ error: "device_required" });
      const item = /^[a-zA-Z0-9_-]{1,100}$/.test(req.params.id) ? media.read(req.params.id, identity.id) : undefined;
      if (!item) return reply.code(404).send({ error: "media_not_found" });
      return reply.type(item.contentType).send(item.data);
    });
    api.get("/api/v1/system/status", systemStatus);
    api.get("/api/v1/agents", (req) => agents.list((req as any).identity.role === "device" ? (req as any).identity.id : undefined));
    api.get<{ Params: { agentId: string } }>(
      "/api/v1/agents/:agentId",
      async (req, reply) => {
        const a = await agents.get(req.params.agentId, (req as any).identity.role === "device" ? (req as any).identity.id : undefined);
        return a ?? reply.code(404).send({ error: "not_found" });
      },
    );
    api.get<{ Params: { agentId: string } }>(
      "/api/v1/agents/:agentId/events",
      (req) => agents.events(req.params.agentId, (req as any).identity.role === "device" ? (req as any).identity.id : undefined),
    );
    api.get("/api/v1/llm/usage", (req) => usage.summary(req.query, (req as any).identity.role === "device" ? (req as any).identity.id : undefined));
    api.post("/api/v1/llm/requests", async (req, reply) => {
      const identity = (req as any).identity;
      if (identity.role !== "agent")
        return reply.code(403).send({ error: "agent_required" });
      return usage.record(req.body, identity.id);
    });
    api.get("/ws", { websocket: true }, (ws, req) => {
      const identity = (req as any).identity;
      const state = {
        topics: new Set(
          identity.role === "agent"
            ? []
            : [
                "network.public_ipv6.changed",
                "agent.status.changed",
                "llm.usage.changed",
                ...(identity.role === "device" ? m2Events : []),
              ],
        ),
        alive: true,
        sessionId: (identity as any).session_id as string | undefined,
      };
      sockets.set(ws, state);
      ws.on("pong", () => {
        state.alive = true;
      });
      ws.on("close", () => {
        sockets.delete(ws);
        for (const [nodeId, candidate] of nodeSockets) if (candidate === ws) nodeSockets.delete(nodeId);
        for (const [requestId, pending] of nodePending) {
          pending.reject(Error("node_bridge_disconnected"));
          clearTimeout(pending.timer);
          nodePending.delete(requestId);
        }
      });
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
              if ((m.type === "response" || m.type === "error") && m.reply_to) {
                const pending = nodePending.get(m.reply_to);
                if (pending) {
                  clearTimeout(pending.timer);
                  nodePending.delete(m.reply_to);
                  if (m.type === "error") pending.reject(Error(String(m.payload.error ?? "node_invoke_failed")));
                  else pending.resolve(m.payload);
                  return;
                }
              }
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
              if (!permitted(identity.role, topic))
                throw new Error("agent_operation_forbidden");
              switch (topic) {
                case "gateway.ping":
                  result = { pong: true };
                  break;
                case "gateway.subscribe": {
                  const topics = z
                    .array(
                      z.enum([
                        ...m2Events,
                        "system.status.changed",
                        "network.public_ipv6.changed",
                        "agent.status.changed",
                        "llm.usage.changed",
                        "llm.request.completed",
                      ]),
                    )
                    .max(32)
                    .parse(p.topics);
                  if (identity.role === "agent" && topics.length)
                    throw Error("agent_operation_forbidden");
                  state.topics = new Set(topics);
                  result = { topics };
                  break;
                }
                case "system.status.get":
                  result = await systemStatus();
                  break;
                case "agent.list":
                  result = await agents.list(identity.role === "device" ? identity.id : undefined);
                  break;
                case "agent.get":
                  result = await agents.get(z.string().parse(p.agent_id), identity.role === "device" ? identity.id : undefined);
                  if (!result) throw new Error("not_found");
                  break;
                case "agent.register":
                  result = await agents.register(p, identity.id);
                  nodeSockets.set(String(p.agent_id), ws);
                  break;
                case "agent.heartbeat":
                case "agent.task.started":
                case "agent.task.finished":
                case "agent.error":
                  result = await agents.heartbeat(p, identity.id, topic);
                  break;
                case "llm.usage.summary":
                  result = await usage.summary(p, identity.role === "device" ? identity.id : undefined);
                  break;
                case "llm.request.completed":
                  if (identity.role !== "agent")
                    throw new Error("agent_required");
                  result = await usage.record(p, identity.id);
                  break;
                default:
                  result = await m2.handle(topic, p, identity.id);
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
                                /^(agent_|unknown_topic|invalid_|id_reused|not_found|custom_|integration_|user_login_required)/.test(
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
    if (
      error instanceof Error &&
      /^(id_reused|invalid_parent|delegation_depth|invalid_run_state)/.test(
        error.message,
      )
    )
      return reply.code(409).send({ error: error.message });
    if (error instanceof Error && error.message === "not_found")
      return reply.code(404).send({ error: error.message });
    if (
      error instanceof Error &&
      error.message === "approval_cannot_elevate_permissions"
    )
      return reply.code(403).send({ error: error.message });
    if (error instanceof Error && error.message === "user_login_required")
      return reply.code(401).send({ error: error.message });
    if (error instanceof Error && /^(integration_credentials_key_)/.test(error.message))
      return reply.code(503).send({ error: error.message });
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: "validation_error", issues: error.issues });
    if (
      error instanceof Error &&
      /^(custom_range_requires_from_to|invalid_time_range|invalid_usage|artifact_unsafe_source|artifact_network_forbidden|artifact_too_large)$/.test(
        error.message,
      )
    )
      return reply.code(400).send({ error: error.message });
    if (error instanceof Error && error.message === "agent_not_owned")
      return reply.code(403).send({ error: error.message });
    if (error instanceof Error && error.message === "approval_required")
      return reply.code(403).send({ error: error.message });
    if (error instanceof Error && error.message === "path_outside_allowed_root")
      return reply.code(400).send({ error: error.message });
    if (error instanceof Error && error.message === "node_not_found")
      return reply.code(404).send({ error: error.message });
    if (error instanceof Error && error.message === "node_capability_unavailable")
      return reply.code(403).send({ error: error.message });
    if (error instanceof Error && error.message === "node_bridge_unavailable")
      return reply.code(503).send({ error: error.message });
    if ((error as any).statusCode === 413)
      return reply.code(413).send({ error: "payload_too_large" });
    app.log.error({ err: error }, "request_failed");
    return reply.code(500).send({ error: "request_failed" });
  });
  app.addHook("onClose", async () => {
    media.clear();
    clearInterval(timer);
    clearInterval(heartbeat);
    for (const ws of sockets.keys()) ws.terminate();
    while (busy) await new Promise((r) => setTimeout(r, 10));
    await m2.close();
    await db.end();
  });
  return { app, db, monitor, agents, usage, m2, media };
}
