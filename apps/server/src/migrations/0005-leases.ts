/**
 * Cooperative leases.
 *
 * Schedulers and recovery used to rely on "only one process exists". The
 * single-writer advisory lock makes that assumption safe today, but it also makes
 * the service impossible to scale. A lease row per job kind is the primitive the
 * execution model will move onto: a worker owns a row until its heartbeat expires,
 * and recovery takes over expired rows instead of assuming it is the only writer.
 */
export const sql = `
CREATE TABLE IF NOT EXISTS leases (
  kind TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  attempt INTEGER NOT NULL DEFAULT 0,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS leases_expiry ON leases(expires_at);
`;
