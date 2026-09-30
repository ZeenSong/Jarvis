import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, migrate } from "../apps/server/src/persistence.js";
import { ConversationService } from "../packages/conversation/src/index.js";
import { HermesClient } from "../packages/hermes-bridge/src/index.js";
import { mergeExecution, type ExecutionEvent } from "../packages/conversation/src/execution.js";
import { ConversationResults } from "../packages/conversation/src/results.js";
import { WorkspaceStore } from "../apps/server/src/workspaces.js";

test("execution projection rejects stale revisions and preserves first-event order", () => {
  const event = { id: "a", sequence: 10, revision: 2, content: "完整推理" } as ExecutionEvent;
  const second = { id: "b", sequence: 11, revision: 1 } as ExecutionEvent;
  const events = mergeExecution([second], event);
  assert.deepEqual(events.map((item) => item.id), ["a", "b"]);
  assert.equal(mergeExecution(events, { ...event, revision: 1, content: "旧片段" })[0].content, "完整推理");
});

test("provider reasoning and execution phases persist in actual order across service restart", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const admin = database(process.env.TEST_DATABASE_URL!);
  const databaseName = `execution_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${databaseName}`;
  const db = database(url.toString());
  const env = { ...process.env };
  Object.assign(process.env, { HERMES_ENABLED: "1", HERMES_URL: "http://unused", HERMES_API_KEY: "test", HERMES_BRIDGE_KEY: "test" });
  const pushed: any[] = [];
  const service = new ConversationService(db, {} as any, (topic, payload) => pushed.push({ topic, payload }));
  let starts = 0;
  let runOptions: any;
  const fallbackReasoning = "上游完整推理段落。".repeat(80);
  t.mock.method(HermesClient.prototype, "startRun", async (_input: string, options: Parameters<HermesClient["startRun"]>[1]) => { starts++; runOptions = options; return { run_id: "test-run", status: "running" }; });
  t.mock.method(HermesClient.prototype, "runEvents", async function* () {
    yield { event: "run.started" };
    yield { event: "reasoning.delta", delta: "先读取" };
    yield { event: "reasoning.delta", delta: "家庭数据。" };
    yield { event: "reasoning.available", text: "先读取家庭数据。" };
    yield { event: "tool.started", tool_call_id: "call-1", tool: "mcp_tool_call", input: { provider: "homeassistant", private: "must-not-leak" } };
    yield { event: "tool.completed", tool_call_id: "call-1", tool: "mcp_tool_call", output: { secret: "must-not-leak" } };
    yield { event: "reasoning.delta", delta: "现在合并时间线。" };
    yield { event: "processing.started", id: "merge", title: "合并活动时间线" };
    yield { event: "processing.completed", id: "merge", title: "合并活动时间线" };
    yield { event: "render.started", id: "view", title: "生成分析界面" };
    yield { event: "render.completed", id: "view", title: "生成分析界面" };
    yield { event: "reasoning.available", text: fallbackReasoning };
    yield { event: "tool.started", tool: "terminal", preview: "读取本地统计" };
    yield { event: "tool.completed", tool: "terminal", error: false, preview: "统计完成" };
    yield { event: "tool.started", tool: "terminal", preview: "读取补充数据" };
    yield { event: "tool.completed", tool: "terminal", error: true, preview: "补充数据不可用" };
    yield { event: "message.delta", delta: "分析" };
    yield { event: "run.completed", output: "分析完成。" };
  });
  t.mock.method(HermesClient.prototype, "suggestTitle", async () => "猫咪活动趋势");
  try {
    await migrate(db);
    const device = randomUUID(), conversation = randomUUID();
    await db.query("INSERT INTO devices(id,token_hash,role) VALUES($1,$2,'device')", [device, randomUUID()]);
    await db.query("INSERT INTO conversations(id,title,owner_device_id) VALUES($1,'新会话',$2)", [conversation, device]);
    const idempotencyKey = randomUUID();
    const accepted = await service.accept(device, { conversation_id: conversation, content: "分析猫咪活动", idempotency_key: idempotencyKey, reasoning_effort: "high", skills: ["照片管理", "家庭助手"] });
    const replay = await service.accept(device, { conversation_id: conversation, content: "分析猫咪活动", idempotency_key: idempotencyKey, reasoning_effort: "high", skills: ["家庭助手", "照片管理"] });
    assert.equal(replay.turn_id, accepted.turn_id);
    await assert.rejects(service.accept(device, { conversation_id: conversation, content: "分析猫咪活动", idempotency_key: idempotencyKey, reasoning_effort: "high", skills: ["家庭助手"] }), /id_reused_with_different_request/);
    await assert.rejects(service.accept(device, { conversation_id: conversation, content: "分析猫咪活动", idempotency_key: idempotencyKey, reasoning_effort: "low" }), /id_reused_with_different_request/);
    await assert.rejects(service.accept(device, { conversation_id: conversation, content: "无效推理档位", idempotency_key: randomUUID(), reasoning_effort: "turbo" }));
    await service.schedule();
    await Promise.all((service as any).active.values());
    const snapshot = await service.get(conversation, device);
    assert.equal(snapshot.messages.find((message) => message.id === accepted.reply_id)?.status, "completed");
    assert.equal(snapshot.messages.find((message) => message.id === accepted.reply_id)?.content, "分析完成。");
    assert.deepEqual(snapshot.events.map((event) => event.kind), ["reasoning", "tool", "reasoning", "processing", "render", "reasoning", "tool", "tool"]);
    assert.equal(snapshot.events[0].content, "先读取家庭数据。");
    assert.equal(snapshot.events[0].revision, 3);
    assert.equal(snapshot.events[1].title, "Home Assistant · 读取设备状态");
    assert.equal(snapshot.events[2].content, "现在合并时间线。");
    assert.equal(snapshot.events[5].content, fallbackReasoning);
    assert.ok(snapshot.events.every((event) => ["completed", "failed"].includes(event.status) && event.completed_at));
    assert.equal(snapshot.events.at(-1)?.status, "failed");
    assert.notEqual(snapshot.events.at(-1)?.activity_id, snapshot.events.at(-2)?.activity_id);
    assert.ok(pushed.some((event) => event.topic === "conversation.execution.updated" && event.payload.content === "先读取"));
    assert.doesNotMatch(JSON.stringify(pushed.filter((event) => event.topic === "conversation.execution.updated")), /must-not-leak/);
    const restarted = new ConversationService(db, {} as any, () => {});
    const restored = await restarted.get(conversation, device);
    assert.deepEqual(restored.events, snapshot.events);
    assert.equal(starts, 1);
    assert.deepEqual(runOptions.modelOptions, { reasoning_effort: "high" });
    assert.deepEqual(runOptions.skills, ["家庭助手", "照片管理"]);
    let title = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      title = String((await db.query("SELECT title FROM conversations WHERE id=$1", [conversation])).rows[0]?.title ?? "");
      if (title !== "新会话") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(title, "猫咪活动趋势");
    assert.ok(pushed.some((event) => event.topic === "conversation.updated" && event.payload.title === "猫咪活动趋势"));
    const push = (topic: string, payload: unknown) => pushed.push({ topic, payload });
    const workspaces = new WorkspaceStore(db, push);
    const results = new ConversationResults(db, workspaces, push);
    const view = { ui_protocol: "2.0", id: "cat_photos", revision: 1, intent: "search", title: "猫咪照片精选", layout: { type: "workspace" }, sections: [{ id: "photos", role: "primary", component: "photo_grid", title: "三张照片", data: { items: [] }, fallback: "未找到照片" }], fallback: "暂无结果" };
    const inline = await results.begin(device, accepted.turn_id, "cat_photos", "猫咪照片精选", "inline");
    assert.equal(inline.workspace_id, null);
    const inlineReady = await results.complete(device, inline, view);
    assert.equal(inlineReady.target, "inline");
    assert.equal((await workspaces.list(device, conversation)).length, 0);
    const workspace = await results.begin(device, accepted.turn_id, "usage_analysis", "今日用量分析", "workspace");
    assert.equal(workspace.status, "loading");
    const ready = await results.complete(device, workspace, { ...view, id: "usage_analysis", title: "今日用量分析" });
    const nextTurn = await service.accept(device, { conversation_id: conversation, content: "加上最近七天", idempotency_key: randomUUID() });
    const next = await results.begin(device, nextTurn.turn_id, "usage_analysis", "最近七天用量", "workspace");
    const updated = await results.complete(device, next, { ...view, id: "usage_analysis", revision: 2, title: "最近七天用量" });
    assert.equal(updated.workspace_id, ready.workspace_id);
    assert.equal(updated.artifact_id, ready.artifact_id);
    const persisted = await workspaces.get(device, ready.workspace_id!);
    assert.equal(persisted.artifacts.length, 1);
    assert.equal(Number(persisted.artifacts[0].revision), 1);
    assert.equal(JSON.parse(persisted.artifacts[0].source).revision, 2);
    assert.equal((await restarted.get(conversation, device)).results.length, 3);
    await service.delete(conversation, device);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM conversation_events WHERE conversation_id=$1", [conversation])).rows[0].n, 0);
  } finally {
    await service.close(); await db.end();
    await admin.query(`DROP DATABASE "${databaseName}"`); await admin.end();
    for (const key of ["HERMES_ENABLED", "HERMES_URL", "HERMES_API_KEY", "HERMES_BRIDGE_KEY"]) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
  }
});
