import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart, BarChart, PieChart, GaugeChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GaugeChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);
import {
  readPath,
  type ViewSpec,
  type Resource,
} from "../../../packages/ui-protocol/src/index";
export const labels: Record<string, string> = {
  queued: "排队中",
  starting: "启动中",
  running: "运行中",
  waiting_for_user: "等待输入",
  waiting_for_approval: "等待审批",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  input_tokens: "输入 Token",
  output_tokens: "输出 Token",
  estimated_cost_usd: "预估费用（美元）",
  errors: "错误请求",
  p95_latency_ms: "延迟 P95（毫秒）",
  requests: "请求数",
  unpriced_requests: "未定价请求",
  cached_input_tokens: "缓存 Token",
  reasoning_tokens: "推理 Token",
  healthy: "正常",
  server_status: "服务状态",
  db_status: "数据库",
  version: "版本",
};
const format = (v: unknown): string =>
  v == null
    ? "暂无数据"
    : typeof v === "object"
      ? JSON.stringify(v)
      : (labels[String(v)] ?? String(v));
function Chart({ type, data }: { type: string; data: any }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, "dark");
    const rows = Array.isArray(data) ? data : [];
    const series = rows.map((r: any) => ({
      name: format(r.label ?? r.provider ?? r.agent_id ?? r.sampled_at),
      value: Number(r.value ?? (r.input_tokens ?? 0) + (r.output_tokens ?? 0)),
    }));
    let option: any = {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" },
      grid: { left: 48, right: 24, bottom: 40, top: 30 },
      xAxis: { type: "category", data: series.map((r) => r.name) },
      yAxis: { type: "value" },
      series: [
        {
          type: type === "bar_chart" ? "bar" : "line",
          data: series.map((r) => r.value),
          smooth: false,
          areaStyle: type === "sparkline" ? {} : undefined,
          itemStyle: { color: "#79d9c2" },
        },
      ],
    };
    if (type === "donut")
      option = {
        backgroundColor: "transparent",
        tooltip: { trigger: "item" },
        legend: { bottom: 0 },
        series: [{ type: "pie", radius: ["48%", "72%"], data: series }],
      };
    if (type === "gauge")
      option = {
        backgroundColor: "transparent",
        series: [
          {
            type: "gauge",
            progress: { show: true },
            axisLine: { lineStyle: { width: 12 } },
            detail: { formatter: "{value}%", fontSize: 26 },
            data: [{ value: Number(data ?? 0).toFixed(1) }],
          },
        ],
      };
    if (rows[0]?.data) {
      option.legend = { data: ["CPU", "GPU"] };
      option.xAxis.data = rows.map((r: any) =>
        new Date(r.sampled_at).toLocaleTimeString(),
      );
      option.series = ["cpu", "gpu"].map((key, i) => ({
        name: i ? "GPU" : "CPU",
        type: "line",
        connectNulls: false,
        showSymbol: false,
        data: rows.map(
          (r: any) =>
            r.data[key]?.[i ? "utilization_percent" : "usage_percent"] ?? null,
        ),
      }));
    }
    chart.setOption(option);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(ref.current);
    return () => {
      resize.disconnect();
      chart.dispose();
    };
  }, [type, data]);
  return <div className="chart" ref={ref} role="img" aria-label="数据图表" />;
}
function RunGraph({
  data,
  onOpen,
}: {
  data: any;
  onOpen: (id: string) => void;
}) {
  const rows = Array.isArray(data) ? data : [];
  return (
    <div className="run-tree">
      {rows
        .filter((r: any) => !rows.some((p: any) => p.id === r.parent_run_id))
        .map((root: any) => (
          <TreeNode key={root.id} row={root} rows={rows} onOpen={onOpen} />
        ))}
    </div>
  );
}
function TreeNode({
  row,
  rows,
  onOpen,
}: {
  row: any;
  rows: any[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="tree-branch">
      <button onClick={() => onOpen(row.id)}>
        {row.agent_id}
        <small>{format(row.status)}</small>
      </button>
      <div className="tree-children">
        {rows
          .filter((r) => r.parent_run_id === row.id)
          .map((r) => (
            <TreeNode key={r.id} row={r} rows={rows} onOpen={onOpen} />
          ))}
        {row.agent_instance_id && <span className="worker">◇ Worker</span>}
      </div>
    </div>
  );
}
export function Blocks({
  view,
  resources,
  action,
}: {
  view: ViewSpec;
  resources: Map<string, Resource>;
  action: (a: any) => void;
}) {
  return (
    <div className="blocks">
      {view.blocks.map((b, i) => {
        const data =
          readPath(
            b.resource ? resources.get(b.resource)?.data : undefined,
            b.path,
          ) ?? b.text;
        let content;
        switch (b.type) {
          case "metric":
            content = <strong className="big">{format(data)}</strong>;
            break;
          case "metric_group":
          case "status_grid":
            content = (
              <dl>
                {Object.entries(data && typeof data === "object" ? data : {})
                  .filter(
                    ([k]) => !["input_json", "runtime_config"].includes(k),
                  )
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>{labels[k] ?? k}</dt>
                      <dd>{format(v)}</dd>
                    </div>
                  ))}
              </dl>
            );
            break;
          case "sparkline":
          case "line_chart":
          case "bar_chart":
          case "donut":
          case "gauge":
            content =
              data == null || (Array.isArray(data) && !data.length) ? (
                <p className="muted">暂无数据 · 未采集时段保留缺口</p>
              ) : (
                <Chart type={b.type} data={data} />
              );
            break;
          case "progress":
            content = (
              <>
                <progress max="100" value={Number(data ?? 0)} />
                <span>{format(data)}%</span>
              </>
            );
            break;
          case "table": {
            const rows = Array.isArray(data) ? data : [];
            const keys = Object.keys(rows[0] ?? {}).filter(
              (k) => k !== "content",
            );
            content = (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {keys.map((k) => (
                        <th key={k}>{labels[k] ?? k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, j) => (
                      <tr key={j}>
                        {keys.map((k) => (
                          <td key={k}>{format(r[k])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && <p>暂无记录</p>}
              </div>
            );
            break;
          }
          case "timeline":
            content = (
              <ol className="timeline">
                {(Array.isArray(data) ? data : []).map((r: any, j) => (
                  <li key={r.id ?? j}>
                    <small>{format(r.timestamp)}</small>
                    <p>
                      {r.payload?.title ??
                        labels[r.payload?.status] ??
                        "任务事件"}
                    </p>
                    <details>
                      <summary>详情</summary>
                      <pre>{JSON.stringify(r.payload, null, 2)}</pre>
                    </details>
                  </li>
                ))}
              </ol>
            );
            break;
          case "action":
            content = b.action?.type === "run.input" ? (
              <form onSubmit={(e) => {
                e.preventDefault();
                const text = String(new FormData(e.currentTarget).get("text") ?? "").trim();
                if (text) action({ ...b.action, text });
              }}>
                <textarea name="text" aria-label="补充任务输入" required maxLength={16000} />
                <button type="submit">发送输入</button>
              </form>
            ) : (
              <button disabled={!b.action} onClick={() => action(b.action)}>
                {b.title}
              </button>
            );
            break;
          case "approval":
            content = (
              <div>
                <p>审批不能扩大 Worker 权限</p>
                <button
                  onClick={() => action({ ...b.action, approved: false })}
                >
                  拒绝操作
                </button>
              </div>
            );
            break;
          case "run_graph":
            content = (
              <RunGraph
                data={data}
                onOpen={(id) => action({ type: "run.open", target: id })}
              />
            );
            break;
          case "code_diff":
            content = (
              <pre className="diff">
                {format(data)
                  .split("\n")
                  .map((line, i) => (
                    <span
                      className={
                        line.startsWith("+")
                          ? "add"
                          : line.startsWith("-")
                            ? "remove"
                            : ""
                      }
                      key={i}
                    >
                      {line}
                      {"\n"}
                    </span>
                  ))}
              </pre>
            );
            break;
          case "markdown":
          case "card":
          case "alert":
            content = (
              <div className={b.type === "alert" ? "alert" : "prose"}>
                {format(data)}
              </div>
            );
            break;
          default:
            content = <p>此组件需要更新客户端才能显示</p>;
        }
        return (
          <section className={"block block-" + b.type} key={i}>
            <h3>{b.title}</h3>
            {content}
          </section>
        );
      })}
    </div>
  );
}
