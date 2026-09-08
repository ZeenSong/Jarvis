import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "../../../apps/server/src/persistence.js";
import { usageSchema, type Usage } from "../../protocol/src/index.js";
export type Price = {
  input_per_million: number;
  output_per_million: number;
  cached_input_per_million: number;
  valid_from: string;
};
export type Prices = Record<string, Record<string, Price>>;
export function estimateCost(
  u: Pick<Usage, "input_tokens" | "output_tokens" | "cached_input_tokens">,
  p?: Price,
) {
  return p
    ? (Math.max(0, u.input_tokens - u.cached_input_tokens) *
        p.input_per_million +
        u.cached_input_tokens * p.cached_input_per_million +
        u.output_tokens * p.output_per_million) /
        1e6
    : null;
}
export const querySchema = z.object({
  range: z.enum(["today", "7d", "30d", "month", "custom"]).default("today"),
  group_by: z.enum(["provider", "model", "agent"]).default("provider"),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  agent_id: z.string().optional(),
});
export function bounds(query: unknown, now = new Date()) {
  const q = querySchema.parse(query);
  let from = new Date(now),
    to = new Date(now);
  if (q.range === "custom") {
    if (!q.from || !q.to) throw new Error("custom_range_requires_from_to");
    from = new Date(q.from);
    to = new Date(q.to);
  } else if (q.range === "today") from.setUTCHours(0, 0, 0, 0);
  else if (q.range === "month") {
    from.setUTCDate(1);
    from.setUTCHours(0, 0, 0, 0);
  } else
    from = new Date(now.getTime() - (q.range === "7d" ? 7 : 30) * 86400000);
  if (from >= to) throw new Error("invalid_time_range");
  return { ...q, from, to };
}
export class UsageCollector {
  constructor(
    private db: Database,
    private prices: Prices,
    private emit: (topic: string, payload: unknown) => void,
  ) {}
  async record(payload: unknown, owner: string) {
    const u = usageSchema.parse(payload);
    if (
      u.cached_input_tokens > u.input_tokens ||
      new Date(u.finished_at) < new Date(u.started_at)
    )
      throw new Error("invalid_usage");
    const owned = await this.db.query(
      "SELECT id FROM agents WHERE id=$1 AND owner_device_id=$2",
      [u.agent_id, owner],
    );
    if (!owned.rowCount) throw new Error("agent_not_owned");
    const p = this.prices[u.provider]?.[u.model];
    const cost = estimateCost(
      u,
      p && p.valid_from <= u.started_at ? p : undefined,
    );
    const r = await this.db.query(
      `INSERT INTO llm_requests(id,request_id,agent_id,provider,model,input_tokens,output_tokens,cached_input_tokens,reasoning_tokens,latency_ms,status,error_type,estimated_cost_usd,started_at,finished_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(id) DO NOTHING RETURNING id`,
      [
        u.id,
        u.request_id,
        u.agent_id,
        u.provider,
        u.model,
        u.input_tokens,
        u.output_tokens,
        u.cached_input_tokens,
        u.reasoning_tokens,
        u.latency_ms,
        u.status,
        u.error_type,
        cost,
        u.started_at,
        u.finished_at,
      ],
    );
    if (r.rowCount) {
      this.emit("llm.request.completed", { ...u, estimated_cost_usd: cost });
      this.emit("llm.usage.changed", { agent_id: u.agent_id });
    }
    return { id: u.id, inserted: !!r.rowCount };
  }
  async summary(query: unknown) {
    const q = bounds(query);
    const group = {
      provider: "provider",
      model: "provider,model",
      agent: "agent_id",
    }[q.group_by];
    const fields = `COALESCE(sum(input_tokens),0)::float8 AS input_tokens,COALESCE(sum(output_tokens),0)::float8 AS output_tokens,COALESCE(sum(cached_input_tokens),0)::float8 AS cached_input_tokens,COALESCE(sum(reasoning_tokens),0)::float8 AS reasoning_tokens,count(*)::int AS requests,count(*) FILTER(WHERE status='error')::int AS errors,sum(estimated_cost_usd)::float8 AS estimated_cost_usd,count(*) FILTER(WHERE estimated_cost_usd IS NULL)::int AS unpriced_requests,percentile_cont(0.95) WITHIN GROUP(ORDER BY latency_ms) AS p95_latency_ms`;
    const where =
      "FROM llm_requests WHERE started_at >= $1 AND started_at < $2 AND ($3::text IS NULL OR agent_id=$3)";
    const params = [q.from, q.to, q.agent_id ?? null];
    const [total, groups] = await Promise.all([
      this.db.query(`SELECT ${fields} ${where}`, params),
      this.db.query(
        `SELECT ${group},${fields} ${where} GROUP BY ${group} ORDER BY requests DESC`,
        params,
      ),
    ]);
    return {
      range: q.range,
      group_by: q.group_by,
      timezone: "UTC",
      from: q.from,
      to: q.to,
      total: total.rows[0],
      groups: groups.rows,
      ...(q.group_by === "provider" ? { providers: groups.rows } : {}),
    };
  }
}
/** OpenAI-compatible Chat Completions transport; response usage is authoritative. */
export class LlmClient {
  constructor(
    private config: {
      baseUrl: string;
      apiKey: string;
      provider: string;
      agentId: string;
      timeoutMs?: number;
      maxTokens?: number;
    },
    private report: (usage: Usage) => Promise<unknown>,
  ) {}
  async complete(
    model: string,
    messages: { role: "system" | "user" | "assistant"; content: string }[],
  ) {
    const started = new Date(),
      u: Usage = {
        id: randomUUID(),
        agent_id: this.config.agentId,
        provider: this.config.provider,
        model,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        reasoning_tokens: 0,
        latency_ms: 0,
        status: "error",
        started_at: started.toISOString(),
        finished_at: started.toISOString(),
      };
    let result: any, error: unknown;
    try {
      const response = await fetch(
        this.config.baseUrl.replace(/\/$/, "") + "/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            ...(this.config.maxTokens
              ? { max_tokens: this.config.maxTokens }
              : {}),
          }),
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 60000),
        },
      );
      if (!response.ok) throw new Error(`provider_http_${response.status}`);
      result = await response.json();
      u.request_id = result.id;
      u.model = result.model ?? model;
      const usage = result.usage ?? {};
      u.input_tokens = usage.prompt_tokens ?? 0;
      u.output_tokens = usage.completion_tokens ?? 0;
      u.cached_input_tokens =
        usage.prompt_tokens_details?.cached_tokens ??
        usage.prompt_cache_hit_tokens ??
        0;
      u.reasoning_tokens =
        usage.completion_tokens_details?.reasoning_tokens ?? 0;
      u.status = "success";
    } catch (e) {
      error = e;
      u.error_type =
        e instanceof Error
          ? e.name === "TimeoutError"
            ? "timeout"
            : e.message.slice(0, 100)
          : "unknown";
    }
    u.finished_at = new Date().toISOString();
    u.latency_ms = Date.now() - started.getTime();
    // Reporting failure is visible to the caller; never silently lose accounting.
    await this.report(u);
    if (error) throw error;
    return result;
  }
}
