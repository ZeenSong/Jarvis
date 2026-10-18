import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecipeManifest,
  callHttpOperation,
  clearHttpSessions,
  compileManifest,
  IntegrationRegistry,
  listMcpTools,
  probeHttp,
  recipeFor,
  recipeMcpEndpoint,
} from "../packages/integrations/src/index.js";
import { normalizeApplicationsDetailed } from "../packages/integration-casaos/src/index.js";
import { mergePortMappings, summarizeCompose } from "../apps/server/src/casaos-admin.js";

const env = { PATH: process.env.PATH } as NodeJS.ProcessEnv;

function jellyfin() {
  const recipe = recipeFor("jellyfin", "Jellyfin");
  assert.ok(recipe);
  return compileManifest(buildRecipeManifest(recipe!, {
    id: "jellyfin",
    name: "Jellyfin",
    description: "media",
    baseUrl: "http://jellyfin.local:8097",
  }));
}

function qbittorrent() {
  const recipe = recipeFor("qbittorrent", "qBittorrent");
  assert.ok(recipe);
  return compileManifest(buildRecipeManifest(recipe!, {
    id: "qbittorrent",
    name: "qBittorrent",
    description: "torrents",
    baseUrl: "http://qb.local:8181",
  }));
}

test("HTTP recipes compile into a manifest with declared read and write operations", () => {
  const manifest = jellyfin();
  assert.equal(manifest.kind, "http");
  assert.equal(manifest.transport.type, "http");
  if (manifest.transport.type !== "http") return;
  assert.equal(manifest.transport.base_url, "http://jellyfin.local:8097");
  assert.equal(manifest.transport.auth.mode, "header");
  assert.ok(manifest.transport.operations.some((operation) => operation.name === "items_search" && operation.read_only));
  assert.ok(manifest.transport.operations.some((operation) => operation.name === "library_refresh" && !operation.read_only));
  assert.deepEqual(manifest.tools.read, manifest.transport.operations.filter((operation) => operation.read_only).map((operation) => operation.name));
  assert.deepEqual(manifest.tools.write, manifest.transport.operations.filter((operation) => !operation.read_only).map((operation) => operation.name));
  assert.equal(manifest.readScope, "mcp.jellyfin.read");
  assert.equal(IntegrationRegistry.baseUrl(manifest), "http://jellyfin.local:8097");
  assert.equal(IntegrationRegistry.appDescriptor(manifest)?.status, "ready");
  const connection = IntegrationRegistry.connection(manifest, "key", env);
  assert.equal(connection.type, "http");
  if (connection.type === "http") assert.equal(connection.base_url, "http://jellyfin.local:8097");
});

test("qBittorrent declares a session login and form-encoded writes", () => {
  const manifest = qbittorrent();
  if (manifest.transport.type !== "http") throw Error("expected http");
  assert.equal(manifest.transport.auth.mode, "session");
  if (manifest.transport.auth.mode !== "session") return;
  assert.equal(manifest.transport.auth.login_path, "/api/v2/auth/login");
  assert.equal(manifest.transport.auth.cookie_name, "SID");
  const add = manifest.transport.operations.find((operation) => operation.name === "torrents_add");
  assert.ok(add);
  assert.equal(add!.method, "POST");
  assert.equal(add!.body_format, "form");
  assert.equal(add!.read_only, false);
});

test("unknown apps are not guessed, unsupported apps stay unsupported", () => {
  assert.equal(recipeFor("mystery-app", "Mystery"), undefined);
  assert.equal(recipeFor("mosquitto", "Mosquitto")?.mode, "unsupported");
  assert.equal(recipeFor("immichframe", "ImmichFrame")?.mode, "unsupported");
});

test("registry HTTP policy refuses an operation the manifest does not declare", () => {
  const registry = new IntegrationRegistry([
    buildRecipeManifest(recipeFor("jellyfin", "Jellyfin")!, {
      id: "jellyfin",
      name: "Jellyfin",
      description: "media",
      baseUrl: "http://jellyfin.local:8097",
    }),
  ]);
  assert.deepEqual(registry.authorizeTool("jellyfin", "items_search"), { level: "read", denied: false });
  assert.deepEqual(registry.authorizeTool("jellyfin", "library_refresh"), { level: "write", denied: false });
  assert.equal(registry.authorizeTool("jellyfin", "http://evil.example").denied, true);
  assert.equal(registry.authorizeTool("jellyfin", "drop_database").denied, true);
});

test("HTTP execution substitutes path parameters, encodes queries and attaches the header only", async () => {
  const manifest = jellyfin();
  let seen: { url: string; headers: Record<string, string> } | undefined;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    seen = { url: String(input), headers: init?.headers as Record<string, string> };
    return Response.json({ Items: [{ Id: "abc", Name: "Dune" }] }, { status: 200 });
  }) as typeof fetch;
  const operation = manifest.transport.type === "http"
    ? manifest.transport.operations.find((item) => item.name === "items_search")!
    : undefined;
  assert.ok(operation);
  const result = await callHttpOperation(manifest, "secret-key", operation!, { searchTerm: "dune", limit: 3 }, { fetch: fetcher });
  assert.equal(result.ok, true);
  assert.equal(seen!.headers["X-Emby-Token"], "secret-key");
  assert.equal("Authorization" in seen!.headers, false);
  assert.match(seen!.url, /^http:\/\/jellyfin\.local:8097\/Items\?/);
  assert.match(seen!.url, /searchTerm=dune/);
  assert.match(seen!.url, /limit=3/);
  assert.deepEqual(result.data, { Items: [{ Id: "abc", Name: "Dune" }] });
});

test("session auth logs in, reuses the cookie, and renews once on 403", async () => {
  clearHttpSessions();
  const manifest = qbittorrent();
  const calls: string[] = [];
  let logins = 0;
  let appCalls = 0;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/api/v2/auth/login")) {
      logins += 1;
      return new Response("Ok.", { status: 200, headers: { "set-cookie": "SID=session-cookie; Path=/", "content-type": "text/plain" } });
    }
    appCalls += 1;
    if (appCalls === 1) return new Response("Forbidden", { status: 403 });
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.Cookie, "SID=session-cookie");
    assert.equal(headers.Origin, "http://qb.local:8181");
    assert.equal(headers.Referer, "http://qb.local:8181/");
    return Response.json([{ name: "ubuntu.iso", hash: "abc" }]);
  }) as typeof fetch;
  const operation = manifest.transport.type === "http"
    ? manifest.transport.operations.find((item) => item.name === "torrents_list")!
    : undefined;
  assert.ok(operation);
  const result = await callHttpOperation(manifest, "admin:hunter2", operation!, {}, { fetch: fetcher });
  assert.equal(result.ok, true);
  assert.equal(logins, 2, "the expired cookie is renewed exactly once");
  assert.ok(calls[0].endsWith("/api/v2/auth/login"));
  assert.deepEqual(result.data, [{ name: "ubuntu.iso", hash: "abc" }]);
});

test("probe uses the manifest healthcheck and reports invalid credentials", async () => {
  const manifest = jellyfin();
  const ok = (async () => Response.json([{ Id: "user" }])) as typeof fetch;
  const good = await probeHttp(manifest, "good", env, { fetch: ok });
  assert.equal(good.connected, true);
  assert.equal(good.status, 200);
  const bad = (async () => new Response("no", { status: 401 })) as typeof fetch;
  const denied = await probeHttp(manifest, "bad", env, { fetch: bad });
  assert.equal(denied.connected, false);
  assert.equal(denied.error, "invalid_credentials");
  const operation = manifest.transport.type === "http"
    ? manifest.transport.operations.find((item) => item.name === "items_search")!
    : undefined;
  await assert.rejects(() => callHttpOperation(manifest, "bad", operation!, { searchTerm: "x" }, { fetch: bad }), /integration_http_401/);
});

test("MCP client sends initialize, initialized and tools/list in order", async () => {
  const seen: Array<{ method: string; session?: string }> = [];
  let listCalls = 0;
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; id?: number };
    const headers = init?.headers as Record<string, string>;
    seen.push({ method: String(body.method), session: headers["Mcp-Session-Id"] });
    if (body.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } }), {
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "sess-1" },
      });
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") {
      listCalls += 1;
      const payload = { jsonrpc: "2.0", id: 2, result: { tools: [{ name: "GetLiveContext", description: "read", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] } };
      return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    return new Response("", { status: 500 });
  }) as typeof fetch;
  const tools = await listMcpTools({ endpoint: "http://ha.local:8123/api/mcp", headers: { Authorization: "Bearer t" }, fetch: fetcher });
  assert.equal(listCalls, 1);
  assert.deepEqual(seen.map((entry) => entry.method), ["initialize", "notifications/initialized", "tools/list"]);
  assert.equal(seen[2].session, "sess-1");
  assert.deepEqual(tools, [{ name: "GetLiveContext", description: "read", input_schema: { type: "object" }, read_only: true }]);
});

test("CasaOS detail extraction derives the web port without leaking environment", () => {
  const apps = normalizeApplicationsDetailed({
    jellyfin: {
      status: "running",
      compose: {
        "x-casaos": { title: { en_US: "Jellyfin" }, main: "jellyfin", scheme: "http", port_map: 8097 },
        services: {
          jellyfin: {
            environment: { SECRET: "must-not-leak" },
            ports: [{ target: 8096, published: "8097", protocol: "tcp" }],
          },
        },
      },
    },
  });
  assert.equal(apps[0].web_port, 8097);
  assert.equal(apps[0].scheme, "http");
  assert.equal(apps[0].main_service, "jellyfin");
  assert.equal(apps[0].published_ports[0].published, 8097);
  assert.ok(!JSON.stringify(apps).includes("must-not-leak"));
});

test("Jellyfin declares plugin management as explicit read and write operations", () => {
  const manifest = jellyfin();
  if (manifest.transport.type !== "http") throw Error("expected http");
  const install = manifest.transport.operations.find((operation) => operation.name === "plugin_install");
  const inspect = manifest.transport.operations.find((operation) => operation.name === "plugin_package");
  const restart = manifest.transport.operations.find((operation) => operation.name === "system_restart");
  assert.ok(install);
  assert.ok(inspect);
  assert.ok(restart);
  assert.equal(install!.method, "POST");
  assert.equal(install!.path, "/Packages/Installed/{name}");
  assert.equal(install!.read_only, false);
  assert.equal(inspect!.method, "GET");
  assert.equal(inspect!.read_only, true);
  assert.equal(restart!.path, "/System/Restart");
  assert.equal(restart!.read_only, false);
  const registry = new IntegrationRegistry([buildRecipeManifest(recipeFor("jellyfin", "Jellyfin")!, {
    id: "jellyfin",
    name: "Jellyfin",
    description: "media",
    baseUrl: "http://jellyfin.local:8097",
  })]);
  assert.deepEqual(registry.authorizeTool("jellyfin", "plugin_install"), { level: "write", denied: false });
  assert.deepEqual(registry.authorizeTool("jellyfin", "plugin_package"), { level: "read", denied: false });
  assert.equal(registry.authorizeTool("jellyfin", "plugin_install_arbitrary").denied, true);
});

test("CasaOS port additions keep existing fields and skip exact duplicates", () => {
  const existing = [{ target: 3000, published: "15323", protocol: "tcp", host_ip: "127.0.0.1" }];
  const result = mergePortMappings(existing, [
    { target: 27124, published: 27124, protocol: "tcp" },
    { target: 3000, published: 15323, protocol: "tcp" },
  ]);
  assert.deepEqual(result.added, [{ target: 27124, published: 27124, protocol: "tcp" }]);
  assert.equal(result.ports.length, 2);
  assert.equal(result.ports[0].host_ip, "127.0.0.1");
  assert.equal(result.ports[1].published, "27124");
});

test("CasaOS detail view exposes images and ports but never environment or volumes", () => {
  const view = summarizeCompose("obsidian", {
    status: "running",
    compose: {
      name: "obsidian",
      services: {
        obsidian: {
          image: "lscr.io/linuxserver/obsidian:1.12.7",
          environment: { SECRET_TOKEN: "must-not-leak" },
          volumes: [{ source: "/DATA/AppData/obsidian", target: "/config" }],
          ports: [{ target: 27124, published: "27124", protocol: "tcp" }],
        },
      },
    },
  });
  const text = JSON.stringify(view);
  assert.equal(view.services[0].image, "lscr.io/linuxserver/obsidian:1.12.7");
  assert.deepEqual(view.services[0].ports, [{ target: 27124, published: "27124", protocol: "tcp" }]);
  assert.ok(!text.includes("must-not-leak"));
  assert.ok(!text.includes("/DATA/AppData"));
});

test("Obsidian recipe targets its own MCP port, relaxes TLS and separates reads from writes", () => {
  const recipe = recipeFor("obsidian", "Obsidian");
  assert.ok(recipe?.mcp);
  const base = "https://100.77.157.73:15323";
  assert.equal(recipeMcpEndpoint(recipe!, base), "https://100.77.157.73:27124/mcp/");
  const raw = buildRecipeManifest(recipe!, {
    id: "obsidian",
    name: "Obsidian",
    baseUrl: base,
  });
  const manifest = compileManifest(raw);
  assert.equal(manifest.transport.type, "streamable-http");
  if (manifest.transport.type !== "streamable-http") return;
  assert.equal(manifest.transport.endpoint, "https://100.77.157.73:27124/mcp/");
  assert.equal(manifest.transport.allow_insecure_tls, true);
  const connection = IntegrationRegistry.connection(manifest, "secret");
  assert.equal(connection.type, "streamable-http");
  if (connection.type !== "streamable-http") return;
  assert.equal(connection.endpoint, "https://100.77.157.73:27124/mcp/");
  assert.equal(connection.headers.Authorization, "Bearer secret");
  assert.equal(connection.insecure_tls, true);
  const registry = new IntegrationRegistry([raw]);
  assert.deepEqual(registry.authorizeTool("obsidian", "vault_read"), { level: "read", denied: false });
  assert.deepEqual(registry.authorizeTool("obsidian", "vault_write"), { level: "write", denied: false });
  assert.deepEqual(registry.authorizeTool("obsidian", "vault_delete"), { level: "write", denied: true });
});
