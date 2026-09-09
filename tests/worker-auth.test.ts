import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { loginOnly, persistLogin } = await import(
  new URL("../apps/workers/codex-auth.mjs", import.meta.url).href
);
test("isolated login retains refreshed tokens without API keys or personal config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-auth-test-"));
  try {
    const source = join(dir, "source.json"),
      target = join(dir, "auth.json");
    const tokens = {
      id_token: "fake-id",
      access_token: "fake-access",
      refresh_token: "fake-refresh",
      account_id: "fake-account",
    };
    await writeFile(
      source,
      JSON.stringify({
        tokens,
        last_refresh: "2026-09-08T00:00:00Z",
        OPENAI_API_KEY: "must-not-copy",
        config: "must-not-copy",
      }),
    );
    await persistLogin(source, target);
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), {
      tokens,
      last_refresh: "2026-09-08T00:00:00Z",
    });
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    tokens.refresh_token = "fake-refreshed";
    await writeFile(source, JSON.stringify({ tokens }));
    await persistLogin(source, target);
    assert.equal(
      JSON.parse(await readFile(target, "utf8")).tokens.refresh_token,
      "fake-refreshed",
    );
    assert.throws(
      () => loginOnly({ OPENAI_API_KEY: "fake" }),
      /codex_login_unavailable/,
    );
    await writeFile(source, "invalid");
    await assert.rejects(persistLogin(source, target));
    assert.equal(
      JSON.parse(await readFile(target, "utf8")).tokens.refresh_token,
      "fake-refreshed",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
