import { z } from "zod";
import { canonicalActivityCapability } from "./activity.js";

export const turnStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "waiting_question",
  "completed",
  "failed",
  "cancelled",
]);
export type TurnStatus = z.infer<typeof turnStatusSchema>;

export const activityStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
]);
export type ActivityStatus = z.infer<typeof activityStatusSchema>;

export const questionSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["boolean", "single_choice"]),
  prompt: z.string().min(1).max(4000),
  options: z.array(z.object({ value: z.string().min(1).max(120), label: z.string().min(1).max(200) }).strict()).max(32),
  status: z.enum(["pending", "answered", "expired", "cancelled"]),
  answer: z.unknown().optional(),
}).strict();

const terminalTurn = new Set<TurnStatus>(["completed", "failed", "cancelled"]);
const terminalActivity = new Set<ActivityStatus>(["completed", "failed", "cancelled"]);

export function canTransitionTurn(from: TurnStatus, to: TurnStatus) {
  if (from === to) return true;
  if (terminalTurn.has(from)) return false;
  return ({
    queued: ["running", "cancelled"],
    running: ["waiting_approval", "waiting_question", "completed", "failed", "cancelled"],
    waiting_approval: ["running", "failed", "cancelled"],
    waiting_question: ["queued", "running", "failed", "cancelled"],
  } as Record<TurnStatus, TurnStatus[]>)[from]?.includes(to) ?? false;
}

export function canTransitionActivity(from: ActivityStatus, to: ActivityStatus) {
  if (from === to) return true;
  if (terminalActivity.has(from)) return false;
  return ({
    queued: ["running", "waiting_approval", "cancelled"],
    running: ["waiting_approval", "completed", "failed", "cancelled"],
    waiting_approval: ["running", "completed", "failed", "cancelled"],
  } as Record<ActivityStatus, ActivityStatus[]>)[from]?.includes(to) ?? false;
}

export function activityGroupKey(capability: string, explicit?: string) {
  const value = (explicit ?? canonicalActivityCapability(capability)).trim().toLowerCase();
  return value.replace(/[._:-]+/g, " ").replace(/\s+/g, " ").slice(0, 120);
}

export function summarizeActivityGroup(activities: readonly { capability: string; status: ActivityStatus }[]) {
  const groups = new Map<string, { key: string; count: number; completed: number; failed: number; running: number }>();
  for (const activity of activities) {
    const key = activityGroupKey(activity.capability);
    const group = groups.get(key) ?? { key, count: 0, completed: 0, failed: 0, running: 0 };
    group.count++;
    if (activity.status === "completed") group.completed++;
    if (activity.status === "failed") group.failed++;
    if (activity.status === "running" || activity.status === "queued" || activity.status === "waiting_approval") group.running++;
    groups.set(key, group);
  }
  return [...groups.values()];
}
