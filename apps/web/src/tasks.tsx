import { useState } from "react";
import { labels } from "./blocks";
import { Empty } from "./product";

type Run = { id: string; goal: string; status: string; created_at?: string };
const waiting = new Set(["waiting_for_user", "waiting_for_approval"]);
const active = new Set(["queued", "starting", "running"]);
const finished = new Set(["completed", "failed", "cancelled"]);
export function ProductTasks({ runs, open }: { runs: Run[]; open: (id: string) => void }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const groups = [
    { id: "waiting", label: "需要你处理", items: runs.filter((r) => waiting.has(r.status)) },
    { id: "active", label: "正在进行", items: runs.filter((r) => active.has(r.status)) },
    { id: "finished", label: "已结束", items: runs.filter((r) => finished.has(r.status)) },
    { id: "unknown", label: "状态待确认", items: runs.filter((r) => !waiting.has(r.status) && !active.has(r.status) && !finished.has(r.status)) },
  ];
  const visible = runs.filter((r) => (filter === "all" || groups.find((g) => g.id === filter)?.items.includes(r)) && r.goal.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="tasks-page" aria-label="任务列表">
    <p className="muted">每一件交给 Jarvis 的事，都有迹可循。</p>
    <div className="task-summary">{groups.filter((g) => g.id !== "unknown" || g.items.length).map((g) => <button key={g.id} aria-pressed={filter === g.id} onClick={() => setFilter(filter === g.id ? "all" : g.id)}><span>{g.label}</span><strong>{g.items.length}</strong></button>)}</div>
    <div className="task-toolbar"><button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>全部任务 · {runs.length}</button><input aria-label="搜索任务" placeholder="搜索任务目标…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    {visible.length === 0 ? <Empty title={runs.length ? "没有符合条件的任务" : "还没有任务"} text={runs.length ? "试试其他关键词，或查看全部任务。" : "在 Jarvis 中描述目标，执行进展将在这里呈现。"} /> : groups.filter((g) => filter === "all" || filter === g.id).map((g) => {
      const items = g.items.filter((r) => visible.includes(r));
      return items.length > 0 && <section className="task-group" key={g.id}><h2>{g.label}</h2>{items.map((r) => <button className="task-entry" key={r.id} data-testid={`run-${r.id}`} onClick={() => open(r.id)}>
        <span className={`task-state-dot ${g.id}`} /><span className="task-entry-text"><strong>{r.goal}</strong><small>{labels[r.status] ?? "状态未知"}</small></span><span aria-hidden="true">→</span>
      </button>)}</section>;
    })}
  </section>;
}
