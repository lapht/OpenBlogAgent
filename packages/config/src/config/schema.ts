import { z } from "zod";

/**
 * Parses an env string as an explicit boolean. Only "true" and "false"
 * (case-insensitive) are accepted; anything else is a validation error, unlike
 * `z.coerce.boolean()` which turns "false" into `true`.
 */
export const envBoolean = (defaultValue: boolean) =>
  z
    .preprocess(
      (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
      z.enum(["true", "false"])
    )
    .transform((value) => value === "true")
    .default(String(defaultValue) as "true" | "false");

/** Treats empty strings (e.g. `FOO=` in a .env file) as unset. */
const optionalString = () =>
  z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());

export const envSchema = z.object({
  OPENBLOG_APP_NAME: z.string().min(1).default("OpenBlogAgent"),
  OPENBLOG_ENV: z.enum(["development", "test", "production"]).default("development"),
  OPENBLOG_PORT: z.coerce.number().int().positive().default(3000),
  OPENBLOG_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  OPENBLOG_MEMORY_DB_PATH: optionalString(),

  OPENROUTER_API_KEY: optionalString(), // secret
  OPENROUTER_MODEL: optionalString(),
  OPENROUTER_SITE_URL: optionalString(),
  OPENROUTER_SITE_NAME: optionalString(),
  OLLAMA_BASE_URL: optionalString(),
  OLLAMA_MODEL: optionalString(),

  OPENBLOG_DEFAULT_PUBLISHER: optionalString(),
  OPENBLOG_OUTPUT_DIR: z.string().default("output/articles"),
  OPENBLOG_WORDPRESS_ENDPOINT: optionalString(),
  OPENBLOG_WORDPRESS_USERNAME: optionalString(),
  OPENBLOG_WORDPRESS_PASSWORD: optionalString(), // secret
  OPENBLOG_WORDPRESS_APPLICATION_PASSWORD: optionalString(), // secret
  OPENBLOG_WORDPRESS_STATUS: z.enum(["draft", "publish"]).optional(),
  OPENBLOG_GHOST_ENDPOINT: optionalString(),
  OPENBLOG_GHOST_API_KEY: optionalString(), // secret
  OPENBLOG_GHOST_STATUS: z.enum(["draft", "publish"]).optional(),
  OPENBLOG_TAXONOMY_PROVIDER: z.enum(["static", "wordpress"]).default("static"),
  OPENBLOG_TAXONOMY_ALLOW_CREATE: envBoolean(false),
  OPENBLOG_TAXONOMY_DEFAULT_CATEGORY: z.string().default("Uncategorized"),
  OPENBLOG_TAXONOMY_MAX_TAGS: z.coerce.number().int().positive().default(5),
  OPENBLOG_TAXONOMY_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300)
});

export type EnvSchema = z.infer<typeof envSchema>;

/** Variables holding credentials. Their values must never be logged or echoed. */
export const SECRET_ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENBLOG_WORDPRESS_PASSWORD",
  "OPENBLOG_WORDPRESS_APPLICATION_PASSWORD",
  "OPENBLOG_GHOST_API_KEY"
] as const satisfies readonly (keyof EnvSchema)[];
