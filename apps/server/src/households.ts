import { randomUUID } from "node:crypto";
import type { Database } from "./persistence.js";

export const DEFAULT_HOUSEHOLD_SLUG = "default-household";

/**
 * A household is deliberately separate from a user.  The first deployment has
 * one household, but every execution context still carries its household id so
 * adding another household later does not require changing ownership semantics.
 */
export async function ensureDefaultHousehold(db: Database, userId: string, role: "admin" | "member" = "member") {
  const existing = (await db.query(
    `SELECT h.id,h.slug,h.name,hm.role
       FROM households h JOIN household_members hm ON hm.household_id=h.id
      WHERE hm.user_id=$1 ORDER BY h.created_at LIMIT 1`,
    [userId],
  )).rows[0];
  if (existing) return existing;

  const householdId = randomUUID();
  return (await db.query(
    `WITH household AS (
       INSERT INTO households(id,slug,name) VALUES($1,$2,$3)
       ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name
       RETURNING id,slug,name
     ), membership AS (
       INSERT INTO household_members(household_id,user_id,role)
       SELECT id,$4,$5 FROM household
       ON CONFLICT(household_id,user_id) DO UPDATE SET role=EXCLUDED.role
       RETURNING household_id,role
     )
     SELECT h.id,h.slug,h.name,m.role FROM household h JOIN membership m ON m.household_id=h.id`,
    [householdId, DEFAULT_HOUSEHOLD_SLUG, "我的家庭", userId, role],
  )).rows[0];
}
export async function householdForUser(db: Database, userId: string) {
  return ensureDefaultHousehold(db, userId);
}

export async function householdIdForOwner(db: Database, owner: string) {
  const userId = owner.startsWith("user-")
    ? owner.slice(5)
    : (await db.query("SELECT user_id FROM devices WHERE id=$1", [owner])).rows[0]?.user_id;
  if (!userId) return undefined;
  return (await householdForUser(db, userId)).id as string;
}
