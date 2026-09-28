import type { Database } from './persistence.js';

/** Resolve ownership server-side; unknown events fail closed. Never trust a client audience. */
export async function eventAudience(db: Database, topic: string, value: unknown): Promise<{ device?: string; user?: string; shared?: boolean }> {
  const p = value as any;
  if (topic === 'system.status.changed' || topic === 'network.public_ipv6.changed' ||
      (topic === 'resource.updated' && /^system\/(status|metrics|network)$/.test(p?.resource))) return { shared: true };
  if (topic === 'conversation.deleted' && p?.owner_device_id) return { device: p.owner_device_id, user: p.owner_user_id };
  let table: string | undefined, id: string | undefined, device = 'owner_device_id', user = 'owner_user_id';
  if (topic.startsWith('conversation.')) { table = 'conversations'; id = p?.conversation_id; }
  else if (topic.startsWith('workspace.')) { table = 'workspace_records'; id = p?.workspace_id; }
  else if (topic.startsWith('approval.')) { table = 'approvals'; id = p?.approval_id; }
  else if (topic.startsWith('notification.')) { table = 'notifications'; id = p?.notification_id; }
  else if (topic.startsWith('schedule.')) { table = 'schedules'; id = p?.id; }
  else if (topic.startsWith('view.')) { table = 'views'; id = p?.id ?? p?.view_id; }
  else if (topic.startsWith('agent.run.') || topic.startsWith('task.')) {
    table = 'agent_runs'; id = p?.run_id ?? p?.task_id ?? p?.id; device = 'requested_by'; user = 'requested_by_user_id';
  } else if (topic === 'agent.status.changed' || topic === 'llm.usage.changed' || topic === 'llm.request.completed') { table = 'agents'; id = p?.agent_id ?? p?.id; }
  if (!table || !id) return {};
  const row = (await db.query(`SELECT ${device} AS device, COALESCE(${user},(SELECT user_id FROM devices WHERE id=${table}.${device})) AS "user" FROM ${table} WHERE id=$1`, [id])).rows[0];
  return row ?? {};
}
