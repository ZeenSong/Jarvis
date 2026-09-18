import { z } from "zod";

export const nodeCapabilitySchema = z.object({
  name: z.enum(["node.system.read", "node.file.read", "node.git.read", "node.codex.execute"]),
  version: z.string().regex(/^\d+\.\d+$/),
  risk: z.enum(["read", "write", "execute"]),
  available: z.boolean(),
}).strict();
export const nodeRegistrationSchema = z.object({
  node_id: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
  name: z.string().min(1).max(120),
  platform: z.enum(["ubuntu", "macos", "windows", "nas", "edge"]),
  capabilities: z.array(nodeCapabilitySchema).max(100),
}).strict();
export function allowedNodeCapability(name: string, approved: Set<string>) {
  return approved.has(name) && nodeCapabilitySchema.shape.name.safeParse(name).success;
}
