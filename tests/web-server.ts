import { buildApp } from "../apps/server/src/app.js";
import { createPairingCode } from "../apps/server/src/auth.js";
import { controlledRegistry, seedControlRuns } from "./controlled-runtime.js";
const ctx = await buildApp({
  databaseUrl: process.env.TEST_DATABASE_URL!,
  runtimes: controlledRegistry(),
});
await ctx.app.listen({ host: "127.0.0.1", port: 0 });
process.send?.({
  base: `http://127.0.0.1:${(ctx.app.server.address() as any).port}`,
  codes: [await createPairingCode(ctx.db), await createPairingCode(ctx.db)],
  runs: await seedControlRuns(ctx),
});
process.on("message", () => void ctx.app.close().then(() => process.exit(0)));
process.on("SIGTERM", () => void ctx.app.close().then(() => process.exit(0)));
