import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
type DshChild = ChildProcessByStdio<null, Readable, Readable>;
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  AgentInput,
  AgentRunInput,
  AgentRuntime,
  RuntimeRun,
} from "../../agent-runtime/src/index.js";

export type DshConfig = {
  bin: string;
  profile: string;
  home?: string;
  workspace: string;
  apiKey?: string;
};

export function dshConfig(env: NodeJS.ProcessEnv = process.env): DshConfig | undefined {
  if (env.DSH_ENABLED === "0") return undefined;
  if (env.DSH_ENABLED !== "1" && !env.DSH_BIN?.trim()) return undefined;
  return {
    bin: env.DSH_BIN?.trim() || "dsh",
    profile: env.DSH_PROFILE?.trim() || "headless",
    home: env.DSH_HOME?.trim() || undefined,
    workspace: env.DSH_WORKSPACE?.trim() || process.cwd(),
    apiKey: env.DSH_API_KEY?.trim() || env.DEEPSEEK_API_KEY?.trim() || undefined,
  };
}

type DshRun = {
  id: string;
  sessionId?: string;
  child?: DshChild;
  events: AgentEvent[];
  waiters: Array<() => void>;
  done: boolean;
  cancelled: boolean;
  assistantText: string;
  toolNames: Map<string, string>;
};

/**
 * DeepSeek Harness coding runtime.
 *
 * DSH has a first-class `headless --json` mode: it starts a persisted session,
 * runs tools in the configured workspace, and emits one NDJSON record per step.
 * Mapping those records onto Jarvis AgentEvents keeps the existing task,
 * approval and execution UI without a second protocol.
 */
export class DshRuntime implements AgentRuntime {
  private readonly runs = new Map<string, DshRun>();

  constructor(private readonly config: DshConfig) {}

  async start(input: AgentRunInput): Promise<RuntimeRun> {
    const run: DshRun = {
      id: randomUUID(),
      events: [],
      waiters: [],
      done: false,
      cancelled: false,
      assistantText: "",
      toolNames: new Map(),
    };
    this.runs.set(run.id, run);
    void this.execute(run, input.goal);
    return { id: run.id };
  }

  private push(run: DshRun, event: AgentEvent) {
    run.events.push({ ...event, sequence: run.events.length + 1 });
    for (const wake of run.waiters.splice(0)) wake();
  }

  private args(goal: string, sessionId?: string) {
    return [
      "--profile", this.config.profile,
      "--json",
      ...(sessionId ? ["--session-id", sessionId] : []),
      goal,
    ];
  }

  private async execute(run: DshRun, goal: string) {
    this.push(run, { type: "agent.run.started", payload: { runtime: "dsh", workspace: this.config.workspace } });
    let child: DshChild;
    try {
      child = spawn(this.config.bin, this.args(goal, run.sessionId), {
        cwd: this.config.workspace,
        env: {
          ...process.env,
          ...(this.config.home ? { DSH_HOME: this.config.home } : {}),
          ...(this.config.apiKey ? { DEEPSEEK_API_KEY: this.config.apiKey } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      this.fail(run, error instanceof Error ? error.message : "dsh_spawn_failed");
      return;
    }
    run.child = child;
    let stderr = "";
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (!line.trim()) return;
      let value: any;
      try { value = JSON.parse(line); } catch { return; }
      this.onRecord(run, value);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-4000);
    });
    child.on("error", (error) => this.fail(run, error.message || "dsh_failed"));
    child.on("close", (code) => {
      run.child = undefined;
      if (run.cancelled || run.done) return;
      if (code === 0) {
        this.complete(run, run.assistantText || "DSH 已完成任务，但没有返回文字结果。");
      } else {
        this.fail(run, stderr.trim().split("\n").at(-1)?.slice(0, 500) || `dsh_exit_${code}`);
      }
    });
  }

  private onRecord(run: DshRun, value: any) {
    if (run.cancelled || run.done) return;
    switch (value?.type) {
      case "session":
        if (typeof value.sessionId === "string" && value.sessionId) run.sessionId = value.sessionId;
        return;
      case "status":
        if (value.phase === "step_start") {
          this.push(run, { type: "agent.progress", payload: { phase: "step", step: Number(value.step ?? 0), turn: Number(value.turn ?? 0) } });
        } else if (value.phase === "step_end" && value.usage) {
          const usage = value.usage;
          this.push(run, {
            type: "agent.usage.updated",
            payload: {
              provider: "deepseek",
              model: "deepseek-flash",
              input_tokens: Number(usage.inputTokens ?? 0),
              output_tokens: Number(usage.outputTokens ?? 0),
              cached_input_tokens: Number(usage.cacheReadTokens ?? 0),
            },
          });
        }
        return;
      case "thinking":
        if (typeof value.text === "string" && value.text.trim()) {
          this.push(run, { type: "agent.thinking", payload: { text: value.text.trim().slice(0, 2000) } });
        }
        return;
      case "text":
        if (typeof value.text === "string" && value.text) {
          run.assistantText += value.text;
          this.push(run, { type: "agent.message.delta", payload: { text: value.text } });
        }
        return;
      case "tool_call": {
        const id = String(value.callId ?? randomUUID());
        const name = String(value.tool ?? "tool");
        run.toolNames.set(id, name);
        this.push(run, {
          type: "agent.tool.started",
          payload: { id, name, arguments: value.input ?? {} },
        });
        return;
      }
      case "tool_result": {
        const id = String(value.callId ?? "tool");
        const name = run.toolNames.get(id) ?? "tool";
        const completed = value.status === "completed";
        this.push(run, {
          type: completed ? "agent.tool.completed" : "agent.tool.failed",
          payload: {
            id,
            name,
            ...(completed ? { result: String(value.result ?? "").slice(0, 4000) } : { error: String(value.result ?? "dsh_tool_failed").slice(0, 1000) }),
          },
        });
        return;
      }
      case "error":
        this.fail(run, String(value.message ?? value.error ?? "dsh_error"));
        return;
      case "final":
        this.complete(run, String(value.text ?? run.assistantText ?? "DSH 已完成任务。"));
        return;
      default:
        return;
    }
  }

  private complete(run: DshRun, summary: string) {
    if (run.done || run.cancelled) return;
    run.done = true;
    this.push(run, { type: "agent.run.completed", payload: { runtime: "dsh", summary, session_id: run.sessionId } });
    for (const wake of run.waiters.splice(0)) wake();
  }

  private fail(run: DshRun, error: string) {
    if (run.done || run.cancelled) return;
    run.done = true;
    this.push(run, { type: "agent.run.failed", payload: { error } });
    for (const wake of run.waiters.splice(0)) wake();
  }

  async send(id: string, input: AgentInput) {
    const run = this.runs.get(id);
    if (!run) throw Error("run_not_found");
    if (run.child) throw Error("run_busy");
    run.done = false;
    run.cancelled = false;
    run.assistantText = "";
    await this.execute(run, input.text);
  }

  async resume(id: string, input?: AgentInput) {
    return this.send(id, input ?? { text: "继续" });
  }

  async cancel(id: string) {
    const run = this.runs.get(id);
    if (!run || run.done) return;
    run.cancelled = true;
    run.done = true;
    run.child?.kill("SIGTERM");
    this.push(run, { type: "agent.run.cancelled", payload: { runtime: "dsh" } });
    for (const wake of run.waiters.splice(0)) wake();
  }

  async *events(id: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const run = this.runs.get(id);
    if (!run) throw Error("run_not_found");
    let cursor = 0;
    while (cursor < run.events.length || !run.done) {
      signal?.throwIfAborted();
      while (cursor < run.events.length) yield run.events[cursor++];
      if (run.done) break;
      await new Promise<void>((resolve, reject) => {
        const wake = () => { signal?.removeEventListener("abort", abort); resolve(); };
        const abort = () => {
          const index = run.waiters.indexOf(wake);
          if (index >= 0) run.waiters.splice(index, 1);
          reject(signal?.reason ?? Error("aborted"));
        };
        run.waiters.push(wake);
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
  }

  async dispose(id: string) {
    this.runs.delete(id);
  }

  async health() {
    return new Promise<{ healthy: boolean; error?: string }>((resolve) => {
      const child = spawn(this.config.bin, ["--version"], { stdio: "ignore" });
      child.once("error", (error) => resolve({ healthy: false, error: error.message }));
      child.once("close", (code) => resolve(code === 0 ? { healthy: true } : { healthy: false, error: `dsh_exit_${code}` }));
    });
  }
}
