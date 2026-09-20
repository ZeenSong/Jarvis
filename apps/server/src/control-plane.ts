import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./persistence.js";
import { transaction } from "../../../packages/agent-manager/src/index.js";
import { ownerUserId } from "./ownership.js";

const approvalInput = z.object({ run_id: z.uuid().optional(), capability: z.string().trim().min(1).max(200), input: z.record(z.string(), z.unknown()).default({}) }).strict();
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
    const result = await transaction(this.db, async (c) => {
      if (p.run_id) {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`approval:${user ?? owner}:${p.run_id}:${p.capability}`]);
        const existing = (await c.query("SELECT * FROM approvals WHERE (owner_device_id=$1 OR owner_user_id=$2) AND run_id=$3 AND capability=$4 AND status='pending' ORDER BY created_at DESC LIMIT 1", [owner, user ?? null, p.run_id, p.capability])).rows[0];
        if (existing) return { row: existing, created: false };
      }
      const result = (await c.query("INSERT INTO approvals(id,owner_device_id,owner_user_id,run_id,capability,input) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [id, owner, user ?? null, p.run_id ?? null, p.capability, JSON.stringify(p.input)])).rows[0];
      await c.query("INSERT INTO notifications(id,owner_device_id,owner_user_id,kind,title,body,reference_id) VALUES($1,$2,$3,'approval','需要审批',$4,$5)", [notificationId, owner, user ?? null, p.capability, id]);
      return { row: result, created: true };
    });
    if (result.created) { this.emit("approval.created", { approval_id: id, run_id: p.run_id }); this.emit("notification.created", { notification_id: notificationId, kind: "approval" }); }
    return result.row;
  }
  async resolveApproval(owner: string, id: string, status: "approved" | "rejected") {
    const user = await ownerUserId(this.db, owner);
    const result = await this.db.query("UPDATE approvals SET status=$3,resolved_at=now() WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$4) AND status='pending' AND expires_at>now() RETURNING *", [z.uuid().parse(id), owner, status, user ?? null]);
    if (!result.rowCount) throw Error("approval_not_pending"); this.emit("approval.resolved", { approval_id: id, status }); return result.rows[0];
  }
  async notifications(owner: string) { const user = await ownerUserId(this.db, owner); return (await this.db.query("SELECT * FROM notifications WHERE owner_device_id=$1 OR owner_user_id=$2 ORDER BY created_at DESC LIMIT 100", [owner, user ?? null])).rows; }
  async markNotification(owner: string, id: string) { const user = await ownerUserId(this.db, owner); const r = await this.db.query("UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3) RETURNING *", [z.uuid().parse(id), owner, user ?? null]); if (!r.rowCount) throw Error("not_found"); return r.rows[0]; }
  async schedules(owner: string) { const user = await ownerUserId(this.db, owner); return (await this.db.query("SELECT * FROM schedules WHERE owner_device_id=$1 OR owner_user_id=$2 ORDER BY next_run_at", [owner, user ?? null])).rows; }
  async createSchedule(owner: string, value: unknown) { const p = scheduleInput.parse(value); const user = await ownerUserId(this.db, owner); if (p.conversation_id && !(await this.db.query("SELECT 1 FROM conversations WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3)", [p.conversation_id, owner, user ?? null])).rowCount) throw Error("not_found"); const row = (await this.db.query("INSERT INTO schedules(id,owner_device_id,owner_user_id,prompt,cadence,next_run_at,conversation_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *", [randomUUID(), owner, user ?? null, p.prompt, p.cadence, p.next_run_at, p.conversation_id ?? null])).rows[0]; this.emit("schedule.created", row); return row; }
  async toggleSchedule(owner: string, id: string, enabled: boolean) { const user = await ownerUserId(this.db, owner); const r = await this.db.query("UPDATE schedules SET enabled=$3,updated_at=now() WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$4) RETURNING *", [z.uuid().parse(id), owner, z.boolean().parse(enabled), user ?? null]); if (!r.rowCount) throw Error("not_found"); return r.rows[0]; }
  async deleteSchedule(owner: string, id: string) { const user = await ownerUserId(this.db, owner); const r = await this.db.query("DELETE FROM schedules WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3) RETURNING id", [z.uuid().parse(id), owner, user ?? null]); if (!r.rowCount) throw Error("not_found"); return { deleted: true }; }
}
