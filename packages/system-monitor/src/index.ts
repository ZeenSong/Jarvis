import os from "node:os";
import { readFile, readdir, statfs } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
type Address = {
  family: string;
  local: string;
  scope?: string;
  preferred_life_time?: number | string;
  temporary?: boolean;
  deprecated?: boolean;
  flags?: string[];
};
export type Interface = {
  ifname: string;
  operstate?: string;
  addr_info: Address[];
};
export function selectNetwork(interfaces: Interface[], preferred = "") {
  const valid = interfaces.filter(
    (i) => !/^(lo$|docker|veth|cni|flannel|br-|virbr|podman)/.test(i.ifname),
  );
  const ordered = [...valid].sort(
    (a, b) => Number(b.ifname === preferred) - Number(a.ifname === preferred),
  );
  const pairs = ordered.flatMap((i) => i.addr_info.map((a) => ({ i, a })));
  const stable = pairs.filter(
    ({ a }) =>
      !a.temporary &&
      !a.deprecated &&
      !a.flags?.some((f) =>
        ["temporary", "deprecated", "tentative", "dadfailed"].includes(f),
      ) &&
      a.preferred_life_time !== 0 &&
      a.preferred_life_time !== "0",
  );
  const publicV6 = stable.find(
    ({ i, a }) =>
      i.ifname !== "tailscale0" &&
      a.family === "inet6" &&
      a.scope === "global" &&
      /^[23][0-9a-f]{3}:/i.test(a.local),
  );
  const v4 = pairs.filter(({ a }) => a.family === "inet");
  const privateV4 = (a: string) =>
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  return {
    public_ipv6: publicV6?.a.local ?? null,
    public_ipv4:
      v4.find(
        ({ i, a }) =>
          i.ifname !== "tailscale0" &&
          !privateV4(a.local) &&
          !/^(127\.|169\.254\.|100\.)/.test(a.local),
      )?.a.local ?? null,
    tailscale_ipv4:
      pairs.find(({ i, a }) => i.ifname === "tailscale0" && a.family === "inet")
        ?.a.local ?? null,
    tailscale_ipv6:
      pairs.find(
        ({ i, a }) => i.ifname === "tailscale0" && a.family === "inet6",
      )?.a.local ?? null,
    lan_ipv4: v4.find(({ a }) => privateV4(a.local))?.a.local ?? null,
    interfaces,
  };
}
export class SystemMonitor {
  state: any = null;
  lastSample = 0;
  private cpuPrevious: number[] | null = null;
  private diskTime = 0;
  private networkTime = 0;
  constructor(
    private hostRoot = "",
    private preferred = "",
  ) {}
  private async read(path: string) {
    return readFile(this.hostRoot + path, "utf8");
  }
  async sample() {
    const now = Date.now();
    const [stat, mem, uptime, load] = await Promise.all([
      this.read("/proc/stat"),
      this.read("/proc/meminfo"),
      this.read("/proc/uptime"),
      this.read("/proc/loadavg"),
    ]);
    const cpu = stat.split("\n")[0].trim().split(/\s+/).slice(1, 9).map(Number);
    const delta = cpu.map((v, i) => v - (this.cpuPrevious?.[i] ?? v));
    this.cpuPrevious = cpu;
    const total = delta.reduce((a, b) => a + b, 0);
    const usage = total ? 100 * (1 - (delta[3] + delta[4]) / total) : 0;
    const memory = Object.fromEntries(
      [...mem.matchAll(/^(\w+):\s+(\d+)/gm)].map((m) => [
        m[1],
        Number(m[2]) * 1024,
      ]),
    );
    let network = this.state?.network ?? selectNetwork([]),
      disks = this.state?.disks ?? [];
    if (now - this.networkTime >= 5000) {
      try {
        const { stdout } = await exec("ip", ["-j", "address", "show"], {
          timeout: 2000,
          maxBuffer: 1024 * 1024,
        });
        network = selectNetwork(JSON.parse(stdout), this.preferred);
        this.networkTime = now;
      } catch {
        network = { ...network, collection_error: "ip_address_unavailable" };
      }
    }
    if (now - this.diskTime >= 10000) {
      const mounts = await this.read("/proc/mounts");
      const paths = [
        ...new Set(
          mounts
            .split("\n")
            .filter((l) => /^(\/dev\/|[^ ]+ \/ )/.test(l))
            .map((l) => l.split(" ")[1]?.replaceAll("\\040", " "))
            .filter(Boolean),
        ),
      ];
      disks = (
        await Promise.all(
          paths.map(async (mount) => {
            try {
              const s = await statfs(this.hostRoot + mount);
              const total = Number(s.blocks) * Number(s.bsize),
                free = Number(s.bavail) * Number(s.bsize),
                used = (Number(s.blocks) - Number(s.bfree)) * Number(s.bsize);
              return {
                mount,
                total_bytes: total,
                used_bytes: used,
                free_bytes: free,
                usage_percent: total ? (used / total) * 100 : 0,
              };
            } catch {
              return null;
            }
          }),
        )
      ).filter(Boolean);
      this.diskTime = now;
    }
    let gpu = null,
      temperature: number | null = null;
    try {
      const { stdout } = await exec(
        "nvidia-smi",
        [
          "--query-gpu=name,utilization.gpu,memory.total,memory.used,temperature.gpu",
          "--format=csv,noheader,nounits",
        ],
        { timeout: 1500 },
      );
      const [model, u, t, m, c] = stdout
        .trim()
        .split("\n")[0]
        .split(",")
        .map((s) => s.trim());
      const numeric = (s: string) =>
        Number.isFinite(Number(s)) ? Number(s) : null;
      gpu = {
        model,
        utilization_percent: numeric(u),
        memory_total_bytes: numeric(t) === null ? null : Number(t) * 1048576,
        memory_used_bytes: numeric(m) === null ? null : Number(m) * 1048576,
        temperature_c: numeric(c),
      };
    } catch {}
    try {
      const zones = await readdir(this.hostRoot + "/sys/class/thermal");
      for (const zone of zones) {
        const type = (
          await this.read(`/sys/class/thermal/${zone}/type`)
        ).trim();
        if (/x86_pkg_temp|cpu|k10temp/i.test(type)) {
          temperature =
            Number(await this.read(`/sys/class/thermal/${zone}/temp`)) / 1000;
          break;
        }
      }
    } catch {}
    const [hostname, kernel, cpuInfo, osRelease] = await Promise.all([
      this.read("/proc/sys/kernel/hostname"),
      this.read("/proc/sys/kernel/osrelease"),
      this.read("/proc/cpuinfo"),
      this.read("/etc/os-release").catch(() => ""),
    ]);
    this.state = {
      server: {
        hostname: hostname.trim(),
        os: osRelease.match(/^PRETTY_NAME="?(.*?)"?$/m)?.[1] ?? os.platform(),
        kernel: kernel.trim(),
        uptime_seconds: Number(uptime.split(" ")[0]),
      },
      cpu: {
        model: cpuInfo.match(/model name\s*:\s*(.+)/)?.[1] ?? os.arch(),
        usage_percent: usage,
        load_1m: Number(load.split(" ")[0]),
        load_5m: Number(load.split(" ")[1]),
        load_15m: Number(load.split(" ")[2]),
        temperature_c: temperature,
      },
      memory: {
        total_bytes: memory.MemTotal,
        used_bytes: memory.MemTotal - memory.MemAvailable,
        available_bytes: memory.MemAvailable,
        usage_percent: 100 * (1 - memory.MemAvailable / memory.MemTotal),
      },
      disks,
      gpu,
      network,
      sampled_at: new Date(now).toISOString(),
    };
    this.lastSample = now;
    return this.state;
  }
}
