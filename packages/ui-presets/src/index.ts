import {
  intentSchema,
  viewSchema,
  type ViewSpec,
} from "../../ui-protocol/src/index.js";
export function preset(input: unknown): ViewSpec {
  const i = intentSchema.parse(input);
  const run = i.resources.find((r) => r.startsWith("agent-run/"));
  const blocks: ViewSpec["blocks"] =
    i.intent === "agent_run_analysis" && run
      ? [
          { type: "run_graph", title: "任务关系", resource: run, path: "tree" },
          {
            type: "status_grid",
            title: "任务状态",
            resource: run,
            path: "run",
          },
          {
            type: "metric_group",
            title: "Token 用量",
            resource: run,
            path: "usage",
          },
          {
            type: "timeline",
            title: "执行过程",
            resource: run,
            path: "events",
          },
          {
            type: "markdown",
            title: "结果",
            resource: run,
            path: "run.result_json.summary",
          },
          {
            type: "code_diff",
            title: "代码变更",
            resource: run,
            path: "run.result_json.diff",
          },
          {
            type: "table",
            title: "测试与产物",
            resource: run,
            path: "artifacts",
          },
          {
            type: "action",
            title: "补充任务输入",
            action: { type: "run.input", target: run.split("/")[1] },
          },
          {
            type: "action",
            title: "取消任务",
            action: { type: "run.cancel", target: run.split("/")[1] },
          },
        ]
      : i.intent === "usage_analysis"
        ? [
            {
              type: "metric_group",
              title: "今日用量 · UTC",
              resource: "llm/usage/today",
              path: "total",
            },
            {
              type: "donut",
              title: "供应商",
              resource: "llm/usage/today",
              path: "providers",
            },
            {
              type: "bar_chart",
              title: "智能体用量",
              resource: "llm/usage/agents",
              path: "groups",
            },
            {
              type: "line_chart",
              title: "每小时 Token",
              resource: "llm/usage/hourly",
              path: "series",
            },
          ]
        : i.intent === "network_overview"
          ? [
              {
                type: "status_grid",
                title: "网络状态",
                resource: "system/network",
              },
            ]
          : [
              {
                type: "gauge",
                title: "CPU %",
                resource: "system/status",
                path: "cpu.usage_percent",
              },
              {
                type: "gauge",
                title: "内存 %",
                resource: "system/status",
                path: "memory.usage_percent",
              },
              {
                type: "gauge",
                title: "GPU %",
                resource: "system/status",
                path: "gpu.utilization_percent",
              },
              {
                type: "line_chart",
                title: "CPU / GPU 历史",
                resource: "system/metrics",
                path: "samples",
              },
              {
                type: "status_grid",
                title: "服务状态",
                resource: "system/status",
                path: "jarvis",
              },
              {
                type: "metric_group",
                title: "今日 Token 与费用",
                resource: "llm/usage/today",
                path: "total",
              },
            ];
  return viewSchema.parse({
    version: 1,
    type: "dashboard",
    title: {
      system_overview: "私人云 · 现在",
      network_overview: "服务器网络",
      usage_analysis: "AI 用量",
      agent_run_analysis: "任务详情",
    }[i.intent],
    blocks,
  });
}
