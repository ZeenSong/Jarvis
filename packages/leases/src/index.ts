import type { Database } from "../../../apps/server/src/persistence.js";

/**
 * Cooperative, database-backed leases.
 *
 * The contract is deliberately small: a lease is a named job slot that exactly one
 * owner may hold. The holder must renew before `expiresAt`; anyone may take over an
 * expired lease. Recovery therefore becomes "sweep expired leases" instead of
 * "assume I am the only writer".
 */
export type Lease = {
  kind: string;
  owner: string;
  payload: Record<string, unknown>;
  attempt: number;
  acquired_at: string;
  heartbeat_at: string;
  expires_at: string;
};

export type AcquireResult =
  | { acquired: true; lease: Lease }
  | { acquired: false; holder: { owner: string; expires_at: string } };

export class LeaseStore {
  constructor(
    private readonly db: Database,
    /** Injectable clock so tests can advance time without sleeping. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Try to take `kind`. Succeeds when the lease is free, already ours (so a
   * restarted worker can resume its own slot), or expired.
   */
  async acquire(kind: string, owner: string, ttlSeconds = 60, payload: Record<string, unknown> = {}): Promise<AcquireResult> {
    const ttl = Math.max(5, Math.min(3600, Math.round(ttlSeconds)));
    const row = (
      await this.db.query(
        `INSERT INTO leases(kind, owner, payload, attempt, acquired_at, heartbeat_at, expires_at)
         VALUES($1,$2,$3,1,$4::timestamptz,$4::timestamptz,$4::timestamptz + make_interval(secs => $5))
         ON CONFLICT (kind) DO UPDATE
           SET owner = EXCLUDED.owner,
               payload = EXCLUDED.payload,
               attempt = CASE WHEN leases.owner = EXCLUDED.owner THEN leases.attempt ELSE leases.attempt + 1 END,
               acquired_at = CASE WHEN leases.owner = EXCLUDED.owner THEN leases.acquired_at ELSE EXCLUDED.acquired_at END,
               heartbeat_at = EXCLUDED.heartbeat_at,
               expires_at = EXCLUDED.expires_at
           WHERE leases.expires_at <= EXCLUDED.heartbeat_at OR leases.owner = EXCLUDED.owner
         RETURNING *`,
        [kind, owner, JSON.stringify(payload), this.now(), ttl],
      )
    ).rows[0];
    if (row) return { acquired: true, lease: row as Lease };
    const holder = (await this.db.query("SELECT owner, expires_at FROM leases WHERE kind=$1", [kind])).rows[0];
    return {
      acquired: false,
      holder: { owner: holder?.owner ?? "unknown", expires_at: new Date(holder?.expires_at ?? 0).toISOString() },
    };
  }

  /** Extend a lease we still hold. Returns false when the lease was taken over. */
  async renew(kind: string, owner: string, ttlSeconds = 60): Promise<boolean> {
    const ttl = Math.max(5, Math.min(3600, Math.round(ttlSeconds)));
    return (
      (
        await this.db.query(
          "UPDATE leases SET heartbeat_at=$3::timestamptz, expires_at=$3::timestamptz + make_interval(secs => $4) WHERE kind=$1 AND owner=$2 AND expires_at > $3::timestamptz",
          [kind, owner, this.now(), ttl],
        )
      ).rowCount === 1
    );
  }

  /** Give the slot back so another worker can start immediately. */
  async release(kind: string, owner: string): Promise<boolean> {
    return (await this.db.query("DELETE FROM leases WHERE kind=$1 AND owner=$2", [kind, owner])).rowCount === 1;
  }

  /** Expired leases, oldest first. Used by the recovery sweep. */
  async expired(kind?: string, limit = 50): Promise<Lease[]> {
    return (
      await this.db.query(
        `SELECT * FROM leases WHERE expires_at <= $1 ${kind ? "AND kind=$2" : ""} ORDER BY expires_at LIMIT $${kind ? 3 : 2}`,
        kind ? [this.now(), kind, limit] : [this.now(), limit],
      )
    ).rows as Lease[];
  }

  async get(kind: string): Promise<Lease | undefined> {
    return (await this.db.query("SELECT * FROM leases WHERE kind=$1", [kind])).rows[0] as Lease | undefined;
  }
}
