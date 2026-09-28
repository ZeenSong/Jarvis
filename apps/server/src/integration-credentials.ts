import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./persistence.js";
import { ownerUserId } from "./ownership.js";
import { householdForUser } from "./households.js";

/** Provider credentials are encrypted separately from Jarvis login credentials. */
const inputSchema = z.object({
  credential_id: z.uuid().optional(),
  provider: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{1,79}$/),
  label: z.string().trim().min(1).max(120),
  secret: z.string().min(1).max(16384),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

function encryptionKey() {
  const value = process.env.INTEGRATION_CREDENTIAL_KEY;
  if (!value) throw Error("integration_credentials_key_missing");
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32) throw Error("integration_credentials_key_invalid");
  return key;
}

export function encryptIntegrationSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptIntegrationSecret(value: string) {
  const [ivText, tagText, ciphertextText] = value.split(".");
  if (!ivText || !tagText || !ciphertextText) throw Error("integration_credentials_corrupt");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}

export class IntegrationCredentialStore {
  constructor(private readonly db: Database) {}

  private async context(owner: string) {
    const user = await ownerUserId(this.db, owner);
    if (!user) throw Error("user_login_required");
    return { user, household: await householdForUser(this.db, user) };
  }

  async list(owner: string) {
    const { user, household } = await this.context(owner);
    return (await this.db.query(
      "SELECT id,provider,label,metadata,created_at,updated_at,revoked_at FROM integration_credentials WHERE (household_id=$1 OR (household_id IS NULL AND user_id=$2)) AND revoked_at IS NULL ORDER BY updated_at DESC",
      [household.id, user],
    )).rows;
  }

  async put(owner: string, value: unknown) {
    const { user, household } = await this.context(owner);
    const input = inputSchema.parse(value);
    const id = input.credential_id ?? randomUUID();
    const row = (await this.db.query(
      `INSERT INTO integration_credentials(id,user_id,household_id,provider,label,secret_ciphertext,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,label=excluded.label,secret_ciphertext=excluded.secret_ciphertext,metadata=excluded.metadata,updated_at=now(),revoked_at=NULL
       WHERE integration_credentials.household_id=$3 OR (integration_credentials.household_id IS NULL AND integration_credentials.user_id=$2)
       RETURNING id,provider,label,metadata,created_at,updated_at,revoked_at`,
      [id, user, household.id, input.provider, input.label, encryptIntegrationSecret(input.secret), JSON.stringify(input.metadata)],
    )).rows[0];
    if (!row) throw Error("not_found");
    return row;
  }

  async revoke(owner: string, id: string) {
    const { user, household } = await this.context(owner);
    const row = (await this.db.query(
      "UPDATE integration_credentials SET revoked_at=COALESCE(revoked_at,now()),updated_at=now() WHERE id=$1 AND (household_id=$2 OR (household_id IS NULL AND user_id=$3)) RETURNING id,provider,label,metadata,created_at,updated_at,revoked_at",
      [z.uuid().parse(id), household.id, user],
    )).rows[0];
    if (!row) throw Error("not_found");
    return row;
  }

  /** Internal provider path; secrets never cross a Gateway response. */
  async readSecret(owner: string, id: string) {
    const { user, household } = await this.context(owner);
    const row = (await this.db.query(
      "SELECT secret_ciphertext FROM integration_credentials WHERE id=$1 AND (household_id=$2 OR (household_id IS NULL AND user_id=$3)) AND revoked_at IS NULL",
      [z.uuid().parse(id), household.id, user],
    )).rows[0];
    if (!row) throw Error("not_found");
    return decryptIntegrationSecret(row.secret_ciphertext);
  }

  /** Internal validation path; returns the provider alongside the decrypted secret. */
  async readCredential(owner: string, id: string) {
    const { user, household } = await this.context(owner);
    const row = (await this.db.query(
      "SELECT id,provider,secret_ciphertext FROM integration_credentials WHERE id=$1 AND (household_id=$2 OR (household_id IS NULL AND user_id=$3)) AND revoked_at IS NULL",
      [z.uuid().parse(id), household.id, user],
    )).rows[0];
    if (!row) throw Error("not_found");
    return { id: row.id as string, provider: row.provider as string, secret: decryptIntegrationSecret(row.secret_ciphertext as string) };
  }

  /** Resolve the newest active household credential for Kernel execution. */
  async readProviderSecret(owner: string, provider: string) {
    const { user, household } = await this.context(owner);
    const row = (await this.db.query(
      "SELECT secret_ciphertext FROM integration_credentials WHERE provider=$1 AND (household_id=$2 OR (household_id IS NULL AND user_id=$3)) AND revoked_at IS NULL ORDER BY updated_at DESC LIMIT 1",
      [provider, household.id, user],
    )).rows[0];
    return row ? decryptIntegrationSecret(row.secret_ciphertext) : undefined;
  }
}
