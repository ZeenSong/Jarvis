import { readFile, stat, writeFile, rename, chmod } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { CasaOSClient, CasaOSError } from "../../../packages/integration-casaos/src/index.js";

/** Read-only, paired-owner bridge. Never send Compose, environment or credentials to clients. */
const refreshes = new Map<string, Promise<void>>();
async function refreshSession(path: string, session: any) {
  let pending = refreshes.get(path);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(new URL("/v1/users/refresh", session.base_url), {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.token.refresh_token }),
      });
      if (!response.ok) throw new CasaOSError("unauthorized");
      const result = await response.json() as any;
      const token = result.data?.token ?? result.data;
      if (!token?.access_token || !token?.refresh_token) throw new CasaOSError("unauthorized");
      const temp = `${path}.${randomUUID()}.pending`;
      await writeFile(temp, JSON.stringify({ base_url: session.base_url, username: session.username, token }), { mode: 0o600, flag: "wx" });
      await rename(temp, path);
    })().finally(() => refreshes.delete(path));
    refreshes.set(path, pending);
  }
  await pending;
}
export async function installedApplications() {
  const result = await readInstalledApplications();
  const launchers = [["casaos", "CasaOS", process.env.CASAOS_PUBLIC_URL], ["immich", "Immich", process.env.IMMICH_URL], ["home-assistant", "Home Assistant", process.env.HOME_ASSISTANT_URL]].filter((entry) => entry[2] && /^https?:\/\//.test(entry[2])).map(([id,name,url]) => ({id,name,url}));
  return { ...result, launchers };
}

/** Reconnect the configured CasaOS account without exposing its session file. */
export async function casaosLogin(username: string, password: string) {
  const path = process.env.CASAOS_SESSION_FILE;
  if (!path || !password || password.length > 512) throw new CasaOSError("request_failed");
  if ((await stat(path)).mode & 0o077) throw new CasaOSError("invalid_response");
  const current = JSON.parse(await readFile(path, "utf8"));
  if (username !== current.username) throw new CasaOSError("unauthorized");
  const response = await fetch(new URL("/v1/users/login", current.base_url), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new CasaOSError("unauthorized", response.status);
  const result = await response.json() as any;
  const token = result.data?.token ?? result.data;
  if (!token?.access_token || !token?.refresh_token) throw new CasaOSError("invalid_response");
  const temp = `${path}.${randomUUID()}.pending`;
  await writeFile(temp, JSON.stringify({ base_url: current.base_url, username, token }, null, 2), { mode: 0o600, flag: "wx" });
  await chmod(temp, 0o600);
  await rename(temp, path);
}

export async function casaosAccount() {
  const path = process.env.CASAOS_SESSION_FILE;
  if (!path) return { configured: false };
  try {
    const session = JSON.parse(await readFile(path, "utf8"));
    return { configured: true, username: typeof session.username === "string" ? session.username : "" };
  } catch { return { configured: false }; }
}
async function readInstalledApplications() {
  const path = process.env.CASAOS_SESSION_FILE;
  if (!path) return { status: "not_configured", apps: [] };
  try {
    if ((await stat(path)).mode & 0o077) return { status: "configuration_error", apps: [] };
    let session = JSON.parse(await readFile(path, "utf8"));
    const client = new CasaOSClient({ baseUrl: session.base_url, accessToken: () => session.token.access_token });
    let apps;
    try { apps = await client.applications(); }
    catch (error) {
      if (!(error instanceof CasaOSError) || error.code !== "unauthorized") throw error;
      await refreshSession(path, session);
      session = JSON.parse(await readFile(path, "utf8"));
      apps = await client.applications();
    }
    return { status: "ready", apps, checked_at: new Date().toISOString() };
  } catch (error) {
    return { status: error instanceof CasaOSError && error.code === "unauthorized" ? "authentication_required" : "unavailable", apps: [] };
  }
}
