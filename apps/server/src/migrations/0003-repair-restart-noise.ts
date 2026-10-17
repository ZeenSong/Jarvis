/**
 * One-off repair for damage caused by the unbounded instance-cleanup loop.
 *
 * Observed in production on 2026-10-17: three agent instances from 2026-09-17
 * never recorded `stopped_at`, so the recovery sweep re-selected them every
 * minute and appended a `restart_cleanup_pending` progress event each time.
 * That produced 121,432 rows (38 MB) of machine noise inside a table that the
 * task timeline reads from.
 *
 * Scope is deliberately narrow:
 * - only events whose payload is exactly that machine code are deleted;
 * - only instances whose run is already terminal are abandoned, so a live
 *   execution can never be affected even if two processes race the migration.
 */

export const sql = `
DELETE FROM run_events
WHERE type = 'agent.progress'
  AND payload->>'code' = 'restart_cleanup_pending';

UPDATE agent_instances i
SET status = 'cleanup_abandoned',
    stopped_at = COALESCE(i.stopped_at, now()),
    cleanup_abandoned_at = now()
FROM agent_runs r
WHERE r.agent_instance_id = i.id
  AND r.status IN ('completed', 'failed', 'cancelled')
  AND i.stopped_at IS NULL;
`;
