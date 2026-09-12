import test from "node:test";
import assert from "node:assert/strict";
import { taskDataSchema } from "../packages/ui-protocol-v2/src/task.js";
test("task display accepts unknown statuses without reclassifying and strips internals", () => {
  assert.deepEqual(taskDataSchema.parse({goal:"分析服务",status:"future_state",input_json:{password:"hidden"}}),{goal:"分析服务",status:"future_state"});
  assert.equal(taskDataSchema.safeParse({goal:"",status:"running"}).success,false);
});
