import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, migrate } from "../apps/server/src/persistence.js";
import { ConversationService } from "../packages/conversation/src/index.js";
import { HermesClient } from "../packages/hermes-bridge/src/index.js";

test("stop is owner-scoped, atomically cancels queued work, and is idempotent", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const admin = database(process.env.TEST_DATABASE_URL!);
  const name = `stop_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
  const db = database(url.toString());
  const service = new ConversationService(db, {} as any, () => {});
  try {
    await migrate(db);
    const owner = randomUUID(), stranger = randomUUID(), conversation = randomUUID();
    for (const device of [owner, stranger]) await db.query("INSERT INTO devices(id,token_hash,role) VALUES($1,$2,'device')", [device, randomUUID()]);
    await db.query("INSERT INTO conversations(id,title,owner_device_id) VALUES($1,'Stop test',$2)", [conversation, owner]);
    const accepted = await service.accept(owner, { conversation_id: conversation, content: "queued", idempotency_key: randomUUID() });
    await assert.rejects(service.stop(stranger, accepted.turn_id), /not_found/);
    assert.deepEqual(await service.stop(owner, accepted.turn_id), { status: "cancelled" });
    assert.deepEqual(await service.stop(owner, accepted.turn_id), { status: "cancelled" });
    assert.equal((await db.query("SELECT status,stop_requested FROM conversation_turns WHERE id=$1", [accepted.turn_id])).rows[0].status, "cancelled");
    assert.equal((await db.query("SELECT status FROM conversation_messages WHERE id=$1", [accepted.reply_id])).rows[0].status, "cancelled");
    await service.schedule();
    assert.equal((await db.query("SELECT status FROM conversation_messages WHERE id=$1", [accepted.reply_id])).rows[0].status, "cancelled");
  } finally {
    await service.close(); await db.end(); await admin.query(`DROP DATABASE "${name}"`); await admin.end();
  }
});

test("stop sends Hermes run stop and marks the turn cancelled only after upstream confirmation", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const admin = database(process.env.TEST_DATABASE_URL!);
  const name = `run_stop_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
  const db = database(url.toString());
  const old = { enabled: process.env.HERMES_ENABLED, url: process.env.HERMES_URL, key: process.env.HERMES_API_KEY, bridge: process.env.HERMES_BRIDGE_KEY };
  Object.assign(process.env, { HERMES_ENABLED: "1", HERMES_URL: "http://unused", HERMES_API_KEY: "test", HERMES_BRIDGE_KEY: "test" });
  let stopUpstream!: () => void;
  const upstreamStopped = new Promise<void>((resolve) => { stopUpstream = resolve; });
  let eventsConnected!: () => void;
  const connected = new Promise<void>((resolve) => { eventsConnected = resolve; });
  const service = new ConversationService(db, {} as any, () => {});
  t.mock.method(HermesClient.prototype, "startRun", async () => ({ run_id: "run-being-stopped", status: "running" }));
  t.mock.method(HermesClient.prototype, "runEvents", async function* () { eventsConnected(); await upstreamStopped; yield { event: "run.cancelled", status: "cancelled" }; });
  t.mock.method(HermesClient.prototype, "stopRun", async (runId: string) => { assert.equal(runId, "run-being-stopped"); stopUpstream(); return { run_id: runId, status: "stopping" }; });
  try {
    await migrate(db);
    const owner = randomUUID(), conversation = randomUUID();
    await db.query("INSERT INTO devices(id,token_hash,role) VALUES($1,$2,'device')", [owner, randomUUID()]);
    await db.query("INSERT INTO conversations(id,title,owner_device_id) VALUES($1,'Run stop',$2)", [conversation, owner]);
    const accepted = await service.accept(owner, { conversation_id: conversation, content: "running", idempotency_key: randomUUID() });
    await service.schedule(); await connected;
    assert.deepEqual(await service.stop(owner, accepted.turn_id), { status: "stopping" });
    await Promise.all((service as any).active.values());
    assert.equal((await db.query("SELECT status FROM conversation_turns WHERE id=$1", [accepted.turn_id])).rows[0].status, "cancelled");
    assert.equal((await db.query("SELECT status FROM conversation_messages WHERE id=$1", [accepted.reply_id])).rows[0].status, "cancelled");
  } finally {
    stopUpstream?.(); await service.close(); await db.end(); await admin.query(`DROP DATABASE "${name}"`); await admin.end();
    for (const [key, value] of Object.entries({ HERMES_ENABLED: old.enabled, HERMES_URL: old.url, HERMES_API_KEY: old.key, HERMES_BRIDGE_KEY: old.bridge })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
