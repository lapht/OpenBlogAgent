import { z } from "zod";

export const envSchema = z.object({
  OPENBLOG_APP_NAME: z.string().min(1),
  OPENBLOG_ENV: z.enum(["development", "test", "production"]),
  OPENBLOG_PORT: z.coerce.number().int().positive(),
  OPENBLOG_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"])
});

export type EnvSchema = z.infer<typeof envSchema>;
