import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Gateway, ensureSession } from "./gateway";
import { randomUUID } from "./uuid";
import { Blocks, labels } from "./blocks";
import type {
  ViewSpec,
  Resource,
} from "../../../packages/ui-protocol/src/index";
import { viewSchema } from "../../../packages/ui-protocol/src/index";
import "./style.css";
import "./product.css";
import { ProductHome, SpaceCards, Empty, ApplicationList, HermesConsole } from "./product";
import { WorkspacePanel } from "./workspace-panel";
import { DynamicView, webRenderer } from "./dynamic-v2";
import { NavigationIcon } from "./icons";
import { ProductTasks } from "./tasks";
import { ControlPlanePanel } from "./control-plane-panel";
import { JarvisConversation } from "./jarvis-conversation";
import { SettingsPage } from "./settings";
const gateway = new Gateway();
const nav = [
  ["home", "首页"],
  ["spaces", "空间"],
  ["apps", "应用"],
  ["tasks", "任务"],
  ["jarvis", "Jarvis"],
  ["agents", "Hermes"],
  ["system", "系统"],
  ["settings", "设置"],
];
function restoredNavigation() {
  try {
    const path = location.pathname.split("/").filter(Boolean);
    const value = JSON.parse(sessionStorage.getItem("jarvis-navigation") ?? "{}");
    const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9-]{36}$/.test(v) ? v : undefined;
    if (path[0] === "tasks" && uuid(path[1])) return { page: "run", runId: path[1], selected: uuid(value.selected) };
    if (nav.some(([key]) => key === path[0]) || path[0] === "workspace") return { page: path[0], runId: undefined, selected: uuid(value.selected) };
    if (path[0] === "users") return { page: "settings", runId: undefined, selected: uuid(value.selected) };
    return {
      page: value.page === "users"
        ? "settings"
        : [...nav.map((n) => n[0]), "run", "workspace"].includes(value.page)
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
  const developerMode = new URLSearchParams(location.search).get("developer") === "1";
  const [theme, setTheme] = useState(() => localStorage.getItem("jarvis-theme") === "light" ? "light" : "dark");
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("jarvis-theme", theme); }, [theme]);
  const [paired, setPaired] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [passwordConfirmation, setPasswordConfirmation] = useState(""),
    [inviteToken, setInviteToken] = useState(""),
    [authMode, setAuthMode] = useState<"login" | "register" | "invite">("login"),
    [registrationOpen, setRegistrationOpen] = useState(false),
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
    [workspaceTarget, setWorkspaceTarget] = useState<string>(),
    [workspaceConversation, setWorkspaceConversation] = useState<string>(),
    [historyOpen, setHistoryOpen] = useState(false),
    [agents, setAgents] = useState<any>(),
    [text, setText] = useState(""),
    [runId, setRunId] = useState<string | undefined>(
      () => restoredNavigation().runId,
    );
  const fail = useCallback((e: any) => setError(e.message ?? String(e)), []);
  const onAssistantConversationCreated = useCallback((id: string) => {
    void Promise.all([
      gateway.request("conversation.list"),
      gateway.request("conversation.get", { conversation_id: id, developer: developerMode }),
    ]).then(([list, detail]) => {
      // Load the durable state before changing `selected`: changing the key
      // remounts JarvisConversation, so an empty detail here would temporarily
      // replace the streamed reply with a blank thread.
      setConversations(list);
      setConversation(detail);
      setSelected(id);
      setPage("jarvis");
    }).catch(fail);
  }, [developerMode, fail]);
  const deleteConversation = useCallback(async (id: string) => {
    const target = conversations.find((item) => item.id === id);
    if (!target || !window.confirm(`确定删除会话“${target.title}”吗？删除后无法恢复。`)) return;
    await gateway.request("conversation.delete", { conversation_id: id });
    setConversations((items) => items.filter((item) => item.id !== id));
    if (selected === id) {
      setSelected(undefined);
      setConversation(undefined);
      setWorkspaceTarget(undefined);
      setPage("jarvis");
    }
  }, [conversations, selected]);
  useEffect(() => {
    sessionStorage.setItem(
      "jarvis-navigation",
      JSON.stringify({ page, selected, runId }),
    );
  }, [page, selected, runId]);
  useEffect(() => {
    if (paired) return;
    void fetch("/api/v2/auth/registration", { credentials: "include" }).then((response) => response.ok ? response.json() : undefined).then((value) => setRegistrationOpen(value?.open === true)).catch(() => setRegistrationOpen(false));
  }, [paired]);
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
  useEffect(() => {
    if (!paired) return;
    const renew = () => void ensureSession().then((valid) => {
      if (valid) return;
      gateway.close();
      setPaired(false);
      setConnection("未登录");
    }).catch(fail);
    const timer = setInterval(renew, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [fail, paired]);
  const logout = useCallback(async () => {
    await fetch("/api/v2/auth/logout", { method: "POST", credentials: "include" });
    gateway.close();
    setPaired(false);
    setConnection("未登录");
    setConversation(undefined);
    setConversations([]);
    setSelected(undefined);
    setWorkspaceTarget(undefined);
    setError("");
    sessionStorage.removeItem("jarvis-navigation");
    sessionStorage.removeItem("jarvis-view");
  }, []);
  const openApp = useCallback(async (appId: string) => {
    const target = window.open("about:blank", "_blank");
    if (target) target.opener = null;
    try {
      const resolved = await gateway.request("app.resolve", { app_id: appId === "homeassistant" ? "home-assistant" : appId, platform: "web" });
      const link = resolved.link?.primary ?? resolved.link?.fallback;
      if (link) { if (target) target.location.replace(link); else location.assign(link); }
      else { target?.close(); setError("该应用尚未配置可用链接"); }
    } catch (e) { target?.close(); fail(e); }
  }, []);
  const reconnectCasaos = useCallback(async (username: string, password: string) => {
    const response = await fetch("/api/v2/integrations/casaos/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    if (!response.ok) throw Error(response.status === 401 ? "CasaOS 用户名或密码不正确" : response.status === 403 ? "只有 Jarvis 管理员可以连接 CasaOS" : "CasaOS 连接失败，请稍后重试");
    setApplications(await gateway.request("application.list"));
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
      if (request !== viewRequest.current) return;
      if (next?.kind === "view") {
        setSemantic(next.view);
        return;
      }
      const v = await gateway.request("view.show", {
        type: "view.show",
        intent,
        resources: rs,
      });
      if (request !== viewRequest.current) return;
      await loadView(v.spec, request);
    },
    [loadView],
  );
  const snapshot = useCallback(async () => {
    setError("");
    if (page === "home" || page === "apps") setApplications(await gateway.request("application.list").catch(() => ({ status: "unavailable", apps: [] })));
    setConversations(await gateway.request("conversation.list"));
    setAgents(await gateway.request("agent.definition.list"));
    if (selected)
      setConversation(
        await gateway.request("conversation.get", {
          conversation_id: selected,
          developer: developerMode,
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
  }, [selected, runId, page, show, loadView, developerMode]);
  useEffect(() => {
    fetch("/api/v2/session", { credentials: "include" }).then(async (r) => {
      if (!r.ok) { const refreshed = await fetch("/api/v2/auth/refresh", { method: "POST", credentials: "include" }); if (!refreshed.ok) return; r = await fetch("/api/v2/session"); }
      if (r.ok) { setPaired(true); void gateway.open(true); }
    }).catch(fail);
    return () => gateway.close();
  }, []);
  useEffect(() => {
    const listen = (name: string, fn: (e: any) => void) => {
      gateway.addEventListener(name, fn);
      return () => gateway.removeEventListener(name, fn);
    };
    const disposers = [
      listen("auth-required", () => { setPaired(false); setConversation(undefined); setConversations([]); setSelected(undefined); setWorkspaceTarget(undefined); gateway.resources.clear(); setResources(new Map()); sessionStorage.removeItem("jarvis-navigation"); sessionStorage.removeItem("jarvis-view"); }),
      listen("connection", (e) => {
        setConnection(e.detail);
        // A reload can complete the WebSocket handshake before the snapshot
        // listener effect is attached; every confirmed connection therefore
        // performs an idempotent state refresh.
        if (e.detail === "已连接") void snapshot().catch(fail);
      }),
      listen("conversation.updated", (event) => {
        void (async () => {
          setConversations(await gateway.request("conversation.list"));
          if (selected === event.detail.conversation_id) setConversation((old: any) => {
            if (!old) return old;
            const conversation = typeof event.detail.title === "string" ? { ...old.conversation, title: event.detail.title } : old.conversation;
            if (!Array.isArray(event.detail.messages)) return { ...old, conversation };
            const messages = new Map(old.messages.map((message: any) => [message.id, message]));
            for (const message of event.detail.messages) messages.set(message.id, message);
            return { ...old, conversation, messages: [...messages.values()].sort((a: any, b: any) => Number(a.sequence) - Number(b.sequence)) };
          });
        })().catch(fail);
      }),
      listen("conversation.deleted", (e) => {
        const id = e.detail?.conversation_id;
        if (typeof id !== "string") return;
        setConversations((items) => items.filter((item) => item.id !== id));
        if (selected === id) {
          setSelected(undefined);
          setConversation(undefined);
          setWorkspaceTarget(undefined);
          setPage("jarvis");
        }
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
      listen("conversation.status", (e) => {
        if (e.detail.conversation_id === selected) setConversation((old: any) => old ? { ...old, messages: old.messages.map((message: any) => message.id === e.detail.message_id ? { ...message, status: e.detail.status } : message) } : old);
      }),
      listen("conversation.result.updated", (e) => {
        if (e.detail.conversation_id === selected) setConversation((old: any) => old ? { ...old, results: [...(old.results ?? []).filter((result: any) => result.id !== e.detail.id), e.detail] } : old);
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
    const target = a.type === "app.open" ? window.open("about:blank", "_blank") : null;
    if (target) target.opener = null;
    try {
      if (a.type === "run.open") {
        setRunId(a.target);
        setPage("run");
      } else {
        const result = await gateway.request("ui.action.invoke", a);
        if (a.type === "app.open") {
          const link = result?.link?.primary ?? result?.link?.fallback;
          if (link) { if (target) target.location.replace(link); else location.assign(link); }
        }
        await snapshot();
      }
    } catch (e) {
      target?.close();
      fail(e);
    }
  }
  if (!paired) {
    const inviteMode = authMode === "invite";
    const registerMode = authMode === "register";
    return (
      <main className="pair">
        <div className="orb">J</div>
        <p className="eyebrow">YOUR PERSONAL CLOUD</p>
        <h1>{inviteMode ? "接受管理员邀请" : registerMode ? "注册 Jarvis" : "登录 Jarvis"}</h1>
        <p className="muted">{inviteMode ? "管理员创建邀请后，把邀请令牌发给你；你在这里设置 Jarvis 密码。" : registerMode ? registrationOpen ? "这是 Jarvis 账户注册，不需要 Authentik 或配对码。第一个注册者自动成为管理员。" : "第一个 Jarvis 账户已经注册。请返回登录，或使用管理员发放的邀请加入。" : "使用 Jarvis 用户名和密码登录。"}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const endpoint = inviteMode ? "/api/v2/auth/invites/accept" : registerMode ? "/api/v2/auth/register" : "/api/v2/auth/login";
            const browserDeviceId = localStorage.getItem("jarvis-device-id") ?? randomUUID();
            localStorage.setItem("jarvis-device-id", browserDeviceId);
            const body = inviteMode ? { token: inviteToken.trim(), password } : registerMode ? { username: username.trim(), password, password_confirmation: passwordConfirmation, device_id: browserDeviceId } : { username: username.trim(), password, device_id: browserDeviceId };
            if (registerMode && password !== passwordConfirmation) { setError("两次输入的密码不一致"); return; }
            setError("");
            void fetch(endpoint, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
              .then(async (r) => {
                if (!r.ok) {
                  if (registerMode && r.status === 409) throw Error("首次注册已完成，请返回登录或使用管理员邀请");
                  throw Error(inviteMode ? "邀请无效或已过期" : registerMode ? "注册失败，请检查用户名和密码" : "登录失败，请检查用户名和密码");
                }
                if (inviteMode) {
                  const accepted = await r.json();
                  const loggedIn = await fetch("/api/v2/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: accepted.username, password, device_id: browserDeviceId }) });
                  if (!loggedIn.ok) throw Error("成员已创建，但自动登录失败");
                }
                setPaired(true);
                setPage("home");
                setRunId(undefined);
                setPassword("");
                setPasswordConfirmation("");
                setInviteToken("");
                void gateway.open(true);
              })
              .catch(fail);
          }}
        >
          {inviteMode ? <><input aria-label="邀请令牌" value={inviteToken} onChange={(e) => setInviteToken(e.target.value)} placeholder="管理员发来的邀请令牌" /><input aria-label="设置密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="设置密码（至少 8 位）" autoComplete="new-password" /></> : <><input aria-label="用户名" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名" autoComplete="username" /><input aria-label="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码（至少 8 位）" autoComplete={registerMode ? "new-password" : "current-password"} />{registerMode && <input aria-label="确认密码" type="password" value={passwordConfirmation} onChange={(e) => setPasswordConfirmation(e.target.value)} placeholder="再次输入密码" autoComplete="new-password" />}</>}
          <button disabled={registerMode && !registrationOpen}>{inviteMode ? "接受邀请并登录" : registerMode ? "注册并登录" : "登录"}</button>
        </form>
        <div className="auth-switches"><button className="quiet" type="button" onClick={() => { setAuthMode("login"); setError(""); }}>{authMode === "login" ? "当前：用户名密码登录" : "返回用户名密码登录"}</button><button className="quiet" type="button" onClick={() => { setAuthMode("register"); setError(""); }}>{authMode === "register" ? "首次注册入口" : "首次注册 Jarvis 账户"}</button><button className="quiet" type="button" onClick={() => { setAuthMode("invite"); setError(""); }}>{authMode === "invite" ? "接受管理员邀请" : "我有管理员邀请"}</button></div>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  }
  return (
    <div className={`shell page-${page}${workspaceTarget ? " workspace-open" : ""}`}>
      <aside>
        <a className="brand" onClick={() => setPage("home")}>
          ◈ JARVIS
        </a>
        <p className="eyebrow">Your Personal AI Cloud</p>
        <nav>
          {nav.filter(([key]) => developerMode || !["agents", "system"].includes(key)).map(([key, label]) => (
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
        {(page === "jarvis" || page === "workspace") && <section className={`sidebar-history ${historyOpen ? "open" : ""}`}>
          <button className="history-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}>对话记录 <span>⌄</span></button>
          <div className="conversation-list">
            <button onClick={() => { setWorkspaceTarget(undefined); setWorkspaceConversation(undefined); setSelected(undefined); setConversation(undefined); setHistoryOpen(false); setPage("jarvis"); }}>＋ 新会话</button>
            {conversations.map((c) => <div className="conversation-row" key={c.id}>
              <button className={`conversation-entry ${c.id === selected ? "selected" : ""}`} onClick={() => { setWorkspaceTarget(undefined); setWorkspaceConversation(undefined); if (selected !== c.id) setConversation(undefined); setSelected(c.id); setHistoryOpen(false); setPage("jarvis"); }}>{c.title}</button>
              <button className="conversation-delete" aria-label={`删除会话 ${c.title}`} title="删除会话" onClick={() => void deleteConversation(c.id).catch(fail)}>×</button>
            </div>)}
          </div>
        </section>}
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
          <div className="header-actions"><button className="quiet" onClick={() => void snapshot().catch(fail)}>刷新</button><button className="quiet" onClick={() => void logout()}>退出登录</button></div>
          <ControlPlanePanel gateway={gateway} onError={fail} />
        </header>
        {error && (
          <div className="alert" role="alert">
            {error}
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {page === "home" ? <ProductHome openApp={openApp} onCasaosLogin={reconnectCasaos} problem={!!error} applications={applications} system={resources.get("system/status")?.data} runs={agents?.runs ?? []} conversations={conversations}
          navigate={(next, id) => { setPage(next); setRunId(next === "run" ? id : undefined); if (next === "jarvis" && id) setSelected(id); }}
          ask={(prompt) => { setText(prompt); setRunId(undefined); setPage("jarvis"); }} />
        : page === "spaces" ? <><p className="muted">你的文件、照片与想法，汇聚一处。</p><SpaceCards navigate={setPage} openApp={openApp} /><Empty title="选择你想探索的空间" text="照片与家庭使用原应用完整界面；其他空间将在接入后开放。" /></>
        : page === "apps" ? <ApplicationList value={applications} onCasaosLogin={reconnectCasaos} openApp={(id) => void openApp(id)} ask={(prompt) => { setText(prompt); setPage("jarvis"); }} />
        : page === "tasks" ? <ProductTasks runs={agents?.runs ?? []} open={(id) => void action({ type: "run.open", target: id })} gateway={gateway} onError={fail} />
        : page === "jarvis" || page === "workspace" ? (
          <div className={`conversation-layout ${workspaceTarget || page === "workspace" ? "with-workspace" : ""}`}>
            <div className="chat">
              <JarvisConversation key={selected ?? "new"} gateway={gateway} conversationId={selected} developer={developerMode} prompt={text} onPromptApplied={() => setText("")} onConversationCreated={onAssistantConversationCreated} onWorkspaceOpen={(id, owner) => { setWorkspaceTarget(id); setWorkspaceConversation(owner ?? selected); }} snapshot={conversation} action={action} />
            </div>
            {(workspaceTarget || page === "workspace") && <aside className="workspace-side">
              <div className="toolbar">
                <h2>工作区</h2><button aria-label="关闭工作区" onClick={() => { setWorkspaceTarget(undefined); setPage("jarvis"); }}>×</button>
              </div>
              <WorkspacePanel gateway={gateway} conversationId={workspaceConversation ?? selected} workspaceId={workspaceTarget} developer={developerMode} action={action} fallbackView={semantic ? <DynamicView value={semantic} action={action} liveResources={resources} /> : view ? <Blocks view={view} resources={resources} action={action} /> : undefined} onError={fail} />
            </aside>}
          </div>
        ) : page === "settings" || page === "users" ? <SettingsPage gateway={gateway} onError={fail} />
        : page === "agents" ? (
          <>
            <section className="agent-tier">
              <p className="eyebrow">CORE</p>
              <h2>◈ Jarvis</h2>
              <p>对话、委派与结果汇总</p>
            </section>
            <HermesConsole />
            <h2>领域智能体</h2>
            <div className="blocks">
              {agents?.definitions
                .filter((d: any) => d.tier === "managed")
                .map((d: any) => (
                  <section className="block" key={d.id}>
                    <h3>{d.name}</h3>
                    <p>
                      {d.description || `按能力路由的${d.role || "通用"}执行器`}
                    </p>
                    <small>{d.available === false ? "当前不可用" : d.runtime_type}</small>
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
                  {labels[r.status]}
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
