import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { database, migrate } from "../apps/server/src/persistence.js";
import { createPairingCode, pair } from "../apps/server/src/auth.js";
const db = database(process.env.TEST_DATABASE_URL!);
const adb = process.env.ADB ?? "adb";
const run = (args: string[]) =>
  execFileSync(adb, args, { encoding: "utf8", timeout: 120000 });
try {
  await migrate(db);
  const code = await createPairingCode(db);
  const agent = await pair(
    db,
    randomUUID(),
    await createPairingCode(db, "agent"),
  );
  console.log(
    run([
      "install",
      "-r",
      "apps/android/app/build/outputs/apk/debug/app-debug.apk",
    ]),
  );
  console.log(
    run([
      "install",
      "-r",
      "apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk",
    ]),
  );
  // This harness owns the dedicated emulator installation; clear only Jarvis test app state.
  console.log(run(["shell", "pm", "clear", "cloud.jarvis.app"]));
  const result = run([
    "shell",
    "am",
    "instrument",
    "-w",
    "-r",
    "-e",
    "server",
    process.env.ANDROID_TEST_SERVER ?? "http://10.0.2.2:18080",
    "-e",
    "pairingCode",
    code,
    "-e",
    "agentToken",
    agent.token,
    "cloud.jarvis.app.test/androidx.test.runner.AndroidJUnitRunner",
  ]);
  console.log(result);
  if (!result.includes("OK (1 test)"))
    throw new Error("Android end-to-end test did not pass");
  const evidence = await db.query(
    "SELECT a.name,a.status,a.current_task_id,r.provider,r.model,r.input_tokens,r.output_tokens,r.cached_input_tokens FROM agents a JOIN llm_requests r ON r.agent_id=a.id WHERE a.owner_device_id=$1",
    [agent.device_id],
  );
  if (evidence.rowCount !== 1)
    throw new Error("Expected one persisted Android E2E usage request");
  console.log(JSON.stringify(evidence.rows));
  await mkdir(".local/evidence", { recursive: true });
  await writeFile(
    ".local/evidence/android-e2e.txt",
    result + "\n" + JSON.stringify(evidence.rows, null, 2),
  );
} finally {
  await db.end();
}
