import type { ViewSpec } from "../../ui-protocol/src/index.js";

/**
 * Declarative view types.
 *
 * The four dashboards used to be one `if / else if / else` chain, with the v1
 * blocks, the v2 intent and the task-specific presentation rules each hard-coded
 * in a different place. Adding a view meant editing three files and hoping the
 * chains stayed aligned.
 *
 * A view type is now one table entry: a title, the resource it is *about*, its
 * blocks, and — where a block needs a different v2 presentation — a hint on that
 * block. `preset()` turns an entry into a v1 `ViewSpec` (hints stripped) and
 * `semanticView()` reads the same hints back when it composes the v2 view, so
 * the two layers cannot drift apart.
 *
 * A v2-only view needs no entry at all: `ui_view_show` accepts a complete
 * `viewSpecSchema` document, so a new result shape can be produced by the model
 * without a code change. The table exists for the legacy intents that clients
 * still ask for by name.
 */

/** Resolved to the `agent-run/<id>` resource the request points at. */
const MATCHED = "$matched";

export type PresetAction = { type: string; target?: string };

export type PresetBlock = {
  type: string;
  title: string;
  resource?: string;
  path?: string;
  text?: string;
  action?: PresetAction;
  /** Emit this component name in the v2 view instead of `type`. */
  v2Component?: string;
  /** Read this path in the v2 view instead of `path`. */
  v2Path?: string;
  /**
   * Drop the block once the source resource reports a terminal status.
   * `always` always drops it; `empty` drops it only when its value is empty.
   */
  terminalDrop?: "always" | "empty";
};

export type ViewType = {
  title: string;
  /** Intent recorded on the v2 view, for the host policy and client hints. */
  v2Intent: string;
  /** Resource prefix this view is *about*; the request must supply a match. */
  matchPrefix?: string;
  blocks: readonly PresetBlock[];
  /** Compose a usage leaderboard summary metric before the blocks. */
  usageInsight?: boolean;
  /** Append the run's event log as a section. */
  runEvents?: boolean;
};

const systemOverview: ViewType = {
  title: "私人云 · 现在",
  v2Intent: "overview",
  blocks: [
    { type: "gauge", title: "CPU %", resource: "system/status", path: "cpu.usage_percent" },
    { type: "gauge", title: "内存 %", resource: "system/status", path: "memory.usage_percent" },
    { type: "gauge", title: "GPU %", resource: "system/status", path: "gpu.utilization_percent" },
    { type: "line_chart", title: "CPU / GPU 历史", resource: "system/metrics", path: "samples" },
    { type: "status_grid", title: "服务状态", resource: "system/status", path: "jarvis" },
    { type: "metric_group", title: "今日 Token 与费用", resource: "llm/usage/today", path: "total" },
  ],
};

export const viewTypes = {
  system_overview: systemOverview,
  network_overview: {
    title: "服务器网络",
    v2Intent: "overview",
    blocks: [{ type: "status_grid", title: "网络状态", resource: "system/network" }],
  },
  usage_analysis: {
    title: "AI 用量",
    v2Intent: "overview",
    usageInsight: true,
    blocks: [
      { type: "table", title: "会话消耗排行 · Top 10", resource: "llm/usage/today", path: "top_conversations" },
      { type: "metric_group", title: "今日用量 · UTC", resource: "llm/usage/today", path: "total" },
      { type: "donut", title: "供应商", resource: "llm/usage/today", path: "providers" },
      { type: "bar_chart", title: "智能体用量", resource: "llm/usage/agents", path: "groups" },
      { type: "line_chart", title: "每小时 Token", resource: "llm/usage/hourly", path: "series" },
    ],
  },
  agent_run_analysis: {
    title: "任务详情",
    v2Intent: "review_task",
    matchPrefix: "agent-run/",
    runEvents: true,
    blocks: [
      { type: "run_graph", title: "任务关系", resource: MATCHED, path: "tree" },
      { type: "status_grid", title: "任务状态", resource: MATCHED, path: "run", v2Component: "task" },
      { type: "metric_group", title: "Token 用量", resource: MATCHED, path: "usage" },
      { type: "timeline", title: "执行过程", resource: MATCHED, path: "events" },
      { type: "markdown", title: "结果", resource: MATCHED, path: "run.result_json.summary" },
      { type: "code_diff", title: "代码变更", resource: MATCHED, path: "run.result_json.diff", terminalDrop: "empty" },
      {
        type: "table",
        title: "测试与产物",
        resource: MATCHED,
        path: "artifacts",
        v2Component: "list",
        v2Path: "presentation.artifacts",
      },
      { type: "action", title: "补充任务输入", action: { type: "run.input", target: MATCHED }, terminalDrop: "always" },
      { type: "action", title: "取消任务", action: { type: "run.cancel", target: MATCHED }, terminalDrop: "always" },
    ],
  },
} satisfies Record<string, ViewType>;

export type ViewTypeName = keyof typeof viewTypes;

export const defaultViewType: ViewTypeName = "system_overview";

/** The type an intent resolves to, or `undefined` when the intent is unknown. */
export function findViewType(intent: string): ViewType | undefined {
  return (viewTypes as Record<string, ViewType>)[intent];
}

/**
 * Turn one table entry into v1 blocks. The `$matched` placeholder becomes the
 * resource the request supplied; presentation hints are dropped because the v1
 * schema is strict and the v2 layer reads them from the table instead.
 */
export function composeBlocks(type: ViewType, matched: string | undefined): ViewSpec["blocks"] {
  return type.blocks.map((block) => {
    const { v2Component, v2Path, terminalDrop, action, resource, ...rest } = block;
    const resolvedAction = action && matched
      ? { ...action, ...(action.target === MATCHED ? { target: matched.split("/")[1] } : {}) }
      : action;
    return {
      ...rest,
      ...(resource === MATCHED ? { resource: matched } : resource ? { resource } : {}),
      ...(resolvedAction ? { action: resolvedAction } : {}),
    } as ViewSpec["blocks"][number];
  });
}
