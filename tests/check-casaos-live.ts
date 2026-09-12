// Explicit, read-only verification against the real authenticated CasaOS gateway.
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { CasaOSClient } from "../packages/integration-casaos/src/index.js";

const session = JSON.parse(await readFile(process.env.CASAOS_SESSION_FILE ?? ".local/m3-private/casaos-session.json", "utf8"));
const client = new CasaOSClient({ baseUrl: session.base_url, accessToken: () => session.token.access_token });
const [info, store, installed, updates, compose] = await Promise.all([
  client.info(), client.store(), client.installed(), client.updates(), client.storeCompose("gitea"),
]);
for (const name of ["grafana", "portainer", "immich", "gitea"]) {
  assert.ok(store.some((entry) => entry.provider_app_id === name), `${name} missing from real store`);
}
assert.match(compose, /services:/);
const unauthorized = await fetch(`${session.base_url}/v2/app_management/compose`, { signal: AbortSignal.timeout(10000) });
assert.equal(unauthorized.status, 401, "LAN API must require authentication");
console.log(JSON.stringify({ provider: "casaos", authenticated: true, architecture: info.architecture,
  store_count: store.length, installed_count: Object.keys(installed).length, update_count: updates.length,
  store_compose: "verified", unauthorized_lan: "rejected", mutations: "not tested" }, null, 2));
