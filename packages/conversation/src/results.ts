import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "../../../apps/server/src/persistence.js";
import type { WorkspaceStore } from "../../../apps/server/src/workspaces.js";
import { ownerUserId } from "../../../apps/server/src/ownership.js";
import { viewSpecSchema, type ViewSpec } from "../../ui-protocol-v2/src/index.js";

export type ConversationResult = {
  id: string; conversation_id: string; turn_id: string; result_key: string;
  target: "inline" | "workspace"; title: string; status: "loading" | "ready" | "failed";
  revision: number; workspace_id?: string; artifact_id?: string; view?: ViewSpec; error?: string;
};

/** A result owns the conversation link; workspace is a host of its artifact. */
export class ConversationResults {
  constructor(private db: Database, private workspaces: WorkspaceStore, private push: (topic: string, value: unknown) => void) {}

  async begin(owner: string, turnId: string, key: string, title: string, target: "inline" | "workspace"): Promise<ConversationResult> {
    const userId = await ownerUserId(this.db, owner);
    const turn = (await this.db.query("SELECT conversation_id FROM conversation_turns WHERE id=$1 AND (owner_device_id=$2 OR owner_user_id=$3)", [z.uuid().parse(turnId), owner, userId ?? null])).rows[0];
    if (!turn) throw Error("not_found");
    let workspace;
    if (target === "workspace") {
      workspace = (await this.workspaces.list(owner, turn.conversation_id)).find((item) => item.metadata?.result_key === key);
      workspace ??= await this.workspaces.create(owner, { conversation_id: turn.conversation_id, title, type: "native", metadata: { result_key: key } });
    }
    const row = (await this.db.query(`INSERT INTO conversation_results(id,conversation_id,turn_id,result_key,target,title,status,workspace_id)
      VALUES($1,$2,$3,$4,$5,$6,'loading',$7) ON CONFLICT(turn_id,result_key) DO UPDATE SET status='loading',revision=conversation_results.revision+1 RETURNING *`,
      [randomUUID(), turn.conversation_id, turnId, key, target, title, workspace?.id ?? null])).rows[0];
    this.push("conversation.result.updated", row);
    return row;
  }

  async complete(owner: string, result: ConversationResult, input: unknown): Promise<ConversationResult> {
    const view = viewSpecSchema.parse(input);
    let artifactId: string | undefined;
    if (result.workspace_id) {
      const current = await this.workspaces.get(owner, result.workspace_id);
      const artifact = await this.workspaces.upsertArtifact(owner, { workspace_id: result.workspace_id, artifact_id: current.workspace.artifact_id ?? undefined,
        type: "native", media_type: "application/vnd.jarvis.view-v2+json", source: JSON.stringify(view), status: "ready", metadata: { turn_id: result.turn_id, result_key: result.result_key } });
      artifactId = artifact.id;
      for (const section of view.sections) if (section.source) await this.workspaces.bind(owner, result.workspace_id, section.source, section.source_revision ?? 0);
    }
    const row = (await this.db.query("UPDATE conversation_results SET status='ready',view=$2,artifact_id=$3,revision=revision+1 WHERE id=$1 RETURNING *", [result.id, view, artifactId ?? null])).rows[0];
    await this.db.query("UPDATE conversation_messages SET workspace_id=COALESCE($2,workspace_id),content_type='rich' WHERE turn_id=$1 AND role='jarvis'", [result.turn_id, result.workspace_id ?? null]);
    this.push("conversation.result.updated", row);
    return row;
  }

  async fail(result: ConversationResult) {
    const row = (await this.db.query("UPDATE conversation_results SET status='failed',error='结果暂时无法生成，请重试',revision=revision+1 WHERE id=$1 RETURNING *", [result.id])).rows[0];
    this.push("conversation.result.updated", row);
  }
}
