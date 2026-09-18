import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Gateway } from "./gateway";
import { randomUUID } from "./uuid";
import { Blocks, labels } from "./blocks";
import type {
  ViewSpec,
  Resource,
} from "../../../packages/ui-protocol/src/index";
import { viewSchema } from "../../../packages/ui-protocol/src/index";
import "./style.css";
import "./product.css";
import { ProductHome, SpaceCards, Empty, ApplicationList } from "./product";
import { WorkspacePanel } from "./workspace-panel";
import { DynamicView, webRenderer } from "./dynamic-v2";
import { NavigationIcon } from "./icons";
import { ProductTasks } from "./tasks";
import { ControlPlanePanel } from "./control-plane-panel";
const gateway = new Gateway();
const nav = [
  ["home", "首页"],
  ["spaces", "空间"],
  ["apps", "应用"],
  ["tasks", "任务"],
  ["jarvis", "Jarvis"],
  ["system", "系统"],
];
function MarkdownContent({ value }: { value: string }) {
  const lines = value.split("\n");
  const nodes: React.ReactNode[] = [];
  const inline = (line: string): React.ReactNode[] => {
    const result: React.ReactNode[] = [];
    const token = /(`[^`\n]+`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_))/g;
    let last = 0; let match: RegExpExecArray | null; let key = 0;
    while ((match = token.exec(line))) {
      if (match.index > last) result.push(line.slice(last, match.index));
      if (match[0].startsWith("`")) result.push(<code key={key++}>{match[0].slice(1, -1)}</code>);
      else if (match[3]) result.push(<a key={key++} href={match[3]} target="_blank" rel="noreferrer">{match[2]}</a>);
      else if (match[4] || match[5]) result.push(<strong key={key++}>{match[4] ?? match[5]}</strong>);
      else result.push(<em key={key++}>{match[6] ?? match[7]}</em>);
      last = match.index + match[0].length;
    }
    if (last < line.length) result.push(line.slice(last));
    return result;
  };
  const tableCells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      const start = i++; const code: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      if (i < lines.length) i++;
      nodes.push(<pre key={`code-${start}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const row = tableCells(lines[i++]);
        if (!row.every((cell) => /^:?-{3,}:?$/.test(cell))) rows.push(row);
      }
      if (rows.length) nodes.push(<table key={`table-${i}`}><thead><tr>{rows[0].map((cell, j) => <th key={j}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, r) => <tr key={r}>{row.map((cell, j) => <td key={j}>{inline(cell)}</td>)}</tr>)}</tbody></table>);
      continue;
    }
    if (!line.trim()) { nodes.push(<div className="markdown-break" key={`break-${i++}`} />); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    if (heading) { const Tag = (`h${heading[1].length}`) as "h1" | "h2" | "h3"; nodes.push(<Tag key={`heading-${i}`}>{inline(heading[2])}</Tag>); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = []; const start = i;
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      nodes.push(<blockquote key={`quote-${start}`}>{quote.map((part, j) => <p key={j}>{inline(part)}</p>)}</blockquote>); continue;
    }
    const list = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)/);
    if (list) {
      const ordered = /^\d/.test(list[1]); const items: string[] = []; const start = i;
      while (i < lines.length) { const item = lines[i].match(/^\s*([-+*]|\d+[.)])\s+(.+)/); if (!item || /^\d/.test(item[1]) !== ordered) break; items.push(item[2]); i++; }
      const Tag = ordered ? "ol" : "ul"; nodes.push(<Tag key={`list-${start}`}>{items.map((item, j) => <li key={j}>{inline(item)}</li>)}</Tag>); continue;
    }
    const paragraph: string[] = []; const start = i;
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^#{1,3}\s+/.test(lines[i]) && !/^\s*>\s?/.test(lines[i]) && !/^\s*([-+*]|\d+[.)])\s+/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) paragraph.push(lines[i++]);
    nodes.push(<p key={`paragraph-${start}`}>{inline(paragraph.join(" "))}</p>);
  }
  return <>{nodes}</>;
}
function restoredNavigation() {
  try {
    const path = location.pathname.split("/").filter(Boolean);
    if (path[0] === "tasks" && /^[a-f0-9-]{36}$/.test(path[1] ?? "")) return { page: "run", runId: path[1], selected: undefined };
    if (nav.some(([key]) => key === path[0])) return { page: path[0], runId: undefined, selected: undefined };
    const value = JSON.parse(
      sessionStorage.getItem("jarvis-navigation") ?? "{}",
    );
    const uuid = (v: unknown) =>
      typeof v === "string" && /^[a-f0-9-]{36}$/.test(v) ? v : undefined;
    return {
      page: [...nav.map((n) => n[0]), "run"].includes(value.page)
        ? value.page
        : "home",
      selected: uuid(value.selected),
      runId: uuid(value.runId),
    };
  } catch {
    return { page: "home", selected: undefined, runId: undefined };
  }
}
function App() {
  const viewRequest = useRef(0);
  const [theme, setTheme] = useState(() => localStorage.getItem("jarvis-theme") === "light" ? "light" : "dark");
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("jarvis-theme", theme); }, [theme]);
  const [paired, setPaired] = useState(false),
    [code, setCode] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [inviteToken, setInviteToken] = useState(""),
    [loginMode, setLoginMode] = useState(false),
    [inviteMode, setInviteMode] = useState(false),
    [error, setError] = useState(""),
    [connection, setConnection] = useState("连接中"),
    [page, setPage] = useState(() => restoredNavigation().page),
    [conversations, setConversations] = useState<any[]>([]),
    [conversation, setConversation] = useState<any>(),
    [selected, setSelected] = useState<string | undefined>(
      () => restoredNavigation().selected,
    ),
    [view, setView] = useState<ViewSpec>(),
    [semantic, setSemantic] = useState<any>(),
    [applications, setApplications] = useState<any>(),
    [resources, setResources] = useState(new Map<string, Resource>()),
    [toolStates, setToolStates] = useState<Record<string, Record<string, { capability: string; status: "running" | "completed" }>>>({}),
    [workspaceTarget, setWorkspaceTarget] = useState<string>(),
    [agents, setAgents] = useState<any>(),
    [text, setText] = useState(""),
    [sending, setSending] = useState(false),
    [runId, setRunId] = useState<string | undefined>(
      () => restoredNavigation().runId,
    );
  useEffect(() => {
    sessionStorage.setItem(
      "jarvis-navigation",
      JSON.stringify({ page, selected, runId }),
    );
  }, [page, selected, runId]);
  useEffect(() => {
    if (!paired) return;
    const path = page === "run" && runId ? `/tasks/${runId}` : `/${page}`;
    if (location.pathname !== path) history.pushState(null, "", path);
  }, [paired, page, runId]);
  useEffect(() => {
    const restore = () => { const next = restoredNavigation(); setPage(next.page); setRunId(next.runId); };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const fail = (e: any) => setError(e.message ?? String(e));
  const openApp = useCallback(async (appId: string) => {
    try {
      const resolved = await gateway.request("app.resolve", { app_id: appId === "homeassistant" ? "home-assistant" : appId, platform: "web" });
      const link = resolved.link?.primary ?? resolved.link?.fallback;
      if (link) window.open(link, "_blank", "noopener,noreferrer");
      else setError("该应用尚未配置可用链接");
    } catch (e) { fail(e); }
  }, []);
  const loadView = useCallback(async (spec: ViewSpec, request = ++viewRequest.current) => {
    if (request !== viewRequest.current) return;
    setSemantic(undefined);
    sessionStorage.setItem("jarvis-view", JSON.stringify(spec));
    setView(spec);
    await Promise.all(
      [
        ...new Set(
          spec.blocks.flatMap((b) => (b.resource ? [b.resource] : [])),
        ),
      ].map((n) => gateway.resource(n)),
    );
    setResources(new Map(gateway.resources));
  }, []);
  const show = useCallback(
    async (intent: string, rs: string[] = []) => {
      const request = ++viewRequest.current;
      setSemantic(undefined);
      const next = await gateway.request("view.v2.get", { intent: { type: "view.show", intent, resources: rs }, renderer: webRenderer }).catch(() => null);
      const v = await gateway.request("view.show", {
        type: "view.show",
        intent,
        resources: rs,
      });
      if (request !== viewRequest.current) return;
      await loadView(v.spec, request);
      if (request === viewRequest.current && next?.kind === "view") setSemantic(next.view);
    },
    [loadView],
  );
  const snapshot = useCallback(async () => {
    if (page === "home" || page === "apps") setApplications(await gateway.request("application.list").catch(() => ({ status: "unavailable", apps: [] })));
    setConversations(await gateway.request("conversation.list"));
    setAgents(await gateway.request("agent.definition.list"));
    if (selected)
      setConversation(
        await gateway.request("conversation.get", {
          conversation_id: selected,
        }),
      );
    if (runId) await show("agent_run_analysis", ["agent-run/" + runId]);
    else if (page === "home" || page === "server" || page === "system")
      await show("system_overview");
    else if (page === "ai") await show("usage_analysis");
    else if (page === "workspace") {
      const saved = viewSchema.safeParse(
        JSON.parse(sessionStorage.getItem("jarvis-view") ?? "null"),
      );
      if (saved.success) await loadView(saved.data);
    }
  }, [selected, runId, page, show, loadView]);
  useEffect(() => {
    const p = sessionStorage.getItem("jarvis-pending");
    if (p) {
      try {
        const pending = JSON.parse(p);
        setSelected(pending.conversation_id);
        setText(pending.content);
      } catch {
        sessionStorage.removeItem("jarvis-pending");
      }
    }
    fetch("/api/v2/session").then(async (r) => {
      if (!r.ok) { const refreshed = await fetch("/api/v2/auth/refresh", { method: "POST", credentials: "include" }); if (!refreshed.ok) return; r = await fetch("/api/v2/session"); }
      if (r.ok) { setPaired(true); gateway.open(); }
    }).catch(fail);
    return () => gateway.close();
  }, []);
  useEffect(() => {
    const listen = (name: string, fn: (e: any) => void) => {
      gateway.addEventListener(name, fn);
      return () => gateway.removeEventListener(name, fn);
    };
    const disposers = [
      listen("connection", (e) => {
        setConnection(e.detail);
        // A reload can complete the WebSocket handshake before the snapshot
        // listener effect is attached; every confirmed connection therefore
        // performs an idempotent state refresh.
        if (e.detail === "已连接") void snapshot().catch(fail);
      }),
      listen("snapshot", () => void snapshot().catch(fail)),
      listen("conversation.updated", () => {
        void (async () => {
          setConversations(await gateway.request("conversation.list"));
          if (selected)
            setConversation(
              await gateway.request("conversation.get", {
                conversation_id: selected,
              }),
            );
        })().catch(fail);
      }),
      listen("conversation.tool.started", (e) => {
        const p = e.detail;
        if (!p?.conversation_id || !p?.tool_call_id) return;
        setToolStates((old) => ({
          ...old,
          [p.conversation_id]: {
            ...(old[p.conversation_id] ?? {}),
            [p.tool_call_id]: { capability: String(p.capability ?? "tool"), status: "running" },
          },
        }));
      }),
      listen("conversation.tool.completed", (e) => {
        const p = e.detail;
        if (!p?.conversation_id || !p?.tool_call_id) return;
        setToolStates((old) => ({
          ...old,
          [p.conversation_id]: {
            ...(old[p.conversation_id] ?? {}),
            [p.tool_call_id]: { capability: String(p.capability ?? "tool"), status: "completed" },
          },
        }));
      }),
      listen("conversation.message.delta", (e) => {
        if (e.detail.conversation_id === selected)
          setConversation((old: any) =>
            old
              ? {
                  ...old,
                  messages: old.messages.map((m: any) =>
                    m.id === e.detail.message_id &&
                    Number(m.revision ?? 0) < e.detail.revision
                      ? {
                          ...m,
                          content: e.detail.content,
                          revision: e.detail.revision,
                        }
                      : m,
                  ),
                }
              : old,
          );
      }),
      listen("resource.updated", () =>
        setResources(new Map(gateway.resources)),
      ),
      listen("agent.run.updated", () => {
        void (async () => {
          setAgents(await gateway.request("agent.definition.list"));
          if (runId) await show("agent_run_analysis", ["agent-run/" + runId]);
        })().catch(fail);
      }),
    ];
    if (gateway.socket?.readyState === 1) void snapshot().catch(fail);
    return () => disposers.forEach((d) => d());
  }, [snapshot, selected, runId, page]);
  async function action(a: any) {
    try {
      if (a.type === "run.open") {
        setRunId(a.target);
        setPage("run");
      } else {
        const result = await gateway.request("ui.action.invoke", a);
        if (a.type === "app.open") {
          const link = result?.link?.primary ?? result?.link?.fallback;
          if (link) window.open(link, "_blank", "noopener,noreferrer");
        }
        await snapshot();
      }
    } catch (e) {
      fail(e);
    }
  }
  async function send() {
    if (sending || !text.trim()) return;
    setSending(true);
    setError("");
    const content = text;
    try {
      let id = selected;
      if (!id) {
        const c = await gateway.request("conversation.create", {
          title: content.slice(0, 40),
        });
        id = c.id;
        setSelected(id);
      }
      const existing = sessionStorage.getItem("jarvis-pending");
      const pending = existing
        ? JSON.parse(existing)
        : {
            conversation_id: id,
            content,
            idempotency_key: randomUUID(),
          };
      if (pending.conversation_id !== id || pending.content !== content)
        throw Error("上一条提交未确认，请保持原消息重试");
      sessionStorage.setItem("jarvis-pending", JSON.stringify(pending));
      await gateway.request("conversation.message", pending);
      sessionStorage.removeItem("jarvis-pending");
      setText("");
      setConversation(
        await gateway.request("conversation.get", { conversation_id: id }),
      );
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
    }
  }
  if (!paired)
    return (
      <main className="pair">
        <div className="orb">J</div>
        <p className="eyebrow">YOUR PERSONAL CLOUD</p>
        <h1>连接 Jarvis</h1>
        <p className="muted">{inviteMode ? "使用管理员发放的一次性邀请加入。" : loginMode ? "使用 Jarvis 账户登录。" : "使用一次性配对码，连接你的私人云。"}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const endpoint = inviteMode ? "/api/v2/auth/invites/accept" : loginMode ? "/api/v2/auth/login" : "/api/v1/pair";
            const browserDeviceId = localStorage.getItem("jarvis-device-id") ?? randomUUID();
            localStorage.setItem("jarvis-device-id", browserDeviceId);
            const body = inviteMode ? { token: inviteToken.trim(), password } : loginMode ? { username: username.trim(), password, device_id: browserDeviceId } : { device_id: randomUUID(), code: code.trim() };
            void fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
              .then(async (r) => {
                if (!r.ok) throw Error(inviteMode ? "邀请无效或已过期" : loginMode ? "登录失败，请检查用户名和密码" : "配对失败，请检查配对码");
                if (inviteMode) {
                  const accepted = await r.json();
                  const loggedIn = await fetch("/api/v2/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: accepted.username, password, device_id: browserDeviceId }) });
                  if (!loggedIn.ok) throw Error("成员已创建，但自动登录失败");
                }
                setPaired(true);
                setCode("");
                setPassword("");
                setInviteToken("");
                gateway.open();
              })
              .catch(fail);
          }}
        >
          {inviteMode ? <><input aria-label="邀请令牌" value={inviteToken} onChange={(e) => setInviteToken(e.target.value)} placeholder="一次性邀请令牌" /><input aria-label="设置密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="设置密码（至少 12 位）" /></> : loginMode ? <><input aria-label="用户名" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名" /><input aria-label="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" /></> : <input aria-label="配对码" type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="一次性配对码" />}
          <button>{inviteMode ? "接受邀请并登录" : loginMode ? "登录" : "配对并连接"}</button>
        </form>
        <div className="auth-switches"><button className="quiet" onClick={() => { setLoginMode(!loginMode); setInviteMode(false); }}>{loginMode ? "使用配对码" : "使用用户名密码"}</button><button className="quiet" onClick={() => { setInviteMode(!inviteMode); setLoginMode(false); }}>{inviteMode ? "返回登录" : "接受成员邀请"}</button></div>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <div className={`shell page-${page}`}>
      <aside>
        <a className="brand" onClick={() => setPage("home")}>
          ◈ JARVIS
        </a>
        <p className="eyebrow">Your Personal AI Cloud</p>
        <nav>
          {nav.map(([key, label]) => (
            <button
              className={page === key || (page === "run" && key === "tasks") ? "selected" : ""}
              aria-current={page === key || (page === "run" && key === "tasks") ? "page" : undefined}
              key={key}
              onClick={() => {
                setPage(key);
                setRunId(undefined);
              }}
            >
              <NavigationIcon name={key} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="connection">
          <i />
          {connection}
        </div>
        <button className="theme-toggle quiet" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}>{theme === "dark" ? "☀ 浅色外观" : "☾ 深色外观"}</button>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">JARVIS / PERSONAL CLOUD</p>
            <h1>
              {page === "run" ? "任务详情" : page === "workspace" ? "动态工作空间" : page === "home" ? "我的私人云" : nav.find(([k]) => k === page)?.[1]}
            </h1>
          </div>
          <button className="quiet" onClick={() => void snapshot().catch(fail)}>
            刷新
          </button>
          <ControlPlanePanel gateway={gateway} onError={fail} />
        </header>
        {error && (
          <div className="alert" role="alert">
            {error}
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {page === "home" ? <ProductHome applications={applications} system={resources.get("system/status")?.data} runs={agents?.runs ?? []} conversations={conversations}
          navigate={(next, id) => { setPage(next); setRunId(next === "run" ? id : undefined); if (next === "jarvis" && id) setSelected(id); }}
          ask={(prompt) => { setText(prompt); setRunId(undefined); setPage("jarvis"); }} />
        : page === "spaces" ? <><p className="muted">你的文件、照片与想法，汇聚一处。</p><SpaceCards navigate={setPage} /><Empty title="选择你想探索的空间" text="空间内容将在对应数据服务连接后显示。" /></>
        : page === "apps" ? <ApplicationList value={applications} openApp={(id) => void openApp(id)} ask={(prompt) => { setText(prompt); setPage("jarvis"); }} />
        : page === "tasks" ? <ProductTasks runs={agents?.runs ?? []} open={(id) => void action({ type: "run.open", target: id })} />
        : page === "jarvis" || page === "workspace" ? (
          <div className={`conversation-layout ${page === "workspace" ? "with-workspace" : ""}`}>
            <div className="conversation-list">
              <button
                onClick={() => {
                  setWorkspaceTarget(undefined);
                  setSelected(undefined);
                  setConversation(undefined);
                }}
              >
                ＋ 新会话
              </button>
              {conversations.map((c) => (
                <button
                  className={c.id === selected ? "selected" : ""}
                  key={c.id}
                  onClick={() => { setWorkspaceTarget(undefined); setSelected(c.id); }}
                >
                  {c.title}
                </button>
              ))}
            </div>
            <div className="chat">
              <div className="messages">
                {!conversation && (
                  <div className="welcome">
                    <div className="orb">J</div>
                    <h2>今天需要我做什么？</h2>
                    <p>查看服务器状态，分析用量，或委派代码任务。</p>
                  </div>
                )}
                {conversation?.messages.map((m: any) => (
                  <article className={"message " + m.role} key={m.id}>
                    <small>
                      {m.role === "user" ? "你" : "Jarvis"} ·{" "}
                      {labels[m.status] ?? m.status}
                    </small>
                    <div className="prose">{m.content ? <MarkdownContent value={m.content} /> : "正在处理…"}</div>
                    {m.role === "jarvis" && selected && Object.values(toolStates[selected] ?? {}).length > 0 && <div className="rich-card tool-status-card"><strong>执行状态</strong>{Object.values(toolStates[selected]).map((tool) => <span key={tool.capability} className={tool.status}>{tool.capability} · {tool.status === "running" ? "运行中" : "已完成"}</span>)}</div>}
                    {m.run_id && (
                      <button
                        onClick={() =>
                          action({ type: "run.open", target: m.run_id })
                        }
                      >
                        查看任务 →
                      </button>
                    )}
                    {m.view_id && (
                      <button
                        onClick={() =>
                          void gateway
                            .request("view.get", { view_id: m.view_id })
                            .then((v) => {
                              setPage("workspace");
                              return loadView(v.spec);
                            })
                            .catch(fail)
                        }
                      >
                        查看图表
                      </button>
                    )}
                    {m.workspace_id && <button onClick={() => { setWorkspaceTarget(m.workspace_id); setPage("workspace"); }}>打开工作区 →</button>}
                  </article>
                ))}
              </div>
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <textarea
                  aria-label="消息"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="向 Jarvis 发送消息…"
                />
                <button disabled={sending || connection !== "已连接"}>
                  {sending ? "提交中…" : "发送 ↑"}
                </button>
              </form>
            </div>
            {page === "workspace" && <aside className="workspace-side">
              <div className="toolbar">
                <button onClick={() => void show("usage_analysis").catch(fail)}>用量分析</button>
                <button onClick={() => void show("network_overview").catch(fail)}>服务器网络</button>
                <button onClick={() => void show("system_overview").catch(fail)}>系统趋势</button>
              </div>
              <WorkspacePanel gateway={gateway} conversationId={selected} workspaceId={workspaceTarget} fallbackView={semantic ? <DynamicView value={semantic} action={action} liveResources={resources} /> : view ? <Blocks view={view} resources={resources} action={action} /> : undefined} onError={fail} />
            </aside>}
          </div>
        ) : page === "agents" ? (
          <>
            <section className="agent-tier">
              <p className="eyebrow">CORE</p>
              <h2>◈ Jarvis</h2>
              <p>对话、委派与结果汇总</p>
            </section>
            <h2>领域智能体</h2>
            <div className="blocks">
              {agents?.definitions
                .filter((d: any) => d.tier === "managed")
                .map((d: any) => (
                  <section className="block" key={d.id}>
                    <h3>{d.name}</h3>
                    <p>
                      {d.role === "coding" ? "隔离代码执行" : "只读运维分析"}
                    </p>
                    <small>{d.runtime_type}</small>
                  </section>
                ))}
            </div>
            <h2>执行实例与任务</h2>
            {agents?.runs.map((r: any) => (
              <button
                className="run-row"
                data-testid={`run-${r.id}`}
                key={r.id}
                onClick={() => action({ type: "run.open", target: r.id })}
              >
                <span>{r.goal}</span>
                <small>
                  {r.agent_id} · {labels[r.status]}
                </small>
              </button>
            ))}
          </>
        ) : (
          <>
            {semantic ? <DynamicView value={semantic} action={action} liveResources={resources} /> : view && (
              <Blocks view={view} resources={resources} action={action} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
