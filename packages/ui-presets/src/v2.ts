import { viewSpecSchema } from "../../ui-protocol-v2/src/index.js";
import { readPath, type ViewSpec, type Resource } from "../../ui-protocol/src/index.js";
import { findViewType } from "./registry.js";

/**
 * Compose the v2 view from a v1 view plus real resources.
 *
 * Everything that differs per view type lives in the registry entry: the v2
 * intent, whether to lead with a usage insight, and per-block presentation
 * hints. This function used to branch on `id === "agent_run_analysis"` in five
 * places, which meant a fifth view type would have needed five more branches.
 */
export function semanticView(id: string, view: ViewSpec, resources: Map<string, Resource>) {
  const type = findViewType(id);
  /**
   * Hints are positional, so they only apply when the incoming view really is the
   * one this table entry produces. A caller-supplied view of a different shape is
   * composed generically instead of being silently reinterpreted.
   */
  const hintFor = (index: number) => {
    const block = type?.blocks[index];
    return block && view.blocks[index]?.type === block.type ? block : undefined;
  };
  const usage = resources.get("llm/usage/today")?.data as { top_conversations?: unknown } | undefined;
  const leader = type?.usageInsight && Array.isArray(usage?.top_conversations)
    ? usage.top_conversations[0] as Record<string, unknown> | undefined
    : undefined;
  const usageInsight = typeof leader?.title === "string" && Number.isFinite(Number(leader.tokens))
    ? [{
        id: "usage-highest-conversation", role: "summary" as const, component: "metric", component_version: 2,
        title: `最高消耗会话 · ${leader.title}`,
        data: `${new Intl.NumberFormat("zh-CN").format(Number(leader.tokens))} Token`,
        fallback: "今天暂无会话用量记录。", actions: [], priority: 100,
      }, {
        id: "usage-highest-share", role: "summary" as const, component: "metric_group", component_version: 2,
        title: "占今日总用量", data: {
          "占比": `${Number(leader.share_percent ?? 0).toFixed(1)}%`,
          "请求数": Number(leader.requests ?? 0),
        }, fallback: "今天暂无会话用量记录。", actions: [], priority: 100,
      }]
    : [];
  return viewSpecSchema.parse({
    ui_protocol: "2.0", id, revision: Math.max(0, ...[...resources.values()].map((r) => Number(r.revision))),
    intent: type?.v2Intent ?? "overview", title: view.title,
    layout: { type: "workspace" }, fallback: "此视图暂时无法显示，请刷新或更新客户端。",
    sections: [...usageInsight, ...view.blocks.flatMap((block, index) => {
      const hint = hintFor(index);
      const resource = block.resource ?? (block.action?.target ? `agent-run/${block.action.target}` : undefined);
      if (hint?.terminalDrop) {
        const status = resource ? readPath(resources.get(resource)?.data, "run.status") : undefined;
        const terminal = ["completed", "failed", "cancelled"].includes(String(status));
        if (terminal) {
          // A finished task has nothing left to cancel or extend, and an empty
          // diff is noise rather than evidence.
          if (hint.terminalDrop === "always") return [];
          if (!readPath(resources.get(resource!)?.data, block.path)) return [];
        }
      }
      const path = hint?.v2Path ?? block.path;
      const component = hint?.v2Component ?? (block.type === "table" ? "data_table" : block.type === "status_grid" ? "status" : block.type);
      const raw = block.resource ? readPath(resources.get(block.resource)?.data, path) : block.text;
      const data = raw === undefined ? null : JSON.parse(JSON.stringify(raw));
      const role = ["timeline"].includes(component) ? "activity" : ["action", "approval"].includes(component) ? "actions"
        : ["metric", "metric_group", "gauge", "progress", "task"].includes(component) ? "summary"
        : ["status", "data_table", "run_graph", "list"].includes(component) ? "resources" : "primary";
      return [{ id: `section-${index}`, role, component, component_version: 2, title: block.title,
        source: block.resource, source_path: path, source_revision: block.resource ? Number(resources.get(block.resource)?.revision ?? 0) : undefined,
        data, fallback: block.text || `${block.title}：请在支持此内容的客户端查看。`,
        actions: block.action ? [{ id: `action-${index}`, label: block.title, capability: block.action.type,
          resource_id: block.action.target, risk: block.action.type.endsWith("open") || block.action.type === "view.show" ? "read" : "write",
          input: Object.fromEntries(Object.entries(block.action).filter(([key]) => key !== "type" && key !== "target")) }] : [],
        priority: role === "summary" ? 100 : 50 }];
    }), ...[...resources.values()].filter((resource) => type?.runEvents && resource.resource.startsWith("agent-run/")).map((resource, index) => ({
      id: `run-event-log-${index}`, role: "primary", component: "log", component_version: 2,
      title: "任务事件日志", source: resource.resource, source_path: "event_log", source_revision: Number(resource.revision),
      data: readPath(resource.data, "event_log") ?? null, fallback: "任务事件日志暂不可用。",
      actions: [], priority: 40,
    }))],
  });
}
