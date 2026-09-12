import { z } from "zod";
/** Media is served by the authenticated Jarvis gateway, never arbitrary provider URLs. */
export const mediaPathSchema = z.string().regex(/^\/api\/media\/[a-zA-Z0-9_-]{1,100}\/thumbnail$/);
export const galleryDataSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1).max(200), title: z.string().max(300),
    thumbnail: mediaPathSchema, description: z.string().max(2000).optional(),
    captured_at: z.string().max(100).optional(),
  })).max(100),
}).superRefine((value, ctx) => {
  if (new Set(value.items.map((item) => item.id)).size !== value.items.length) ctx.addIssue({code:"custom",message:"Duplicate gallery item ID"});
});
