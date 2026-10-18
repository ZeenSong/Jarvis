import assert from "node:assert/strict";
import test from "node:test";
import { database, migrate } from "../apps/server/src/persistence.js";
import { LeaseStore } from "../packages/leases/src/index.js";

const url = process.env.TEST_DATABASE_URL;

test("leases: exclusive ownership, renewal and takeover after expiry", async (t) => {
  if (!url) return t.skip("TEST_DATABASE_URL is not configured");
  const db = database(url);
  await migrate(db);
  await db.query("DELETE FROM leases WHERE kind LIKE 'test:%'");
  try {
    let clock = new Date("2026-10-17T10:00:00.000Z");
    const store = new LeaseStore(db, () => clock);
    const kind = "test:sweep";

    const a = await store.acquire(kind, "worker-a", 60, { phase: 1 });
    assert.equal(a.acquired, true);
    assert.equal(a.lease.owner, "worker-a");
    assert.equal(a.lease.attempt, 1);

    const b = await store.acquire(kind, "worker-b", 60);
    assert.equal(b.acquired, false);
    if (!b.acquired) assert.equal(b.holder.owner, "worker-a");

    assert.equal(await store.renew(kind, "worker-b"), false, "a non-owner cannot renew");
    clock = new Date("2026-10-17T10:00:30.000Z");
    assert.equal(await store.renew(kind, "worker-a"), true);

    // Expire it: 30s heartbeat + 60s ttl, so 91s after acquisition it is stale.
    clock = new Date("2026-10-17T10:01:31.000Z");
    const expired = await store.expired(kind);
    assert.equal(expired.length, 1);
    assert.equal(expired[0]!.owner, "worker-a");

    const takeover = await store.acquire(kind, "worker-b", 60);
    assert.equal(takeover.acquired, true);
    assert.equal(takeover.lease.attempt, 2, "takeover increments the attempt counter");

    assert.equal(await store.release(kind, "worker-b"), true);
    const reacquired = await store.acquire(kind, "worker-a", 60);
    assert.equal(reacquired.acquired, true);
    assert.equal(reacquired.lease.attempt, 1, "a clean release resets the attempt counter; only takeovers accumulate");
  } finally {
    await db.query("DELETE FROM leases WHERE kind LIKE 'test:%'");
    await db.end();
  }
});

test("leases: ttl is clamped to a sane range", async (t) => {
  if (!url) return t.skip("TEST_DATABASE_URL is not configured");
  const db = database(url);
  await migrate(db);
  const store = new LeaseStore(db);
  try {
    const acquired = await store.acquire("test:clamp", "worker-a", 99_999);
    assert.equal(acquired.acquired, true);
    const seconds = (Date.parse(acquired.lease.expires_at) - Date.now()) / 1000;
    assert.ok(seconds <= 3601 && seconds > 3590, `ttl clamped, got ${seconds}`);
  } finally {
    await db.query("DELETE FROM leases WHERE kind LIKE 'test:%'");
    await db.end();
  }
});
