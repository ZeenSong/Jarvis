/**
 * Repair turns that finished while an execution event was still open.
 *
 * A failed projection path left `reasoning` events in `running` status on turns
 * that had already completed. The client derives "正在执行 · N 个步骤 · 实时"
 * from any open event, so a single stale row made a finished answer look live.
 */
export const sql = `
UPDATE conversation_events e
SET status = CASE WHEN t.status = 'failed' THEN 'failed' ELSE 'completed' END,
    completed_at = COALESCE(e.completed_at, now()),
    revision = e.revision + 1
FROM conversation_turns t
WHERE t.id = e.turn_id
  AND t.status IN ('completed', 'failed', 'cancelled')
  AND e.status IN ('queued', 'running', 'waiting', 'waiting_approval');
`;
