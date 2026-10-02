import test from "node:test";
import assert from "node:assert/strict";
import { rankTaskExecutors, type TaskRequest } from "../packages/agent-manager/src/index.js";
import { taskScopes } from "../packages/hermes-runtime/src/index.js";

const definition = (id: string, runtime: string, task: Record<string, unknown>) => ({
  id,
  enabled: true,
  tier: "managed",
  runtime_type: runtime,
  runtime_config: { task },
});
const request = (overrides: Partial<TaskRequest> = {}): TaskRequest => ({
  goal: "完成一个可追踪目标",
  execution_mode: "auto",
  required_capabilities: [],
  constraints: { max_risk: "read", workspace_required: false },
  ...overrides,
});

test("task routing selects registered executors by capability metadata, not agent names", () => {
  const definitions = [
    definition("any-general-executor", "hermes", { capabilities: ["analysis", "system.*"], max_risk: "read", priority: 100 }),
    definition("future-research-provider", "research-runtime", { capabilities: ["analysis", "web.*"], max_risk: "read", priority: 200 }),
  ];
  const selected = rankTaskExecutors(definitions, ["hermes", "research-runtime"], request({ required_capabilities: ["web.search"] }));
  assert.equal(selected[0]?.definition.id, "future-research-provider");
});

test("task routing respects runtime availability, workspace, risk and mode constraints", () => {
  const definitions = [
    definition("read-executor", "reader", { capabilities: ["code.*"], modes: ["background"], max_risk: "read", priority: 200 }),
    definition("workspace-executor", "workspace-runtime", { capabilities: ["code.*"], modes: ["durable"], max_risk: "execute", supports_workspace: true, priority: 50 }),
  ];
  const durableWrite = request({
    execution_mode: "durable",
    required_capabilities: ["code.write"],
    constraints: { max_risk: "write", workspace_required: true },
  });
  assert.deepEqual(rankTaskExecutors(definitions, ["reader"], durableWrite), []);
  assert.equal(rankTaskExecutors(definitions, ["reader", "workspace-runtime"], durableWrite)[0]?.definition.id, "workspace-executor");
});

test("auto task routing accepts executor-specific modes and uses priority for generic work", () => {
  const definitions = [
    definition("lower", "one", { capabilities: ["analysis"], modes: ["background"], max_risk: "read", priority: 10 }),
    definition("higher", "two", { capabilities: ["analysis"], modes: ["durable"], max_risk: "read", priority: 20 }),
  ];
  assert.equal(rankTaskExecutors(definitions, ["one", "two"], request({ required_capabilities: ["analysis"] }))[0]?.definition.id, "higher");
});

test("durable task contexts derive least-privilege scopes from capabilities and risk", () => {
  assert.deepEqual(taskScopes({ execution_mode: "durable", required_capabilities: ["system.read", "home.read"], constraints: { max_risk: "read", workspace_required: false } }), ["home.read", "mcp.homeassistant.read", "system.read", "task.execute"]);
  assert.deepEqual(taskScopes({ execution_mode: "background", required_capabilities: ["home.automation"], constraints: { max_risk: "write", workspace_required: false } }), ["home.read", "mcp.homeassistant.read", "mcp.homeassistant.write", "task.execute"]);
  assert.deepEqual(taskScopes(), ["system.read", "task.execute"]);
});
