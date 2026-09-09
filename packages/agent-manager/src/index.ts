import { estimateCost, type Prices } from "../../llm-usage/src/index.js";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Database } from "../../../apps/server/src/persistence.js";
import {
  RuntimeRegistry,
  canTransition,
  childDepth,
  terminal,
  type RunStatus,
  type AgentEvent,
} from "../../agent-runtime/src/index.js";
export type Push = (topic: string, payload: unknown) => void;
export async function transaction<T>(
  db: Database,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const value = await fn(c);
    await c.query("COMMIT");
    return value;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export class AgentManager {
  private active = new Map<string, Promise<void>>();
  private stopped = false;
  private lastCleanup = Date.now();
  constructor(
    readonly db: Database,
    readonly registry: RuntimeRegistry,
    readonly push: Push,
    readonly prices: Prices = {},
  ) {}
  async recordUsage(
    p: {
      provider: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cached_input_tokens: number;
    },
    conversationId: string,
    runId?: string,
  ) {
    const requestId = randomUUID();
    const price = this.prices[p.provider]?.[p.model];
    const cost = estimateCost(
      p,
      price && price.valid_from <= new Date().toISOString() ? price : undefined,
    );
    await this.db.query(
      "INSERT INTO llm_requests(id,provider,model,input_tokens,output_tokens,cached_input_tokens,estimated_cost_usd,status,started_at,finished_at,logical_agent_id,run_id,conversation_id) VALUES($1,$2,$3,$4,$5,$6,$7,'success',now(),now(),'jarvis-core',$8,$9)",
      [
        requestId,
        p.provider,
        p.model,
        p.input_tokens,
        p.output_tokens,
        p.cached_input_tokens,
        cost,
        runId ?? null,
        conversationId,
      ],
    );
    this.push("llm.usage.changed", {});
    return requestId;
  }
  async create(
    c: PoolClient,
    p: {
      agent_id: string;
      conversation_id?: string;
      parent_run_id?: string;
      goal: string;
      input?: unknown;
    },
    device: string,
  ) {
    const definition = (
      await c.query("SELECT * FROM agent_definitions WHERE id=$1 AND enabled", [
        p.agent_id,
      ])
    ).rows[0];
    if (!definition) throw Error("agent_not_found");
    let depth = definition.tier === "core" ? 0 : 1;
    if (p.parent_run_id) {
      const parent = (
        await c.query("SELECT * FROM agent_runs WHERE id=$1 FOR UPDATE", [
          p.parent_run_id,
        ])
      ).rows[0];
      if (
        !parent ||
        terminal(parent.status) ||
        parent.conversation_id !== (p.conversation_id ?? null)
      )
        throw Error("invalid_parent");
      depth = childDepth(parent.depth);
    }
    if (definition.tier === "core" && p.parent_run_id)
      throw Error("invalid_core_parent");
    const run = (
      await c.query(
        `INSERT INTO agent_runs(id,agent_id,parent_run_id,conversation_id,requested_by,goal,runtime_type,status,depth,input_json) VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9) RETURNING *`,
        [
          randomUUID(),
          p.agent_id,
          p.parent_run_id ?? null,
          p.conversation_id ?? null,
          device,
          p.goal,
          definition.runtime_type,
          depth,
          p.input ?? {},
        ],
      )
    ).rows[0];
    await c.query(
      "INSERT INTO run_events(run_id,agent_id,type,payload) VALUES($1,$2,'agent.run.created',$3)",
      [run.id, run.agent_id, { title: "任务已创建" }],
    );
    return run;
  }
  async get(id: string) {
    const run = (
      await this.db.query("SELECT * FROM agent_runs WHERE id=$1", [id])
    ).rows[0];
    if (!run) throw Error("not_found");
    return {
      run,
      events: (
        await this.db.query(
          "SELECT * FROM run_events WHERE run_id=$1 ORDER BY id",
          [id],
        )
      ).rows,
      tree: (
        await this.db.query(
          "WITH RECURSIVE ancestors AS (SELECT id,parent_run_id FROM agent_runs WHERE id=$1 UNION ALL SELECT r.id,r.parent_run_id FROM agent_runs r JOIN ancestors a ON a.parent_run_id=r.id), t AS (SELECT * FROM agent_runs WHERE id=(SELECT id FROM ancestors WHERE parent_run_id IS NULL) UNION ALL SELECT r.* FROM agent_runs r JOIN t ON r.parent_run_id=t.id) SELECT id,parent_run_id,agent_id,status,agent_instance_id FROM t",
          [id],
        )
      ).rows,
      artifacts: (
        await this.db.query(
          "SELECT id,name,media_type,content FROM artifacts WHERE run_id=$1 AND expires_at>now()",
          [id],
        )
      ).rows,
      usage: (
        await this.db.query(
          "WITH RECURSIVE t AS (SELECT id FROM agent_runs WHERE id=$1 UNION ALL SELECT r.id FROM agent_runs r JOIN t ON r.parent_run_id=t.id) SELECT COALESCE(sum(input_tokens),0)::float8 input_tokens,COALESCE(sum(output_tokens),0)::float8 output_tokens,CASE WHEN count(*) FILTER(WHERE estimated_cost_usd IS NULL)>0 THEN NULL ELSE sum(estimated_cost_usd)::float8 END estimated_cost_usd,count(*) FILTER(WHERE estimated_cost_usd IS NULL)::int unpriced_requests FROM llm_requests WHERE run_id IN (SELECT id FROM t)",
          [id],
        )
      ).rows[0],
    };
  }
  async transition(
    id: string,
    status: RunStatus,
    payload: Record<string, unknown> = {},
    source?: AgentEvent,
  ) {
    const event = await transaction(this.db, async (c) => {
      const run = (
        await c.query("SELECT * FROM agent_runs WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!run) return null;
      if (
        source?.sequence &&
        Number(run.last_event_sequence) >= source.sequence
      )
        return null;
      if (!canTransition(run.status, status)) {
        if (!source || !terminal(run.status)) return null;
        await this.archive(c, id, payload);
        await c.query(
          "UPDATE agent_runs SET result_json=$2,updated_at=now() WHERE id=$1",
          [id, payload],
        );
        if (source.sequence)
          await c.query(
            "UPDATE agent_runs SET last_event_sequence=$2 WHERE id=$1",
            [id, source.sequence],
          );
        return (
          await c.query(
            "INSERT INTO run_events(run_id,agent_id,type,payload) VALUES($1,$2,'agent.progress',$3) RETURNING *",
            [
              id,
              run.agent_id,
              {
                title: "任务产物已归档",
                archived_only: true,
                status: run.status,
              },
            ],
          )
        ).rows[0];
      }
      await c.query(
        `UPDATE agent_runs SET status=$2,updated_at=now(),started_at=CASE WHEN $2='running' THEN COALESCE(started_at,now()) ELSE started_at END,finished_at=CASE WHEN $3 THEN now() ELSE NULL END,result_json=CASE WHEN $3 THEN $4 ELSE result_json END,error_json=CASE WHEN $2='failed' THEN $4 ELSE error_json END WHERE id=$1`,
        [id, status, terminal(status), payload],
      );
      if (terminal(status)) {
        await this.archive(c, id, payload);
      }
      if (source?.sequence)
        await c.query(
          "UPDATE agent_runs SET last_event_sequence=$2 WHERE id=$1",
          [id, source.sequence],
        );
      const type =
        status === "running"
          ? "agent.run.started"
          : terminal(status)
            ? "agent.run." + status
            : "agent.run.updated";
      return (
        await c.query(
          "INSERT INTO run_events(run_id,agent_id,type,payload) VALUES($1,$2,$3,$4) RETURNING *",
          [id, run.agent_id, type, { ...payload, status }],
        )
      ).rows[0];
    });
    if (event) {
      this.push(event.type, event);
      this.push("agent.run.updated", {
        run_id: id,
        status: event.payload.status,
      });
    }
    return !!event;
  }
  private async archive(
    c: PoolClient,
    id: string,
    payload: Record<string, unknown>,
  ) {
    for (const [name, media, content] of [
      ["result.json", "application/json", JSON.stringify(payload)],
      ...(typeof payload.diff === "string"
        ? [["changes.diff", "text/x-diff", payload.diff]]
        : []),
    ] as string[][]) {
      await c.query(
        "INSERT INTO artifacts(id,run_id,name,media_type,content,expires_at) VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 day') ON CONFLICT(run_id,name) DO UPDATE SET content=excluded.content,expires_at=excluded.expires_at",
        [
          randomUUID(),
          id,
          name,
          media,
          content,
          Number(process.env.ARTIFACT_RETENTION_DAYS ?? 30),
        ],
      );
    }
  }
  async ingest(id: string, event: AgentEvent) {
    if (
      event.type === "agent.run.completed" ||
      event.type === "agent.run.failed" ||
      event.type === "agent.run.cancelled"
    ) {
      await this.transition(
        id,
        event.type.slice(10) as RunStatus,
        event.payload,
        event,
      );
      return;
    }
    if (event.type === "agent.run.started") {
      await this.transition(id, "running");
      return;
    }
    if (event.type === "agent.waiting_user")
      await this.transition(id, "waiting_for_user");
    if (event.type === "agent.approval.required" && !event.payload.denied)
      await this.transition(id, "waiting_for_approval");
    const saved = await transaction(this.db, async (c) => {
      const r = (
        await c.query("SELECT * FROM agent_runs WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!r || (terminal(r.status) && !event.sequence)) return null;
      if (event.sequence) {
        if (!Number.isSafeInteger(event.sequence) || event.sequence < 1)
          throw Error("invalid_event_sequence");
        if (Number(r.last_event_sequence) >= event.sequence) return null;
        await c.query(
          "UPDATE agent_runs SET last_event_sequence=$2 WHERE id=$1",
          [id, event.sequence],
        );
      }
      if (event.type === "agent.usage.updated") {
        const p = event.payload;
        const n = (k: string) =>
          typeof p[k] === "number" &&
          Number.isSafeInteger(p[k]) &&
          (p[k] as number) >= 0
            ? p[k]
            : 0;
        const price = this.prices[String(p.provider)]?.[String(p.model)];
        const cost = estimateCost(
          {
            input_tokens: Number(n("input_tokens")),
            output_tokens: Number(n("output_tokens")),
            cached_input_tokens: Number(n("cached_input_tokens")),
          },
          price && price.valid_from <= new Date().toISOString()
            ? price
            : undefined,
        );
        await c.query(
          `INSERT INTO llm_requests(id,provider,model,input_tokens,output_tokens,cached_input_tokens,reasoning_tokens,status,started_at,finished_at,logical_agent_id,run_id,conversation_id,estimated_cost_usd) VALUES($1,$2,$3,$4,$5,$6,$7,'success',now(),now(),$8,$9,$10,$11)`,
          [
            randomUUID(),
            String(p.provider ?? "unknown"),
            String(p.model ?? "unknown"),
            n("input_tokens"),
            n("output_tokens"),
            n("cached_input_tokens"),
            n("reasoning_tokens"),
            r.agent_id,
            id,
            r.conversation_id,
            cost,
          ],
        );
      }
      return (
        await c.query(
          "INSERT INTO run_events(run_id,agent_id,type,payload) VALUES($1,$2,$3,$4) RETURNING *",
          [id, r.agent_id, event.type, event.payload],
        )
      ).rows[0];
    });
    if (saved) {
      this.push(event.type, saved);
      this.push("agent.run.updated", { run_id: id });
    }
  }
  async cancel(id: string) {
    const cancelled = await transaction(this.db, async (c) => {
      const root = (
        await c.query("SELECT * FROM agent_runs WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!root) throw Error("not_found");
      const rows = (
        await c.query(
          "WITH RECURSIVE t AS (SELECT id,depth FROM agent_runs WHERE id=$1 UNION ALL SELECT r.id,r.depth FROM agent_runs r JOIN t ON r.parent_run_id=t.id) SELECT r.* FROM agent_runs r JOIN t ON r.id=t.id ORDER BY t.depth,r.id FOR UPDATE OF r",
          [id],
        )
      ).rows;
      const changed = [];
      for (const r of rows) {
        if (terminal(r.status)) continue;
        await c.query(
          "UPDATE agent_runs SET status='cancelled',finished_at=now(),updated_at=now() WHERE id=$1",
          [r.id],
        );
        const event = (
          await c.query(
            "INSERT INTO run_events(run_id,agent_id,type,payload) VALUES($1,$2,'agent.run.cancelled',$3) RETURNING *",
            [r.id, r.agent_id, { title: "任务已取消", status: "cancelled" }],
          )
        ).rows[0];
        changed.push({ run: r, event });
      }
      return changed;
    });
    for (const { run, event } of cancelled) {
      this.push("agent.run.cancelled", event);
      this.push("agent.run.updated", { run_id: run.id, status: "cancelled" });
      if (run.runtime_run_id)
        try {
          await this.registry.get(run.runtime_type).cancel(run.runtime_run_id);
        } catch {
          /* The persisted terminal state remains authoritative; controller deadline limits any orphan. */
        }
    }
  }
  async input(id: string, text: string, resume = false) {
    const { run } = await this.get(id);
    if (!["waiting_for_user", "waiting_for_approval"].includes(run.status))
      throw Error("invalid_run_state");
    if (run.status === "waiting_for_approval")
      throw Error("approval_cannot_elevate_permissions");
    const runtime = this.registry.get(run.runtime_type);
    if (resume) await runtime.resume(run.runtime_run_id, { text });
    else await runtime.send(run.runtime_run_id, { text });
    await this.transition(id, "running");
  }
  async recover(terminalOnly = false) {
    // Runtime reconnection is explicit; never silently rerun side effects.
    const rows = (
      await this.db.query(
        "SELECT r.* FROM agent_runs r LEFT JOIN agent_instances i ON i.id=r.agent_instance_id WHERE ($1=false AND r.status NOT IN ('completed','failed','cancelled')) OR (r.status IN ('completed','failed','cancelled') AND i.stopped_at IS NULL AND i.id IS NOT NULL AND ($1=false OR r.updated_at<now()-interval '30 seconds'))",
        [terminalOnly],
      )
    ).rows;
    const pendingCleanup: string[] = [];
    for (const r of rows) {
      await this.transition(r.id, "failed", {
        code: "server_restarted",
        summary: "服务重启，任务未能恢复；请检查已归档结果后重新提交。",
      });
      if (r.runtime_type !== "deepseek")
        try {
          const runtime = this.registry.get(r.runtime_type);
          const workerId = r.runtime_run_id ?? r.id;
          await runtime.cancel(workerId);
          // Drain the surviving journal without repeating the original task.
          // The failed state stays authoritative; late usage and exports persist.
          for await (const event of runtime.events(
            workerId,
            AbortSignal.timeout(35000),
          )) {
            await this.ingest(r.id, event);
          }
          await runtime.dispose(workerId);
        } catch {
          if (r.agent_instance_id) pendingCleanup.push(r.agent_instance_id);
          await this.db.query(
            "INSERT INTO run_events(run_id,agent_id,type,payload) VALUES($1,$2,'agent.progress',$3)",
            [
              r.id,
              r.agent_id,
              {
                code: "restart_cleanup_pending",
                title: "Worker 归档或清理未确认，需检查控制器",
              },
            ],
          );
        }
    }

    await this.db.query(
      "UPDATE agent_instances SET status='cleanup_pending' WHERE id=ANY($1::uuid[])",
      [pendingCleanup],
    );
    await this.db.query(
      "UPDATE agent_instances SET status='offline',stopped_at=now() WHERE id=ANY($2::uuid[]) AND NOT(id=ANY($1::uuid[]))",
      [pendingCleanup, rows.map((r) => r.agent_instance_id).filter(Boolean)],
    );
  }
  async schedule() {
    if (this.stopped) return;
    if (Date.now() - this.lastCleanup > 60000) {
      this.lastCleanup = Date.now();
      await this.recover(true);
    }
    for (const type of ["codex", "pydantic"]) {
      if (this.active.has(type)) continue;
      const row = (
        await this.db.query(
          "SELECT * FROM agent_runs WHERE runtime_type=$1 AND status='queued' ORDER BY created_at LIMIT 1",
          [type],
        )
      ).rows[0];
      if (row) {
        const task = this.execute(row)
          .catch(() => {})
          .finally(() => this.active.delete(type));
        this.active.set(type, task);
      }
    }
  }
  private async execute(run: any) {
    let runtime;
    try {
      runtime = this.registry.get(run.runtime_type);
      if (!(await this.transition(run.id, "starting"))) return;
      const instance = randomUUID();
      await this.db.query(
        "INSERT INTO agent_instances(id,agent_definition_id,runtime_type,status) VALUES($1,$2,$3,'starting')",
        [instance, run.agent_id, run.runtime_type],
      );
      await this.db.query(
        "UPDATE agent_runs SET agent_instance_id=$2 WHERE id=$1",
        [run.id, instance],
      );
      if (
        run.runtime_type === "codex" &&
        run.input_json.workspace?.repository &&
        run.input_json.workspace?.commit
      ) {
        const w = run.input_json.workspace;
        await this.db.query(
          "INSERT INTO workspaces(id,repository,commit_sha,expires_at) VALUES($1,$2,$3,now()+interval '24 hours') ON CONFLICT DO NOTHING",
          [run.id, w.repository, w.commit],
        );
        await this.db.query(
          "UPDATE agent_runs SET workspace_id=$2 WHERE id=$1",
          [run.id, run.id],
        );
      }
      const started = await runtime.start({
        id: run.id,
        goal: run.goal,
        ...run.input_json,
      });
      await this.db.query(
        "UPDATE agent_runs SET runtime_run_id=$2 WHERE id=$1",
        [run.id, started.id],
      );
      if (terminal((await this.get(run.id)).run.status)) {
        await runtime.cancel(started.id);
      }
      await this.transition(run.id, "running");
      await this.db.query(
        "UPDATE agent_instances SET status='running',runtime_instance_id=$2 WHERE id=$1",
        [instance, started.id],
      );
      const timer = setTimeout(
        () => {
          void this.transition(run.id, "failed", { code: "timeout" })
            .then(() => runtime!.cancel(started.id))
            .catch(() => {});
        },
        run.runtime_type === "codex"
          ? Number(process.env.CODING_TIMEOUT_MS ?? 1800000)
          : Number(process.env.OPS_TIMEOUT_MS ?? 300000),
      );
      try {
        for await (const event of runtime.events(started.id))
          await this.ingest(run.id, event);
      } finally {
        clearTimeout(timer);
      }
      if (!terminal((await this.get(run.id)).run.status))
        await this.transition(run.id, "failed", {
          code: "runtime_disconnected",
        });
    } catch (e) {
      await this.transition(run.id, "failed", {
        code: e instanceof Error ? e.message : "runtime_failed",
      });
    } finally {
      let cleanupConfirmed = !runtime;
      if (runtime) {
        try {
          const persisted = await this.db.query(
            "SELECT count(*)::int n FROM artifacts WHERE run_id=$1",
            [run.id],
          );
          if (persisted.rows[0].n > 0) {
            await runtime.dispose(run.id);
            cleanupConfirmed = true;
          }
        } catch {
          /* Keep the Worker until its deadline when archival cannot be confirmed. */
        }
      }
      await this.db.query(
        "UPDATE agent_instances SET status=CASE WHEN $2 THEN 'stopped' ELSE 'cleanup_pending' END,stopped_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=(SELECT agent_instance_id FROM agent_runs WHERE id=$1)",
        [run.id, cleanupConfirmed],
      );
    }
  }
  async close() {
    this.stopped = true;
    for (const row of (
      await this.db.query(
        "SELECT id FROM agent_runs WHERE status NOT IN ('completed','failed','cancelled')",
      )
    ).rows)
      await this.cancel(row.id);
    await Promise.allSettled(this.active.values());
  }
}
