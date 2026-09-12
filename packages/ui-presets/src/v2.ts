import { viewSpecSchema } from "../../ui-protocol-v2/src/index.js";
import { readPath, type ViewSpec, type Resource } from "../../ui-protocol/src/index.js";

/** Compose semantic sections from existing, real server resources during the v1 migration. */
export function semanticView(id: string, view: ViewSpec, resources: Map<string, Resource>) {
  return viewSpecSchema.parse({
    ui_protocol: "2.0", id, revision: Math.max(0, ...[...resources.values()].map((r) => Number(r.revision))),
    intent: id === "agent_run_analysis" ? "review_task" : "overview", title: view.title,
    layout: { type: "workspace" }, fallback: "此视图暂时无法显示，请刷新或更新客户端。",
    sections: [...view.blocks.flatMap((block, index) => {
      if (id === "agent_run_analysis") {
        const resource = block.resource ?? (block.action?.target ? `agent-run/${block.action.target}` : undefined);
        const status = resource ? readPath(resources.get(resource)?.data, "run.status") : undefined;
        const terminal = ["completed", "failed", "cancelled"].includes(String(status));
        if (terminal && block.action && ["run.input", "run.cancel", "run.resume"].includes(block.action.type)) return [];
        if (terminal && block.type === "code_diff" && !readPath(resources.get(resource!)?.data, block.path)) return [];
      }
      const taskCard = id === "agent_run_analysis" && block.type === "status_grid" && block.path === "run";
      const artifactList = id === "agent_run_analysis" && block.type === "table" && block.path === "artifacts";
      if (artifactList) block = { ...block, path: "presentation.artifacts" };
      const component = taskCard ? "task" : artifactList ? "list" : block.type === "table" ? "data_table" : block.type === "status_grid" ? "status" : block.type;
      const raw = block.resource ? readPath(resources.get(block.resource)?.data, block.path) : block.text;
      const data = raw === undefined ? null : JSON.parse(JSON.stringify(raw));
      const role = ["timeline"].includes(component) ? "activity" : ["action", "approval"].includes(component) ? "actions"
        : ["metric", "metric_group", "gauge", "progress", "task"].includes(component) ? "summary"
        : ["status", "data_table", "run_graph", "list"].includes(component) ? "resources" : "primary";
      return [{ id: `section-${index}`, role, component, component_version: 2, title: block.title,
        source: block.resource, source_path: block.path, source_revision: block.resource ? Number(resources.get(block.resource)?.revision ?? 0) : undefined,
        data, fallback: block.text || `${block.title}：请在支持此内容的客户端查看。`,
        actions: block.action ? [{ id: `action-${index}`, label: block.title, capability: block.action.type,
          resource_id: block.action.target, risk: block.action.type.endsWith("open") || block.action.type === "view.show" ? "read" : "write",
          input: Object.fromEntries(Object.entries(block.action).filter(([key]) => key !== "type" && key !== "target")) }] : [],
        priority: role === "summary" ? 100 : 50 }];
    }), ...[...resources.values()].filter((resource) => id === "agent_run_analysis" && resource.resource.startsWith("agent-run/")).map((resource, index) => ({
      id: `run-event-log-${index}`, role: "primary", component: "log", component_version: 2,
      title: "任务事件日志", source: resource.resource, source_path: "event_log", source_revision: Number(resource.revision),
      data: readPath(resource.data, "event_log") ?? null, fallback: "任务事件日志暂不可用。",
      actions: [], priority: 40,
    }))],
  });
}
