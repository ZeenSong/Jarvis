import test from "node:test";
import assert from "node:assert/strict";
import { preset, resolveViewType, viewTypes } from "../packages/ui-presets/src/index.js";
import { semanticView } from "../packages/ui-presets/src/v2.js";
import { viewSpecSchema } from "../packages/ui-protocol-v2/src/index.js";

/**
 * View types are data. These tests pin the contract that makes that true:
 * every legacy intent resolves through the table, the matched-resource
 * placeholder is substituted, and a view with no entry composes generically
 * instead of falling through a branch chain.
 */

test("every legacy intent is backed by a registry entry", () => {
  const expected = ["system_overview", "network_overview", "usage_analysis", "agent_run_analysis"];
  assert.deepEqual(Object.keys(viewTypes).sort(), [...expected].sort());
  for (const intent of expected) {
    const view = preset({
      type: "view.show",
      intent,
      resources: intent === "agent_run_analysis" ? ["agent-run/abc"] : [],
    });
    // The blocks are exactly the table entry, in order: no hidden branch.
    assert.deepEqual(view.blocks.map((block) => block.type), viewTypes[intent as keyof typeof viewTypes].blocks.map((block) => block.type));
    assert.equal(view.title, viewTypes[intent as keyof typeof viewTypes].title);
  }
});

test("the matched resource is substituted, including action targets", () => {
  const view = preset({ type: "view.show", intent: "agent_run_analysis", resources: ["agent-run/42"] });
  const resources = new Set(view.blocks.map((block) => block.resource).filter(Boolean));
  assert.deepEqual([...resources], ["agent-run/42"], "every task block reads the requested run");
  const cancel = view.blocks.find((block) => block.action?.type === "run.cancel");
  assert.equal(cancel?.action?.target, "42");
  assert.equal("terminalDrop" in (cancel as object), false, "presentation hints never reach the v1 schema");
});

test("a task view without a task is a clear client error, not a system dashboard", () => {
  assert.throws(() => preset({ type: "view.show", intent: "agent_run_analysis", resources: [] }), /view_resource_required/);
  assert.throws(() => resolveViewType({ type: "view.show", intent: "agent_run_analysis", resources: ["system/status"] }), /view_resource_required/);
});

test("the v2 layer reads intent and presentation hints from the same table", () => {
  const view = preset({ type: "view.show", intent: "agent_run_analysis", resources: ["agent-run/7"] });
  const base = { version: 1 as const, revision: 3 };
  const resources = new Map<string, any>([
    ["agent-run/7", { ...base, resource: "agent-run/7", data: {
      run: { status: "completed", result_json: { summary: "完成" } },
      tree: { children: [] },
      usage: { tokens: 1 },
      events: [],
      artifacts: [{ name: "a.txt" }],
      presentation: { artifacts: [{ name: "a.txt" }] },
      event_log: [{ at: "now" }],
    } }],
  ]);
  const semantic = semanticView("agent_run_analysis", view, resources);
  assert.equal(semantic.intent, viewTypes.agent_run_analysis.v2Intent);
  // Terminal task: cancel/input controls and the empty diff are gone, the task
  // card uses the task component, and the artifact table reads the v2 path.
  assert.equal(semantic.sections.some((section) => section.role === "actions"), false);
  assert.equal(semantic.sections.some((section) => section.component === "code_diff"), false);
  assert.ok(semantic.sections.some((section) => section.component === "task"));
  const table = semantic.sections.find((section) => section.source_path === "presentation.artifacts");
  assert.ok(table, "the artifact table reads its v2 path");
  assert.equal(semantic.sections.at(-1)?.component, "log", "run events are appended from the same entry");
});

test("a view with no registry entry composes generically", () => {
  assert.equal(resolveViewType({ type: "view.show", intent: "usage_analysis", resources: [] }).type, viewTypes.usage_analysis);
  const view = {
    version: 1 as const,
    type: "dashboard" as const,
    title: "临时视图",
    blocks: [{ type: "markdown" as const, title: "说明", text: "纯文本" }],
  };
  const semantic = semanticView("not_in_the_table", view, new Map());
  assert.equal(semantic.intent, "overview");
  assert.equal(semantic.sections[0]?.component, "markdown");
});

test("v2 intent is open, but still constrained to lower snake_case", () => {
  const section = { id: "s", role: "primary" as const, component: "metric" as const, component_version: 2 as const, title: "指标", data: 1, fallback: "不可用" };
  const spec = {
    ui_protocol: "2.0" as const, id: "custom", revision: 1, title: "自定义", layout: { type: "workspace" as const },
    sections: [section], fallback: "不可用",
  };
  assert.equal(viewSpecSchema.parse({ ...spec, intent: "pet_activity_digest" }).intent, "pet_activity_digest");
  assert.throws(() => viewSpecSchema.parse({ ...spec, intent: "Not Snake" }));
  assert.throws(() => viewSpecSchema.parse({ ...spec, intent: "" }));
});
