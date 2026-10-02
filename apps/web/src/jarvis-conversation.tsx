import {
  AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive,
  unstable_useComposerInput, useLocalRuntime, useAuiState, type ThreadMessageLike,
} from "@assistant-ui/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Gateway } from "./gateway";
import { assistantContentParts, JarvisAssistantAdapter } from "./assistant-ui-adapter";
import { capabilityLabel, visibleActivities, activityPresentation, activityTitle } from "../../../packages/conversation/src/activity";
import { mergeExecution, type ExecutionEvent } from "../../../packages/conversation/src/execution";
import { MarkdownContent } from "./markdown";
import "./conversation.css";
import type { ConversationResult } from "../../../packages/conversation/src/results";
import { ResultHost } from "./result-host";
import type { ReasoningEffort } from "../../../packages/conversation/src/model-options";

type Activity = { id: string; turn_id: string; capability: string; status: string; input?: unknown; output?: unknown; error?: string };
type Question = { id: string; turn_id: string; kind: string; prompt: string; status: string; options?: { value: string; label: string }[]; answer?: unknown };
type Approval = { id: string; turn_id: string; capability: string; status: string };
type Message = { id: string; turn_id: string; role: string; content: string; sequence?: number; revision?: number; status?: string; workspace_id?: string };
type SkillOption = { name: string; description: string; category?: string };
export type ConversationSnapshot = { conversation?: { title?: string }; messages?: Message[]; events?: ExecutionEvent[]; activities?: Activity[]; questions?: Question[]; approvals?: Approval[]; results?: ConversationResult[] };
type ConversationContextValue = { gateway: Gateway; developer: boolean; snapshot: ConversationSnapshot; messages: Message[]; onWorkspaceOpen?: (id: string, conversationId?: string) => void; action: (value: any) => void; followup: (text: string) => void };
const ConversationContext = createContext<ConversationContextValue | null>(null);
const emptySnapshot: ConversationSnapshot = {};

function mergeConversationMessages(current: Message[], incoming: Message[]) {
  const statusRank = (status?: string) => status === "queued" ? 1 : status === "streaming" ? 2 : ["completed", "failed", "cancelled"].includes(status ?? "") ? 3 : 0;
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const old = messages.get(message.id);
    if (!old) { messages.set(message.id, message); continue; }
    const revision = Number(message.revision ?? 0);
    if (revision < Number(old.revision ?? 0)) continue;
    const status = statusRank(old.status) > statusRank(message.status) ? old.status : message.status ?? old.status;
    messages.set(message.id, { ...old, ...message, status, content: typeof message.content === "string" ? message.content : old.content });
  }
  return [...messages.values()].sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
}

function mergeQuestions(current: Question[], incoming: Question[]) {
  const rank = (status: string) => status === "pending" ? 0 : 1;
  const questions = new Map(current.map((question) => [question.id, question]));
  for (const question of incoming) {
    const old = questions.get(question.id);
    questions.set(question.id, old && rank(old.status) > rank(question.status) ? { ...question, status: old.status, answer: old.answer } : { ...old, ...question });
  }
  return [...questions.values()];
}

const statusLabel = (status: string) => ({ queued: "等待中", running: "进行中", waiting_approval: "等待确认", waiting_question: "等待选择", completed: "已完成", failed: "未完成", cancelled: "已停止" }[status] ?? status);
const kindLabel = (kind: string) => ({ reasoning: "思考", skill: "技能", tool: "服务调用", processing: "整理", approval: "确认", question: "等待选择", render: "生成界面", answer: "回答", result: "结果" }[kind] ?? "执行阶段");

export function ExecutionStream({ events, activities, developer }: { events: ExecutionEvent[]; activities: Activity[]; developer: boolean }) {
  const stepsRef = useRef<HTMLOListElement>(null);
  const [stepsOverflow, setStepsOverflow] = useState(false);
  const visible = visibleActivities(activities, developer);
  const ordered = events.filter((event) => !event.activity_id || visible.some((activity) => activity.id === event.activity_id));
  // Existing conversations predate durable execution segments; keep their real activities.
  const missing = visible.filter((activity) => !events.some((event) => event.activity_id === activity.id));
  const steps: { id: string; event?: ExecutionEvent; activity?: Activity }[] = [
    ...ordered.map((event) => ({ id: event.id, event, activity: activities.find((item) => item.id === event.activity_id) })),
    ...missing.map((activity) => ({ id: activity.id, activity })),
  ];
  const running = ordered.some((event) => event.status === "running") || missing.some((activity) => activity.status === "running");
  const starts = ordered.map((event) => Date.parse(event.started_at)).filter(Number.isFinite);
  const finishes = ordered.map((event) => Date.parse(event.completed_at ?? "")).filter(Number.isFinite);
  const duration = starts.length && finishes.length === ordered.length && ordered.every((event) => ["completed", "failed", "cancelled"].includes(event.status))
    ? Math.max(0, Math.max(...finishes) - Math.min(...starts))
    : undefined;
  const durationLabel = duration === undefined ? running ? "实时执行" : "过程记录" : `总耗时 ${duration < 1000 ? `${Math.round(duration)} 毫秒` : `${(duration / 1000).toFixed(1)} 秒`}`;
  useEffect(() => {
    const element = stepsRef.current;
    if (!element) return;
    const measure = () => setStepsOverflow(element.scrollWidth > element.clientWidth + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [steps.length]);
  if (!steps.length) return null;
  return <section className="execution-stream" aria-label="执行过程" aria-busy={running}>
    <header><span className={running ? "execution-pulse" : "execution-done"} aria-hidden="true">{running ? "◌" : "✓"}</span><strong>执行过程</strong><span>{steps.length} 个阶段</span><div className="execution-meta">{stepsOverflow && <small>左右滑动查看更多 →</small>}<small>{durationLabel}</small></div></header>
    <ol ref={stepsRef} className={`execution-steps${steps.length > 4 ? " many" : ""}`}>{steps.map(({ id, event, activity }, index) => {
      const status = event?.status ?? activity?.status ?? "queued";
      const kind = event?.kind ?? (activity ? activityPresentation(activity).category : "tool");
      const title = event?.title ?? (activity ? activityTitle(activity) : "执行操作");
      const content = event?.content ?? "";
      const evidence = activity ?? event;
      return <li key={id} data-status={status} data-kind={kind}>
        <span className="execution-index" aria-hidden="true">{index + 1}</span>
        <span className="execution-node" aria-label={statusLabel(status)}>{status === "completed" ? "✓" : status === "failed" ? "!" : status === "cancelled" ? "×" : status === "running" ? "◌" : "·"}</span>
        <div className="execution-body"><span className="execution-kind">{kindLabel(kind)}</span><details>
          <summary><span title={title}>{title}</span><small>{statusLabel(status)}</small></summary>
          {content && <div className="reasoning-content"><MarkdownContent value={content} /></div>}
          {developer && evidence && <pre>{JSON.stringify(evidence, null, 2)}</pre>}
        </details></div>
      </li>;
    })}</ol>
  </section>;
}

export function JarvisConversation({ gateway, conversationId, snapshot: initial = emptySnapshot, developer = false, prompt, onPromptApplied, onConversationCreated, onWorkspaceOpen, action }: {
  gateway: Gateway; conversationId?: string; snapshot?: ConversationSnapshot; developer?: boolean; prompt?: string;
  onPromptApplied?: () => void; onConversationCreated?: (id: string) => void; onWorkspaceOpen?: (id: string, conversationId?: string) => void; action: (value: any) => void;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [messages, setMessages] = useState<Message[]>(initial.messages ?? []);
  const [reasoningEfforts, setReasoningEfforts] = useState<ReasoningEffort[]>([]);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const reasoningPreference = useRef<ReasoningEffort | undefined>(undefined);
  const selectedSkillsPreference = useRef<string[]>([]);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const composerPrefill = useRef<((text: string) => void) | undefined>(undefined);
  const registerComposerPrefill = useCallback((apply: ((text: string) => void) | undefined) => { composerPrefill.current = apply; }, []);
  const setSkillSelection = useCallback((value: string[]) => { selectedSkillsPreference.current = value; setSelectedSkills(value); }, []);
  const consumeSkillSelection = useCallback(() => setSkillSelection([]), [setSkillSelection]);
  const followup = useCallback((text: string) => {
    composerPrefill.current?.(text);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".assistant-ui-composer textarea")?.focus());
  }, []);
  useEffect(() => setSnapshot((old) => ({ ...old, ...initial, questions: mergeQuestions(old.questions ?? [], initial.questions ?? []) })), [initial]);
  useEffect(() => setMessages((old) => mergeConversationMessages(old, initial.messages ?? [])), [initial.messages]);
  useEffect(() => {
    let active = true;
    let requested = false;
    const load = () => {
      if (!active || requested) return;
      requested = true;
      void gateway.request("conversation.composer.options").then((value) => {
        if (!active) return;
        const allowed = new Set<ReasoningEffort>(["low", "medium", "high", "max"]);
        const efforts = Array.isArray(value?.reasoning_efforts)
          ? value.reasoning_efforts.filter((item: unknown): item is ReasoningEffort => typeof item === "string" && allowed.has(item as ReasoningEffort))
          : [];
        const catalog = Array.isArray(value?.skills) ? value.skills.flatMap((item: any) =>
          item && typeof item.name === "string" && item.name.trim()
            ? [{ name: item.name.trim(), description: typeof item.description === "string" ? item.description : "", ...(typeof item.category === "string" && item.category ? { category: item.category } : {}) }]
            : [],
        ) as SkillOption[] : [];
        setSkills([...new Map(catalog.map((skill) => [skill.name, skill])).values()]);
        setReasoningEfforts(efforts);
        if (efforts.length) {
          const selected = efforts.includes("medium") ? "medium" : efforts[0];
          reasoningPreference.current = selected;
          setReasoningEffort(selected);
        } else reasoningPreference.current = undefined;
      }).catch(() => { requested = false; if (active) reasoningPreference.current = undefined; });
    };
    const off = gateway.subscribe<string>("connection", (status) => { if (status === "已连接") load(); });
    if (gateway.socket?.readyState === 1) load();
    return () => { active = false; off(); };
  }, [gateway]);
  useEffect(() => {
    let active = true;
    let evidenceRefresh = Promise.resolve();
    const refreshDeveloperEvidence = (event: any) => {
      if (!developer || !conversationId || event?.conversation_id !== conversationId) return;
      // Raw tool arguments/results are intentionally excluded from live events.
      // In admin Developer Mode, reconcile only when a real activity changes;
      // the server re-checks the caller's role on this snapshot request.
      evidenceRefresh = evidenceRefresh.catch(() => {}).then(async () => {
        const value = await gateway.request("conversation.get", { conversation_id: conversationId, developer: true }) as ConversationSnapshot;
        if (!active) return;
        setSnapshot((old) => ({
          ...old,
          activities: value.activities ?? old.activities,
          events: value.events ?? old.events,
        }));
      }).catch(() => { /* A later activity transition will retry the debug snapshot. */ });
    };
    const offs = [gateway.subscribe<ExecutionEvent>("conversation.execution.updated", (event) => {
      if (conversationId && event.conversation_id !== conversationId) return;
      setSnapshot((old) => ({ ...old, events: mergeExecution(old.events ?? [], event) }));
    }), ...["created", "answered"].map((status) => gateway.subscribe("conversation.question." + status, (question) => {
      if (conversationId && question.conversation_id !== conversationId) return;
      setSnapshot((old) => ({ ...old, questions: mergeQuestions(old.questions ?? [], [question]) }));
    })), ...["started", "completed", "failed", "cancelled", "waiting_approval"].map((status) => gateway.subscribe("conversation.activity." + status, (activity) => {
      if (conversationId && activity.conversation_id !== conversationId) return;
      setSnapshot((old) => ({ ...old, activities: [...(old.activities ?? []).filter((item) => item.id !== activity.activity_id), { ...activity, id: activity.activity_id }] }));
      refreshDeveloperEvidence(activity);
    })), gateway.subscribe("conversation.question.cancelled", (question) => {
      if (conversationId && question.conversation_id !== conversationId) return;
      setSnapshot((old) => ({ ...old, questions: [...(old.questions ?? []).filter((item) => item.id !== question.id), question] }));
    })];
    const refreshApprovals = () => { void gateway.request("approval.list").then((approvals) => {
      if (active) setSnapshot((old) => ({ ...old, approvals }));
    }).catch(() => { /* Reconnect snapshot restores unresolved approvals. */ }); };
    offs.push(gateway.subscribe("approval.created", refreshApprovals), gateway.subscribe("approval.resolved", refreshApprovals));
    offs.push(gateway.subscribe<any>("conversation.updated", (event) => {
      if (conversationId && event.conversation_id !== conversationId) return;
      if (Array.isArray(event.messages)) setMessages((old) => mergeConversationMessages(old, event.messages));
    }));
    offs.push(gateway.subscribe<any>("conversation.message.delta", (event) => {
      if (conversationId && event.conversation_id !== conversationId) return;
      setMessages((old) => old.map((message) => {
        if (message.id !== event.message_id || Number(event.revision ?? 0) <= Number(message.revision ?? 0)) return message;
        return { ...message, content: typeof event.content === "string" ? event.content : message.content + String(event.delta ?? ""), revision: Number(event.revision) };
      }));
    }));
    offs.push(gateway.subscribe<any>("conversation.status", (event) => {
      if (conversationId && event.conversation_id !== conversationId) return;
      setMessages((old) => old.map((message) => message.id === event.message_id ? { ...message, status: event.status } : message));
    }));
    return () => { active = false; offs.forEach((off) => off()); };
  }, [gateway, conversationId, developer]);
  const adapter = useMemo(() => new JarvisAssistantAdapter(
    gateway, conversationId, developer, onConversationCreated,
    () => reasoningPreference.current, () => selectedSkillsPreference.current, consumeSkillSelection,
  ), [conversationId, developer, gateway, onConversationCreated, consumeSkillSelection]);
  const initialMessages = useMemo<ThreadMessageLike[]>(() => messages.filter((message) => ["user", "jarvis"].includes(message.role)).map((message) => ({
    id: message.id, role: message.role === "user" ? "user" : "assistant",
    content: message.role === "user" ? [{ type: "text", text: message.content }] : assistantContentParts(message.content),
    metadata: { custom: { turn_id: message.turn_id, workspace_id: message.workspace_id } },
  })), [messages]);
  const runtime = useLocalRuntime(adapter.model, { initialMessages });
  const synced = useRef("");
  useEffect(() => {
    if (runtime.thread.getState().isRunning || !initialMessages.length) return;
    const fingerprint = JSON.stringify(initialMessages);
    if (synced.current === fingerprint) return;
    synced.current = fingerprint;
    runtime.thread.reset(initialMessages);
  }, [initialMessages, runtime]);
  const context = useMemo(() => ({ gateway, developer, snapshot, messages, onWorkspaceOpen, action, followup }), [gateway, developer, snapshot, messages, onWorkspaceOpen, action, followup]);
  return <ConversationContext.Provider value={context}><AssistantRuntimeProvider runtime={runtime}>
    <div className="jarvis-conversation">
      <header className="conversation-header"><span className="jarvis-mark">◇</span><div><h2>{initial.conversation?.title || "与 Jarvis 对话"}</h2><p>你的家庭 AI · 想到什么，就从这里开始</p></div></header>
      <ThreadPrimitive.Root className="conversation-thread">
        <ThreadPrimitive.Viewport className="assistant-ui-viewport">
          <ThreadPrimitive.Empty><div className="conversation-welcome"><span className="jarvis-mark">◇</span><h2>今天，有什么我可以帮你？</h2><p>看看家里的近况，发现照片里的美好，或一起理清一个问题。</p></div></ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage: JarvisTurn }} />
          <ThreadPrimitive.ScrollToBottom className="conversation-scroll-bottom" aria-label="回到最新消息">↓</ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.Viewport>
        <Composer prompt={prompt} onPromptApplied={onPromptApplied} registerPrefill={registerComposerPrefill} reasoningEfforts={reasoningEfforts} reasoningEffort={reasoningEffort} skills={skills} selectedSkills={selectedSkills} onSkillsChange={setSkillSelection} onReasoningEffortChange={(value) => {
          reasoningPreference.current = value;
          setReasoningEffort(value);
        }} />
      </ThreadPrimitive.Root>
    </div>
  </AssistantRuntimeProvider></ConversationContext.Provider>;
}

function Composer({ prompt, onPromptApplied, reasoningEfforts, reasoningEffort, onReasoningEffortChange, skills, selectedSkills, onSkillsChange, registerPrefill }: {
  prompt?: string; onPromptApplied?: () => void; reasoningEfforts: ReasoningEffort[]; reasoningEffort: ReasoningEffort;
  onReasoningEffortChange: (value: ReasoningEffort) => void; skills: SkillOption[]; selectedSkills: string[];
  onSkillsChange: (value: string[]) => void; registerPrefill: (apply: ((text: string) => void) | undefined) => void;
}) {
  const { setText } = unstable_useComposerInput();
  const localRunning = useAuiState((state) => state.thread.isRunning);
  const turnId = useAuiState((state) => state.thread.messages.at(-1)?.metadata.custom.turn_id);
  const context = useContext(ConversationContext)!;
  const serverRunning = context.messages.some((message) => message.role === "jarvis" && ["queued", "streaming"].includes(message.status ?? ""));
  const running = localRunning || serverRunning;
  const queued = !localRunning && context.messages.some((message) => message.role === "jarvis" && message.status === "queued");
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState("");
  useEffect(() => { registerPrefill(setText); return () => registerPrefill(undefined); }, [registerPrefill, setText]);
  useEffect(() => { if (!running) setStopping(false); }, [running]);
  const stop = async () => {
    if (typeof turnId !== "string") return;
    setStopping(true); setStopError("");
    try { await context.gateway.request("conversation.stop", { turn_id: turnId }); }
    catch (error) { setStopping(false); setStopError(error instanceof Error ? error.message : "停止请求未送达，请重试"); }
  };
  const applied = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!prompt || applied.current === prompt) return;
    applied.current = prompt; setText(prompt); onPromptApplied?.();
  }, [onPromptApplied, prompt, setText]);
  return <ComposerPrimitive.Root className="assistant-ui-composer">
    <ComposerPrimitive.Input placeholder="问 Jarvis 任何事情……" aria-label="消息内容" />
    <div className="composer-footer"><div className="composer-meta">{skills.length > 0 && <details className="skills-picker">
      <summary aria-label="选择本次可用 Skills">Skills · {selectedSkills.length ? `${selectedSkills.length} 项已选` : "Auto"}<span aria-hidden="true">⌄</span></summary>
      <div className="skills-menu" role="group" aria-label="本次可用 Skills">
        <button type="button" className={!selectedSkills.length ? "selected" : ""} aria-pressed={!selectedSkills.length} onClick={() => onSkillsChange([])}>Auto <small>由 Hermes 自动选择</small></button>
        {skills.map((skill) => <label key={skill.name} className="skill-option">
          <input type="checkbox" checked={selectedSkills.includes(skill.name)} onChange={(event) => onSkillsChange(event.currentTarget.checked ? [...selectedSkills, skill.name] : selectedSkills.filter((name) => name !== skill.name))} />
          <span><strong>{skill.name}</strong>{skill.description && <small>{skill.description}</small>}</span>
        </label>)}
      </div>
    </details>}{reasoningEfforts.length > 0 && <label className="reasoning-control">推理强度<select aria-label="推理强度" value={reasoningEffort} onChange={(event) => onReasoningEffortChange(event.currentTarget.value as ReasoningEffort)}>{reasoningEfforts.map((effort) => <option key={effort} value={effort}>{({ low: "快速", medium: "标准", high: "深度", max: "极深" } as Record<string, string>)[effort]}</option>)}</select><span aria-hidden="true">⌄</span></label>}<span role={stopping || running ? "status" : undefined}>{stopping ? "正在停止任务……" : running ? queued ? "任务排队中 · 可随时停止" : "正在处理 · 可随时停止" : "让想法成为行动"}</span></div><div>{running ? <button type="button" aria-label="停止任务" disabled={stopping || !turnId} onClick={() => void stop()}>■</button> : <ComposerPrimitive.Send aria-label="发送消息">↑</ComposerPrimitive.Send>}</div></div>
    {stopError && <p className="inline-error" role="alert">{stopError}</p>}
  </ComposerPrimitive.Root>;
}

function UserMessage() { return <MessagePrimitive.Root className="message user"><MessagePrimitive.Content components={{ Text: UserText }} /></MessagePrimitive.Root>; }
function UserText({ text }: { text: string }) {
  const answer = /^用户已回答问题：([\s\S]*?)\n回答：([\s\S]*?)\n请根据此回答继续原任务。$/.exec(text);
  if (!answer) return <span>{text}</span>;
  return <span className="question-answer-chip"><small>对「{answer[1]}」的回答</small><strong>{answer[2]}</strong></span>;
}
function AssistantImage({ image, filename }: { image: string; filename?: string }) { return <figure className="assistant-media"><img src={image} alt={filename ?? "返回的照片"} loading="lazy" decoding="async" /></figure>; }
function AssistantFile({ data, filename }: { data: string; filename?: string }) { return <AssistantImage image={data} filename={filename} />; }
function AssistantText({ text }: { text: string }) { return <div className="streaming-answer"><MarkdownContent value={text} /></div>; }
function HiddenTool() { return null; }

function JarvisTurn() {
  const context = useContext(ConversationContext)!;
  const custom = useAuiState((state) => state.message.metadata.custom);
  const messageId = useAuiState((state) => state.message.id);
  const runtimeRunning = useAuiState((state) => state.message.status?.type === "running");
  const serverStatus = context.messages.find((message) => message.id === messageId)?.status;
  const running = runtimeRunning || ["queued", "streaming"].includes(serverStatus ?? "");
  const turnId = custom.turn_id as string | undefined;
  const activities = [...(context.snapshot.activities ?? []).filter((item) => item.turn_id === turnId)];
  for (const activity of (custom.activities ?? []) as Activity[]) if (!activities.some((item) => item.id === activity.id)) activities.push(activity);
  let events = (context.snapshot.events ?? []).filter((item) => item.turn_id === turnId);
  for (const event of (custom.events ?? []) as ExecutionEvent[]) events = mergeExecution(events, event);
  const results = [...(context.snapshot.results ?? []).filter((result) => result.turn_id === turnId)];
  for (const result of (custom.results ?? []) as ConversationResult[]) {
    const index = results.findIndex((item) => item.id === result.id);
    if (index < 0) results.push(result); else if (result.revision > results[index].revision) results[index] = result;
  }
  const opened = useRef(new Set<string>());
  useEffect(() => {
    for (const result of (custom.results ?? []) as ConversationResult[]) {
      if (result.workspace_id && !opened.current.has(result.id)) {
        opened.current.add(result.id); context.onWorkspaceOpen?.(result.workspace_id, result.conversation_id);
      }
    }
  }, [custom.results, context.onWorkspaceOpen]);
  const [error, setError] = useState("");
  const invoke = async (topic: string, payload: unknown) => { try { setError(""); await context.gateway.request(topic, payload); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作未完成，请重试"); } };
  return <MessagePrimitive.Root className="message assistant jarvis-turn">
    <div className="turn-author"><span className="jarvis-mark">◇</span><strong>Jarvis</strong>{running && <span className="turn-working" role="status">{serverStatus === "queued" && !runtimeRunning ? "排队中" : "正在处理"}<span>…</span></span>}</div>
    <ExecutionStream events={events} activities={activities} developer={context.developer} />
    <MessagePrimitive.Content components={{ Text: AssistantText, Image: AssistantImage, File: AssistantFile, tools: { Fallback: HiddenTool } }} />
    {(context.snapshot.questions ?? []).filter((question) => question.turn_id === turnId && question.status === "pending").map((question) => <section className="inline-question" key={question.id}><strong>{question.prompt}</strong><div>{(question.kind === "boolean" ? [{ value: true, label: "是" }, { value: false, label: "否" }] : question.options ?? []).map((option) => <button key={String(option.value)} onClick={() => void invoke("conversation.question.answer", { question_id: question.id, answer: option.value })}>{option.label}</button>)}</div></section>)}
    {(context.snapshot.approvals ?? []).filter((approval) => approval.turn_id === turnId && approval.status === "pending").map((approval) => <section className="inline-approval" key={approval.id}><strong>需要你的确认</strong><p>{capabilityLabel(approval.capability)}</p><button onClick={() => void invoke("approval.resolve", { approval_id: approval.id, status: "approved" })}>批准一次</button><button onClick={() => void invoke("approval.resolve", { approval_id: approval.id, status: "rejected" })}>取消</button></section>)}
    {results.map((result) => <ResultHost key={result.id} result={result} gateway={context.gateway} openWorkspace={context.onWorkspaceOpen} action={context.action} followup={context.followup} />)}
    {!results.length && typeof custom.workspace_id === "string" && <button className="result-workspace-link" onClick={() => context.onWorkspaceOpen?.(custom.workspace_id as string)}>打开分析工作区 →</button>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </MessagePrimitive.Root>;
}
