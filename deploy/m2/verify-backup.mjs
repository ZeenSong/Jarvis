// Restore only into a newly created, network-isolated disposable PostgreSQL.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { m2Migration } from "../../dist/apps/server/src/m2-migration.js";
const backup = process.env.M2_BACKUP_FILE;
if (!backup) throw Error("M2_BACKUP_FILE required; run npm run build first");
await access(backup);
// M1 dumps predate the Identity/Control Plane tables that persistence.migrate
// creates before running m2Migration. Recreate only that additive base here so
// the restore verifier exercises the same migration order without mutating the
// production cluster or requiring a full application start.
const migrationPrelude = `
CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE devices ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS approvals (id UUID PRIMARY KEY, owner_device_id TEXT NOT NULL REFERENCES devices(id), owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL, run_id UUID, capability TEXT NOT NULL, input JSONB NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ);
`;
const name = "jarvis-m2-restore-" + randomUUID().slice(0, 12),
  temp = await mkdtemp(join(tmpdir(), name));
const docker = async (args) =>
  (
    await promisify(execFile)("docker", args, {
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    })
  ).stdout.trim();
const input = async (args, data) => {
  const p = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  let output = "",
    error = "";
  p.stdout.on("data", (b) => {
    output += b;
  });
  p.stderr.on("data", (b) => {
    error += b;
  });
  const done = new Promise((resolve, reject) => {
    p.once("error", reject);
    p.once("exit", (code) =>
      code === 0 ? resolve(output) : reject(Error(error)),
    );
  });
  if (typeof data === "string") p.stdin.end(data);
  else await pipeline(data, p.stdin);
  return done;
};
let created = false;
try {
  const env = join(temp, "postgres.env");
  await writeFile(
    env,
    "POSTGRES_USER=jarvis\nPOSTGRES_DB=jarvis\nPOSTGRES_PASSWORD=" +
      randomBytes(32).toString("hex") +
      "\n",
    { mode: 0o600 },
  );
  await docker(["volume", "create", name]);
  await docker([
    "run",
    "-d",
    "--name",
    name,
    "--network",
    "none",
    "--env-file",
    env,
    "--mount",
    `type=volume,src=${name},dst=/var/lib/postgresql/data`,
    "postgres:17-alpine",
  ]);
  created = true;
  for (let i = 0; i < 60; i++) {
    if (
      await docker(["exec", name, "pg_isready", "-U", "jarvis"]).then(
        () => true,
        () => false,
      )
    )
      break;
    if (i === 59) throw Error("restore_database_not_ready");
    await new Promise((r) => setTimeout(r, 500));
  }
  await input(
    [
      "exec",
      "-i",
      name,
      "pg_restore",
      "-U",
      "jarvis",
      "-d",
      "jarvis",
      "--no-owner",
      "--exit-on-error",
    ],
    createReadStream(backup),
  );
  const tables = [
    "devices",
    "agents",
    "agent_sessions",
    "agent_events",
    "llm_requests",
  ];
  async function checksums() {
    const rows = {};
    for (const table of tables) {
      // The migration adds owner/user linkage columns; omit those schema-only
      // fields while hashing the pre-existing M1 data payload.
      const sql = `SELECT json_build_object('count',count(*),'checksum',md5(string_agg(md5((to_jsonb(t)-'user_id'-'owner_user_id'-'logical_agent_id'-'run_id'-'conversation_id')::text),'' ORDER BY id))) FROM ${table} t`;
      rows[table] = JSON.parse(
        await docker([
          "exec",
          name,
          "psql",
          "-U",
          "jarvis",
          "-d",
          "jarvis",
          "-At",
          "-c",
          sql,
        ]),
      );
    }
    return rows;
  }
  const before = await checksums();
  await input(
    [
      "exec",
      "-i",
      name,
      "psql",
      "-U",
      "jarvis",
      "-d",
      "jarvis",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    `BEGIN;\n${migrationPrelude}\n${m2Migration}\nCOMMIT;`,
  );
  const after = await checksums();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw Error("M1 data changed during migration");
  const report = {
    status: "passed",
    backup: resolve(backup),
    migration: "M2 additive",
    tables: after,
  };
  await writeFile(
    backup + ".verified.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
} finally {
  if (created) await docker(["rm", "-f", name]).catch(() => {});
  await docker(["volume", "rm", name]).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
