import { useState } from "react";
import { logSnapshot } from "../../../packages/ui-protocol-v2/src/log";

export function LogView({ title, data, fallback }: { title: string; data: unknown; fallback: string }) {
  const [query, setQuery] = useState("");
  const snapshot = logSnapshot(data);
  if (!snapshot) return <section className="block"><h3>{title}</h3><p role="status">{fallback}</p></section>;
  const matches = snapshot.lines.map((text, index) => ({ text, index })).filter(({ text }) => text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="block log-view" aria-label={title}>
    <header><h3>{title}</h3><span>{matches.length} / {snapshot.lines.length} 行</span></header>
    <input aria-label={`筛选${title}`} type="search" placeholder="筛选日志文本…" value={query} onChange={(e) => setQuery(e.target.value)} />
    {snapshot.truncated && <p role="status">仅显示最近 1000 行 / 200000 字符内的日志。</p>}
    {!matches.length ? <p role="status">{snapshot.lines.length ? "没有匹配的日志" : "暂无日志"}</p> :
      <div className="log-lines" tabIndex={0} aria-label="日志内容">{matches.map(({ text, index }) => <div className="log-line" key={index}><span aria-hidden="true">{index + 1}</span><code>{text || " "}</code></div>)}</div>}
  </section>;
}
