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
  /** Human-readable log output (pino-pretty) instead of JSON lines; for development. */
  OPENBLOG_LOG_PRETTY: envBoolean(false),
  OPENBLOG_MEMORY_DB_PATH: optionalString(),

  /** Key clients send (`Authorization: Bearer <key>` or `X-API-Key`) to use the run endpoints of the server. */
  OPENBLOG_API_KEY: optionalString(), // secret
  /** Comma-separated origins allowed to call the server from a browser. Unset: no cross-origin access. */
  OPENBLOG_CORS_ORIGINS: optionalString(),
  /** Runs the server executes at the same time. */
  OPENBLOG_API_CONCURRENCY: z.coerce.number().int().positive().default(1),
  /** Runs that may wait for a free slot; further requests get 429. */
  OPENBLOG_API_QUEUE_SIZE: z.coerce.number().int().min(0).default(10),

  OPENROUTER_API_KEY: optionalString(), // secret
  OPENROUTER_MODEL: optionalString(),
  OPENROUTER_SITE_URL: optionalString(),
  OPENROUTER_SITE_NAME: optionalString(),
  OLLAMA_BASE_URL: optionalString(),
  OLLAMA_MODEL: optionalString(),

  OPENBLOG_DEFAULT_PUBLISHER: optionalString(),
  OPENBLOG_OUTPUT_DIR: z.string().default("output/articles"),
  /** Let the markdown publisher replace an existing file with the same slug. */
  OPENBLOG_MARKDOWN_OVERWRITE: envBoolean(false),
  OPENBLOG_WORDPRESS_ENDPOINT: optionalString(),
  OPENBLOG_WORDPRESS_USERNAME: optionalString(),
  OPENBLOG_WORDPRESS_APPLICATION_PASSWORD: optionalString(), // secret
  /**
   * When a generated article goes live. `draft` (default): sent to the target as a draft, live only
   * after `approve`. `publish_after_approval`: kept in the store, nothing sent until `approve`.
   * `publish_if_gate_passes`: published live as soon as the quality gate passes (risky).
   */
  OPENBLOG_PUBLICATION_POLICY: z
    .enum(["draft", "publish_after_approval", "publish_if_gate_passes"])
    .default("draft"),
  /** Default WordPress status for direct publisher use; the workflow sets it from the policy. */
  OPENBLOG_WORDPRESS_STATUS: z.enum(["draft", "publish"]).optional(),
  /** When a WordPress post with the same slug exists: update it or fail with `conflict`. */
  OPENBLOG_WORDPRESS_ON_EXISTING: z.enum(["update", "conflict"]).default("update"),
  OPENBLOG_TAXONOMY_PROVIDER: z.enum(["static", "wordpress"]).default("static"),
  /** Comma-separated category names offered to the classifier (static taxonomy). */
  OPENBLOG_TAXONOMY_CATEGORIES: optionalString(),
  /** Comma-separated tag names offered to the classifier (static taxonomy). */
  OPENBLOG_TAXONOMY_TAGS: optionalString(),
  /** JSON file `{ "categories": [...], "tags": [...] }`; the lists above override it. */
  OPENBLOG_TAXONOMY_FILE: optionalString(),
  OPENBLOG_TAXONOMY_ALLOW_CREATE: envBoolean(false),
  OPENBLOG_TAXONOMY_DEFAULT_CATEGORY: z.string().default("Uncategorized"),
  OPENBLOG_TAXONOMY_MAX_TAGS: z.coerce.number().int().positive().default(5),
  OPENBLOG_TAXONOMY_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  /** Generate a topic, slug or title that was already published (same as passing `--force` on every run). */
  OPENBLOG_ALLOW_DUPLICATES: envBoolean(false),

  /** Stop a run that has used more than this many tokens (all steps and regenerations). Unset: no limit. */
  OPENBLOG_MAX_TOKENS_PER_RUN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().positive().optional()
  ),
  /** Stop a run whose provider-reported cost exceeds this many USD. Unset: no limit. */
  OPENBLOG_MAX_COST_PER_RUN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().positive().optional()
  ),

  /** Ask the model for a second, editorial opinion on articles that passed the gate. One extra call per run. */
  OPENBLOG_REVIEW_ENABLED: envBoolean(false),
  /** Articles whose overall review score (0 to 10) is below this are parked as `needs_review`. */
  OPENBLOG_REVIEW_MIN_SCORE: z.coerce.number().min(0).max(10).default(7),

  /** How many times a failing article is regenerated before it is parked as `needs_review`. */
  OPENBLOG_QUALITY_MAX_ATTEMPTS: z.coerce.number().int().min(0).default(2),
  OPENBLOG_QUALITY_MIN_WORDS: z.coerce.number().int().positive().default(1000),
  OPENBLOG_QUALITY_MAX_WORDS: z.coerce.number().int().positive().default(2200),
  OPENBLOG_QUALITY_MIN_H2: z.coerce.number().int().min(0).default(3),
  OPENBLOG_QUALITY_MIN_OUTLINE_COVERAGE: z.coerce.number().min(0).max(1).default(0.6),
  OPENBLOG_QUALITY_MIN_EDIT_RATIO: z.coerce.number().positive().default(0.7),
  OPENBLOG_QUALITY_MAX_EDIT_RATIO: z.coerce.number().positive().default(1.3)
});

export type EnvSchema = z.infer<typeof envSchema>;

/** Variables holding credentials. Their values must never be logged or echoed. */
export const SECRET_ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENBLOG_API_KEY",
  "OPENBLOG_WORDPRESS_APPLICATION_PASSWORD"
] as const satisfies readonly (keyof EnvSchema)[];
