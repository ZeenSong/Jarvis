import type { Capability } from "../../capability-registry/src/index.js";
import { compileManifest, type CompiledManifest } from "./manifest.js";

/**
 * Built-in integrations expressed as manifests.
 *
 * These two used to be hardcoded across the server, the bridge and the UI. They
 * are now just data, which is the whole point: migrating to the registry must not
 * change behaviour, so these manifests reproduce the previous configuration
 * exactly.
 */
export const builtinManifests: readonly unknown[] = [
  {
    id: "homeassistant",
    name: "Home Assistant",
    description: "家庭设备状态、实体列表与摄像头快照。",
    kind: "mcp",
    transport: {
      type: "streamable-http",
      endpoint_env: "HOME_ASSISTANT_URL",
      endpoint_path: "/api/mcp",
      credential_header: "Authorization",
      credential_scheme: "Bearer",
    },
    credential: {
      env: "HOME_ASSISTANT_TOKEN",
      store_provider: "home-assistant",
      hint: "在 Home Assistant 中创建长期访问令牌。",
    },
    tools: {
      // The upstream server owns its tool names. Anything not recognised here is
      // treated as a write and requires an explicit household grant.
      read: ["GetLiveContext", "GetDateTime", "camera_entities_list", "camera_snapshot_read", "*_list", "*_read", "*_get"],
      write: ["*_set", "*_call", "*_toggle", "*_create", "*_delete", "*_turn_on", "*_turn_off"],
      deny: [],
      overrides: {},
    },
    scopes: { read: "mcp.homeassistant.read", write: "mcp.homeassistant.write" },
    capabilities: ["home.read", "home.*"],
    app: {
      icon: "homeassistant-glyph",
      launch_env: "HOME_ASSISTANT_URL",
      deep_links: {
        entity: "{base}/config/entities?entity_id={id}",
        dashboard: "{base}/lovelace/{id}",
      },
      capabilities: ["homeassistant.entity.read", "homeassistant.dashboard.read"],
      resources: ["entity", "dashboard"],
    },
    healthcheck: { method: "GET", path: "/api/states", header: "Authorization", scheme: "Bearer", ok_status: [200] },
    risk: "read",
  },
  {
    id: "immich",
    name: "Immich",
    description: "照片语义搜索、相册与受控缩略图。",
    kind: "mcp",
    transport: {
      type: "stdio",
      command: "/usr/share/dotnet/dotnet",
      args: ["/opt/immich-mcp/ImmichMCP.dll", "--stdio"],
      credential_env: "IMMICH_API_KEY",
      env: {
        IMMICH_BASE_URL: "${IMMICH_URL}",
        DOTNET_ROOT: "/usr/share/dotnet",
        DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1",
      },
      inherit_env: ["PATH", "LANG"],
    },
    credential: {
      env: "IMMICH_API_KEY",
      store_provider: "immich",
      hint: "在 Immich 的账户设置中创建 API Key。",
    },
    tools: {
      read: ["*_search", "*_list", "*_get", "*_read", "*_download_thumbnail"],
      write: ["*_create", "*_update", "*_delete", "*_upload", "*_share"],
      deny: ["*_delete_shared_link", "*shared_link*"],
      overrides: { immich_assets_download_thumbnail: "read" },
    },
    scopes: { read: "mcp.immich.read", write: "mcp.immich.write" },
    capabilities: ["photo.read", "photo.*"],
    app: {
      icon: "immich-glyph",
      launch_env: "IMMICH_URL",
      deep_links: {
        photo: "{base}/photos/{id}",
        album: "{base}/albums/{id}",
        search: "{base}/search",
      },
      capabilities: ["immich.photo.search", "immich.album.read"],
      resources: ["photo", "album", "search"],
    },
    healthcheck: { method: "GET", path: "/api/users/me", header: "x-api-key", scheme: "", ok_status: [200] },
    risk: "read",
  },
];

/** Match an upstream tool name against a manifest pattern (`*`, `prefix*`, `*suffix`). */
export function matchToolPattern(pattern: string, toolName: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === toolName;
  const startsWildcard = pattern.startsWith("*");
  const endsWildcard = pattern.endsWith("*");
  const core = pattern.replace(/^\*+|\*+$/g, "");
  if (!core) return true;
  if (startsWildcard && endsWildcard) return toolName.includes(core);
  if (startsWildcard) return toolName.endsWith(core);
  if (endsWildcard) return toolName.startsWith(core);
  return pattern === toolName;
}

export function matchesAny(patterns: readonly string[], toolName: string): boolean {
  return patterns.some((pattern) => matchToolPattern(pattern, toolName));
}

/** Access level required to call `toolName`. Unknown tools default to write. */
export function classifyTool(
  manifest: CompiledManifest,
  toolName: string,
): "read" | "write" {
  const policy = manifest.tools;
  const override = policy.overrides[toolName];
  if (override) return override;
  if (matchesAny(policy.deny, toolName)) return "write";
  if (matchesAny(policy.write, toolName)) return "write";
  if (matchesAny(policy.read, toolName)) return "read";
  // Fail closed: a tool the operator has not classified must not be callable
  // without the write grant.
  return "write";
}

export function isDenied(manifest: CompiledManifest, toolName: string): boolean {
  return matchesAny(manifest.tools.deny, toolName);
}

/** Capability-catalog entries contributed by a manifest. */
export function manifestCapabilities(manifest: CompiledManifest): Capability[] {
  const entries: Capability[] = [];
  for (const level of ["read", "write"] as const) {
    const patterns = level === "read" ? manifest.tools.read : manifest.tools.write;
    if (!patterns.length) continue;
    entries.push({
      id: `${manifest.id}.mcp.${level}`,
      kind: "mcp",
      risk: level,
      approval_required: level === "write",
      provider: "hermes",
    } as Capability);
  }
  return entries;
}
