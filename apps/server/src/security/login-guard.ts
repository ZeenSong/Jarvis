/**
 * Login brute-force protection.
 *
 * Before this module the login endpoint accepted unlimited attempts, which made
 * password spraying and CPU-exhaustion (argon2 is deliberately expensive) both
 * free. The guard is intentionally small and dependency-free:
 *
 * - Counted per (client address, lowercase username) and per address.
 * - A fixed window of failures triggers an exponential cool-down, capped at 15
 *   minutes, so a noisy attacker cannot permanently lock a legitimate user out
 *   by spamming a username they do not own.
 * - State is process-local. That matches the current single-writer deployment;
 *   when the execution model moves to DB leases (plan P2) this moves to Postgres
 *   or a shared cache behind the same interface.
 */

export type LoginGuardLimits = {
  /** Failures allowed for one (address, username) pair inside the window. */
  failuresPerIdentity: number;
  /** Failures allowed from one address regardless of username. */
  failuresPerAddress: number;
  /** Window in which failures are counted. */
  windowMs: number;
  /** Base cool-down applied once a limit is exceeded. */
  baseCooldownMs: number;
  /** Upper bound for the exponential cool-down. */
  maxCooldownMs: number;
};

const DEFAULTS: LoginGuardLimits = {
  failuresPerIdentity: 5,
  failuresPerAddress: 25,
  windowMs: 15 * 60_000,
  baseCooldownMs: 30_000,
  maxCooldownMs: 15 * 60_000,
};

type Bucket = { failures: number[]; blockedUntil: number };

export class LoginGuard {
  private readonly byIdentity = new Map<string, Bucket>();
  private readonly byAddress = new Map<string, Bucket>();
  private readonly limits: LoginGuardLimits;
  private lastSweep = 0;

  constructor(limits: Partial<LoginGuardLimits> = {}) {
    this.limits = { ...DEFAULTS, ...limits };
  }

  /** Returns 0 when the attempt may proceed, otherwise the wait in milliseconds. */
  retryAfter(identity: string, address: string, now = Date.now()): number {
    this.sweep(now);
    const waitIdentity = this.waitFor(this.byIdentity.get(identity), now);
    const waitAddress = this.waitFor(this.byAddress.get(address), now);
    return Math.max(waitIdentity, waitAddress);
  }

  recordFailure(identity: string, address: string, now = Date.now()): void {
    this.record(this.byIdentity, identity, this.limits.failuresPerIdentity, now);
    this.record(this.byAddress, address, this.limits.failuresPerAddress, now);
  }

  /**
   * A successful login clears the identity bucket only. The address bucket is
   * intentionally left intact so a single valid account cannot be used to
   * launder an address-level spraying attempt.
   */
  recordSuccess(identity: string): void {
    this.byIdentity.delete(identity);
  }

  private record(map: Map<string, Bucket>, key: string, limit: number, now: number) {
    const bucket = map.get(key) ?? { failures: [], blockedUntil: 0 };
    bucket.failures = bucket.failures.filter((at) => now - at < this.limits.windowMs);
    bucket.failures.push(now);
    // `limit` failures are tolerated; the attempt that reaches the limit is the
    // last one, and every subsequent attempt waits out an exponential cool-down.
    if (bucket.failures.length >= limit) {
      const over = bucket.failures.length - limit;
      const cooldown = Math.min(this.limits.maxCooldownMs, this.limits.baseCooldownMs * 2 ** over);
      bucket.blockedUntil = Math.max(bucket.blockedUntil, now + cooldown);
    }
    map.set(key, bucket);
  }

  private waitFor(bucket: Bucket | undefined, now: number): number {
    if (!bucket) return 0;
    if (bucket.blockedUntil > now) return bucket.blockedUntil - now;
    return 0;
  }

  /** Drop buckets that can no longer influence a decision. */
  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.byIdentity) {
      const stale = bucket.blockedUntil <= now && bucket.failures.every((at) => now - at >= this.limits.windowMs);
      if (stale) this.byIdentity.delete(key);
    }
    for (const [key, bucket] of this.byAddress) {
      const stale = bucket.blockedUntil <= now && bucket.failures.every((at) => now - at >= this.limits.windowMs);
      if (stale) this.byAddress.delete(key);
    }
  }

  /** Test/diagnostic helper. */
  size() {
    return { identities: this.byIdentity.size, addresses: this.byAddress.size };
  }
}

/** Normalize the client key so `Joshua` and `joshua` share one bucket. */
export function loginIdentity(username: string, address: string): string {
  return `${address}|${username.trim().toLowerCase()}`;
}

/**
 * Derive a stable client address. Trusts `X-Forwarded-For` only when the caller
 * asks for it, because an untrusted header would let an attacker rotate the key.
 */
export function clientAddress(headers: Record<string, unknown>, socketAddress: string | undefined, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = headers["x-forwarded-for"];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof value === "string" && value.trim()) return value.split(",")[0]!.trim();
  }
  return socketAddress ?? "unknown";
}
