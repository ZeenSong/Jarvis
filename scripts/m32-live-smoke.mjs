#!/usr/bin/env node

/**
 * Read-only M3.2 deployment smoke checks.
 *
 * This intentionally does not create users, conversations, schedules, or
 * provider data. Missing credentials are reported as SKIP so the command can
 * run safely in development and in CI without pretending that live auth was
 * verified.
 */

const timeout = 5000;
const checks = [];

async function probe(name, url, init = {}) {
  try {
    const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeout) });
    checks.push({ name, result: response.ok ? "PASS" : `FAIL (${response.status})` });
  } catch (error) {
    checks.push({ name, result: `FAIL (${error instanceof Error ? error.message : "request_error"})` });
  }
}

const homeAssistant = process.env.HOME_ASSISTANT_URL && process.env.HOME_ASSISTANT_TOKEN;
if (homeAssistant) await probe("Home Assistant state read", `${process.env.HOME_ASSISTANT_URL.replace(/\/$/, "")}/api/states`, { headers: { Authorization: `Bearer ${process.env.HOME_ASSISTANT_TOKEN}` } });
else checks.push({ name: "Home Assistant state read", result: "SKIP (HOME_ASSISTANT_URL/TOKEN missing)" });

if (process.env.FRIGATE_URL) {
  const headers = process.env.FRIGATE_TOKEN ? { Authorization: `Bearer ${process.env.FRIGATE_TOKEN}` } : process.env.FRIGATE_USERNAME && process.env.FRIGATE_PASSWORD ? { Authorization: `Basic ${Buffer.from(`${process.env.FRIGATE_USERNAME}:${process.env.FRIGATE_PASSWORD}`).toString("base64")}` } : {};
  await probe("Frigate events read", `${process.env.FRIGATE_URL.replace(/\/$/, "")}/api/events?limit=1`, { headers });
}
else checks.push({ name: "Frigate events read", result: "SKIP (FRIGATE_URL missing)" });

const immich = process.env.IMMICH_URL && process.env.IMMICH_API_KEY;
if (immich) await probe("Immich server read", `${process.env.IMMICH_URL.replace(/\/$/, "")}/api/server/version`, { headers: { "x-api-key": process.env.IMMICH_API_KEY } });
else checks.push({ name: "Immich server read", result: "SKIP (IMMICH_URL/API_KEY missing)" });

if (process.env.JARVIS_BASE_URL) {
  try {
    const base = process.env.JARVIS_BASE_URL.replace(/\/$/, "");
    const status = await fetch(`${base}/api/v2/auth/oidc/status`, { signal: AbortSignal.timeout(timeout) });
    const configured = status.ok && (await status.json()).configured === true;
    checks.push({ name: "Jarvis Authentik configuration", result: configured ? "PASS" : "FAIL (OIDC not configured)" });
    if (configured) {
      const start = await fetch(`${base}/api/v2/auth/oidc/start`, { redirect: "manual", signal: AbortSignal.timeout(timeout) });
      checks.push({ name: "Jarvis Authentik authorization redirect", result: start.status === 302 && start.headers.has("location") ? "PASS" : `FAIL (${start.status})` });
    }
  } catch { checks.push({ name: "Jarvis Authentik configuration", result: "FAIL (unreachable)" }); }
}
else checks.push({ name: "Jarvis Authentik status", result: "SKIP (JARVIS_BASE_URL missing)" });

if (process.env.HERMES_URL && process.env.HERMES_API_KEY) await probe("Hermes health", `${process.env.HERMES_URL.replace(/\/$/, "")}/health`, { headers: { Authorization: `Bearer ${process.env.HERMES_API_KEY}` } });
else checks.push({ name: "Hermes health", result: "SKIP (HERMES_URL/API_KEY missing)" });

for (const check of checks) console.log(`${check.result.padEnd(42)} ${check.name}`);
if (checks.some((check) => check.result.startsWith("FAIL"))) process.exitCode = 1;
