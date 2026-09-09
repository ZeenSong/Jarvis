export type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled";
export const terminal = (s: RunStatus) =>
  ["completed", "failed", "cancelled"].includes(s);
export interface AgentInput {
  text: string;
}
export interface AgentRunInput {
  id: string;
  goal: string;
  model?: string;
  workspace?: { repository: string; commit: string };
}
export interface RuntimeRun {
  id: string;
}
export interface AgentEvent {
  sequence?: number;
  type:
    | "agent.run.started"
    | "agent.thinking"
    | "agent.message.delta"
    | "agent.tool.started"
    | "agent.tool.completed"
    | "agent.tool.failed"
    | "agent.progress"
    | "agent.waiting_user"
    | "agent.approval.required"
    | "agent.usage.updated"
    | "agent.run.completed"
    | "agent.run.failed"
    | "agent.run.cancelled";
  payload: Record<string, unknown>;
}
export interface AgentRuntime {
  start(input: AgentRunInput): Promise<RuntimeRun>;
  send(runId: string, input: AgentInput): Promise<void>;
  cancel(runId: string): Promise<void>;
  resume(runId: string, input?: AgentInput): Promise<void>;
  events(runId: string, signal?: AbortSignal): AsyncIterable<AgentEvent>;
  dispose(runId: string): Promise<void>;
  health(): Promise<{ healthy: boolean; error?: string }>;
}
export class RuntimeRegistry {
  private runtimes = new Map<string, AgentRuntime>();
  register(type: string, runtime: AgentRuntime) {
    if (this.runtimes.has(type)) throw Error("runtime_already_registered");
    this.runtimes.set(type, runtime);
  }
  get(type: string) {
    const r = this.runtimes.get(type);
    if (!r) throw Error("runtime_unavailable:" + type);
    return r;
  }
  async health() {
    return Object.fromEntries(
      await Promise.all(
        [...this.runtimes].map(async ([k, v]) => [k, await v.health()]),
      ),
    );
  }
}
const transitions: Record<RunStatus, RunStatus[]> = {
  queued: ["starting", "failed", "cancelled"],
  starting: ["running", "failed", "cancelled"],
  running: [
    "waiting_for_user",
    "waiting_for_approval",
    "completed",
    "failed",
    "cancelled",
  ],
  waiting_for_user: ["running", "failed", "cancelled"],
  waiting_for_approval: ["running", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};
export function canTransition(from: RunStatus, to: RunStatus) {
  return transitions[from].includes(to);
}
export function childDepth(parentDepth: number) {
  if (!Number.isInteger(parentDepth) || parentDepth < 0 || parentDepth >= 2)
    throw Error("delegation_depth_exceeded");
  return parentDepth + 1;
}
