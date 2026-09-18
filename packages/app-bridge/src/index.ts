import { z } from "zod";

export const appDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,80}$/),
  name: z.string().min(1).max(120),
  launch: z.object({ web: z.string().url().optional(), android: z.string().max(500).optional() }).default({}),
  deep_links: z.record(z.string().regex(/^[a-z0-9._-]+$/), z.string().max(500)).default({}),
  capabilities: z.array(z.string().max(200)).max(100).default([]),
  resources: z.array(z.string().max(300)).max(100).default([]),
  icon: z.string().max(500).optional(),
  status: z.enum(["ready", "unavailable", "unknown"]).default("unknown"),
}).strict();
export type AppDescriptor = z.infer<typeof appDescriptorSchema>;

export function resolveAppLink(app: AppDescriptor, target: { kind?: string; id?: string }, platform: "web" | "android") {
  const template = target.kind && app.deep_links[target.kind];
  const value = template?.replaceAll("{id}", encodeURIComponent(target.id ?? ""));
  if (platform === "android" && app.launch.android) return { primary: app.launch.android, fallback: value ?? app.launch.web };
  return { primary: value ?? app.launch.web, fallback: undefined };
}
