import React, { useEffect, useState, useCallback } from "react";
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
const gateway = new Gateway();
const nav = [
  ["home", "首页"],
  ["jarvis", "Jarvis"],
  ["agents", "智能体"],
  ["ai", "AI 用量"],
  ["server", "服务器"],
  ["workspace", "工作台"],
];
function restoredNavigation() {
  try {
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
  const [paired, setPaired] = useState(false),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [connection, setConnection] = useState("连接中"),
    [page, setPage] = useState(() => restoredNavigation().page),
    [conversations, setConversations] = useState<any[]>([]),
    [conversation, setConversation] = useState<any>(),
    [selected, setSelected] = useState<string | undefined>(
      () => restoredNavigation().selected,
    ),
    [view, setView] = useState<ViewSpec>(),
    [resources, setResources] = useState(new Map<string, Resource>()),
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
  const fail = (e: any) => setError(e.message ?? String(e));
  const loadView = useCallback(async (spec: ViewSpec) => {
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
      const v = await gateway.request("view.show", {
        type: "view.show",
        intent,
        resources: rs,
      });
      await loadView(v.spec);
    },
    [loadView],
  );
  const snapshot = useCallback(async () => {
    setConversations(await gateway.request("conversation.list"));
    setAgents(await gateway.request("agent.definition.list"));
    if (selected)
      setConversation(
        await gateway.request("conversation.get", {
          conversation_id: selected,
        }),
      );
    if (runId) await show("agent_run_analysis", ["agent-run/" + runId]);
    else if (page === "home" || page === "server")
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
    fetch("/api/v2/session")
      .then((r) => {
        if (r.ok) {
          setPaired(true);
          gateway.open();
        }
      })
      .catch(fail);
    return () => gateway.close();
  }, []);
  useEffect(() => {
    const listen = (name: string, fn: (e: any) => void) => {
      gateway.addEventListener(name, fn);
      return () => gateway.removeEventListener(name, fn);
    };
    const disposers = [
      listen("connection", (e) => setConnection(e.detail)),
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
          if (runId) await gateway.resource("agent-run/" + runId);
        })().catch(fail);
      }),
    ];
    if (gateway.socket?.readyState === 1) void snapshot().catch(fail);
    return () => disposers.forEach((d) => d());
  }, [snapshot, selected, runId]);
  async function action(a: any) {
    try {
      if (a.type === "run.open") {
        setRunId(a.target);
        setPage("run");
      } else {
        await gateway.request("ui.action.invoke", a);
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
        <p className="muted">使用一次性配对码，连接你的私人云。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void fetch("/api/v1/pair", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ device_id: randomUUID(), code: code.trim() }),
            })
              .then(async (r) => {
                if (!r.ok) throw Error("配对失败，请检查配对码");
                setPaired(true);
                setCode("");
                gateway.open();
              })
              .catch(fail);
          }}
        >
          <input
            aria-label="配对码"
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="一次性配对码"
          />
          <button>配对并连接</button>
        </form>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <a className="brand" onClick={() => setPage("home")}>
          ◈ JARVIS
        </a>
        <p className="eyebrow">私人云 · 持续在线</p>
        <nav>
          {nav.map(([key, label]) => (
            <button
              className={page === key ? "selected" : ""}
              key={key}
              onClick={() => {
                setPage(key);
                setRunId(undefined);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="connection">
          <i />
          {connection}
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">JARVIS / PERSONAL CLOUD</p>
            <h1>
              {page === "run" ? "任务详情" : nav.find(([k]) => k === page)?.[1]}
            </h1>
          </div>
          <button className="quiet" onClick={() => void snapshot().catch(fail)}>
            刷新
          </button>
        </header>
        {error && (
          <div className="alert" role="alert">
            {error}
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {page === "jarvis" ? (
          <div className="conversation-layout">
            <div className="conversation-list">
              <button
                onClick={() => {
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
                  onClick={() => setSelected(c.id)}
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
                    <div className="prose">{m.content || "正在处理…"}</div>
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
            {page === "workspace" && (
              <div className="toolbar">
                <button onClick={() => void show("usage_analysis").catch(fail)}>
                  用量分析
                </button>
                <button
                  onClick={() => void show("network_overview").catch(fail)}
                >
                  服务器网络
                </button>
                <button
                  onClick={() => void show("system_overview").catch(fail)}
                >
                  系统趋势
                </button>
              </div>
            )}
            {view && (
              <Blocks view={view} resources={resources} action={action} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
