import { randomUUID } from "node:crypto";
import { createHermesContextToken, HermesClient, type HermesTool } from "../../hermes-bridge/src/index.js";
import type { AgentEvent, AgentInput, AgentRunInput, AgentRuntime, RuntimeRun } from "../../agent-runtime/src/index.js";

type Run = { id: string; owner?: string; task?: AgentRunInput["task"]; events: AgentEvent[]; waiters: Array<() => void>; abort: AbortController; done: boolean };
export type HermesToolBridge = {
  tools: HermesTool[];
  invoke: (name: string, args: Record<string, unknown>, owner?: string) => Promise<unknown>;
};
export function taskScopes(task?: AgentRunInput["task"]) {
  const scopes = new Set(["task.execute"]);
  const capabilities = task?.required_capabilities ?? ["system.read"];
  const writable = task?.constraints.max_risk === "write" || task?.constraints.max_risk === "execute";
  for (const capability of capabilities) {
    if (capability === "analysis") continue;
    if (capability.startsWith("system.")) scopes.add("system.read");
    if (capability.startsWith("home.")) {
      scopes.add("home.read");
      scopes.add("mcp.homeassistant.read");
      if (writable) scopes.add("mcp.homeassistant.write");
    }
    if (capability.startsWith("photo.")) {
      scopes.add("photo.read");
      scopes.add("mcp.immich.read");
      if (writable) scopes.add("mcp.immich.write");
    }
    if (capability.startsWith("mcp.homeassistant.")) scopes.add(`mcp.homeassistant.${writable ? "write" : "read"}`);
    if (capability.startsWith("mcp.immich.")) scopes.add(`mcp.immich.${writable ? "write" : "read"}`);
    if (writable && capability.startsWith("schedule.")) scopes.add("schedule.write");
    if (writable && capability.startsWith("conversation.")) scopes.add("conversation.write");
  }
  return [...scopes].sort();
}

/** Durable-task adapter for a capability-routed Hermes executor. */
export class HermesRuntime implements AgentRuntime {
  private readonly runs = new Map<string, Run>();
  private bridge?: HermesToolBridge;
  constructor(private readonly client: HermesClient, bridge?: HermesToolBridge) { this.bridge = bridge; }
  /** Bind Kernel capabilities after the runtime is registered, avoiding a server/bootstrap cycle. */
  setToolBridge(bridge: HermesToolBridge) { this.bridge = bridge; }
  async start(input: AgentRunInput): Promise<RuntimeRun> {
    const id = randomUUID();
    const run: Run = { id, owner: input.owner_device_id, task: input.task, events: [], waiters: [], abort: new AbortController(), done: false };
    this.runs.set(id, run);
    void this.execute(run, input.goal, run.owner);
    return { id };
  }
  private push(run: Run, event: AgentEvent) {
    run.events.push({ ...event, sequence: run.events.length + 1 });
    for (const wake of run.waiters.splice(0)) wake();
  }
  private async execute(run: Run, goal: string, owner?: string) {
    this.push(run, { type: "agent.run.started", payload: { runtime: "hermes" } });
    try {
      const taskPolicy = run.task
        ? `执行模式：${run.task.execution_mode}；能力范围：${run.task.required_capabilities.join(", ") || "通用分析"}；最高风险：${run.task.constraints.max_risk}；${run.task.constraints.workspace_required ? "需要工作区" : "不要求工作区"}。`
        : "执行模式：兼容任务；最高风险：read。";
      const messages: any[] = [
        { role: "system", content: `你是 Jarvis 的持久任务执行器。围绕用户目标工作，只使用任务上下文授予的能力并遵守风险上限；不要假定某个固定领域或设备。任务缺少关键信息时明确说明，结论必须可验证并标注不确定性。${taskPolicy}` },
        { role: "user", content: goal },
      ];
      const contextToken = process.env.HERMES_BRIDGE_KEY && owner
        ? createHermesContextToken(process.env.HERMES_BRIDGE_KEY, owner, run.id, 600, { run: run.id, scopes: taskScopes(run.task) })
        : undefined;
      const completeOptions = {
        sessionId: run.id,
        contextToken,
        signal: run.abort.signal,
        delta: async (text: string) => this.push(run, { type: "agent.message.delta", payload: { text } }),
        report: async (usage: { provider: string; model: string; input_tokens: number; output_tokens: number; cached_input_tokens: number }) => this.push(run, { type: "agent.usage.updated", payload: usage }),
      };
      let summary = "";
      if (!this.bridge) {
        const answer = await this.client.complete(messages, [], completeOptions);
        if (answer.calls.length) throw Error("hermes_returned_unhandled_tool_calls");
        summary = answer.content;
      } else {
        // Kept as a test/embedding adapter. Production M3.1 registers Hermes
        // without this bridge, so capability execution happens through MCP.
        for (let round = 0; round < 8; round++) {
          const answer = await this.client.complete(messages, this.bridge.tools, completeOptions);
          if (!answer.calls.length) { summary = answer.content; break; }
          for (const call of answer.calls) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(call.function.arguments || "{}"); } catch { throw Error("hermes_tool_arguments_invalid"); }
            this.push(run, { type: "agent.tool.started", payload: { id: call.id, name: call.function.name, arguments: args } });
            try {
              const result = await this.bridge.invoke(call.function.name, args, owner);
              messages.push({ role: "assistant", content: answer.content || null, tool_call_id: call.id });
              messages.push({ role: "tool", content: JSON.stringify(result), tool_call_id: call.id });
              this.push(run, { type: "agent.tool.completed", payload: { id: call.id, name: call.function.name, result } });
            } catch (error) {
              this.push(run, { type: "agent.tool.failed", payload: { id: call.id, name: call.function.name, error: error instanceof Error ? error.message : "hermes_tool_failed" } });
              throw error;
            }
          }
          if (round === 7) throw Error("hermes_tool_round_limit");
        }
      }
      if (!summary.trim()) throw Error("hermes_empty_response");
      if (!run.abort.signal.aborted) this.push(run, { type: "agent.run.completed", payload: { runtime: "hermes", summary } });
    } catch (error) {
      if (!run.abort.signal.aborted) this.push(run, { type: "agent.run.failed", payload: { error: error instanceof Error ? error.message : "hermes_failed" } });
    } finally {
      run.done = true;
      for (const wake of run.waiters.splice(0)) wake();
    }
  }
  async send(id: string, input: AgentInput) { const run = this.runs.get(id); if (!run || run.done) throw Error("run_not_found"); await this.execute(run, input.text, run.owner); }
  async resume(id: string, input?: AgentInput) { return this.send(id, input ?? { text: "继续" }); }
  async cancel(id: string) { const run = this.runs.get(id); if (!run || run.done) return; run.abort.abort(); this.push(run, { type: "agent.run.cancelled", payload: { runtime: "hermes" } }); run.done = true; }
  async *events(id: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const run = this.runs.get(id); if (!run) throw Error("run_not_found"); let cursor = 0;
    while (cursor < run.events.length || !run.done) {
      signal?.throwIfAborted();
      while (cursor < run.events.length) yield run.events[cursor++];
      if (run.done) break;
      await new Promise<void>((resolve, reject) => { const wake = () => { signal?.removeEventListener("abort", abort); resolve(); }; const abort = () => { const i = run.waiters.indexOf(wake); if (i >= 0) run.waiters.splice(i, 1); reject(signal?.reason ?? Error("aborted")); }; run.waiters.push(wake); signal?.addEventListener("abort", abort, { once: true }); });
    }
  }
  async dispose(id: string) { this.runs.delete(id); }
  async health() { try { return { healthy: await this.client.health() }; } catch (error) { return { healthy: false, error: error instanceof Error ? error.message : "hermes_unavailable" }; } }
}
