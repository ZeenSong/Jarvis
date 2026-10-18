import { z } from "zod";

/**
 * A declarative description of one external application that Jarvis can drive.
 *
 * The point of this file is to make "connect a new app" a configuration change
 * instead of a code change. Before this module every new integration forced edits
 * in at least seven places: the capability bridge switch in `app.ts`, the
 * capability catalog and app resolver in `m2.ts`, the app list, the credential
 * key switch, provider-specific fetch helpers, the Python MCP provider, and the
 * scope strings.
 *
 * A manifest carries everything those places used to hardcode.
 */

const identifier = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,39}$/, "integration id must be kebab-case");

/** Environment variable reference. Values are read at runtime, never stored. */
const envName = z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/);

const toolPattern = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_.*-]+$/, "tool patterns are tool names or a leading/trailing *");

/**
 * One declarative REST operation exposed as a tool.
 *
 * HTTP integrations do not need a new MCP server and do not need TypeScript: the
 * manifest names the operation, its method and path template, and the policy
 * level. The executor substitutes `{param}` placeholders from the declared
 * parameters; nothing the model supplies can change the method or the path
 * prefix, so a configured app cannot be turned into an arbitrary HTTP proxy.
 */
export const operationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,63}$/, "operation name must be snake_case"),
    description: z.string().trim().max(400).default(""),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    /** Path template relative to the app base URL, e.g. "/Items?searchTerm={q}". */
    path: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .regex(/^\/[A-Za-z0-9._\/{}=&?:%+-]*$/),
    /** A read operation needs only the read scope. Unknown levels fail closed. */
    read_only: z.boolean().default(false),
    params: z
      .array(
        z
          .object({
            name: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
            in: z.enum(["path", "query", "body"]).default("query"),
            required: z.boolean().default(false),
            type: z.enum(["string", "number", "boolean"]).default("string"),
            description: z.string().trim().max(200).default(""),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    /** How body parameters are encoded. `form` is what qBittorrent expects. */
    body_format: z.enum(["json", "form"]).default("json"),
  })
  .strict();

/** How a credential is attached to an HTTP request. */
export const httpAuthSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  /** `Authorization: Bearer <secret>`. */
  z.object({ mode: z.literal("bearer") }).strict(),
  /** Any header, with an optional scheme prefix (`X-Emby-Token`, `token`). */
  z
    .object({
      mode: z.literal("header"),
      header: z.string().trim().min(1).max(64).default("Authorization"),
      scheme: z.string().trim().max(32).default(""),
    })
    .strict(),
  /** Query parameter, e.g. `?api_key=<secret>`. */
  z.object({ mode: z.literal("query"), param: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/) }).strict(),
  /** `Authorization: Basic base64(user:pass)`; the secret is `user:pass`. */
  z.object({ mode: z.literal("basic") }).strict(),
  /**
   * Username/password login that yields a cookie session. The secret is stored
   * as `user:pass`; the session cookie is held in memory only and is renewed on
   * the statuses listed in `renew_on`.
   */
  z
    .object({
      mode: z.literal("session"),
      login_path: z.string().trim().regex(/^\/[A-Za-z0-9._\/-]{0,200}$/),
      login_method: z.enum(["GET", "POST"]).default("POST"),
      login_format: z.enum(["form", "json"]).default("form"),
      login_fields: z.record(z.string().max(60), z.string().max(200)).default({
        username: "{username}",
        password: "{password}",
      }),
      cookie_name: z.string().trim().regex(/^[A-Za-z0-9_-]{1,60}$/),
      /** Some servers answer 200 with a failure body (qBittorrent: "Fails."). */
      ok_body_contains: z.string().max(200).optional(),
      renew_on: z.array(z.number().int().min(400).max(599)).max(10).default([401, 403]),
    })
    .strict(),
]);

export const transportSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("streamable-http"),
      /** Literal endpoint, detected from CasaOS and saved by the catalog. */
      endpoint: z.string().url().optional(),
      /** Environment variable holding the app base URL (or the MCP endpoint). */
      endpoint_env: envName.optional(),
      /** Path appended to the base URL to reach the MCP endpoint. */
      endpoint_path: z.string().trim().regex(/^(\/[A-Za-z0-9._\/-]*)?$/).default(""),
      /** Credential header injected into the upstream MCP connection. */
      credential_header: z.string().trim().min(1).max(64).default("Authorization"),
      credential_scheme: z.string().trim().max(32).default("Bearer"),
      /**
       * Some self-hosted apps (Obsidian, many NAS consoles) present a
       * self-signed certificate whose SAN does not match the address Jarvis
       * reaches them at. Verification would otherwise fail before the MCP
       * handshake. This only relaxes the certificate check for this one
       * upstream connection; every other integration keeps full verification.
       */
      allow_insecure_tls: z.boolean().default(false),
    })
    .strict()
    .refine((value) => Boolean(value.endpoint || value.endpoint_env), {
      message: "streamable-http requires endpoint or endpoint_env",
    }),
  z
    .object({
      type: z.literal("stdio"),
      command: z.string().trim().min(1).max(400),
      args: z.array(z.string().max(200)).max(20).default([]),
      /** Credential is exposed to the child process under this variable. */
      credential_env: envName,
      /** Extra env passed to the child; values may reference `${...}` env vars. */
      env: z.record(z.string(), z.string().max(400)).default({}),
      /** Environment variables the child must receive from the server process. */
      inherit_env: z.array(envName).max(20).default([]),
    })
    .strict(),
  /**
   * Plain REST. The app has no MCP server; Jarvis exposes the manifest's
   * declared operations as tools and attaches the household credential itself.
   */
  z
    .object({
      type: z.literal("http"),
      /** Literal base URL detected from the CasaOS port map. */
      base_url: z.string().url().optional(),
      /** Alternative: environment variable holding the base URL. */
      base_env: envName.optional(),
      auth: httpAuthSchema.default({ mode: "none" }),
      operations: z.array(operationSchema).max(80).default([]),
      max_response_bytes: z.number().int().min(1024).max(4 * 1024 * 1024).default(256 * 1024),
      timeout_ms: z.number().int().min(1000).max(60000).default(15000),
    })
    .strict()
    .refine((value) => Boolean(value.base_url || value.base_env), {
      message: "http transport requires base_url or base_env",
    }),
]);

export const credentialSchema = z
  .object({
    /** Environment variable holding the secret when no stored credential exists. */
    env: envName.optional(),
    /** Provider name used by the encrypted household credential store. */
    store_provider: z.string().trim().min(1).max(80).optional(),
    /** Human hint shown in the integrations UI. */
    hint: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.env || value.store_provider), {
    message: "credential requires env or store_provider",
  });

export const toolPolicySchema = z
  .object({
    /** Tools matching these patterns require no write scope. */
    read: z.array(toolPattern).max(200).default([]),
    /** Tools matching these patterns require the write scope. */
    write: z.array(toolPattern).max(200).default([]),
    /** Tools always refused, regardless of scope. */
    deny: z.array(toolPattern).max(200).default([]),
    /**
     * Explicit classification wins over pattern matching. Use sparingly; the
     * default is "unknown tools are writes" so a new upstream tool cannot be
     * called without an explicit grant.
     */
    overrides: z.record(z.string().max(120), z.enum(["read", "write"])).default({}),
  })
  .strict();

/** Declarative connectivity probe used by "test credential" in the UI. */
export const healthcheckSchema = z
  .object({
    method: z.enum(["GET", "HEAD", "POST"]).default("GET"),
    /** Path appended to the app base URL, e.g. "/api/states". */
    path: z.string().trim().regex(/^\/[A-Za-z0-9._\/-]{0,200}$/),
    header: z.string().trim().min(1).max(64).default("Authorization"),
    scheme: z.string().trim().max(32).default("Bearer"),
    /** HTTP statuses that prove the credential works. */
    ok_status: z.array(z.number().int().min(100).max(599)).max(10).default([200]),
  })
  .strict();

export const appSchema = z
  .object({
    /** Icon basename under /app-icons (svg without extension). */
    icon: z.string().trim().regex(/^[a-z0-9-]{1,40}$/).optional(),
    /** Environment variable holding the user-facing base URL. */
    launch_env: envName.optional(),
    /** Literal web base URL, detected from CasaOS when the app is configured. */
    base_url: z.string().url().optional(),
    /** Deep link templates; `{base}` is replaced by launch URL, `{id}` by a resource id. */
    deep_links: z.record(z.string().max(80), z.string().max(400)).default({}),
    /** Capability labels surfaced in the App Detail page. */
    capabilities: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
    /** Resource kinds this app contributes (photo, album, entity, ...). */
    resources: z.array(z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/)).max(40).default([]),
  })
  .strict();

/**
 * Turn one upstream tool into a conversation media resource.
 *
 * Some photo servers expose their bytes through a plain HTTP endpoint instead of
 * an MCP result (Immich's thumbnail helper is one). That used to be a conditional
 * in the Python provider keyed on the provider name. Declaring it here means the
 * provider only applies a descriptor, and a new photo app needs no code.
 */
export const mediaSchema = z
  .object({
    /** Upstream tool whose response is a binary body rather than JSON. */
    tool: z.string().trim().min(1).max(120),
    /** Argument carrying the media id. */
    id_argument: z.string().trim().min(1).max(64).default("id"),
    /** Path template on the app base URL. `{id}` is replaced by the URL-encoded id. */
    path: z.string().trim().min(1).max(300).regex(/^\/[A-Za-z0-9._/{}-]*(\?[A-Za-z0-9._=&%{}-]*)?$/),
    /** Env var holding the app base URL. Defaults to the app launch env. */
    base_env: envName.optional(),
    header: z.string().trim().min(1).max(64).default("Authorization"),
    scheme: z.string().trim().max(32).default("Bearer"),
    content_types: z
      .array(z.enum(["image/jpeg", "image/png", "image/webp"]))
      .min(1)
      .max(8)
      .default(["image/jpeg", "image/png", "image/webp"]),
    max_bytes: z.number().int().min(1024).max(10 * 1024 * 1024).default(2 * 1024 * 1024),
    /** Regular expression the id must fully match before it is put in a URL. */
    id_pattern: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .default("[A-Za-z0-9._-]{1,80}")
      .refine((value) => {
        try {
          new RegExp(value);
          return true;
        } catch {
          return false;
        }
      }, "id_pattern must be a valid regular expression"),
  })
  .strict();

export const integrationManifestSchema = z
  .object({
    id: identifier,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(400).default(""),
    /**
     * `mcp` providers expose an upstream MCP server; `http` providers expose the
     * operations declared on their transport. The catalog writes the value it
     * detected, so the registry never has to guess.
     */
    kind: z.enum(["mcp", "http"]).default("mcp"),
    transport: transportSchema,
    credential: credentialSchema,
    tools: toolPolicySchema,
    /** Scope names this provider contributes, keyed by access level. */
    scopes: z
      .object({
        read: z.string().trim().regex(/^[a-z][a-z0-9._-]{2,79}$/).optional(),
        write: z.string().trim().regex(/^[a-z][a-z0-9._-]{2,79}$/).optional(),
      })
      .strict()
      .default({}),
    /** Task capabilities this provider can satisfy, e.g. ["photo.read"]. */
    capabilities: z.array(z.string().trim().regex(/^[a-z][a-z0-9.*_-]{1,79}$/)).max(40).default([]),
    app: appSchema.default({ deep_links: {}, capabilities: [], resources: [] }),
    healthcheck: healthcheckSchema.optional(),
    /** Optional tool whose bytes become a conversation media resource. */
    media: mediaSchema.optional(),
    /** Risk of a successful *write* call; used by the approval surface. */
    risk: z.enum(["read", "write", "execute"]).default("read"),
    enabled: z.boolean().default(true),
  })
  .strict();

export type IntegrationManifest = z.infer<typeof integrationManifestSchema>;
export type IntegrationTransport = z.infer<typeof transportSchema>;
export type IntegrationMedia = z.infer<typeof mediaSchema>;
export type ToolPolicy = z.infer<typeof toolPolicySchema>;
export type HttpAuth = z.infer<typeof httpAuthSchema>;
export type HttpTransport = Extract<IntegrationTransport, { type: "http" }>;
export type HttpOperation = z.infer<typeof operationSchema>;

export type CompiledManifest = IntegrationManifest & {
  readScope: string;
  writeScope: string;
};

/**
 * Fill in the derived scope names so every consumer agrees on them.
 * Defaults: `mcp.<id>.read` / `mcp.<id>.write`, matching the historical strings.
 */
export function compileManifest(input: unknown): CompiledManifest {
  const manifest = integrationManifestSchema.parse(input);
  return {
    ...manifest,
    readScope: manifest.scopes.read ?? `mcp.${manifest.id}.read`,
    writeScope: manifest.scopes.write ?? `mcp.${manifest.id}.write`,
  };
}
