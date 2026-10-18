import { readFileSync } from "node:fs";

/**
 * Resolve the product version from the single source of truth: `package.json`.
 *
 * `import.meta.url` points at `apps/server/src/version.ts` in development and at
 * `dist/apps/server/src/version.js` in the container. Both are four directories
 * below the repository root, so one relative URL works in both layouts.
 */
export function readPackageVersion(moduleUrl: string): string {
  for (const candidate of ["../../../../package.json", "../../package.json"]) {
    try {
      const url = new URL(candidate, moduleUrl);
      const value = JSON.parse(readFileSync(url, "utf8")) as { version?: unknown };
      if (typeof value.version === "string" && value.version.trim()) return value.version.trim();
    } catch {
      // Try the next candidate; fall through to the sentinel below.
    }
  }
  return "0.0.0-unknown";
}
