import test from "node:test";
import assert from "node:assert/strict";
import { semanticView } from "../packages/ui-presets/src/v2.js";
import { viewSchema } from "../packages/ui-protocol/src/index.js";
import { preset } from "../packages/ui-presets/src/index.js";

test("terminal task views remove obsolete controls without removing actual diffs", () => {
  const resource = "agent-run/00000000-0000-4000-8000-000000000001";
  const legacy = preset({ type: "view.show", intent: "agent_run_analysis", resources: [resource] });
  for (const status of ["completed", "failed", "cancelled", "running"]) {
    for (const diff of ["", "+actual change"]) {
      const view = semanticView("agent_run_analysis", legacy, new Map([[resource, { version: 1, resource, revision: 1, data: { run: { status, result_json: { diff } } } }]]));
      assert.equal(view.sections.some((s) => s.component === "action"), status === "running");
      assert.equal(view.sections.some((s) => s.component === "code_diff"), status === "running" || !!diff);
    }
  }
});

test("semantic composition preserves approved=false and user input without copying identity into input", () => {
  const legacy=viewSchema.parse({version:1,type:"dashboard",title:"操作",blocks:[
    {type:"action",title:"拒绝审批",action:{type:"approval.response",target:"approval-1",approved:false}},
    {type:"action",title:"补充输入",action:{type:"run.input",target:"run-1",text:"明确目标"}},
  ]});
  const result=semanticView("actions",legacy,new Map());
  assert.deepEqual(result.sections[0].actions[0].input,{approved:false});
  assert.deepEqual(result.sections[1].actions[0].input,{text:"明确目标"});
  assert.equal(result.sections[0].actions[0].capability,"approval.response");
  assert.equal(result.sections[0].actions[0].resource_id,"approval-1");
});
