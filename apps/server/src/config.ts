import { z } from "zod";
export const priceSchema = z.record(
  z.string(),
  z.record(
    z.string(),
    z.object({
      input_per_million: z.number().finite().nonnegative(),
      output_per_million: z.number().finite().nonnegative(),
      cached_input_per_million: z.number().finite().nonnegative(),
      valid_from: z.iso.date(),
    }),
  ),
);
export const configSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    AGENT_DEGRADED_SECONDS: z.coerce.number().int().positive().default(30),
    AGENT_OFFLINE_SECONDS: z.coerce.number().int().positive().default(90),
    EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    HOST_ROOT: z.string().default(""),
    NETWORK_INTERFACE: z.string().optional(),
  })
  .refine((c) => c.AGENT_OFFLINE_SECONDS > c.AGENT_DEGRADED_SECONDS, {
    message: "offline threshold must exceed degraded threshold",
  });
