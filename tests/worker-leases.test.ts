import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, migrate } from "../apps/server/src/persistence.js";
import { AgentManager } from "../packages/agent-manager/src/index.js";
import { ConversationService } from "../packages/conversation/src/index.js";
import { LeaseStore } from "../packages/leases/src/index.js";
import { RuntimeRegistry } from "../packages/agent-runtime/src/index.js";

/**
 * The two worker loops used to be safe only because exactly one process ran.
 * These tests pin the replacement contract: a claim is exclusive, an orphaned
 * reply is adopted rather than stranded, and a live lease protects work from
 * another worker's recovery sweep.
 */
const url = process.env.TEST_DATABASE_URL;

const drain = async (service: ConversationService) => {
  await service.schedule();
  await Promise.all((service as any).active.values());
};

const leasesOf = async (db: ReturnType<typeof database>, like: string) =>
  (await db.query("SELECT * FROM leases WHERE kind LIKE $1 ORDER BY kind", [like])).rows;

test("worker leases: claims are exclusive, orphans are adopted, live work is untouched", { skip: !url }, async () => {
  const db = database(url!);
  await migrate(db);
  const device = `lease-device-${randomUUID()}`;
  const agentId = `lease-agent-${randomUUID()}`;
  // A private runtime type keeps the claim isolated from runs other test files
  // left queued in the shared scratch database.
  const runtimeType = `lease-runtime-${randomUUID()}`;
  await db.query("INSERT INTO devices(id,token_hash,role) VALUES($1,$2,'device')", [device, randomUUID()]);
  await db.query(
    "INSERT INTO agent_definitions(id,name,tier,role,runtime_type,lifecycle) VALUES($1,'租约测试','managed','tester','codex','persistent')",
    [agentId],
  );
  const registry = new RuntimeRegistry();
  const manager = new AgentManager(db, registry, () => {});
  const push: string[] = [];
  const conversationLeases = new LeaseStore(db);

  try {
    // ---- task claims -------------------------------------------------------
    const runId = randomUUID();
    await db.query(
      "INSERT INTO agent_runs(id,agent_id,requested_by,goal,runtime_type,status,depth) VALUES($1,$2,$3,'租约任务',$4,'queued',0)",
      [runId, agentId, device, runtimeType],
    );
    const first = await (manager as any).claim(runtimeType);
    assert.equal(first?.id, runId, "the queued run is claimed");
    assert.equal((await manager.get(runId)).run.status, "starting");
    const held = (await leasesOf(db, `agent-run:${runId}`))[0];
    assert.equal(held?.owner, (manager as any).workerId);
    assert.equal(Number(held?.attempt), 1);

    const second = await (manager as any).claim(runtimeType);
    assert.equal(second, undefined, "an already claimed run cannot be claimed twice");

    // A live lease protects the run from another worker's sweep.
    await (manager as any).sweepOrphanedRuns();
    assert.equal((await manager.get(runId)).run.status, "starting");

    // Once the lease expires, the run is reported as lost rather than left running.
    await db.query("UPDATE leases SET expires_at=now()-interval '1 minute' WHERE kind=$1", [`agent-run:${runId}`]);
    await (manager as any).sweepOrphanedRuns();
    const lost = (await manager.get(runId)).run;
    assert.equal(lost.status, "failed");
    assert.equal(lost.error_json.code, "worker_lost");

    // A queued run is never failed by the sweep: it was never claimed, so any
    // live worker is free to start it.
    const queuedId = randomUUID();
    await db.query(
      "INSERT INTO agent_runs(id,agent_id,requested_by,goal,runtime_type,status,depth) VALUES($1,$2,$3,'排队任务',$4,'queued',0)",
      [queuedId, agentId, device, runtimeType],
    );
    await (manager as any).sweepOrphanedRuns();
    assert.equal((await manager.get(queuedId)).run.status, "queued");

    // ---- conversation failover --------------------------------------------
    const conversationId = randomUUID();
    await db.query("INSERT INTO conversations(id,title,owner_device_id) VALUES($1,'租约会话',$2)", [conversationId, device]);
    const replyId = randomUUID();
    await db.query(
      "INSERT INTO conversation_messages(id,conversation_id,role,content,status,hermes_run_id) VALUES($1,$2,'jarvis','半句话','streaming','run-dead')",
      [replyId, conversationId],
    );
    // The dead worker's lease is still in the table but has expired.
    await conversationLeases.acquire(`conversation:${conversationId}`, "dead-worker", 45);
    await db.query("UPDATE leases SET expires_at=now()-interval '1 minute' WHERE kind=$1", [`conversation:${conversationId}`]);

    const service = new ConversationService(db, manager, (topic) => push.push(topic));
    let processed = 0;
    (service as any).process = async (id: string) => {
      if (id === conversationId) processed += 1;
    };
    await drain(service);
    const adopted = (await db.query("SELECT status FROM conversation_messages WHERE id=$1", [replyId])).rows[0];
    assert.equal(adopted.status, "queued", "the orphaned reply is re-queued so it can resume");
    assert.equal(processed, 1, "the adopting worker runs it exactly once");
    assert.equal((await leasesOf(db, `conversation:${conversationId}`)).length, 0, "the lease is released after the reply");

    // A conversation another worker is streaming right now is not stolen.
    await db.query("UPDATE conversation_messages SET status='streaming' WHERE id=$1", [replyId]);
    const live = await conversationLeases.acquire(`conversation:${conversationId}`, "live-worker", 45);
    assert.equal(live.acquired, true);
    const other = new ConversationService(db, manager, (topic) => push.push(topic));
    let stolen = 0;
    (other as any).process = async (id: string) => {
      if (id === conversationId) stolen += 1;
    };
    await drain(other);
    assert.equal(stolen, 0, "a live owner keeps the conversation");
    assert.equal(
      (await db.query("SELECT status FROM conversation_messages WHERE id=$1", [replyId])).rows[0].status,
      "streaming",
      "the live owner's reply is not rewritten by a second worker",
    );
  } finally {
    await db.query("DELETE FROM leases WHERE kind LIKE $1 OR kind LIKE $2", ["agent-run:%", `conversation:%`]);
    await db.query("DELETE FROM run_events WHERE run_id IN (SELECT id FROM agent_runs WHERE agent_id=$1)", [agentId]);
    await db.query("DELETE FROM artifacts WHERE run_id IN (SELECT id FROM agent_runs WHERE agent_id=$1)", [agentId]);
    await db.query("UPDATE agent_runs SET agent_instance_id=NULL WHERE agent_id=$1", [agentId]);
    await db.query("DELETE FROM agent_instances WHERE agent_definition_id=$1", [agentId]);
    await db.query("DELETE FROM agent_runs WHERE agent_id=$1", [agentId]);
    await db.query("DELETE FROM agent_definitions WHERE id=$1", [agentId]);
    await db.query("DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE owner_device_id=$1)", [device]);
    await db.query("DELETE FROM conversations WHERE owner_device_id=$1", [device]);
    await db.query("DELETE FROM devices WHERE id=$1", [device]);
    await db.end();
  }
});
