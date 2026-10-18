import { z } from "zod";
import { CasaOSClient, CasaOSError } from "../../../packages/integration-casaos/src/index.js";
import { withCasaOS } from "./applications.js";
import type { Database } from "./persistence.js";

/**
 * CasaOS management for the agent.
 *
 * CasaOS is the host platform, not a normal app: it is authenticated with the
 * household CasaOS session, never with a password entered in Hermes. These
 * helpers therefore reuse the same session file as discovery and never expose
 * Compose environment or volumes to the model.
 */

const appId = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/, "casaos_app_invalid");
const serviceName = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/, "casaos_service_invalid");

const portMapping = z
  .object({
    target: z.number().int().min(1).max(65535),
    published: z.number().int().min(1).max(65535),
    protocol: z.enum(["tcp", "udp"]).default("tcp"),
  })
  .strict();

const addPortsInput = z
  .object({
    app_id: appId,
    service: serviceName,
    ports: z.array(portMapping).min(1).max(16),
    dry_run: z.boolean().default(false),
  })
  .strict();

export type CasaOSPortMapping = z.infer<typeof portMapping>;

type ComposeService = {
  image?: unknown;
  ports?: unknown;
  [key: string]: unknown;
};

type ComposeDocument = {
  name?: unknown;
  services?: unknown;
  [key: string]: unknown;
};

type CasaOSDetail = {
  compose?: ComposeDocument;
  status?: unknown;
  [key: string]: unknown;
};

function portList(value: unknown): Array<{ target?: number; published?: string; protocol?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      ...(Number.isInteger(Number(item.target)) ? { target: Number(item.target) } : {}),
      ...(item.published === undefined || item.published === null ? {} : { published: String(item.published) }),
      ...(typeof item.protocol === "string" ? { protocol: item.protocol } : {}),
    }));
}

function servicesOf(compose: ComposeDocument): Record<string, ComposeService> {
  const services = compose.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) return {};
  return services as Record<string, ComposeService>;
}

function nameOf(compose: ComposeDocument, fallback: string): string {
  return typeof compose.name === "string" && compose.name ? compose.name : fallback;
}

function detailOf(value: unknown): CasaOSDetail {
  if (!value || typeof value !== "object") throw Error("casaos_invalid_response");
  return value as CasaOSDetail;
}

/** CasaOS management is a household-admin action, never a member action. */
export async function requireCasaOSAdmin(db: Database, userId: string | undefined) {
  if (!userId) throw Error("user_login_required");
  const user = (await db.query("SELECT role FROM users WHERE id=$1", [userId])).rows[0];
  if (!user) throw Error("user_not_found");
  if (user.role !== "admin") throw Error("admin_required");
  return userId;
}

/** A redacted view of one installed app: images and ports, never env or volumes. */
export function summarizeCompose(id: string, detail: CasaOSDetail) {
  const compose = detail.compose ?? {};
  const services = servicesOf(compose);
  return {
    app_id: id,
    name: nameOf(compose, id),
    status: typeof detail.status === "string" ? detail.status : "unknown",
    services: Object.entries(services).map(([name, service]) => ({
      name,
      image: typeof service.image === "string" ? service.image : "",
      ports: portList(service.ports),
    })),
  };
}

/** Translate a CasaOS transport failure into a stable, non-secret error code. */
export function casaosErrorCode(error: unknown): string {
  if (!(error instanceof CasaOSError)) return "casaos_unavailable";
  switch (error.code) {
    case "unauthorized":
      return "casaos_authentication_required";
    case "not_found":
      return "casaos_app_not_found";
    case "conflict":
      return "casaos_port_conflict";
    case "invalid_response":
      return "casaos_invalid_response";
    case "request_failed":
      return "casaos_request_failed";
    default:
      return "casaos_unavailable";
  }
}

async function run<T>(operation: (client: CasaOSClient, session: unknown) => Promise<T>): Promise<T> {
  try {
    return await withCasaOS(operation);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("casaos_")) throw error;
    throw Error(casaosErrorCode(error));
  }
}

/**
 * Merge host-port mappings into a service's existing list. Only additions are
 * made; an existing target/published/protocol triple is never duplicated and
 * other port fields (host_ip, mode) are preserved.
 */
export function mergePortMappings(
  existing: unknown,
  additions: CasaOSPortMapping[],
): { ports: Array<Record<string, unknown>>; added: CasaOSPortMapping[] } {
  const ports = Array.isArray(existing) ? existing as Array<Record<string, unknown>> : [];
  const added: CasaOSPortMapping[] = [];
  for (const mapping of additions) {
    const duplicate = ports.some((port) =>
      Number(port.target) === mapping.target
      && Number(port.published) === mapping.published
      && String(port.protocol ?? "tcp") === mapping.protocol);
    if (!duplicate) {
      added.push(mapping);
      ports.push({ target: mapping.target, published: String(mapping.published), protocol: mapping.protocol });
    }
  }
  return { ports, added };
}

/** Read one app without leaking Compose environment, volumes or credentials. */
export async function casaosAppDetail(app: string) {
  const id = appId.parse(app);
  const raw = await run(async (client) => client.detail(id));
  return summarizeCompose(id, detailOf(raw));
}

/**
 * Add one or more host port mappings to an existing service.
 *
 * The whole compose document is read back as JSON, extended in memory and sent
 * back as `application/yaml` (JSON is valid YAML 1.2). A dry run always comes
 * first, so an invalid mapping or a host port conflict is rejected before any
 * container is recreated.
 */
export async function casaosAddPorts(value: unknown) {
  const input = addPortsInput.parse(value);
  const raw = detailOf(await run(async (client) => client.detail(input.app_id)));
  const compose = raw.compose;
  if (!compose) throw Error("casaos_invalid_response");
  const services = servicesOf(compose);
  const service = services[input.service];
  if (!service) throw Error("casaos_service_unknown");

  const ports = Array.isArray(service.ports) ? service.ports as Array<Record<string, unknown>> : [];
  const { added } = mergePortMappings(ports, input.ports);
  service.ports = ports;
  const document = JSON.stringify(compose);

  let validation: string;
  try {
    validation = String(await run(async (client) => client.applyCompose(input.app_id, document, {
      dryRun: true,
      checkPortConflict: true,
    })));
  } catch (error) {
    const message = error instanceof Error ? error.message : "casaos_unavailable";
    // A rejected document is not a transport failure; never report it as one.
    if (message === "casaos_port_conflict" || message === "casaos_app_not_found"
      || message === "casaos_authentication_required" || message === "casaos_unavailable") throw error;
    throw Error("casaos_compose_invalid");
  }

  if (input.dry_run || added.length === 0) {
    return {
      app_id: input.app_id,
      service: input.service,
      added,
      dry_run: true,
      applied: false,
      validation: validation.slice(0, 400),
      ports: portList(service.ports),
    };
  }

  const applied = await run(async (client) => client.applyCompose(input.app_id, document, {
    dryRun: false,
    checkPortConflict: true,
  }));
  return {
    app_id: input.app_id,
    service: input.service,
    added,
    dry_run: false,
    applied: true,
    message: String(applied).slice(0, 400),
    ports: portList(service.ports),
  };
}

/** Restart an app through CasaOS; the mutation is asynchronous upstream. */
export async function casaosRestart(app: string) {
  const id = appId.parse(app);
  await run(async (client) => client.restart(id));
  return { app_id: id, restart: "requested" };
}

/** Recent logs, bounded before they can reach a model context. */
export async function casaosLogs(app: string, lines = 100) {
  const id = appId.parse(app);
  const count = z.number().int().min(1).max(200).parse(lines);
  const output = await run(async (client) => client.logs(id, count));
  return { app_id: id, lines: count, logs: String(output).slice(-12_000) };
}
