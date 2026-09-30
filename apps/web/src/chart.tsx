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
      grid: { left: 48, right: 24, bottom: 40, top: 30 },
      xAxis: { type: "category", data: series.map((row) => row.name) },
      yAxis: { type: "value" },
      series: [
        {
          type: type === "bar_chart" ? "bar" : "line",
          data: series.map((row) => row.value),
          smooth: false,
          areaStyle: type === "sparkline" ? {} : undefined,
          itemStyle: { color: "#79d9c2" },
        },
      ],
    };

    if (type === "donut") {
      option = {
        backgroundColor: "transparent",
        tooltip: { trigger: "item" },
        legend: { bottom: 0 },
        series: [
          {
            type: "pie",
            radius: ["48%", "72%"],
            label: { show: false },
            labelLine: { show: false },
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
              itemStyle: { color: "#62c8ff" },
            },
            axisLine: {
              roundCap: true,
              lineStyle: { width: 8, color: [[1, "#20364f"]] },
            },
            axisLabel: { show: false },
            axisTick: { show: false },
            splitLine: { show: false },
            pointer: { show: false },
            detail: {
              formatter: "{value}%",
              fontSize: 26,
              color: light ? "#172b42" : "#eef5ff",
              offsetCenter: [0, "10%"],
            },
            data: [{ value: Number(data ?? 0).toFixed(1) }],
          },
        ],
      };
    }

    if (rows[0]?.data) {
      option.legend = { data: ["CPU", "GPU"] };
      option.xAxis.data = rows.map((row: any) =>
        new Date(row.sampled_at).toLocaleTimeString(),
      );
      option.series = ["cpu", "gpu"].map((key, index) => ({
        name: index ? "GPU" : "CPU",
        type: "line",
        connectNulls: false,
        showSymbol: false,
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
