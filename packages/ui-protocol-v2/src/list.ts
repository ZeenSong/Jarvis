import { z } from "zod";
export const listItemSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  status: z.string().max(100).optional(),
});
export const listDataSchema = z.object({ items: z.array(listItemSchema).max(200) });
