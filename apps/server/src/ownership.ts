import type { Database } from "./persistence.js";

/** Resolves the stable user behind either a physical device or a user session. */
export async function ownerUserId(db: Database, owner: string): Promise<string | undefined> {
  if (owner.startsWith("user-")) return owner.slice(5) || undefined;
  return (await db.query("SELECT user_id FROM devices WHERE id=$1", [owner])).rows[0]?.user_id ?? undefined;
}
