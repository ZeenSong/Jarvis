// Called by start.sh deploy; secret values go to kubectl stdin, never argv or logs.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { loginOnly } from "../../apps/workers/codex-auth.mjs";
const context = process.env.M2_CONTEXT;
if (!context || !process.env.KUBECONFIG)
  throw Error("Explicit M2_CONTEXT and KUBECONFIG required");
const flags = ["--context", context, "--request-timeout=15s"];
async function token(name) {
  try {
    const { stdout } = await promisify(execFile)(
      "kubectl",
      [
        ...flags,
        "-n",
        "jarvis-workers",
        "get",
        "secret",
        name,
        "--ignore-not-found",
        "-o",
        "json",
      ],
      { timeout: 20000 },
    );
    return stdout.trim()
      ? JSON.parse(stdout).data.token
      : randomBytes(32).toString("base64");
  } catch {
    throw Error(
      "Cannot read existing " + name + "; refusing to rotate it blindly",
    );
  }
}
const core = await readFile(
  process.env.CORE_API_KEY_FILE ?? "deepseek_api.txt",
  "utf8",
);
const ops = await readFile(
  process.env.OPS_API_KEY_FILE ??
    process.env.CORE_API_KEY_FILE ??
    "deepseek_api.txt",
  "utf8",
);
if (!core.trim() || !ops.trim()) throw Error("DeepSeek key file is empty");
const auth = loginOnly(
  JSON.parse(
    await readFile(
      process.env.CODEX_AUTH_FILE ?? ".local/m2-login/auth.json",
      "utf8",
    ),
  ),
);
const controllerToken = await token("controller-access"),
  opsToken = await token("ops-access");
const b64 = (value) => Buffer.from(value).toString("base64");
const secret = (namespace, name, data) => ({
  apiVersion: "v1",
  kind: "Secret",
  type: "Opaque",
  metadata: { namespace, name },
  data,
});
const items = [
  secret("jarvis-workers", "controller-access", { token: controllerToken }),
  secret("jarvis-workers", "ops-access", {
    token: opsToken,
    "deepseek-api-key": b64(ops.trim()),
  }),
  secret("jarvis-workers", "codex-login", {
    "auth.json": b64(JSON.stringify(auth)),
  }),
  secret("jarvis", "jarvis-m2", {
    "controller-token": controllerToken,
    "ops-token": opsToken,
    "core-api-key": b64(core.trim()),
  }),
];
const child = spawn("kubectl", [...flags, "apply", "-f", "-"], {
  stdio: ["pipe", "inherit", "inherit"],
});
const done = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) =>
    code === 0 ? resolve() : reject(Error("Secret provisioning failed")),
  );
});
child.stdin.end(JSON.stringify({ apiVersion: "v1", kind: "List", items }));
await done;
