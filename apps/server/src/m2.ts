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
export const m2Topics = [
  "application.list",
  "conversation.create",
  "conversation.list",
  "conversation.get",
  "conversation.message",
  "agent.definition.list",
  "agent.run.create",
  "agent.run.list",
  "agent.run.get",
  "agent.run.cancel",
  "agent.run.input",
  "agent.run.resume",
  "approval.response",
  "resource.get",
  "view.get",
  "view.v2.get",
  "view.show",
  "ui.action.invoke",
  "runtime.health",
] as const;
export const m2Events = [
  "conversation.message.delta",
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
];
export class M2 {
  readonly manager: AgentManager;
  readonly conversations: ConversationService;
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(
    readonly db: Database,
    readonly push: Push,
    readonly reads: (name: string, args?: any) => Promise<any>,
    registry = new RuntimeRegistry(),
    prices: Prices = {},
  ) {
    this.manager = new AgentManager(db, registry, push, prices);
    this.conversations = new ConversationService(
      db,
      this.manager,
      push,
      (n, a) => this.readForAgent(n, a),
      (i) => this.show(i),
    );
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
      })()
        .catch(() => {})
        .finally(() => (this.busy = false));
    }, 250);
  }
  async definitions() {
    return {
      definitions: (
        await this.db.query("SELECT * FROM agent_definitions ORDER BY tier,id")
      ).rows,
      instances: (
        await this.db.query(
          "SELECT * FROM agent_instances ORDER BY started_at DESC LIMIT 100",
        )
      ).rows,
      runs: (
        await this.db.query(
          "SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT 100",
        )
      ).rows,
    };
  }
  async read(name: string, args?: any) {
    if (name === "agent.list") return this.definitions();
    if (name === "agent.run.read")
      return this.manager.get(z.uuid().parse(args?.run_id));
    if (name === "system.metrics.read") return this.metrics();
    return this.reads(name, args);
  }
  async readForAgent(name: string, args?: any) {
    const value = await this.read(name, args);
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
    ).rows.reverse();
    const plotted: any[] = [];
    for (const sample of samples) {
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
        from: samples[0]?.sampled_at ?? null,
        to: samples.at(-1)?.sampled_at ?? null,
        missing: samples.length < 2880,
        expected_interval_seconds: 30,
        note: "仅显示实际采样；未采集时段无数据",
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
    await this.db.query("INSERT INTO system_metrics(data) VALUES($1)", [data]);
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
  async resource(input: string) {
    const name = resourceName.parse(input);
    return this.serialize(name, () => this.snapshot(name));
  }
  private async snapshot(name: string) {
    let data: unknown;
    if (name.startsWith("agent-run/")) {
      const run = await this.manager.get(z.uuid().parse(name.slice(10)));
      data = { ...run, event_log: runEventLog(run.events), presentation: {
        artifacts: { items: run.artifacts.slice(0, 200).map((artifact) => ({
          title: String(artifact.name).slice(0, 300), status: String(artifact.media_type).slice(0, 100),
        })) },
        summary: { "任务": run.run.goal, "状态": run.run.status, "执行者": run.run.agent_id,
          "开始时间": run.run.started_at, "完成时间": run.run.finished_at },
      } };
    }
    else if (name.startsWith("conversation/"))
      data = await this.conversations.get(z.uuid().parse(name.slice(13)));
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
          data = await this.definitions();
          break;
        case "llm/usage/today":
          data = await this.read("llm.usage.read");
          break;
        case "llm/usage/agents":
          data = await this.read("llm.usage.read", { group_by: "agent" });
          break;
        case "llm/usage/hourly":
          data = {
            series: (
              await this.db.query(
                "SELECT date_trunc('hour',started_at) label,sum(input_tokens+output_tokens)::float8 value FROM llm_requests WHERE started_at>now()-interval '24 hours' GROUP BY 1 ORDER BY 1",
              )
            ).rows,
          };
          break;
      }
    // Revision assignment and snapshot read are serialized, avoiding stale computation overwriting newer state.
    return this.publish(name, data);
  }
  async show(intent: unknown) {
    const spec = preset(intent),
      id = randomUUID();
    await this.db.query("INSERT INTO views(id,spec) VALUES($1,$2)", [id, spec]);
    const value = { id, spec };
    this.push("view.show", value);
    return value;
  }
  async handle(topic: string, p: any, device: string): Promise<unknown> {
    switch (topic) {
      case "application.list": return installedApplications();
      case "view.v2.get": {
        const spec = preset(p.intent);
        const names = [...new Set(spec.blocks.flatMap((b) => b.resource ? [b.resource] : []))];
        const snapshots = await Promise.all(names.map((name) => this.resource(name)));
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
            "INSERT INTO conversations(id,title) VALUES($1,$2) RETURNING *",
            [randomUUID(), title],
          )
        ).rows[0];
        this.push("conversation.updated", { conversation_id: c.id });
        return c;
      }
      case "conversation.list":
        return this.conversations.list();
      case "conversation.get":
        return this.conversations.get(z.uuid().parse(p.conversation_id));
      case "conversation.message":
        return this.conversations.accept(device, p);
      case "agent.definition.list":
        return this.definitions();
      case "runtime.health":
        return this.manager.registry.health();
      case "agent.run.list":
        return (await this.definitions()).runs;
      case "agent.run.create": {
        const input = z
          .object({
            agent_id: z.enum(["coding-agent", "ops-agent"]),
            conversation_id: z.uuid().optional(),
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
        return r;
      }
      case "agent.run.get":
        return this.manager.get(z.uuid().parse(p.run_id));
      case "agent.run.cancel":
        await this.manager.cancel(z.uuid().parse(p.run_id));
        return { cancelled: true };
      case "agent.run.input":
      case "agent.run.resume":
        await this.manager.input(
          z.uuid().parse(p.run_id),
          z.string().max(16000).parse(p.text),
          topic === "agent.run.resume",
        );
        return { accepted: true };
      case "approval.response":
        if (z.boolean().parse(p.approved))
          throw Error("approval_cannot_elevate_permissions");
        await this.manager.cancel(z.uuid().parse(p.run_id));
        return { approved: false };
      case "resource.get":
        return this.resource(p.resource);
      case "view.show":
        return this.show(p);
      case "view.get": {
        const v = (
          await this.db.query("SELECT * FROM views WHERE id=$1", [
            z.uuid().parse(p.view_id),
          ])
        ).rows[0];
        if (!v) throw Error("not_found");
        return v;
      }
      case "ui.action.invoke": {
        const a = actionSchema.parse(p);
        switch (a.type) {
          case "run.open":
            return this.manager.get(z.uuid().parse(a.target));
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
            return this.conversations.get(z.uuid().parse(a.target));
          case "approval.response":
            return this.handle(
              "approval.response",
              { run_id: a.target, approved: a.approved },
              device,
            );
          case "view.show":
            return this.handle("view.get", { view_id: a.target }, device);
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
