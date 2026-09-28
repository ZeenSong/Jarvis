export const m2Migration = `
CREATE TABLE IF NOT EXISTS conversations (id UUID PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),household_id UUID REFERENCES households(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS owner_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id) ON DELETE SET NULL;
UPDATE conversations c SET owner_user_id=d.user_id FROM devices d WHERE c.owner_device_id=d.id AND c.owner_user_id IS NULL AND d.user_id IS NOT NULL;
UPDATE conversations c SET household_id=hm.household_id FROM household_members hm WHERE c.owner_user_id=hm.user_id AND c.household_id IS NULL;
CREATE INDEX IF NOT EXISTS conversations_owner_updated ON conversations(owner_device_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS conversations_user_updated ON conversations(owner_user_id,updated_at DESC);
-- Conversation V2 makes a turn and its activities durable first-class records.
-- The legacy message rows remain as the transcript projection for clients that
-- have not upgraded yet.
CREATE TABLE IF NOT EXISTS conversation_turns (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  owner_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  household_id UUID REFERENCES households(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','waiting_approval','waiting_question','completed','failed','cancelled')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversation_turns_conversation ON conversation_turns(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS conversation_turns_owner ON conversation_turns(owner_user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS conversation_activities (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id UUID NOT NULL REFERENCES conversation_turns(id) ON DELETE CASCADE,
  owner_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  tool_call_id TEXT,
  capability TEXT NOT NULL,
  group_key TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','waiting_approval','completed','failed','cancelled')),
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS conversation_activities_turn ON conversation_activities(turn_id,created_at);
CREATE TABLE IF NOT EXISTS conversation_questions (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id UUID NOT NULL REFERENCES conversation_turns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('boolean','single_choice')),
  prompt TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]',
  answer JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','answered','expired','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS conversation_questions_turn ON conversation_questions(turn_id,status);
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS turn_id UUID REFERENCES conversation_turns(id) ON DELETE SET NULL;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS activity_id UUID REFERENCES conversation_activities(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS agent_definitions (id TEXT PRIMARY KEY,name TEXT NOT NULL,tier TEXT NOT NULL CHECK(tier IN ('core','managed')),role TEXT NOT NULL,runtime_type TEXT NOT NULL,runtime_config JSONB NOT NULL DEFAULT '{}',lifecycle TEXT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT true,description TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
INSERT INTO agent_definitions(id,name,tier,role,runtime_type,lifecycle) VALUES ('jarvis-core','Jarvis','core','coordinator','deepseek','long-lived'),('coding-agent','Coding Agent','managed','coding','codex','on-demand'),('ops-agent','Ops Agent','managed','ops','hermes','on-demand') ON CONFLICT DO NOTHING;
UPDATE agent_definitions SET runtime_type='hermes',updated_at=now() WHERE (id='ops-agent' AND runtime_type='pydantic') OR (id='jarvis-core' AND runtime_type='deepseek');
CREATE TABLE IF NOT EXISTS agent_instances (id UUID PRIMARY KEY,agent_definition_id TEXT NOT NULL REFERENCES agent_definitions(id),runtime_type TEXT NOT NULL,runtime_instance_id TEXT,status TEXT NOT NULL,started_at TIMESTAMPTZ DEFAULT now(),last_seen_at TIMESTAMPTZ DEFAULT now(),stopped_at TIMESTAMPTZ,metadata JSONB NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS workspaces (id UUID PRIMARY KEY,repository TEXT NOT NULL,commit_sha TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,metadata JSONB NOT NULL DEFAULT '{}');
-- M3.1 durable user workspaces. This is intentionally separate from the
-- legacy coding checkout table above, which is temporary worker state.
CREATE TABLE IF NOT EXISTS workspace_records (
  id UUID PRIMARY KEY,
  owner_device_id TEXT NOT NULL REFERENCES devices(id),
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  task_id UUID,
  artifact_id UUID,
  type TEXT NOT NULL CHECK(type IN ('native','web','react','composite')),
  title TEXT NOT NULL DEFAULT '工作区',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','failed')),
  revision BIGINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE workspace_records ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS workspace_records_owner_updated ON workspace_records(owner_device_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS workspace_records_user_updated ON workspace_records(owner_user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS workspace_records_conversation ON workspace_records(conversation_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS workspace_artifacts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspace_records(id) ON DELETE CASCADE,
  owner_device_id TEXT NOT NULL REFERENCES devices(id),
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK(type IN ('native','html','react','json')),
  media_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  compiled TEXT,
  revision BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','failed')),
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE workspace_artifacts ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workspace_records_artifact_fk') THEN
    ALTER TABLE workspace_records ADD CONSTRAINT workspace_records_artifact_fk FOREIGN KEY (artifact_id) REFERENCES workspace_artifacts(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS workspace_artifacts_workspace ON workspace_artifacts(workspace_id,updated_at DESC);
UPDATE workspace_records w SET owner_user_id=d.user_id FROM devices d WHERE w.owner_device_id=d.id AND w.owner_user_id IS NULL AND d.user_id IS NOT NULL;
UPDATE workspace_artifacts w SET owner_user_id=d.user_id FROM devices d WHERE w.owner_device_id=d.id AND w.owner_user_id IS NULL AND d.user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS workspace_bindings (
  workspace_id UUID NOT NULL REFERENCES workspace_records(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY(workspace_id,resource)
);
CREATE TABLE IF NOT EXISTS agent_runs (id UUID PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agent_definitions(id),agent_instance_id UUID REFERENCES agent_instances(id),parent_run_id UUID REFERENCES agent_runs(id),conversation_id UUID REFERENCES conversations(id),requested_by TEXT NOT NULL REFERENCES devices(id),goal TEXT NOT NULL,runtime_type TEXT NOT NULL,runtime_run_id TEXT,status TEXT NOT NULL CHECK(status IN ('queued','starting','running','waiting_for_user','waiting_for_approval','completed','failed','cancelled')),depth INTEGER NOT NULL CHECK(depth BETWEEN 0 AND 2),workspace_id UUID REFERENCES workspaces(id),input_json JSONB NOT NULL DEFAULT '{}',result_json JSONB,error_json JSONB,started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS durable_workspace_id UUID REFERENCES workspace_records(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workspace_records_task_fk') THEN
    ALTER TABLE workspace_records ADD CONSTRAINT workspace_records_task_fk FOREIGN KEY (task_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
  END IF;
END $$;
-- Approval is a control-plane record for a durable task. Keep legacy rows that
-- reference deleted/unknown runs readable, but enforce the relationship for
-- all new installations and once existing data is consistent.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approvals_run_fk')
     AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.id=a.run_id)) THEN
    ALTER TABLE approvals ADD CONSTRAINT approvals_run_fk FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS approvals_run_status ON approvals(run_id,status,created_at DESC);
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
UPDATE agent_runs r SET requested_by_user_id=d.user_id FROM devices d WHERE r.requested_by=d.id AND r.requested_by_user_id IS NULL AND d.user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS run_parent ON agent_runs(parent_run_id);
CREATE INDEX IF NOT EXISTS run_owner_user_created ON agent_runs(requested_by_user_id,created_at DESC);
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS last_event_sequence BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS conversation_messages (id UUID PRIMARY KEY,conversation_id UUID NOT NULL REFERENCES conversations(id),owner_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,role TEXT NOT NULL CHECK(role IN ('user','jarvis','system')),content TEXT NOT NULL DEFAULT '',content_type TEXT NOT NULL DEFAULT 'text',status TEXT NOT NULL DEFAULT 'queued',run_id UUID REFERENCES agent_runs(id),view_id UUID,workspace_id UUID REFERENCES workspace_records(id) ON DELETE SET NULL,turn_id UUID REFERENCES conversation_turns(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS owner_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspace_records(id) ON DELETE SET NULL;
UPDATE conversation_messages m SET owner_device_id=COALESCE(m.owner_device_id,c.owner_device_id),owner_user_id=COALESCE(m.owner_user_id,c.owner_user_id) FROM conversations c WHERE m.conversation_id=c.id AND (m.owner_device_id IS NULL OR m.owner_user_id IS NULL);
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS sequence BIGSERIAL;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS hermes_run_id TEXT;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS turn_id UUID REFERENCES conversation_turns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS message_conversation ON conversation_messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS message_owner_sequence ON conversation_messages(owner_user_id,conversation_id,sequence);
CREATE TABLE IF NOT EXISTS run_events (id BIGSERIAL PRIMARY KEY,run_id UUID NOT NULL REFERENCES agent_runs(id),agent_id TEXT NOT NULL REFERENCES agent_definitions(id),type TEXT NOT NULL,payload JSONB NOT NULL,timestamp TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS run_event_run ON run_events(run_id,id);
CREATE TABLE IF NOT EXISTS artifacts (id UUID PRIMARY KEY,run_id UUID NOT NULL REFERENCES agent_runs(id),owner_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,name TEXT NOT NULL,media_type TEXT NOT NULL,content TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),expires_at TIMESTAMPTZ NOT NULL);
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS owner_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
UPDATE artifacts a SET owner_device_id=r.requested_by,owner_user_id=r.requested_by_user_id FROM agent_runs r WHERE a.run_id=r.id AND a.owner_device_id IS NULL;
CREATE INDEX IF NOT EXISTS artifacts_owner_user ON artifacts(owner_user_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS artifact_run_name ON artifacts(run_id,name);
CREATE TABLE IF NOT EXISTS resources (resource TEXT PRIMARY KEY,revision BIGINT NOT NULL,data JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS views (id UUID PRIMARY KEY,owner_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,spec JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE views ADD COLUMN IF NOT EXISTS owner_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;
ALTER TABLE views ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
UPDATE views v SET owner_user_id=d.user_id FROM devices d WHERE v.owner_device_id=d.id AND v.owner_user_id IS NULL AND d.user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS views_owner_created ON views(owner_user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS m2_idempotency (device_id TEXT NOT NULL REFERENCES devices(id),key TEXT NOT NULL,request JSONB NOT NULL,response JSONB NOT NULL,PRIMARY KEY(device_id,key));
CREATE TABLE IF NOT EXISTS system_metrics (id BIGSERIAL PRIMARY KEY,sampled_at TIMESTAMPTZ NOT NULL DEFAULT now(),data JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS metrics_time ON system_metrics(sampled_at);
CREATE TABLE IF NOT EXISTS web_sessions (token_hash TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id),expires_at TIMESTAMPTZ NOT NULL);
ALTER TABLE llm_requests ADD COLUMN IF NOT EXISTS logical_agent_id TEXT REFERENCES agent_definitions(id);
ALTER TABLE llm_requests ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES agent_runs(id);
ALTER TABLE llm_requests ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id);
`;
