import test from "node:test";
import assert from "node:assert/strict";
import { appDescriptorSchema, resolveAppLink } from "../packages/app-bridge/src/index.js";
import { allowedNodeCapability, nodeRegistrationSchema } from "../packages/node-bridge/src/index.js";
import { artifactUpsertSchema, workspaceCreateSchema } from "../apps/server/src/workspaces.js";
import { credentialsSchema, hashPassword, verifyPassword } from "../apps/server/src/identity.js";
import { sandboxDocument, validateArtifactSource } from "../packages/workspace-artifact/src/index.js";
import { capabilitySchema, mergeCapabilities } from "../packages/capability-registry/src/index.js";
import { m2Topics } from "../apps/server/src/m2.js";
import { randomBytes, randomUUID } from "node:crypto";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "../apps/server/src/integration-credentials.js";
import { buildApp } from "../apps/server/src/app.js";

test("App Bridge resolves resource links with encoded ids and platform fallback", () => {
  const app = appDescriptorSchema.parse({ id: "home-assistant", name: "Home Assistant", launch: { web: "https://ha.local" }, deep_links: { entity: "https://ha.local/config/entities/{id}" } });
  assert.equal(resolveAppLink(app, { kind: "entity", id: "light/kitchen" }, "web").primary, "https://ha.local/config/entities/light%2Fkitchen");
});
test("Node Bridge registration and capability allowlist fail closed", () => {
  const node = nodeRegistrationSchema.parse({ node_id: "ubuntu-1", name: "Ubuntu", platform: "ubuntu", capabilities: [{ name: "node.system.read", version: "1.0", risk: "read", available: true }] });
  assert.equal(node.node_id, "ubuntu-1");
  assert.equal(allowedNodeCapability("node.system.read", new Set(["node.system.read"])), true);
  assert.equal(allowedNodeCapability("node.shell.execute", new Set(["node.shell.execute"])), false);
});
test("Capability Registry merges versioned MCP metadata without widening the base contract", () => {
  const base = [capabilitySchema.parse({ id: "system.status.read", kind: "kernel", risk: "read", approval_required: false })];
  const merged = mergeCapabilities(base, [{ id: "immich.photo.search", kind: "mcp", risk: "read", approval_required: false, provider: "immich" }]);
  assert.deepEqual(merged.map((entry) => entry.id), ["immich.photo.search", "system.status.read"]);
  assert.equal(mergeCapabilities(base, [{ id: "not valid", kind: "mcp" }]).length, 1);
});
test("Durable Task aliases remain available while legacy Agent Run topics continue to work", () => {
  for (const topic of ["task.create", "task.list", "task.get", "task.cancel", "task.input"]) assert.ok(m2Topics.includes(topic as any));
});
test("Node Bridge ownership can be claimed by a logged-in user", () => {
  assert.ok(m2Topics.includes("agent.claim" as any));
});
test("durable workspace inputs reject executable or oversized artifact metadata", () => {
  assert.equal(workspaceCreateSchema.parse({ conversation_id: "00000000-0000-4000-8000-000000000001", type: "native", title: "分析" }).type, "native");
  assert.throws(() => artifactUpsertSchema.parse({ workspace_id: "00000000-0000-4000-8000-000000000001", type: "wasm", media_type: "text/html" }));
  assert.throws(() => artifactUpsertSchema.parse({ workspace_id: "00000000-0000-4000-8000-000000000001", type: "html", media_type: "text/html", source: "x".repeat(2_000_001) }));
});
test("Identity credentials use Argon2id and enforce strong usernames/passwords", async () => {
  const input = credentialsSchema.parse({ username: "francesca", password: "a secure password 123" });
  const encoded = await hashPassword(input.password);
  assert.match(encoded, /^\$argon2id\$/);
  assert.equal(await verifyPassword(encoded, input.password), true);
  assert.equal(await verifyPassword(encoded, "wrong password 123"), false);
  assert.throws(() => credentialsSchema.parse({ username: "x", password: "short" }));
});
test("username login registers a new device and keeps device ownership isolated", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const ctx = await buildApp({ databaseUrl: process.env.TEST_DATABASE_URL! });
  const userId = randomUUID(), username = `device-test-${Date.now()}`, password = "device-login-regression-2026";
  const firstDevice = randomUUID(), secondDevice = randomUUID();
  try {
    await ctx.db.query("INSERT INTO users(id,username,role) VALUES($1,$2,'member')", [userId, username]);
    await ctx.db.query("INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)", [userId, await hashPassword(password)]);
    for (const device_id of [firstDevice, secondDevice]) {
      const response = await ctx.app.inject({ method: "POST", url: "/api/v2/auth/login", payload: { username, password, device_id } });
      assert.equal(response.statusCode, 200, response.body);
    }
    const sessions = (await ctx.db.query("SELECT device_id FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL", [userId])).rows;
    assert.deepEqual(new Set(sessions.map((row) => row.device_id)), new Set([firstDevice, secondDevice]));
  } finally {
    await ctx.db.query("DELETE FROM users WHERE id=$1", [userId]);
    await ctx.app.close();
  }
});
test("Integration credentials encrypt provider secrets and expose dedicated topics", () => {
  const previous = process.env.INTEGRATION_CREDENTIAL_KEY;
  process.env.INTEGRATION_CREDENTIAL_KEY = randomBytes(32).toString("base64url");
  try {
    const encoded = encryptIntegrationSecret("provider-only-token");
    assert.notEqual(encoded, "provider-only-token");
    assert.equal(decryptIntegrationSecret(encoded), "provider-only-token");
    for (const topic of ["integration.credential.list", "integration.credential.put", "integration.credential.revoke"]) assert.ok(m2Topics.includes(topic as any));
  } finally {
    if (previous === undefined) delete process.env.INTEGRATION_CREDENTIAL_KEY;
    else process.env.INTEGRATION_CREDENTIAL_KEY = previous;
  }
});
test("generated workspace documents are isolated from network and parent navigation", () => {
  const value = sandboxDocument("<script>fetch('https://example.com')</script>");
  assert.match(value, /connect-src 'none'/);
  assert.match(value, /form-action 'none'/);
  assert.match(value, /<html>/);
});
test("artifact source validation rejects network and dynamic code escape hatches", () => {
  assert.equal(validateArtifactSource("<p>safe</p>"), "<p>safe</p>");
  assert.throws(() => validateArtifactSource("<script>fetch('https://example.com')</script>"));
  assert.throws(() => validateArtifactSource("<iframe src='x'></iframe>"));
  assert.throws(() => validateArtifactSource("<a href='javascript:alert(1)'>x</a>"));
});
