import { createHash } from "node:crypto";
import type { Database } from "../persistence.js";
import { sql as baseline } from "./0001-baseline.js";
import { sql as hardening } from "./0002-hardening.js";
import { sql as repairRestartNoise } from "./0003-repair-restart-noise.js";
import { sql as closeStaleEvents } from "./0004-close-stale-events.js";
import { sql as leases } from "./0005-leases.js";
import { sql as scheduleBackoff } from "./0006-schedule-backoff.js";
import { sql as appCatalog } from "./0007-app-catalog.js";
import { sql as dshCodingAgent } from "./0008-dsh-coding-agent.js";

/**
 * Versioned schema migrations.
 *
 * Replaces the previous design, which ran one large idempotent script on every
 * boot. Problems with that design, all fixed here:
 *
 * - no record of what had been applied, so there was no way to reason about a
 *   deployment's schema version;
 * - ten `UPDATE ... FROM` backfills re-ran on every start (full table scans, and
 *   the 5s `statement_timeout` on the pool could abort boot);
 * - `CHECK` constraints could never evolve, because the script could only add
 *   `IF NOT EXISTS` clauses.
 *
 * Policy:
 * - Append-only. Never edit an applied migration; add the next number.
 * - One transaction per migration, serialized by an advisory lock.
 * - An existing database that predates this runner is *adopted*: baseline is
 *   recorded as applied instead of re-executed.
 */

export type Migration = { version: string; name: string; sql: string };

export const migrations: readonly Migration[] = [
  { version: "0001", name: "baseline", sql: baseline },
  { version: "0002", name: "hardening", sql: hardening },
  { version: "0003", name: "repair-restart-noise", sql: repairRestartNoise },
  { version: "0004", name: "close-stale-events", sql: closeStaleEvents },
  { version: "0005", name: "leases", sql: leases },
  { version: "0006", name: "schedule-backoff", sql: scheduleBackoff },
  { version: "0007", name: "app-catalog", sql: appCatalog },
  { version: "0008", name: "dsh-coding-agent", sql: dshCodingAgent },
];

export type MigrationLogger = {
  info: (value: Record<string, unknown>, message: string) => void;
  warn: (value: Record<string, unknown>, message: string) => void;
};

const ADVISORY_LOCK = 741091;

function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export type MigrationResult = {
  applied: string[];
  adopted: string[];
  drifted: string[];
};

export async function runMigrations(
  db: Database,
  log: MigrationLogger = { info: () => {}, warn: () => {} },
): Promise<MigrationResult> {
  const client = await db.connect();
  const result: MigrationResult = { applied: [], adopted: [], drifted: [] };
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK]);
    // Migrations must not be cancelled by the request-scoped statement timeout.
    await client.query("SET LOCAL statement_timeout = 0");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const recorded = new Map<string, string>(
      (await client.query("SELECT version, checksum FROM schema_migrations")).rows.map(
        (row: { version: string; checksum: string }) => [row.version, row.checksum],
      ),
    );

    // Adopt a database that was created by the legacy boot-time script: it already
    // has the baseline shape, and re-running it is a no-op but slow.
    //
    // The probe must be unqualified (so it honours search_path) and must cover more
    // than one table: a schema that merely happens to contain `conversations` — a
    // half-built database, or a different schema on the same server — would
    // otherwise be adopted and then fail later on a table 0001 would have created.
    if (recorded.size === 0) {
      const existing = await client.query(
        `SELECT to_regclass('conversations') IS NOT NULL
            AND to_regclass('agent_instances') IS NOT NULL
            AND to_regclass('run_events') IS NOT NULL AS legacy`,
      );
      if (existing.rows[0]?.legacy) {
        for (const migration of migrations) {
          if (migration.version !== "0001") break;
          await client.query(
            "INSERT INTO schema_migrations(version,name,checksum) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [migration.version, migration.name, checksum(migration.sql)],
          );
          recorded.set(migration.version, checksum(migration.sql));
          result.adopted.push(migration.version);
        }
        log.info({ adopted: result.adopted }, "schema_adopted");
      }
    }

    for (const migration of migrations) {
      const sum = checksum(migration.sql);
      const previous = recorded.get(migration.version);
      if (previous !== undefined) {
        if (previous !== sum) {
          // Append-only policy violation. Warn rather than refuse to boot: the
          // statements are idempotent, and an outage is worse than a stale record.
          result.drifted.push(migration.version);
          log.warn({ version: migration.version }, "schema_migration_checksum_drift");
        }
        continue;
      }
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations(version,name,checksum) VALUES($1,$2,$3)",
        [migration.version, migration.name, sum],
      );
      result.applied.push(migration.version);
      log.info({ version: migration.version, name: migration.name }, "schema_migration_applied");
    }

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
