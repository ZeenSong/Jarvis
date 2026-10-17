/**
 * Schema hardening that is safe to apply on a live, already-populated database.
 *
 * Each statement is additive. Nothing here rewrites user data; the one data
 * repair lives in `0003` and is narrowly scoped.
 */

export const sql = `
-- ---------------------------------------------------------------------------
-- Bounded retry bookkeeping for agent instance cleanup.
--
-- The previous recovery routine re-selected every terminal run whose instance
-- never recorded 'stopped_at', once per minute, forever. It wrote one
-- 'agent.progress' event per selection, which grew to 121k rows before anyone
-- noticed. These columns let the sweep back off and eventually give up.
-- ---------------------------------------------------------------------------
ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS cleanup_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS cleanup_last_attempt_at TIMESTAMPTZ;
ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS cleanup_abandoned_at TIMESTAMPTZ;
ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS cleanup_next_attempt_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS agent_instances_cleanup_due
  ON agent_instances (cleanup_next_attempt_at) WHERE stopped_at IS NULL;

-- ---------------------------------------------------------------------------
-- Case-insensitive username uniqueness.
--
-- Login resolves the account with lower(username). The unique constraint was
-- case-sensitive, so "Alice" and "alice" could both exist and login would pick
-- whichever row the planner returned first.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users GROUP BY lower(username) HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'users_username_lower_unique skipped: duplicate case-insensitive usernames exist';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'users_username_lower_unique') THEN
    CREATE UNIQUE INDEX users_username_lower_unique ON users (lower(username));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Indexes for the conversation worker claim.
--
-- The worker joined 'm2_idempotency ON response->>'reply_id' = message.id' with
-- no supporting index; EXPLAIN showed a sequential scan on every 250ms tick.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS m2_idempotency_reply
  ON m2_idempotency ((response->>'reply_id')) WHERE response ? 'reply_id';
CREATE INDEX IF NOT EXISTS m2_idempotency_conversation
  ON m2_idempotency ((request->>'conversation_id')) WHERE request ? 'conversation_id';
CREATE INDEX IF NOT EXISTS conversation_messages_turn
  ON conversation_messages (turn_id, sequence);
CREATE INDEX IF NOT EXISTS conversation_messages_queued_reply
  ON conversation_messages (conversation_id, sequence)
  WHERE role = 'jarvis' AND status = 'queued';
`;
