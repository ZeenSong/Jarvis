import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const adb = process.env.ADB ?? "adb";
const run = (args: string[]) =>
  execFileSync(
    adb,
    ["-s", process.env.ADB_SERIAL ?? "emulator-5554", ...args],
    { encoding: "utf8", timeout: 15000 },
  );
const docker = (args: string[]) =>
  execFileSync("docker", args, { encoding: "utf8", timeout: 15000 });
const container = "jarvis-m1-test-server";
assert.match(
  docker(["inspect", container, "--format", "{{.Config.Image}}"]),
  /^jarvis-server:/,
);
async function ui() {
  run(["shell", "uiautomator", "dump", "/sdcard/jarvis-recovery.xml"]);
  return run(["shell", "cat", "/sdcard/jarvis-recovery.xml"]);
}
async function waitText(pattern: RegExp) {
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    if (pattern.test(await ui())) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`UI did not reach ${pattern}`);
}
run(["shell", "am", "start", "-W", "-n", "cloud.jarvis.app/.MainActivity"]);
await waitText(/text="ONLINE"/);
try {
  docker(["stop", container]);
  await waitText(/text="RECONNECTING"/);
  console.log("Server offline → Android reconnecting (cached state retained)");
  docker(["start", container]);
  await waitText(/text="ONLINE"/);
  console.log("Server restarted → Android online without pairing again");
  run(["shell", "svc", "wifi", "disable"]);
  await waitText(/text="ONLINE"/);
  console.log("Emulator Wi-Fi disabled → cellular path online");
  run(["shell", "svc", "wifi", "enable"]);
  await waitText(/text="ONLINE"/);
  console.log("Emulator Wi-Fi enabled → online");
  run([
    "shell",
    "pm",
    "grant",
    "cloud.jarvis.app",
    "android.permission.POST_NOTIFICATIONS",
  ]);
  const xml = await ui();
  const toggle = xml.match(
    /<node[^>]*checkable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/,
  );
  assert.ok(toggle, "background switch must exist");
  if (!toggle[0].includes('checked="true"'))
    run([
      "shell",
      "input",
      "tap",
      String(Math.round((Number(toggle[1]) + Number(toggle[3])) / 2)),
      String(Math.round((Number(toggle[2]) + Number(toggle[4])) / 2)),
    ]);
  await new Promise((r) => setTimeout(r, 1000));
  const services = run([
    "shell",
    "dumpsys",
    "activity",
    "services",
    "cloud.jarvis.app",
  ]);
  assert.match(services, /isForeground=true/);
  console.log("User-enabled foreground connection service is running");
  run(["shell", "input", "keyevent", "3"]);
  await new Promise((r) => setTimeout(r, 1000));
  assert.match(
    run(["shell", "dumpsys", "activity", "services", "cloud.jarvis.app"]),
    /isForeground=true/,
  );
  run(["shell", "am", "start", "-W", "-n", "cloud.jarvis.app/.MainActivity"]);
  await waitText(/text="ONLINE"/);
  console.log("Background → foreground automatically restores online UI");
} finally {
  docker(["start", container]);
  run(["shell", "svc", "wifi", "enable"]);
}
