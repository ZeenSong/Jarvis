import { labels } from "./blocks";
export function TimelineView({ title, data, fallback }: { title: string; data: unknown; fallback: string }) {
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== "object" || Array.isArray(row))) return <section className="block"><h3>{title}</h3><p role="status">{fallback}</p></section>;
  const rows = data.slice(-200);
  return <section className="block event-timeline" aria-label={title}><h3>{title}</h3>
    {!rows.length && <p role="status">暂无执行事件</p>}
    {data.length > 200 && <p role="status">显示最近 200 条事件</p>}
    <ol tabIndex={0} aria-label="执行事件列表">{rows.map((row, index) => {
      const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
      const status = typeof payload.status === "string" ? payload.status : "";
      const heading = typeof payload.title === "string" && payload.title.trim() ? payload.title.slice(0, 500) : labels[status] ?? "任务事件";
      const timestamp = typeof row.timestamp === "string" ? row.timestamp : "";
      const description = typeof payload.description === "string" ? payload.description.slice(0, 4000) : "";
      return <li key={index}><span className={`event-dot ${status === "failed" ? "failure" : status === "completed" ? "success" : ""}`} aria-hidden="true" /><div>
        <time dateTime={timestamp || undefined} title={timestamp}>{Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toLocaleString("zh-CN", {month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}) : "时间未知"}</time>
        <p>{heading}</p>{description && <details><summary>查看说明</summary><p>{description}</p></details>}
      </div></li>;
    })}</ol>
  </section>;
}
