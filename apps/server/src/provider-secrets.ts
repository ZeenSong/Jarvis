import type { Database } from "./persistence.js";
import {
  builtinManifests,
  compileManifest,
  IntegrationRegistry,
  type CompiledManifest,
} from "../../../packages/integrations/src/index.js";
import type { IntegrationCredentialStore } from "./integration-credentials.js";

/**
 * Resolve a provider secret for one owner.
 *
 * Stored household credentials win over the process environment so a member can
 * connect their own account without editing deployment files. Only this module
 * knows the precedence, so the catalog and the legacy MCP bridge agree.
 */
export async function resolveProviderSecret(
  manifest: CompiledManifest,
  owner: string,
  credentials: IntegrationCredentialStore,
): Promise<{ secret: string; source: "store" | "env" } | undefined> {
  if (process.env.INTEGRATION_CREDENTIAL_KEY) {
    const stored = await credentials
      .readProviderSecret(owner, IntegrationRegistry.storeProvider(manifest))
      .catch(() => undefined);
    if (stored) return { secret: stored, source: "store" };
  }
  const envName = IntegrationRegistry.credentialEnv(manifest);
  const value = envName ? process.env[envName]?.trim() : undefined;
  return value ? { secret: value, source: "env" } : undefined;
}

/**
 * Read the configured manifests written by the app catalog.
 *
 * One malformed row must not stop Jarvis from booting, so it is skipped instead
 * of failing the whole registry construction.
 */
export async function loadConfiguredManifests(
  db: Database,
): Promise<{ manifests: unknown[]; invalid: string[] }> {
  const manifests: unknown[] = [];
  const invalid: string[] = [];
  let rows: Array<{ id: string; manifest: unknown }> = [];
  try {
    rows = (await db.query("SELECT id,manifest FROM integration_manifests ORDER BY id")).rows;
  } catch {
    // The table is created by migration 0007; a database that has not migrated
    // yet simply has no configured apps.
    return { manifests, invalid };
  }
  for (const row of rows) {
    // A catalog row must never shadow a built-in provider: the registry would
    // reject the duplicate and the server would fail to boot.
    if (builtinManifests.some((manifest) => (manifest as { id?: unknown }).id === row.id)) {
      invalid.push(`${row.id}:builtin`);
      continue;
    }
    try {
      compileManifest(row.manifest);
      manifests.push(row.manifest);
    } catch {
      invalid.push(row.id);
    }
  }
  return { manifests, invalid };
}
