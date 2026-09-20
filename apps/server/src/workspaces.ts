import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./persistence.js";
import { validateArtifactSource } from "../../../packages/workspace-artifact/src/index.js";
import { ownerUserId } from "./ownership.js";

export const workspaceCreateSchema = z.object({
  conversation_id: z.uuid(),
  task_id: z.uuid().optional(),
  type: z.enum(["native", "web", "react", "composite"]).default("native"),
  title: z.string().trim().min(1).max(200).default("工作区"),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const artifactUpsertSchema = z.object({
  workspace_id: z.uuid(),
  artifact_id: z.uuid().optional(),
  type: z.enum(["native", "html", "react", "json"]),
  media_type: z.string().trim().min(1).max(120),
  source: z.string().max(2_000_000).default(""),
  compiled: z.string().max(4_000_000).nullable().optional(),
  status: z.enum(["draft", "ready", "failed"]).default("draft"),
  error: z.string().max(4000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

/** Durable workspaces retain device ownership for compatibility and user ownership for multi-device sessions. */
export class WorkspaceStore {
  constructor(private readonly db: Database, private readonly emit: (topic: string, payload: unknown) => void) {}

  async list(owner: string, conversationId?: string) {
    const userId = await ownerUserId(this.db, owner);
    const values: (string | null)[] = [owner, userId ?? null];
    const filter = conversationId ? " AND w.conversation_id=$3" : "";
    if (conversationId) values.push(z.uuid().parse(conversationId));
    return (await this.db.query(`
      SELECT w.*, COALESCE(json_agg(a ORDER BY a.updated_at DESC) FILTER (WHERE a.id IS NOT NULL),'[]') AS artifacts
      FROM workspace_records w LEFT JOIN workspace_artifacts a ON a.workspace_id=w.id
      WHERE (w.owner_device_id=$1 OR w.owner_user_id=$2)${filter} GROUP BY w.id ORDER BY w.updated_at DESC LIMIT 100
    `, values)).rows;
  }

  async get(owner: string, id: string) {
    const userId = await ownerUserId(this.db, owner);
    const workspace = (await this.db.query("SELECT * FROM workspace_records WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3)", [z.uuid().parse(id), owner, userId ?? null])).rows[0];
    if (!workspace) throw Error("not_found");
    const [artifacts, bindings] = await Promise.all([
      this.db.query("SELECT * FROM workspace_artifacts WHERE workspace_id=$1 ORDER BY updated_at DESC", [workspace.id]),
      this.db.query("SELECT * FROM workspace_bindings WHERE workspace_id=$1 ORDER BY resource", [workspace.id]),
    ]);
    return { workspace, artifacts: artifacts.rows, bindings: bindings.rows };
  }

  async create(owner: string, input: unknown) {
    const p = workspaceCreateSchema.parse(input);
    const userId = await ownerUserId(this.db, owner);
    const conversation = (await this.db.query("SELECT 1 FROM conversations WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3)", [p.conversation_id, owner, userId ?? null])).rowCount;
    if (!conversation) throw Error("not_found");
    if (p.task_id) {
      const task = (await this.db.query("SELECT conversation_id FROM agent_runs WHERE id=$1 AND (requested_by=$2 OR requested_by_user_id=$3)", [p.task_id, owner, userId ?? null])).rows[0];
      if (!task || (task.conversation_id && task.conversation_id !== p.conversation_id)) throw Error("not_found");
    }
    const id = randomUUID();
    const row = (await this.db.query(`INSERT INTO workspace_records(id,owner_device_id,owner_user_id,conversation_id,task_id,type,title,status,revision,metadata)
      VALUES($1,$2,(SELECT user_id FROM devices WHERE id=$2),$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [id, owner, p.conversation_id, p.task_id ?? null, p.type, p.title, "active", 0, JSON.stringify(p.metadata)])).rows[0];
    this.emit("workspace.created", { workspace_id: id, conversation_id: p.conversation_id, revision: 0 });
    return { ...row, artifacts: [], bindings: [] };
  }

  async upsertArtifact(owner: string, input: unknown) {
    const p = artifactUpsertSchema.parse(input);
    if (p.type === "html" || p.type === "react") { validateArtifactSource(p.source); if (p.compiled) validateArtifactSource(p.compiled); }
    const userId = await ownerUserId(this.db, owner);
    const workspace = (await this.db.query("SELECT id,revision FROM workspace_records WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3)", [p.workspace_id, owner, userId ?? null])).rows[0];
    if (!workspace) throw Error("not_found");
    const id = p.artifact_id ?? randomUUID();
    if (p.artifact_id) {
      const existing = (await this.db.query("SELECT workspace_id,owner_device_id,owner_user_id FROM workspace_artifacts WHERE id=$1", [p.artifact_id])).rows[0];
      if (existing && (existing.workspace_id !== p.workspace_id || (existing.owner_device_id !== owner && existing.owner_user_id !== userId && !(userId == null && existing.owner_user_id == null)))) throw Error("forbidden");
    }
    const row = (await this.db.query(`INSERT INTO workspace_artifacts(id,workspace_id,owner_device_id,owner_user_id,type,media_type,source,compiled,status,error,metadata,revision)
      VALUES($1,$2,$3,(SELECT user_id FROM devices WHERE id=$3),$4,$5,$6,$7,$8,$9,$10,0)
      ON CONFLICT(id) DO UPDATE SET source=excluded.source,compiled=excluded.compiled,status=excluded.status,error=excluded.error,metadata=excluded.metadata,revision=workspace_artifacts.revision+1,updated_at=now()
      RETURNING *`, [id, p.workspace_id, owner, p.type, p.media_type, p.source, p.compiled ?? null, p.status, p.error ?? null, JSON.stringify(p.metadata)])).rows[0];
    const updated = (await this.db.query("UPDATE workspace_records SET artifact_id=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision", [p.workspace_id, id])).rows[0];
    this.emit("workspace.artifact.updated", { workspace_id: p.workspace_id, artifact_id: id, revision: Number(updated.revision) });
    return row;
  }

  async bind(owner: string, workspaceId: string, resource: string, revision: number, metadata: Record<string, unknown> = {}) {
    z.uuid().parse(workspaceId); z.string().trim().min(1).max(300).parse(resource); z.number().int().min(0).parse(revision);
    const userId = await ownerUserId(this.db, owner);
    const ok = (await this.db.query("SELECT 1 FROM workspace_records WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3)", [workspaceId, owner, userId ?? null])).rowCount;
    if (!ok) throw Error("not_found");
    return (await this.db.query(`INSERT INTO workspace_bindings(workspace_id,resource,revision,metadata) VALUES($1,$2,$3,$4)
      ON CONFLICT(workspace_id,resource) DO UPDATE SET revision=excluded.revision,metadata=excluded.metadata RETURNING *`, [workspaceId, resource, revision, JSON.stringify(metadata)])).rows[0];
  }
}
