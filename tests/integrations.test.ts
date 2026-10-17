import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  builtinManifests,
  IntegrationRegistry,
  classifyTool,
  compileManifest,
  isDenied,
  manifestCapabilities,
  matchToolPattern,
} from "../packages/integrations/src/index.js";

const env = {
  HOME_ASSISTANT_URL: "http://ha.local:8123",
  HOME_ASSISTANT_TOKEN: "ha-token",
  IMMICH_URL: "http://immich.local:2283",
  IMMICH_API_KEY: "immich-key",
  JELLYFIN_URL: "http://jellyfin.local:8096",
  JELLYFIN_MCP_URL: "http://jellyfin.local:8097/mcp",
  JELLYFIN_API_KEY: "jellyfin-key",
} as NodeJS.ProcessEnv;

const jellyfin = {
  id: "jellyfin",
  name: "Jellyfin",
  description: "媒体库搜索与播放控制。",
  kind: "mcp",
  transport: { type: "streamable-http", endpoint_env: "JELLYFIN_MCP_URL", endpoint_path: "" },
  credential: { env: "JELLYFIN_API_KEY" },
  tools: {
    read: ["*_search", "*_list", "get_*"],
    write: ["play_*", "*_delete"],
    deny: [],
    overrides: {},
  },
  scopes: { read: "mcp.jellyfin.read", write: "mcp.jellyfin.write" },
  capabilities: ["media.read"],
  app: {
    icon: "jellyfin-glyph",
    launch_env: "JELLYFIN_URL",
    deep_links: { item: "{base}/web/index.html#!/details?id={id}" },
    capabilities: ["jellyfin.item.read"],
    resources: ["item"],
  },
  risk: "read",
};

test("built-ins compile and reproduce the previous behaviour", () => {
  const registry = new IntegrationRegistry([
    { id: "homeassistant", name: "Home Assistant", transport: { type: "streamable-http", endpoint_env: "HOME_ASSISTANT_URL", endpoint_path: "/api/mcp" }, credential: { env: "HOME_ASSISTANT_TOKEN" }, tools: { read: ["GetLiveContext"] }, scopes: {} },
    {
      id: "immich",
      name: "Immich",
      transport: { type: "stdio", command: "/usr/bin/dotnet", args: ["x.dll"], credential_env: "IMMICH_API_KEY", env: { IMMICH_BASE_URL: "${IMMICH_URL}" } },
      credential: { env: "IMMICH_API_KEY" },
      tools: { read: ["*_search"] },
      scopes: {},
    },
  ]);
  assert.deepEqual(registry.ids(), ["homeassistant", "immich"]);
  assert.equal(registry.get("homeassistant")?.readScope, "mcp.homeassistant.read");
  assert.equal(registry.get("immich")?.writeScope, "mcp.immich.write");

  const ha = IntegrationRegistry.connection(registry.require("homeassistant"), "secret", env);
  assert.deepEqual(ha, {
    type: "streamable-http",
    endpoint: "http://ha.local:8123/api/mcp",
    headers: { Authorization: "Bearer secret" },
  });

  const immich = IntegrationRegistry.connection(registry.require("immich"), "immich-key", env);
  assert.equal(immich.type, "stdio");
  if (immich.type === "stdio") {
    assert.equal(immich.command, "/usr/bin/dotnet");
    assert.deepEqual(immich.args, ["x.dll"]);
    assert.equal(immich.env.IMMICH_BASE_URL, "http://immich.local:2283");
    assert.equal(immich.env.IMMICH_API_KEY, "immich-key");
  }
});

test("tool classification fails closed for unclassified tools", () => {
  const manifest = compileManifest({
    id: "demo",
    name: "Demo",
    transport: { type: "streamable-http", endpoint_env: "DEMO_URL" },
    credential: { env: "DEMO_KEY" },
    tools: {
      read: ["*_list", "get_item"],
      write: ["*_delete"],
      deny: ["*shared_link*"],
      overrides: { special_write: "read" },
    },
    scopes: {},
  });
  assert.equal(classifyTool(manifest, "assets_list"), "read");
  assert.equal(classifyTool(manifest, "get_item"), "read");
  assert.equal(classifyTool(manifest, "album_delete"), "write");
  assert.equal(classifyTool(manifest, "totally_new_tool"), "write", "unknown tools are writes");
  assert.equal(classifyTool(manifest, "special_write"), "read", "overrides win");
  assert.equal(isDenied(manifest, "create_shared_link"), true);
  assert.equal(isDenied(manifest, "create_album"), false);
});

test("tool patterns support prefix, suffix and full wildcards", () => {
  assert.equal(matchToolPattern("*", "anything"), true);
  assert.equal(matchToolPattern("*_search", "immich_assets_search"), true);
  assert.equal(matchToolPattern("camera_*", "camera_snapshot_read"), true);
  assert.equal(matchToolPattern("camera_*", "light_turn_on"), false);
  assert.equal(matchToolPattern("*shared*", "create_shared_link"), true);
  assert.equal(matchToolPattern("exact", "exact"), true);
  assert.equal(matchToolPattern("exact", "exactly"), false);
});

test("a third integration is added by configuration alone", async () => {
  const registry = await IntegrationRegistry.create({ extra: [jellyfin] });
  assert.ok(registry.ids().includes("jellyfin"), "manifest is discoverable without code changes");

  const descriptor = IntegrationRegistry.appDescriptor(registry.require("jellyfin"), env);
  assert.equal(descriptor?.status, "ready");
  assert.equal(descriptor?.launch.web, "http://jellyfin.local:8096");
  assert.equal(descriptor?.icon, "/app-icons/jellyfin-glyph.svg");
  assert.equal(descriptor?.resources[0], "item");

  const scopes = registry.scopes().find((entry) => entry.provider === "jellyfin");
  assert.deepEqual(scopes, { provider: "jellyfin", read: "mcp.jellyfin.read", write: "mcp.jellyfin.write" });

  const capabilities = manifestCapabilities(registry.require("jellyfin")).map((entry) => entry.id);
  assert.deepEqual(capabilities, ["jellyfin.mcp.read", "jellyfin.mcp.write"]);

  const defaults = registry.defaultMemberCapabilities();
  assert.ok(defaults.includes("mcp.jellyfin.read"), "members receive the read scope automatically");
  assert.ok(!defaults.includes("mcp.jellyfin.write"), "write scope is never granted by default");

  const connection = IntegrationRegistry.connection(registry.require("jellyfin"), "key", env);
  assert.equal(connection.type, "streamable-http");
  if (connection.type === "streamable-http") {
    assert.equal(connection.endpoint, "http://jellyfin.local:8097/mcp");
  }

  const link = IntegrationRegistry.appLink(registry.require("jellyfin"), { kind: "item", id: "abc 123" }, env);
  assert.equal(link, "http://jellyfin.local:8096/web/index.html#!/details?id=abc%20123");
});

test("a manifest on disk is loaded without touching the server", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-integrations-"));
  await writeFile(join(dir, "jellyfin.json"), JSON.stringify(jellyfin));
  const registry = await IntegrationRegistry.create({ dir });
  assert.ok(registry.has("jellyfin"));
});

test("configuration errors are rejected at load time, not at call time", () => {
  assert.throws(() => compileManifest({ id: "Bad Id", name: "x", transport: { type: "streamable-http", endpoint_env: "X" }, credential: { env: "Y" }, tools: {}, scopes: {} }));
  assert.throws(() => compileManifest({ id: "demo", name: "x", transport: { type: "streamable-http", endpoint_env: "lowercase" }, credential: { env: "Y" }, tools: {}, scopes: {} }));
  assert.throws(() => compileManifest({ id: "demo", name: "x", transport: { type: "streamable-http", endpoint_env: "X" }, credential: {}, tools: {}, scopes: {} }), "a credential source is required");
  const registry = new IntegrationRegistry([jellyfin]);
  assert.throws(() => registry.require("nope"), /mcp_provider_unknown/);
});

test("unconfigured apps resolve to a null launch instead of a broken link", () => {
  const registry = new IntegrationRegistry([jellyfin]);
  const descriptor = IntegrationRegistry.appDescriptor(registry.require("jellyfin"), {} as NodeJS.ProcessEnv);
  assert.equal(descriptor?.status, "unconfigured");
  assert.equal(descriptor?.launch.web, undefined);
  assert.equal(IntegrationRegistry.appLink(registry.require("jellyfin"), { kind: "item", id: "1" }, {} as NodeJS.ProcessEnv), undefined);
});

test("connection refuses a non-http endpoint and never leaks the secret", () => {
  const registry = new IntegrationRegistry([jellyfin]);
  assert.throws(
    () => IntegrationRegistry.connection(registry.require("jellyfin"), "key", { JELLYFIN_MCP_URL: "file:///etc/passwd" } as NodeJS.ProcessEnv),
    /jellyfin_not_configured/,
  );
  assert.throws(
    () => IntegrationRegistry.connection(registry.require("jellyfin"), "key", {} as NodeJS.ProcessEnv),
    /jellyfin_not_configured/,
  );
});

test("media fetch is declared by the manifest, never by the provider name", () => {
  const registry = new IntegrationRegistry([
    {
      ...jellyfin,
      media: {
        tool: "get_poster",
        id_argument: "item_id",
        path: "/Items/{id}/Images/Primary",
        header: "x-emby-token",
        scheme: "",
        content_types: ["image/png"],
        max_bytes: 4096,
        id_pattern: "[A-Za-z0-9]{1,40}",
      },
    },
  ]);
  const descriptor = IntegrationRegistry.media(registry.require("jellyfin"), "jellyfin-key", env);
  assert.deepEqual(descriptor, {
    tool: "get_poster",
    id_argument: "item_id",
    url_template: "http://jellyfin.local:8096/Items/{id}/Images/Primary",
    headers: { "x-emby-token": "jellyfin-key" },
    content_types: ["image/png"],
    max_bytes: 4096,
    id_pattern: "[A-Za-z0-9]{1,40}",
  });

  // The built-in Immich manifest reproduces the previous hardcoded behaviour.
  const builtins = new IntegrationRegistry(builtinManifests);
  const immich = IntegrationRegistry.media(builtins.require("immich"), "immich-key", env);
  assert.equal(immich?.tool, "immich_assets_download_thumbnail");
  assert.equal(immich?.url_template, "http://immich.local:2283/api/assets/{id}/thumbnail?size=preview");
  assert.deepEqual(immich?.headers, { "x-api-key": "immich-key" });

  // No declaration, or no base URL, means no media fetch at all.
  assert.equal(IntegrationRegistry.media(builtins.require("homeassistant"), "ha-token", env), undefined);
  assert.equal(IntegrationRegistry.media(builtins.require("immich"), "immich-key", {} as NodeJS.ProcessEnv), undefined);
});

test("media declarations are validated at load time", () => {
  const base = { ...jellyfin, media: { tool: "get_poster", path: "/x/{id}" } };
  assert.throws(() => compileManifest({ ...base, media: { ...base.media, path: "relative/{id}" } }), /path/);
  assert.throws(() => compileManifest({ ...base, media: { ...base.media, id_pattern: "([a-z" } }), /id_pattern/);
  assert.throws(() => compileManifest({ ...base, media: { ...base.media, content_types: ["text/html"] } }));
  assert.equal(compileManifest(base).media?.id_argument, "id", "defaults keep manifests short");
});
