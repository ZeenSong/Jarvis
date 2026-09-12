import test from "node:test";
import assert from "node:assert/strict";
import { arrangeSections, negotiateView, viewSpecSchema, componentTypes } from "../packages/ui-protocol-v2/src/index.js";

const incident = () => viewSpecSchema.parse({
  ui_protocol: "2.0", id: "server_incident", revision: 1,
  intent: "investigate_failure", title: "昨晚服务器异常",
  layout: { type: "workspace" }, fallback: "查看任务详情以了解异常分析。",
  sections: [
    { id: "trend", role: "primary", component: "line_chart", title: "24 小时趋势", fallback: "趋势暂不可显示" },
    { id: "summary", role: "summary", component: "metric", title: "结论", fallback: "等待分析" },
    { id: "events", role: "activity", component: "timeline", title: "异常时间线", fallback: "等待事件" },
    { id: "repair", role: "actions", component: "action", title: "修复建议", fallback: "查看审批中心", actions: [{ id: "restart", label: "重启容器", capability: "container.restart", risk: "write" }] },
  ],
});
const renderer = { platform: "web", supports: { min: "2.0", max: "2.2" }, components: componentTypes.map((c) => `${c}@2`), features: ["charts", "gallery", "actions"] };

test("same incident semantics use a web workspace and mobile action sheet", () => {
  const view = incident();
  const web = arrangeSections(view, "web");
  const mobile = arrangeSections(view, "android");
  assert.deepEqual(web.left?.map((s) => s.id), ["events"]);
  assert.deepEqual(web.right?.map((s) => s.id), ["repair"]);
  assert.deepEqual(mobile.main.map((s) => s.id), ["summary", "trend", "events"]);
  assert.deepEqual(mobile.sheet?.map((s) => s.id), ["repair"]);
  assert.deepEqual(view, incident());
});

test("protocol negotiation compares numeric minor versions and fails closed", () => {
  assert.equal(negotiateView(incident(), renderer).kind, "view");
  assert.equal(negotiateView(incident(), { ...renderer, supports: { min: "2.1", max: "2.10" } }).kind, "fallback");
  assert.equal(negotiateView(incident(), { ...renderer, supports: { min: "1.0", max: "1.9" } }).kind, "fallback");
  assert.throws(() => negotiateView(incident(), { ...renderer, supports: { min: "2.10", max: "2.2" } }));
});

test("unknown component and component version degrade to inert text", () => {
  const view = incident();
  view.sections[3].component = "future_action";
  view.sections[0].component_version = 3;
  const result = negotiateView(view, renderer);
  assert.equal(result.kind, "view");
  if (result.kind !== "view") return;
  assert.deepEqual(result.degraded, ["trend", "repair"]);
  assert.equal(result.view.sections[3].component, "markdown");
  assert.deepEqual(result.view.sections[3].actions, []);
  assert.equal(negotiateView(view, { ...renderer, components: [] }).kind, "fallback");
});

test("feature flags suppress unavailable charts and action affordances", () => {
  const result = negotiateView(incident(), { ...renderer, features: [] });
  assert.equal(result.kind, "view");
  if (result.kind !== "view") return;
  assert.equal(result.view.sections[0].component, "markdown");
  assert.deepEqual(result.view.sections[3].actions, []);
});

test("contract rejects arbitrary source, pixels, duplicate IDs and malformed actions", () => {
  assert.equal(viewSpecSchema.safeParse({ ...incident(), javascript: "alert(1)" }).success, false);
  assert.equal(viewSpecSchema.safeParse({ ...incident(), layout: { type: "workspace", width: 1200 } }).success, false);
  const view = incident();
  view.sections[1].id = view.sections[0].id;
  assert.equal(viewSpecSchema.safeParse(view).success, false);
  assert.equal(viewSpecSchema.safeParse({ ...incident(), sections: [{ ...incident().sections[0], actions: [{ type: "eval", script: "x" }] }] }).success, false);
});
