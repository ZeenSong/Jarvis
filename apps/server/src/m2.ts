import type { Prices } from "../../../packages/llm-usage/src/index.js";
import { randomUUID } from "node:crypto";
import { installedApplications } from "./applications.js";
import { z } from "zod";
import type { Database } from "./persistence.js";
import {
  AgentManager,
  transaction,
  type Push,
} from "../../../packages/agent-manager/src/index.js";
import { RuntimeRegistry } from "../../../packages/agent-runtime/src/index.js";
import { ConversationService } from "../../../packages/conversation/src/index.js";
import {
  resourceName,
  actionSchema,
} from "../../../packages/ui-protocol/src/index.js";
import { preset } from "../../../packages/ui-presets/src/index.js";
import { semanticView } from "../../../packages/ui-presets/src/v2.js";
import { runEventLog } from "../../../packages/ui-presets/src/run-log.js";
import { negotiateView } from "../../../packages/ui-protocol-v2/src/index.js";
import {
  runContext,
  metricsContext,
  definitionsContext,
} from "../../../packages/agent-manager/src/context.js";
import { WorkspaceStore } from "./workspaces.js";
import { ControlPlane } from "./control-plane.js";
import { appDescriptorSchema, resolveAppLink } from "../../../packages/app-bridge/src/index.js";
import { ownerUserId } from "./ownership.js";
import { capabilitySchema, mergeCapabilities, parseCapabilityCatalog, type Capability } from "../../../packages/capability-registry/src/index.js";
import { IntegrationCredentialStore } from "./integration-credentials.js";
import { householdIdForOwner } from "./households.js";

/** Keep historical charts bounded; live status may contain verbose network data. */
function compactMetricData(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const pick = (part: unknown, keys: string[]) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return undefined;
    const object = part as Record<string, unknown>;
    return Object.fromEntries(keys.filter((key) => object[key] !== undefined).map((key) => [key, object[key]]));
  };
  return {
    cpu: pick(source.cpu, ["usage_percent", "load_1m", "load_5m", "load_15m", "temperature_c"]),
    gpu: pick(source.gpu, ["utilization_percent", "memory_used_bytes", "memory_total_bytes", "temperature_c"]),
    memory: pick(source.memory, ["usage_percent", "used_bytes", "total_bytes", "available_bytes"]),
    disks: Array.isArray(source.disks)
      ? source.disks.map((disk) => pick(disk, ["mount", "usage_percent"])).filter(Boolean)
      : [],
  };
}
export const m2Topics = [
  "application.list",
  "integration.credential.list",
  "integration.credential.put",
  "integration.credential.revoke",
  "capability.list",
  "mcp.catalog.list",
  "conversation.create",
  "conversation.list",
  "conversation.get",
  "conversation.delete",
  "conversation.message",
  "conversation.question.create",
  "conversation.question.answer",
  "agent.definition.list",
  "agent.run.create",
  "agent.run.list",
  "agent.run.get",
  "agent.run.cancel",
  "agent.run.input",
  "agent.run.resume",
  "agent.claim",
  "task.create",
  "task.list",
  "task.get",
  "task.cancel",
  "task.input",
  "approval.response",
  "resource.get",
  "view.get",
  "view.v2.get",
  "view.show",
  "ui.action.invoke",
  "workspace.list",
  "workspace.get",
  "workspace.create",
  "workspace.artifact.upsert",
  "workspace.bind",
  "app.resolve",
  "approval.list",
  "approval.create",
  "approval.resolve",
  "notification.list",
  "notification.read",
  "schedule.list",
  "schedule.create",
  "schedule.toggle",
  "schedule.delete",
  "node.invoke",
  "runtime.health",
] as const;
export const m2Events = [
  "conversation.message.delta",
  "conversation.tool.started",
  "conversation.tool.completed",
  "conversation.tool.failed",
  "conversation.activity.started",
  "conversation.activity.waiting_approval",
  "conversation.activity.completed",
  "conversation.activity.failed",
  "conversation.activity.cancelled",
  "conversation.question.created",
  "conversation.question.answered",
  "conversation.status",
  "task.created",
  "task.started",
  "task.waiting",
  "task.completed",
  "task.failed",
  "task.cancelled",
  "conversation.updated",
  "agent.run.created",
  "agent.run.started",
  "agent.run.updated",
  "agent.run.completed",
  "agent.run.failed",
  "agent.run.cancelled",
  "resource.updated",
  "view.show",
  "view.updated",
  "workspace.created",
  "workspace.updated",
  "workspace.artifact.updated",
  "workspace.opened",
  "approval.created",
  "approval.resolved",
  "notification.created",
  "schedule.created",
];
const capabilityCatalog: Capability[] = [
  { id: "system.status.read", kind: "kernel", risk: "read", approval_required: false },
  { id: "system.metrics.read", kind: "kernel", risk: "read", approval_required: false },
  { id: "agent.list", kind: "kernel", risk: "read", approval_required: false },
  { id: "agent.run.read", kind: "kernel", risk: "read", approval_required: false },
  { id: "homeassistant.mcp.read", kind: "mcp", risk: "read", approval_required: false, provider: "hermes" },
  { id: "homeassistant.mcp.write", kind: "mcp", risk: "write", approval_required: true, provider: "hermes" },
  { id: "frigate.events.read", kind: "mcp", risk: "read", approval_required: false, provider: "frigate" },
  { id: "frigate.event.snapshot.read", kind: "mcp", risk: "read", approval_required: false, provider: "frigate" },
  { id: "immich.mcp.read", kind: "mcp", risk: "read", approval_required: false, provider: "hermes" },
  { id: "immich.mcp.write", kind: "mcp", risk: "write", approval_required: true, provider: "hermes" },
  { id: "schedule.create", kind: "mcp", risk: "write", approval_required: false, provider: "hermes" },
  { id: "conversation.question.create", kind: "mcp", risk: "write", approval_required: false, provider: "hermes" },
  { id: "ui.view.show", kind: "kernel", risk: "write", approval_required: false },
  { id: "node.system.read", kind: "node", risk: "read", approval_required: false },
  { id: "node.file.read", kind: "node", risk: "read", approval_required: false },
  { id: "node.git.read", kind: "node", risk: "read", approval_required: true },
  { id: "node.codex.execute", kind: "node", risk: "execute", approval_required: true },
  { id: "app.resolve", kind: "app-bridge", risk: "read", approval_required: false },
].map((entry) => capabilitySchema.parse(entry));
export class M2 {
  readonly manager: AgentManager;
  readonly conversations: ConversationService;
  readonly workspaces: WorkspaceStore;
  readonly control: ControlPlane;
  readonly integrationCredentials: IntegrationCredentialStore;
  private timer?: NodeJS.Timeout;
  private busy = false;
  private capabilities() { return mergeCapabilities(capabilityCatalog, parseCapabilityCatalog()); }
  constructor(
    readonly db: Database,
    readonly push: Push,
    readonly reads: (name: string, args?: any, owner?: string) => Promise<any>,
    registry = new RuntimeRegistry(),
    prices: Prices = {},
    readonly invokeNode?: (owner: string, nodeId: string, capability: string, input: Record<string, unknown>) => Promise<unknown>,
  ) {
    this.control = new ControlPlane(db, push);
    this.integrationCredentials = new IntegrationCredentialStore(db);
    this.manager = new AgentManager(db, registry, push, prices, async (run, event) => {
      await this.control.createApproval(run.requested_by, { run_id: run.id, capability: String(event.payload.capability ?? "unknown"), input: (event.payload.input as Record<string, unknown>) ?? {} });
    });
    this.conversations = new ConversationService(
      db,
      this.manager,
      push,
    );
    this.workspaces = new WorkspaceStore(db, push);
  }
  async start() {
    await this.manager.recover();
    await this.conversations.recover();
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      void (async () => {
        await this.manager.schedule();
        await this.conversations.schedule();
        await this.runDueSchedules();
      })()
        .catch(() => {})
        .finally(() => (this.busy = false));
    }, 250);
  }
  private async runDueSchedules() {
    const due = (await this.db.query("SELECT * FROM schedules WHERE enabled=true AND next_run_at<=now() ORDER BY next_run_at LIMIT 20")).rows;
    for (const schedule of due) {
      try {
        let conversationId = schedule.conversation_id;
        if (!conversationId) conversationId = (await this.db.query("INSERT INTO conversations(id,title,owner_device_id,owner_user_id,household_id) VALUES($1,$2,$3,(SELECT user_id FROM devices WHERE id=$3),$4) RETURNING id", [randomUUID(), `定时任务 · ${String(schedule.prompt).slice(0, 30)}`, schedule.owner_device_id, await householdIdForOwner(this.db, schedule.owner_device_id)])).rows[0].id;
        await this.conversations.createScheduled(schedule.owner_device_id, conversationId, schedule.prompt, `schedule:${schedule.id}:${new Date(schedule.next_run_at).toISOString()}`);
        await this.db.query(schedule.cadence === "once" ? "UPDATE schedules SET enabled=false,conversation_id=$2,updated_at=now() WHERE id=$1" : "UPDATE schedules SET next_run_at=next_run_at + CASE cadence WHEN 'daily' THEN interval '1 day' ELSE interval '7 days' END,conversation_id=$2,updated_at=now() WHERE id=$1", [schedule.id, conversationId]);
      } catch { /* leave the due row for the next scheduler pass */ }
    }
  }
  async definitions(owner?: string) {
    const userId = owner ? await ownerUserId(this.db, owner) : undefined;
    const ownerFilter = owner ? " WHERE (requested_by=$1 OR requested_by_user_id=$2)" : "";
    const ownerValues = owner ? [owner, userId ?? null] : [];
    const definitions = (
      await this.db.query("SELECT * FROM agent_definitions WHERE id <> 'coding-agent' ORDER BY tier,id")
    ).rows.map((definition: any) => definition.id === "ops-agent" && this.manager.registry.has("hermes")
      ? { ...definition, runtime_type: "hermes" }
      : definition);
    return {
      // Codex is exposed through Node Bridge capabilities, not as a user-facing Agent.
      definitions,
      instances: (await this.db.query(owner ? "SELECT i.* FROM agent_instances i JOIN agent_runs r ON r.agent_instance_id=i.id WHERE (r.requested_by=$1 OR r.requested_by_user_id=$2) ORDER BY i.started_at DESC LIMIT 100" : "SELECT * FROM agent_instances ORDER BY started_at DESC LIMIT 100", ownerValues)).rows,
      runs: (
        await this.db.query(
          `SELECT * FROM agent_runs${ownerFilter} ORDER BY created_at DESC LIMIT 100`,
          ownerValues,
        )
      ).rows,
    };
  }
  async read(name: string, args?: any, owner?: string) {
    if (name === "agent.list") return this.definitions(owner);
    if (name === "agent.run.read")
      return this.manager.get(z.uuid().parse(args?.run_id), owner);
    if (name === "system.metrics.read") return this.metrics();
    return this.reads(name, args, owner);
  }
  async readForAgent(name: string, args?: any, owner?: string) {
    const value = await this.read(name, args, owner);
    if (name === "system.metrics.read") return metricsContext(value);
    if (name === "agent.run.read") return runContext(value);
    if (name === "agent.list") return definitionsContext(value);
    return value;
  }
  async metrics() {
    const samples = (
      await this.db.query(
        "SELECT sampled_at,data FROM system_metrics WHERE sampled_at>now()-interval '24 hours' ORDER BY sampled_at DESC LIMIT 2880",
      )
    ).rows.reverse().map((sample: any) => ({
      sampled_at: sample.sampled_at,
          data: compactMetricData(sample.data),
        }));
    const maxPoints = 240;
    const stride = Math.max(1, Math.ceil(samples.length / maxPoints));
    const bounded = samples.length > maxPoints
      ? samples.filter((_, index) => index === 0 || index === samples.length - 1 || index % stride === 0)
      : samples;
    const plotted: any[] = [];
    for (const sample of bounded) {
      const previous = plotted.at(-1);
      if (
        previous &&
        new Date(sample.sampled_at).getTime() -
          new Date(previous.sampled_at).getTime() >
          60000
      )
        plotted.push({
          sampled_at: new Date(new Date(previous.sampled_at).getTime() + 30000),
          data: {
            cpu: { usage_percent: null },
            gpu: { utilization_percent: null },
          },
          missing: true,
        });
      plotted.push(sample);
    }
    return {
      samples: plotted,
      coverage: {
        from: bounded[0]?.sampled_at ?? null,
        to: bounded.at(-1)?.sampled_at ?? null,
        missing: samples.length < 2880,
        expected_interval_seconds: 30,
        note: "仅显示实际采样；未采集时段无数据；历史曲线已下采样",
      },
    };
  }
  private resourceQueue = new Map<string, Promise<unknown>>();
  private serialize<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const pending = this.resourceQueue.get(name) ?? Promise.resolve();
    const next = pending.catch(() => {}).then(fn);
    this.resourceQueue.set(name, next);
    void next
      .finally(() => {
        if (this.resourceQueue.get(name) === next)
          this.resourceQueue.delete(name);
      })
      .catch(() => {});
    return next;
  }
  async sample(data: unknown) {
    await this.db.query("INSERT INTO system_metrics(data) VALUES($1)", [compactMetricData(data)]);
    await this.serialize("system/status", () =>
      this.publish("system/status", data),
    );
    await this.db.query(
      "DELETE FROM system_metrics WHERE sampled_at<now()-interval '30 days'",
    );
  }
  async publish(resource: string, data: unknown) {
    const r = (
      await this.db.query(
        `INSERT INTO resources(resource,revision,data) VALUES($1,1,$2) ON CONFLICT(resource) DO UPDATE SET revision=resources.revision+1,data=excluded.data,updated_at=now() RETURNING *`,
        [resource, data],
      )
    ).rows[0];
    const value = {
      version: 1,
      resource,
      revision: Number(r.revision),
      data: r.data,
    };
    this.push("resource.updated", value);
    return value;
  }
  async resource(input: string, owner?: string) {
    const name = resourceName.parse(input);
    const ownerScoped = owner && !name.startsWith("system/");
    const queue = ownerScoped ? `${owner}:${name}` : name;
    return this.serialize(queue, async () => {
      const data = await this.snapshot(name, owner);
      // Run snapshots contain owner-scoped task data; never persist or broadcast
      // them through the global resource stream.
      if (ownerScoped) {
        const revision = Number(new Date((data as any)?.run?.updated_at ?? (data as any)?.conversation?.updated_at ?? 0).getTime()) || Date.now();
        return { version: 1 as const, resource: name, revision, data };
      }
      const row = (
        await this.db.query(
          `INSERT INTO resources(resource,revision,data) VALUES($1,1,$2) ON CONFLICT(resource) DO UPDATE SET revision=resources.revision+1,data=excluded.data,updated_at=now() RETURNING revision`,
          [name, data],
        )
      ).rows[0];
      return { version: 1 as const, resource: name, revision: Number(row.revision), data };
    });
  }
  private async snapshot(name: string, owner?: string) {
    let data: unknown;
    if (name.startsWith("agent-run/")) {
      const run = await this.manager.get(z.uuid().parse(name.slice(10)), owner);
      data = { ...run, event_log: runEventLog(run.events), presentation: {
        artifacts: { items: run.artifacts.slice(0, 200).map((artifact) => ({
          title: String(artifact.name).slice(0, 300), status: String(artifact.media_type).slice(0, 100),
        })) },
        summary: { "任务": run.run.goal, "状态": run.run.status, "执行者": run.run.agent_id,
          "开始时间": run.run.started_at, "完成时间": run.run.finished_at },
      } };
    }
    else if (name.startsWith("conversation/"))
      data = await this.conversations.get(z.uuid().parse(name.slice(13)), owner);
    else
      switch (name) {
        case "system/status":
          data = await this.read("system.status.read");
          break;
        case "system/network":
          data = (await this.read("system.status.read")).network;
          break;
        case "system/metrics":
          data = await this.metrics();
          break;
        case "agents/summary":
          data = await this.definitions(owner);
          break;
        case "llm/usage/today":
          data = await this.read("llm.usage.read", undefined, owner);
          break;
        case "llm/usage/agents":
          data = await this.read("llm.usage.read", { group_by: "agent" }, owner);
          break;
        case "llm/usage/hourly":
          data = {
            series: (
              await this.db.query(
                "SELECT date_trunc('hour',started_at) label,sum(input_tokens+output_tokens)::float8 value FROM llm_requests WHERE started_at>now()-interval '24 hours'" + (owner ? " AND (EXISTS (SELECT 1 FROM conversations c JOIN devices d ON d.id=c.owner_device_id WHERE c.id=llm_requests.conversation_id AND (d.id=$1 OR d.user_id::text=CASE WHEN $1 LIKE 'user-%' THEN substring($1 from 6) ELSE (SELECT user_id::text FROM devices WHERE id=$1) END)) OR EXISTS (SELECT 1 FROM agent_runs ar JOIN devices d ON d.id=ar.requested_by WHERE ar.id=llm_requests.run_id AND (d.id=$1 OR d.user_id::text=CASE WHEN $1 LIKE 'user-%' THEN substring($1 from 6) ELSE (SELECT user_id::text FROM devices WHERE id=$1) END)))" : "") + " GROUP BY 1 ORDER BY 1",
                owner ? [owner] : [],
              )
            ).rows,
          };
          break;
      }
    // Revision assignment and snapshot read are serialized, avoiding stale computation overwriting newer state.
    // The caller owns revision assignment/publication. Returning the raw
    // snapshot is essential for owner-scoped resources, which must never be
    // wrapped twice or sent through the global resource stream.
    return data;
  }
  async show(intent: unknown, owner?: string) {
    const spec = preset(intent),
      id = randomUUID();
    await this.db.query("INSERT INTO views(id,owner_device_id,owner_user_id,spec) VALUES($1,$2,(SELECT user_id FROM devices WHERE id=$2),$3)", [id, owner ?? null, spec]);
    const value = { id, spec };
    this.push("view.show", value);
    return value;
  }
  async handle(topic: string, p: any, device: string): Promise<unknown> {
    switch (topic) {
      case "application.list": return installedApplications();
      case "integration.credential.list": return this.integrationCredentials.list(device);
      case "integration.credential.put": return this.integrationCredentials.put(device, p);
      case "integration.credential.revoke": return this.integrationCredentials.revoke(device, z.uuid().parse(p.credential_id));
      case "capability.list":
      case "mcp.catalog.list":
        return { version: 1, capabilities: this.capabilities().map((entry) => ({ ...entry })) };
      case "view.v2.get": {
        const spec = preset(p.intent);
        const names = [...new Set(spec.blocks.flatMap((b) => b.resource ? [b.resource] : []))];
        const snapshots = await Promise.all(names.map((name) => this.resource(name, device)));
        return negotiateView(semanticView(p.intent.intent, spec, new Map(snapshots.map((r) => [r.resource, { ...r, version: 1 as const }]))), p.renderer);
      }
      case "conversation.create": {
        const title = z
          .string()
          .trim()
          .min(1)
          .max(200)
          .default("新会话")
          .parse(p.title);
        const c = (
          await this.db.query(
            "INSERT INTO conversations(id,title,owner_device_id,owner_user_id,household_id) VALUES($1,$2,$3,(SELECT user_id FROM devices WHERE id=$3),$4) RETURNING *",
            [randomUUID(), title, device, await householdIdForOwner(this.db, device)],
          )
        ).rows[0];
        this.push("conversation.updated", { conversation_id: c.id });
        return c;
      }
      case "workspace.list":
        return this.workspaces.list(device, p.conversation_id);
      case "workspace.get": {
        const value = await this.workspaces.get(device, z.uuid().parse(p.workspace_id));
        this.push("workspace.opened", { workspace_id: value.workspace.id, revision: Number(value.workspace.revision) });
        return value;
      }
      case "workspace.create":
        return this.workspaces.create(device, p);
      case "workspace.artifact.upsert":
        return this.workspaces.upsertArtifact(device, p);
      case "workspace.bind":
        return this.workspaces.bind(device, p.workspace_id, p.resource, p.revision, p.metadata);
      case "app.resolve": {
        const input = z.object({ app_id: z.enum(["home-assistant", "immich"]), kind: z.string().max(80).optional(), id: z.string().max(300).optional(), platform: z.enum(["web", "android"]) }).strict().parse(p);
        const candidate = input.app_id === "home-assistant" ? process.env.HOME_ASSISTANT_URL : process.env.IMMICH_URL;
        // The deployment is intentionally reachable through the user's
        // Tailscale address over HTTP; the operator supplied these URLs, so
        // keep the resolver constrained to http(s) URLs and never accept a
        // client supplied target.
        const base = candidate && /^https?:\/\//.test(candidate) ? candidate.replace(/\/$/, "") : undefined;
        const deep_links = base ? input.app_id === "immich" ? { photo: `${base}/photos/{id}`, album: `${base}/albums/{id}`, search: `${base}/search` } : { entity: `${base}/config/entities?entity_id={id}`, dashboard: `${base}/lovelace/{id}` } : {};
        const descriptor = appDescriptorSchema.parse({
          id: input.app_id,
          name: input.app_id === "immich" ? "Immich" : "Home Assistant",
          launch: { web: base },
          deep_links,
          capabilities: input.app_id === "immich" ? ["immich.photo.search", "immich.album.read"] : ["homeassistant.entity.read", "homeassistant.dashboard.read"],
          resources: input.app_id === "immich" ? ["photo", "album", "search"] : ["entity", "dashboard"],
          icon: `/app-icons/${input.app_id === "immich" ? "immich.svg" : "homeassistant.svg"}`,
          status: base ? "ready" : "unknown",
        });
        return { app: descriptor, link: resolveAppLink(descriptor, input, input.platform) };
      }
      case "approval.list": return this.control.approvals(device);
      case "approval.create": return this.control.createApproval(device, p);
      case "approval.resolve": {
        const status = z.enum(["approved", "rejected"]).parse(p.status);
        const approval = await this.control.resolveApproval(device, z.uuid().parse(p.approval_id), status);
        if (status === "approved" && approval.run_id) await this.manager.approve(approval.run_id, device);
        return approval;
      }
      case "notification.list": return this.control.notifications(device);
      case "notification.read": return this.control.markNotification(device, z.uuid().parse(p.notification_id));
      case "schedule.list": return this.control.schedules(device);
      case "schedule.create": return this.control.createSchedule(device, p);
      case "schedule.toggle": return this.control.toggleSchedule(device, z.uuid().parse(p.schedule_id), z.boolean().parse(p.enabled));
      case "schedule.delete": return this.control.deleteSchedule(device, z.uuid().parse(p.schedule_id));
      case "node.invoke": {
        const input = z.object({
          node_id: z.string().regex(/^[\w.-]{1,100}$/),
          capability: z.enum(["node.system.read", "node.file.read", "node.git.read", "node.codex.execute"]),
          input: z.record(z.string(), z.unknown()).default({}),
          approval_id: z.uuid().optional(),
        }).strict().parse(p);
        if (!this.invokeNode) throw Error("node_bridge_unavailable");
        const user = await ownerUserId(this.db, device);
        const node = (await this.db.query("SELECT a.capabilities FROM agents a WHERE a.id=$1 AND a.status IS DISTINCT FROM 'offline' AND (a.owner_device_id=$2 OR a.owner_user_id=$3)", [input.node_id, device, user ?? null])).rows[0];
        if (!node) throw Error("node_not_found");
        const capabilities = Array.isArray(node.capabilities) ? node.capabilities : typeof node.capabilities === "string" ? (() => { try { const parsed = JSON.parse(node.capabilities); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })() : [];
        if (!capabilities.includes(input.capability)) throw Error("node_capability_unavailable");
        if (input.capability === "node.git.read" || input.capability === "node.codex.execute") {
          if (!input.approval_id) throw Error("approval_required");
          // JSONB equality binds the reviewed node and complete input, independent of key order.
          // Atomic consume BEFORE dispatch: even a timeout cannot replay a side effect.
          const approved = (await this.db.query(`UPDATE approvals SET consumed_at=now()
            WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$4)
            AND status='approved' AND capability=$3 AND consumed_at IS NULL AND expires_at>now()
            AND input=$5::jsonb RETURNING id`,
            [input.approval_id, device, input.capability, user ?? null,
             JSON.stringify({ node_id: input.node_id, input: input.input })])).rowCount;
          if (!approved) throw Error("approval_required");
        }
        return this.invokeNode(device, input.node_id, input.capability, input.input);
      }
      case "conversation.list":
        return this.conversations.list(device);
      case "conversation.get":
        {
          const developer = p.developer === true;
          if (developer) {
            const user = await ownerUserId(this.db, device);
            const role = user ? (await this.db.query("SELECT role FROM users WHERE id=$1", [user])).rows[0]?.role : undefined;
            if (role !== "admin") throw Error("admin_required");
          }
          return this.conversations.get(z.uuid().parse(p.conversation_id), device, developer);
        }
      case "conversation.delete":
        return this.conversations.delete(z.uuid().parse(p.conversation_id), device);
      case "conversation.message":
        return this.conversations.accept(device, p);
      case "conversation.question.create":
        return this.conversations.createQuestion(device, p);
      case "conversation.question.answer":
        return this.conversations.answerQuestion(device, z.uuid().parse(p.question_id), p.answer);
      case "agent.definition.list":
        return this.definitions(device);
      case "agent.claim": {
        const agentId = z.string().regex(/^[\w.-]{1,100}$/).parse(p.agent_id);
        const user = await ownerUserId(this.db, device);
        if (!user) throw Error("user_login_required");
        const claimed = (await this.db.query(
          "UPDATE agents SET owner_user_id=$2,updated_at=now() WHERE id=$1 AND owner_user_id IS NULL RETURNING *",
          [agentId, user],
        )).rows[0];
        if (!claimed) throw Error("agent_not_owned");
        this.push("agent.status.changed", claimed);
        return claimed;
      }
      case "runtime.health":
        return this.manager.registry.health();
      case "agent.run.list":
        return (await this.definitions(device)).runs;
      case "task.list":
        return (await this.definitions(device)).runs;
      case "task.create":
        return this.handle("agent.run.create", p, device);
      case "agent.run.create": {
        const input = z
          .object({
            agent_id: z.enum(["coding-agent", "ops-agent"]),
            conversation_id: z.uuid().optional(),
            workspace_id: z.uuid().optional(),
            goal: z.string().min(1).max(16000),
            idempotency_key: z.string().min(1).max(128),
          })
          .strict()
          .parse(p);
        const r = await transaction(this.db, async (c) => {
          await c.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [device + ":" + input.idempotency_key],
          );
          const old = (
            await c.query(
              "SELECT *,request=$3::jsonb AS same FROM m2_idempotency WHERE device_id=$1 AND key=$2",
              [device, input.idempotency_key, input],
            )
          ).rows[0];
          if (old) {
            if (!old.same) throw Error("id_reused_with_different_request");
            return old.response;
          }
          const r = await this.manager.create(
            c,
            {
              ...input,
              input:
                input.agent_id === "coding-agent"
                  ? {
                      workspace: {
                        repository: process.env.CODING_REPOSITORY,
                        commit: process.env.CODING_COMMIT,
                      },
                      model: process.env.CODING_MODEL,
                    }
                  : {},
            },
            device,
          );
          await c.query(
            "INSERT INTO m2_idempotency(device_id,key,request,response) VALUES($1,$2,$3,$4)",
            [device, input.idempotency_key, input, r],
          );
          return r;
        });
        this.push("agent.run.created", r);
        this.push("task.created", { task_id: r.id, run_id: r.id, status: "queued" });
        return r;
      }
      case "agent.run.get":
        return this.manager.get(z.uuid().parse(p.run_id), device);
      case "task.get":
        return this.manager.get(z.uuid().parse(p.task_id ?? p.run_id), device);
      case "agent.run.cancel":
        await this.manager.cancel(z.uuid().parse(p.run_id), device);
        return { cancelled: true };
      case "task.cancel":
        await this.manager.cancel(z.uuid().parse(p.task_id ?? p.run_id), device);
        return { cancelled: true };
      case "agent.run.input":
      case "agent.run.resume":
      case "task.input":
        await this.manager.input(
          z.uuid().parse(p.run_id ?? p.task_id),
          z.string().max(16000).parse(p.text),
          topic === "agent.run.resume",
          device,
        );
        return { accepted: true };
      case "approval.response":
        if (z.boolean().parse(p.approved))
          throw Error("approval_cannot_elevate_permissions");
        await this.manager.cancel(z.uuid().parse(p.run_id), device);
        return { approved: false };
      case "resource.get":
        return this.resource(p.resource, device);
      case "view.show":
        return this.show(p, device);
      case "view.get": {
        const user = await ownerUserId(this.db, device);
        const v = (
          await this.db.query("SELECT * FROM views WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3 OR (owner_device_id IS NULL AND owner_user_id IS NULL))", [
            z.uuid().parse(p.view_id),
            device,
            user ?? null,
          ])
        ).rows[0];
        if (!v) throw Error("not_found");
        return v;
      }
      case "ui.action.invoke": {
        const a = actionSchema.parse(p);
        switch (a.type) {
          case "run.open":
            return this.manager.get(z.uuid().parse(a.target), device);
          case "run.cancel":
            return this.handle(
              "agent.run.cancel",
              { run_id: a.target },
              device,
            );
          case "run.resume":
          case "run.input":
            return this.handle(
              a.type === "run.input" ? "agent.run.input" : "agent.run.resume",
              { run_id: a.target, text: a.text ?? "" },
              device,
            );
          case "conversation.open":
            return this.conversations.get(z.uuid().parse(a.target), device);
          case "approval.response":
            return this.handle(
              "approval.response",
              { run_id: a.target, approved: a.approved },
              device,
            );
          case "view.show":
            return this.handle("view.get", { view_id: a.target }, device);
          case "app.open":
            return this.handle("app.resolve", {
              app_id: a.target,
              kind: a.kind,
              id: a.resource_id,
              platform: a.platform ?? "web",
            }, device);
        }
      }
      default:
        throw Error("unknown_topic");
    }
  }
  async cleanup() {
    await this.db.query("DELETE FROM artifacts WHERE expires_at<now()");
    await this.db.query(
      "DELETE FROM run_events WHERE timestamp<now()-$1*interval '1 day' AND run_id IN (SELECT id FROM agent_runs WHERE finished_at IS NOT NULL)",
      [Number(process.env.EVENT_RETENTION_DAYS ?? 30)],
    );
    await this.db.query("DELETE FROM web_sessions WHERE expires_at<now()");
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    while (this.busy) await new Promise((r) => setTimeout(r, 10));
    await this.conversations.close();
    await this.manager.close();
  }
}
