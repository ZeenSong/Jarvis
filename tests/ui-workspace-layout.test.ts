import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkspaceLayout, defaultWorkspaceLayout } from "../apps/web/src/workspace-layout.js";
test("workspace preferences validate persisted widths and recover malformed data", () => {
  for (const raw of [null, "{", "null", '{"activityVisible":true,"inspectorVisible":false,"panelWidth":99}', '{"activityVisible":"false","inspectorVisible":false,"panelWidth":25}']) {
    assert.deepEqual(parseWorkspaceLayout(raw), defaultWorkspaceLayout);
  }
  assert.deepEqual(parseWorkspaceLayout('{"activityVisible":false,"inspectorVisible":true,"panelWidth":18}'),{activityVisible:false,inspectorVisible:true,panelWidth:18});
});
