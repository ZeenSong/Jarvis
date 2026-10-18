import { z } from "zod";

const localized = z.record(z.string(), z.string());
const storeEntry = z.object({
  title: localized.nullish(), description: localized.nullish(),
  icon: z.string().optional(), category: z.string().optional(),
  architectures: z.array(z.string()).optional(), main: z.string().optional(),
  port_map: z.string().optional(), scheme: z.string().optional(),
});
const storeResponse = z.object({ data: z.object({
  list: z.record(z.string(), storeEntry), installed: z.array(z.string()).optional(),
}) });
const envelope = z.object({ data: z.unknown() });
export type ProviderErrorCode = "unauthorized" | "unavailable" | "not_found" | "conflict" | "invalid_response" | "request_failed";
export class CasaOSError extends Error {
  constructor(readonly code: ProviderErrorCode, readonly status?: number) {
    super(`casaos:${code}`);
  }
}
const label = (value: Record<string, string> | null | undefined, fallback = "") =>
  value?.zh_CN ?? value?.zh_cn ?? value?.en_US ?? value?.en_us ?? Object.values(value ?? {})[0] ?? fallback;
const appId = (value: string) => encodeURIComponent(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/).parse(value));

/** Server-side transport only. Mutations must be authorized/approved by the capability layer. */
export class CasaOSClient {
  private readonly base: URL;
  constructor(private readonly config: { baseUrl: string; accessToken: () => string | Promise<string>; timeoutMs?: number }) {
    this.base = new URL(config.baseUrl);
    if (!["http:", "https:"].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash) {
      throw Error("Invalid CasaOS base URL");
    }
  }

  private async request(path: string, options: { method?: string; body?: string; yaml?: boolean } = {}) {
    const token = await this.config.accessToken();
    if (!token) throw new CasaOSError("unauthorized");
    let response: Response;
    let text: string;
    try {
      response = await fetch(new URL(`/v2/app_management${path}`, this.base), {
        method: options.method ?? "GET", body: options.body, redirect: "error",
        headers: { Authorization: token, Accept: options.yaml ? "application/yaml" : "application/json",
          ...(options.body ? { "Content-Type": options.yaml ? "application/yaml" : "application/json" } : {}) },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15000),
      });
      // Bound response consumption, including logs. Never echo provider errors/credentials.
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new CasaOSError("invalid_response"); }
        chunks.push(chunk.value);
      }
      text = Buffer.concat(chunks).toString("utf8");
    } catch (error) {
      if (error instanceof CasaOSError) throw error;
      throw new CasaOSError("unavailable");
    }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "unauthorized"
        : response.status === 404 ? "not_found" : response.status === 409 ? "conflict"
        : response.status >= 500 ? "unavailable" : "request_failed";
      throw new CasaOSError(code, response.status);
    }
    if (options.yaml) return text;
    try { return JSON.parse(text); } catch { throw new CasaOSError("invalid_response", response.status); }
  }

  private parse<T>(schema: z.ZodType<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) throw new CasaOSError("invalid_response");
    return result.data;
  }

  async info() {
    return this.parse(z.object({ architecture: z.string() }), await this.request("/info"));
  }
  async store() {
    const { data } = this.parse(storeResponse, await this.request("/apps"));
    return Object.entries(data.list).map(([id, value]) => ({
      provider_app_id: id, name: label(value.title, id), description: label(value.description),
      icon: value.icon, category: value.category, architectures: value.architectures ?? [],
      main_service: value.main, installed: data.installed?.includes(id) ?? false,
    }));
  }
  async installed() {
    return this.parse(z.object({ data: z.record(z.string(), z.unknown()) }), await this.request("/compose")).data;
  }
  async applications() {
    return normalizeApplications(await this.installed());
  }
  /** Internal catalog view: ports/scheme for connection detection, no secrets. */
  async applicationDetails() {
    return normalizeApplicationsDetailed(await this.installed());
  }
  async updates() {
    return this.parse(z.object({ data: z.array(z.unknown()) }), await this.request("/apps/upgradable")).data;
  }
  async detail(id: string) { return this.parse(envelope, await this.request(`/compose/${appId(id)}`)).data; }
  async logs(id: string, lines = 200) {
    z.number().int().min(1).max(2000).parse(lines);
    return this.parse(z.object({ data: z.string() }), await this.request(`/compose/${appId(id)}/logs?lines=${lines}`)).data;
  }
  async storeCompose(id: string) { return this.request(`/apps/${appId(id)}/compose`, { yaml: true }) as Promise<string>; }
  async validateInstall(compose: string) {
    z.string().min(1).max(262144).parse(compose);
    return this.request("/compose?dry_run=true&check_port_conflict=true", { method: "POST", body: compose, yaml: true });
  }
  async install(compose: string) {
    z.string().min(1).max(262144).parse(compose);
    return this.request("/compose?check_port_conflict=true", { method: "POST", body: compose, yaml: true });
  }
  async setState(id: string, state: "start" | "stop") {
    z.enum(["start", "stop"]).parse(state);
    return this.request(`/compose/${appId(id)}/status`, { method: "PUT", body: JSON.stringify(state) });
  }
  /**
   * Apply a whole compose document to an existing app. JSON is valid YAML 1.2,
   * so a compose read back as JSON can be edited and sent without a YAML
   * library. `dryRun` validates ports and the document without touching the
   * running containers.
   */
  async applyCompose(
    id: string,
    compose: string,
    options: { dryRun?: boolean; checkPortConflict?: boolean } = {},
  ) {
    z.string().min(1).max(262144).parse(compose);
    const query = new URLSearchParams();
    if (options.dryRun) query.set("dry_run", "true");
    if (options.checkPortConflict !== false) query.set("check_port_conflict", "true");
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request(`/compose/${appId(id)}${suffix}`, { method: "PUT", body: compose, yaml: true }) as Promise<string>;
  }
  async restart(id: string) {
    return this.request(`/compose/${appId(id)}/status`, { method: "PUT", body: JSON.stringify("restart") });
  }
}

/** Explicit allowlist: never expose provider Compose secrets or arbitrary URLs. */
export function normalizeApplications(values: Record<string, unknown>) {
  const metadata = z.object({ title: localized.nullish(), description: localized.nullish() });
  return Object.entries(values).map(([id, raw]) => {
    const entry = z.object({ status: z.string().optional(), compose: z.object({ "x-casaos": z.unknown().optional(), services: z.record(z.string(), z.unknown()).optional() }).optional() }).safeParse(raw);
    const meta = metadata.safeParse(entry.success ? entry.data.compose?.["x-casaos"] : undefined);
    const state = entry.success ? entry.data.status : undefined;
    return { id, provider: "casaos" as const, name: meta.success ? label(meta.data.title, id) : id,
      status: state === "running" ? "running" : state === "stopped" || state === "exited" ? "stopped" : "unknown",
      description: meta.success ? label(meta.data.description) : "",
      service_count: entry.success && entry.data.compose?.services ? Object.keys(entry.data.compose.services).length : null };
  });
}

/**
 * Internal view used by the app catalog. It adds the information needed to
 * derive a base URL (the published port and the declared scheme), but it still
 * never copies Compose environment, volumes or credentials.
 */
export type CasaOSApplicationDetail = {
  id: string;
  provider: "casaos";
  name: string;
  status: "running" | "stopped" | "unknown";
  description: string;
  service_count: number | null;
  main_service?: string;
  scheme: string;
  port_map?: number;
  /** The TCP port that should be used to reach the app's web UI. */
  web_port?: number;
  category?: string;
  icon?: string;
  architectures: string[];
  published_ports: Array<{
    service: string;
    target?: number;
    published?: number;
    protocol?: string;
    host_ip?: string;
  }>;
};

const portEntry = z
  .object({
    target: z.number().int().positive().optional(),
    published: z.union([z.string(), z.number()]).optional(),
    protocol: z.string().optional(),
    host_ip: z.string().optional(),
  })
  .passthrough();

const casaosMeta = z
  .object({
    title: localized.nullish(),
    description: localized.nullish(),
    icon: z.string().optional(),
    category: z.string().optional(),
    main: z.string().optional(),
    scheme: z.string().optional(),
    port_map: z.union([z.string(), z.number()]).optional(),
    architectures: z.array(z.string()).optional(),
  })
  .passthrough();

function portNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isInteger(number) && number > 0 && number <= 65535 ? number : undefined;
}

export function normalizeApplicationsDetailed(values: Record<string, unknown>): CasaOSApplicationDetail[] {
  return Object.entries(values).map(([id, raw]) => {
    const entry = z
      .object({
        status: z.string().optional(),
        compose: z
          .object({
            "x-casaos": z.unknown().optional(),
            services: z.record(z.string(), z.object({ ports: z.array(portEntry).optional() }).passthrough()).optional(),
          })
          .optional(),
      })
      .safeParse(raw);
    const compose = entry.success ? entry.data.compose : undefined;
    const meta = casaosMeta.safeParse(compose?.["x-casaos"]);
    const state = entry.success ? entry.data.status : undefined;
    const services = compose?.services ?? {};
    const published: CasaOSApplicationDetail["published_ports"] = [];
    for (const [service, value] of Object.entries(services)) {
      for (const port of value.ports ?? []) {
        published.push({
          service,
          ...(port.target ? { target: port.target } : {}),
          ...(portNumber(port.published) ? { published: portNumber(port.published) } : {}),
          ...(port.protocol ? { protocol: port.protocol } : {}),
          ...(port.host_ip ? { host_ip: port.host_ip } : {}),
        });
      }
    }
    const main = meta.success ? meta.data.main : undefined;
    // Prefer the port of the service CasaOS marks as the entry point; fall back
    // to any published TCP port, then to the declared port_map.
    const mainPorts = main ? published.filter((port) => port.service === main) : [];
    const tcp = (ports: typeof published) => ports.find((port) => port.published && (!port.protocol || port.protocol === "tcp"));
    const chosen = tcp(mainPorts) ?? tcp(published);
    const portMap = meta.success ? portNumber(meta.data.port_map) : undefined;
    return {
      id,
      provider: "casaos" as const,
      name: meta.success ? label(meta.data.title, id) : id,
      status: state === "running" ? "running" : state === "stopped" || state === "exited" ? "stopped" : "unknown",
      description: meta.success ? label(meta.data.description) : "",
      service_count: Object.keys(services).length,
      ...(main ? { main_service: main } : {}),
      scheme: meta.success && (meta.data.scheme === "https" || meta.data.scheme === "http") ? meta.data.scheme : "http",
      ...(portMap ? { port_map: portMap } : {}),
      ...(chosen?.published ?? portMap ? { web_port: chosen?.published ?? portMap } : {}),
      ...(meta.success && meta.data.category ? { category: meta.data.category } : {}),
      ...(meta.success && meta.data.icon ? { icon: meta.data.icon } : {}),
      architectures: meta.success ? (meta.data.architectures ?? []) : [],
      published_ports: published,
    };
  });
}
