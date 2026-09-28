/**
 * Run the M3.2 provider path through the real Kernel capability route.
 *
 * This script creates a user, conversation and temporary provider credentials
 * in the supplied database. Run it only against a throwaway database with
 * M32_ALLOW_MUTATION=1; it never prints credential values.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { buildApp } from "../apps/server/src/app.js";
import { upsertOidcIdentity } from "../apps/server/src/oidc.js";
import { createHermesContextToken } from "../packages/hermes-bridge/src/index.js";

if (process.env.M32_ALLOW_MUTATION !== "1") throw Error("set M32_ALLOW_MUTATION=1 only for a throwaway database");
const databaseUrl = process.env.DATABASE_URL;
const bridgeKey = process.env.HERMES_BRIDGE_KEY;
const credentialKey = process.env.INTEGRATION_CREDENTIAL_KEY;
const homeAssistantToken = process.env.M32_HA_TOKEN;
const immichKey = process.env.M32_IMMICH_KEY;
if (!databaseUrl || !bridgeKey || !credentialKey || !homeAssistantToken || !immichKey) {
  throw Error("DATABASE_URL, HERMES_BRIDGE_KEY, INTEGRATION_CREDENTIAL_KEY, M32_HA_TOKEN and M32_IMMICH_KEY are required");
}

const ctx = await buildApp({ databaseUrl });
try {
  const identity = await upsertOidcIdentity(ctx.db, {
    issuer: "https://m32-real-smoke.example",
    subject: `real-provider-${randomUUID()}`,
    preferred_username: "real-provider-user",
    email: "real-provider@example.test",
  });
  const device = `m32-real-device-${randomUUID()}`;
  await ctx.db.query("INSERT INTO devices(id,token_hash,role,user_id) VALUES($1,$2,'device',$3)", [device, randomUUID(), identity.user.id]);
  for (const [provider, secret] of [
    ["home-assistant", homeAssistantToken],
    ["frigate", process.env.M32_FRIGATE_TOKEN ?? "m32-frigate-internal-smoke"],
    ["immich", immichKey],
  ] as const) {
    await ctx.m2.integrationCredentials.put(device, { provider, label: "M3.2 real smoke", secret, metadata: {} });
  }

  const conversation = await ctx.m2.handle("conversation.create", { title: "M3.2 real provider smoke" }, device) as { id: string };
  const accepted = await ctx.m2.handle("conversation.message", {
    conversation_id: conversation.id,
    content: "真实 provider smoke",
    idempotency_key: randomUUID(),
  }, device) as { turn_id: string; reply_id: string };
  await ctx.db.query("UPDATE conversation_turns SET status='running' WHERE id=$1", [accepted.turn_id]);
  await ctx.db.query("UPDATE conversation_messages SET status='streaming' WHERE id=$1", [accepted.reply_id]);

  const contextToken = createHermesContextToken(bridgeKey, device, conversation.id, 600, {
    actor: identity.user.id,
    household: identity.household.id,
    scopes: ["home.read", "camera.read", "photo.read"],
  });
  const address = await ctx.app.listen({ host: "0.0.0.0", port: 0 });
  const port = Number(new URL(address).port);
  const providerImage = process.env.M32_HERMES_IMAGE ?? "jarvis-hermes-dashboard:20260920";
  const provider = spawn("docker", [
    "run", "--rm", "-i", "--add-host", "host.docker.internal:host-gateway",
    "--entrypoint", "/opt/hermes/.venv/bin/python",
    "-e", `JARVIS_INTERNAL_URL=http://host.docker.internal:${port}`,
    "-e", `JARVIS_BRIDGE_KEY=${bridgeKey}`,
    "-v", `${resolve(process.cwd(), "apps/hermes-mcp/jarvis_provider.py")}:/tmp/jarvis_provider.py:ro`,
    providerImage,
    "/tmp/jarvis_provider.py",
  ], { stdio: ["pipe", "pipe", "pipe"] });
  provider.stderr.resume();
  const lines = createInterface({ input: provider.stdout })[Symbol.asyncIterator]();
  async function nextResponse() {
    while (true) {
      const next = await lines.next();
      if (next.done) throw Error("hermes_mcp_process_exited");
      if (!next.value.trim()) continue;
      return JSON.parse(next.value) as any;
    }
  }
  async function request(id: number, method: string, params: Record<string, unknown>) {
    provider.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const response = await nextResponse();
    if (response.id !== id) throw Error(`hermes_mcp_unexpected_response:${response.id}`);
    if (response.error) throw Error(`hermes_mcp_error:${JSON.stringify(response.error)}`);
    return response.result;
  }
  function resultText(result: any) {
    const text = result?.content?.find((item: any) => item.type === "text")?.text;
    if (typeof text !== "string") throw Error("hermes_mcp_text_result_missing");
    const outer = JSON.parse(text);
    if (typeof outer === "string") return JSON.parse(outer);
    if (typeof outer?.result === "string") return JSON.parse(outer.result);
    return outer;
  }
  async function call(tool: string, arguments_: Record<string, unknown> = {}) {
    return resultText(await request(nextId++, "tools/call", { name: tool, arguments: { context_token: contextToken, ...arguments_ } }));
  }
  let nextId = 1;
  try {
    const initialized = await request(nextId++, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "jarvis-m32-smoke", version: "1.0" } });
    provider.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    const listing = await request(nextId++, "tools/list", {});
    const required = ["home_assistant_state", "frigate_events_read", "frigate_event_snapshot_read", "immich_photo_search"];
    if (!required.every((name) => listing.tools?.some((tool: any) => tool.name === name))) throw Error("hermes_mcp_required_tool_missing");
    const homeAssistant = await call("home_assistant_state");
    const frigate = await call("frigate_events_read", { limit: 1 });
    if (!Array.isArray(frigate?.events)) throw Error(`hermes_mcp_frigate_shape:${JSON.stringify({ keys: Object.keys(frigate ?? {}), value: frigate }).slice(0, 2000)}`);
    const snapshot = frigate.events[0]
      ? await call("frigate_event_snapshot_read", { event_id: frigate.events[0].id })
      : undefined;
    const immich = await call("immich_photo_search", { page: 1, size: 1 });
    const activityCount = (await ctx.db.query(
      "SELECT count(*)::int AS count FROM conversation_activities WHERE turn_id=$1",
      [accepted.turn_id],
    )).rows[0].count;
    console.log(JSON.stringify({
      mcp_initialize: Boolean(initialized?.protocolVersion),
      mcp_tools: listing.tools.length,
      ha_entities: homeAssistant.entities.length,
      frigate_events: frigate.events.length,
      frigate_snapshot: Boolean(snapshot?.thumbnail),
      immich_photos: immich.photos.length,
      conversation_activities: activityCount,
    }));
  } finally {
    provider.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        provider.kill("SIGKILL");
        resolve();
      }, 3000);
      provider.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
} finally {
  await ctx.app.close();
}
