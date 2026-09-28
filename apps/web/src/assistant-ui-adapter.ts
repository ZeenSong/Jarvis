import {
  type ChatModelAdapter,
  type ThreadAssistantMessagePart,
} from "@assistant-ui/react";
import type { Gateway } from "./gateway.js";
import { randomUUID } from "./uuid.js";

type Activity = {
  id: string;
  tool_call_id?: string;
  capability: string;
  status: string;
  input?: unknown;
  output?: unknown;
  error?: string;
};
type ConversationSnapshot = { messages: { id: string; role: string; content: string; status?: string }[]; activities?: Activity[] };

const assistantMediaPattern = /(?:MEDIA:\s*)?((?:\/opt\/data\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp))|(?:\/api\/media\/[A-Za-z0-9_-]{1,100}\/thumbnail))\b/gi;

/** Converts Jarvis' server-side media references into assistant-ui image parts. */
export function assistantContentParts(content: string): ThreadAssistantMessagePart[] {
  const parts: ThreadAssistantMessagePart[] = [];
  let cursor = 0;
  for (const match of content.matchAll(assistantMediaPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ type: "text", text: content.slice(cursor, index) });
    const path = match[1];
    const filename = path.split("/").at(-1) ?? "Jarvis 图片";
    const image = path.startsWith("/api/media/")
      ? path
      : `/api/media/file?path=${encodeURIComponent(path)}`;
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

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
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
  ) {
    const g = this.gateway;
    const initialId = this.initialConversationId;
    const developerMode = this.developer;
    const created = this.onConversationCreated;
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
        const conversation = await g.request("conversation.create", { title: input.slice(0, 40) });
        conversationId = String(conversation.id);
      }
      const accepted = await g.request("conversation.message", { conversation_id: conversationId, content: input, idempotency_key: randomUUID() });
      let last = "";
      let lastActivities = "";
      let failures = 0;
      for (let attempt = 0; attempt < 240; attempt++) {
        if (options.abortSignal.aborted) return;
        try {
          const value = await g.request("conversation.get", { conversation_id: conversationId, developer: developerMode }) as ConversationSnapshot;
          failures = 0;
          const reply = value.messages.find((message) => message.id === accepted.reply_id);
          const content = String(reply?.content ?? "");
          const activities = value.activities ?? [];
          const activityFingerprint = JSON.stringify(activities.map((activity) => [activity.id, activity.status, activity.output, activity.error]));
          if (content !== last || activityFingerprint !== lastActivities) {
            last = content;
            lastActivities = activityFingerprint;
            yield { content: [...assistantContentParts(content), ...activityParts(activities)] };
          }
          if (["completed", "failed"].includes(String(reply?.status))) {
            notifyCreated();
            return;
          }
          await wait(250, options.abortSignal);
        } catch (error) {
          if (options.abortSignal.aborted) return;
          // Gateway already reconnects its WebSocket. Resume from durable
          // Conversation state instead of duplicating the message.
          failures += 1;
          if (failures > 6) throw error;
          await wait(Math.min(2000, 250 * 2 ** (failures - 1)), options.abortSignal);
        }
      }
      notifyCreated();
      yield { content: assistantContentParts(last || "Jarvis 暂时没有返回结果。") };
    } };
  }
}
