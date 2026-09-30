import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, migrate } from "../apps/server/src/persistence.js";
import { UsageCollector } from "../packages/llm-usage/src/index.js";

test("usage summary ranks only the owner's real conversations by total tokens", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const admin = database(process.env.TEST_DATABASE_URL!);
  const databaseName = `usage_rank_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${databaseName}`;
  const db = database(url.toString());
  try {
    await migrate(db);
    const owner = randomUUID(), other = randomUUID();
    await db.query("INSERT INTO devices(id,token_hash,role) VALUES($1,$2,'device'),($3,$4,'device')", [owner, randomUUID(), other, randomUUID()]);
    const favorite = randomUUID(), second = randomUUID(), privateConversation = randomUUID();
    await db.query("INSERT INTO conversations(id,title,owner_device_id) VALUES($1,'家庭相册整理',$2),($3,'今日猫咪活动',$2),($4,'他人的会话',$5)", [favorite, owner, second, privateConversation, other]);
    const startedAt = new Date(Date.now() - 30_000).toISOString();
    const rows = [
      [favorite, 6_000_000, 2_040_000],
      [favorite, 0, 0],
      [second, 1_000_000, 500_000],
      [privateConversation, 60_000_000, 40_000_000],
    ];
    for (const [conversationId, input, output] of rows) await db.query(
      "INSERT INTO llm_requests(id,provider,model,input_tokens,output_tokens,status,started_at,finished_at,conversation_id) VALUES($1,'test','model',$2,$3,'success',$4,$4,$5)",
      [randomUUID(), input, output, startedAt, conversationId],
    );
    const collector = new UsageCollector(db, {}, () => {});
    const summary = await collector.summary({ range: "today" }, owner);
    assert.equal(summary.total.input_tokens, 7_000_000);
    assert.deepEqual(summary.top_conversations.map((row: any) => [row.title, row.tokens, row.requests, row.share_percent]), [
      ["家庭相册整理", 8_040_000, 2, 84.3],
      ["今日猫咪活动", 1_500_000, 1, 15.7],
    ]);
    assert.ok(summary.top_conversations.every((row: any) => row.title !== "他人的会话"));
  } finally {
    await db.end();
    await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin.end();
  }
});
