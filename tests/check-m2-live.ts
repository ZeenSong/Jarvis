// Opt-in real Core verification against an isolated test database.
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { buildApp } from "../apps/server/src/app.js";
import { pair, createPairingCode } from "../apps/server/src/auth.js";
process.env.DEEPSEEK_API_KEY = (
  await readFile(process.env.LLM_API_KEY_FILE!, "utf8")
).trim();
if (!process.env.CORE_MODEL) throw Error("CORE_MODEL required");
const ctx = await buildApp({ databaseUrl: process.env.TEST_DATABASE_URL! });
try {
  const auth = await pair(
    ctx.db,
    randomUUID(),
    await createPairingCode(ctx.db),
  );
  const c: any = await ctx.m2.handle(
    "conversation.create",
    { title: "M2 真实 Core 验证" },
    auth.device_id,
  );
  const p = {
    conversation_id: c.id,
    content: "你好，我叫小明。请用一句话介绍你自己，并记住我的名字。",
    idempotency_key: randomUUID(),
  };
  const reply: any = await ctx.m2.conversations.accept(auth.device_id, p);
  async function wait(id: string) {
    for (let i = 0; i < 240; i++) {
      const s = await ctx.m2.conversations.get(c.id);
      const m = s.messages.find((m: any) => m.id === id);
      if (m && ["completed", "failed"].includes(m.status)) {
        assert.equal(m.status, "completed", m.content);
        return m;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw Error("live_timeout");
  }
  const a = await wait(reply.reply_id);
  const second: any = await ctx.m2.conversations.accept(auth.device_id, {
    ...p,
    content: "我叫什么名字？请查看当前服务器状态，给我一句简短回答。",
    idempotency_key: randomUUID(),
  });
  const b = await wait(second.reply_id);
  assert.match(b.content, /小明/);
  const usage = (
    await ctx.db.query(
      "SELECT count(*)::int requests,sum(input_tokens)::int input_tokens,sum(output_tokens)::int output_tokens FROM llm_requests WHERE conversation_id=$1",
      [c.id],
    )
  ).rows[0];
  assert.ok(usage.input_tokens > 0);
  assert.ok(usage.output_tokens > 0);
  console.log(
    JSON.stringify({
      conversation_id: c.id,
      status: "passed",
      model: process.env.CORE_MODEL,
      replies: [a.content, b.content],
      usage,
    }),
  );
} finally {
  await ctx.app.close();
}
