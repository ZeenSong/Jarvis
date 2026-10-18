import { createHash } from "node:crypto";
import type { CompiledManifest, HttpAuth, HttpOperation } from "./manifest.js";

/**
 * Execute the REST operations declared by an HTTP manifest.
 *
 * Security properties, in order of importance:
 * - The model chooses an operation *name*, never a method, host or path prefix.
 * - Path values are URL-encoded; the final URL must still start with the
 *   configured base URL, so `../` cannot escape the app.
 * - Responses are bounded and the credential never appears in a result.
 */

export type HttpCallResult = {
  ok: boolean;
  status: number;
  content_type: string;
  data: unknown;
  truncated: boolean;
};

export type HttpCallOptions = {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  timeout_ms?: number;
  max_response_bytes?: number;
};

/**
 * Session cookies are process-local and keyed by provider + secret hash. They
 * are never written to the database, a response or a log.
 */
const sessions = new Map<string, string>();

function sessionKey(manifest: CompiledManifest, secret: string) {
  return `${manifest.id}:${createHash("sha256").update(secret).digest("hex").slice(0, 24)}`;
}

export function httpBase(manifest: CompiledManifest, env: NodeJS.ProcessEnv = process.env): string {
  if (manifest.transport.type !== "http") throw Error("app_not_http");
  const base = manifest.transport.base_url
    ?? (manifest.transport.base_env ? env[manifest.transport.base_env]?.trim() : undefined);
  if (!base) throw Error("app_not_configured");
  const url = new URL(base);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw Error("app_not_configured");
  return `${url.origin}${url.pathname}`.replace(/\/$/, "");
}

function splitCredential(secret: string): [string, string] {
  const separator = secret.indexOf(":");
  if (separator < 1) throw Error("invalid_credentials");
  return [secret.slice(0, separator), secret.slice(separator + 1)];
}

function coerce(type: "string" | "number" | "boolean", value: unknown): string | number | boolean {
  if (type === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) throw Error("app_tool_arguments_invalid");
    return number;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === 1 || value === "1") return true;
    if (value === "false" || value === 0 || value === "0") return false;
    throw Error("app_tool_arguments_invalid");
  }
  if (typeof value === "string") {
    if (value.length > 4000) throw Error("app_tool_arguments_invalid");
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw Error("app_tool_arguments_invalid");
}

function authHeader(auth: HttpAuth, secret: string): Record<string, string> {
  switch (auth.mode) {
    case "none":
      return {};
    case "bearer":
      return { Authorization: `Bearer ${secret}` };
    case "header":
      return { [auth.header]: auth.scheme ? `${auth.scheme} ${secret}` : secret };
    case "basic":
      return { Authorization: `Basic ${Buffer.from(secret, "utf8").toString("base64")}` };
    case "query":
    case "session":
      return {};
  }
}

function cookieFrom(response: Response, name: string): string | undefined {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  for (const cookie of cookies) {
    const first = cookie.split(";", 1)[0] ?? "";
    const separator = first.indexOf("=");
    if (separator < 1) continue;
    if (first.slice(0, separator).trim() !== name) continue;
    return `${name}=${first.slice(separator + 1).trim()}`;
  }
  return undefined;
}

async function openSession(
  manifest: CompiledManifest,
  auth: Extract<HttpAuth, { mode: "session" }>,
  secret: string,
  base: string,
  fetcher: typeof fetch,
  timeout_ms: number,
): Promise<string> {
  const [username, password] = splitCredential(secret);
  const fields = Object.fromEntries(
    Object.entries(auth.login_fields).map(([key, value]) => [
      key,
      value.replaceAll("{username}", username).replaceAll("{password}", password),
    ]),
  );
  const body = auth.login_format === "json"
    ? JSON.stringify(fields)
    : new URLSearchParams(fields).toString();
  const response = await fetcher(`${base}${auth.login_path}`, {
    method: auth.login_method,
    headers: {
      "Content-Type": auth.login_format === "json" ? "application/json" : "application/x-www-form-urlencoded",
      // qBittorrent (and most CSRF-protected self-hosted UIs) reject a login
      // POST whose Origin/Referer do not match the app.
      Origin: base,
      Referer: `${base}/`,
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(timeout_ms),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw Error("invalid_credentials");
    throw Error(`integration_http_${response.status}`);
  }
  if (auth.ok_body_contains && !text.includes(auth.ok_body_contains)) throw Error("invalid_credentials");
  const cookie = cookieFrom(response, auth.cookie_name);
  if (!cookie) throw Error("invalid_credentials");
  return cookie;
}

function buildUrl(
  base: string,
  operation: HttpOperation,
  args: Record<string, unknown>,
): { url: URL; body: { payload: string; content_type: string } | undefined } {
  let path = operation.path;
  for (const param of operation.params) {
    if (param.in !== "path") continue;
    const value = args[param.name];
    if (value === undefined || value === null || value === "") {
      if (param.required) throw Error("app_tool_arguments_invalid");
      continue;
    }
    path = path.replaceAll(`{${param.name}}`, encodeURIComponent(String(coerce(param.type, value))));
  }
  if (/\{[a-zA-Z][a-zA-Z0-9_]*\}/.test(path)) throw Error("app_tool_arguments_invalid");
  const url = new URL(`${base}${path.startsWith("/") ? "" : "/"}${path}`);
  if (url.origin !== new URL(base).origin) throw Error("app_tool_arguments_invalid");

  const bodyFields: Record<string, string | number | boolean> = {};
  for (const param of operation.params) {
    if (param.in !== "query" && param.in !== "body") continue;
    const value = args[param.name];
    if (value === undefined || value === null || value === "") {
      if (param.required) throw Error("app_tool_arguments_invalid");
      continue;
    }
    const coerced = coerce(param.type, value);
    if (param.in === "query") url.searchParams.set(param.name, String(coerced));
    else bodyFields[param.name] = coerced;
  }

  const method = operation.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "DELETE") {
    if (Object.keys(bodyFields).length) throw Error("app_tool_arguments_invalid");
    return { url, body: undefined };
  }

  // An operation may declare body parameters, or the caller may pass a single
  // `body` object for APIs whose shape is not worth modelling per operation.
  const payload = Object.keys(bodyFields).length
    ? bodyFields
    : args.body && typeof args.body === "object" && !Array.isArray(args.body)
      ? (args.body as Record<string, unknown>)
      : undefined;
  if (!payload) return { url, body: undefined };
  if (operation.body_format === "form") {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) continue;
      form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    return { url, body: { payload: form.toString(), content_type: "application/x-www-form-urlencoded" } };
  }
  return { url, body: { payload: JSON.stringify(payload), content_type: "application/json" } };
}

async function readBounded(response: Response, limit: number): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) {
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(chunk.value);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

function parseBody(text: string, contentType: string): unknown {
  if (!text) return null;
  if (/[/+]json\b/i.test(contentType)) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(0, 4000);
    }
  }
  return text.slice(0, 12000);
}

/**
 * Run one operation. `secret` may be empty only for `auth.mode === "none"`.
 */
export async function callHttpOperation(
  manifest: CompiledManifest,
  secret: string,
  operation: HttpOperation,
  args: Record<string, unknown> = {},
  options: HttpCallOptions = {},
): Promise<HttpCallResult> {
  if (manifest.transport.type !== "http") throw Error("app_not_http");
  const fetcher = options.fetch ?? fetch;
  const env = options.env ?? process.env;
  const base = httpBase(manifest, env);
  const timeout = options.timeout_ms ?? manifest.transport.timeout_ms;
  const limit = options.max_response_bytes ?? manifest.transport.max_response_bytes;
  const auth = manifest.transport.auth;
  if (auth.mode !== "none" && !secret) throw Error("credential_required");

  let cookie: string | undefined;
  if (auth.mode === "session") {
    const key = sessionKey(manifest, secret);
    cookie = sessions.get(key);
    if (!cookie) {
      cookie = await openSession(manifest, auth, secret, base, fetcher, timeout);
      sessions.set(key, cookie);
    }
  }

  const { url, body } = buildUrl(base, operation, args);
  if (auth.mode === "query") url.searchParams.set(auth.param, secret);
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain;q=0.9, */*;q=0.5",
    ...authHeader(auth, secret),
    ...(cookie ? { Cookie: cookie } : {}),
    // Session-based apps commonly enforce same-origin CSRF checks on writes.
    ...(auth.mode === "session" ? { Origin: base, Referer: `${base}/` } : {}),
    ...(body ? { "Content-Type": body.content_type } : {}),
  };

  const run = async () => fetcher(url, {
    method: operation.method,
    headers,
    ...(body ? { body: body.payload } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  });

  let response = await run();
  if (auth.mode === "session" && auth.renew_on.includes(response.status)) {
    // The cookie expired. Renew once; a second failure is reported as-is.
    sessions.delete(sessionKey(manifest, secret));
    cookie = await openSession(manifest, auth, secret, base, fetcher, timeout);
    sessions.set(sessionKey(manifest, secret), cookie);
    headers.Cookie = cookie;
    response = await run();
  }

  const { text, truncated } = await readBounded(response, limit);
  if (response.status === 401 || response.status === 403) throw Error(`integration_http_${response.status}`);
  return {
    ok: response.ok,
    status: response.status,
    content_type: response.headers.get("content-type") ?? "",
    data: parseBody(text, response.headers.get("content-type") ?? ""),
    truncated,
  };
}

/**
 * Connectivity probe used by "test credential" and `app_test`. It reuses the
 * transport auth, so a session app really proves it can log in.
 */
export async function probeHttp(
  manifest: CompiledManifest,
  secret: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { fetch?: typeof fetch } = {},
): Promise<{ connected: boolean; status?: number; error?: string; duration_ms: number }> {
  const started = Date.now();
  if (manifest.transport.type !== "http") {
    return { connected: false, error: "unsupported_provider", duration_ms: 0 };
  }
  const probe = manifest.healthcheck;
  const operation: HttpOperation = probe
    ? {
        name: "__health",
        description: "",
        method: probe.method === "HEAD" ? "GET" : probe.method,
        path: probe.path,
        read_only: true,
        params: [],
        body_format: "json",
      }
    : manifest.transport.operations.find((item) => item.read_only)
      ?? {
        name: "__health",
        description: "",
        method: "GET",
        path: "/",
        read_only: true,
        params: [],
        body_format: "json",
      };
  try {
    const result = await callHttpOperation(manifest, secret, operation, {}, { env, ...(options.fetch ? { fetch: options.fetch } : {}) });
    const okStatus = probe?.ok_status ?? [200];
    const connected = okStatus.includes(result.status);
    return {
      connected,
      status: result.status,
      ...(connected ? {} : { error: result.status === 401 || result.status === 403 ? "invalid_credentials" : "service_unavailable" }),
      duration_ms: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "service_unavailable";
    return {
      connected: false,
      ...(message === "invalid_credentials" || message === "integration_http_401" || message === "integration_http_403"
        ? { error: "invalid_credentials" }
        : { error: "service_unavailable" }),
      duration_ms: Date.now() - started,
    };
  }
}

/** Test-only hook: drop every cached session cookie. */
export function clearHttpSessions() {
  sessions.clear();
}
