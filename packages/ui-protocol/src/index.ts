import { z } from "zod";
export const blockTypes = [
  "metric",
  "metric_group",
  "sparkline",
  "line_chart",
  "bar_chart",
  "donut",
  "gauge",
  "progress",
  "status_grid",
  "table",
  "timeline",
  "card",
  "alert",
  "action",
  "approval",
  "markdown",
  "code_diff",
  "run_graph",
] as const;
export const resourceName = z
  .string()
  .regex(
    /^(system\/(status|metrics|network)|agents\/summary|llm\/usage\/(today|hourly|agents)|agent-run\/[a-zA-Z0-9-]+|conversation\/[a-zA-Z0-9-]+)$/,
  );
export const actionSchema = z
  .object({
    type: z.enum([
      "run.open",
      "run.cancel",
      "run.resume",
      "run.input",
      "approval.response",
      "conversation.open",
      "view.show",
    ]),
    target: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    approved: z.boolean().optional(),
    text: z.string().min(1).max(16000).optional(),
  })
  .strict();
export const blockSchema = z
  .object({
    type: z.enum(blockTypes),
    title: z.string().max(200),
    resource: resourceName.optional(),
    path: z
      .string()
      .regex(/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/)
      .optional(),
    text: z.string().max(100000).optional(),
    action: actionSchema.optional(),
  })
  .strict();
export const viewSchema = z
  .object({
    version: z.literal(1),
    type: z.literal("dashboard"),
    title: z.string().max(200),
    blocks: z.array(blockSchema).max(40),
  })
  .strict();
export const intentSchema = z
  .object({
    type: z.literal("view.show"),
    intent: z.enum([
      "system_overview",
      "network_overview",
      "usage_analysis",
      "agent_run_analysis",
    ]),
    resources: z.array(resourceName).max(10),
  })
  .strict();
export const resourceSchema = z
  .object({
    version: z.literal(1),
    resource: resourceName,
    revision: z.number().int().nonnegative(),
    data: z.unknown(),
  })
  .strict();
export type ViewSpec = z.infer<typeof viewSchema>;
export type Resource = z.infer<typeof resourceSchema>;
export function applyResource(
  current: Resource | undefined,
  next: Resource,
): Resource {
  resourceSchema.parse(next);
  return current &&
    current.resource === next.resource &&
    current.revision >= next.revision
    ? current
    : next;
}
export function readPath(data: unknown, path?: string): unknown {
  if (!path) return data;
  return path
    .split(".")
    .reduce<unknown>(
      (v, k) =>
        v && typeof v === "object" && Object.hasOwn(v, k)
          ? (v as Record<string, unknown>)[k]
          : undefined,
      data,
    );
}
