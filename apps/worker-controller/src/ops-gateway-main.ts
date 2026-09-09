import { buildOpsGateway } from "./ops-gateway.js";
const app = buildOpsGateway(
  process.env.GATEWAY_ORIGIN ?? "",
  process.env.OPS_TOKEN ?? "",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => void app.close());
await app.listen({ host: "0.0.0.0", port: 8092 });
