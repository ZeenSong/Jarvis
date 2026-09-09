/** Provider wire types stay inside this adapter. */
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
}
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export async function complete(
  messages: ModelMessage[],
  tools: Tool[],
  delta: (text: string) => Promise<void>,
  report: (usage: {
    provider: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
  }) => Promise<void>,
  signal: AbortSignal,
) {
  const key = process.env.DEEPSEEK_API_KEY,
    model = process.env.CORE_MODEL;
  if (!key || !model) throw Error("deepseek_credentials_or_model_missing");
  const response = await fetch(
    (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(
      /\/$/,
      "",
    ) + "/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 4096,
        ...(tools.length
          ? { tools: tools.map((t) => ({ type: "function", function: t })) }
          : {}),
      }),
      signal,
    },
  );
  if (!response.ok || !response.body)
    throw Error("deepseek_http_" + response.status);
  let buffer = "",
    content = "";
  const calls = new Map<
    number,
    {
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }
  >();
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 2e6) throw Error("provider_frame_too_large");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:") || line === "data: [DONE]") continue;
        const p = JSON.parse(line.slice(5));
        if (p.error) throw Error("deepseek_stream_error");
        const d = p.choices?.[0]?.delta;
        if (d?.content) {
          content += d.content;
          await delta(d.content);
        }
        for (const t of d?.tool_calls ?? []) {
          const call = calls.get(t.index) ?? {
            id: "",
            type: "function",
            function: { name: "", arguments: "" },
          };
          if (t.id) call.id = t.id;
          if (t.function?.name) call.function.name += t.function.name;
          if (t.function?.arguments)
            call.function.arguments += t.function.arguments;
          calls.set(t.index, call);
        }
        if (p.usage)
          await report({
            provider: "deepseek",
            model: p.model ?? model,
            input_tokens: p.usage.prompt_tokens ?? 0,
            output_tokens: p.usage.completion_tokens ?? 0,
            cached_input_tokens:
              p.usage.prompt_cache_hit_tokens ??
              p.usage.prompt_tokens_details?.cached_tokens ??
              0,
          });
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { content, calls: [...calls.values()] };
}
