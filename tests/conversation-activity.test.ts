import test from "node:test";
import assert from "node:assert/strict";
import { visibleActivities, capabilityLabel, canonicalActivityCapability, activitySource } from "../packages/conversation/src/activity.js";
import { activityGroupKey } from "../packages/conversation/src/model.js";
import { ConversationService } from "../packages/conversation/src/index.js";

const records = [
  { id: "bridge-1", turn_id: "turn-1", tool_call_id: "mcp-a1", capability: "system_status_read", status: "completed", input: { private: true }, output: { ok: true } },
  { id: "wrapper-1", turn_id: "turn-1", tool_call_id: "call-model-1", capability: "mcp_jarvis_system_status_read", status: "completed", input: {}, output: {} },
];

test("every non-completed wrapper remains visible with or without a same-name inner execution", () => {
  for (const status of ["queued", "running", "waiting_approval", "waiting_question", "failed", "cancelled", "interrupted", "unknown", undefined]) {
    const failure = { ...records[1], status };
    assert.deepEqual(visibleActivities([failure]), [failure]);
    assert.deepEqual(visibleActivities([records[0], failure]), [records[0], failure]);
    assert.equal(capabilityLabel(failure.capability), "读取服务器状态");
  }
});

test("ordinary activity view selects the execution layer without merging unrelated call IDs", () => {
  assert.deepEqual(visibleActivities(records), [records[0]]);
  assert.deepEqual(visibleActivities(records, true), records);
  assert.equal(activitySource(records[1].capability), "hermes_wrapper");
  assert.equal(capabilityLabel(records[0].capability), "读取服务器状态");
  assert.equal(capabilityLabel(records[1].capability), "读取服务器状态");
  assert.equal(capabilityLabel("system.status.read"), "读取服务器状态");
  assert.equal(canonicalActivityCapability(records[1].capability), "system.status.read");
  assert.equal(activityGroupKey(records[0].capability), activityGroupKey(records[1].capability));
});

test("real repeated calls, retries and separate turns are never deduplicated by name or arguments", () => {
  const repeated = [records[0], { ...records[0], id: "bridge-2", tool_call_id: "mcp-a2", status: "failed" },
    { ...records[0], id: "bridge-3", tool_call_id: "mcp-a3", turn_id: "turn-2" }];
  assert.deepEqual(visibleActivities([...repeated, records[1]]), repeated);
});

test("only explicitly known Jarvis wrappers are hidden; native and other MCP tools survive", () => {
  const other = ["terminal", "mcp_other_system_status_read", "mcp_jarvis_unknown", "system.status.read"]
    .map((capability) => ({ capability, status: "completed" }));
  assert.deepEqual(visibleActivities(other), other);
  assert.equal(visibleActivities([{ capability: "mcp__jarvis__system_status_read", status: "completed" }]).length, 0);
  assert.equal(capabilityLabel("mcp_other_system_status_read"), "执行操作");
});

test("conversation snapshot uses the same visible records for activity counts and preserves developer evidence", async () => {
  const db = { query: async (sql: string) => ({ rows: sql.startsWith("SELECT * FROM conversations") ? [{ id: "conversation-1" }]
    : sql.includes("FROM conversation_activities") ? records : [] }) };
  const service = new ConversationService(db as any, {} as any, () => {});
  const ordinary = await service.get("conversation-1");
  assert.deepEqual(ordinary.activities.map((a) => a.id), ["bridge-1"]);
  assert.equal(ordinary.activities[0].input, undefined);
  assert.equal(ordinary.activities[0].output, undefined);
  assert.deepEqual(ordinary.activity_groups, [{ key: "system status read", count: 1, completed: 1, failed: 0, running: 0 }]);
  const developer = await service.get("conversation-1", undefined, true);
  assert.deepEqual(developer.activities, records);
  assert.equal(developer.activity_groups[0].count, 2);
});
