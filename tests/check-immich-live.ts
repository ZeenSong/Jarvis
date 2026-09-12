import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { ImmichClient } from "../packages/integration-immich/src/index.js";
const s = JSON.parse(await readFile(process.env.IMMICH_SESSION_FILE ?? ".local/m3-private/immich-session.json", "utf8"));
const client = new ImmichClient({ providerId: "immich-local", baseUrl: s.base_url, token: () => s.access_token });
const [version, albums, timeline, recent] = await Promise.all([client.version(), client.albums(), client.timeline(), client.search({})]);
assert.ok(version.major >= 2);
const unauthorized = await fetch(`${s.base_url}/api/albums`);
assert.equal(unauthorized.status, 401);
console.log(JSON.stringify({ provider: "immich", version, albums: albums.length, timeline_buckets: timeline.length,
  recent_photos: recent.photos.length, unauthorized: "rejected", smart_search_and_photo_rendering: "not yet verified" }, null, 2));
