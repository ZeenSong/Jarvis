import { randomBytes } from "node:crypto";
type Thumbnail = { data: Buffer; contentType: "image/jpeg" | "image/png" | "image/webp" };
/** Ephemeral, device-scoped thumbnails. Providers retain their own credentials. */
export class MediaStore {
  private entries = new Map<string, Thumbnail & { deviceId: string; expires: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  private prune() { for (const [id, value] of this.entries) if (value.expires <= this.now()) this.entries.delete(id); }
  publish(deviceId: string, value: Thumbnail) {
    this.prune();
    if (!deviceId || !Buffer.isBuffer(value.data) || !value.data.length || value.data.length > 2 * 1024 * 1024) throw Error("invalid_thumbnail");
    const data = value.data;
    const valid = value.contentType === "image/png" ? data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : value.contentType === "image/jpeg" ? data[0] === 255 && data[1] === 216 && data[2] === 255
      : value.contentType === "image/webp" && data.toString("ascii",0,4) === "RIFF" && data.toString("ascii",8,12) === "WEBP";
    if (!valid) throw Error("invalid_thumbnail");
    if (this.entries.size >= 32) this.entries.delete(this.entries.keys().next().value!);
    const id = randomBytes(24).toString("base64url");
    this.entries.set(id, { ...value, data: Buffer.from(data), deviceId, expires: this.now() + 5 * 60_000 });
    return `/api/media/${id}/thumbnail`;
  }
  read(id: string, deviceId: string): Thumbnail | undefined {
    this.prune();
    const value = this.entries.get(id);
    return value?.deviceId === deviceId ? { data: Buffer.from(value.data), contentType: value.contentType } : undefined;
  }
  clear() { this.entries.clear(); }
}
