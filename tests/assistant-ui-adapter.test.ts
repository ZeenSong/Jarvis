import test from "node:test";
import assert from "node:assert/strict";
import { JarvisAssistantAdapter } from "../apps/web/src/assistant-ui-adapter.js";
import { Gateway } from "../apps/web/src/gateway.js";

const conversationId = "10000000-0000-4000-8000-000000000021";
const turnId = "10000000-0000-4000-8000-000000000022";
const replyId = "10000000-0000-4000-8000-000000000023";

function textOfUpdate(update: any) {
  return update.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("");
}

test("transient reconnect snapshot failure retries without resubmitting the accepted message", async () => {
  const gateway = new Gateway();
  let snapshotReads = 0;
  let messageAdmissions = 0;
  gateway.request = async (topic: string) => {
    if (topic === "conversation.message") { messageAdmissions++; return { reply_id: replyId, turn_id: turnId }; }
    if (topic === "conversation.get") {
      snapshotReads++;
      if (snapshotReads === 1) throw Error("request_failed");
      return { messages: [{ id: replyId, role: "jarvis", content: "从断线快照恢复", revision: 1, status: "streaming" }], activities: [], events: [], results: [] };
    }
    throw Error(`unexpected request: ${topic}`);
  };

  const controller = new AbortController();
  const adapter = new JarvisAssistantAdapter(gateway, conversationId);
  const result = adapter.model.run({ messages: [{ content: "继续任务" }], abortSignal: controller.signal } as any) as AsyncIterable<any>;
  const run = result[Symbol.asyncIterator]();
  await run.next();
  assert.equal(messageAdmissions, 1);

  gateway.dispatchEvent(new CustomEvent("connection", { detail: "已连接" }));
  const recovered = await run.next();
  assert.equal(snapshotReads, 2);
  assert.equal(textOfUpdate(recovered.value), "从断线快照恢复");

  gateway.dispatchEvent(new CustomEvent("conversation.message.delta", { detail: { conversation_id: conversationId, message_id: replyId, content: "恢复后继续完成", revision: 2 } }));
  const continued = await run.next();
  assert.equal(textOfUpdate(continued.value), "恢复后继续完成");
  gateway.dispatchEvent(new CustomEvent("conversation.status", { detail: { conversation_id: conversationId, message_id: replyId, status: "completed" } }));
  await run.next();
  assert.equal((await run.next()).done, true);
  assert.equal(messageAdmissions, 1);
});

test("aborting while a reconnect snapshot is pending releases the active turn", async () => {
  const gateway = new Gateway();
  let snapshotReads = 0;
  gateway.request = async (topic: string) => {
    if (topic === "conversation.message") return { reply_id: replyId, turn_id: turnId };
    if (topic === "conversation.get") { snapshotReads++; return new Promise(() => {}); }
    throw Error(`unexpected request: ${topic}`);
  };
  const controller = new AbortController();
  const adapter = new JarvisAssistantAdapter(gateway, conversationId);
  const result = adapter.model.run({ messages: [{ content: "继续任务" }], abortSignal: controller.signal } as any) as AsyncIterable<any>;
  const run = result[Symbol.asyncIterator]();
  await run.next();
  gateway.dispatchEvent(new CustomEvent("connection", { detail: "已连接" }));
  const recovering = run.next();
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  assert.equal((await recovering).done, true);
  assert.equal(snapshotReads, 1);
});
