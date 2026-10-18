import assert from "node:assert/strict";
import test from "node:test";
import { decideResultHost, decideViewHost } from "../packages/ui-protocol-v2/src/index.js";

/**
 * The three canonical demos from docs/specifications/m3.3-requirements.md
 * §18-§20. These are the acceptance cases for result hosting: getting them wrong
 * is a visible product bug, not a cosmetic one.
 */

test("canonical scenario: three cat photos stay inline even if a workspace is requested", () => {
  const photos = [
    { id: "p1", resource_id: "10000000-0000-4000-8000-000000000001" },
    { id: "p2", resource_id: "10000000-0000-4000-8000-000000000002" },
    { id: "p3", resource_id: "10000000-0000-4000-8000-000000000003" },
  ];
  for (const requested of [undefined, "workspace"] as const) {
    const decision = decideResultHost(
      [
        { component: "markdown" },
        { component: "gallery", data: photos },
        { component: "action" },
      ],
      { intent: "overview", layout: "workspace", requested },
    );
    assert.equal(decision.target, "inline", `requested=${requested} must still be inline`);
    assert.equal(decision.reason, "media_gallery");
  }
});

test("canonical scenario: a usage analysis with several charts opens the workspace", () => {
  const decision = decideViewHost({
    intent: "overview",
    layout: { type: "workspace" },
    sections: [
      { component: "metric_group" },
      { component: "donut" },
      { component: "bar_chart" },
      { component: "line_chart" },
      { component: "data_table" },
    ],
  });
  assert.equal(decision.target, "workspace");
  assert.equal(decision.reason, "multiple_charts");
});

test("canonical scenario: cat activity with a timeline and charts opens the workspace", () => {
  const decision = decideViewHost({
    intent: "overview",
    layout: { type: "workspace" },
    sections: [
      { component: "metric_group" },
      { component: "timeline", data: [{ at: "08:00" }, { at: "12:00" }] },
      { component: "bar_chart" },
    ],
  });
  assert.equal(decision.target, "workspace");
  assert.equal(decision.reason, "chart_with_detail");
});

test("a single status answer stays inline", () => {
  const decision = decideViewHost({
    intent: "overview",
    layout: { type: "workspace" },
    sections: [{ component: "status" }, { component: "metric" }, { component: "markdown" }],
  });
  assert.equal(decision.target, "inline");
});

test("heavy artefacts always take the workspace", () => {
  for (const component of ["run_graph", "code_diff", "log", "run"]) {
    const decision = decideViewHost({ intent: "overview", sections: [{ component }] });
    assert.equal(decision.target, "workspace", component);
    assert.equal(decision.reason, "heavy_component");
  }
});

test("task and incident intents are multi-dimensional by definition", () => {
  for (const intent of ["review_task", "investigate_failure", "manage_application", "review_integration"]) {
    const decision = decideViewHost({ intent, sections: [{ component: "metric" }] });
    assert.equal(decision.target, "workspace", intent);
    assert.equal(decision.reason, "intent_requires_workspace");
  }
});

test("a model cannot suppress a workspace for a multi-chart report", () => {
  const decision = decideViewHost(
    { intent: "overview", sections: [{ component: "line_chart" }, { component: "bar_chart" }] },
    "inline",
  );
  assert.equal(decision.target, "workspace");
});

test("an ambiguous single chart honours an explicit request", () => {
  const inline = decideViewHost({ intent: "overview", sections: [{ component: "line_chart" }, { component: "metric" }] }, "inline");
  assert.equal(inline.target, "inline");
  assert.equal(inline.reason, "caller_preference");
  const workspace = decideViewHost({ intent: "overview", sections: [{ component: "line_chart" }, { component: "metric" }] }, "workspace");
  assert.equal(workspace.target, "workspace");
  assert.equal(workspace.reason, "caller_preference");
});

test("large datasets leave the conversation", () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ index }));
  const byData = decideViewHost({ intent: "overview", sections: [{ component: "list", data: rows }] });
  assert.equal(byData.target, "workspace");
  assert.equal(byData.reason, "large_dataset");

  const manyPhotos = Array.from({ length: 12 }, (_, index) => ({ id: index }));
  const byMedia = decideViewHost({ intent: "overview", sections: [{ component: "gallery", data: manyPhotos }] });
  assert.equal(byMedia.target, "workspace");
  assert.equal(byMedia.reason, "media_over_inline_limit");
});

test("many sections read as a report, not an answer", () => {
  const sections = Array.from({ length: 8 }, () => ({ component: "markdown" }));
  const decision = decideViewHost({ intent: "overview", sections });
  assert.equal(decision.target, "workspace");
  assert.equal(decision.reason, "many_sections");
});

test("plain prose is inline by default", () => {
  const decision = decideResultHost([{ component: "markdown" }], {});
  assert.equal(decision.target, "inline");
  assert.equal(decision.reason, "default_inline");
});
