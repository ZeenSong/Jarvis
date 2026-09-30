import { randomUUID } from "node:crypto";

/** The pinned Hermes API omits call IDs. Correlate only outstanding calls of
 * the same tool; never reuse an already completed activity's identity. */
export class HermesActivityIds {
  private pending = new Map<string, string[]>();
  resolve(event: Record<string, any>): string {
    const supplied = event.tool_call_id ?? event.id;
    if (typeof supplied === "string" && supplied) return supplied;
    const capability = String(event.capability ?? event.tool ?? "unknown");
    const pending = this.pending.get(capability) ?? [];
    if (String(event.event).endsWith(".started")) {
      const id = randomUUID(); pending.push(id); this.pending.set(capability, pending); return id;
    }
    const id = pending.shift() ?? randomUUID();
    if (!pending.length) this.pending.delete(capability);
    return id;
  }
}

export const terminalHermesEvents = new Set(["run.completed", "run.failed", "run.cancelled", "run.interrupted"]);
