import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { configSchema, priceSchema } from "./config.js";
const config = configSchema.parse(process.env);
const prices = priceSchema.parse(
  process.env.PRICES_FILE
    ? JSON.parse(await readFile(process.env.PRICES_FILE, "utf8"))
    : {},
);
const { app } = await buildApp({
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
