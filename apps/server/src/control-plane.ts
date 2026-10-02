import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./persistence.js";
import { transaction } from "../../../packages/agent-manager/src/index.js";
import { ownerUserId } from "./ownership.js";

const approvalInput = z.object({ run_id: z.uuid().optional(), turn_id: z.uuid().optional(), activity_id: z.uuid().optional(), capability: z.string().trim().min(1).max(200), input: z.record(z.string(), z.unknown()).default({}) }).strict();
const scheduleInput = z.object({ prompt: z.string().trim().min(1).max(16000), cadence: z.enum(["once", "daily", "weekly"]), next_run_at: z.iso.datetime(), conversation_id: z.uuid().optional() }).strict();

export class ControlPlane {
  constructor(private readonly db: Database, private readonly emit: (topic: string, payload: unknown) => void) {}
  async approvals(owner: string) { const user = await ownerUserId(this.db, owner); return (await this.db.query("SELECT * FROM approvals WHERE owner_device_id=$1 OR owner_user_id=$2 ORDER BY created_at DESC LIMIT 100", [owner, user ?? null])).rows; }
  async createApproval(owner: string, value: unknown) {
    const p = approvalInput.parse(value);
    if (p.capability.startsWith("node.")) z.object({ node_id: z.string().regex(/^[\w.-]{1,100}$/), input: z.record(z.string(), z.unknown()) }).strict().parse(p.input);
    const id = randomUUID(); const notificationId = randomUUID();
    const user = await ownerUserId(this.db, owner);
    if (p.run_id && !(await this.db.query("SELECT 1 FROM agent_runs WHERE id=$1 AND (requested_by=$2 OR requested_by_user_id=$3)", [p.run_id, owner, user ?? null])).rowCount) throw Error("not_found");
    if (p.turn_id && !(await this.db.query("SELECT 1 FROM conversation_turns WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3)", [p.turn_id, owner, user ?? null])).rowCount) throw Error("not_found");
    if (p.activity_id && !(await this.db.query("SELECT 1 FROM conversation_activities WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3)", [p.activity_id, owner, user ?? null])).rowCount) throw Error("not_found");
    const result = await transaction(this.db, async (c) => {
      if (p.run_id) {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`approval:${user ?? owner}:${p.run_id}:${p.capability}`]);
        const existing = (await c.query("SELECT * FROM approvals WHERE (owner_device_id=$1 OR owner_user_id=$2) AND run_id=$3 AND capability=$4 AND status='pending' ORDER BY created_at DESC LIMIT 1", [owner, user ?? null, p.run_id, p.capability])).rows[0];
        if (existing) return { row: existing, created: false };
      }
      const result = (await c.query("INSERT INTO approvals(id,owner_device_id,owner_user_id,run_id,turn_id,activity_id,capability,input) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [id, owner, user ?? null, p.run_id ?? null, p.turn_id ?? null, p.activity_id ?? null, p.capability, JSON.stringify(p.input)])).rows[0];
      if (p.turn_id) await c.query("UPDATE conversation_turns SET status='waiting_approval',updated_at=now() WHERE id=$1", [p.turn_id]);
      if (p.activity_id) {
        const activity = await c.query("UPDATE conversation_activities SET status='waiting_approval' WHERE id=$1 AND status IN ('queued','running','waiting_approval') RETURNING id", [p.activity_id]);
        if (!activity.rowCount) throw Error("invalid_activity_transition");
      }
      await c.query("INSERT INTO notifications(id,owner_device_id,owner_user_id,kind,title,body,reference_id) VALUES($1,$2,$3,'approval','需要审批',$4,$5)", [notificationId, owner, user ?? null, p.capability, id]);
      return { row: result, created: true };
    });
    if (result.created) { this.emit("approval.created", { approval_id: id, run_id: p.run_id }); this.emit("notification.created", { notification_id: notificationId, kind: "approval" }); }
    return result.row;
  }
  async resolveApproval(owner: string, id: string, status: "approved" | "rejected") {
    const user = await ownerUserId(this.db, owner);
    const result = await this.db.query("UPDATE approvals SET status=$3,resolved_at=now() WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$4) AND status='pending' AND expires_at>now() RETURNING *", [z.uuid().parse(id), owner, status, user ?? null]);
    if (!result.rowCount) throw Error("approval_not_pending");
    if (result.rows[0].turn_id) await this.db.query("UPDATE conversation_turns SET status=$2,updated_at=now() WHERE id=$1", [result.rows[0].turn_id, status === "approved" ? "running" : "cancelled"]);
    if (result.rows[0].activity_id) await this.db.query("UPDATE conversation_activities SET status=$2 WHERE id=$1", [result.rows[0].activity_id, status === "approved" ? "running" : "cancelled"]);
    this.emit("approval.resolved", { approval_id: id, status }); return result.rows[0];
  }
  async notifications(owner: string) { const user = await ownerUserId(this.db, owner); return (await this.db.query("SELECT * FROM notifications WHERE owner_device_id=$1 OR owner_user_id=$2 ORDER BY created_at DESC LIMIT 100", [owner, user ?? null])).rows; }
  async createTaskNotification(runId: string, status: string) {
    const run = (await this.db.query("SELECT requested_by,requested_by_user_id,goal FROM agent_runs WHERE id=$1", [z.uuid().parse(runId)])).rows[0];
    if (!run) return;
    const kind = status === "completed" ? "task_completed" : status === "failed" ? "task_failed" : "task_question";
    const title = status === "completed" ? "任务已完成" : status === "failed" ? "任务失败" : status === "waiting_for_approval" ? "任务需要确认" : "任务等待你的回答";
    const existing = await this.db.query("SELECT id FROM notifications WHERE reference_id=$1 AND kind=$2", [runId, kind]);
    if (existing.rowCount) return;
    const id = randomUUID();
    await this.db.query("INSERT INTO notifications(id,owner_device_id,owner_user_id,kind,title,body,reference_id) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, run.requested_by, run.requested_by_user_id ?? null, kind, title, String(run.goal ?? "").slice(0, 500), runId]);
    this.emit("notification.created", { notification_id: id, kind, reference_id: runId });
  }
  async createQuestionNotification(question: { id: string; conversation_id: string; turn_id: string; prompt: string }) {
    const turn = (await this.db.query("SELECT owner_device_id,owner_user_id FROM conversation_turns WHERE id=$1", [question.turn_id])).rows[0];
    if (!turn) return;
    const id = randomUUID();
    await this.db.query("INSERT INTO notifications(id,owner_device_id,owner_user_id,kind,title,body,reference_id) VALUES($1,$2,$3,'question','Jarvis 等待你的回答',$4,$5)", [id, turn.owner_device_id, turn.owner_user_id ?? null, question.prompt.slice(0, 500), question.conversation_id]);
    this.emit("notification.created", { notification_id: id, kind: "question", reference_id: question.conversation_id });
  }
  async markNotification(owner: string, id: string) { const user = await ownerUserId(this.db, owner); const r = await this.db.query("UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3) RETURNING *", [z.uuid().parse(id), owner, user ?? null]); if (!r.rowCount) throw Error("not_found"); return r.rows[0]; }
  async schedules(owner: string) { const user = await ownerUserId(this.db, owner); return (await this.db.query("SELECT * FROM schedules WHERE owner_device_id=$1 OR owner_user_id=$2 ORDER BY next_run_at", [owner, user ?? null])).rows; }
  async createSchedule(owner: string, value: unknown) { const p = scheduleInput.parse(value); const user = await ownerUserId(this.db, owner); if (p.conversation_id && !(await this.db.query("SELECT 1 FROM conversations WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3)", [p.conversation_id, owner, user ?? null])).rowCount) throw Error("not_found"); const row = (await this.db.query("INSERT INTO schedules(id,owner_device_id,owner_user_id,prompt,cadence,next_run_at,conversation_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *", [randomUUID(), owner, user ?? null, p.prompt, p.cadence, p.next_run_at, p.conversation_id ?? null])).rows[0]; this.emit("schedule.created", row); return row; }
  async toggleSchedule(owner: string, id: string, enabled: boolean) { const user = await ownerUserId(this.db, owner); const r = await this.db.query("UPDATE schedules SET enabled=$3,updated_at=now() WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$4) RETURNING *", [z.uuid().parse(id), owner, z.boolean().parse(enabled), user ?? null]); if (!r.rowCount) throw Error("not_found"); return r.rows[0]; }
  async deleteSchedule(owner: string, id: string) { const user = await ownerUserId(this.db, owner); const r = await this.db.query("DELETE FROM schedules WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3) RETURNING id", [z.uuid().parse(id), owner, user ?? null]); if (!r.rowCount) throw Error("not_found"); return { deleted: true }; }
}
