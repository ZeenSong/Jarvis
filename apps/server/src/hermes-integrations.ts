import { ImmichClient } from "../../../packages/integration-immich/src/index.js";

async function json(url: string, init: RequestInit = {}) {
  if (!/^https?:\/\//.test(url)) throw Error("integration_url_invalid");
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Error(`integration_http_${response.status}`);
  return response.json() as Promise<unknown>;
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

export async function immichSearch(args: { query?: string; from?: string; to?: string; page?: number; size?: number } = {}, options: { token?: string } = {}) {
  const base = process.env.IMMICH_URL;
  const token = options.token ?? process.env.IMMICH_API_KEY;
  if (!base || !token) throw Error("immich_not_configured");
  const client = new ImmichClient({ providerId: "immich", baseUrl: base, token: () => token });
  return { provider: "immich", ...(await client.search(args)) };
}
