import { eventAudience } from "./event-audience.js";
import { M2, m2Topics, m2Events } from "./m2.js";
import { permitted } from "./permissions.js";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { RuntimeRegistry } from "../../../packages/agent-runtime/src/index.js";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket, { type RawData } from "ws";
import { z } from "zod";
import { database, migrate } from "./persistence.js";
import { authenticate } from "./auth.js";
import { registerFirstUser, registrationStatus, loginUser, refreshUserSession, authenticateUserAccess, listUserSessions, listUsers, updateUserRole, revokeUserSession, revokeUserSessionByRefresh, createInvite, acceptInvite } from "./identity.js";
import { MediaStore } from "./media.js";
import { MediaResources } from "./media-resources.js";
import { ConversationResults } from "../../../packages/conversation/src/results.js";
import { viewSpecSchema, componentTypes, decideViewHost } from "../../../packages/ui-protocol-v2/src/index.js";
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
import { contextAllows, verifyHermesContextToken } from "../../../packages/hermes-bridge/src/index.js";
import { householdIdForOwner } from "./households.js";
import { casaosLogin, casaosAccount } from "./applications.js";
import { completeOidcLogin, oidcAuthorizationUrl, oidcConfigured } from "./oidc.js";
import { canUseMcpTool, setUserCapability, userCapabilities } from "./mcp-access.js";
import { readPackageVersion, toErrorResponse } from "../../../packages/core/src/index.js";
import { registerSecurityHeaders } from "./http/security.js";
import { IntegrationRegistry } from "../../../packages/integrations/src/index.js";
import { LeaseStore } from "../../../packages/leases/src/index.js";
import { LoginGuard, clientAddress, loginIdentity } from "./security/login-guard.js";
const SERVER_VERSION = readPackageVersion(import.meta.url);
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
  await app.register(websocket, { options: { maxPayload: 65536 } });
  registerSecurityHeaders(app);
  const migration = await migrate(db, {
    info: (value, message) => app.log.info(value, message),
    warn: (value, message) => app.log.warn(value, message),
  });
  for (const version of migration.drifted)
    app.log.warn({ version }, "schema_migration_checksum_drift");
  const media = new MediaStore();
  const mediaResources = new MediaResources(db);
  const mediaFileRoot = resolve(process.env.HERMES_MEDIA_ROOT?.trim() || process.env.HERMES_DATA_ROOT?.trim() || resolve(options.hostRoot || "/", "opt/data"));
  const readPublishedMediaFile = async (requestPath: unknown) => {
    if (typeof requestPath !== "string") return undefined;
    const match = /^\/opt\/data\/(?:media\/tmp\/)?([A-Za-z0-9._-]+\.(?:png|jpe?g|webp))$/i.exec(requestPath);
    if (!match) return undefined;
    const filePath = resolve(mediaFileRoot, "tmp", match[1]);
    if (!filePath.startsWith(`${mediaFileRoot}${sep}`)) return undefined;
    const contentType = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" } as Record<string, string>)[extname(filePath).toLowerCase()];
    if (!contentType) return undefined;
    try {
      const metadata = await stat(filePath);
      if (!metadata.isFile() || metadata.size > 16 * 1024 * 1024) return undefined;
      return { data: await readFile(filePath), contentType };
    } catch {
      return undefined;
    }
  };
  const monitor = new SystemMonitor(options.hostRoot, options.networkInterface);
  const sockets = new Map<WebSocket, { topics: Set<string>; alive: boolean; sessionId?: string; device: string; user?: string; events: Promise<void> }>();
  const nodeSockets = new Map<string, WebSocket>();
  const nodePending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; node: WebSocket }>();
  const invokeNode = async (owner: string, nodeId: string, capability: string, input: Record<string, unknown>) => {
    const user = await ownerUserId(db, owner);
    const record = await db.query("SELECT 1 FROM agents a WHERE a.id=$1 AND a.status IS DISTINCT FROM 'offline' AND (a.owner_device_id=$2 OR a.owner_user_id=$3)", [nodeId, owner, user ?? null]);
    if (!record.rowCount) throw Error("node_not_found");
    const ws = nodeSockets.get(nodeId);
    if (!ws || ws.readyState !== 1) throw Error("node_bridge_unavailable");
    const id = randomBytes(16).toString("hex");
    const request = { id, version: 1, type: "request", topic: "node.invoke", timestamp: new Date().toISOString(), payload: { capability, input } };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { nodePending.delete(id); reject(Error("node_invoke_timeout")); }, 120000);
      nodePending.set(id, { resolve, reject, timer, node: ws });
      ws.send(JSON.stringify(request), (error) => {
        if (error) { clearTimeout(timer); nodePending.delete(id); reject(error); }
      });
    });
  };
  let sequence = 0;
  const push = (topic: string, payload: unknown) => {
    const event = { ...message("event", topic, payload), sequence: ++sequence };
    const audience = eventAudience(db, topic, payload);
    for (const [ws, s] of sockets) {
      if (!s.topics.has(topic)) continue;
      s.events = s.events.then(async () => {
        const target = await audience;
        if (!target.shared && target.device !== s.device && !(s.user && target.user === s.user)) return;
        if (ws.readyState !== 1) return;
        if (ws.bufferedAmount > 1024 * 1024) { ws.close(1013, "slow_consumer"); return; }
        ws.send(JSON.stringify(event));
      }).catch(() => app.log.warn({ topic }, "event_delivery_failed"));
    }
    void audience.catch(() => {});
  };
  const agents = new AgentRegistry(
      db,
      push,
      options.degradedSeconds,
      options.offlineSeconds,
    ),
    usage = new UsageCollector(db, options.prices ?? {}, push);
  const integrations = await IntegrationRegistry.create({
    dir: process.env.INTEGRATIONS_DIR?.trim() || undefined,
  });
  app.log.info({ integrations: integrations.ids() }, "integrations_loaded");
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
    integrations,
  );
  /**
   * Resolve a provider secret for one owner. Stored household credentials win
   * over the process environment so a member can connect their own account
   * without editing deployment files.
   */
  const resolveProviderSecret = async (manifest: import("../../../packages/integrations/src/index.js").CompiledManifest, owner: string) => {
    if (process.env.INTEGRATION_CREDENTIAL_KEY) {
      const stored = await m2.integrationCredentials
        .readProviderSecret(owner, IntegrationRegistry.storeProvider(manifest))
        .catch(() => undefined);
      if (stored) return { secret: stored, source: "store" as const };
    }
    const envName = IntegrationRegistry.credentialEnv(manifest);
    const value = envName ? process.env[envName]?.trim() : undefined;
    return value ? { secret: value, source: "env" as const } : undefined;
  };
  const hermesBridgeKey = process.env.HERMES_BRIDGE_KEY?.trim() ?? "";
  const hermesCapabilityInput = z.object({
    tool: z.string().min(1).max(100),
    context_token: z.string().min(20).max(2000),
    arguments: z.record(z.string(), z.unknown()).default({}),
  }).strict();
  app.post("/internal/hermes/capability", async (req, reply) => {
    if (!hermesBridgeKey || req.headers["x-jarvis-bridge-key"] !== hermesBridgeKey)
      return reply.code(401).send({ error: "hermes_bridge_unauthorized" });
    let toolEvent: { conversation_id: string; tool_call_id: string; capability: string } | undefined;
    let turnId: string | undefined;
    let contextOwner: string | undefined;
    try {
      const input = hermesCapabilityInput.parse(req.body);
      const context = verifyHermesContextToken(hermesBridgeKey, input.context_token);
      if (!context) return reply.code(401).send({ error: "hermes_context_invalid" });
      contextOwner = context.owner;
      const args = input.arguments;
      const requestedProvider = input.tool === "mcp_authorize" && typeof input.arguments.provider === "string"
        ? input.arguments.provider : undefined;
      const mcpManifest = requestedProvider ? integrations.get(requestedProvider) : undefined;
      if (requestedProvider && !mcpManifest) throw Error("mcp_provider_unknown");
      const mcpToolName = mcpManifest && typeof args.tool_name === "string" ? args.tool_name : "";
      const mcpListing = Boolean(mcpManifest && mcpToolName === "__tools_list__");
      // Classify from the manifest instead of trusting the caller's read_only flag.
      // An unclassified tool is a write, so new upstream tools fail closed.
      const classification = mcpManifest && mcpToolName && !mcpListing
        ? integrations.authorizeTool(mcpManifest.id, mcpToolName)
        : undefined;
      if (classification?.denied) return reply.code(403).send({ error: "mcp_capability_forbidden" });
      const effectiveReadOnly = mcpListing
        || (classification ? classification.level === "read" : input.arguments.read_only === true);
      const requiredScope = mcpManifest
        ? (mcpListing ? mcpManifest.readScope : (effectiveReadOnly ? mcpManifest.readScope : mcpManifest.writeScope))
        : input.tool === "task_create" || input.tool === "schedule_create" || input.tool === "conversation_question_create" ? "conversation.write"
        : input.tool === "ui_view_show" ? "conversation.write"
          : input.tool.startsWith("system_") || input.tool === "agent_list" || input.tool === "agent_run_status" ? "system.read"
            : input.tool.startsWith("schedule_") ? "schedule.write" : undefined;
      if (requiredScope && !contextAllows(context, requiredScope)) return reply.code(403).send({ error: "hermes_scope_forbidden" });
      const toolCallId = `mcp-${randomBytes(12).toString("hex")}`;
      const actorUser = z.uuid().safeParse(context.actor).success
        ? (await db.query("SELECT id FROM users WHERE id=$1", [context.actor])).rows[0]?.id as string | undefined
        : undefined;
      // The signed actor is the member Jarvis is speaking with.  The physical
      // owner/device remains a compatibility fallback for older sessions.
      const contextUser = actorUser ?? await ownerUserId(db, context.owner);
      const contextHousehold = await householdIdForOwner(db, context.owner);
      if (context.household !== "default-household" && contextHousehold && context.household !== contextHousehold) return reply.code(403).send({ error: "hermes_household_forbidden" });
      const conversationId = z.uuid().safeParse(context.session).success && (await db.query(
        "SELECT 1 FROM conversations WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3)",
        [context.session, context.owner, contextUser ?? null])).rowCount ? context.session : undefined;
      if (conversationId) {
        toolEvent = { conversation_id: conversationId, tool_call_id: toolCallId, capability: input.tool };
        turnId = (await db.query("SELECT turn_id FROM conversation_messages WHERE conversation_id=$1 AND role='jarvis' AND status='streaming' ORDER BY sequence DESC LIMIT 1", [conversationId])).rows[0]?.turn_id;
        if (turnId) await m2.conversations.recordActivity(context.owner, turnId, "started", { tool_call_id: toolCallId, capability: input.tool, input: args });
      }
      if (conversationId) push("conversation.tool.started", {
        conversation_id: conversationId,
        tool_call_id: toolCallId,
        capability: input.tool,
      });
      let result: unknown;
      switch (input.tool) {
        case "mcp_authorize": {
          if (!mcpManifest || typeof args.tool_name !== "string" || !args.tool_name) throw Error("mcp_tool_invalid");
          if (!contextUser || !contextHousehold) throw Error("user_login_required");
          if (!(await canUseMcpTool(db, contextUser, contextHousehold, mcpManifest.id, effectiveReadOnly, integrations.defaultMemberCapabilities())))
            throw Error("mcp_capability_forbidden");
          const resolved = await resolveProviderSecret(mcpManifest, context.owner);
          if (!resolved) throw Error("mcp_provider_not_configured");
          const connection = IntegrationRegistry.connection(mcpManifest, resolved.secret);
          // The descriptor is uniform for every provider: transport + policy +
          // optional media fetch. Legacy fields stay so an older provider image
          // keeps working during rollout.
          // The provider authorizes a listing before it knows which tool the
          // model picked, so the media descriptor travels with every response and
          // the provider applies it only when `media.tool` matches.
          const media = IntegrationRegistry.media(mcpManifest, resolved.secret);
          const launchBase = mcpManifest.app.launch_env ? process.env[mcpManifest.app.launch_env]?.replace(/\/$/, "") : undefined;
          result = {
            provider: mcpManifest.id,
            transport: connection,
            ...(media ? { media } : {}),
            read_scope: mcpManifest.readScope,
            write_scope: mcpManifest.writeScope,
            credential_source: resolved.source,
            ...(connection.type === "streamable-http" ? { endpoint: connection.endpoint } : {}),
            ...(launchBase ? { base_url: launchBase } : {}),
            token: resolved.secret,
          };
          break;
        }
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
        // Legacy direct fetchers were removed: every provider goes through
        // mcp_authorize so that scope, classification and credentials have one path.
        case "schedule_create":
          if (!conversationId) throw Error("conversation_required");
          if (typeof args.next_run_at !== "string" || !Number.isFinite(Date.parse(args.next_run_at)) || Date.parse(args.next_run_at) <= Date.now()) {
            throw Error("schedule_time_required: 请先通过 conversation_question_create 确认用户希望的执行时间和时区，再提供未来的 ISO 8601 next_run_at；任务尚未创建。");
          }
          result = await m2.control.createSchedule(context.owner, { ...args, conversation_id: conversationId });
          break;
        case "conversation_question_create":
          if (!turnId) throw Error("conversation_required");
          result = await m2.conversations.createQuestion(context.owner, { ...args, turn_id: turnId });
          break;
        case "agent_run_status":
          result = await m2.readForAgent("agent.run.read", args, context.owner);
          break;
        case "task_create": {
          if (!conversationId) throw Error("conversation_required");
          const task = await m2.handle("task.create", { ...args, conversation_id: conversationId }, context.owner) as any;
          result = { ...task, task_id: task.id, run_id: task.id };
          await db.query("UPDATE conversation_messages SET run_id=$2 WHERE id=(SELECT id FROM conversation_messages WHERE conversation_id=$1 AND role='jarvis' AND status='streaming' ORDER BY sequence DESC LIMIT 1)", [conversationId, task.id]);
          break;
        }
        case "task_cancel":
          result = await m2.handle("task.cancel", args, context.owner);
          break;
        case "ui_view_show":
          {
            if (!turnId) throw Error("conversation_required");
            const params = z.object({ intent: z.string().min(1).max(120), resources: z.array(z.string()).max(60).default([]), target: z.enum(["inline", "workspace"]).optional(), view: viewSpecSchema.optional() }).strict().parse(args);
            const title = params.view?.title ?? (params.intent === "usage_analysis" ? "今日 Token 使用分析" : "分析结果");
            const results = new ConversationResults(db, m2.workspaces, push);
            let spec = params.view;
            if (!spec) {
              const generated = await m2.handle("view.v2.get", { intent: { type: "view.show", intent: params.intent, resources: params.resources }, renderer: { platform: "web", supports: { min: "2.0", max: "2.0" }, components: componentTypes.map((name) => `${name}@2`), features: ["charts", "gallery", "actions"] } }, context.owner) as any;
              spec = viewSpecSchema.parse(generated.view);
            }
            // The host is decided from the result's shape, not by the model.
            // A gallery stays inline; a multi-chart analysis opens the workspace.
            const host = decideViewHost(spec, params.target);
            const pending = await results.begin(context.owner, turnId, params.intent, title, host.target);
            if (host.reason !== "caller_preference" && params.target && params.target !== host.target) {
              app.log.info({ intent: params.intent, requested: params.target, target: host.target, reason: host.reason }, "result_host_overridden");
            }
            try {
              // Resolve every named source under this user before publishing it.
              for (const source of new Set(spec.sections.flatMap((section) => section.source ? [section.source] : []))) await m2.resource(source, context.owner);
              result = await results.complete(context.owner, pending, spec);
            } catch (error) { await results.fail(pending); throw error; }
            break;
          }
        default:
          throw Error("hermes_capability_not_allowed");
      }
      if (conversationId) push("conversation.tool.completed", {
        conversation_id: conversationId,
        tool_call_id: toolCallId,
        capability: input.tool,
      });
      const activityResult = input.tool === "mcp_authorize" ? { provider: args.provider, tool_name: args.tool_name, authorized: true } : result;
      if (turnId && contextOwner) await m2.conversations.recordActivity(contextOwner, turnId, "completed", { tool_call_id: toolCallId, capability: input.tool, result: activityResult });
      return result;
    } catch (error) {
      if (toolEvent) push("conversation.tool.failed", { ...toolEvent, error: error instanceof z.ZodError ? "validation_error" : error instanceof Error ? error.message : "tool_failed" });
      if (turnId && toolEvent && contextOwner) await m2.conversations.recordActivity(contextOwner, turnId, "failed", { tool_call_id: toolEvent.tool_call_id, capability: toolEvent.capability, error: error instanceof Error ? error.message : "tool_failed" });
      // The MCP provider receives the HTTP error body and Hermes can report it
      // as a failed capability call without exposing bridge credentials. The
      // status comes from the shared error contract: an unknown tool code is a
      // bug (500/`request_failed`), a known one keeps its documented status.
      const mapped = toErrorResponse(error);
      return reply.code(mapped.status).send(mapped.body);
    }
  });
  app.post<{ Body: { context_token?: string; content_type?: string; source?: string; data?: string } }>("/internal/hermes/media", { bodyLimit: 3 * 1024 * 1024 }, async (req, reply) => {
    if (!hermesBridgeKey || req.headers["x-jarvis-bridge-key"] !== hermesBridgeKey) return reply.code(401).send({ error: "hermes_bridge_unauthorized" });
    const input = z.object({ context_token: z.string().min(20).max(2000), content_type: z.enum(["image/png", "image/jpeg", "image/webp"]), source: z.enum(["homeassistant", "immich", "hermes"]).default("hermes"), data: z.string().min(1).max(2_800_000) }).strict().safeParse(req.body);
    if (!input.success) return reply.code(400).send({ error: "media_validation_error" });
    const context = verifyHermesContextToken(hermesBridgeKey, input.data.context_token);
    if (!context) return reply.code(401).send({ error: "hermes_context_invalid" });
    let data: Buffer;
    try { data = Buffer.from(input.data.data, "base64"); } catch { return reply.code(400).send({ error: "media_invalid_base64" }); }
    try {
      return await mediaResources.publish(context.owner, context.session, { data, contentType: input.data.content_type, source: input.data.source });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "media_invalid" });
    }
  });
  await m2.start();
  /**
   * The housekeeping tick (metrics, agent sweep, retention, schedules) must run on
   * exactly one process. It used to rely on "only one process exists"; it now takes
   * a lease and renews it on every tick, so a restarted or additional instance can
   * take over after the TTL instead of duplicating schedule firing.
   */
  const housekeeping = new LeaseStore(db);
  const schedulerOwner = `server-${randomBytes(8).toString("hex")}`;
  let holdsScheduler = (await housekeeping.acquire("server:housekeeping", schedulerOwner, 30)).acquired;
  app.log.info({ owner: schedulerOwner, holdsScheduler }, "housekeeping_lease_acquired");
  let lastMetric = 0;
  let schedulerAt = Date.now(),
    busy = false,
    lastPrune = 0;
  await monitor.sample();
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      if (holdsScheduler) {
        holdsScheduler = await housekeeping.renew("server:housekeeping", schedulerOwner, 30);
      } else {
        holdsScheduler = (await housekeeping.acquire("server:housekeeping", schedulerOwner, 30)).acquired;
      }
      if (!holdsScheduler) {
        schedulerAt = Date.now();
        return;
      }
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
    let schema = { applied: 0, latest: "none" };
    try {
      // One round trip: liveness plus the schema version, so a deployment can be
      // verified from /health/ready instead of container logs.
      const probe = (
        await db.query(
          "SELECT (SELECT count(*) FROM schema_migrations)::int AS applied, (SELECT max(version) FROM schema_migrations) AS latest",
        )
      ).rows[0];
      schema = { applied: Number(probe?.applied ?? 0), latest: String(probe?.latest ?? "none") };
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
      schema,
      integrations: integrations.ids(),
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
  for (const path of ["/", "/login", "/home", "/spaces", "/apps", "/apps/:id", "/tasks", "/tasks/:id", "/jarvis", "/system", "/agents", "/users", "/settings", "/integrations", "/workspace"]) app.get(path, async (_req, reply) => {
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
      // Hermes' Vite chat bundle currently emits a few lazy-loaded assets as
      // root-relative /assets/... URLs. The Dashboard itself is mounted under
      // /hermes-dashboard, so serve those missing names from Hermes after the
      // Jarvis asset lookup fails.
      if (hermesDashboardUrl) {
        const upstream = await fetch(new URL(`/assets/${name}`, hermesDashboardUrl), { signal: AbortSignal.timeout(15000) }).catch(() => undefined);
        if (upstream?.ok) {
          return reply
            .header("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream")
            .header("Cache-Control", "no-store")
            .send(Buffer.from(await upstream.arrayBuffer()));
        }
      }
      return reply.code(404).send();
    }
  });
  app.get<{ Params: { "*": string } }>("/fonts-terminal/*", async (req, reply) => {
    const name = req.params["*"];
    if (!/^[-a-zA-Z0-9_.]+\.woff2$/.test(name) || !hermesDashboardUrl) return reply.code(404).send();
    const upstream = await fetch(new URL(`/fonts-terminal/${name}`, hermesDashboardUrl), { signal: AbortSignal.timeout(15000) }).catch(() => undefined);
    if (!upstream?.ok) return reply.code(404).send();
    return reply
      .header("Content-Type", upstream.headers.get("content-type") ?? "font/woff2")
      .header("Cache-Control", "no-store")
      .send(Buffer.from(await upstream.arrayBuffer()));
  });
  app.get<{ Params: { name: string } }>("/artwork/:name", async (req, reply) => {
    const name = req.params.name;
    if (!/^(alpine-dusk|files|knowledge|family|media|development)-v1\.png$/.test(name)) return reply.code(404).send();
    try {
      return reply.type("image/png").header("Cache-Control", "public, max-age=86400")
        .send(await readFile(resolve("apps/web/dist/artwork", name)));
    } catch { return reply.code(404).send(); }
  });
  const appIconNames = new Set([
    "homeassistant.svg", "immich.svg",
    "homeassistant-glyph.svg", "immich-glyph.svg", "jellyfin-glyph.svg", "qbittorrent-glyph.svg",
    "mosquitto-glyph.svg", "authentik-glyph.svg", "jarvis-glyph.svg", "frame-glyph.svg",
  ]);
  app.get<{ Params: { name: string } }>("/app-icons/:name", async (req, reply) => {
    if (!appIconNames.has(req.params.name)) return reply.code(404).send();
    try {
      return reply.type("image/svg+xml").header("Content-Security-Policy", "default-src 'none'; sandbox")
        .header("X-Content-Type-Options", "nosniff").header("Cache-Control", "public, max-age=86400")
        .send(await readFile(resolve("apps/web/dist/app-icons", req.params.name)));
    } catch { return reply.code(404).send(); }
  });
  // Brute-force protection for the only password-accepting endpoint.
  const loginGuard = new LoginGuard();
  const trustProxy = process.env.TRUST_PROXY === "1";
  const cookieValue = (req: any, name: string) => {
    const prefix = `${name}=`;
    return req.headers.cookie?.split(";").map((v: string) => v.trim()).find((v: string) => v.startsWith(prefix))?.slice(prefix.length);
  };
  const userIdentity = async (req: any) => {
    const value = cookieValue(req, "jarvis_access");
    const bearer = req.headers.authorization ?? (value ? `Bearer ${value}` : undefined);
    return authenticateUserAccess(db, bearer);
  };
  const hermesUserIdentity = async (req: any, reply: any) => {
    const current = await userIdentity(req);
    if (current) return current;
    const refresh = cookieValue(req, "jarvis_refresh");
    if (!refresh) return undefined;
    try {
      const result = await refreshUserSession(db, refresh);
      const secure = req.protocol === "https" ? "; Secure" : "";
      reply.header("Set-Cookie", [
        `jarvis_access=${result.access_token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900${secure}`,
        `jarvis_refresh=${result.refresh_token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure}`,
      ]);
      return authenticateUserAccess(db, `Bearer ${result.access_token}`);
    } catch {
      return undefined;
    }
  };
  const hermesDashboardUrl = process.env.HERMES_DASHBOARD_URL ?? "";
  let hermesDashboardCookie = "";
  let hermesDashboardLogin: Promise<string> | undefined;
  const mergeHermesDashboardCookies = (response: Response) => {
    const values = response.headers.getSetCookie?.() ?? [];
    if (!values.length) return;
    const cookies = new Map<string, string>();
    for (const value of hermesDashboardCookie.split(";")) {
      const separator = value.indexOf("=");
      if (separator > 0) cookies.set(value.slice(0, separator).trim(), value.slice(separator + 1).trim());
    }
    for (const value of values) {
      const separator = value.indexOf(";");
      const pair = (separator === -1 ? value : value.slice(0, separator)).trim();
      const equals = pair.indexOf("=");
      if (equals > 0) cookies.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim());
    }
    hermesDashboardCookie = [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  };
  const ensureHermesDashboardCookie = async (force = false) => {
    if (force) hermesDashboardCookie = "";
    if (hermesDashboardCookie) {
      // A frontend page can still return HTML with status 200 when logged out.
      // Check the protected identity endpoint so an expired cached cookie is
      // renewed before the Dashboard starts returning a stream of 401s.
      const check = await fetch(new URL("/api/auth/me", hermesDashboardUrl), { headers: { Cookie: hermesDashboardCookie }, redirect: "manual", signal: AbortSignal.timeout(10000) }).catch(() => undefined);
      if (check?.ok) return hermesDashboardCookie;
      hermesDashboardCookie = "";
    }
    if (!hermesDashboardLogin) hermesDashboardLogin = (async () => {
      const response = await fetch(new URL("/auth/password-login", hermesDashboardUrl), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "basic", username: process.env.HERMES_DASHBOARD_PROXY_USERNAME, password: process.env.HERMES_DASHBOARD_PROXY_PASSWORD, next: "/" }),
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      if (response.status < 200 || response.status >= 400) throw Error("hermes_dashboard_login_failed");
      const values = response.headers.getSetCookie?.() ?? [];
      const cookies = values.map((value) => value.split(";", 1)[0]).filter(Boolean);
      if (!cookies.length) throw Error("hermes_dashboard_cookie_missing");
      hermesDashboardCookie = cookies.join("; ");
      return hermesDashboardCookie;
    })().finally(() => { hermesDashboardLogin = undefined; });
    return hermesDashboardLogin;
  };
  const hermesPrefix = "/hermes-dashboard";
  const relayHermesSocket = (client: WebSocket, upstream: WebSocket) => {
    const pending: RawData[] = [];
    const sendToUpstream = (data: RawData) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
      else pending.push(data);
    };
    const flushPending = () => {
      while (pending.length && upstream.readyState === WebSocket.OPEN) upstream.send(pending.shift()!);
    };
    // The browser can send session.create immediately after its own socket
    // opens, before Hermes has completed the upstream handshake. Register the
    // client listener first so that JSON-RPC messages are not lost in that gap.
    client.on("message", sendToUpstream);
    upstream.on("open", flushPending);
    upstream.on("message", (data: RawData) => { if (client.readyState === WebSocket.OPEN) client.send(data); });
    const close = () => { if (client.readyState === WebSocket.OPEN) client.close(); if (upstream.readyState === WebSocket.OPEN) upstream.close(); };
    client.on("close", close); upstream.on("close", close); client.on("error", close); upstream.on("error", close);
  };
  const hermesProxy = async (req: any, reply: any) => {
    const identity = await hermesUserIdentity(req, reply);
    if (!identity) return reply.code(401).send({ error: "unauthorized" });
    if (!hermesDashboardUrl) return reply.code(503).send({ error: "hermes_dashboard_unavailable" });
    const suffix = req.params["*"] ? `/${req.params["*"]}` : "/";
    const target = new URL(suffix + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""), hermesDashboardUrl);
    const headers: Record<string, string> = {};
    for (const name of ["accept", "content-type", "x-hermes-session-token", "if-none-match", "if-modified-since"]) {
      const value = req.headers[name]; if (typeof value === "string") headers[name] = value;
    }
    const method = req.method.toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
    let upstream: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const dashboardCookie = await ensureHermesDashboardCookie(attempt === 1).catch(() => "");
      if (!dashboardCookie) return reply.code(503).send({ error: "hermes_dashboard_unavailable" });
      headers.cookie = dashboardCookie;
      try { upstream = await fetch(target, { method, headers, body, redirect: "error", signal: AbortSignal.timeout(30000) }); }
      catch { return reply.code(503).send({ error: "hermes_dashboard_unavailable" }); }
      if (![401, 403].includes(upstream.status) || attempt === 1) break;
      hermesDashboardCookie = "";
    }
    if (!upstream) return reply.code(503).send({ error: "hermes_dashboard_unavailable" });
    mergeHermesDashboardCookies(upstream);
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    let payload = Buffer.from(await upstream.arrayBuffer());
    if (contentType.includes("text/html")) {
      let html = payload.toString("utf8");
      html = html.replace(/(src|href)="\//g, `$1="${hermesPrefix}/`);
      html = html.replace(/window\.__HERMES_BASE_PATH__=""/g, `window.__HERMES_BASE_PATH__="${hermesPrefix}"`);
      payload = Buffer.from(html);
    }
    reply.code(upstream.status).header("Content-Type", contentType).header("Cache-Control", "no-store").send(payload);
  };
  app.get(`${hermesPrefix}`, hermesProxy);
  app.get(`${hermesPrefix}/ws`, { websocket: true }, async (client, req) => {
    const identity = await userIdentity(req);
    if (!identity || !hermesDashboardUrl) return client.close(1008, "unauthorized");
    const dashboardCookie = await ensureHermesDashboardCookie().catch(() => "");
    if (!dashboardCookie) return client.close(1013, "dashboard_unavailable");
    const upstream = new WebSocket(new URL("/ws", hermesDashboardUrl), {
      headers: { cookie: dashboardCookie, "x-hermes-session-token": typeof req.headers["x-hermes-session-token"] === "string" ? req.headers["x-hermes-session-token"] : "" },
    });
    relayHermesSocket(client, upstream);
  });
  // Hermes Chat's PTY and JSON-RPC sockets are the only websocket endpoints
  // below /api. Keep this list explicit: a websocket wildcard would also
  // capture normal Dashboard HTTP endpoints such as /api/status and return
  // 404 before the HTTP proxy can handle them.
  for (const socketPath of ["pty", "ws", "events"]) {
    app.get(`${hermesPrefix}/api/${socketPath}`, { websocket: true }, async (client, req) => {
      const identity = await userIdentity(req);
      if (!identity || !hermesDashboardUrl) return client.close(1008, "unauthorized");
      const dashboardCookie = await ensureHermesDashboardCookie().catch(() => "");
      if (!dashboardCookie) return client.close(1013, "dashboard_unavailable");
      const path = req.url.slice(hermesPrefix.length) || "/";
      const upstream = new WebSocket(new URL(path, hermesDashboardUrl), {
        headers: { cookie: dashboardCookie, "x-hermes-session-token": typeof req.headers["x-hermes-session-token"] === "string" ? req.headers["x-hermes-session-token"] : "" },
      });
      relayHermesSocket(client, upstream);
    });
  }
  app.all(`${hermesPrefix}/*`, hermesProxy);
  // One-time pairing was the old bootstrap mechanism. Keep an explicit
  // response for stale clients so they receive a useful migration hint and
  // cannot create a legacy web session anymore.
  app.post("/api/v1/pair", async (_req, reply) => reply.code(410).send({ error: "pairing_disabled", message: "请使用 Jarvis 用户名和密码登录" }));
  app.post("/api/v2/auth/bootstrap", async (_req, reply) => reply.code(410).send({ error: "bootstrap_disabled", message: "请从登录页完成首次注册" }));
  app.get("/api/v2/auth/registration", async () => registrationStatus(db));
  app.post("/api/v2/auth/register", async (req, reply) => {
    try {
      const body = z.object({ username: z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._-]+$/), password: z.string().min(8).max(256), password_confirmation: z.string().min(8).max(256), device_id: z.uuid().optional() }).strict().parse(req.body);
      if (body.password !== body.password_confirmation) return reply.code(400).send({ error: "password_mismatch" });
      const result = await registerFirstUser(db, { username: body.username, password: body.password, device_id: body.device_id });
      reply.header("Cache-Control", "no-store").header("Set-Cookie", [`jarvis_access=${result.access_token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900${req.protocol === "https" ? "; Secure" : ""}`, `jarvis_refresh=${result.refresh_token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${req.protocol === "https" ? "; Secure" : ""}`]);
      return result;
    } catch (e) {
      const error = e instanceof Error ? e.message : "registration_failed";
      return reply.code(error === "registration_closed" ? 409 : 400).send({ error });
    }
  });
  app.post("/api/v2/auth/login", async (req, reply) => {
    const bodyUsername = (req.body as { username?: unknown } | null)?.username;
    const username = typeof bodyUsername === "string" ? bodyUsername : "";
    const address = clientAddress(req.headers as Record<string, unknown>, req.ip, trustProxy);
    const identity = loginIdentity(username, address);
    const retryAfterMs = loginGuard.retryAfter(identity, address);
    if (retryAfterMs > 0) {
      reply.header("Cache-Control", "no-store").header("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      return reply.code(429).send({ error: "rate_limited", retry_after_ms: retryAfterMs });
    }
    try {
      const device = await authenticate(db, req.headers.authorization);
      const deviceId = device?.role === "device" ? device.id : undefined;
      const result = await loginUser(db, req.body, deviceId);
      loginGuard.recordSuccess(identity);
      reply.header("Cache-Control", "no-store").header("Set-Cookie", [`jarvis_access=${result.access_token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900${req.protocol === "https" ? "; Secure" : ""}`, `jarvis_refresh=${result.refresh_token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${req.protocol === "https" ? "; Secure" : ""}`]);
      return result;
    } catch (e) {
      const { status, body } = toErrorResponse(e);
      // Only genuine credential failures consume the brute-force budget; a
      // malformed body or a device conflict must not lock a real user out.
      if (status === 401) loginGuard.recordFailure(identity, address);
      return reply.code(status).send(body);
    }
  });
  app.get("/api/v2/auth/oidc/status", async () => ({ configured: oidcConfigured() }));
  app.get("/api/v2/auth/oidc/start", async (req, reply) => {
    try {
      const authorization = await oidcAuthorizationUrl();
      if (!authorization) return reply.code(404).send({ error: "oidc_not_configured" });
      reply.header("Cache-Control", "no-store").header("Set-Cookie", `jarvis_oidc_state=${authorization.state}; Path=/api/v2/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=600${req.protocol === "https" ? "; Secure" : ""}`);
      return reply.redirect(authorization.url);
    } catch (error) { return reply.code(503).send({ error: error instanceof Error ? error.message : "oidc_unavailable" }); }
  });
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/v2/auth/oidc/callback", async (req, reply) => {
    const browserState = req.headers.cookie?.split(";").map((value) => value.trim()).find((value) => value.startsWith("jarvis_oidc_state="))?.slice("jarvis_oidc_state=".length);
    const clearState = `jarvis_oidc_state=; Path=/api/v2/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=0${req.protocol === "https" ? "; Secure" : ""}`;
    reply.header("Cache-Control", "no-store").header("Set-Cookie", clearState);
    if (!browserState || browserState !== req.query.state) return reply.code(401).send({ error: "oidc_invalid_browser_state" });
    if (req.query.error) return reply.code(401).send({ error: req.query.error });
    if (!req.query.code || !req.query.state) return reply.code(400).send({ error: "oidc_callback_invalid" });
    try {
      const result = await completeOidcLogin(db, req.query.state, req.query.code);
      reply.header("Cache-Control", "no-store").header("Set-Cookie", [clearState, `jarvis_access=${result.access_token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900${req.protocol === "https" ? "; Secure" : ""}`, `jarvis_refresh=${result.refresh_token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${req.protocol === "https" ? "; Secure" : ""}`]);
      return reply.redirect("/");
    } catch (error) { return reply.code(401).send({ error: error instanceof Error ? error.message : "oidc_login_failed" }); }
  });
  app.get("/api/v2/integrations/casaos", async (req, reply) => {
    const identity = await userIdentity(req); if (!identity) return reply.code(401).send({ error: "unauthorized" });
    return casaosAccount();
  });
  app.post("/api/v2/integrations/casaos/login", async (req, reply) => {
    const identity = await userIdentity(req); if (!identity) return reply.code(401).send({ error: "unauthorized" });
    try {
      const body = z.object({ username: z.string().min(1).max(160), password: z.string().min(1).max(512) }).strict().parse(req.body);
      await casaosLogin(body.username, body.password);
      return { connected: true };
    } catch (error) {
      const code = error instanceof Error && error.message === "casaos:unauthorized" ? "invalid_credentials" : "login_failed";
      return reply.code(code === "invalid_credentials" ? 401 : 400).send({ error: code });
    }
  });
  app.post("/api/v2/auth/refresh", async (req, reply) => {
    try {
      const body = req.body && typeof req.body === "object" && "refresh_token" in req.body
        ? z.object({ refresh_token: z.string().min(20).max(200) }).strict().parse(req.body).refresh_token
        : cookieValue(req, "jarvis_refresh");
      if (!body) throw Error("invalid_session");
      const result = await refreshUserSession(db, body);
      reply.header("Cache-Control", "no-store").header("Set-Cookie", [`jarvis_access=${result.access_token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900${req.protocol === "https" ? "; Secure" : ""}`, `jarvis_refresh=${result.refresh_token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${req.protocol === "https" ? "; Secure" : ""}`]);
      return result;
    }
    catch { return reply.code(401).send({ error: "invalid_session" }); }
  });
  app.post("/api/v2/auth/invites", async (req, reply) => {
    const identity = await userIdentity(req); if (!identity || identity.role !== "admin") return reply.code(403).send({ error: "admin_required" });
    try { return await createInvite(db, identity.user_id, req.body); } catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : "invite_failed" }); }
  });
  app.get("/api/v2/auth/users", async (req, reply) => {
    const identity = await userIdentity(req); if (!identity || identity.role !== "admin") return reply.code(403).send({ error: "admin_required" });
    return listUsers(db);
  });
  app.get<{ Params: { id: string } }>("/api/v2/auth/users/:id/capabilities", async (req, reply) => {
    const identity = await userIdentity(req); if (!identity || identity.role !== "admin") return reply.code(403).send({ error: "admin_required" });
    try { return await userCapabilities(db, z.uuid().parse(req.params.id)); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "capability_read_failed" }); }
  });
  app.patch<{ Params: { id: string } }>("/api/v2/auth/users/:id/capabilities", async (req, reply) => {
    const identity = await userIdentity(req); if (!identity || identity.role !== "admin") return reply.code(403).send({ error: "admin_required" });
    try {
      const body = z.object({ capability: z.string().min(3).max(160), allowed: z.boolean() }).strict().parse(req.body);
      return await setUserCapability(db, identity.user_id, z.uuid().parse(req.params.id), body.capability, body.allowed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "capability_update_failed";
      return reply.code(message === "user_not_in_household" ? 404 : 400).send({ error: message });
    }
  });
  app.patch<{ Params: { id: string } }>("/api/v2/auth/users/:id", async (req, reply) => {
    const identity = await userIdentity(req); if (!identity || identity.role !== "admin") return reply.code(403).send({ error: "admin_required" });
    try {
      const body = z.object({ role: z.enum(["admin", "member"]) }).strict().parse(req.body);
      return await updateUserRole(db, identity.user_id, z.uuid().parse(req.params.id), body.role);
    } catch (e) {
      const error = e instanceof Error ? e.message : "user_update_failed";
      return reply.code(error === "user_not_found" ? 404 : 400).send({ error });
    }
  });
  app.post("/api/v2/auth/invites/accept", async (req, reply) => {
    try { return await acceptInvite(db, req.body); } catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : "invite_invalid" }); }
  });
  app.get("/api/v2/auth/me", async (req, reply) => {
    const identity = await userIdentity(req); if (!identity) return reply.code(401).send({ error: "unauthorized" });
    return { user: { id: identity.user_id, username: identity.username, role: identity.role }, household_id: (identity as any).household_id ?? (await householdIdForOwner(db, identity.device_id)), session_id: identity.session_id, device_id: identity.device_id, sessions: await listUserSessions(db, identity.user_id) };
  });
  app.get("/api/v2/auth/sessions", async (req, reply) => {
    const identity = await userIdentity(req); if (!identity) return reply.code(401).send({ error: "unauthorized" }); return listUserSessions(db, identity.user_id);
  });
  app.post("/api/v2/auth/logout", async (req, reply) => {
    const identity = await userIdentity(req);
    if (identity) {
      await revokeUserSession(db, identity.user_id, identity.session_id);
      for (const [ws, state] of sockets) if (state.sessionId === identity.session_id) ws.close(4001, "session_revoked");
    } else {
      const refresh = cookieValue(req, "jarvis_refresh");
      if (refresh) await revokeUserSessionByRefresh(db, refresh);
    }
    reply.header("Set-Cookie", ["jarvis_access=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict", "jarvis_refresh=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict", "jarvis_refresh=; Path=/api/v2/auth; Max-Age=0; HttpOnly; SameSite=Strict"]); return { logged_out: true };
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
  /**
   * The one and only throw -> HTTP mapping. Previously this ladder existed twice
   * (here and in the encapsulated API plugin) and drifted; both now share it.
   */
  const sharedErrorHandler = (error: unknown, _req: unknown, reply: any) => {
    const { status, body } = toErrorResponse(error);
    if (status >= 500) app.log.error({ err: error }, "request_failed");
    return reply.code(status).send(body);
  };
  await app.register(async (api) => {
    // Routes in this encapsulated plugin need their own handler: the
    // websocket plugin captures the child error boundary before the root
    // handler is installed, otherwise ordinary HTTP RPC errors become 500s.
    api.setErrorHandler(sharedErrorHandler);
    api.addHook("preValidation", async (req, reply) => {
      const cookieAuthenticated = Boolean(cookieValue(req, "jarvis_access")) && !req.headers.authorization;
      if (cookieAuthenticated && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !validOrigin(req))
        return reply.code(403).send({ error: "origin_forbidden" });
      let identity: { id: string; role: "agent" | "device"; session_id?: string } | undefined = (await authenticate(db, req.headers.authorization)) ?? undefined;
      if (!identity) {
        const access = cookieValue(req, "jarvis_access");
        const userIdentity = await authenticateUserAccess(db, access ? `Bearer ${access}` : req.headers.authorization);
        if (userIdentity) identity = { id: userIdentity.device_id ?? `user-${userIdentity.user_id}`, role: "device", session_id: userIdentity.session_id };
      }
      if (!identity) {
        return reply.code(401).send({ error: "unauthorized" });
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
    api.post<{ Params: { id: string } }>("/api/v2/integration/credentials/:id/test", async (req, reply) => {
      const identity = (req as any).identity;
      if (identity.role !== "device") return reply.code(403).send({ error: "device_required" });
      try {
        const credential = await m2.integrationCredentials.readCredential(identity.id, req.params.id);
        // Connectivity is declared by the manifest, so a new integration gets a
        // working "test credential" button without any server code.
        const manifest = integrations.findByStoreProvider(credential.provider);
        const probe = manifest?.healthcheck;
        if (!manifest || !probe) {
          return { credential_id: credential.id, provider: credential.provider, connected: false, error: "unsupported_provider" };
        }
        const baseEnv = manifest.app.launch_env
          ?? (manifest.transport.type === "streamable-http" ? manifest.transport.endpoint_env : undefined);
        const base = baseEnv ? process.env[baseEnv]?.trim().replace(/\/$/, "") : undefined;
        if (!base) {
          return { credential_id: credential.id, provider: credential.provider, connected: false, error: "service_unavailable" };
        }
        const scheme = probe.scheme.trim();
        const response = await fetch(`${base}${probe.path}`, {
          method: probe.method,
          headers: { [probe.header]: scheme ? `${scheme} ${credential.secret}` : credential.secret },
          signal: AbortSignal.timeout(10_000),
        });
        const connected = probe.ok_status.includes(response.status);
        return {
          credential_id: credential.id,
          provider: credential.provider,
          connected,
          ...(connected ? {} : { error: response.status === 401 || response.status === 403 ? "invalid_credentials" : "service_unavailable" }),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "integration_unavailable";
        if (message === "not_found") return reply.code(404).send({ error: "not_found" });
        const errorCode = message === "integration_http_401" || message === "integration_http_403" ? "invalid_credentials" : "service_unavailable";
        return { credential_id: req.params.id, connected: false, error: errorCode };
      }
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
      const item = await mediaResources.read(req.params.id, identity.id);
      const legacy = !item && /^[a-zA-Z0-9_-]{1,100}$/.test(req.params.id) ? media.read(req.params.id, identity.id) : undefined;
      if (!item && !legacy) return reply.code(404).send({ error: "media_not_found" });
      return reply.type(item?.mime_type ?? legacy!.contentType).send(item?.data ?? legacy!.data);
    });
    api.get<{ Params: { id: string } }>("/api/media/:id/content", async (req, reply) => {
      reply.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff");
      const identity = (req as any).identity;
      if (identity.role !== "device") return reply.code(403).send({ error: "device_required" });
      const item = await mediaResources.read(req.params.id, identity.id);
      if (!item) return reply.code(404).send({ error: "media_not_found" });
      return reply.type(item.mime_type).send(item.data);
    });
    api.get<{ Querystring: { path?: string } }>("/api/media/file", async (req, reply) => {
      const identity = (req as any).identity;
      if (identity.role !== "device") return reply.code(403).send({ error: "device_required" });
      const item = await readPublishedMediaFile(req.query.path);
      if (!item) return reply.code(404).send({ error: "media_not_found" });
      return reply.type(item.contentType).header("Cache-Control", "private, max-age=60").header("X-Content-Type-Options", "nosniff").send(item.data);
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
        device: identity.id,
        user: (identity as any).user_id as string | undefined,
        events: Promise.resolve(),
        sessionId: (identity as any).session_id as string | undefined,
      };
      state.events = ownerUserId(db, identity.id).then((user) => { state.user = user; });
      sockets.set(ws, state);
      ws.on("pong", () => {
        state.alive = true;
      });
      ws.on("close", () => {
        sockets.delete(ws);
        for (const [nodeId, candidate] of nodeSockets) if (candidate === ws) nodeSockets.delete(nodeId);
        for (const [requestId, pending] of nodePending) {
          if (pending.node !== ws) continue;
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
                if (pending && pending.node === ws) {
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
              app.log.warn({ topic, error: e instanceof Error ? e.message : "unknown" }, "request_failed");
              if (ws.readyState === 1)
                ws.send(
                  JSON.stringify(
                    message(
                      "error",
                      topic,
                      {
                        error: toErrorResponse(e).body.error,
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
  app.setErrorHandler(sharedErrorHandler);
  app.addHook("onClose", async () => {
    await housekeeping.release("server:housekeeping", schedulerOwner).catch(() => {});
    media.clear();
    clearInterval(timer);
    clearInterval(heartbeat);
    for (const ws of sockets.keys()) ws.terminate();
    while (busy) await new Promise((r) => setTimeout(r, 10));
    await m2.close();
    await db.end();
  });
  return { app, db, monitor, agents, usage, m2, media, mediaResources };
}
