import pg from "pg";
import { runMigrations, type MigrationLogger } from "./migrations/index.js";
export function database(url: string) {
  return new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    max: 10,
  });
}
export type Database = ReturnType<typeof database>;
export async function migrate(db: Database, log?: MigrationLogger) {
  return runMigrations(db, log ?? { info: () => {}, warn: () => {} });
}
