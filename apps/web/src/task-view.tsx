import { taskDataSchema } from "../../../packages/ui-protocol-v2/src/task";
import { labels } from "./blocks";

export function TaskView({ title, data, fallback }: { title: string; data: unknown; fallback: string }) {
  const parsed = taskDataSchema.safeParse(data);
  if (!parsed.success) return <section className="block"><h3>{title}</h3><p role="status">{fallback}</p></section>;
  const task = parsed.data;
  const status = labels[task.status] ?? `未知状态：${task.status}`;
  const tone = task.status === "completed" ? "success" : task.status === "failed" ? "failure" : ["waiting_for_user", "waiting_for_approval"].includes(task.status) ? "attention" : "neutral";
  return <section className="block semantic-task" aria-label={title}>
    <h3>{title}</h3><span className={`task-state ${tone}`} role="status">{status}</span>
    <p className="task-goal">{task.goal}</p>
    {task.agent_id && <p className="muted">执行者 · {task.agent_id}</p>}
    <dl>{([["开始时间", task.started_at], ["完成时间", task.finished_at]] as const).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd><time dateTime={value!} title={value!}>{Number.isFinite(Date.parse(value!)) ? new Date(value!).toLocaleString("zh-CN", { hour12: false }) : "时间不可用"}</time></dd></div>)}</dl>
  </section>;
}
