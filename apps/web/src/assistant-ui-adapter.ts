import {
  type ChatModelAdapter,
  type ThreadAssistantMessagePart,
} from "@assistant-ui/react";
import type { Gateway } from "./gateway.js";
import { randomUUID } from "./uuid.js";
import { mergeExecution, type ExecutionEvent } from "../../../packages/conversation/src/execution.js";
import type { ConversationResult } from "../../../packages/conversation/src/results.js";

type Activity = {
  id: string;
  tool_call_id?: string;
  capability: string;
  status: string;
  input?: unknown;
  output?: unknown;
  error?: string;
};
type ConversationSnapshot = { messages: { id: string; role: string; content: string; status?: string; revision?: number }[]; activities?: Activity[]; events?: ExecutionEvent[]; results?: ConversationResult[] };

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => { if (!settled) { settled = true; cleanup(); resolve(undefined); } };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => { if (!settled) { settled = true; cleanup(); resolve(value); } }, (error) => { if (!settled) { settled = true; cleanup(); reject(error); } });
  });
}

function retryWait(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (ready: boolean) => { clearTimeout(timer); signal.removeEventListener("abort", abort); resolve(ready); };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(true), ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function readRecoverySnapshot(gateway: Gateway, conversationId: string, developer: boolean, signal: AbortSignal): Promise<ConversationSnapshot | undefined> {
  const delays = [150, 450];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await abortable(gateway.request("conversation.get", { conversation_id: conversationId, developer }) as Promise<ConversationSnapshot>, signal);
    } catch {
      if (attempt === delays.length || !await retryWait(delays[attempt], signal)) return undefined;
    }
  }
  return undefined;
}

function activityProgress(status: string) {
  if (["completed", "failed", "cancelled"].includes(status)) return 3;
  if (["waiting_for_user", "waiting_approval"].includes(status)) return 2;
  if (["starting", "running", "streaming"].includes(status)) return 1;
  return 0;
}

const assistantMediaPattern = /MEDIA_RESOURCE:\s*([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b|(?:MEDIA:\s*)?((?:\/opt\/data\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp))|(?:\/api\/media\/[A-Za-z0-9_-]{1,100}\/thumbnail))\b/gi;

/** Converts Jarvis' server-side media references into assistant-ui image parts. */
export function assistantContentParts(content: string): ThreadAssistantMessagePart[] {
  const parts: ThreadAssistantMessagePart[] = [];
  let cursor = 0;
  for (const match of content.matchAll(assistantMediaPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ type: "text", text: content.slice(cursor, index) });
    const resourceId = match[1];
    const path = match[2];
    const mediaPath = resourceId ? `/api/media/${resourceId}/content` : path;
    if (!mediaPath) continue;
    const filename = resourceId ? "Jarvis 图片" : mediaPath.split("/").at(-1) ?? "Jarvis 图片";
    const image = mediaPath.startsWith("/api/media/")
      ? mediaPath
      : `/api/media/file?path=${encodeURIComponent(mediaPath)}`;
    const mimeType = /\.jpe?g$/i.test(filename) ? "image/jpeg" : /\.webp$/i.test(filename) ? "image/webp" : "image/png";
    parts.push({
      // assistant-ui sanitizes ImageMessagePart and drops relative HTTP URLs.
      // FileMessagePart is intentionally left untouched, so the custom File
      // renderer can load an authenticated same-origin media endpoint.
      type: "file",
      data: image,
      mimeType,
      sourceType: "url",
      filename,
    });
    cursor = index + match[0].length;
  }
  if (cursor < content.length) parts.push({ type: "text", text: content.slice(cursor) });
  if (!parts.length) parts.push({ type: "text", text: content });
  return parts;
}

function textOf(message: any) {
  if (typeof message?.content === "string") return message.content;
  return Array.isArray(message?.content) ? message.content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("") : "";
}

export function activityParts(activities: Activity[] = []): ThreadAssistantMessagePart[] {
  return activities.map((activity) => ({
    type: "tool-call" as const,
    toolCallId: activity.tool_call_id ?? activity.id,
    toolName: activity.capability,
    // Normal users receive the sanitized activity projection. Developer mode
    // may additionally receive the raw input/output from Gateway.
    args: (activity.input && typeof activity.input === "object" ? activity.input : {}) as any,
    argsText: JSON.stringify(activity.input ?? {}),
    ...(activity.status === "completed" ? { result: activity.output ?? { status: activity.status } } : {}),
    ...(activity.status === "failed" ? { result: activity.error ?? activity.status, isError: true } : {}),
  }));
}

/** Translates assistant-ui turns to Jarvis' durable Gateway protocol. */
export class JarvisAssistantAdapter {
  readonly model: ChatModelAdapter;
  constructor(
    private readonly gateway: Gateway,
    private readonly initialConversationId?: string,
    private readonly developer = false,
    private readonly onConversationCreated?: (id: string) => void,
    private readonly getReasoningEffort?: () => string | undefined,
    private readonly getSkills?: () => string[],
    private readonly onSkillsConsumed?: () => void,
  ) {
    const g = this.gateway;
    const initialId = this.initialConversationId;
    const developerMode = this.developer;
    const created = this.onConversationCreated;
    const readReasoningEffort = this.getReasoningEffort;
    const readSkills = this.getSkills;
    const skillsConsumed = this.onSkillsConsumed;
    this.model = { run: async function* (options: Parameters<ChatModelAdapter["run"]>[0]) {
      const input = textOf(options.messages.at(-1));
      if (!input.trim()) return;
      let conversationId = initialId;
      let createdNotified = false;
      const notifyCreated = () => {
        if (!initialId && conversationId && !createdNotified) {
          createdNotified = true;
          created?.(conversationId);
        }
      };
      if (!conversationId) {
        const conversation = await g.request("conversation.create", { title: "新会话" });
        conversationId = String(conversation.id);
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      options.abortSignal.addEventListener("abort", abort, { once: true });
      if (options.abortSignal.aborted) controller.abort();
      const events = g.stream([
        "conversation.message.delta", "conversation.status", "conversation.execution.updated", "conversation.result.updated", "connection",
        ...["started", "completed", "failed", "cancelled", "waiting_approval"].map((status) => `conversation.activity.${status}`),
      ], controller.signal);
      try {
        if (controller.signal.aborted) return;
        const reasoningEffort = readReasoningEffort?.();
        const skills = readSkills?.() ?? [];
        const accepted = await g.request("conversation.message", {
          conversation_id: conversationId, content: input, idempotency_key: randomUUID(),
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          ...(skills.length ? { skills } : {}),
        });
        if (skills.length) skillsConsumed?.();
        let content = "";
        let revision = 0;
        const activities = new Map<string, Activity>();
        let execution: ExecutionEvent[] = [];
        let results: ConversationResult[] = [];
        const update = () => ({ content: [...assistantContentParts(content), ...activityParts([...activities.values()])], metadata: { custom: { turn_id: accepted.turn_id, conversation_id: conversationId, events: execution, results, activities: [...activities.values()] } } });
        yield update();
        for await (const { topic, payload } of events) {
          if (topic === "connection") {
            if (payload !== "已连接") continue;
            // Recovery only: never resubmit the accepted message or its tools.
            const snapshot = await readRecoverySnapshot(g, conversationId, developerMode, controller.signal);
            if (!snapshot) { if (controller.signal.aborted) return; continue; }
            const reply = snapshot.messages.find((message) => message.id === accepted.reply_id);
            const snapshotRevision = Number(reply?.revision ?? 0);
            if (reply && snapshotRevision >= revision) { content = reply.content ?? content; revision = snapshotRevision; }
            for (const event of snapshot.events?.filter((item) => item.turn_id === accepted.turn_id) ?? []) execution = mergeExecution(execution, event);
            for (const result of snapshot.results?.filter((item) => item.turn_id === accepted.turn_id) ?? []) {
              const old = results.find((item) => item.id === result.id);
              if (!old || Number(result.revision) > Number(old.revision)) results = [...results.filter((item) => item.id !== result.id), result];
            }
            for (const activity of snapshot.activities ?? []) {
              if ((activity as any).turn_id !== accepted.turn_id) continue;
              const old = activities.get(activity.id);
              if (!old || activityProgress(activity.status) >= activityProgress(old.status)) activities.set(activity.id, activity);
            }
            yield update();
            if (["completed", "failed", "cancelled"].includes(reply?.status ?? "")) { notifyCreated(); return; }
            continue;
          }
          if (payload.conversation_id !== conversationId) continue;
          if (topic === "conversation.result.updated" && payload.turn_id === accepted.turn_id) {
            const old = results.find((result) => result.id === payload.id);
            if (!old || payload.revision > old.revision) results = [...results.filter((result) => result.id !== payload.id), payload];
          } else if (topic === "conversation.execution.updated" && payload.turn_id === accepted.turn_id) {
            execution = mergeExecution(execution, payload);
          } else if (topic === "conversation.message.delta" && payload.message_id === accepted.reply_id) {
            if (payload.revision <= revision) continue;
            revision = payload.revision;
            content = payload.content ?? content + payload.delta;
          } else if (topic.startsWith("conversation.activity.") && payload.turn_id === accepted.turn_id) {
            const id = payload.activity_id;
            activities.set(id, { ...activities.get(id), ...payload, id });
          } else if (topic === "conversation.status" && payload.message_id === accepted.reply_id) {
            if (["completed", "failed", "cancelled"].includes(payload.status)) {
              if (payload.error) content += `\n任务未完成：${payload.error}`;
              yield { ...update(), ...(payload.status === "cancelled" ? { status: { type: "incomplete" as const, reason: "cancelled" as const } } : {}) };
              notifyCreated();
              return;
            }
          } else continue;
          yield update();
        }
      } finally {
        controller.abort();
        options.abortSignal.removeEventListener("abort", abort);
      }
    } };
  }
}
