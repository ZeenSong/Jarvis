// Read-only production discovery and database backup. Never uses the default context.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, access } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
const context = process.env.M2_CONTEXT;
if (!context || ["minikube", "docker-desktop", "kind-kind"].includes(context))
  throw Error("M2_CONTEXT must explicitly identify the production K3s context");
if (!process.env.KUBECONFIG) throw Error("Explicit KUBECONFIG required");
await access(process.env.KUBECONFIG);
const flags = ["--context", context, "--request-timeout=15s"];
const kubectl = async (args) =>
  (
    await promisify(execFile)("kubectl", [...flags, ...args], {
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    })
  ).stdout;
const nodes = JSON.parse(await kubectl(["get", "nodes", "-o", "json"]));
if (
  !nodes.items.length ||
  !nodes.items.every((n) => n.status.nodeInfo.kubeletVersion.includes("k3s"))
)
  throw Error("Selected cluster is not verified K3s");
const deployment = JSON.parse(
  await kubectl([
    "-n",
    "jarvis",
    "get",
    "deployment",
    "jarvis-server",
    "-o",
    "json",
  ]),
);
const pods = JSON.parse(
  await kubectl([
    "-n",
    "jarvis",
    "get",
    "pods",
    "-l",
    "app=jarvis-server",
    "-o",
    "json",
  ]),
);
const containers = deployment.spec.template.spec.containers;
const output = resolve(
  process.env.M2_BACKUP_DIR ?? ".local/m2-backup-" + Date.now(),
);
await mkdir(output, { recursive: true, mode: 0o700 });
const state = {
  context,
  created_at: new Date().toISOString(),
  nodes: nodes.items.map((n) => ({
    name: n.metadata.name,
    version: n.status.nodeInfo.kubeletVersion,
  })),
  images: containers.map((c) => ({ name: c.name, image: c.image })),
  pods: pods.items.map((p) => ({
    name: p.metadata.name,
    node: p.spec.nodeName,
    source_ip: p.status.podIP,
    image_ids: p.status.containerStatuses?.map((c) => ({
      name: c.name,
      image_id: c.imageID,
    })),
  })),
};
await writeFile(
  resolve(output, "before.json"),
  JSON.stringify(state, null, 2) + "\n",
  { mode: 0o600 },
);
const child = spawn(
  "kubectl",
  [
    ...flags,
    "-n",
    "jarvis",
    "exec",
    "statefulset/postgres",
    "--",
    "sh",
    "-c",
    'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc',
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let stderr = "";
child.stderr.on("data", (b) => {
  stderr += b;
});
const exited = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) =>
    code === 0 ? resolve() : reject(Error("pg_dump failed: " + stderr)),
  );
});
await Promise.all([
  pipeline(
    child.stdout,
    createWriteStream(resolve(output, "postgres.dump"), {
      flags: "wx",
      mode: 0o600,
    }),
  ),
  exited,
]);
console.log(JSON.stringify({ backup_directory: output, ...state }));
console.log(
  "Backup created. Restore into an independent PostgreSQL instance and verify before deployment.",
);
