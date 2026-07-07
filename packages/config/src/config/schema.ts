import { z } from "zod";

export const envSchema = z.object({
  OPENBLOG_APP_NAME: z.string().min(1),
  OPENBLOG_ENV: z.enum(["development", "test", "production"]),
  OPENBLOG_PORT: z.coerce.number().int().positive(),
  OPENBLOG_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]),
  OPENBLOG_DEFAULT_PUBLISHER: z.string().optional(),
  OPENBLOG_OUTPUT_DIR: z.string().default("output/articles"),
  OPENBLOG_WORDPRESS_ENDPOINT: z.string().optional(),
  OPENBLOG_WORDPRESS_USERNAME: z.string().optional(),
  OPENBLOG_WORDPRESS_PASSWORD: z.string().optional(),
  OPENBLOG_WORDPRESS_APPLICATION_PASSWORD: z.string().optional(),
  OPENBLOG_WORDPRESS_STATUS: z.enum(["draft", "publish"]).optional(),
  OPENBLOG_GHOST_ENDPOINT: z.string().optional(),
  OPENBLOG_GHOST_API_KEY: z.string().optional(),
  OPENBLOG_GHOST_STATUS: z.enum(["draft", "publish"]).optional()
});

export type EnvSchema = z.infer<typeof envSchema>;
