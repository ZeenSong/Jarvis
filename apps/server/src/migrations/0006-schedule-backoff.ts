/**
 * Bounded retries for schedules.
 *
 * A schedule that throws was left untouched for "the next scheduler pass", which
 * runs every two seconds. A permanently broken schedule (revoked credential,
 * deleted conversation) therefore retried forever and produced a continuous error
 * loop, the same class of bug as the instance-cleanup loop.
 */
export const sql = `
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS last_error TEXT;
CREATE INDEX IF NOT EXISTS schedules_due_healthy ON schedules(next_run_at) WHERE enabled = true;
`;
