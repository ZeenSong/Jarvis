import assert from "node:assert/strict";
import test from "node:test";
import { AppError, isKnownErrorCode, statusForCode, toErrorResponse } from "../packages/core/src/index.js";
import { readPackageVersion } from "../packages/core/src/version.js";
import { LoginGuard, clientAddress, loginIdentity } from "../apps/server/src/security/login-guard.js";

test("error mapping: known contract codes keep their status", () => {
  assert.equal(statusForCode("not_found"), 404);
  assert.equal(statusForCode("invalid_credentials"), 401);
  assert.equal(statusForCode("id_reused_with_different_request"), 409);
  assert.equal(statusForCode("rate_limited"), 429);
  assert.equal(statusForCode("hermes_not_configured"), 503);
  assert.equal(statusForCode("integration_credentials_key_missing"), 503);
  assert.equal(statusForCode("hermes_run_http_500"), 502);
});

test("error mapping: legacy bare Error(code) throws keep their contract", () => {
  const legacy = toErrorResponse(new Error("conversation_busy"));
  assert.deepEqual(legacy, { status: 409, body: { error: "conversation_busy" } });
});

test("error mapping: unknown messages never leak", () => {
  const unknown = toErrorResponse(new Error("ECONNRESET at 10.0.0.4:5432 secret-detail"));
  assert.deepEqual(unknown, { status: 500, body: { error: "request_failed" } });
});

test("error mapping: an unregistered AppError code is not public", () => {
  const mapped = toErrorResponse(new AppError("some_new_internal_code"));
  assert.deepEqual(mapped, { status: 500, body: { error: "request_failed" } });
  assert.equal(isKnownErrorCode("some_new_internal_code"), false);
});

test("error mapping: registered AppError keeps code and detail", () => {
  const mapped = toErrorResponse(new AppError("schedule_time_required", { detail: { retry: false } }));
  assert.deepEqual(mapped, { status: 400, body: { error: "schedule_time_required", detail: { retry: false } } });
});

test("error mapping: validation errors expose issues", () => {
  const zodLike = Object.assign(new Error("bad"), { name: "ZodError", issues: [{ path: ["username"], code: "too_small" }] });
  const mapped = toErrorResponse(zodLike);
  assert.equal(mapped.status, 400);
  assert.equal(mapped.body.error, "validation_error");
  assert.deepEqual(mapped.body.issues, [{ path: ["username"], code: "too_small" }]);
});

test("error mapping: body limit maps to 413", () => {
  const error = Object.assign(new Error("too large"), { statusCode: 413 });
  assert.deepEqual(toErrorResponse(error), { status: 413, body: { error: "payload_too_large" } });
});

test("login guard: blocks after the configured failures and recovers", () => {
  const guard = new LoginGuard({ failuresPerIdentity: 3, baseCooldownMs: 1000, maxCooldownMs: 4000 });
  const identity = loginIdentity("Joshua", "10.0.0.1");
  const address = "10.0.0.1";
  const now = 1_000_000;

  assert.equal(guard.retryAfter(identity, address, now), 0);
  guard.recordFailure(identity, address, now);
  guard.recordFailure(identity, address, now + 1);
  assert.equal(guard.retryAfter(identity, address, now + 2), 0, "still under the limit");
  guard.recordFailure(identity, address, now + 2);
  assert.ok(guard.retryAfter(identity, address, now + 3) > 0, "blocked at the limit");
  assert.equal(guard.retryAfter(identity, address, now + 5000), 0, "cool-down expires");
});

test("login guard: identity buckets are case-insensitive", () => {
  assert.equal(loginIdentity("Joshua", "1.1.1.1"), loginIdentity("joshua", "1.1.1.1"));
  assert.notEqual(loginIdentity("joshua", "1.1.1.1"), loginIdentity("joshua", "2.2.2.2"));
});

test("login guard: success clears only the identity bucket", () => {
  const guard = new LoginGuard({ failuresPerIdentity: 2, failuresPerAddress: 100, baseCooldownMs: 60_000 });
  const address = "10.0.0.9";
  const identity = loginIdentity("alice", address);
  guard.recordFailure(identity, address, 1000);
  guard.recordFailure(identity, address, 1001);
  assert.ok(guard.retryAfter(identity, address, 1002) > 0);
  guard.recordSuccess(identity);
  assert.equal(guard.retryAfter(identity, address, 2001), 0);
});

test("login guard: address-level limit applies across usernames", () => {
  const guard = new LoginGuard({ failuresPerIdentity: 100, failuresPerAddress: 3, baseCooldownMs: 60_000 });
  const address = "10.0.0.10";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    guard.recordFailure(loginIdentity(`user${attempt}`, address), address, 1000 + attempt);
  }
  assert.ok(guard.retryAfter(loginIdentity("brand-new", address), address, 1010) > 0);
});

test("login guard: cool-down is exponential and capped", () => {
  const guard = new LoginGuard({ failuresPerIdentity: 1, failuresPerAddress: 1000, baseCooldownMs: 1000, maxCooldownMs: 4000 });
  const address = "10.0.0.11";
  const identity = loginIdentity("bob", address);
  const now = 5_000;
  guard.recordFailure(identity, address, now);
  const first = guard.retryAfter(identity, address, now + 1);
  guard.recordFailure(identity, address, now + 1);
  const second = guard.retryAfter(identity, address, now + 2);
  for (let attempt = 0; attempt < 8; attempt += 1) guard.recordFailure(identity, address, now + 3 + attempt);
  const capped = guard.retryAfter(identity, address, now + 20);
  assert.ok(second > first, "second failure waits longer");
  assert.ok(capped <= 4000, "cool-down respects the cap");
});

test("client address honours X-Forwarded-For only when trusted", () => {
  const headers = { "x-forwarded-for": "203.0.113.7, 10.0.0.2" };
  assert.equal(clientAddress(headers, "127.0.0.1", true), "203.0.113.7");
  assert.equal(clientAddress(headers, "127.0.0.1", false), "127.0.0.1");
  assert.equal(clientAddress({}, undefined, true), "unknown");
});

test("product version comes from package.json", () => {
  const version = readPackageVersion(import.meta.url);
  assert.match(version, /^\d+\.\d+\.\d+/);
  assert.notEqual(version, "0.3.2", "the hardcoded stale version must be gone");
});

test("error mapping: guidance after the code reaches the caller intact", () => {
  const mapped = toErrorResponse(
    new Error("schedule_time_required: 请先确认执行时间与时区，再提供未来的 ISO 8601 时间；任务尚未创建。"),
  );
  assert.equal(mapped.status, 400);
  assert.equal(mapped.body.error, "schedule_time_required");
  assert.match(mapped.body.message ?? "", /请先确认执行时间/);
});

test("error mapping: an unknown prefix keeps the message opaque", () => {
  const mapped = toErrorResponse(new Error("some_internal_detail: secret-ish context"));
  assert.deepEqual(mapped, { status: 500, body: { error: "request_failed" } });
});
