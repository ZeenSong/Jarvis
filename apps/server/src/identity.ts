import { randomBytes, randomUUID } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { z } from "zod";
import type { Database } from "./persistence.js";
import { hash } from "./auth.js";
import { transaction } from "../../../packages/agent-manager/src/index.js";
import { ensureDefaultHousehold } from "./households.js";

export const credentialsSchema = z.object({ username: z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._-]+$/), password: z.string().min(8).max(256) }).strict();
const loginSchema = credentialsSchema.extend({ device_id: z.uuid().optional() }).strict();
const token = () => randomBytes(32).toString("base64url");
export const hashPassword = (password: string) => argonHash(password, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (encoded: string, password: string) => argonVerify(encoded, password);
const inviteSchema = z.object({ username: credentialsSchema.shape.username }).strict();
const registrationSchema = credentialsSchema.extend({ device_id: z.uuid().optional() }).strict();

export async function registrationStatus(db: Database) {
  const result = await db.query("SELECT EXISTS(SELECT 1 FROM users) AS has_users");
  return { open: !result.rows[0]?.has_users };
}

async function adoptPendingIntegrationCredentials(db: Database, userId: string, householdId: string) {
  return transaction(db, async (c) => {
    const pending = (await c.query("SELECT id,provider,label,secret_ciphertext,metadata,created_at,updated_at,revoked_at FROM pending_integration_credentials FOR UPDATE")).rows;
    for (const credential of pending) {
      await c.query(`
        INSERT INTO integration_credentials(id,user_id,household_id,provider,label,secret_ciphertext,metadata,created_at,updated_at,revoked_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(id) DO NOTHING
      `, [credential.id, userId, householdId, credential.provider, credential.label, credential.secret_ciphertext, credential.metadata, credential.created_at, credential.updated_at, credential.revoked_at]);
    }
    await c.query("DELETE FROM pending_integration_credentials");
    return pending.length;
  });
}

/**
 * The first Jarvis account is created directly from the public login screen.
 * The advisory lock makes the first-user/admin claim deterministic when two
 * browsers try to register during a fresh installation.
 */
export async function registerFirstUser(db: Database, input: unknown) {
  const p = registrationSchema.parse(input);
  const userId = randomUUID();
  const passwordHash = await hashPassword(p.password);
  await transaction(db, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(741092)");
    if ((await c.query("SELECT 1 FROM users LIMIT 1")).rowCount) throw Error("registration_closed");
    await c.query("INSERT INTO users(id,username,role) VALUES($1,$2,'admin')", [userId, p.username]);
    await c.query("INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)", [userId, passwordHash]);
  });
  const household = await ensureDefaultHousehold(db, userId, "admin");
  await adoptPendingIntegrationCredentials(db, userId, household.id);
  return loginUser(db, { username: p.username, password: p.password, device_id: p.device_id });
}
export async function createInvite(db: Database, adminId: string, input: unknown) {
  const p = inviteSchema.parse(input); const invite = token(); const id = randomUUID();
  await db.query("INSERT INTO user_invites(id,invited_by,username,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')", [id, adminId, p.username, hash(invite)]);
  return { id, username: p.username, token: invite, expires_in: 604800 };
}
export async function acceptInvite(db: Database, input: unknown) {
  const p = z.object({ token: z.string().min(20).max(200), password: credentialsSchema.shape.password }).strict().parse(input);
  const invite = (await db.query("SELECT * FROM user_invites WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now()", [hash(p.token)])).rows[0];
  if (!invite) throw Error("invalid_invite");
  const userId = randomUUID(); const passwordHash = await hashPassword(p.password);
  await transaction(db, async (c) => { const claimed = await c.query("UPDATE user_invites SET accepted_at=now() WHERE id=$1 AND accepted_at IS NULL RETURNING id", [invite.id]); if (!claimed.rowCount) throw Error("invite_already_used"); await c.query("INSERT INTO users(id,username,role) VALUES($1,$2,'member')", [userId, invite.username]); await c.query("INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)", [userId, passwordHash]); });
  await ensureDefaultHousehold(db, userId, "member");
  return { id: userId, username: invite.username, role: "member" as const };
}

export async function bootstrapUser(db: Database, deviceId: string, input: unknown) {
  const p = credentialsSchema.parse(input);
  const device = (await db.query("SELECT id FROM devices WHERE id=$1 AND role='device'", [deviceId])).rows[0];
  if (!device) throw Error("device_required");
  const userId = randomUUID();
  const passwordHash = await hashPassword(p.password);
  try {
    await transaction(db, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(741092)");
    if ((await c.query("SELECT 1 FROM users LIMIT 1")).rowCount) throw Error("bootstrap_already_completed");
    await c.query("INSERT INTO users(id,username,role) VALUES($1,$2,'admin')", [userId, p.username]);
    await c.query("INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)", [userId, passwordHash]);
    await c.query("UPDATE devices SET user_id=$2 WHERE id=$1", [deviceId, userId]);
    // The pairing device is the explicit administrator claim for pre-Identity
    // records. Unowned historical records are never assigned to public signups.
    await c.query("UPDATE conversations SET owner_device_id=$1 WHERE owner_device_id IS NULL", [deviceId]);
    });
    await ensureDefaultHousehold(db, userId, "admin");
    return { id: userId, username: p.username, role: "admin" as const };
  } catch (e) { throw e; }
}

export async function loginUser(db: Database, input: unknown, deviceId?: string) {
  const p = loginSchema.parse(input);
  const user = (await db.query("SELECT u.*,c.password_hash FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE lower(u.username)=lower($1)", [p.username])).rows[0];
  if (!user || !(await verifyPassword(user.password_hash, p.password))) throw Error("invalid_credentials");
  const refresh = token(), access = token(), sessionId = randomUUID();
  const requestedDevice = deviceId ?? p.device_id;
  const boundDevice = requestedDevice ?? `user-${randomUUID()}`;
  if (!requestedDevice) {
    await db.query("INSERT INTO devices(id,token_hash,role,user_id) VALUES($1,$2,'device',$3)", [boundDevice, hash(token()), user.id]);
  } else {
    const device = (await db.query("SELECT id,user_id FROM devices WHERE id=$1 AND role='device'", [boundDevice])).rows[0];
    if (!device) {
      await db.query("INSERT INTO devices(id,token_hash,role,user_id) VALUES($1,$2,'device',$3)", [boundDevice, hash(token()), user.id]);
    } else if (device.user_id && device.user_id !== user.id) {
      throw Error("device_owned_by_another_user");
    } else {
      await db.query("UPDATE devices SET user_id=$2 WHERE id=$1", [boundDevice, user.id]);
    }
  }
  const household = await ensureDefaultHousehold(db, user.id, user.role);
  await db.query("INSERT INTO user_sessions(id,user_id,device_id,household_id,access_hash,refresh_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 days')", [sessionId, user.id, boundDevice, household.id, hash(access), hash(refresh)]);
  return { user: { id: user.id, username: user.username, role: user.role }, household, session_id: sessionId, access_token: access, refresh_token: refresh, expires_in: 900 };
}

export async function refreshUserSession(db: Database, refreshToken: string) {
  const current = (await db.query("SELECT s.*,u.username,u.role FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.refresh_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()", [hash(refreshToken)])).rows[0];
  if (!current) throw Error("invalid_session");
  const next = token(), access = token();
  const rotated = await db.query("UPDATE user_sessions SET access_hash=$2,refresh_hash=$3,last_seen_at=now(),expires_at=now()+interval '30 days' WHERE id=$1 AND refresh_hash=$4 AND revoked_at IS NULL", [current.id, hash(access), hash(next), hash(refreshToken)]);
  if (!rotated.rowCount) throw Error("session_replayed");
  const household = await ensureDefaultHousehold(db, current.user_id, current.role);
  await db.query("UPDATE user_sessions SET household_id=$2 WHERE id=$1", [current.id, household.id]);
  return { user: { id: current.user_id, username: current.username, role: current.role }, household, session_id: current.id, access_token: access, refresh_token: next, expires_in: 900 };
}

export async function revokeUserSession(db: Database, userId: string, sessionId: string) {
  const result = await db.query("UPDATE user_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL", [sessionId, userId]);
  if (!result.rowCount) throw Error("not_found");
  return { revoked: true };
}

export async function revokeUserSessionByRefresh(db: Database, refreshToken: string) {
  await db.query("UPDATE user_sessions SET revoked_at=now() WHERE refresh_hash=$1 AND revoked_at IS NULL", [hash(refreshToken)]);
  return { revoked: true };
}

export async function listUserSessions(db: Database, userId: string) {
  return (await db.query("SELECT id,device_id,household_id,created_at,last_seen_at,expires_at FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL ORDER BY last_seen_at DESC", [userId])).rows;
}

export async function listUsers(db: Database) {
  return (await db.query(`
    SELECT u.id,u.username,u.role,u.created_at,
      COUNT(s.id) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at>now())::int AS active_sessions
    FROM users u
    LEFT JOIN user_sessions s ON s.user_id=u.id
    GROUP BY u.id
    ORDER BY u.created_at ASC
  `)).rows;
}

export async function updateUserRole(db: Database, adminId: string, userId: string, role: "admin" | "member") {
  if (adminId === userId) throw Error("cannot_change_own_role");
  return transaction(db, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(741092)");
    const target = (await c.query("SELECT id,username,role FROM users WHERE id=$1 FOR UPDATE", [userId])).rows[0];
    if (!target) throw Error("user_not_found");
    if (target.role === "admin" && role === "member" && !(await c.query("SELECT 1 FROM users WHERE role='admin' AND id<>$1 LIMIT 1", [userId])).rowCount) throw Error("last_admin");
    await c.query("UPDATE users SET role=$2 WHERE id=$1", [userId, role]);
    await c.query("UPDATE household_members SET role=$2 WHERE user_id=$1", [userId, role]);
    return { id: target.id, username: target.username, role };
  });
}

export async function authenticateUserAccess(db: Database, value?: string) {
  if (!value?.startsWith("Bearer ")) return null;
  const identity = (await db.query("SELECT s.user_id,u.username,u.role,s.device_id,s.household_id,s.id AS session_id FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.access_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '15 minutes'", [hash(value.slice(7))])).rows[0];
  if (!identity) return null;
  await db.query("UPDATE user_sessions SET last_seen_at=now() WHERE id=$1 AND revoked_at IS NULL", [identity.session_id]);
  return identity;
}
