import { useCallback, useEffect, useState, type FormEvent } from "react";
import { labels } from "./blocks";
import { Empty } from "./product";

type Run = { id: string; goal: string; status: string; created_at?: string };
const waiting = new Set(["waiting_for_user", "waiting_for_approval"]);
const active = new Set(["queued", "starting", "running"]);
const finished = new Set(["completed", "failed", "cancelled"]);
type TasksGateway = { request: (topic: string, payload?: unknown) => Promise<any>; addEventListener: (name: string, listener: EventListener) => void; removeEventListener: (name: string, listener: EventListener) => void };

export function ProductTasks({ runs, open, gateway, onError }: { runs: Run[]; open: (id: string) => void; gateway: TasksGateway; onError: (error: unknown) => void }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [approvals, setApprovals] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [schedulePrompt, setSchedulePrompt] = useState("");
  const [scheduleCadence, setScheduleCadence] = useState<"once" | "daily" | "weekly">("once");
  const [scheduleDate, setScheduleDate] = useState(() => { const date = new Date(Date.now() + 3600000); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  const pendingApprovals = approvals.filter((item) => item.status === "pending");
  const refreshOperations = useCallback(async () => {
    const [nextApprovals, nextSchedules] = await Promise.all([gateway.request("approval.list"), gateway.request("schedule.list")]);
    setApprovals(nextApprovals);
    setSchedules(nextSchedules);
  }, [gateway]);
  useEffect(() => { void refreshOperations().catch(onError); }, [refreshOperations, onError]);
  useEffect(() => {
    const update = () => void refreshOperations().catch(onError);
    gateway.addEventListener("approval.created", update);
    gateway.addEventListener("approval.resolved", update);
    return () => { gateway.removeEventListener("approval.created", update); gateway.removeEventListener("approval.resolved", update); };
  }, [gateway, refreshOperations, onError]);
  const createSchedule = async (event: FormEvent) => {
    event.preventDefault();
    const next = new Date(scheduleDate);
    if (!schedulePrompt.trim() || Number.isNaN(next.getTime())) { onError(Error("请填写任务内容和有效的执行时间")); return; }
    await gateway.request("schedule.create", { prompt: schedulePrompt.trim(), cadence: scheduleCadence, next_run_at: next.toISOString() });
    setSchedulePrompt("");
    await refreshOperations();
  };
  const groups = [
    { id: "waiting", label: "需要你处理", items: runs.filter((r) => waiting.has(r.status)) },
    { id: "active", label: "正在进行", items: runs.filter((r) => active.has(r.status)) },
    { id: "finished", label: "已结束", items: runs.filter((r) => finished.has(r.status)) },
    { id: "unknown", label: "状态待确认", items: runs.filter((r) => !waiting.has(r.status) && !active.has(r.status) && !finished.has(r.status)) },
  ];
  const visible = runs.filter((r) => (filter === "all" || groups.find((g) => g.id === filter)?.items.includes(r)) && r.goal.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="tasks-page" aria-label="任务列表">
    <p className="muted">每一件交给 Jarvis 的事，都有迹可循。</p>
    {pendingApprovals.length > 0 && <section className="product-panel task-queue" aria-label="待处理审批"><div className="section-heading"><div><p className="eyebrow">ACTION REQUIRED</p><h2>待处理</h2></div><span className="muted">{pendingApprovals.length} 项</span></div>{pendingApprovals.map((item) => <article className="approval-task" key={item.id}><div><strong>{item.capability}</strong><small>{item.run_id ? `任务 ${item.run_id.slice(0, 8)}` : "手动请求"} · 有效期 {new Date(item.expires_at).toLocaleString()}</small><details><summary>查看执行参数</summary><pre>{JSON.stringify(item.input, null, 2)}</pre></details></div><div className="approval-actions"><button onClick={() => void gateway.request("approval.resolve", { approval_id: item.id, status: "approved" }).then(refreshOperations).catch(onError)}>批准</button><button className="quiet" onClick={() => void gateway.request("approval.resolve", { approval_id: item.id, status: "rejected" }).then(refreshOperations).catch(onError)}>拒绝</button></div></article>)}</section>}
    <div className="task-summary">{groups.filter((g) => g.id !== "unknown" || g.items.length).map((g) => <button key={g.id} aria-pressed={filter === g.id} onClick={() => setFilter(filter === g.id ? "all" : g.id)}><span>{g.label}</span><strong>{g.items.length}</strong></button>)}</div>
    <div className="task-toolbar"><button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>全部任务 · {runs.length}</button><input aria-label="搜索任务" placeholder="搜索任务目标…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    {visible.length === 0 ? <Empty title={runs.length ? "没有符合条件的任务" : "还没有任务"} text={runs.length ? "试试其他关键词，或查看全部任务。" : "在 Jarvis 中描述目标，执行进展将在这里呈现。"} /> : groups.filter((g) => filter === "all" || filter === g.id).map((g) => {
      const items = g.items.filter((r) => visible.includes(r));
      return items.length > 0 && <section className="task-group" key={g.id}><h2>{g.label}</h2>{items.map((r) => <button className="task-entry" key={r.id} data-testid={`run-${r.id}`} onClick={() => open(r.id)}>
        <span className={`task-state-dot ${g.id}`} /><span className="task-entry-text"><strong>{r.goal}</strong><small>{labels[r.status] ?? "状态未知"}</small></span><span aria-hidden="true">→</span>
      </button>)}</section>;
    })}
    <section className="product-panel schedule-panel" aria-label="定时任务"><div className="section-heading"><div><p className="eyebrow">AUTOMATIONS</p><h2>定时任务</h2></div><button className="quiet" onClick={() => void refreshOperations().catch(onError)}>刷新</button></div><p className="muted">把重复性的事情交给 Jarvis，任务会在这里统一管理。</p><form className="schedule-form" onSubmit={(event) => { void createSchedule(event).catch(onError); }}><input aria-label="定时任务内容" placeholder="例如：每天早上汇总服务器状态" value={schedulePrompt} onChange={(event) => setSchedulePrompt(event.target.value)} /><div><select aria-label="定时任务频率" value={scheduleCadence} onChange={(event) => setScheduleCadence(event.target.value as typeof scheduleCadence)}><option value="once">一次</option><option value="daily">每天</option><option value="weekly">每周</option></select><input aria-label="首次执行时间" type="datetime-local" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /><button disabled={!schedulePrompt.trim()}>添加任务</button></div></form>{schedules.length ? <div className="schedule-list">{schedules.map((schedule) => <div className="schedule-item" key={schedule.id}><span><strong>{schedule.prompt}</strong><small>{schedule.enabled ? "启用" : "已停用"} · {new Date(schedule.next_run_at).toLocaleString()}</small></span><button type="button" className="quiet" onClick={() => void gateway.request("schedule.toggle", { schedule_id: schedule.id, enabled: !schedule.enabled }).then(refreshOperations).catch(onError)}>{schedule.enabled ? "停用" : "启用"}</button><button type="button" className="quiet" onClick={() => void gateway.request("schedule.delete", { schedule_id: schedule.id }).then(refreshOperations).catch(onError)}>删除</button></div>)}</div> : <p className="muted">还没有定时任务。</p>}</section>
  </section>;
}
