// Generates reviewable manifests without accessing a cluster or writing secrets.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { isIPv4 } from "node:net";
import { resolve } from "node:path";
const required = (name) => {
  const value = process.env[name];
  if (!value) throw Error(name + " required");
  return value;
};
const ip = required("GATEWAY_IP"),
  sourceIp = required("GATEWAY_SOURCE_IP");
if (!isIPv4(ip) || !isIPv4(sourceIp))
  throw Error(
    "Gateway listener and node source must be explicit IPv4 addresses",
  );
const repository = required("CODING_REPOSITORY"),
  commit = required("CODING_COMMIT");
const url = new URL(repository);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  !/^[a-f0-9]{40}$/.test(commit)
)
  throw Error("HTTPS repository and pinned commit required");
const core = required("CORE_MODEL"),
  ops = required("OPS_MODEL"),
  coding = required("CODING_MODEL");
for (const value of [core, ops, coding])
  if (!/^[a-zA-Z0-9._:/-]{1,100}$/.test(value))
    throw Error("Invalid model name");
const output = resolve(process.env.M2_RENDER_DIR ?? ".local/m2-deploy");
await mkdir(output, { recursive: true, mode: 0o700 });
for (const file of [
  "workers.yaml",
  "proxy.yaml",
  "codex-auth.yaml",
  "ops-gateway.yaml",
  "server-patch.yaml",
]) {
  let content = await readFile(new URL(file, import.meta.url), "utf8");
  content = content
    .replaceAll("__GATEWAY_IP__", ip)
    .replaceAll("__GATEWAY_SOURCE_IP__", sourceIp);
  for (const [original, name] of [
    ["jarvis-server:0.2.0-rc.1", "SERVER_IMAGE"],
    ["jarvis-codex-worker:0.2.0-rc.1", "CODEX_WORKER_IMAGE"],
    ["jarvis-ops-worker:0.2.0-rc.1", "OPS_WORKER_IMAGE"],
    ["jarvis-egress-proxy:0.2.0-rc.1", "PROXY_IMAGE"],
  ]) {
    const image = process.env[name];
    if (image) {
      if (!/^[a-zA-Z0-9._/:@-]+$/.test(image)) throw Error("Invalid image");
      content = content.replaceAll(original, image);
    }
  }
  if (file === "proxy.yaml" && process.env.UPSTREAM_PROXY) {
    const parent = new URL(process.env.UPSTREAM_PROXY);
    if (
      parent.protocol !== "http:" ||
      !isIPv4(parent.hostname) ||
      !parent.port ||
      parent.username ||
      parent.password
    )
      throw Error(
        "Upstream proxy must be an explicit HTTP IPv4 address and port without credentials",
      );
    content = content.replace(
      "    http_access deny all",
      "    http_access deny all\n    cache_peer " +
        parent.hostname +
        " parent " +
        parent.port +
        " 0 no-query default\n    never_direct allow all",
    );
  }
  await writeFile(resolve(output, file), content);
}
const maps = [
  {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "worker-config", namespace: "jarvis-workers" },
    data: {
      repository,
      "ops-model": ops,
      "gateway-origin": `http://${ip}:8080`,
    },
  },
  {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "jarvis-m2", namespace: "jarvis" },
    data: { repository, commit, "core-model": core, "coding-model": coding },
  },
];
await writeFile(
  resolve(output, "configmaps.json"),
  JSON.stringify({ apiVersion: "v1", kind: "List", items: maps }, null, 2) +
    "\n",
);
console.log(
  "Rendered M2 manifests to " + output + "; no cluster changes made.",
);
