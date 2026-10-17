import { RuntimeRegistry } from "../../../packages/agent-runtime/src/index.js";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { buildApp } from "./app.js";
import { configSchema, priceSchema } from "./config.js";
import { hermesAgentConfig, HermesClient } from "../../../packages/hermes-bridge/src/index.js";
import { HermesRuntime } from "../../../packages/hermes-runtime/src/index.js";
const config = configSchema.parse(process.env);
const prices = priceSchema.parse(
  process.env.PRICES_FILE
    ? JSON.parse(await readFile(process.env.PRICES_FILE, "utf8"))
    : {},
);
const runtimes = new RuntimeRegistry();
// Codex is a Node Bridge capability, not a Server Agent runtime. Pydantic and
// the legacy worker-controller runtimes are deliberately absent here.
const hermesConfig = hermesAgentConfig();
if (process.env.HERMES_ENABLED === "1" && hermesConfig)
  runtimes.register("hermes", new HermesRuntime(new HermesClient(hermesConfig.url, hermesConfig.apiKey)));
/**
 * Single-writer guard.
 *
 * Jarvis keeps websocket subscriptions, in-flight conversation workers and OIDC
 * handshake state in process memory, and its recovery routine assumes it is the
 * only writer. A second replica used to start silently and then duplicate work or
 * fail unrelated runs. Until the execution model moves to database leases, a
 * second instance must be refused loudly instead of corrupting state.
 *
 * The lock is session-scoped: it is released automatically if this process dies.
 */
const guardClient = new pg.Client({ connectionString: config.DATABASE_URL });
let holdsSingleWriterLock = false;
try {
  await guardClient.connect();
  const acquired = (await guardClient.query("SELECT pg_try_advisory_lock(741093) AS ok")).rows[0]?.ok === true;
  if (!acquired) {
    console.error(
      "[jarvis] another Jarvis server already holds the single-writer lock. " +
        "Refusing to start a second instance; scale-out requires the database lease model.",
    );
    process.exit(1);
  }
  holdsSingleWriterLock = true;
} catch (error) {
  console.error("[jarvis] failed to acquire the single-writer lock", error);
  process.exit(1);
}

const { app } = await buildApp({
  runtimes,
  databaseUrl: config.DATABASE_URL,
  logger: true,
  prices,
  hostRoot: config.HOST_ROOT,
  networkInterface: config.NETWORK_INTERFACE,
  degradedSeconds: config.AGENT_DEGRADED_SECONDS,
  offlineSeconds: config.AGENT_OFFLINE_SECONDS,
  retentionDays: config.EVENT_RETENTION_DAYS,
});
async function shutdown() {
  await app.close();
  if (holdsSingleWriterLock) await guardClient.end().catch(() => {});
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void shutdown());
await app.listen({ host: config.HOST, port: config.PORT });
