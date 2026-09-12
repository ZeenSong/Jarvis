import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdtemp, readdir, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const exec = promisify(execFile);
const required = ["smartmontools", "udevil", "samba", "cifs-utils", "mergerfs"];
const sha = (data) => createHash("sha256").update(data).digest("hex");
const command = async (name, args, cwd) => (await exec(name, args, {
  cwd, timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  env: { ...process.env, LC_ALL: "C" },
})).stdout;

export function isolatedStatus(status) {
  // Only omit the known unrelated broken Xorg record in a disposable solver input.
  // Never write /var/lib/dpkg/status or force an installation through broken dependencies.
  return status.split(/\n\n/).filter((record) => !/^Package: xserver-xorg-video-nvidia-570$/m.test(record)).join("\n\n");
}

export async function prepareDependencies(output) {
  const status = await readFile("/var/lib/dpkg/status", "utf8");
  const temp = await mkdtemp(join(tmpdir(), "jarvis-dependency-plan-"));
  const statusFile = join(temp, "status");
  await writeFile(statusFile, isolatedStatus(status), { mode: 0o600 });
  const sambaVersion = (await command("dpkg-query", ["-W", "-f=${Version}", "samba-libs"])).trim();
  const targets = [...required.filter((name) => name !== "samba"),
    ...["samba", "python3-samba", "samba-common-bin", "samba-common", "samba-libs", "libsmbclient"].map((name) => `${name}=${sambaVersion}`)];
  const simulation = await command("apt-get", ["-s", "-o", `Dir::State::status=${statusFile}`, "--no-install-recommends", "install", ...targets]);
  if (/^Remv /m.test(simulation)) throw Error("Dependency plan requires package removal; refused");
  const packages = simulation.split("\n").filter((line) => line.startsWith("Inst ")).map((line) => {
    const match = /^Inst ([a-z0-9+.:_-]+) \(([^ ]+) /.exec(line);
    if (!match) throw Error(`Dependency plan upgrades an existing package; refused: ${line}`);
    if (/nvidia|cuda|docker|containerd|linux-image|linux-headers/.test(match[1])) throw Error("Dependency plan touches protected packages");
    return { name: match[1], version: match[2] };
  });
  if (packages.length > 40) throw Error("Unexpectedly large dependency plan");
  await mkdir(output, { recursive: true, mode: 0o700 });
  const bundle = await mkdtemp(join(output, "dependencies-"));
  for (const pkg of packages) {
    const metadata = await command("apt-cache", ["show", `${pkg.name}=${pkg.version}`]);
    const checksum = /^SHA256: ([a-f0-9]{64})$/m.exec(metadata)?.[1];
    if (!checksum) throw Error(`No repository SHA256 for ${pkg.name}`);
    const before = new Set(await readdir(bundle));
    await command("apt-get", ["download", `${pkg.name}=${pkg.version}`], bundle);
    const added = (await readdir(bundle)).filter((name) => !before.has(name));
    if (added.length !== 1 || !added[0].endsWith(".deb")) throw Error("Unexpected download output");
    const archive = await readFile(join(bundle, added[0]));
    if (sha(archive) !== checksum) throw Error(`Repository checksum mismatch: ${pkg.name}`);
    pkg.file = added[0]; pkg.sha256 = checksum;
  }
  const manifest = { version: 1, status_sha256: sha(status), bundle, packages };
  await writeFile(join(output, "dependencies.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  console.log(`Prepared ${packages.length} new dependency packages: ${packages.map((p) => p.name).join(", ")}`);
  return manifest;
}

export async function installDependencies(output, backup) {
  const manifest = JSON.parse(await readFile(join(output, "dependencies.json"), "utf8"));
  const status = await readFile("/var/lib/dpkg/status");
  if (manifest.version !== 1 || sha(status) !== manifest.status_sha256) throw Error("Package state changed; rerun prepare --without-apt before installing");
  await writeFile(join(backup, "dpkg-status-before"), status, { mode: 0o600 });
  const files = [];
  for (const pkg of manifest.packages) {
    if (!/^[a-z0-9][a-z0-9+.-]*(?::amd64)?$/.test(pkg.name) || /nvidia|cuda|docker|containerd|linux-/.test(pkg.name)) throw Error("Protected or invalid dependency");
    if (pkg.file !== pkg.file.split("/").pop()) throw Error("Invalid archive filename");
    const archive = await readFile(resolve(manifest.bundle, pkg.file));
    if (sha(archive) !== pkg.sha256) throw Error("Dependency archive checksum changed");
    const target = join(backup, pkg.file);
    await writeFile(target, archive, { mode: 0o600 });
    const fields = (await command("dpkg-deb", ["-f", target, "Package", "Version"])).trim();
    if (fields !== `Package: ${pkg.name.replace(/:amd64$/, "")}\nVersion: ${pkg.version}`) throw Error("Dependency archive identity mismatch");
    files.push(target);
  }
  if (files.length) {
    const { spawn } = await import("node:child_process");
    const child = spawn("dpkg", ["--install", ...files], { stdio: "inherit", env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" } });
    const code = await new Promise((done, reject) => { child.on("error", reject); child.on("exit", done); });
    if (code !== 0) throw Error(`Dependency installation failed (${code}); no force or automatic repair attempted; retain ${backup}`);
  }
}
