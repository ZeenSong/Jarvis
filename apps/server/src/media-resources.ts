import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./persistence.js";
import { ownerUserId } from "./ownership.js";

const mimeTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
const sourceSchema = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_.:-]+$/);
const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

export type MediaResource = {
  id: string;
  source: string;
  mime_type: string;
  filename: string;
  thumbnail_url: string;
  content_url: string;
  expires_at: string;
  metadata: Record<string, unknown>;
};
export type StoredMediaResource = MediaResource & { data: Buffer };

function validImage(data: Buffer, mimeType: z.infer<typeof mimeTypeSchema>) {
  return mimeType === "image/png" ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === "image/jpeg" ? data[0] === 255 && data[1] === 216 && data[2] === 255
      : data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
}

/** Durable, conversation-scoped media references. Binary bytes never enter the
 * transcript or UI protocol; clients only receive the resource ID and URLs. */
export class MediaResources {
  constructor(private readonly db: Database, private readonly lifetimeDays = 30) {}

  async publish(owner: string, conversationId: string, value: {
    data: Buffer; contentType: string; source?: string; filename?: string; metadata?: Record<string, unknown>;
  }): Promise<MediaResource> {
    const mimeType = mimeTypeSchema.parse(value.contentType);
    const source = sourceSchema.parse(value.source ?? "hermes");
    const conversation = z.uuid().parse(conversationId);
    if (!Buffer.isBuffer(value.data) || !value.data.length || value.data.length > 2 * 1024 * 1024 || !validImage(value.data, mimeType)) throw Error("invalid_media");
    const userId = await ownerUserId(this.db, owner);
    const id = randomUUID();
    const defaultName = `jarvis-image.${extension[mimeType]}`;
    const filename = (value.filename ?? defaultName).replace(/[\\/\u0000-\u001f]/g, " ").trim().slice(0, 120) || defaultName;
    const metadata = z.record(z.string(), z.unknown()).parse(value.metadata ?? {});
    const row = (await this.db.query(`INSERT INTO media_resources(id,conversation_id,owner_device_id,owner_user_id,source,mime_type,filename,data,expires_at,metadata)
      SELECT $1,c.id,$2,c.owner_user_id,$5,$6,$7,$8,now()+$9*interval '1 day',$10::jsonb
      FROM conversations c WHERE c.id=$3 AND (c.owner_device_id=$2 OR c.owner_user_id=$4)
      RETURNING id,source,mime_type,filename,expires_at,metadata`,
      [id, owner, conversation, userId ?? null, source, mimeType, filename, value.data, this.lifetimeDays, JSON.stringify(metadata)])).rows[0];
    if (!row) throw Error("conversation_not_found");
    return {
      id: row.id, source: row.source, mime_type: row.mime_type, filename: row.filename,
      thumbnail_url: `/api/media/${row.id}/thumbnail`, content_url: `/api/media/${row.id}/content`,
      expires_at: new Date(row.expires_at).toISOString(), metadata: row.metadata ?? {},
    };
  }

  async read(id: string, owner: string): Promise<StoredMediaResource | undefined> {
    const mediaId = z.uuid().safeParse(id);
    if (!mediaId.success) return undefined;
    const userId = await ownerUserId(this.db, owner);
    const row = (await this.db.query(`SELECT id,source,mime_type,filename,data,expires_at,metadata FROM media_resources
      WHERE id=$1 AND expires_at>now() AND (owner_device_id=$2 OR owner_user_id=$3)`, [mediaId.data, owner, userId ?? null])).rows[0];
    if (!row) return undefined;
    return {
      id: row.id, source: row.source, mime_type: row.mime_type, filename: row.filename, data: Buffer.from(row.data),
      thumbnail_url: `/api/media/${row.id}/thumbnail`, content_url: `/api/media/${row.id}/content`,
      expires_at: new Date(row.expires_at).toISOString(), metadata: row.metadata ?? {},
    };
  }
}
