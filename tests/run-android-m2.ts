import { execFileSync } from "node:child_process";
import { buildApp } from "../apps/server/src/app.js";
import { createPairingCode, pair } from "../apps/server/src/auth.js";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { controlledRegistry, seedControlRuns } from "./controlled-runtime.js";
const ctx = await buildApp({
  databaseUrl: process.env.TEST_DATABASE_URL!,
  runtimes: controlledRegistry(),
});
const adb = process.env.ADB ?? ".local/android-sdk/platform-tools/adb";
const exec = (args: string[]) =>
  execFileSync(adb, args, { encoding: "utf8", timeout: 120000 });
try {
  await ctx.app.listen({ host: "127.0.0.1", port: 18082 });
  const code = await createPairingCode(ctx.db);
  const runs = await seedControlRuns(ctx);
  exec([
    "install",
    "-r",
    "apps/android/app/build/outputs/apk/debug/app-debug.apk",
  ]);
  exec([
    "install",
    "-r",
    "apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk",
  ]);
  exec(["shell", "pm", "clear", "cloud.jarvis.app"]);
  // Async instrumentation keeps the in-process Gateway event loop available.
  const { execFile } = await import("node:child_process");
  const result = await new Promise<string>((resolve, reject) =>
    execFile(
      adb,
      [
        "shell",
        "am",
        "instrument",
        "-w",
        "-r",
        "-e",
        "class",
        "cloud.jarvis.app.M2EndToEndTest",
        "-e",
        "server",
        "http://10.0.2.2:18082",
        "-e",
        "pairingCode",
        code,
        "-e",
        "inputRun",
        runs.input,
        "-e",
        "cancelRun",
        runs.cancel,
        "cloud.jarvis.app.test/androidx.test.runner.AndroidJUnitRunner",
      ],
      { timeout: 120000 },
      (e, out) => (e ? reject(e) : resolve(out)),
    ),
  );
  console.log(result);
  await writeFile(".local/evidence/m2-android-instrumentation.txt", result);
  if (!result.includes("OK (1 test)"))
    throw Error("Android M2 instrumentation failed");
  const messages = (
    await ctx.db.query(
      "SELECT count(*)::int count FROM conversation_messages WHERE content LIKE '当前 CPU 使用率%'",
    )
  ).rows[0];
  console.log(JSON.stringify(messages));
  // Verify the retained M1 monitor and usage flows against this same M2 server.
  exec(["shell", "pm", "clear", "cloud.jarvis.app"]);
  const legacyCode = await createPairingCode(ctx.db);
  const legacyAgent = await pair(
    ctx.db,
    randomUUID(),
    await createPairingCode(ctx.db, "agent"),
  );
  const legacy = await new Promise<string>((resolve, reject) =>
    execFile(
      adb,
      [
        "shell",
        "am",
        "instrument",
        "-w",
        "-r",
        "-e",
        "class",
        "cloud.jarvis.app.M1EndToEndTest",
        "-e",
        "server",
        "http://10.0.2.2:18082",
        "-e",
        "pairingCode",
        legacyCode,
        "-e",
        "agentToken",
        legacyAgent.token,
        "cloud.jarvis.app.test/androidx.test.runner.AndroidJUnitRunner",
      ],
      { timeout: 120000 },
      (e, out) => (e ? reject(e) : resolve(out)),
    ),
  );
  await writeFile(".local/evidence/m2-android-m1-regression.txt", legacy);
  console.log(legacy);
  if (!legacy.includes("OK (1 test)"))
    throw Error("Android M1 regression failed");
} finally {
  await ctx.app.close();
}
