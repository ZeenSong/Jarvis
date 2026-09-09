// Automatic UI tests only. Real acceptance uses check-m2-delegation.ts.
import {
  RuntimeRegistry,
  type AgentRuntime,
} from "../packages/agent-runtime/src/index.js";
import { transaction } from "../packages/agent-manager/src/index.js";
import { pair, createPairingCode } from "../apps/server/src/auth.js";
import { randomUUID } from "node:crypto";
import type { buildApp } from "../apps/server/src/app.js";
export function controlledRegistry() {
  const decisions = new Map<string, { text?: string; cancel?: boolean }>();
  const runtime: AgentRuntime = {
    async start(input) {
      decisions.set(input.id, {});
      return { id: input.id };
    },
    async send(id, input) {
      decisions.set(id, { text: input.text });
    },
    async resume(id, input) {
      decisions.set(id, { text: input?.text });
    },
    async cancel(id) {
      decisions.set(id, { cancel: true });
    },
    async dispose() {},
    async health() {
      return { healthy: true };
    },
    async *events(id, signal) {
      yield {
        sequence: 1,
        type: "agent.waiting_user",
        payload: { title: "等待补充输入" },
      };
      while (!decisions.get(id)?.text && !decisions.get(id)?.cancel) {
        signal?.throwIfAborted();
        await new Promise((r) => setTimeout(r, 20));
      }
      const decision = decisions.get(id)!;
      yield {
        sequence: 2,
        type: decision.cancel ? "agent.run.cancelled" : "agent.run.completed",
        payload: {
          summary: decision.cancel
            ? "取消后归档完成"
            : "输入已收到：" + decision.text,
          diff: decision.cancel ? "+取消前的工作" : "",
        },
      };
    },
  };
  const registry = new RuntimeRegistry();
  registry.register("pydantic", runtime);
  registry.register("codex", runtime);
  return registry;
}
export async function seedControlRuns(
  ctx: Awaited<ReturnType<typeof buildApp>>,
) {
  const auth = await pair(
    ctx.db,
    randomUUID(),
    await createPairingCode(ctx.db),
  );
  const create = (goal: string) =>
    transaction(ctx.db, (c) =>
      ctx.m2.manager.create(c, { agent_id: "ops-agent", goal }, auth.device_id),
    );
  return {
    input: (await create("输入验收任务")).id,
    cancel: (await create("取消验收任务")).id,
  };
}
