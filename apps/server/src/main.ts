import { RuntimeRegistry } from "../../../packages/agent-runtime/src/index.js";
import { readFile } from "node:fs/promises";
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
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({ host: config.HOST, port: config.PORT });
