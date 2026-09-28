import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "./persistence.js";
import { hash } from "./auth.js";
import { ensureDefaultHousehold } from "./households.js";

type OidcConfig = { issuer: string; clientId: string; clientSecret?: string; redirectUri: string; scopes: string };
type PendingState = { verifier: string; createdAt: number; redirectUri: string };
const pending = new Map<string, PendingState>();

function config(env: NodeJS.ProcessEnv = process.env): OidcConfig | undefined {
  const issuer = env.AUTHENTIK_ISSUER?.trim().replace(/\/$/, "");
  const clientId = env.AUTHENTIK_CLIENT_ID?.trim();
  const redirectUri = env.AUTHENTIK_REDIRECT_URI?.trim();
  if (!issuer || !clientId || !redirectUri) return undefined;
  return { issuer, clientId, clientSecret: env.AUTHENTIK_CLIENT_SECRET?.trim() || undefined, redirectUri, scopes: env.AUTHENTIK_OIDC_SCOPES?.trim() || "openid profile email" };
}
function base64(value: Buffer) { return value.toString("base64url"); }
function verifier() { return base64(randomBytes(32)); }
function challenge(value: string) { return base64(createHash("sha256").update(value).digest()); }
function cleanup() { const cutoff = Date.now() - 10 * 60_000; for (const [key, value] of pending) if (value.createdAt < cutoff) pending.delete(key); }

async function discovery(value: OidcConfig, fetcher = fetch) {
  const response = await fetcher(`${value.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw Error("oidc_discovery_failed");
  const document = await response.json() as { authorization_endpoint?: string; token_endpoint?: string; userinfo_endpoint?: string };
  if (!document.authorization_endpoint || !document.token_endpoint || !document.userinfo_endpoint) throw Error("oidc_discovery_invalid");
  return document;
}

export async function oidcAuthorizationUrl(env: NodeJS.ProcessEnv = process.env, fetcher = fetch) {
  const value = config(env); if (!value) return undefined;
  cleanup();
  const document = await discovery(value, fetcher);
  const state = base64(randomBytes(24)), codeVerifier = verifier();
  pending.set(state, { verifier: codeVerifier, createdAt: Date.now(), redirectUri: value.redirectUri });
  const url = new URL(document.authorization_endpoint!);
  url.search = new URLSearchParams({ response_type: "code", client_id: value.clientId, redirect_uri: value.redirectUri, scope: value.scopes, state, code_challenge: challenge(codeVerifier), code_challenge_method: "S256" }).toString();
  return { url: url.toString(), state };
}

export type OidcProfile = { issuer: string; subject: string; preferred_username?: string; email?: string; name?: string };

function safeUsername(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || `user-${randomUUID().slice(0, 8)}`;
}

export async function upsertOidcIdentity(db: Database, profile: OidcProfile) {
  const existing = (await db.query("SELECT u.id,u.username,u.role FROM user_identities i JOIN users u ON u.id=i.user_id WHERE i.issuer=$1 AND i.subject=$2", [profile.issuer, profile.subject])).rows[0];
  if (existing) {
    await db.query("UPDATE user_identities SET preferred_username=$3,email=$4 WHERE issuer=$1 AND subject=$2", [profile.issuer, profile.subject, profile.preferred_username ?? null, profile.email ?? null]);
    const household = await ensureDefaultHousehold(db, existing.id, existing.role);
    return { user: existing, household };
  }
  let username = safeUsername(profile.preferred_username ?? profile.email?.split("@")[0] ?? profile.subject);
  const taken = await db.query("SELECT 1 FROM users WHERE lower(username)=lower($1)", [username]);
  if (taken.rowCount) username = `${username}-${randomUUID().slice(0, 6)}`;
  const userId = randomUUID();
  await db.query("INSERT INTO users(id,username,role) VALUES($1,$2,'member')", [userId, username]);
  await db.query("INSERT INTO user_identities(id,user_id,issuer,subject,preferred_username,email) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), userId, profile.issuer, profile.subject, profile.preferred_username ?? null, profile.email ?? null]);
  const household = await ensureDefaultHousehold(db, userId, "member");
  return { user: { id: userId, username, role: "member" as const }, household };
}

export async function completeOidcLogin(db: Database, state: string, code: string, env: NodeJS.ProcessEnv = process.env, fetcher = fetch) {
  const value = config(env); if (!value) throw Error("oidc_not_configured");
  const saved = pending.get(state); pending.delete(state);
  if (!saved || Date.now() - saved.createdAt > 10 * 60_000 || !code) throw Error("oidc_invalid_state");
  const document = await discovery(value, fetcher);
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: saved.redirectUri, client_id: value.clientId, code_verifier: saved.verifier });
  const response = await fetcher(document.token_endpoint!, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(value.clientSecret ? { authorization: `Basic ${Buffer.from(`${value.clientId}:${value.clientSecret}`).toString("base64")}` } : {}) }, body: form, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw Error("oidc_token_exchange_failed");
  const tokens = await response.json() as { access_token?: string; token_type?: string };
  if (!tokens.access_token) throw Error("oidc_access_token_missing");
  const info = await fetcher(document.userinfo_endpoint!, { headers: { authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000) });
  if (!info.ok) throw Error("oidc_userinfo_failed");
  const claims = await info.json() as { sub?: string; preferred_username?: string; email?: string; name?: string };
  if (!claims.sub) throw Error("oidc_subject_missing");
  const mapped = await upsertOidcIdentity(db, { issuer: value.issuer, subject: claims.sub, preferred_username: claims.preferred_username, email: claims.email, name: claims.name });
  const accessToken = base64(randomBytes(32)), refreshToken = base64(randomBytes(32)), sessionId = randomUUID(), deviceId = `oidc-${randomUUID()}`;
  await db.query("INSERT INTO devices(id,token_hash,role,user_id) VALUES($1,$2,'device',$3)", [deviceId, hash(base64(randomBytes(32))), mapped.user.id]);
  await db.query("INSERT INTO user_sessions(id,user_id,device_id,household_id,access_hash,refresh_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 days')", [sessionId, mapped.user.id, deviceId, mapped.household.id, hash(accessToken), hash(refreshToken)]);
  return { ...mapped, session_id: sessionId, access_token: accessToken, refresh_token: refreshToken, expires_in: 900 };
}

export function oidcConfigured(env: NodeJS.ProcessEnv = process.env) { return Boolean(config(env)); }
