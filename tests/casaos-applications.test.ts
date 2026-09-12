import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeApplications } from "../packages/integration-casaos/src/index.js";

test("installed applications expose only names and conservative states, never Compose secrets", () => {
  const apps = normalizeApplications({ immich: { status: "running", compose: {
    "x-casaos": { title: { en_us: "Immich", zh_cn: "照片" } },
    services: { db: { environment: { PASSWORD: "must-not-leak" } } },
  }, store_info: { token: "must-not-leak" } }, unknown: null,
  stopped: { status: "exited" }, future: { status: "some-new-state" } });
  assert.deepEqual(apps[0], { id: "immich", provider: "casaos", name: "照片", status: "running", description: "", service_count: 1 });
  assert.equal(apps[1].status, "unknown");
  assert.equal(apps[2].status, "stopped");
  assert.equal(apps[3].status, "unknown");
  assert.ok(!JSON.stringify(apps).includes("must-not-leak"));
});
