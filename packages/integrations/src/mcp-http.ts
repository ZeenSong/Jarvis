/**
 * Minimal MCP Streamable HTTP client.
 *
 * Jarvis deliberately does not depend on an MCP SDK on the server: the protocol
 * surface it needs is initialize + tools/list + tools/call, and keeping it here
 * means an app configured from CasaOS is callable immediately, without a new
 * Hermes MCP-server entry or a container restart.
 */

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export type McpTool = {
  name: string;
  description: string;
  input_schema: unknown;
  read_only: boolean;
};

export type McpCallResult = {
  content: unknown;
  is_error: boolean;
};

export type McpConnection = {
  endpoint: string;
  headers: Record<string, string>;
  /**
   * Skip certificate verification for this connection. Required by apps that
   * serve a self-signed certificate on an address outside its SAN (Obsidian's
   * Local REST API is the common case). Never global: the process-wide TLS
   * setting stays untouched.
   */
  allow_insecure_tls?: boolean;
  timeout_ms?: number;
  fetch?: typeof fetch;
};

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
};

function bounded(text: string, limit = 512 * 1024): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

function parseSse(text: string): JsonRpcMessage[] {
  const messages: JsonRpcMessage[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      messages.push(JSON.parse(data) as JsonRpcMessage);
    } catch {
      // A stray heartbeat or a non-protocol comment is not an error.
    }
  }
  return messages;
}

async function readText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 1024 * 1024) {
      await reader.cancel();
      break;
    }
    chunks.push(chunk.value);
  }
  return bounded(Buffer.concat(chunks).toString("utf8"));
}

async function post(
  connection: McpConnection,
  payload: unknown,
  sessionId?: string,
  protocolVersion?: string,
): Promise<{ messages: JsonRpcMessage[]; sessionId?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(sessionId
      ? { "Mcp-Session-Id": sessionId, "MCP-Protocol-Version": protocolVersion ?? "2024-11-05" }
      : {}),
    ...connection.headers,
  };
  const fetcher = connection.fetch ?? fetch;
  let status: number;
  let text: string;
  let contentType: string;
  let nextSession: string | undefined = sessionId;
  if (!connection.fetch && connection.allow_insecure_tls) {
    const response = await insecurePost(connection, payload, headers).catch(() => {
      throw Error("mcp_upstream_unavailable");
    });
    status = response.status;
    text = response.text;
    contentType = response.header("content-type") ?? "";
    nextSession = response.header("mcp-session-id") ?? sessionId;
  } else {
    let response: Response;
    try {
      response = await fetcher(connection.endpoint, {
        method: "POST",
        redirect: "error",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(connection.timeout_ms ?? 20000),
      });
    } catch {
      throw Error("mcp_upstream_unavailable");
    }
    nextSession = response.headers.get("mcp-session-id") ?? sessionId;
    if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? "integration_http_401" : `integration_http_${response.status}`);
    text = await readText(response);
    contentType = response.headers.get("content-type") ?? "";
    return interpret(text, contentType, nextSession);
  }
  if (status < 200 || status >= 300) {
    throw Error(status === 401 || status === 403 ? "integration_http_401" : `integration_http_${status}`);
  }
  return interpret(text, contentType, nextSession);
}

function interpret(
  text: string,
  contentType: string,
  sessionId?: string,
): { messages: JsonRpcMessage[]; sessionId?: string } {
  if (!text.trim()) return { messages: [], sessionId };
  if (contentType.includes("text/event-stream") || text.trimStart().startsWith("event:") || text.trimStart().startsWith("data:")) {
    return { messages: parseSse(text), sessionId };
  }
  try {
    return { messages: [JSON.parse(text) as JsonRpcMessage], sessionId };
  } catch {
    throw Error("mcp_invalid_response");
  }
}

/**
 * Minimal POST over node:https with `rejectUnauthorized: false`.
 *
 * The global `fetch` has no per-request TLS switch, and flipping
 * NODE_TLS_REJECT_UNAUTHORIZED would weaken every other HTTPS call in the
 * server. This path is used only when a manifest opts in.
 */
async function insecurePost(
  connection: McpConnection,
  payload: unknown,
  headers: Record<string, string>,
): Promise<{ status: number; header: (name: string) => string | undefined; text: string }> {
  const url = new URL(connection.endpoint);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw Error("mcp_transport_invalid");
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const body = JSON.stringify(payload);
  return await new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
        signal: AbortSignal.timeout(connection.timeout_ms ?? 20000),
        ...(url.protocol === "https:" ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          // Keep draining the socket but never buffer more than the same 1 MB
          // ceiling the fetch path enforces.
          if (size <= 1024 * 1024) chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            header: (name) => {
              const value = res.headers[name.toLowerCase()];
              return Array.isArray(value) ? value[0] : value;
            },
            text: bounded(Buffer.concat(chunks).toString("utf8")),
          });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function resultOf(messages: JsonRpcMessage[], id: number): unknown {
  const message = messages.find((item) => item.id === id && (item.result !== undefined || item.error));
  if (!message) throw Error("mcp_invalid_response");
  if (message.error) throw Error(`mcp_upstream_error:${message.error.message ?? message.error.code ?? "unknown"}`);
  return message.result;
}

async function initialize(connection: McpConnection): Promise<{ sessionId?: string; protocolVersion?: string }> {
  const { messages, sessionId } = await post(connection, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "jarvis", version: "0.5.0" },
    },
  });
  const result = resultOf(messages, 1) as { protocolVersion?: unknown } | undefined;
  const protocolVersion = typeof result?.protocolVersion === "string" ? result.protocolVersion : undefined;
  // The initialized notification has no id and usually answers 202.
  await post(connection, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId, protocolVersion).catch(() => undefined);
  return { sessionId, ...(protocolVersion ? { protocolVersion } : {}) };
}

function normalizeTool(raw: unknown): McpTool | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const tool = raw as Record<string, unknown>;
  if (typeof tool.name !== "string" || !tool.name) return undefined;
  const annotations = tool.annotations && typeof tool.annotations === "object"
    ? (tool.annotations as Record<string, unknown>)
    : undefined;
  return {
    name: tool.name,
    description: typeof tool.description === "string" ? tool.description : "",
    input_schema: tool.inputSchema ?? tool.input_schema ?? { type: "object", properties: {} },
    read_only: annotations?.readOnlyHint === true || annotations?.read_only_hint === true,
  };
}

export async function listMcpTools(connection: McpConnection): Promise<McpTool[]> {
  const { sessionId, protocolVersion } = await initialize(connection);
  const { messages } = await post(connection, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId, protocolVersion);
  const result = resultOf(messages, 2) as { tools?: unknown } | undefined;
  const tools = Array.isArray(result?.tools) ? result!.tools : [];
  return tools.map(normalizeTool).filter((tool): tool is McpTool => Boolean(tool));
}

export async function callMcpTool(
  connection: McpConnection,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  const { sessionId, protocolVersion } = await initialize(connection);
  const { messages } = await post(connection, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  }, sessionId, protocolVersion);
  const result = resultOf(messages, 3) as { content?: unknown; isError?: boolean; is_error?: boolean } | undefined;
  return {
    content: result?.content ?? result ?? null,
    is_error: result?.isError === true || result?.is_error === true,
  };
}
