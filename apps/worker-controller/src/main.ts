import { readFile } from "node:fs/promises";
import https from "node:https";
import { buildController } from "./controller.js";
const root = "/var/run/secrets/kubernetes.io/serviceaccount";
const [token, ca] = await Promise.all([
  readFile(root + "/token", "utf8"),
  readFile(root + "/ca.crt"),
]);
async function kube(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: process.env.KUBERNETES_SERVICE_HOST,
        port: Number(process.env.KUBERNETES_SERVICE_PORT ?? 443),
        path,
        method,
        ca,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
          if (data.length > 32 * 1024 * 1024)
            req.destroy(Error("worker_output_limit"));
        });
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(Error("kubernetes_http_" + res.statusCode));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(Error("kubernetes_timeout")));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
const app = buildController(kube);
await app.listen({ host: "0.0.0.0", port: 8090 });
