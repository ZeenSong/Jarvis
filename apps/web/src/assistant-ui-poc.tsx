import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  unstable_useComposerInput,
  useLocalRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Gateway } from "./gateway";
import { assistantContentParts, JarvisAssistantAdapter } from "./assistant-ui-adapter";
import { activitySource, canonicalActivityCapability, capabilityLabel, visibleActivities } from "../../../packages/conversation/src/activity";

type JarvisMessage = { role: "user" | "assistant"; content: string };
type Activity = {
  id: string;
  tool_call_id?: string;
  capability: string;
  status: string;
  input?: unknown;
  output?: unknown;
  error?: string;
};
type Approval = { id: string; capability: string; status: string };
type Question = { id: string; kind: "boolean" | "single_choice"; prompt: string; options?: { value: string; label: string }[]; status: string };
type ConversationSnapshot = { messages: { id: string; role: string; content: string; status?: string; workspace_id?: string }[]; activities?: Activity[]; approvals?: Approval[]; questions?: Question[] };

function activityGroups(activities: Activity[]) {
  const groups = new Map<string, Activity[]>();
  for (const activity of activities) {
    const key = canonicalActivityCapability(activity.capability);
    groups.set(key, [...(groups.get(key) ?? []), activity]);
  }
  return [...groups.entries()];
}

function statusLabel(status: string) {
  return ({ queued: "排队中", running: "进行中", waiting_approval: "等待确认", waiting_question: "等待选择", completed: "已完成", failed: "失败", cancelled: "已取消" } as Record<string, string>)[status] ?? status;
}

function ConversationInspector({ gateway, conversationId, developer, onWorkspaceOpen }: { gateway: Gateway; conversationId?: string; developer: boolean; onWorkspaceOpen?: (id: string) => void }) {
  const [snapshot, setSnapshot] = useState<ConversationSnapshot>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!conversationId) { setSnapshot(undefined); return; }
    let stopped = false;
    const refresh = async () => {
      try {
        const next = await gateway.request("conversation.get", { conversation_id: conversationId, developer }) as ConversationSnapshot;
        if (!stopped) { setSnapshot(next); setError(""); }
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 500);
    return () => { stopped = true; clearInterval(timer); };
  }, [developer, gateway, conversationId]);
  if (!conversationId) return <p className="muted assistant-ui-empty">新会话将在发送第一条消息时创建。</p>;
  const workspaceId = snapshot?.messages.find((message) => message.workspace_id)?.workspace_id;
  const activities = visibleActivities(snapshot?.activities ?? [], developer);
  return <aside className="assistant-ui-inspector" aria-label="Jarvis 执行活动">
    {error && <p className="muted">正在恢复连接：{error}</p>}
    {workspaceId && onWorkspaceOpen && <button onClick={() => onWorkspaceOpen(workspaceId)}>打开工作区 →</button>}
    {!!activities.length && <section className="activity-groups">
      <strong>执行活动</strong>
      {activityGroups(activities).map(([key, grouped]) => <details key={key} open={grouped.some((activity) => activity.status === "running" || activity.status === "waiting_approval")}>
        <summary>{capabilityLabel(key)} · {grouped.length} 项</summary>
        {grouped.map((activity) => <details key={activity.id} open={activity.status === "running" || activity.status === "waiting_approval"}>
          <summary>{capabilityLabel(activity.capability)} · {statusLabel(activity.status)}</summary>
          {developer && <pre>{JSON.stringify({ id: activity.id, tool_call_id: activity.tool_call_id, capability: activity.capability, source: activitySource(activity.capability), input: activity.input, output: activity.output, error: activity.error }, null, 2)}</pre>}
        </details>)}
      </details>)}
    </section>}
    {snapshot?.approvals?.filter((approval) => approval.status === "pending").map((approval) => <section className="inline-approval" key={approval.id}>
      <strong>需要你的确认</strong><p>{capabilityLabel(approval.capability)}</p>
      <button onClick={() => void gateway.request("approval.resolve", { approval_id: approval.id, status: "approved" })}>批准一次</button>
      <button className="quiet" onClick={() => void gateway.request("approval.resolve", { approval_id: approval.id, status: "rejected" })}>取消</button>
    </section>)}
    {snapshot?.questions?.filter((question) => question.status === "pending").map((question) => <section className="inline-question" key={question.id}>
      <strong>{question.prompt}</strong>
      {question.kind === "boolean" ? <div>
        <button onClick={() => void gateway.request("conversation.question.answer", { question_id: question.id, answer: true })}>是</button>
        <button className="quiet" onClick={() => void gateway.request("conversation.question.answer", { question_id: question.id, answer: false })}>否</button>
      </div> : <div>{(question.options ?? []).map((option) => <button key={option.value} onClick={() => void gateway.request("conversation.question.answer", { question_id: question.id, answer: option.value })}>{option.label}</button>)}</div>}
    </section>)}
  </aside>;
}

export function AssistantUiProof({ gateway, conversationId, messages, developer = false, prompt, onPromptApplied, onConversationCreated, onWorkspaceOpen }: { gateway: Gateway; conversationId?: string; messages: JarvisMessage[]; developer?: boolean; prompt?: string; onPromptApplied?: () => void; onConversationCreated?: (id: string) => void; onWorkspaceOpen?: (id: string) => void }) {
  const adapter = useMemo(() => new JarvisAssistantAdapter(gateway, conversationId, developer, onConversationCreated), [conversationId, developer, gateway, onConversationCreated]);
  const initialMessages = useMemo<ThreadMessageLike[]>(() => messages.map((message, index) => ({ id: `jarvis-history-${index}`, role: message.role, content: message.role === "assistant" ? assistantContentParts(message.content) : [{ type: "text", text: message.content }] })), [messages]);
  const runtime = useLocalRuntime(adapter.model, { initialMessages });
  const syncedMessages = useRef("");
  useEffect(() => {
    // A question answer or a reopened streaming conversation progresses on the
    // server without starting this local adapter. Keep those messages visible.
    // During a local send, assistant-ui owns the optimistic message and stream.
    if (runtime.thread.getState().isRunning || !initialMessages.length) return;
    const fingerprint = JSON.stringify(initialMessages);
    if (syncedMessages.current === fingerprint) return;
    syncedMessages.current = fingerprint;
    runtime.thread.reset(initialMessages);
  }, [initialMessages, runtime]);
  return <AssistantRuntimeProvider runtime={runtime}>
    <div className="jarvis-assistant-ui-proof">
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Viewport className="assistant-ui-viewport">
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </ThreadPrimitive.Viewport>
        <ComposerBridge prompt={prompt} onPromptApplied={onPromptApplied} />
      </ThreadPrimitive.Root>
      <ConversationInspector gateway={gateway} conversationId={conversationId} developer={developer} onWorkspaceOpen={onWorkspaceOpen} />
    </div>
  </AssistantRuntimeProvider>;
}

function ComposerBridge({ prompt, onPromptApplied }: { prompt?: string; onPromptApplied?: () => void }) {
  const { setText } = unstable_useComposerInput();
  const applied = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!prompt || applied.current === prompt) return;
    applied.current = prompt;
    setText(prompt);
    onPromptApplied?.();
  }, [onPromptApplied, prompt, setText]);
  return <ComposerPrimitive.Root className="assistant-ui-composer">
    <ComposerPrimitive.Input placeholder="问 Jarvis…" />
    <ComposerPrimitive.Send>发送</ComposerPrimitive.Send>
    <ComposerPrimitive.Cancel>停止</ComposerPrimitive.Cancel>
  </ComposerPrimitive.Root>;
}

function UserMessage() { return <MessagePrimitive.Root className="message user"><MessagePrimitive.Content /></MessagePrimitive.Root>; }
function AssistantImage({ image, filename }: { image: string; filename?: string }) {
  return <figure className="assistant-media"><img src={image} alt={filename ?? "Jarvis 返回的图片"} loading="eager" decoding="async" /><figcaption>{filename}</figcaption></figure>;
}
function AssistantFile({ data, filename }: { data: string; filename?: string }) {
  return <figure className="assistant-media"><img src={data} alt={filename ?? "Jarvis 返回的图片"} loading="eager" decoding="async" /><figcaption>{filename}</figcaption></figure>;
}
function AssistantMessage() { return <MessagePrimitive.Root className="message assistant"><MessagePrimitive.Content components={{ Image: AssistantImage, File: AssistantFile }} /></MessagePrimitive.Root>; }
