import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, migrate } from "../apps/server/src/persistence.js";
import { ConversationService } from "../packages/conversation/src/index.js";
import { HermesClient } from "../packages/hermes-bridge/src/index.js";

test("question answers persist, resume Hermes, survive restart and serialize with old completion", { skip: !process.env.QUESTION_TEST_DATABASE_URL }, async (t) => {
  const admin = database(process.env.QUESTION_TEST_DATABASE_URL!);
  const name = `question_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.QUESTION_TEST_DATABASE_URL!); url.pathname = `/${name}`;
  const db = database(url.toString());
  const env = { ...process.env };
  Object.assign(process.env, { HERMES_ENABLED: "1", HERMES_URL: "http://unused", HERMES_API_KEY: "test", HERMES_BRIDGE_KEY: "test" });
  const starts: { text: string; options: any }[] = [];
  let onRun: (() => Promise<void>) | undefined;
  t.mock.method(HermesClient.prototype, "startRun", async (text: string, options: any) => {
    starts.push({ text, options }); return { run_id: `run-${starts.length}`, status: "running" };
  });
  t.mock.method(HermesClient.prototype, "runEvents", async function* () {
    const action = onRun; onRun = undefined;
    if (action) await action();
    yield { event: "run.completed", output: "已继续执行" };
  });
  const service = () => new ConversationService(db, {} as any, () => {});
  try {
    await migrate(db);
    const device = randomUUID();
    await db.query("INSERT INTO devices(id,token_hash,role) VALUES($1,$2,'device')", [device, randomUUID()]);
    const setup = async () => {
      const conversation = randomUUID();
      await db.query("INSERT INTO conversations(id,title,owner_device_id) VALUES($1,'test',$2)", [conversation, device]);
      const s = service();
      const accepted = await s.accept(device, { conversation_id: conversation, content: "请继续任务", idempotency_key: randomUUID() });
      return { s, conversation, accepted };
    };
    const state = async (turn: string) => (await db.query("SELECT * FROM conversation_turns WHERE id=$1", [turn])).rows[0];
    const drain = async (s: ConversationService) => {
      await s.schedule();
      await Promise.all((s as any).active.values());
    };

    // Complete the old run before answering: it must remain waiting and active.
    const a = await setup(); let question: any;
    onRun = async () => { question = await a.s.createQuestion(device, { turn_id: a.accepted.turn_id, kind: "boolean", prompt: "继续吗？" }); };
    await drain(a.s);
    assert.equal((await state(a.accepted.turn_id)).status, "waiting_question");
    assert.equal((await state(a.accepted.turn_id)).finished_at, null);
    const answers = await Promise.all(Array.from({ length: 6 }, () => a.s.answerQuestion(device, question.id, false)));
    assert.ok(answers.every((answer) => answer.answer === false));
    await assert.rejects(a.s.answerQuestion(device, question.id, true), /question_answer_conflict/);
    assert.equal((await db.query("SELECT count(*) FROM m2_idempotency WHERE request->>'question_id'=$1", [question.id])).rows[0].count, "1");
    assert.equal((await state(a.accepted.turn_id)).status, "queued");
    // A fresh service consumes the DB queue; no in-memory callback is required.
    await a.s.close();
    const restarted = service(); await restarted.recover(); await drain(restarted);
    assert.match(starts.at(-1)!.text, /继续吗？\n回答：否/);
    assert.equal(starts.at(-1)!.options.sessionId, a.conversation);
    assert.equal((await state(a.accepted.turn_id)).status, "completed");
    assert.equal((await db.query("SELECT count(*) FROM conversation_messages WHERE turn_id=$1 AND role='jarvis' AND status='completed'", [a.accepted.turn_id])).rows[0].count, "2");
    const count = starts.length;
    await restarted.answerQuestion(device, question.id, false); await drain(restarted);
    assert.equal(starts.length, count);
    await restarted.close();

    // Answer while the old run is still executing, then deliver its completion.
    const b = await setup();
    onRun = async () => {
      const q = await b.s.createQuestion(device, { turn_id: b.accepted.turn_id, kind: "single_choice", prompt: "选择时间", options: [{ value: "morning", label: "早上" }, { value: "evening", label: "晚上" }] });
      await assert.rejects(b.s.answerQuestion(device, q.id, "invalid"), /question_answer_invalid/);
      await b.s.answerQuestion(device, q.id, "morning");
    };
    await drain(b.s);
    assert.equal((await state(b.accepted.turn_id)).status, "queued");
    assert.equal((await state(b.accepted.turn_id)).finished_at, null);
    await drain(b.s);
    assert.match(starts.at(-1)!.text, /回答：早上/);
    assert.equal((await state(b.accepted.turn_id)).status, "completed");
    await b.s.close();

    // Multiple pending questions hold the queue until every answer is durable.
    const c = await setup(); let questions: any[] = [];
    onRun = async () => {
      for (const prompt of ["确认时间？", "确认范围？"]) questions.push(await c.s.createQuestion(device, { turn_id: c.accepted.turn_id, kind: "boolean", prompt }));
    };
    await drain(c.s);
    await assert.rejects(c.s.answerQuestion("unknown-device", questions[0].id, true), /question_not_pending/);
    // Force a queue-write failure: the answer update must roll back with it.
    await db.query(`CREATE FUNCTION reject_question_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test_queue_failure'; END $$`);
    await db.query("CREATE TRIGGER reject_question_queue BEFORE INSERT ON m2_idempotency FOR EACH ROW EXECUTE FUNCTION reject_question_queue()");
    await assert.rejects(c.s.answerQuestion(device, questions[0].id, true), /test_queue_failure/);
    assert.equal((await db.query("SELECT status FROM conversation_questions WHERE id=$1", [questions[0].id])).rows[0].status, "pending");
    await db.query("DROP TRIGGER reject_question_queue ON m2_idempotency");
    await c.s.answerQuestion(device, questions[0].id, true);
    const before = starts.length;
    await drain(c.s);
    assert.equal(starts.length, before);
    assert.equal((await state(c.accepted.turn_id)).status, "waiting_question");
    await c.s.answerQuestion(device, questions[1].id, false);
    await drain(c.s); await drain(c.s);
    assert.equal(starts.length, before + 2);
    assert.equal((await state(c.accepted.turn_id)).status, "completed");
    await c.s.close();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await db.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
