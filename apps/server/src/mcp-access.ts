import type { Database } from "./persistence.js";
import { householdForUser } from "./households.js";

/**
 * Integration credentials are household-scoped.  These capabilities are the
 * separate member-level policy: the same household token can be used by more
 * than one member, while Jarvis still decides which MCP operations a member
 * may invoke.
 */
export const DEFAULT_MEMBER_CAPABILITIES = [
  "system.read",
  "home.read",
  "photo.read",
  "schedule.write",
  "conversation.write",
  "mcp.homeassistant.read",
  "mcp.immich.read",
] as const;

export type McpProvider = "homeassistant" | "immich";

function capability(provider: McpProvider, readOnly: boolean) {
  return `mcp.${provider}.${readOnly ? "read" : "write"}`;
}

async function memberPolicy(db: Database, userId: string, householdId: string) {
  const user = (await db.query("SELECT role FROM users WHERE id=$1", [userId])).rows[0];
  if (!user) throw Error("user_not_found");
  if (user.role === "admin") return new Set<string>(["*"]);
  const values = new Set<string>(DEFAULT_MEMBER_CAPABILITIES);
  const rows = (await db.query(
    "SELECT capability,allowed FROM household_member_capabilities WHERE household_id=$1 AND user_id=$2",
    [householdId, userId],
  )).rows;
  for (const row of rows) {
    if (row.allowed) values.add(String(row.capability));
    else values.delete(String(row.capability));
  }
  return values;
}

export async function userCapabilities(db: Database, userId: string, householdId?: string) {
  const household = householdId
    ? { id: householdId }
    : await householdForUser(db, userId);
  const values = await memberPolicy(db, userId, household.id);
  return { household_id: household.id, capabilities: [...values].sort() };
}

export async function canUseMcpTool(
  db: Database,
  userId: string,
  householdId: string,
  provider: McpProvider,
  readOnly: boolean,
) {
  const values = await memberPolicy(db, userId, householdId);
  return values.has("*") || values.has(`mcp.${provider}.*`) || values.has(capability(provider, readOnly))
    // A member who may write still needs to inspect the upstream schema first.
    // Listing schemas does not grant access to read the service data.
    || (readOnly && values.has(capability(provider, false)));
}

export async function setUserCapability(
  db: Database,
  adminId: string,
  userId: string,
  capabilityName: string,
  allowed: boolean,
) {
  const admin = (await db.query(
    `SELECT hm.household_id FROM users u JOIN household_members hm ON hm.user_id=u.id
     WHERE u.id=$1 AND u.role='admin' ORDER BY hm.created_at LIMIT 1`,
    [adminId],
  )).rows[0];
  if (!admin) throw Error("admin_required");
  const target = (await db.query(
    "SELECT 1 FROM household_members WHERE household_id=$1 AND user_id=$2",
    [admin.household_id, userId],
  )).rowCount;
  if (!target) throw Error("user_not_in_household");
  if (!/^[a-z][a-z0-9]*(?:\.[a-z0-9*_:-]+){1,5}$/.test(capabilityName)) throw Error("capability_invalid");
  await db.query(
    `INSERT INTO household_member_capabilities(household_id,user_id,capability,allowed,updated_at)
     VALUES($1,$2,$3,$4,now())
     ON CONFLICT(household_id,user_id,capability) DO UPDATE SET allowed=EXCLUDED.allowed,updated_at=now()`,
    [admin.household_id, userId, capabilityName, allowed],
  );
  return { user_id: userId, household_id: admin.household_id, capability: capabilityName, allowed };
}
