import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { builtinManifests, classifyTool, isDenied, manifestCapabilities } from "./builtins.js";
import { compileManifest, type CompiledManifest } from "./manifest.js";

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
    }
  | {
      type: "stdio";
      command: string;
      args: string[];
      env: Record<string, string>;
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

  constructor(manifests: readonly unknown[]) {
    for (const input of manifests) {
      const manifest = compileManifest(input);
      if (this.byId.has(manifest.id)) throw Error(`integration_duplicate_id:${manifest.id}`);
      this.byId.set(manifest.id, manifest);
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
    return { level: classifyTool(manifest, toolName), denied: isDenied(manifest, toolName) };
  }

  static credentialEnv(manifest: CompiledManifest): string | undefined {
    return manifest.credential.env;
  }

  static storeProvider(manifest: CompiledManifest): string {
    return manifest.credential.store_provider ?? manifest.id;
  }

  /**
   * Turn a manifest plus a secret into the exact connection the MCP provider must
   * open. This is the only place that knows how a manifest maps onto a transport.
   */
  /**
   * Resolve the optional media fetch. Returns `undefined` when the manifest has
   * none — or when its base URL is not configured, because the result is only an
   * enhancement: the tool call itself still works without it.
   */
  static media(manifest: CompiledManifest, secret: string, env: NodeJS.ProcessEnv = process.env): MediaDescriptor | undefined {
    if (!manifest.media) return undefined;
    const baseEnv = manifest.media.base_env
      ?? manifest.app.launch_env
      ?? (manifest.transport.type === "streamable-http" ? manifest.transport.endpoint_env : undefined);
    const base = baseEnv ? env[baseEnv]?.trim() : undefined;
    if (!base || !/^https?:\/\//.test(base)) return undefined;
    const scheme = manifest.media.scheme.trim();
    return {
      tool: manifest.media.tool,
      id_argument: manifest.media.id_argument,
      url_template: `${base.replace(/\/$/, "")}${manifest.media.path}`,
      headers: { [manifest.media.header]: scheme ? `${scheme} ${secret}` : secret },
      content_types: [...manifest.media.content_types],
      max_bytes: manifest.media.max_bytes,
      id_pattern: manifest.media.id_pattern,
    };
  }

  static connection(manifest: CompiledManifest, secret: string, env: NodeJS.ProcessEnv = process.env): ConnectionDescriptor {
    if (manifest.transport.type === "streamable-http") {
      const base = env[manifest.transport.endpoint_env]?.trim();
      if (!base || !/^https?:\/\//.test(base)) throw Error(`${manifest.id}_not_configured`);
      const endpoint = `${base.replace(/\/$/, "")}${manifest.transport.endpoint_path ?? ""}`;
      const scheme = manifest.transport.credential_scheme.trim();
      return {
        type: "streamable-http",
        endpoint: endpoint.replace(/\/$/, ""),
        headers: {
          [manifest.transport.credential_header]: scheme ? `${scheme} ${secret}` : secret,
        },
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
    if (!manifest.app.icon && !manifest.app.launch_env) return undefined;
    const launch = manifest.app.launch_env ? env[manifest.app.launch_env]?.trim() : undefined;
    const valid = launch && /^https?:\/\//.test(launch) ? launch.replace(/\/$/, "") : undefined;
    return {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      status: valid ? "ready" : "unconfigured",
      launch: valid ? { web: valid } : {},
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
