-- Frozen M1 schema from commit 48efaca2e421737e6f297dbefa2bad56bffcac03.
CREATE TABLE devices (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK(role IN ('device','agent')), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE pairing_codes (hash TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('device','agent')), expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE agents (id TEXT PRIMARY KEY, owner_device_id TEXT NOT NULL REFERENCES devices(id), name TEXT NOT NULL, runtime TEXT, version TEXT, capabilities JSONB NOT NULL DEFAULT '[]', status TEXT NOT NULL, provider TEXT, model TEXT, current_task_id TEXT, last_seen_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE agent_sessions (id UUID PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), provider TEXT, model TEXT, status TEXT, started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ);
CREATE UNIQUE INDEX active_agent_session ON agent_sessions(agent_id) WHERE ended_at IS NULL;
CREATE TABLE agent_events (id BIGSERIAL PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), event_type TEXT NOT NULL, task_id TEXT, payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX agent_event_time ON agent_events(agent_id,created_at DESC);
CREATE TABLE llm_requests (id UUID PRIMARY KEY, request_id TEXT, agent_id TEXT REFERENCES agents(id), provider TEXT NOT NULL, model TEXT NOT NULL, input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0, cached_input_tokens BIGINT NOT NULL DEFAULT 0, reasoning_tokens BIGINT NOT NULL DEFAULT 0, latency_ms INTEGER, status TEXT NOT NULL, error_type TEXT, estimated_cost_usd NUMERIC(18,8), started_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ);
CREATE INDEX idx_llm_requests_started_at ON llm_requests(started_at);
CREATE INDEX idx_llm_requests_provider_model ON llm_requests(provider,model);
CREATE INDEX idx_llm_requests_agent ON llm_requests(agent_id);
