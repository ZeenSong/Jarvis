import { estimateCost, type Prices } from "../../llm-usage/src/index.js";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Database } from "../../../apps/server/src/persistence.js";
import { LeaseStore, workerIdentity } from "../../leases/src/index.js";
import {
  RuntimeRegistry,
  canTransition,
  childDepth,
  terminal,
  type RunStatus,
  type AgentEvent,
} from "../../agent-runtime/src/index.js";
export type Push = (topic: string, payload: unknown) => void;
export type TaskExecutionMode = "auto" | "background" | "durable";
export type TaskRisk = "read" | "write" | "execute";
export type TaskRequest = {
  goal: string;
  execution_mode: TaskExecutionMode;
  required_capabilities: string[];
  constraints: { max_risk: TaskRisk; workspace_required: boolean };
};
type TaskExecutorConfig = {
  capabilities: string[];
  modes: TaskExecutionMode[];
  max_risk: TaskRisk;
  supports_workspace: boolean;
  priority: number;
  timeout_ms?: number;
};
const riskRank: Record<TaskRisk, number> = { read: 0, write: 1, execute: 2 };
const capabilityMatches = (offered: string, required: string) =>
  offered === "*" || offered === required || (offered.endsWith(".*") && required.startsWith(offered.slice(0, -1)));
function taskExecutorConfig(value: unknown): TaskExecutorConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const task = (value as Record<string, unknown>).task;
  if (!task || typeof task !== "object") return undefined;
  const config = task as Record<string, unknown>;
  const capabilities = Array.isArray(config.capabilities) ? config.capabilities.filter((item): item is string => typeof item === "string") : [];
  const modes = Array.isArray(config.modes) ? config.modes.filter((item): item is TaskExecutionMode => ["auto", "background", "durable"].includes(String(item))) : [];
  const maxRisk = ["read", "write", "execute"].includes(String(config.max_risk)) ? config.max_risk as TaskRisk : "read";
  const priority = Number(config.priority ?? 0);
  const timeout = Number(config.timeout_ms);
  return {
    capabilities,
    modes: modes.length ? modes : ["auto", "background", "durable"],
    max_risk: maxRisk,
    supports_workspace: config.supports_workspace === true,
    priority: Number.isFinite(priority) ? priority : 0,
    ...(Number.isFinite(timeout) && timeout > 0 ? { timeout_ms: timeout } : {}),
  };
}
export function rankTaskExecutors(definitions: any[], availableRuntimeTypes: Iterable<string>, request: TaskRequest) {
  const available = new Set(availableRuntimeTypes);
  return definitions.flatMap((definition: any) => {
    const config = taskExecutorConfig(definition.runtime_config);
    if (!config || !definition.enabled || definition.tier !== "managed" || !available.has(definition.runtime_type)) return [];
    if (request.execution_mode !== "auto" && !config.modes.includes(request.execution_mode) && !config.modes.includes("auto")) return [];
    if (riskRank[config.max_risk] < riskRank[request.constraints.max_risk]) return [];
    if (request.constraints.workspace_required && !config.supports_workspace) return [];
    if (!request.required_capabilities.every((required) => config.capabilities.some((offered) => capabilityMatches(offered, required)))) return [];
    return [{ definition, config }];
  }).sort((a, b) => b.config.priority - a.config.priority || String(a.definition.id).localeCompare(String(b.definition.id)));
}
async function ownerUserId(db: Database, owner: string) {
  if (owner.startsWith("user-")) return owner.slice(5) || null;
  const row = (await db.query("SELECT user_id::text FROM devices WHERE id=$1", [owner])).rows[0];
  return row?.user_id ?? null;
}
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
  /**
   * Local concurrency accounting only. It is not a correctness mechanism: the
   * database claim and the run lease are what make two processes safe.
   */
  private active = new Map<string, Promise<void>>();
  private stopped = false;
  private lastCleanup = Date.now();
  /** Long enough to absorb a slow start, short enough to failover quickly. */
  private static readonly LEASE_TTL = 60;
  private readonly workerId = workerIdentity();
  constructor(
    readonly db: Database,
    readonly registry: RuntimeRegistry,
    readonly push: Push,
    readonly prices: Prices = {},
    readonly onApproval?: (run: { id: string; requested_by: string }, event: AgentEvent) => Promise<void>,
    readonly onTaskStatus?: (runId: string, status: string, payload: Record<string, unknown>) => Promise<void>,
    readonly leases: LeaseStore = new LeaseStore(db),
  ) {}
  async selectExecutor(c: PoolClient, request: TaskRequest) {
    const definitions = (await c.query("SELECT * FROM agent_definitions WHERE enabled=true AND tier='managed' ORDER BY id")).rows;
    const candidates = rankTaskExecutors(definitions, this.registry.types(), request);
    const selected = candidates[0];
    if (!selected) throw Error("task_executor_unavailable");
    return selected;
  }
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
      workspace_id?: string;
      parent_run_id?: string;
      goal: string;
      input?: unknown;
    },
    device: string,
  ) {
    const userId = await ownerUserId(this.db, device);
    const definition = (
      await c.query("SELECT * FROM agent_definitions WHERE id=$1 AND enabled", [
        p.agent_id,
      ])
    ).rows[0];
    if (!definition) throw Error("agent_not_found");
    if (p.conversation_id && !(await c.query("SELECT 1 FROM conversations WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3)", [p.conversation_id, device, userId])).rowCount)
      throw Error("not_found");
    if (p.workspace_id && !(await c.query("SELECT 1 FROM workspace_records WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3)", [p.workspace_id, device, userId])).rowCount)
      throw Error("not_found");
    let depth = definition.tier === "core" ? 0 : 1;
    if (p.parent_run_id) {
      const parent = (
        await c.query("SELECT * FROM agent_runs WHERE id=$1 FOR UPDATE", [
          p.parent_run_id,
        ])
      ).rows[0];
      if (
        !parent ||
        (parent.requested_by !== device && parent.requested_by_user_id !== userId && !(userId == null && parent.requested_by_user_id == null)) ||
        terminal(parent.status) ||
        parent.conversation_id !== (p.conversation_id ?? null)
      )
        throw Error("invalid_parent");
      depth = childDepth(parent.depth);
    }
    if (definition.tier === "core" && p.parent_run_id)
      throw Error("invalid_core_parent");
    const runtimeType = definition.runtime_type;
    const run = (
      await c.query(
        `INSERT INTO agent_runs(id,agent_id,parent_run_id,conversation_id,requested_by,requested_by_user_id,durable_workspace_id,goal,runtime_type,status,depth,input_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10,$11) RETURNING *`,
        [
          randomUUID(),
          p.agent_id,
          p.parent_run_id ?? null,
          p.conversation_id ?? null,
          device,
          userId,
          p.workspace_id ?? null,
          p.goal,
          runtimeType,
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
  async get(id: string, owner?: string) {
    const userId = owner ? await ownerUserId(this.db, owner) : null;
    const run = (
      await this.db.query(owner ? "SELECT * FROM agent_runs WHERE id=$1 AND (requested_by=$2 OR requested_by_user_id=$3)" : "SELECT * FROM agent_runs WHERE id=$1", owner ? [id, owner, userId] : [id])
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
      const status = String(event.payload.status ?? "");
      const taskTopic = status === "running" ? "task.started" : ["waiting_for_user", "waiting_for_approval"].includes(status) ? "task.waiting" : ["completed", "failed", "cancelled"].includes(status) ? `task.${status}` : undefined;
      if (taskTopic) {
        this.push(taskTopic, { task_id: id, run_id: id, status, payload: event.payload });
        if (this.onTaskStatus && ["waiting_for_user", "completed", "failed"].includes(status))
          await this.onTaskStatus(id, status, event.payload as Record<string, unknown>);
      }
    }
    return !!event;
  }
  private async archive(
    c: PoolClient,
    id: string,
    payload: Record<string, unknown>,
  ) {
    const run = (await c.query("SELECT requested_by,requested_by_user_id FROM agent_runs WHERE id=$1", [id])).rows[0];
    for (const [name, media, content] of [
      ["result.json", "application/json", JSON.stringify(payload)],
      ...(typeof payload.diff === "string"
        ? [["changes.diff", "text/x-diff", payload.diff]]
        : []),
    ] as string[][]) {
      await c.query(
        "INSERT INTO artifacts(id,run_id,owner_device_id,owner_user_id,name,media_type,content,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+$8*interval '1 day') ON CONFLICT(run_id,name) DO UPDATE SET owner_device_id=excluded.owner_device_id,owner_user_id=excluded.owner_user_id,content=excluded.content,expires_at=excluded.expires_at",
        [
          randomUUID(),
          id,
          run?.requested_by ?? null,
          run?.requested_by_user_id ?? null,
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
    if (event.type === "agent.approval.required" && !event.payload.denied && this.onApproval) {
      const run = (await this.db.query("SELECT id,requested_by FROM agent_runs WHERE id=$1", [id])).rows[0];
      if (run) await this.onApproval(run, event);
    }
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
  async cancel(id: string, owner?: string) {
    const userId = owner ? await ownerUserId(this.db, owner) : null;
    const cancelled = await transaction(this.db, async (c) => {
      const root = (
        await c.query(owner ? "SELECT * FROM agent_runs WHERE id=$1 AND (requested_by=$2 OR requested_by_user_id=$3) FOR UPDATE" : "SELECT * FROM agent_runs WHERE id=$1 FOR UPDATE", owner ? [id, owner, userId] : [id])
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
  async input(id: string, text: string, resume = false, owner?: string) {
    const { run } = await this.get(id, owner);
    if (!["waiting_for_user", "waiting_for_approval"].includes(run.status))
      throw Error("invalid_run_state");
    if (run.status === "waiting_for_approval")
      throw Error("approval_cannot_elevate_permissions");
    const runtime = this.registry.get(run.runtime_type);
    if (resume) await runtime.resume(run.runtime_run_id, { text });
    else await runtime.send(run.runtime_run_id, { text });
    await this.transition(id, "running");
  }
  async approve(id: string, owner?: string) {
    const { run } = await this.get(id, owner);
    if (run.status !== "waiting_for_approval") throw Error("invalid_run_state");
    const runtime = this.registry.get(run.runtime_type);
    await runtime.resume(run.runtime_run_id);
    await this.transition(id, "running");
    return { resumed: true };
  }
  /**
   * Recovery, split into two responsibilities that used to share one query and
   * one failure branch.
   *
   * 1. Runs that nobody holds can never be resumed (runtime state is
   *    process-local), so they are failed explicitly. "Nobody holds" is decided
   *    by the lease, not by "I just started": another replica may legitimately be
   *    running a task while this one boots.
   * 2. Instances whose run is already terminal but never recorded `stopped_at`
   *    are cleaned up with bounded, backed-off attempts.
   *
   * The previous implementation retried step 2 every minute forever whenever
   * `runtime.events()` threw `run_not_found`, which is *always* true after a
   * restart. That appended one event per minute per leaked instance: 121k rows
   * over 30 days in production. Cleanup is now idempotent, bounded and silent.
   */
  async recover(terminalOnly = false) {
    if (!terminalOnly) await this.sweepOrphanedRuns();
    await this.sweepInstanceCleanup();
  }

  /**
   * Fail executions whose lease expired. Queued runs are left alone — they were
   * never claimed, so they should simply be picked up by whichever worker is
   * alive. Waiting states are left alone too: they are not executing.
   */
  private async sweepOrphanedRuns() {
    const rows = (
      await this.db.query(
        `SELECT r.id FROM agent_runs r
          WHERE r.status IN ('starting','running')
            AND NOT EXISTS (
              SELECT 1 FROM leases l
               WHERE l.kind='agent-run:'||r.id::text AND l.expires_at > now()
            )`,
      )
    ).rows;
    for (const r of rows) {
      await this.transition(r.id, "failed", {
        code: "worker_lost",
        summary: "执行进程已退出，任务未能恢复；请重新提交。",
      });
    }
  }

  private static readonly CLEANUP_MAX_ATTEMPTS = 5;

  private async sweepInstanceCleanup() {
    const rows = (
      await this.db.query(
        `SELECT r.id, r.agent_id, r.runtime_type, r.runtime_run_id,
                i.id AS instance_id, i.cleanup_attempts
           FROM agent_runs r
           JOIN agent_instances i ON i.id = r.agent_instance_id
          WHERE r.status IN ('completed','failed','cancelled')
            AND i.stopped_at IS NULL
            AND i.cleanup_abandoned_at IS NULL
            AND (i.cleanup_next_attempt_at IS NULL OR i.cleanup_next_attempt_at <= now())
          ORDER BY i.cleanup_next_attempt_at NULLS FIRST
          LIMIT 20`,
      )
    ).rows;

    for (const r of rows) {
      const attempts = Number(r.cleanup_attempts ?? 0) + 1;
      let confirmed = false;
      try {
        const runtime = this.registry.get(r.runtime_type);
        const workerId = r.runtime_run_id ?? r.id;
        await runtime.cancel(workerId);
        // Drain any surviving journal without repeating the original task.
        try {
          for await (const event of runtime.events(workerId, AbortSignal.timeout(10_000))) {
            await this.ingest(r.id, event);
          }
        } catch (error) {
          // An unknown run has nothing to drain. This is the normal case after a
          // restart and must not be reported as a cleanup failure.
          if (!(error instanceof Error) || error.message !== "run_not_found") throw error;
        }
        await runtime.dispose(workerId);
        confirmed = true;
      } catch {
        confirmed = false;
      }

      if (confirmed) {
        await this.db.query(
          "UPDATE agent_instances SET status='stopped', stopped_at=now(), cleanup_attempts=$2, cleanup_last_attempt_at=now(), cleanup_next_attempt_at=NULL WHERE id=$1",
          [r.instance_id, attempts],
        );
      } else if (attempts >= AgentManager.CLEANUP_MAX_ATTEMPTS) {
        await this.db.query(
          "UPDATE agent_instances SET status='cleanup_abandoned', stopped_at=now(), cleanup_abandoned_at=now(), cleanup_attempts=$2, cleanup_last_attempt_at=now(), cleanup_next_attempt_at=NULL WHERE id=$1",
          [r.instance_id, attempts],
        );
        // Exactly one event when we give up, never one per attempt.
        await this.db.query(
          "INSERT INTO run_events(run_id,agent_id,type,payload) VALUES($1,$2,'agent.progress',$3)",
          [
            r.id,
            r.agent_id,
            { code: "cleanup_abandoned", title: "执行实例清理未确认，已停止自动重试" },
          ],
        );
      } else {
        const delaySeconds = Math.min(3600, 60 * 2 ** (attempts - 1));
        await this.db.query(
          "UPDATE agent_instances SET status='cleanup_pending', cleanup_attempts=$2, cleanup_last_attempt_at=now(), cleanup_next_attempt_at=now()+$3*interval '1 second' WHERE id=$1",
          [r.instance_id, attempts, delaySeconds],
        );
      }
    }
  }

  async schedule() {
    if (this.stopped) return;
    if (Date.now() - this.lastCleanup > 60000) {
      this.lastCleanup = Date.now();
      await this.recover(true);
      // Claimed executions from a dead worker must not stay 'running' forever.
      await this.sweepOrphanedRuns();
    }
    for (const type of this.registry.types()) {
      if (this.active.has(type)) continue;
      const run = await this.claim(type);
      if (!run) continue;
      const kind = `agent-run:${run.id}`;
      const guard = this.leases.guard(kind, this.workerId, AgentManager.LEASE_TTL);
      const task = this.execute(run)
        .catch(() => {})
        .finally(async () => {
          guard.stop();
          this.active.delete(type);
          await this.leases.release(kind, this.workerId).catch(() => {});
        });
      this.active.set(type, task);
    }
  }

  /**
   * Claim one queued run and take its lease in a single transaction. Taking the
   * lease in the same transaction as the status change removes the window where
   * a run looks claimed but unowned — the shape that made the orphan sweep and
   * the claimer race against each other.
   *
   * `SKIP LOCKED` also means two processes never even look at the same row.
   */
  private async claim(type: string) {
    return transaction(this.db, async (c) => {
      const row = (
        await c.query(
          "SELECT * FROM agent_runs WHERE runtime_type=$1 AND status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
          [type],
        )
      ).rows[0];
      if (!row) return undefined;
      const lease = await this.leases.acquire(`agent-run:${row.id}`, this.workerId, AgentManager.LEASE_TTL, {
        agent_id: row.agent_id,
        runtime_type: type,
      });
      if (!lease.acquired) return undefined;
      await c.query(
        "UPDATE agent_runs SET status='starting',updated_at=now() WHERE id=$1 AND status='queued'",
        [row.id],
      );
      return { ...row, status: "starting" };
    });
  }

  private async execute(run: any) {
    let runtime;
    let runtimeRunId: string | undefined;
    try {
      runtime = this.registry.get(run.runtime_type);
      const instance = randomUUID();
      await this.db.query(
        "INSERT INTO agent_instances(id,agent_definition_id,runtime_type,status) VALUES($1,$2,$3,'starting')",
        [instance, run.agent_id, run.runtime_type],
      );
      await this.db.query(
        "UPDATE agent_runs SET agent_instance_id=$2 WHERE id=$1",
        [run.id, instance],
      );
      if (run.input_json.workspace?.repository && run.input_json.workspace?.commit) {
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
        owner_device_id: run.requested_by,
      });
      runtimeRunId = started.id;
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
        Number(run.input_json.timeout_ms ?? process.env.TASK_TIMEOUT_MS ?? 300000),
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
      let cleanupConfirmed = !runtime || !runtimeRunId;
      if (runtime && runtimeRunId) {
        try {
          // Disposal is required even when a runtime produced no artifact;
          // passing the runtime id avoids leaking Hermes in-memory sessions.
          await runtime.dispose(runtimeRunId);
          cleanupConfirmed = true;
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
    // Cancel only what this process holds. The old query cancelled every
    // non-terminal run, including ones another replica was executing.
    for (const row of (
      await this.db.query(
        `SELECT r.id FROM agent_runs r
           JOIN leases l ON l.kind='agent-run:'||r.id::text AND l.owner=$1
          WHERE r.status NOT IN ('completed','failed','cancelled')`,
        [this.workerId],
      )
    ).rows)
      await this.cancel(row.id);
    await Promise.allSettled(this.active.values());
  }
}

// M3.1 terminology: AgentManager is now the durable Task/Execution boundary.
// Keep the legacy class name for wire/database compatibility while exposing
// migration-safe aliases to new integrations.
export { AgentManager as TaskManager, AgentManager as ExecutionManager };
