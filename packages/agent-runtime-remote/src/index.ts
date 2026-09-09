import type {
  AgentRuntime,
  AgentRunInput,
  AgentInput,
  AgentEvent,
} from "../../agent-runtime/src/index.js";
/** The controller accepts a fixed role, never an image, command, mount or arbitrary pod spec. */
export class ControllerRuntime implements AgentRuntime {
  constructor(
    private type: "codex" | "pydantic",
    private url: string,
    private token: string,
  ) {}
  private async call(path: string, body?: unknown, signal?: AbortSignal) {
    if (!this.url || !this.token)
      throw Error("worker_controller_not_configured");
    const r = await fetch(this.url + path, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: "Bearer " + this.token,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error("worker_controller_http_" + r.status);
    return r.json() as Promise<any>;
  }
  async start(input: AgentRunInput) {
    return this.call("/runs", { ...input, type: this.type });
  }
  async send(id: string, input: AgentInput): Promise<void> {
    await this.call(`/runs/${id}/send`, input);
  }
  async resume(id: string, input?: AgentInput): Promise<void> {
    await this.call(`/runs/${id}/resume`, input ?? {});
  }
  async cancel(id: string) {
    await this.call(`/runs/${id}/cancel`, {});
  }
  async *events(id: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    let cursor = 0;
    for (;;) {
      signal?.throwIfAborted();
      const p = await this.call(
        `/runs/${id}/events?cursor=${cursor}`,
        undefined,
        signal,
      );
      for (const event of p.events) {
        cursor++;
        yield event;
      }
      if (p.done) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  async dispose(id: string) {
    await this.call(`/runs/${id}/dispose`, {});
  }
  async health() {
    try {
      return await this.call("/health");
    } catch (e) {
      return {
        healthy: false,
        error: e instanceof Error ? e.message : "unavailable",
      };
    }
  }
}
