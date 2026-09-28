import { ImmichClient } from "../../../packages/integration-immich/src/index.js";

async function json(url: string, init: RequestInit = {}) {
  if (!/^https?:\/\//.test(url)) throw Error("integration_url_invalid");
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Error(`integration_http_${response.status}`);
  return response.json() as Promise<unknown>;
}

function frigateHeaders(secret?: string) {
  if (secret !== undefined) {
    try {
      const value = JSON.parse(secret) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const username = (value as Record<string, unknown>).username;
        const password = (value as Record<string, unknown>).password;
        if (typeof username === "string" && username && typeof password === "string" && password) {
          return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
        }
      }
    } catch {
      // A non-JSON secret is the normal Bearer-token form.
    }
    return { Authorization: `Bearer ${secret}` };
  }
  const token = process.env.FRIGATE_TOKEN;
  const username = process.env.FRIGATE_USERNAME;
  const password = process.env.FRIGATE_PASSWORD;
  if ((username && !password) || (!username && password)) throw Error("frigate_credentials_incomplete");
  return token ? { Authorization: `Bearer ${token}` } : username && password ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` } : undefined;
}

/** Hermes-facing read adapters. Credentials are service credentials, never OIDC tokens. */
export async function homeAssistantState(options: { token?: string } = {}) {
  const base = process.env.HOME_ASSISTANT_URL?.replace(/\/$/, "");
  const token = options.token ?? process.env.HOME_ASSISTANT_TOKEN;
  if (!base || !token) throw Error("home_assistant_not_configured");
  const value = await json(`${base}/api/states`, { headers: { Authorization: `Bearer ${token}` } });
  if (!Array.isArray(value)) throw Error("home_assistant_invalid_response");
  return { provider: "home-assistant", entities: value.slice(0, 200).map((item: any) => ({ entity_id: item.entity_id, state: item.state, name: item.attributes?.friendly_name, area: item.attributes?.area_name })) };
}

export async function frigateEvents(args: { after?: number; before?: number; limit?: number } = {}, options: { token?: string } = {}) {
  const base = process.env.FRIGATE_URL?.replace(/\/$/, "");
  if (!base) throw Error("frigate_not_configured");
  const query = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, args.limit ?? 40))), ...(args.after === undefined ? {} : { after: String(args.after) }), ...(args.before === undefined ? {} : { before: String(args.before) }) });
  const headers = options.token ? frigateHeaders(options.token) : frigateHeaders();
  const value = await json(`${base}/api/events?${query}`, headers ? { headers } : {});
  if (!Array.isArray(value)) throw Error("frigate_invalid_response");
  return { provider: "frigate", events: value.slice(0, 100).map((item: any) => ({ id: item.id, camera: item.camera, label: item.label, start_time: item.start_time, end_time: item.end_time, has_clip: Boolean(item.has_clip), has_snapshot: Boolean(item.has_snapshot) })) };
}

export async function frigateEventSnapshot(args: { event_id: string }, options: { token?: string } = {}) {
  const base = process.env.FRIGATE_URL?.replace(/\/$/, "");
  if (!base) throw Error("frigate_not_configured");
  if (!/^[a-zA-Z0-9._-]{1,200}$/.test(args.event_id)) throw Error("frigate_event_id_invalid");
  const headers = options.token ? frigateHeaders(options.token) : frigateHeaders();
  const response = await fetch(`${base}/api/events/${encodeURIComponent(args.event_id)}/snapshot.jpg`, { redirect: "error", headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Error(`integration_http_${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (!(["image/jpeg", "image/png", "image/webp"] as string[]).includes(contentType)) throw Error("frigate_invalid_snapshot");
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length || data.length > 2 * 1024 * 1024) throw Error("frigate_snapshot_too_large");
  return { provider: "frigate", event_id: args.event_id, data, contentType: contentType as "image/jpeg" | "image/png" | "image/webp" };
}

export async function immichSearch(args: { query?: string; from?: string; to?: string; page?: number; size?: number } = {}, options: { token?: string } = {}) {
  const base = process.env.IMMICH_URL;
  const token = options.token ?? process.env.IMMICH_API_KEY;
  if (!base || !token) throw Error("immich_not_configured");
  const client = new ImmichClient({ providerId: "immich", baseUrl: base, token: () => token });
  return { provider: "immich", ...(await client.search(args)) };
}
