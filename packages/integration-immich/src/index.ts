import { z } from "zod";

const assetSchema = z.object({
  id: z.string().uuid(), type: z.enum(["IMAGE", "VIDEO", "AUDIO", "OTHER"]),
  originalFileName: z.string(), fileCreatedAt: z.string(),
  isFavorite: z.boolean().optional(), thumbhash: z.string().nullish(),
  exifInfo: z.object({ description: z.string().nullish(), city: z.string().nullish(),
    country: z.string().nullish(), exifImageWidth: z.number().nullish(), exifImageHeight: z.number().nullish() }).nullish(),
});
export type Photo = {
  id: string; provider: string; provider_id: string; type: "Photo"; version: 1;
  name: string; captured_at: string; favorite: boolean; description?: string;
  location?: string; width?: number; height?: number; thumbhash?: string;
};
export class ImmichError extends Error {
  constructor(readonly code: "unauthorized" | "unavailable" | "not_found" | "invalid_response" | "request_failed", readonly status?: number) {
    super(`immich:${code}`);
  }
}

/** Each instance is scoped to one user's provider credential, never a shared global photo token. */
export class ImmichClient {
  private readonly base: URL;
  constructor(private readonly config: { providerId: string; baseUrl: string; token: () => string | Promise<string>; timeoutMs?: number }) {
    z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).parse(config.providerId);
    this.base = new URL(config.baseUrl);
    if (!["http:", "https:"].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash) throw Error("Invalid Immich base URL");
  }
  private async request(path: string, body?: unknown, binary = false): Promise<unknown> {
    const token = await this.config.token();
    if (!token) throw new ImmichError("unauthorized");
    try {
      const r = await fetch(new URL(`/api${path}`, this.base), {
        method: body === undefined ? "GET" : "POST", redirect: "error",
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.config.timeoutMs ?? 20000),
      });
      if (!r.ok) {
        await r.body?.cancel();
        throw new ImmichError(r.status === 401 || r.status === 403 ? "unauthorized" : r.status === 404 ? "not_found" : r.status >= 500 ? "unavailable" : "request_failed", r.status);
      }
      const chunks: Uint8Array[] = []; let length = 0;
      const reader = r.body?.getReader();
      if (reader) while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 8 * 1024 * 1024) { await reader.cancel(); throw new ImmichError("invalid_response"); }
        chunks.push(chunk.value);
      }
      const data = Buffer.concat(chunks);
      if (binary) {
        const contentType = r.headers.get("content-type")?.split(";")[0] ?? "";
        if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(contentType)) throw new ImmichError("invalid_response");
        return { data, contentType };
      }
      try { return JSON.parse(data.toString("utf8")); } catch { throw new ImmichError("invalid_response"); }
    } catch (e) { if (e instanceof ImmichError) throw e; throw new ImmichError("unavailable"); }
  }
  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new ImmichError("invalid_response");
    return result.data;
  }
  private photo(asset: z.infer<typeof assetSchema>): Photo {
    return { id: `${this.config.providerId}:photo:${asset.id}`, provider: this.config.providerId, provider_id: asset.id,
      type: "Photo", version: 1, name: asset.originalFileName, captured_at: asset.fileCreatedAt,
      favorite: asset.isFavorite ?? false, description: asset.exifInfo?.description ?? undefined,
      location: [asset.exifInfo?.city, asset.exifInfo?.country].filter(Boolean).join(" · ") || undefined,
      width: asset.exifInfo?.exifImageWidth ?? undefined, height: asset.exifInfo?.exifImageHeight ?? undefined,
      thumbhash: asset.thumbhash ?? undefined };
  }
  async version() { return this.parse(z.object({ major: z.number(), minor: z.number(), patch: z.number() }), await this.request("/server/version")); }
  async albums() {
    const albums = this.parse(z.array(z.object({ id: z.string().uuid(), albumName: z.string(), assetCount: z.number(), albumThumbnailAssetId: z.string().nullish() })), await this.request("/albums"));
    return albums.map((a) => ({ id: `${this.config.providerId}:album:${a.id}`, provider_id: a.id, name: a.albumName, count: a.assetCount, cover_photo_id: a.albumThumbnailAssetId }));
  }
  async timeline() {
    return this.parse(z.array(z.object({ timeBucket: z.string(), count: z.number() })), await this.request("/timeline/buckets?isTrashed=false&withPartners=false&visibility=timeline"));
  }
  async search(input: { query?: string; from?: string; to?: string; page?: number; size?: number }) {
    const args = z.object({ query: z.string().min(1).max(2000).optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(),
      page: z.number().int().min(1).default(1), size: z.number().int().min(1).max(100).default(40) }).strict().parse(input);
    if (args.from && args.to && args.from > args.to) throw Error("Invalid date range");
    const data = await this.request(args.query ? "/search/smart" : "/search/metadata", {
      ...(args.query ? { query: args.query } : {}), takenAfter: args.from, takenBefore: args.to,
      page: args.page, size: args.size, type: "IMAGE", isTrashed: false, visibility: "timeline", withExif: true,
    });
    const result = this.parse(z.object({ assets: z.object({ items: z.array(assetSchema), nextPage: z.string().nullish(), total: z.number() }) }), data);
    return { photos: result.assets.items.filter((a) => a.type === "IMAGE").map((a) => this.photo(a)), next_page: result.assets.nextPage ?? null, total: result.assets.total };
  }
  async thumbnail(id: string) {
    z.string().uuid().parse(id);
    return await this.request(`/assets/${id}/thumbnail?size=thumbnail`, undefined, true) as { data: Buffer; contentType: string };
  }
}
