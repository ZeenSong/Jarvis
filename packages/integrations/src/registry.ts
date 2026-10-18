import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { builtinManifests, classifyTool, isDenied, manifestCapabilities } from "./builtins.js";
import { compileManifest, type CompiledManifest, type HttpAuth, type HttpOperation } from "./manifest.js";

export type ResolvedCredential = {
  provider: string;
  secret: string;
  /** Where the secret came from, for audit output (never the secret itself). */
  source: "store" | "env";
};

export type ConnectionDescriptor =
  | {
      type: "streamable-http";
      endpoint: string;
      headers: Record<string, string>;
      /** Per-connection opt-out of certificate verification (self-signed apps). */
      insecure_tls?: boolean;
    }
  | {
      type: "stdio";
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  | {
      type: "http";
      base_url: string;
      auth: HttpAuth;
      operations: HttpOperation[];
      max_response_bytes: number;
      timeout_ms: number;
    };

/**
 * How the MCP provider should turn one upstream tool result into a conversation
 * media resource. Produced only for manifests that declare `media`; the provider
 * applies it generically and never needs to know the provider id.
 */
export type MediaDescriptor = {
  tool: string;
  id_argument: string;
  /** Absolute URL template; `{id}` is substituted by the provider. */
  url_template: string;
  headers: Record<string, string>;
  content_types: string[];
  max_bytes: number;
  id_pattern: string;
};

export type AppDescriptor = {
  id: string;
  name: string;
  description: string;
  status: "ready" | "unconfigured";
  launch: { web?: string };
  deep_links: Record<string, string>;
  capabilities: string[];
  resources: string[];
  icon?: string;
};

export class IntegrationRegistry {
  private readonly byId = new Map<string, CompiledManifest>();
  private readonly builtinIds = new Set<string>();

  constructor(manifests: readonly unknown[]) {
    for (const input of manifests) {
      const manifest = compileManifest(input);
      if (this.byId.has(manifest.id)) throw Error(`integration_duplicate_id:${manifest.id}`);
      this.byId.set(manifest.id, manifest);
    }
    for (const input of builtinManifests) {
      const id = (input as { id?: unknown }).id;
      if (typeof id === "string") this.builtinIds.add(id);
    }
  }

  /**
   * Build the registry from the built-in manifests plus any JSON files in
   * `INTEGRATIONS_DIR`. Dropping a file in that directory is the entire procedure
   * for adding an app: no TypeScript, no switch statements, no new scope strings.
   */
  static async create(options: { dir?: string; extra?: readonly unknown[] } = {}): Promise<IntegrationRegistry> {
    const extra = [...(options.extra ?? [])];
    if (options.dir) {
      let entries: string[] = [];
      try {
        entries = (await readdir(options.dir)).filter((name) => name.endsWith(".json")).sort();
      } catch {
        // A missing directory simply means no declarative integrations.
      }
      for (const name of entries) {
        const text = await readFile(join(options.dir, name), "utf8");
        const parsed = JSON.parse(text) as unknown;
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const entry of list) {
          // Manifests are strict schemas: never inject bookkeeping fields here.
          if (entry && typeof entry === "object") extra.push(entry);
        }
      }
    }
    return new IntegrationRegistry([...builtinManifests, ...extra]);
  }

  list(): CompiledManifest[] {
    return [...this.byId.values()].filter((manifest) => manifest.enabled);
  }

  /**
   * Add or replace one manifest in the live registry.
   *
   * The server writes catalog changes to the database and calls this so a newly
   * configured app is callable immediately; no process restart and no Hermes
   * MCP-server entry are involved.
   */
  upsert(input: unknown): CompiledManifest {
    const manifest = compileManifest(input);
    if (this.builtinIds.has(manifest.id)) throw Error("app_builtin_immutable");
    this.byId.set(manifest.id, manifest);
    return manifest;
  }

  /** Remove a configured manifest. Built-ins cannot be removed. */
  remove(id: string): boolean {
    if (this.builtinIds.has(id)) return false;
    return this.byId.delete(id);
  }

  isBuiltin(id: string): boolean {
    return this.builtinIds.has(id);
  }

  all(): CompiledManifest[] {
    return [...this.byId.values()];
  }

  get(id: string): CompiledManifest | undefined {
    return this.byId.get(id);
  }

  require(id: string): CompiledManifest {
    const manifest = this.byId.get(id);
    if (!manifest) throw Error("mcp_provider_unknown");
    return manifest;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  ids(): string[] {
    return [...this.byId.keys()].sort();
  }

  /** Every scope the registry can grant, for capability catalogs and admin UI. */
  scopes(): Array<{ provider: string; read: string; write: string }> {
    return this.list().map((manifest) => ({
      provider: manifest.id,
      read: manifest.readScope,
      write: manifest.writeScope,
    }));
  }

  capabilities() {
    return this.list().flatMap((manifest) => manifestCapabilities(manifest));
  }

  /** Member grants every member receives before household overrides apply. */
  defaultMemberCapabilities(): string[] {
    const base = ["system.read", "schedule.write", "conversation.write"];
    return [...base, ...this.list().map((manifest) => manifest.readScope)].sort();
  }

  /** Resolve a stored credential row (which may use an alias) back to a manifest. */
  findByStoreProvider(provider: string): CompiledManifest | undefined {
    return this.all().find(
      (manifest) => IntegrationRegistry.storeProvider(manifest) === provider || manifest.id === provider,
    );
  }

  /** Access level a tool call requires, and whether it is refused outright. */
  authorizeTool(provider: string, toolName: string): { level: "read" | "write"; denied: boolean } {
    const manifest = this.require(provider);
    if (manifest.transport.type === "http") {
      const operation = manifest.transport.operations.find((item) => item.name === toolName);
      // An operation that the manifest does not declare does not exist. Do not
      // let the model invent one and have the executor guess a path.
      if (!operation) return { level: "write", denied: true };
      return { level: operation.read_only ? "read" : "write", denied: isDenied(manifest, toolName) };
    }
    return { level: classifyTool(manifest, toolName), denied: isDenied(manifest, toolName) };
  }

  static credentialEnv(manifest: CompiledManifest): string | undefined {
    return manifest.credential.env;
  }

  static storeProvider(manifest: CompiledManifest): string {
    return manifest.credential.store_provider ?? manifest.id;
  }

  /**
   * The user-facing base URL: an app configured from CasaOS carries the URL it
   * was detected at, while the built-ins keep reading their environment.
   */
  static baseUrl(manifest: CompiledManifest, env: NodeJS.ProcessEnv = process.env): string | undefined {
    // A literal MCP endpoint is a full URL; its origin is the app's web entry.
    const mcpEndpoint = manifest.transport.type === "streamable-http" ? manifest.transport.endpoint : undefined;
    const literal = manifest.app.base_url
      ?? (manifest.transport.type === "http" ? manifest.transport.base_url : undefined)
      ?? (mcpEndpoint ? new URL(mcpEndpoint).origin : undefined);
    const value = literal ?? (manifest.app.launch_env ? env[manifest.app.launch_env]?.trim() : undefined);
    if (!value) return undefined;
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
      return `${url.origin}${url.pathname}`.replace(/\/$/, "");
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve the optional media fetch. Returns `undefined` when the manifest has
   * none — or when its base URL is not configured, because the result is only an
   * enhancement: the tool call itself still works without it.
   */
  static media(manifest: CompiledManifest, secret: string, env: NodeJS.ProcessEnv = process.env): MediaDescriptor | undefined {
    if (!manifest.media) return undefined;
    const base = IntegrationRegistry.baseUrl(manifest, env);
    if (!base) return undefined;
    const scheme = manifest.media.scheme.trim();
    return {
      tool: manifest.media.tool,
      id_argument: manifest.media.id_argument,
      url_template: `${base}${manifest.media.path}`,
      headers: { [manifest.media.header]: scheme ? `${scheme} ${secret}` : secret },
      content_types: [...manifest.media.content_types],
      max_bytes: manifest.media.max_bytes,
      id_pattern: manifest.media.id_pattern,
    };
  }

  /** Descriptor for REST integrations; the secret is supplied separately. */
  static httpConnection(manifest: CompiledManifest, env: NodeJS.ProcessEnv = process.env): ConnectionDescriptor {
    if (manifest.transport.type !== "http") throw Error(`${manifest.id}_not_http`);
    const base = manifest.transport.base_url
      ?? (manifest.transport.base_env ? env[manifest.transport.base_env]?.trim() : undefined);
    if (!base || !/^https?:\/\//.test(base)) throw Error(`${manifest.id}_not_configured`);
    return {
      type: "http",
      base_url: base.replace(/\/$/, ""),
      auth: manifest.transport.auth,
      operations: [...manifest.transport.operations],
      max_response_bytes: manifest.transport.max_response_bytes,
      timeout_ms: manifest.transport.timeout_ms,
    };
  }

  static connection(manifest: CompiledManifest, secret: string, env: NodeJS.ProcessEnv = process.env): ConnectionDescriptor {
    if (manifest.transport.type === "http") return IntegrationRegistry.httpConnection(manifest, env);
    if (manifest.transport.type === "streamable-http") {
      const literal = manifest.transport.endpoint;
      const base = literal ?? (manifest.transport.endpoint_env ? env[manifest.transport.endpoint_env]?.trim() : undefined);
      if (!base || !/^https?:\/\//.test(base)) throw Error(`${manifest.id}_not_configured`);
      // A literal endpoint is already the full MCP URL; an environment value is
      // a base URL and still needs the declared path appended. Keep a literal
      // endpoint byte-for-byte: some servers (Obsidian) route `/mcp/` and `/mcp`
      // differently, and stripping the slash silently breaks the handshake.
      const endpoint = literal ? base : `${base.replace(/\/$/, "")}${manifest.transport.endpoint_path ?? ""}`;
      const scheme = manifest.transport.credential_scheme.trim();
      return {
        type: "streamable-http",
        endpoint,
        headers: {
          [manifest.transport.credential_header]: scheme ? `${scheme} ${secret}` : secret,
        },
        ...(manifest.transport.allow_insecure_tls ? { insecure_tls: true } : {}),
      };
    }
    const childEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(manifest.transport.env)) {
      childEnv[key] = value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_match, name: string) => env[name] ?? "");
    }
    for (const name of manifest.transport.inherit_env) {
      const value = env[name];
      if (value !== undefined) childEnv[name] = value;
    }
    childEnv[manifest.transport.credential_env] = secret;
    return {
      type: "stdio",
      command: manifest.transport.command,
      args: [...manifest.transport.args],
      env: childEnv,
    };
  }

  static appDescriptor(manifest: CompiledManifest, env: NodeJS.ProcessEnv = process.env): AppDescriptor | undefined {
    if (!manifest.app.icon && !manifest.app.launch_env && !manifest.app.base_url) return undefined;
    const launch = IntegrationRegistry.baseUrl(manifest, env);
    return {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      status: launch ? "ready" : "unconfigured",
      launch: launch ? { web: launch } : {},
      deep_links: { ...manifest.app.deep_links },
      capabilities: [...manifest.app.capabilities],
      resources: [...manifest.app.resources],
      ...(manifest.app.icon ? { icon: `/app-icons/${manifest.app.icon}.svg` } : {}),
    };
  }

  /** Expand a deep link template; returns undefined when the app is unconfigured. */
  static appLink(
    manifest: CompiledManifest,
    input: { kind?: string; id?: string },
    env: NodeJS.ProcessEnv = process.env,
  ): string | undefined {
    const descriptor = IntegrationRegistry.appDescriptor(manifest, env);
    const base = descriptor?.launch.web;
    if (!base || !input.kind) return undefined;
    const template = manifest.app.deep_links[input.kind];
    if (!template) return undefined;
    const expanded = template
      .replaceAll("{base}", base)
      .replaceAll("{id}", encodeURIComponent(input.id ?? ""))
      .replace(/\{id\}/g, "");
    // Never emit a link that points somewhere other than the configured app.
    return expanded.startsWith(base) ? expanded : undefined;
  }
}
