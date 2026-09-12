import { useState, useRef, useEffect } from "react";
import { labels } from "./blocks";

export function Orb({ small = false }: { small?: boolean }) {
  return <span aria-hidden="true" className={`jarvis-orb ${small ? "small" : ""}`} />;
}

export function ProductHome({ system, runs, conversations, navigate, ask, applications }: {
  applications?: any;
  system: any; runs: any[]; conversations: any[]; navigate: (page: string, id?: string) => void; ask: (prompt: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const running = runs.filter((r) => ["queued", "starting", "running", "waiting_for_user", "waiting_for_approval"].includes(r.status));
  const metrics = [["CPU", system?.cpu?.usage_percent], ["内存", system?.memory?.usage_percent], ["存储", system?.disks?.[0]?.usage_percent]];
  return <div className="product-home">
    <section className="home-hero">
      <div><p className="eyebrow">YOUR PERSONAL AI CLOUD</p><h1>让科技，回归生活。</h1>
        <p className="muted">{system ? system.jarvis?.server_status === "healthy" ? "你的私人云，一切正常" : "你的私人云有状态需要关注" : "正在连接你的私人云…"}{system && ` · ${running.length} 个任务进行中`}</p>
      </div><div className="hero-signature" aria-hidden="true">More Life<br /><span>Less Work</span></div>
      <form className="command-bar" onSubmit={(e) => { e.preventDefault(); if (prompt.trim()) ask(prompt); }}>
        <Orb small /><input aria-label="问 Jarvis" placeholder="问 Jarvis，或描述你想做的事…" value={prompt} onChange={(e) => setPrompt(e.target.value)} /><button aria-label="发送给 Jarvis" disabled={!prompt.trim()}>↑</button>
      </form>
      <div className="suggestions">{["查看服务器状态", "分析最近的任务", "帮我整理一个工作计划"].map((p) => <button key={p} onClick={() => ask(p)}>{p} ↗</button>)}</div>
    </section>
    <div className="section-heading"><h2>系统状态</h2><button className="quiet" onClick={() => navigate("system")}>查看系统 →</button></div>
    <section className="home-metrics" aria-label="关键状态">{metrics.map(([name, value]) => <button key={name} className="metric-tile" onClick={() => navigate("system")}>
      <span>{name}</span><strong>{typeof value === "number" ? `${value.toFixed(0)}%` : "—"}</strong>
      <span className="meter"><span style={{ width: `${typeof value === "number" ? Math.max(0, Math.min(100, value)) : 0}%` }} /></span>
    </button>)}<button className="metric-tile status-tile" onClick={() => navigate("tasks")}><span>Jarvis 正在工作</span><strong>{running.length}<small> 个任务</small></strong><span className="muted">查看进展与待处理事项 →</span></button></section>
    <div className="section-heading"><h2>我的空间</h2><button className="quiet" onClick={() => navigate("spaces")}>全部空间 ↗</button></div>
    <SpaceCards navigate={navigate} />
    <div className="home-bottom"><section className="product-panel"><div className="section-heading"><h2>当前任务</h2><button className="quiet" onClick={() => navigate("tasks")}>查看全部 →</button></div>
      {running.length ? running.slice(0, 3).map((r) => <button className="run-row" key={r.id} onClick={() => navigate("run", r.id)}><span>{r.goal}</span><small>{labels[r.status]}</small></button>) : <Empty title="现在没有进行中的任务" text="有想做的事，随时告诉 Jarvis。" />}
    </section><section className="product-panel"><h2>最近活动</h2>{conversations.length ? conversations.slice(0, 4).map((c) => <button className="activity-row" key={c.id} onClick={() => navigate("jarvis", c.id)}><span className="activity-dot" /><span>{c.title}</span><span>↗</span></button>) : <Empty title="从一次对话开始" text="你的对话与任务进展会汇集在这里。" />}</section></div>
    <section className="product-panel home-applications"><div className="section-heading"><h2>我的应用</h2><button className="quiet" onClick={() => navigate("apps")}>应用中心 →</button></div><ApplicationList value={applications} /></section>
  </div>;
}
type Application = { id: string; name: string; status: string; description?: string; service_count?: number | null };
export function ApplicationList({ value }: { value?: { status: string; apps: Application[] } }) {
  const [selected, setSelected] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const app = value?.apps.find((item) => item.id === selected);
  useEffect(() => {
    if (app) dialog.current?.showModal();
    else dialog.current?.close();
  }, [app]);
  if (value?.status !== "ready") {
    const states: Record<string, [string, string]> = {
      not_configured: ["尚未连接 CasaOS", "需要配置服务端 CasaOS 连接，才能读取已安装应用。"],
      authentication_required: ["CasaOS 需要重新认证", "当前会话已失效；重新连接后恢复应用状态。"],
      configuration_error: ["CasaOS 连接配置需要检查", "服务端凭据文件权限不符合要求。"],
      unavailable: ["暂时无法读取应用", "请检查 CasaOS 连接，稍后刷新重试。"],
    };
    const [title, text] = value ? states[value.status] ?? states.unavailable : ["正在读取应用", "正在连接你的私人云应用服务…"];
    return <div role="status"><Empty title={title} text={text} /></div>;
  }
  if (!value.apps.length) return <Empty title="还没有安装应用" text="CasaOS 已连接，当前没有已安装应用。" />;
  return <><div className="application-grid">{value.apps.map((app) => <button className="application-card" key={app.id} onClick={() => setSelected(app.id)} aria-label={`查看 ${app.name} 详情`}>
    {['homeassistant','immich'].includes(app.id) ? <img className="application-icon" src={`/app-icons/${app.id}.svg`} alt="" /> : <span className="application-monogram" aria-hidden="true">{app.name.slice(0, 1).toUpperCase()}</span>}
    <div><h3>{app.name}</h3><small>CasaOS</small></div><span className={`application-status ${app.status}`}>{app.status === "running" ? "运行中" : app.status === "stopped" ? "已停止" : "状态未知"}</span>
  </button>)}</div><dialog ref={dialog} className="application-detail" aria-labelledby="application-detail-title" onClose={() => setSelected(undefined)}>
    {app && <><header><div><p className="eyebrow">CASAOS APPLICATION</p><h2 id="application-detail-title">{app.name}</h2></div><button aria-label="关闭应用详情" onClick={() => dialog.current?.close()}>×</button></header>
      {app.description ? <details className="application-description"><summary>应用简介 · 来自 CasaOS</summary><p>{app.description}</p></details> : <p className="application-description">此应用未提供简介。</p>}
      <dl><div><dt>运行状态</dt><dd>{app.status === "running" ? "运行中" : app.status === "stopped" ? "已停止" : "状态未知"}</dd></div>
      <div><dt>应用服务</dt><dd>CasaOS</dd></div><div><dt>服务数量</dt><dd>{app.service_count ?? "未知"}</dd></div><div><dt>应用标识</dt><dd>{app.id}</dd></div></dl>
      <p className="muted">当前提供只读状态。启停、更新等操作尚未开放。</p></>}
  </dialog></>;
}
export function Empty({ title, text }: { title: string; text: string }) {
  return <div className="product-empty"><span aria-hidden="true">◇</span><h3>{title}</h3><p>{text}</p></div>;
}
export function SpaceCards({ navigate }: { navigate: (page: string) => void }) {
  const [selected, setSelected] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const descriptions: Record<string, string> = {
    photos: "可在应用中心查看 Immich 的连接与运行状态。照片时间线、相册与搜索尚未接入此空间；这里的封面是装饰图，不是你的照片。",
    files: "文件浏览、上传与权限控制尚未接入。此处不会展示模拟文件或执行文件操作。",
    knowledge: "知识库与检索尚未接入。你的对话仍可在 Jarvis 中查看。",
    family: "可在应用中心查看 Home Assistant 的连接与运行状态。设备、房间与控制能力尚未接入此空间。",
    media: "影音库尚未接入。此处不会展示模拟媒体内容。",
  };
  useEffect(() => { if (selected) dialog.current?.showModal(); }, [selected]);
  return <><div className="space-grid">{[["photos", "照片", "那些值得珍藏的时刻"], ["files", "文件", "你的资料，触手可及"], ["knowledge", "知识", "让想法持续生长"], ["family", "家庭", "设备与生活"], ["media", "媒体", "你的影音空间"], ["development", "开发", "把想法变成作品"]].map(([key, title, text]) =>
    <button key={key} className={`space-card space-${key}`} onClick={() => key === "development" ? navigate("tasks") : setSelected(key)}><span className="space-art" aria-hidden="true" /><strong>{title}</strong><small>{text}</small><span className="space-arrow">↗</span></button>)}</div>
    <dialog ref={dialog} className="application-detail" aria-labelledby="space-detail-title" onClose={() => setSelected(undefined)}>
      <header><h2 id="space-detail-title">空间接入进度</h2><button aria-label="关闭空间详情" onClick={() => dialog.current?.close()}>×</button></header>
      <p>{selected && descriptions[selected]}</p>
      {(selected === "photos" || selected === "family") && <button onClick={() => { dialog.current?.close(); navigate("apps"); }}>查看已安装应用</button>}
      {selected === "knowledge" && <button onClick={() => { dialog.current?.close(); navigate("jarvis"); }}>打开 Jarvis</button>}
    </dialog></>;
}
