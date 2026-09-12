import { z } from "zod";
export const taskDataSchema = z.object({
  goal: z.string().min(1).max(16000),
  status: z.string().min(1).max(100),
  agent_id: z.string().max(200).optional(),
  started_at: z.string().max(100).nullable().optional(),
  finished_at: z.string().max(100).nullable().optional(),
});
