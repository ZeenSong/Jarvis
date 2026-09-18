import { createHmac, timingSafeEqual } from "node:crypto";

export type HermesMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_call_id?: string };
export type HermesDelta = { type: "delta" | "tool.started" | "tool.completed" | "completed" | "error"; text?: string; payload?: unknown };
export type HermesTool = { type: "function"; function: { name: string; description?: string; parameters: Record<string, unknown> } };
export type HermesToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type HermesContext = { owner: string; session: string; exp: number };

function encoded(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** Short lived, signed context passed to the MCP capability provider. */
export function createHermesContextToken(key: string, owner: string, session: string, ttlSeconds = 600) {
  if (!key || !owner || !session) throw Error("hermes_context_missing");
  const payload = encoded(JSON.stringify({ owner, session, exp: Math.floor(Date.now() / 1000) + ttlSeconds } satisfies HermesContext));
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyHermesContextToken(key: string, token: string): HermesContext | undefined {
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature || !key) return undefined;
    const expected = createHmac("sha256", key).update(payload).digest("base64url");
    const a = Buffer.from(signature), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
    const context = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as HermesContext;
    return context.owner && context.session && Number(context.exp) >= Math.floor(Date.now() / 1000) ? context : undefined;
  } catch {
    return undefined;
  }
}

/** Small, authenticated adapter for Hermes' OpenAI-compatible internal API. */
export class HermesClient {
  constructor(private readonly baseUrl: string, private readonly key: string, private readonly fetcher: typeof fetch = fetch) {}
  async health(signal?: AbortSignal) {
    const r = await this.fetcher(new URL("/health", this.baseUrl), { signal, headers: { Authorization: `Bearer ${this.key}` } });
    return r.ok;
  }
  async *stream(messages: HermesMessage[], options: { sessionId: string; signal?: AbortSignal; model?: string; tools?: HermesTool[] }): AsyncGenerator<HermesDelta> {
    const response = await this.fetcher(new URL("/v1/chat/completions", this.baseUrl), {
      method: "POST", signal: options.signal,
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", "X-Hermes-Session-Id": options.sessionId },
      body: JSON.stringify({ model: options.model ?? "hermes-agent", messages, stream: true, ...(options.tools?.length ? { tools: options.tools, tool_choice: "auto" } : {}) }),
    });
    if (!response.ok || !response.body) throw Error(`hermes_http_${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    while (true) {
      const next = await reader.read(); if (next.done) break; buffer += decoder.decode(next.value, { stream: true });
      const records = buffer.split("\n\n"); buffer = records.pop() ?? "";
      for (const record of records) {
        const line = record.split("\n").find((v) => v.startsWith("data:")); if (!line) continue;
        const value = line.slice(5).trim(); if (value === "[DONE]") { yield { type: "completed" }; return; }
        try {
          const json = JSON.parse(value); const choice = json.choices?.[0]; const delta = choice?.delta?.content;
          if (delta) yield { type: "delta", text: delta };
          for (const call of choice?.delta?.tool_calls ?? []) yield { type: "tool.started", payload: call };
          if (choice?.finish_reason || json.usage) yield { type: "completed", payload: { reason: choice?.finish_reason, usage: json.usage, model: json.model } };
        }
        catch { yield { type: "error", payload: "invalid_hermes_event" }; }
      }
    }
  }
  async complete(messages: HermesMessage[], tools: HermesTool[], options: { sessionId: string; signal?: AbortSignal; model?: string; contextToken?: string; delta?: (text: string) => Promise<void>; report?: (usage: { provider: string; model: string; input_tokens: number; output_tokens: number; cached_input_tokens: number }) => Promise<void> }) {
    let content = "";
    const calls = new Map<number, HermesToolCall>();
    const contextualMessages = options.contextToken
      ? [messages[0], { role: "system" as const, content: `Jarvis capability context token: ${options.contextToken}. When calling any mcp__jarvis__* tool, pass this exact token as context_token.` }, ...messages.slice(1)]
      : messages;
    for await (const event of this.stream(contextualMessages, { ...options, tools })) {
      if (event.type === "delta" && event.text) { content += event.text; await options.delta?.(event.text); }
      if (event.type === "tool.started") {
        const raw = (event.payload ?? {}) as any; const index = Number(raw.index ?? calls.size);
        const call = calls.get(index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
        if (raw.id) call.id = String(raw.id);
        if (raw.function?.name) call.function.name += String(raw.function.name);
        if (raw.function?.arguments) call.function.arguments += String(raw.function.arguments);
        calls.set(index, call);
      }
      if (event.type === "completed" && (event.payload as any)?.usage && options.report) {
        const usage = (event.payload as any).usage; await options.report({ provider: "hermes", model: String((event.payload as any).model ?? options.model ?? "hermes-agent"), input_tokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0), output_tokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0), cached_input_tokens: Number(usage.prompt_cache_hit_tokens ?? 0) });
      }
      if (event.type === "error") throw Error("hermes_invalid_event");
    }
    return { content, calls: [...calls.values()] };
  }
}
