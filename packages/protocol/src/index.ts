import { z } from "zod";
import { randomUUID } from "node:crypto";
export const envelopeSchema = z.object({
  id: z.string().min(1).max(128),
  version: z.literal(1).default(1),
  type: z.enum(["request", "response", "event", "error"]),
  topic: z.string().min(1).max(128),
  timestamp: z.iso.datetime().optional(),
  reply_to: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type Envelope = z.infer<typeof envelopeSchema>;
export const message = (
  type: Envelope["type"],
  topic: string,
  payload: unknown,
  reply_to?: string,
) => ({
  id: randomUUID(),
  version: 1,
  type,
  topic,
  timestamp: new Date().toISOString(),
  payload,
  ...(reply_to ? { reply_to } : {}),
});
export const agentStatus = z.enum([
  "starting",
  "online",
  "idle",
  "running",
  "waiting",
  "error",
  "degraded",
  "offline",
]);
export const registrationSchema = z.object({
  agent_id: z.string().regex(/^[\w-]{1,100}$/),
  name: z.string().min(1).max(200),
  runtime: z.string().max(100).optional(),
  version: z.string().max(100).optional(),
  capabilities: z.array(z.string().max(200)).max(100).default([]),
});
export const heartbeatSchema = z.object({
  agent_id: registrationSchema.shape.agent_id,
  status: agentStatus,
  provider: z.string().max(100).nullable().optional(),
  model: z.string().max(200).nullable().optional(),
  task_id: z.string().max(200).nullable().optional(),
});
export const usageSchema = z.object({
  id: z.uuid(),
  request_id: z.string().max(200).optional(),
  agent_id: registrationSchema.shape.agent_id,
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  input_tokens: z.number().int().min(0).max(1e12),
  output_tokens: z.number().int().min(0).max(1e12),
  cached_input_tokens: z.number().int().min(0).max(1e12).default(0),
  reasoning_tokens: z.number().int().min(0).max(1e12).default(0),
  latency_ms: z.number().int().min(0).max(2147483647),
  status: z.enum(["success", "error"]),
  error_type: z.string().max(100).nullable().optional(),
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime(),
});
export type Usage = z.infer<typeof usageSchema>;
