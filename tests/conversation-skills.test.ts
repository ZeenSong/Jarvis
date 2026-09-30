import test from "node:test";
import assert from "node:assert/strict";
import { messageInput } from "../packages/conversation/src/index.js";

const request = {
  conversation_id: "10000000-0000-4000-8000-000000000001",
  content: "查看家庭近况",
  idempotency_key: "request-1",
};

test("Skills selections are normalized, optional for Auto, and reject duplicate or malformed names", () => {
  assert.deepEqual(messageInput.parse(request), { ...request, skills: [] });
  assert.deepEqual(messageInput.parse({ ...request, skills: ["照片管理", "家庭助手"] }).skills, ["家庭助手", "照片管理"]);
  assert.throws(() => messageInput.parse({ ...request, skills: ["家庭助手", "家庭助手"] }));
  assert.throws(() => messageInput.parse({ ...request, skills: [" "] }));
  assert.throws(() => messageInput.parse({ ...request, skills: Array.from({ length: 17 }, (_, i) => `skill-${i}`) }));
});
