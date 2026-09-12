import { test } from "node:test";
import assert from "node:assert/strict";
import { runEventLog } from "../packages/ui-presets/src/run-log.js";
import { semanticView } from "../packages/ui-presets/src/v2.js";
import { preset } from "../packages/ui-presets/src/index.js";
import { bindSection } from "../packages/ui-protocol-v2/src/binding.js";

test("event log allowlists metadata and binds subsequent resource revisions", () => {
  const event_log = runEventLog([{ id: 1, timestamp: new Date("2026-09-10T00:00:00Z"), type: "agent.run.created", payload: { password: "never-display" } }]);
  assert.equal(event_log, "2026-09-10T00:00:00.000Z  1  agent.run.created");
  const name = "agent-run/00000000-0000-4000-8000-000000000001";
  const view = semanticView("agent_run_analysis", preset({ type: "view.show", intent: "agent_run_analysis", resources: [name] }), new Map([[name, { version: 1, resource: name, revision: 1, data: { event_log } }]]));
  const log = view.sections.find((s) => s.component === "log")!;
  assert.equal(log.data, event_log);
  assert.equal(bindSection(log, { resource: name, revision: 2, data: { event_log: "updated" } }).data, "updated");
});
