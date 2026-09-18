import { z } from "zod";

/** Versioned Kernel/MCP capability metadata. Inputs are descriptive only; execution remains permission-gated. */
export const capabilitySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]{1,199}$/),
  kind: z.enum(["kernel", "mcp", "node", "app-bridge"]),
  risk: z.enum(["read", "write", "execute"]),
  approval_required: z.boolean(),
  version: z.string().regex(/^\d+\.\d+$/).default("1.0"),
  provider: z.string().max(120).optional(),
  available: z.boolean().default(true),
}).strict();
export type Capability = z.infer<typeof capabilitySchema>;

export function mergeCapabilities(base: readonly Capability[], external: unknown): Capability[] {
  const parsed = z.array(capabilitySchema).max(500).safeParse(external);
  if (!parsed.success) return [...base];
  const merged = new Map(base.map((item) => [item.id, item]));
  for (const item of parsed.data) merged.set(item.id, item);
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function parseCapabilityCatalog(value = process.env.MCP_CATALOG_JSON): unknown {
  if (!value) return [];
  try { return JSON.parse(value); } catch { return []; }
}
