import { m2Migration } from "./m2-migration.js";
import pg from "pg";
export function database(url: string) {
  return new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    max: 10,
  });
}
export type Database = ReturnType<typeof database>;
export async function migrate(db: Database) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(741091)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK(role IN ('device','agent')), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS households (id UUID PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS household_members (household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(household_id,user_id));
      CREATE TABLE IF NOT EXISTS user_identities (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, issuer TEXT NOT NULL, subject TEXT NOT NULL, preferred_username TEXT, email TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(issuer,subject));
      CREATE INDEX IF NOT EXISTS household_member_user ON household_members(user_id);
      CREATE INDEX IF NOT EXISTS user_identity_user ON user_identities(user_id);
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
      CREATE TABLE IF NOT EXISTS user_credentials (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, password_hash TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS user_invites (id UUID PRIMARY KEY, invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, username TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, accepted_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS user_sessions (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, device_id TEXT REFERENCES devices(id) ON DELETE SET NULL, access_hash TEXT UNIQUE, refresh_hash TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ);
      ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id) ON DELETE SET NULL;
      ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS access_hash TEXT UNIQUE;
      CREATE TABLE IF NOT EXISTS integration_credentials (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, household_id UUID REFERENCES households(id) ON DELETE CASCADE, provider TEXT NOT NULL, label TEXT NOT NULL, secret_ciphertext TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ);
      ALTER TABLE integration_credentials ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id) ON DELETE CASCADE;
      UPDATE integration_credentials c SET household_id=hm.household_id FROM household_members hm WHERE c.user_id=hm.user_id AND c.household_id IS NULL;
      CREATE INDEX IF NOT EXISTS integration_credentials_user ON integration_credentials(user_id,provider,updated_at DESC);
      CREATE INDEX IF NOT EXISTS integration_credentials_household ON integration_credentials(household_id,provider,updated_at DESC);
      CREATE TABLE IF NOT EXISTS household_member_capabilities (household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, capability TEXT NOT NULL, allowed BOOLEAN NOT NULL DEFAULT true, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(household_id,user_id,capability));
      CREATE INDEX IF NOT EXISTS household_member_capabilities_user ON household_member_capabilities(user_id,household_id);
      CREATE TABLE IF NOT EXISTS pending_integration_credentials (id UUID PRIMARY KEY, source_username TEXT NOT NULL, provider TEXT NOT NULL, label TEXT NOT NULL, secret_ciphertext TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS approvals (id UUID PRIMARY KEY, owner_device_id TEXT NOT NULL REFERENCES devices(id), owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL, run_id UUID, capability TEXT NOT NULL, input JSONB NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ);
      ALTER TABLE approvals ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;
      ALTER TABLE approvals ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now()+interval '15 minutes');
      ALTER TABLE approvals ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
      UPDATE approvals a SET owner_user_id=d.user_id FROM devices d WHERE a.owner_device_id=d.id AND a.owner_user_id IS NULL AND d.user_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS approvals_owner_status ON approvals(owner_device_id,status,created_at DESC);
      CREATE INDEX IF NOT EXISTS approvals_user_status ON approvals(owner_user_id,status,created_at DESC);
      CREATE TABLE IF NOT EXISTS notifications (id UUID PRIMARY KEY, owner_device_id TEXT NOT NULL REFERENCES devices(id), owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', reference_id UUID, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
      UPDATE notifications n SET owner_user_id=d.user_id FROM devices d WHERE n.owner_device_id=d.id AND n.owner_user_id IS NULL AND d.user_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS notifications_owner_unread ON notifications(owner_device_id,read_at,created_at DESC);
      CREATE INDEX IF NOT EXISTS notifications_user_unread ON notifications(owner_user_id,read_at,created_at DESC);
      CREATE TABLE IF NOT EXISTS schedules (id UUID PRIMARY KEY, owner_device_id TEXT NOT NULL REFERENCES devices(id), owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL, prompt TEXT NOT NULL, cadence TEXT NOT NULL CHECK(cadence IN ('once','daily','weekly')), enabled BOOLEAN NOT NULL DEFAULT true, next_run_at TIMESTAMPTZ NOT NULL, conversation_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      ALTER TABLE schedules ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
      UPDATE schedules s SET owner_user_id=d.user_id FROM devices d WHERE s.owner_device_id=d.id AND s.owner_user_id IS NULL AND d.user_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS schedules_due ON schedules(enabled,next_run_at);
      CREATE INDEX IF NOT EXISTS schedules_owner_user ON schedules(owner_user_id,next_run_at DESC);
      CREATE INDEX IF NOT EXISTS user_sessions_active ON user_sessions(user_id,expires_at) WHERE revoked_at IS NULL;
      CREATE TABLE IF NOT EXISTS pairing_codes (hash TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('device','agent')), expires_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, owner_device_id TEXT NOT NULL REFERENCES devices(id), owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL, name TEXT NOT NULL, runtime TEXT, version TEXT, capabilities JSONB NOT NULL DEFAULT '[]', status TEXT NOT NULL, provider TEXT, model TEXT, current_task_id TEXT, last_seen_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
      UPDATE agents a SET owner_user_id=d.user_id FROM devices d WHERE a.owner_device_id=d.id AND a.owner_user_id IS NULL AND d.user_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS agents_owner_user ON agents(owner_user_id,name);
      CREATE TABLE IF NOT EXISTS agent_sessions (id UUID PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), provider TEXT, model TEXT, status TEXT, started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ);
      CREATE UNIQUE INDEX IF NOT EXISTS active_agent_session ON agent_sessions(agent_id) WHERE ended_at IS NULL;
      CREATE TABLE IF NOT EXISTS agent_events (id BIGSERIAL PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), event_type TEXT NOT NULL, task_id TEXT, payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS agent_event_time ON agent_events(agent_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS llm_requests (id UUID PRIMARY KEY, request_id TEXT, agent_id TEXT REFERENCES agents(id), provider TEXT NOT NULL, model TEXT NOT NULL, input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0, cached_input_tokens BIGINT NOT NULL DEFAULT 0, reasoning_tokens BIGINT NOT NULL DEFAULT 0, latency_ms INTEGER, status TEXT NOT NULL, error_type TEXT, estimated_cost_usd NUMERIC(18,8), started_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ);
      CREATE INDEX IF NOT EXISTS idx_llm_requests_started_at ON llm_requests(started_at);
      CREATE INDEX IF NOT EXISTS idx_llm_requests_provider_model ON llm_requests(provider,model);
      CREATE INDEX IF NOT EXISTS idx_llm_requests_agent ON llm_requests(agent_id);
    `);
    await client.query(m2Migration);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
