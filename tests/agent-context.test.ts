import test from "node:test";
import assert from "node:assert/strict";
import {
  metricsContext,
  runContext,
} from "../packages/agent-manager/src/context.js";
test("bounded metrics preserve actual extrema, zero values and missing coverage", () => {
  const samples = Array.from({ length: 2880 }, (_, i) => ({
    sampled_at: i,
    data: { cpu: { usage_percent: i === 1345 ? 100 : 0 } },
    missing: i === 0,
  }));
  const result = metricsContext({ samples, coverage: { missing: true } });
  assert.equal(result.samples.length, 24);
  assert.equal(result.statistics.cpu_percent.max, 100);
  assert.equal(result.statistics.cpu_percent.min, 0);
  assert.equal(result.statistics.gpu_percent.count, 0);
  assert.equal(result.statistics.gpu_percent.mean, null);
  assert.equal(result.gap_markers, 1);
  assert.equal(result.coverage.missing, true);
});
test("domain results supply bounded evidence without sending full artifacts back to Core", () => {
  const value = runContext({
    run: {
      id: "x",
      status: "completed",
      result_json: { summary: "x".repeat(10000), diff: "y".repeat(100000) },
    },
    events: [
      {
        type: "agent.tool.completed",
        payload: { exit_code: 0, output: "z".repeat(10000) },
      },
    ],
    artifacts: [{ id: "a", name: "changes.diff", content: "y".repeat(100000) }],
  });
  assert.equal(value.events[0].payload.exit_code, 0);
  assert.equal(value.artifacts[0].characters, 100000);
  assert.ok(!("content" in value.artifacts[0]));
  assert.ok(JSON.stringify(value).length < 5000);
});
