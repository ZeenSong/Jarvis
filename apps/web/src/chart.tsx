import { useEffect, useRef, useState } from "react";
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

type Props = {
  type: string;
  data: any;
  format: (value: unknown) => string;
};

export default function Chart({ type, data, format }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [light, setLight] = useState(
    () => document.documentElement.dataset.theme === "light",
  );

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setLight(document.documentElement.dataset.theme === "light"),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const chart = echarts.init(element, light ? undefined : "dark");
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#e2b56d";
    const sage = css.getPropertyValue("--sage").trim() || "#93ab8d";
    const muted = css.getPropertyValue("--muted").trim() || "#9c9588";
    const line = css.getPropertyValue("--line").trim() || "rgba(236,231,221,.1)";
    const ink = css.getPropertyValue("--text").trim() || "#ece7dd";
    const rows = Array.isArray(data) ? data : [];
    const series = rows.map((row: any) => ({
      name: format(row.label ?? row.provider ?? row.agent_id ?? row.sampled_at),
      value: Number(
        row.value ?? (row.input_tokens ?? 0) + (row.output_tokens ?? 0),
      ),
    }));
    let option: any = {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" },
      color: [accent, sage, "#b28ee4", "#6f9bea", "#f07453"],
      grid: { left: 46, right: 22, bottom: 28, top: 24 },
      xAxis: { type: "category", data: series.map((row) => row.name), axisLabel: { color: muted, fontSize: 9 }, axisLine: { lineStyle: { color: line } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: muted, fontSize: 9 }, splitLine: { lineStyle: { color: line } } },
      series: [
        {
          type: type === "bar_chart" ? "bar" : "line",
          data: series.map((row) => row.value),
          smooth: false,
          areaStyle: type === "sparkline" ? { color: accent, opacity: 0.08 } : undefined,
          itemStyle: { color: accent },
        },
      ],
    };

    if (type === "donut") {
      option = {
        backgroundColor: "transparent",
        tooltip: { trigger: "item" },
        color: [accent, sage, "#b28ee4", "#6f9bea", "#f07453"],
        legend: { bottom: 0, icon: "circle", itemWidth: 7, itemHeight: 7, textStyle: { color: muted, fontSize: 10 } },
        series: [
          {
            type: "pie",
            radius: ["48%", "72%"],
            label: { show: false },
            labelLine: { show: false },
            itemStyle: { borderColor: light ? "#fffdf8" : "#121417", borderWidth: 2 },
            data: series,
          },
        ],
      };
    }

    if (type === "gauge") {
      option = {
        backgroundColor: "transparent",
        series: [
          {
            type: "gauge",
            startAngle: 210,
            endAngle: -30,
            radius: "86%",
            progress: {
              show: true,
              roundCap: true,
              itemStyle: { color: accent },
            },
            axisLine: {
              roundCap: true,
              lineStyle: { width: 7, color: [[1, line]] },
            },
            axisLabel: { show: false },
            axisTick: { show: false },
            splitLine: { show: false },
            pointer: { show: false },
            detail: {
              formatter: "{value}%",
              fontSize: 26,
              color: ink,
              offsetCenter: [0, "10%"],
            },
            data: [{ value: Number(data ?? 0).toFixed(1) }],
          },
        ],
      };
    }

    if (rows[0]?.data) {
      option.color = [accent, sage];
      option.legend = { data: ["CPU", "GPU"], bottom: 0, icon: "roundRect", itemWidth: 9, itemHeight: 3, itemGap: 18, textStyle: { color: muted, fontSize: 10 } };
      option.grid = { left: 42, right: 20, bottom: 46, top: 20 };
      option.xAxis = {
        type: "category",
        data: rows.map((row: any) => new Date(row.sampled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })),
        axisLabel: { color: muted, fontSize: 9, hideOverlap: true },
        axisLine: { lineStyle: { color: line } },
        axisTick: { show: false },
        boundaryGap: false,
      };
      option.yAxis = { type: "value", max: 100, axisLabel: { color: muted, fontSize: 9 }, splitLine: { lineStyle: { color: line } } };
      option.series = ["cpu", "gpu"].map((key, index) => ({
        name: index ? "GPU" : "CPU",
        type: "line",
        connectNulls: false,
        showSymbol: false,
        smooth: 0.25,
        lineStyle: { width: 1.6 },
        areaStyle: { opacity: 0.06 },
        data: rows.map(
          (row: any) =>
            row.data[key]?.[index ? "utilization_percent" : "usage_percent"] ??
            null,
        ),
      }));
    }

    chart.setOption(option);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(element);
    return () => {
      resize.disconnect();
      chart.dispose();
    };
  }, [data, format, light, type]);

  return <div className="chart" ref={ref} role="img" aria-label="数据图表" />;
}
