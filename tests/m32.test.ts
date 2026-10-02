import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "../apps/server/src/app.js";
import { contextAllows, createHermesContextToken, verifyHermesContextToken } from "../packages/hermes-bridge/src/index.js";
import { activityGroupKey, canTransitionActivity, canTransitionTurn, summarizeActivityGroup } from "../packages/conversation/src/model.js";
import { oidcAuthorizationUrl, upsertOidcIdentity } from "../apps/server/src/oidc.js";
import { readFileSync } from "node:fs";
import { JarvisAssistantAdapter } from "../apps/web/src/assistant-ui-adapter.js";
import { homeAssistantState, immichSearch } from "../apps/server/src/hermes-integrations.js";

test("M3.2 context token carries actor, household, session and scopes", () => {
  const token = createHermesContextToken("secret", "device-1", "session-1", 600, { actor: "user-1", household: "household-1", run: "run-1", scopes: ["home.read"] });
  const context = verifyHermesContextToken("secret", token);
  assert.deepEqual(context, { owner: "device-1", actor: "user-1", household: "household-1", session: "session-1", run: "run-1", scopes: ["home.read"], exp: context!.exp });
  assert.equal(contextAllows(context!, "home.read"), true);
  assert.equal(contextAllows(context!, "camera.read"), false);
  assert.equal(verifyHermesContextToken("wrong", token), undefined);
});

test("M3.2 turn and activity state machines reject terminal regressions and group tool noise", () => {
  assert.equal(canTransitionTurn("queued", "running"), true);
  assert.equal(canTransitionTurn("completed", "running"), false);
  assert.equal(canTransitionActivity("waiting_approval", "completed"), true);
  assert.equal(canTransitionActivity("failed", "running"), false);
  assert.equal(canTransitionActivity("completed", "waiting_approval"), false);
  assert.equal(activityGroupKey("homeassistant.camera_snapshot"), "homeassistant camera snapshot");
  assert.deepEqual(summarizeActivityGroup([
    { capability: "homeassistant.camera_list", status: "completed" },
    { capability: "homeassistant.camera_snapshot", status: "running" },
  ]), [{ key: "homeassistant camera list", count: 1, completed: 1, failed: 0, running: 0 }, { key: "homeassistant camera snapshot", count: 1, completed: 0, failed: 0, running: 1 }]);
});

test("M3.2 OIDC authorization uses discovery and PKCE without exposing secrets", async () => {
  const result = await oidcAuthorizationUrl({ AUTHENTIK_ISSUER: "https://auth.example/application/o/jarvis", AUTHENTIK_CLIENT_ID: "client", AUTHENTIK_CLIENT_SECRET: "secret", AUTHENTIK_REDIRECT_URI: "https://jarvis.example/api/v2/auth/oidc/callback" }, async () => Response.json({ authorization_endpoint: "https://auth.example/application/o/authorize", token_endpoint: "https://auth.example/application/o/token", userinfo_endpoint: "https://auth.example/application/o/userinfo" }));
  assert.ok(result);
  const url = new URL(result!.url);
  assert.equal(url.searchParams.get("client_id"), "client");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge")?.length, 43);
  assert.equal(url.searchParams.has("client_secret"), false);
});

test("M3.2 deployed Hermes provider exposes the kernel and transparent upstream MCP bridge", () => {
  const manifest = readFileSync(new URL("../deploy/k8s/hermes.yaml", import.meta.url), "utf8");
  const jarvisSource = readFileSync(new URL("../apps/hermes-mcp/jarvis_provider.py", import.meta.url), "utf8");
  assert.match(manifest, /Hermes native Skills, toolsets and configured MCP servers are/);
  assert.match(manifest, /homeassistant:[\s\S]*?\/opt\/jarvis-source\/upstream_provider\.py/);
  assert.match(manifest, /immich:[\s\S]*?\/opt\/jarvis-source\/upstream_provider\.py/);
  assert.doesNotMatch(manifest.match(/config\.yaml: \|([\s\S]*?)  jarvis_provider\.py: \|/)?.[1] ?? "", /\/opt\/jarvis-mcp\/(?:jarvis|upstream)_provider\.py/);
  assert.doesNotMatch(manifest, /frigate_provider\.py|FRIGATE_/);
  assert.match(manifest, /upstream_provider\.py: \|/);
  assert.match(manifest, /media_janitor\.py: \|/);
  assert.match(manifest, /name: media-janitor/);
  assert.match(manifest, /\/opt\/data\/media\/tmp/);
  const serverManifest = readFileSync(new URL("../deploy/k8s/server.yaml", import.meta.url), "utf8");
  assert.match(serverManifest, /HERMES_MEDIA_ROOT/);
  assert.match(serverManifest, /subPath: media/);
  for (const tool of ["mcp_tools_list", "mcp_tool_call", "schedule_create", "conversation_question_create"]) {
    assert.match(manifest, new RegExp(`def ${tool}\\(`));
  }
  assert.match(jarvisSource, /def _homeassistant_cameras\(/);
  assert.match(jarvisSource, /\/api\/camera_proxy\//);
  assert.doesNotMatch(manifest, /def home_assistant_state\(/);
  assert.doesNotMatch(manifest, /def immich_photo_search\(/);
  assert.match(manifest, /mcp_authorize/);
  assert.match(jarvisSource, /immich_assets_download_thumbnail/);
  assert.match(jarvisSource, /MEDIA_RESOURCE:/);
  assert.match(jarvisSource, /thumbnail\?size=preview/);
});

test("M3.2 Authentik PoC is Docker-first and keeps secrets in environment", () => {
  const compose = readFileSync(new URL("../deploy/authentik/compose.yaml", import.meta.url), "utf8");
  for (const service of ["postgresql:", "redis:", "server:", "worker:"]) assert.match(compose, new RegExp(`^  ${service}`, "m"));
  assert.match(compose, /ghcr\.io\/goauthentik\/server:/);
  assert.match(compose, /POSTGRES_PASSWORD:\s*\$\{AUTHENTIK_POSTGRES_PASSWORD/);
  assert.match(compose, /AUTHENTIK_SECRET_KEY:\s*\$\{/);
  assert.doesNotMatch(compose, /password:\s+(change-me|secret|admin)/i);
});

test("M3.2 assistant-ui adapter resumes after a Gateway interruption and emits tool results", async () => {
  let reads = 0;
  const calls: string[] = [];
  const gateway = {
    async *stream() {
      yield { topic: "connection", payload: "已连接" };
    },
    request: async (topic: string) => {
      calls.push(topic);
      if (topic === "conversation.message") return { reply_id: "reply-1", turn_id: "turn-1" };
      if (topic === "conversation.get") {
        reads += 1;
        return {
          messages: [{ id: "reply-1", role: "jarvis", content: "完成", status: "completed" }],
          activities: [{ id: "activity-1", turn_id: "turn-1", tool_call_id: "call-1", capability: "system.status.read", status: "completed", output: { status: "ok" } }],
        };
      }
      throw Error(`unexpected_${topic}`);
    },
  };
  const adapter = new JarvisAssistantAdapter(gateway as any, "conversation-1", true);
  const updates: any[] = [];
  const stream = adapter.model.run({ messages: [{ role: "user", content: [{ type: "text", text: "状态" }] }], abortSignal: new AbortController().signal } as any) as AsyncGenerator<any>;
  for await (const update of stream) updates.push(update);
  assert.equal(reads, 1);
  assert.deepEqual(calls, ["conversation.message", "conversation.get"]);
  assert.equal(updates.at(-1).content[0].text, "完成");
  assert.equal(updates.at(-1).content[1].type, "tool-call");
  assert.deepEqual(updates.at(-1).content[1].result, { status: "ok" });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
test("M3.2 identity, MCP authorization, Activity, Approval and Question integration", { skip: !databaseUrl, timeout: 20000 }, async () => {
  const oldBridgeKey = process.env.HERMES_BRIDGE_KEY;
  process.env.HERMES_BRIDGE_KEY = "m32-integration-bridge-key";
  const ctx = await buildApp({ databaseUrl: databaseUrl! });
  try {
    for (const cookie of [undefined, "jarvis_oidc_state=different-browser"]) {
      const callback = await ctx.app.inject({ method: "GET", url: "/api/v2/auth/oidc/callback?code=code&state=original-browser", headers: cookie ? { cookie } : {} });
      assert.equal(callback.statusCode, 401);
      assert.equal(callback.json().error, "oidc_invalid_browser_state");
    }
    const issuer = `https://auth-${randomUUID()}.example`;
    const first = await upsertOidcIdentity(ctx.db, { issuer, subject: "subject-1", preferred_username: "household-member", email: "member@example.test" });
    const second = await upsertOidcIdentity(ctx.db, { issuer, subject: "subject-1", preferred_username: "renamed-member", email: "member@example.test" });
    assert.equal(second.user.id, first.user.id);
    assert.equal((await ctx.db.query("SELECT count(*)::int AS count FROM user_identities WHERE issuer=$1 AND subject=$2", [issuer, "subject-1"])).rows[0].count, 1);
    assert.equal((await ctx.db.query("SELECT count(*)::int AS count FROM household_members WHERE user_id=$1", [first.user.id])).rows[0].count, 1);
    const otherMember = await upsertOidcIdentity(ctx.db, { issuer, subject: "subject-2", preferred_username: "second-member", email: "second@example.test" });
    assert.notEqual(otherMember.user.id, first.user.id);
    assert.equal(otherMember.household.id, first.household.id);
    assert.ok((await ctx.db.query("SELECT count(*)::int AS count FROM household_members WHERE household_id=$1", [first.household.id])).rows[0].count >= 2);

    const deviceId = `m32-device-${randomUUID()}`;
    await ctx.db.query("INSERT INTO devices(id,token_hash,role,user_id) VALUES($1,$2,'device',$3)", [deviceId, randomUUID(), first.user.id]);
    const oldCredentialKey = process.env.INTEGRATION_CREDENTIAL_KEY;
    process.env.INTEGRATION_CREDENTIAL_KEY = randomBytes(32).toString("base64url");
    try {
      const stored = await ctx.m2.integrationCredentials.put(deviceId, { provider: "home-assistant", label: "M3.2 test", secret: "stored-ha-token", metadata: {} });
      const ciphertext = (await ctx.db.query("SELECT secret_ciphertext FROM integration_credentials WHERE id=$1", [stored.id])).rows[0].secret_ciphertext;
      assert.notEqual(ciphertext, "stored-ha-token");
      assert.equal(await ctx.m2.integrationCredentials.readProviderSecret(deviceId, "home-assistant"), "stored-ha-token");
      await ctx.m2.integrationCredentials.revoke(deviceId, stored.id);
      assert.equal((await ctx.m2.integrationCredentials.list(deviceId)).some((item: any) => item.id === stored.id), false);
    } finally {
      if (oldCredentialKey === undefined) delete process.env.INTEGRATION_CREDENTIAL_KEY;
      else process.env.INTEGRATION_CREDENTIAL_KEY = oldCredentialKey;
    }
    const conversation = await ctx.m2.handle("conversation.create", { title: "M3.2 integration" }, deviceId) as any;
    const accepted = await ctx.m2.handle("conversation.message", { conversation_id: conversation.id, content: "查看家庭状态", idempotency_key: randomUUID() }, deviceId) as any;
    await ctx.db.query("UPDATE conversation_turns SET status='running' WHERE id=$1", [accepted.turn_id]);
    await ctx.db.query("UPDATE conversation_messages SET status='streaming' WHERE id=$1", [accepted.reply_id]);
    const prematureSchedule = await ctx.app.inject({
      method: "POST", url: "/internal/hermes/capability",
      headers: { "x-jarvis-bridge-key": process.env.HERMES_BRIDGE_KEY },
      payload: { tool: "schedule_create", arguments: { prompt: "每天早上检查家里的状态", cadence: "daily" }, context_token: createHermesContextToken(process.env.HERMES_BRIDGE_KEY!, deviceId, conversation.id, 600, { actor: first.user.id, household: first.household.id, scopes: ["conversation.write"] }) },
    });
    assert.ok(prematureSchedule.statusCode >= 400);
    assert.match(prematureSchedule.body, /schedule_time_required/);
    assert.equal((await ctx.db.query("SELECT count(*)::int AS count FROM schedules WHERE conversation_id=$1", [conversation.id])).rows[0].count, 0);
    await ctx.m2.conversations.recordActivity(deviceId, accepted.turn_id, "started", { tool_call_id: "call-1", capability: "homeassistant.state.read", input: { entity: "sensor.test" } });
    const questionResponse = await ctx.app.inject({
      method: "POST",
      url: "/internal/hermes/capability",
      headers: { "x-jarvis-bridge-key": process.env.HERMES_BRIDGE_KEY },
      payload: { tool: "conversation_question_create", arguments: { kind: "boolean", prompt: "继续吗?", options: [] }, context_token: createHermesContextToken(process.env.HERMES_BRIDGE_KEY!, deviceId, conversation.id, 600, { actor: first.user.id, household: first.household.id, scopes: ["conversation.write"] }) },
    });
    assert.equal(questionResponse.statusCode, 200, questionResponse.body);
    const question = questionResponse.json();
    await ctx.m2.conversations.answerQuestion(deviceId, question.id, true);
    const activity = (await ctx.db.query("SELECT id FROM conversation_activities WHERE turn_id=$1 AND tool_call_id='call-1'", [accepted.turn_id])).rows[0];
    const approval = await ctx.m2.control.createApproval(deviceId, { turn_id: accepted.turn_id, activity_id: activity.id, capability: "schedule.create", input: { prompt: "test" } });
    assert.equal((await ctx.db.query("SELECT status FROM conversation_turns WHERE id=$1", [accepted.turn_id])).rows[0].status, "waiting_approval");
    assert.equal((await ctx.db.query("SELECT status FROM conversation_activities WHERE id=$1", [activity.id])).rows[0].status, "waiting_approval");
    await ctx.m2.control.resolveApproval(deviceId, approval.id, "approved");
    assert.equal((await ctx.db.query("SELECT status FROM conversation_activities WHERE id=$1", [activity.id])).rows[0].status, "running");
    await ctx.m2.conversations.recordActivity(deviceId, accepted.turn_id, "completed", { tool_call_id: "call-1", capability: "homeassistant.state.read", result: { state: "on" } });
    const snapshot = await ctx.m2.handle("conversation.get", { conversation_id: conversation.id }, deviceId) as any;
    assert.equal(snapshot.turns[0].id, accepted.turn_id);
    assert.equal(snapshot.activities.find((item: any) => item.id === activity.id).status, "completed");
    assert.equal(snapshot.questions[0].status, "answered");
    assert.equal(snapshot.approvals[0].status, "approved");

    const denied = await ctx.app.inject({
      method: "POST",
      url: "/internal/hermes/capability",
      headers: { "x-jarvis-bridge-key": process.env.HERMES_BRIDGE_KEY },
      payload: { tool: "home_assistant_state", arguments: {}, context_token: createHermesContextToken(process.env.HERMES_BRIDGE_KEY!, deviceId, conversation.id, 600, { actor: first.user.id, household: first.household.id, scopes: ["system.read"] }) },
    });
    assert.equal(denied.statusCode, 403);
  } finally {
    await ctx.app.close();
    if (oldBridgeKey === undefined) delete process.env.HERMES_BRIDGE_KEY;
    else process.env.HERMES_BRIDGE_KEY = oldBridgeKey;
  }
});

test("M3.2 Hermes adapters exercise bounded HA and Immich provider contracts", async () => {
  const oldEnv = { HOME_ASSISTANT_URL: process.env.HOME_ASSISTANT_URL, HOME_ASSISTANT_TOKEN: process.env.HOME_ASSISTANT_TOKEN, IMMICH_URL: process.env.IMMICH_URL, IMMICH_API_KEY: process.env.IMMICH_API_KEY };
  const oldFetch = globalThis.fetch;
  process.env.HOME_ASSISTANT_URL = "http://ha.test";
  process.env.HOME_ASSISTANT_TOKEN = "ha-service-secret";
  process.env.IMMICH_URL = "http://immich.test";
  process.env.IMMICH_API_KEY = "immich-service-secret";
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/states")) {
      assert.equal((init?.headers as Record<string, string>)?.Authorization, "Bearer ha-service-secret");
      return Response.json([{ entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen" } }]);
    }
    if (url.endsWith("/api/search/metadata")) {
      assert.equal((init?.headers as Record<string, string>)?.["x-api-key"], "immich-service-secret");
      return Response.json({ assets: { items: [{ id: "00000000-0000-4000-8000-000000000001", type: "IMAGE", originalFileName: "front.jpg", fileCreatedAt: "2026-01-01T00:00:00.000Z", isFavorite: false, exifInfo: null }], nextPage: null, total: 1 } });
    }
    throw Error(`unexpected_provider_url:${url}`);
  }) as typeof fetch;
  try {
    assert.equal((await homeAssistantState()).entities[0].entity_id, "light.kitchen");
    assert.equal((await immichSearch({ page: 1, size: 1 })).photos[0].name, "front.jpg");
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key as keyof typeof process.env];
      else process.env[key as keyof typeof process.env] = value;
    }
  }
});
