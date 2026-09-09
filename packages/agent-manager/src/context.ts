// Bounded model context. The full events, artifacts and metrics remain queryable by clients.
const fields = (value: any, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => value?.[k] !== undefined).map((k) => [k, value[k]]),
  );
const short = (value: unknown, max = 2000) =>
  typeof value === "string" && value.length > max
    ? value.slice(0, max) + "\n[内容截断；完整数据保留在资源中]"
    : value;
export function runContext(value: any) {
  return {
    run: {
      ...fields(value.run, [
        "id",
        "agent_id",
        "parent_run_id",
        "status",
        "depth",
        "started_at",
        "finished_at",
        "error_json",
      ]),
      goal: short(value.run?.goal, 1000),
      summary: short(value.run?.result_json?.summary, 3000),
    },
    usage: value.usage,
    tree: value.tree,
    events: (value.events ?? [])
      .filter((e: any) => e.type !== "agent.message.delta")
      .slice(-20)
      .map((e: any) => ({
        type: e.type,
        timestamp: e.timestamp,
        payload: {
          ...fields(e.payload, [
            "title",
            "tool",
            "exit_code",
            "code",
            "status",
          ]),
          output: short(e.payload?.output, 500),
        },
      })),
    artifacts: (value.artifacts ?? []).map((a: any) => ({
      ...fields(a, ["id", "name", "media_type"]),
      characters: a.content?.length ?? 0,
    })),
    context_note:
      "仅提供结果摘要、最近 20 个非文本增量事件及产物索引；完整 Diff、日志仍保存在 Run 资源中。",
  };
}
export function metricsContext(value: any) {
  const all = value.samples ?? [];
  const snapshot = (s: any) => ({
    sampled_at: s.sampled_at,
    missing: s.missing ?? false,
    cpu_percent: s.data?.cpu?.usage_percent ?? null,
    memory_percent: s.data?.memory?.usage_percent ?? null,
    gpu_percent: s.data?.gpu?.utilization_percent ?? null,
  });
  const rows = all.map(snapshot);
  const stats = Object.fromEntries(
    ["cpu_percent", "memory_percent", "gpu_percent"].map((k) => {
      const values = rows
        .map((r: any) => r[k])
        .filter((n: any) => typeof n === "number" && Number.isFinite(n));
      return [
        k,
        {
          count: values.length,
          min: values.length ? Math.min(...values) : null,
          max: values.length ? Math.max(...values) : null,
          mean: values.length
            ? values.reduce((a: number, b: number) => a + b, 0) / values.length
            : null,
        },
      ];
    }),
  );
  const samples =
    rows.length <= 24
      ? rows
      : Array.from(
          { length: 24 },
          (_, i) => rows[Math.round((i * (rows.length - 1)) / 23)],
        );
  return {
    coverage: value.coverage,
    total_samples: rows.length,
    gap_markers: rows.filter((r: any) => r.missing).length,
    statistics: stats,
    samples,
    sampling_note:
      "统计量基于全部可用采样；列表最多 24 个等间隔代表性快照。缺失区间不参与统计，不能据此推断未采集时段。",
  };
}
export function definitionsContext(value: any) {
  return {
    definitions: value.definitions,
    instances: (value.instances ?? [])
      .slice(0, 20)
      .map((r: any) =>
        fields(r, [
          "id",
          "agent_definition_id",
          "status",
          "started_at",
          "stopped_at",
        ]),
      ),
    runs: (value.runs ?? [])
      .slice(0, 20)
      .map((r: any) =>
        fields(r, [
          "id",
          "agent_id",
          "parent_run_id",
          "status",
          "depth",
          "created_at",
        ]),
      ),
    context_note:
      "仅列最近 20 个 Run 与 Worker；详情通过 agent.run.read 查询。",
  };
}
