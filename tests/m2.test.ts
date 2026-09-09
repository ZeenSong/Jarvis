import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/server/src/app.js";
import { createPairingCode } from "../apps/server/src/auth.js";
import {
  canTransition,
  childDepth,
  RuntimeRegistry,
  type AgentRuntime,
  type AgentEvent,
} from "../packages/agent-runtime/src/index.js";
import { transaction } from "../packages/agent-manager/src/index.js";
import {
  blockTypes,
  viewSchema,
  intentSchema,
  applyResource,
  readPath,
} from "../packages/ui-protocol/src/index.js";
import { permitted } from "../apps/server/src/permissions.js";

test("M2 terminal states, depth, permissions and safe shared UI", () => {
  for (const state of ["completed", "failed", "cancelled"] as const)
    assert.equal(canTransition(state, "running"), false);
  assert.equal(canTransition("running", "completed"), true);
  assert.equal(childDepth(0), 1);
  assert.equal(childDepth(1), 2);
  assert.throws(() => childDepth(2));
  assert.equal(permitted("device", "agent.run.cancel"), true);
  assert.equal(permitted("agent", "agent.run.create"), false);
  assert.equal(permitted("device", "agent.register"), false);
  assert.equal(permitted("agent", "conversation.get"), false);
  assert.equal(blockTypes.length, 18);
  assert.throws(() =>
    intentSchema.parse({
      type: "view.show",
      intent: "system_overview",
      resources: ["../../etc/passwd"],
    }),
  );
  assert.throws(() =>
    viewSchema.parse({
      version: 1,
      type: "dashboard",
      title: "x",
      blocks: [{ type: "markdown", title: "x", html: "<script/>" }],
    }),
  );
  const r = {
    version: 1 as const,
    resource: "system/status",
    revision: 10,
    data: { cpu: 1 },
  };
  assert.equal(applyResource(r, { ...r, revision: 9 }), r);
  assert.equal(readPath({}, "__proto__.polluted"), undefined);
});
const url = process.env.TEST_DATABASE_URL;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 100; i++) {
    const v = await fn();
    if (ok(v)) return v;
    await delay(50);
  }
  throw Error("condition_timeout");
}
test(
  "M2 durable idempotency, deterministic conversation, cookie origin, cancellation, archive, recovery and M1 migration",
  { skip: !url },
  async () => {
    const registry = new RuntimeRegistry();
    const cancelled = new Set<string>();
    const disposed = new Set<string>();
    const runtime: AgentRuntime = {
      async start(i) {
        return { id: i.id };
      },
      async send() {},
      async resume() {},
      async cancel(id) {
        cancelled.add(id);
      },
      async dispose(id) {
        disposed.add(id);
      },
      async health() {
        return { healthy: true };
      },
      async *events(id) {
        yield {
          sequence: 1,
          type: "agent.tool.started",
          payload: { title: "测试工具" },
        };
        while (!cancelled.has(id)) await delay(20);
        yield {
          sequence: 2,
          type: "agent.run.completed",
          payload: { summary: "late" },
        };
      },
    };
    registry.register("codex", runtime);
    registry.register("pydantic", runtime);
    let ctx = await buildApp({ databaseUrl: url!, runtimes: registry });
    let device = "",
      token = "";
    try {
      const code = await createPairingCode(ctx.db);
      device = randomUUID();
      const pair = await ctx.app.inject({
        method: "POST",
        url: "/api/v1/pair",
        payload: { device_id: device, code },
      });
      token = pair.json().token;
      const headers = { authorization: "Bearer " + token };
      const rpc = async (topic: string, payload: any = {}) => {
        const r = await ctx.app.inject({
          method: "POST",
          url: "/api/v2/" + topic,
          headers,
          payload,
        });
        assert.equal(r.statusCode, 200, r.body);
        return r.json();
      };
      const conversation = await rpc("conversation.create", {
        title: "M2 集成测试",
      });
      const p = {
        conversation_id: conversation.id,
        content: "CPU 现在多少？",
        idempotency_key: randomUUID(),
      };
      const [a, b] = await Promise.all([
        rpc("conversation.message", p),
        rpc("conversation.message", p),
      ]);
      assert.deepEqual(a, b);
      const done = await until(
        () => rpc("conversation.get", { conversation_id: conversation.id }),
        (r) =>
          r.messages.some(
            (m: any) => m.id === a.reply_id && m.status === "completed",
          ),
      );
      assert.equal(done.messages.length, 2);
      assert.match(done.messages[1].content, /CPU/);
      assert.equal(done.runs.length, 0);
      const reused = await ctx.app.inject({
        method: "POST",
        url: "/api/v2/conversation.message",
        headers,
        payload: { ...p, content: "different" },
      });
      assert.notEqual(reused.statusCode, 200);
      const snap1 = await rpc("resource.get", { resource: "system/status" }),
        snap2 = await rpc("resource.get", { resource: "system/status" });
      assert.ok(snap2.revision > snap1.revision);
      const parent = await transaction(ctx.db, (c) =>
        ctx.m2.manager.create(
          c,
          {
            agent_id: "jarvis-core",
            conversation_id: conversation.id,
            goal: "parent",
          },
          device,
        ),
      );
      const child = await transaction(ctx.db, (c) =>
        ctx.m2.manager.create(
          c,
          {
            agent_id: "coding-agent",
            parent_run_id: parent.id,
            conversation_id: conversation.id,
            goal: "child",
          },
          device,
        ),
      );
      const grand = await transaction(ctx.db, (c) =>
        ctx.m2.manager.create(
          c,
          {
            agent_id: "ops-agent",
            parent_run_id: child.id,
            conversation_id: conversation.id,
            goal: "grand",
          },
          device,
        ),
      );
      await assert.rejects(
        transaction(ctx.db, (c) =>
          ctx.m2.manager.create(
            c,
            {
              agent_id: "ops-agent",
              parent_run_id: grand.id,
              conversation_id: conversation.id,
              goal: "too deep",
            },
            device,
          ),
        ),
        /depth/,
      );
      await rpc("agent.run.cancel", { run_id: parent.id });
      for (const r of [parent, child, grand])
        assert.equal((await ctx.m2.manager.get(r.id)).run.status, "cancelled");
      await ctx.m2.manager.ingest(child.id, {
        type: "agent.run.completed",
        payload: { summary: "late" },
      });
      assert.equal(
        (await ctx.m2.manager.get(child.id)).run.status,
        "cancelled",
      );
      await assert.rejects(
        transaction(ctx.db, (c) =>
          ctx.m2.manager.create(
            c,
            {
              agent_id: "ops-agent",
              parent_run_id: parent.id,
              conversation_id: conversation.id,
              goal: "late child",
            },
            device,
          ),
        ),
        /invalid_parent/,
      );
      const run = await transaction(ctx.db, (c) =>
        ctx.m2.manager.create(
          c,
          {
            agent_id: "jarvis-core",
            conversation_id: conversation.id,
            goal: "archivable",
          },
          device,
        ),
      );
      await ctx.m2.manager.transition(run.id, "starting");
      await ctx.m2.manager.transition(run.id, "running");
      await ctx.m2.manager.ingest(run.id, {
        type: "agent.usage.updated",
        sequence: 1,
        payload: {
          provider: "test",
          model: "m2",
          input_tokens: 42,
          output_tokens: 7,
        },
      });
      await ctx.m2.manager.ingest(run.id, {
        type: "agent.run.completed",
        sequence: 2,
        payload: { summary: "ok", diff: "+new file" },
      });
      // Replaying the durable worker journal must not duplicate billable usage.
      await ctx.m2.manager.ingest(run.id, {
        type: "agent.usage.updated",
        sequence: 1,
        payload: {
          provider: "test",
          model: "m2",
          input_tokens: 42,
          output_tokens: 7,
        },
      });
      // Cancellation wins the state race; the final worker export still survives.
      await ctx.m2.manager.ingest(child.id, {
        type: "agent.run.completed",
        sequence: 10,
        payload: { summary: "cancelled export", diff: "+partial work" },
      });
      const cancelledExport = await ctx.m2.manager.get(child.id);
      assert.equal(cancelledExport.run.status, "cancelled");
      assert.equal(cancelledExport.run.result_json.diff, "+partial work");
      assert.ok(
        (await ctx.m2.manager.get(grand.id)).tree.some(
          (r: any) => r.id === parent.id,
        ),
      );
      assert.ok(
        cancelledExport.artifacts.some((a: any) => a.name === "changes.diff"),
      );
      const archived = await ctx.m2.manager.get(run.id);
      assert.equal(archived.run.status, "completed");
      assert.equal(archived.usage.input_tokens, 42);
      assert.ok(archived.artifacts.some((a: any) => a.name === "changes.diff"));
      const orphan = await transaction(ctx.db, (c) =>
        ctx.m2.manager.create(
          c,
          { agent_id: "coding-agent", goal: "already archived before crash" },
          device,
        ),
      );
      await ctx.m2.manager.transition(orphan.id, "starting");
      await ctx.m2.manager.transition(orphan.id, "running");
      await ctx.m2.manager.ingest(orphan.id, {
        sequence: 2,
        type: "agent.run.completed",
        payload: { summary: "original result", diff: "+original" },
      });
      const instance = randomUUID();
      await ctx.db.query(
        "INSERT INTO agent_instances(id,agent_definition_id,runtime_type,status) VALUES($1,'coding-agent','codex','running')",
        [instance],
      );
      await ctx.db.query(
        "UPDATE agent_runs SET agent_instance_id=$2,runtime_run_id=$1 WHERE id=$1",
        [orphan.id, instance],
      );
      await ctx.m2.manager.recover();
      assert.ok(
        disposed.has(orphan.id),
        "Restart must dispose an already archived Worker",
      );
      assert.equal(
        (await ctx.m2.manager.get(orphan.id)).run.result_json.summary,
        "original result",
      );
      assert.equal(
        (await ctx.m2.manager.get(orphan.id)).run.status,
        "completed",
      );
      const agentCode = await createPairingCode(ctx.db, "agent");
      const agent = await ctx.app.inject({
        method: "POST",
        url: "/api/v1/pair",
        payload: { device_id: randomUUID(), code: agentCode },
      });
      assert.equal(
        (
          await ctx.app.inject({
            method: "POST",
            url: "/api/v2/conversation.list",
            headers: { authorization: "Bearer " + agent.json().token },
            payload: {},
          })
        ).statusCode,
        403,
      );
      const webCode = await createPairingCode(ctx.db);
      const paired = await ctx.app.inject({
        method: "POST",
        url: "/api/v1/pair",
        headers: { origin: "http://localhost:80" },
        payload: { device_id: randomUUID(), code: webCode },
      });
      assert.equal(paired.statusCode, 200);
      assert.equal(paired.json().token, undefined);
      const cookie = String(paired.headers["set-cookie"]).split(";")[0];
      assert.match(String(paired.headers["set-cookie"]), /HttpOnly/);
      assert.equal(
        (await ctx.app.inject({ url: "/api/v2/session", headers: { cookie } }))
          .statusCode,
        200,
      );
      assert.equal(
        (
          await ctx.app.inject({
            method: "POST",
            url: "/api/v2/conversation.list",
            headers: { cookie, origin: "https://evil.invalid" },
            payload: {},
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await ctx.app.inject({
            method: "POST",
            url: "/api/v2/conversation.list",
            headers: { cookie },
            payload: {},
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await ctx.app.inject({
            method: "POST",
            url: "/api/v2/conversation.list",
            headers: { cookie, origin: "http://localhost:80" },
            payload: {},
          })
        ).statusCode,
        200,
      );
      const tables = await ctx.db.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name IN ('agents','devices','agent_events','run_events')",
      );
      assert.equal(tables.rowCount, 4);
      await ctx.app.close();
      ctx = await buildApp({ databaseUrl: url!, runtimes: registry });
      assert.deepEqual(await ctx.m2.conversations.accept(device, p), a);
      assert.equal(
        (await ctx.m2.conversations.get(conversation.id)).messages.length,
        2,
      );
    } finally {
      await ctx.app.close();
    }
  },
);

test("shared Web / Compose fixture contains every supported block", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixture = JSON.parse(
    await readFile("packages/ui-protocol/examples/all-blocks.json", "utf8"),
  );
  const view = viewSchema.parse(fixture.view);
  assert.deepEqual(
    view.blocks.map((b) => b.type),
    [...blockTypes],
  );
});
