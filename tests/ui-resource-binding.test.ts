import test from "node:test";
import assert from "node:assert/strict";
import { sectionSchema, negotiateView, viewSpecSchema } from "../packages/ui-protocol-v2/src/index.js";
import { bindSection } from "../packages/ui-protocol-v2/src/binding.js";

const section = () => sectionSchema.parse({ id: "cpu", role: "summary", component: "metric", title: "CPU", fallback: "暂无指标", source: "system/status", source_path: "cpu.usage_percent", source_revision: 5, data: 12 });
test("newer resource updates the bound value and revision, preserving the snapshot", () => {
  const original = section();
  const next = bindSection(original, { resource: "system/status", revision: 6, data: { cpu: { usage_percent: 78 } } });
  assert.equal(next.data, 78); assert.equal(next.source_revision, 6); assert.equal(original.data, 12);
});
test("equal, older and unrelated resources cannot overwrite a section", () => {
  const original = section();
  for (const revision of [4,5]) assert.equal(bindSection(original, { resource: "system/status", revision, data: 99 }), original);
  assert.equal(bindSection(original, { resource: "system/other", revision: 6, data: 99 }), original);
});
test("missing field clears stale data; false and zero are retained", () => {
  for (const value of [0,false,null]) assert.equal(bindSection(section(), { resource: "system/status", revision: 6, data: { cpu: { usage_percent: value } } }).data, value);
  assert.equal(bindSection(section(), { resource: "system/status", revision: 6, data: {} }).data, null);
});
test("paths never read inherited properties", () => {
  const data = Object.create({ cpu: { usage_percent: 99 } });
  assert.equal(bindSection(section(), { resource: "system/status", revision: 6, data }).data, null);
});
test("negotiated fallback does not regain unsupported source data", () => {
  const view = viewSpecSchema.parse({ ui_protocol: "2.0", id: "test", revision: 1, intent: "overview", title: "test", layout: { type: "workspace" }, fallback: "不可用", sections: [section()] });
  const result = negotiateView(view, { platform: "web", supports: { min: "2.0", max: "2.0" }, components: ["markdown@2"], features: [] });
  assert.equal(result.kind, "view");
  if(result.kind === "view") { const fallback=result.view.sections[0];assert.equal(bindSection(fallback, { resource: "system/status", revision: 6, data: 99 }),fallback); }
});
