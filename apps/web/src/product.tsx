import { useState, useRef, useEffect, type CSSProperties } from "react";
import { labels } from "./blocks";

export function Orb({ small = false }: { small?: boolean }) {
  return <span aria-hidden="true" className={`jarvis-orb ${small ? "small" : ""}`} />;
}

export function HermesConsole() {
  return <section className="product-panel hermes-console">
    <div>
      <p className="eyebrow">HERMES AGENT</p>
      <h2>模型、技能与 MCP</h2>
      <p className="muted">会话、模型、技能与 MCP 使用 Hermes 官方界面管理，打开后会继续使用当前 Jarvis 登录状态。</p>
    </div>
    <a href="/hermes-dashboard/" target="_blank" rel="noopener noreferrer">打开 Hermes 控制台 <span aria-hidden="true">↗</span></a>
  </section>;
}

const spaceMeta: Record<string, { title: string; caption: string; index: string }> = {
  photos: { title: "照片", caption: "在 Immich 中打开", index: "01" },
  files: { title: "文件", caption: "尚未接入", index: "02" },
  knowledge: { title: "知识", caption: "尚未接入", index: "03" },
  family: { title: "家庭", caption: "在 Home Assistant 中打开", index: "04" },
  media: { title: "媒体", caption: "尚未接入", index: "05" },
  development: { title: "开发", caption: "查看任务", index: "06" },
};

function SpaceArt({ kind }: { kind: string }) {
  const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.15, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return <svg className="space-art" viewBox="0 0 320 200" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
    {kind === "photos" && <>
      <circle cx="242" cy="58" r="27" {...line} opacity=".62" />
      <circle cx="242" cy="58" r="3.5" fill="currentColor" stroke="none" opacity=".8" />
      <path d="M-10 154 L58 100 L104 136 L162 82 L222 142 L278 110 L330 148" {...line} opacity=".5" />
      <path d="M-10 176 H330" {...line} opacity=".2" />
    </>}
    {kind === "files" && <>
      <rect x="196" y="34" width="86" height="118" rx="10" {...line} opacity=".32" transform="rotate(7 239 93)" />
      <rect x="170" y="44" width="86" height="118" rx="10" {...line} opacity=".45" transform="rotate(3 213 103)" />
      <rect x="142" y="54" width="86" height="118" rx="10" {...line} opacity=".7" />
      <path d="M160 78 H210 M160 94 H196 M160 110 H204" {...line} opacity=".42" />
    </>}
    {kind === "knowledge" && <>
      <circle cx="160" cy="100" r="62" {...line} opacity=".22" />
      <circle cx="160" cy="100" r="43" {...line} opacity=".34" />
      <circle cx="160" cy="100" r="24" {...line} opacity=".55" />
      <circle cx="160" cy="100" r="3.5" fill="currentColor" stroke="none" opacity=".9" />
      <path d="M160 24 V44 M160 156 V176 M84 100 H104 M216 100 H236" {...line} opacity=".3" />
    </>}
    {kind === "family" && <>
      <path d="M108 96 L160 56 L212 96 V158 H108 Z" {...line} opacity=".65" />
      <path d="M143 158 V120 H177 V158" {...line} opacity=".45" />
      <path d="M88 164 H232" {...line} opacity=".22" />
      <circle cx="160" cy="38" r="3" fill="currentColor" stroke="none" opacity=".8" />
    </>}
    {kind === "media" && <>
      <path d="M104 132 V112 M122 144 V84 M140 124 V100 M158 156 V62 M176 132 V96 M194 144 V82 M212 120 V108" {...line} opacity=".62" strokeWidth="3" />
      <path d="M86 172 H234" {...line} opacity=".2" />
    </>}
    {kind === "development" && <>
      <path d="M124 76 L92 100 L124 124 M196 76 L228 100 L196 124" {...line} opacity=".62" />
      <path d="M174 62 L146 138" {...line} opacity=".45" />
      <path d="M86 160 H234" {...line} opacity=".2" />
      <circle cx="160" cy="100" r="46" {...line} opacity=".14" />
    </>}
  </svg>;
}

export function ProductHome({ system, runs, conversations, navigate, ask, applications, openApp, onCasaosLogin, problem }: {
  applications?: any; openApp?: (id: string) => void; onCasaosLogin?: (username: string, password: string) => Promise<void>; problem?: boolean;
  system: any; runs: any[]; conversations: any[]; navigate: (page: string, id?: string) => void; ask: (prompt: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const running = runs.filter((r) => ["queued", "starting", "running", "waiting_for_user", "waiting_for_approval"].includes(r.status));
  const metrics: [string, unknown][] = [["CPU", system?.cpu?.usage_percent], ["内存", system?.memory?.usage_percent], ["存储", system?.disks?.[0]?.usage_percent]];
  const online = system ? system.jarvis?.server_status === "healthy" && !problem && applications?.status === "ready" : undefined;
  return <div className="product-home">
    <section className="home-hero">
      <div className="hero-copy">
        <p className="eyebrow"><span className={`hero-live${online === false ? " warning" : ""}`} aria-hidden="true" /> YOUR PRIVATE CLOUD</p>
        <h1>让科技，回归生活<span className="hero-period">。</span></h1>
        <p className="hero-sub">{online === undefined ? "正在连接你的私人云…" : online ? "服务器在线，应用状态已同步" : "你的私人云有状态需要关注"}<span className="hero-sep" aria-hidden="true">·</span>{running.length ? `${running.length} 个任务进行中` : "此刻一切安静"}</p>
        <form className="command-bar" onSubmit={(e) => { e.preventDefault(); if (prompt.trim()) ask(prompt); }}>
          <Orb small /><input aria-label="问 Jarvis" placeholder="问 Jarvis，或描述你想做的事…" value={prompt} onChange={(e) => setPrompt(e.target.value)} /><button aria-label="发送给 Jarvis" disabled={!prompt.trim()}>↑</button>
        </form>
        <div className="suggestions">{["看看家里的近况", "分析最近的任务", "帮我整理一个工作计划"].map((p) => <button key={p} onClick={() => ask(p)}>{p}<span aria-hidden="true">↗</span></button>)}</div>
      </div>
      <div className="hero-scene" aria-hidden="true">
        <span className="hero-orbit one" />
        <span className="hero-orbit two" />
        <span className="hero-horizon" />
        <span className="hero-orb" />
        <span className="hero-signature">More Life<span>Less Work</span></span>
      </div>
    </section>

    <section className="home-status" aria-label="关键状态">
      <div className="status-label"><span className="status-pulse" aria-hidden="true" />系统状态</div>
      {metrics.map(([name, value]) => <div className="status-metric" key={name}>
        <div><span>{name}</span><strong>{typeof value === "number" ? `${value.toFixed(0)}%` : "—"}</strong></div>
        <span className="status-bar"><span style={{ width: `${typeof value === "number" ? Math.max(0, Math.min(100, value)) : 0}%` }} /></span>
      </div>)}
      <button className="status-tasks" onClick={() => navigate("tasks")}>
        <span>{running.length ? "Jarvis 正在工作" : "队列空闲"}</span>
        <strong>{running.length}<small> 个任务</small></strong>
        <span aria-hidden="true">→</span>
      </button>
    </section>

    <section className="home-section">
      <div className="section-heading"><h2>我的空间</h2><button className="quiet" onClick={() => navigate("spaces")}>全部空间 <span aria-hidden="true">↗</span></button></div>
      <SpaceCards navigate={navigate} openApp={openApp} />
    </section>

    <section className="home-section home-applications">
      <div className="section-heading"><h2>我的应用</h2><button className="quiet" onClick={() => navigate("apps")}>应用中心 <span aria-hidden="true">↗</span></button></div>
      <ApplicationList value={applications} ask={ask} openApp={openApp} onCasaosLogin={onCasaosLogin} />
    </section>

    <div className="home-bottom">
      <section className="home-panel">
        <div className="section-heading"><h2>当前任务</h2><button className="quiet" onClick={() => navigate("tasks")}>查看全部 <span aria-hidden="true">→</span></button></div>
        {running.length ? running.slice(0, 3).map((r) => <button className="run-row" key={r.id} onClick={() => navigate("run", r.id)}><span>{r.goal}</span><small>{labels[r.status]}</small></button>) : <Empty title="现在没有进行中的任务" text="有想做的事，随时告诉 Jarvis。" />}
      </section>
      <section className="home-panel">
        <div className="section-heading"><h2>最近对话</h2><button className="quiet" onClick={() => navigate("jarvis")}>打开 Jarvis <span aria-hidden="true">→</span></button></div>
        {conversations.length ? conversations.slice(0, 4).map((c) => <button className="activity-row" key={c.id} onClick={() => navigate("jarvis", c.id)}><span className="activity-dot" aria-hidden="true" /><span>{c.title}</span><span aria-hidden="true">↗</span></button>) : <Empty title="从一次对话开始" text="你的对话与任务进展会汇集在这里。" />}
      </section>
    </div>

    <HermesConsole />
  </div>;
}

type Application = { id: string; name: string; status: string; description?: string; service_count?: number | null };

const appGlyphs: Record<string, { glyph: string; color: string }> = {
  homeassistant: { glyph: "homeassistant", color: "#2ec5f2" },
  immich: { glyph: "immich", color: "#8f97ff" },
  immichframe: { glyph: "frame", color: "#e0c8a2" },
  jellyfin: { glyph: "jellyfin", color: "#22a9dd" },
  qbittorrent: { glyph: "qbittorrent", color: "#6f9bea" },
  mosquitto: { glyph: "mosquitto", color: "#b28ee4" },
  authentik: { glyph: "authentik", color: "#f07453" },
  jarvis: { glyph: "jarvis", color: "#e6bc7c" },
};

function appIdentity(app: Application) {
  const haystack = `${app.id} ${app.name}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (haystack.includes("authentik")) return appGlyphs.authentik;
  if (haystack.includes("immichframe")) return appGlyphs.immichframe;
  for (const key of Object.keys(appGlyphs)) if (haystack.includes(key)) return appGlyphs[key];
  return undefined;
}

function AppIcon({ app }: { app: Application }) {
  const identity = appIdentity(app);
  if (identity) return <span className="application-icon" aria-hidden="true" style={{ "--app-color": identity.color } as CSSProperties}>
    <img src={`/app-icons/glyphs/${identity.glyph}.svg`} alt="" />
  </span>;
  return <span className="application-icon monogram" aria-hidden="true">{app.name.trim().slice(0, 1).toUpperCase()}</span>;
}

const appState: Record<string, string> = { running: "运行中", stopped: "已停止" };

export function ApplicationList({ value, openApp, ask, onCasaosLogin }: { value?: { status: string; apps: Application[]; launchers?: { id: string; name: string; url: string }[] }; openApp?: (appId: string) => void; ask?: (prompt: string) => void; onCasaosLogin?: (username: string, password: string) => Promise<void> }) {
  const [selected, setSelected] = useState<string>();
  const [loginOpen, setLoginOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
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
    return <div role="status"><Empty title={title} text={text} />{value?.status === "authentication_required" && onCasaosLogin && <><button onClick={async () => { setLoginError(""); const result = await fetch("/api/v2/integrations/casaos", { credentials: "include" }); if (result.ok) setUsername((await result.json()).username ?? ""); setLoginOpen(true); }}>重新连接 CasaOS</button><dialog open={loginOpen} className="application-detail" aria-labelledby="casaos-login-title"><form onSubmit={async (event) => { event.preventDefault(); setLoggingIn(true); setLoginError(""); try { await onCasaosLogin(username, password); setLoginOpen(false); setPassword(""); } catch (error) { setLoginError(error instanceof Error ? error.message : "CasaOS 登录失败"); } finally { setLoggingIn(false); } }}><header><h2 id="casaos-login-title">连接 CasaOS</h2><button type="button" aria-label="关闭 CasaOS 登录" onClick={() => setLoginOpen(false)}>×</button></header><p className="muted">输入 CasaOS 账号完成连接。密码只用于本次登录，不会显示在 Jarvis 页面或保存到浏览器。</p><label>CasaOS 用户名<input aria-label="CasaOS 用户名" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label><label>CasaOS 密码<input aria-label="CasaOS 密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>{loginError && <p role="alert">{loginError}</p>}<button disabled={loggingIn || !username || !password}>{loggingIn ? "连接中…" : "登录并连接"}</button></form></dialog></>}{<p className="muted">应用列表连接异常不会影响你直接使用原应用。</p>}<div className="toolbar">{value?.launchers?.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer">打开 {item.name} ↗</a>)}</div></div>;
  }
  if (!value.apps.length) return <Empty title="还没有安装应用" text="CasaOS 已连接，当前没有已安装应用。" />;
  const online = value.apps.filter((item) => item.status === "running").length;
  return <><div className="application-summary"><span>{value.apps.length} 个应用</span><span>{online} 个运行中</span><span>CasaOS</span></div><div className="application-grid">{value.apps.map((item) => <button className="application-card" key={item.id} onClick={() => setSelected(item.id)} aria-label={`查看 ${item.name} 详情`}>
    <AppIcon app={item} />
    <span className="application-name"><h3>{item.name}</h3><small>CasaOS</small></span>
    <span className={`application-status ${item.status}`}>{appState[item.status] ?? "状态未知"}</span>
  </button>)}</div><dialog ref={dialog} className="application-detail" aria-labelledby="application-detail-title" onClose={() => setSelected(undefined)}>
      {app && <><header><div><p className="eyebrow">CASAOS APPLICATION</p><h2 id="application-detail-title">{app.name}</h2></div><button aria-label="关闭应用详情" onClick={() => dialog.current?.close()}>×</button></header>
        {app.description ? <details className="application-description"><summary>应用简介 · 来自 CasaOS</summary><p>{app.description}</p></details> : <p className="application-description">此应用未提供简介。</p>}
        <dl><div><dt>运行状态</dt><dd>{appState[app.status] ?? "状态未知"}</dd></div>
          <div><dt>应用服务</dt><dd>CasaOS</dd></div><div><dt>服务数量</dt><dd>{app.service_count ?? "未知"}</dd></div><div><dt>应用标识</dt><dd>{app.id}</dd></div></dl>
        <p className="muted">当前提供只读状态。启停、更新等操作尚未开放。</p></>}
      {app && ask && <button onClick={() => ask(`请读取并总结 ${app.name} 当前状态，同时告诉我下一步可以做什么。`)}>让 Jarvis 分析此应用 <span aria-hidden="true">✦</span></button>}
      {app && openApp && <button onClick={() => openApp(app.id)}>在应用中打开 <span aria-hidden="true">↗</span></button>}
    </dialog></>;
}
export function Empty({ title, text }: { title: string; text: string }) {
  return <div className="product-empty"><span aria-hidden="true">◇</span><h3>{title}</h3><p>{text}</p></div>;
}
export function SpaceCards({ navigate, openApp }: { navigate: (page: string) => void; openApp?: (id: string) => void }) {
  const [selected, setSelected] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const descriptions: Record<string, string> = {
    photos: "可在应用中心查看 Immich 的连接与运行状态。照片时间线、相册与搜索尚未接入此空间；这里的封面是装饰图，不是你的照片。",
    files: "文件浏览、上传与权限控制尚未接入。此处不会展示模拟文件或执行文件操作。",
    knowledge: "知识库与检索尚未接入。你的对话仍可在 Jarvis 中查看。",
    family: "可在应用中心查看 Home Assistant 的连接与运行状态。设备、房间与控制能力尚未接入此空间。",
    media: "影音库尚未接入。此处不会展示模拟媒体内容。",
    development: "开发空间会把任务与工作区集中在一起。当前可直接查看任务。",
  };
  useEffect(() => { if (selected) dialog.current?.showModal(); }, [selected]);
  return <><div className="space-grid">{Object.entries(spaceMeta).map(([key, meta]) =>
    <button key={key} className={`space-card space-${key}`} onClick={() => openApp && (key === "photos" || key === "family") ? openApp(key === "photos" ? "immich" : "homeassistant") : key === "development" ? navigate("tasks") : setSelected(key)}>
      <SpaceArt kind={key} />
      <span className="space-top"><span className="space-index">{meta.index}</span><span className="space-arrow" aria-hidden="true">↗</span></span>
      <span className="space-title">{meta.title}</span><span className="space-caption">{meta.caption}</span>
    </button>)}</div>
    <dialog ref={dialog} className="application-detail" aria-labelledby="space-detail-title" onClose={() => setSelected(undefined)}>
      <header><div><p className="eyebrow">SPACE</p><h2 id="space-detail-title">{selected ? spaceMeta[selected].title : "空间"}</h2></div><button aria-label="关闭空间详情" onClick={() => dialog.current?.close()}>×</button></header>
      <p>{selected && descriptions[selected]}</p>
      {(selected === "photos" || selected === "family") && <button onClick={() => { dialog.current?.close(); navigate("apps"); }}>查看已安装应用</button>}
      {selected === "knowledge" && <button onClick={() => { dialog.current?.close(); navigate("jarvis"); }}>打开 Jarvis</button>}
    </dialog></>;
}
