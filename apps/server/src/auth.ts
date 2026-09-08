import { createHash, randomBytes } from "node:crypto";
import type { Database } from "./persistence.js";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function createPairingCode(
  db: Database,
  role: "device" | "agent" = "device",
) {
  const code = randomBytes(12).toString("base64url");
  await db.query(
    "INSERT INTO pairing_codes(hash,role,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
    [hash(code), role],
  );
  return code;
}
export async function pair(db: Database, deviceId: string, code: string) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const result = await c.query(
      "DELETE FROM pairing_codes WHERE hash=$1 AND expires_at>now() RETURNING role",
      [hash(code)],
    );
    if (!result.rowCount) throw new Error("invalid_pairing_code");
    const token = randomBytes(32).toString("base64url");
    await c.query("INSERT INTO devices(id,token_hash,role) VALUES($1,$2,$3)", [
      deviceId,
      hash(token),
      result.rows[0].role,
    ]);
    await c.query("COMMIT");
    return { token, device_id: deviceId };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function authenticate(db: Database, header?: string) {
  if (!header?.startsWith("Bearer ")) return null;
  return (
    await db.query("SELECT id,role FROM devices WHERE token_hash=$1", [
      hash(header.slice(7)),
    ])
  ).rows[0] as { id: string; role: "device" | "agent" } | undefined;
}
