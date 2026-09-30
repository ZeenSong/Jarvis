import test from "node:test";
import assert from "node:assert/strict";
import { Gateway } from "../apps/web/src/gateway.js";
import { JarvisAssistantAdapter } from "../apps/web/src/assistant-ui-adapter.js";

test("Gateway buffers early events and abort releases an idle consumer", async () => {
  const gateway = new Gateway();
  const controller = new AbortController();
  const iterator = gateway.stream(["delta"], controller.signal)[Symbol.asyncIterator]();
  gateway.dispatchEvent(new CustomEvent("delta", { detail: "first" }));
  assert.deepEqual((await iterator.next()).value, { topic: "delta", payload: "first" });
  const pending = iterator.next();
  controller.abort();
  assert.equal((await pending).done, true);
});

test("Conversation streams early deltas and turn activities without snapshot polling", async () => {
  const gateway = new Gateway();
  const calls: string[] = [];
  let submitted: any;
  gateway.request = async (topic, payload) => {
    calls.push(topic);
    if (topic === "conversation.message") submitted = payload;
    const emit = (name: string, payload: object) => gateway.dispatchEvent(new CustomEvent(name, {
      detail: { conversation_id: "conversation", message_id: "reply", turn_id: "turn", ...payload },
    }));
    emit("conversation.message.delta", { content: "正在", revision: 1 });
    emit("conversation.message.delta", { content: "旧数据", revision: 1 });
    emit("conversation.activity.started", { activity_id: "a", capability: "system.status.read", status: "running" });
    emit("conversation.activity.completed", { activity_id: "a", capability: "system.status.read", status: "completed" });
    emit("conversation.message.delta", { content: "正在完成", revision: 2 });
    emit("conversation.status", { status: "completed" });
    return { reply_id: "reply", turn_id: "turn" };
  };
  const adapter = new JarvisAssistantAdapter(gateway, "conversation", false, undefined, () => "high");
  const updates: any[] = [];
  for await (const update of adapter.model.run({ messages: [{ role: "user", content: "查看状态" }], abortSignal: new AbortController().signal } as any) as AsyncIterable<any>) updates.push(update);
  assert.deepEqual(calls, ["conversation.message"]);
  assert.equal(submitted.reasoning_effort, "high");
  assert.equal(updates[0].metadata.custom.turn_id, "turn");
  assert.equal(updates[1].content[0].text, "正在");
  assert.equal(updates.at(-1).content[0].text, "正在完成");
  assert.equal(updates.at(-1).content[1].result.status, "completed");
  assert.ok(updates.every((update) => update.content[0].text !== "旧数据"));
});
