// Native CasaOS bootstrap. Does not use Docker as a route to host privilege.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareDependencies, installDependencies } from "./casaos-dependencies.mjs";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, ".local/m3-casaos");
const installerURL = "https://get.casaos.io/v0.4.15";
const installerSHA = "9490aff2a035074e3d65802b019ccfa5230cb55be086cf5ef994c862cbcd8998";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const exists = async (path) => access(path).then(() => true, () => false);
async function command(name, args) {
  return (await run(name, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
}

export function adaptInstaller(source, withoutApt = false) {
  if (digest(source) !== installerSHA) throw Error("Upstream installer checksum changed; review required");
  let result = source;
  // Docker 26 already supports API 1.24. Preserve existing override.conf and running workloads.
  const replacements = [
    ["\nApply_Docker_API_Override\n", "\n# Jarvis: retain Docker configuration and running daemon.\n"],
    ["TMP_ROOT=/tmp/casaos-installer", 'TMP_ROOT=$(mktemp -d /tmp/jarvis-casaos.XXXXXXXX)'],
  ];
  if (withoutApt) replacements.push([
    "\nUpdate_Package_Resource\nInstall_Depends\nCheck_Dependency_Installation\n",
    "\n# Jarvis: dependencies installed from verified deb bundle; do not run APT.\nCheck_Dependency_Installation\n",
  ]);
  for (const [from, to] of replacements) {
    if (result.split(from).length !== 2) throw Error("Installer adaptation anchor changed");
    result = result.replace(from, to);
  }
  return result;
}

async function preflight(withoutApt = false) {
  const os = await readFile("/etc/os-release", "utf8");
  const docker = JSON.parse(await command("docker", ["version", "--format", "{{json .Server}}"]));
  const containers = (await command("docker", ["ps", "-a", "--no-trunc", "--format", "{{json .}}"])).split("\n").filter(Boolean).map(JSON.parse);
  // APT simulation works without root and must not propose repairing unrelated packages.
  const aptSimulation = await command("env", ["LC_ALL=C", "apt-get", "-s", "--fix-broken", "install"]);
  const aptChanges = aptSimulation.split("\n").filter((line) => /^(Inst|Remv|Conf) /.test(line));
  const checks = {
    platform: process.platform === "linux" && process.arch === "x64",
    ubuntu20: /^ID=ubuntu$/m.test(os) && /^VERSION_ID="20.04"$/m.test(os),
    docker26: /^26\./.test(docker.Version) && docker.MinAPIVersion === "1.24",
    freshCasaOS: !(await exists("/etc/casaos")) && !(await exists("/var/lib/casaos")),
    noExistingRclone: !(await command("bash", ["-c", "command -v rclone || true"])),
    systemd: await exists("/run/systemd/system"),
    aptHealthy: aptChanges.length === 0,
  };
  const report = {
    at: new Date().toISOString(), checks,
    ready: Object.entries(checks).every(([name, passed]) => passed || (withoutApt && name === "aptHealthy")),
    docker: { version: docker.Version, min_api: docker.MinAPIVersion },
    aptRepairProposals: aptChanges,
    dependencyMode: withoutApt ? "verified-deb-bundle" : "apt",
    containers: containers.map((c) => ({ id: c.ID, name: c.Names, image: c.Image, state: c.State, status: c.Status, ports: c.Ports })),
    listeners: await command("ss", ["-ltn"]),
    disk: await command("df", ["-h", "/"]),
    memory: await command("free", ["-m"]),
  };
  return report;
}

async function prepare(withoutApt = false) {
  const report = await preflight(withoutApt);
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(resolve(output, "preflight.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ checks: report.checks, report: resolve(output, "preflight.json") }, null, 2));
  requireReady(report);
  const response = await fetch(installerURL, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Installer download: HTTP ${response.status}`);
  const original = await response.text();
  const installer = adaptInstaller(original, withoutApt);
  if (withoutApt) await prepareDependencies(output);
  await writeFile(resolve(output, "upstream.sh"), original, { mode: 0o600 });
  await writeFile(resolve(output, "install-reviewed.sh"), installer, { mode: 0o600 });
  await writeFile(resolve(output, "installer-lock.json"), JSON.stringify({
    url: installerURL, sha256: installerSHA, adapted_sha256: digest(installer), without_apt: withoutApt,
    changes: ["Skip Docker override and daemon restart", "Use unique temporary extraction directory"],
    caveat: "Component URLs are versioned; archive digests are not yet locked. This is bootstrap, not final reproducible M3 release.",
  }, null, 2) + "\n", { mode: 0o600 });
  console.log("Prepared only. Review deploy/m3/README.md before the native install.");
}

function requireReady(report) {
  if (report.ready) return;
  const failed = Object.entries(report.checks).filter(([, passed]) => !passed).map(([name]) => name);
  const details = failed.includes("aptHealthy")
    ? `\nAPT has unresolved dependencies; proposed repairs:\n${report.aptRepairProposals.join("\n")}\nUse prepare --without-apt then install --without-apt for the verified dependency bundle. No automatic repair was performed.`
    : "";
  throw Error(`Host preflight failed: ${failed.join(", ")}. No installation attempted.${details}`);
}

async function install(withoutApt = false) {
  if (process.getuid?.() !== 0) throw Error("Native installation requires sudo in your terminal; no changes made");
  const report = await preflight(withoutApt);
  requireReady(report);
  const original = await readFile(resolve(output, "upstream.sh"), "utf8");
  const expected = adaptInstaller(original, withoutApt);
  const prepared = await readFile(resolve(output, "install-reviewed.sh"), "utf8");
  if (prepared !== expected) throw Error("Prepared installer differs from reviewed adaptation");
  // Root-owned copy avoids executing a mutable user-owned file after validation.
  const backup = await mkdtemp("/var/tmp/jarvis-before-casaos-");
  await writeFile(resolve(backup, "preflight.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  const targets = ["/etc/docker", "/etc/systemd/system/docker.service.d", "/etc/samba", "/etc/udevil", "/etc/conf.d/devmon", "/etc/fstab", "/etc/udev/rules.d/11-usb-mount.rules", "/etc/systemd/system/usb-mount@.service"];
  const present = [];
  for (const target of targets) if (await exists(target)) present.push(target.slice(1));
  if (present.length) await command("tar", ["-czf", resolve(backup, "host-config.tgz"), "-C", "/", ...present]);
  const script = resolve(backup, "install-reviewed.sh");
  await writeFile(script, prepared, { mode: 0o600 });
  console.log(`Pre-install configuration backup: ${backup}`);
  if (withoutApt) await installDependencies(output, backup);
  const { spawn } = await import("node:child_process");
  const child = spawn("bash", [script], { cwd: backup, stdio: "inherit", env: { ...process.env, TERM: process.env.TERM || "xterm" } });
  const code = await new Promise((done, reject) => { child.on("error", reject); child.on("exit", (code) => done(code)); });
  if (code !== 0) throw Error(`CasaOS installer failed (${code}); preserve ${backup}; do not rerun fresh install or automatically restore host configuration`);
  const after = await command("docker", ["ps", "--no-trunc", "--format", "{{.ID}}"]);
  const active = new Set(after.split("\n"));
  const missing = report.containers.filter((c) => c.state === "running" && !active.has(c.id));
  await writeFile(resolve(backup, "result.json"), JSON.stringify({ at: new Date().toISOString(), missing }, null, 2), { mode: 0o600 });
  if (missing.length) throw Error(`Existing containers no longer running: ${missing.map((c) => c.name).join(", ")}`);
  console.log("Native install finished; CasaOS authentication and real API acceptance still required.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const withoutApt = process.argv.includes("--without-apt");
  try {
    if (mode === "prepare") await prepare(withoutApt);
    else if (mode === "install") await install(withoutApt);
    else if (mode === "preflight") console.log(JSON.stringify(await preflight(withoutApt), null, 2));
    else throw Error("Usage: node deploy/m3/casaos-host.mjs preflight|prepare|install");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
