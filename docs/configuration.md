# Configuration

All runtime configuration comes from environment variables, validated at start-up by `loadEnv()` in `packages/config` (Zod). A `.env` file in the working directory is loaded automatically; copy [`.env.example`](../.env.example) to start. An invalid value stops the command with a message naming the variable (never its value).

`npm run check:docs` fails if a variable of the schema is missing from this page or from `.env.example`.

Secrets: `OPENROUTER_API_KEY` and `OPENBLOG_WORDPRESS_APPLICATION_PASSWORD`. They are redacted in logs; never commit `.env`.

Booleans accept only `true` or `false`. An empty value (`FOO=`) counts as unset.

## Application and logging

| Variable                  | Default                   | Purpose                                                                           |
| ------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| `OPENBLOG_APP_NAME`       | `OpenBlogAgent`           | Name reported by the server's `/version`                                          |
| `OPENBLOG_ENV`            | `development`             | `development`, `test` or `production`                                             |
| `OPENBLOG_PORT`           | `3000`                    | Port of the optional HTTP server                                                  |
| `OPENBLOG_LOG_LEVEL`      | `info`                    | `fatal`, `error`, `warn`, `info`, `debug` or `trace`                              |
| `OPENBLOG_LOG_PRETTY`     | `false`                   | Human-readable logs (pino-pretty) instead of JSON lines; logs always go to stderr |
| `OPENBLOG_MEMORY_DB_PATH` | `data/openblog-memory.db` | SQLite file holding runs, steps and articles; see [Operations](operations.md)     |

## LLM providers

OpenRouter is used first when `OPENROUTER_API_KEY` is set; Ollama is used when it is not, and as the fallback when OpenRouter is unavailable (not for auth errors).

| Variable               | Default                  | Purpose                                       |
| ---------------------- | ------------------------ | --------------------------------------------- |
| `OPENROUTER_API_KEY`   | none                     | OpenRouter API key (secret)                   |
| `OPENROUTER_MODEL`     | `openai/gpt-4o-mini`     | OpenRouter model                              |
| `OPENROUTER_SITE_URL`  | none                     | Optional `HTTP-Referer` header                |
| `OPENROUTER_SITE_NAME` | none                     | Optional `X-Title` header                     |
| `OLLAMA_BASE_URL`      | `http://127.0.0.1:11434` | Ollama server (in Docker: the host's address) |
| `OLLAMA_MODEL`         | `llama3.1`               | Ollama model                                  |

## Publishing

| Variable                                  | Default           | Purpose                                                                                        |
| ----------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `OPENBLOG_PUBLICATION_POLICY`             | `draft`           | `draft`, `publish_after_approval` or `publish_if_gate_passes`; see [Publishing](publishing.md) |
| `OPENBLOG_DEFAULT_PUBLISHER`              | none              | `markdown` or `wordpress`; `--publisher` overrides it per command                              |
| `OPENBLOG_OUTPUT_DIR`                     | `output/articles` | Where the Markdown publisher writes `{slug}.md`                                                |
| `OPENBLOG_MARKDOWN_OVERWRITE`             | `false`           | Let the Markdown publisher replace an existing file                                            |
| `OPENBLOG_WORDPRESS_ENDPOINT`             | none              | REST base URL ending in `/wp-json/wp/v2`                                                       |
| `OPENBLOG_WORDPRESS_USERNAME`             | none              | WordPress user that owns the application password                                              |
| `OPENBLOG_WORDPRESS_APPLICATION_PASSWORD` | none              | WordPress application password (secret)                                                        |
| `OPENBLOG_WORDPRESS_STATUS`               | none              | Status for direct publisher use only; the workflow sets the status from the publication policy |
| `OPENBLOG_WORDPRESS_ON_EXISTING`          | `update`          | When a post with the same slug exists: `update` it or fail with `conflict`                     |

## Taxonomy (categories and tags offered to the classifier)

| Variable                              | Default         | Purpose                                                                        |
| ------------------------------------- | --------------- | ------------------------------------------------------------------------------ |
| `OPENBLOG_TAXONOMY_PROVIDER`          | `static`        | `static` (lists below) or `wordpress` (read from the site; needs the endpoint) |
| `OPENBLOG_TAXONOMY_CATEGORIES`        | none            | Comma-separated category names                                                 |
| `OPENBLOG_TAXONOMY_TAGS`              | none            | Comma-separated tag names                                                      |
| `OPENBLOG_TAXONOMY_FILE`              | none            | JSON `{ "categories": [], "tags": [] }`; the two lists above win               |
| `OPENBLOG_TAXONOMY_ALLOW_CREATE`      | `false`         | Let the WordPress provider create missing categories and tags                  |
| `OPENBLOG_TAXONOMY_DEFAULT_CATEGORY`  | `Uncategorized` | Category used when none is chosen                                              |
| `OPENBLOG_TAXONOMY_MAX_TAGS`          | `5`             | Maximum tags per article                                                       |
| `OPENBLOG_TAXONOMY_CACHE_TTL_SECONDS` | `300`           | How long WordPress taxonomy lookups are cached                                 |

## Duplicates

| Variable                    | Default | Purpose                                                                                          |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `OPENBLOG_ALLOW_DUPLICATES` | `false` | Generate even if the topic, slug or title was already published (same as `--force` on every run) |

## Quality gate

The gate checks the finished article and regenerates it up to `OPENBLOG_QUALITY_MAX_ATTEMPTS` times; if it still fails the run ends as `needs_review` and nothing is published.

| Variable                                | Default | Purpose                                                              |
| --------------------------------------- | ------- | -------------------------------------------------------------------- |
| `OPENBLOG_QUALITY_MAX_ATTEMPTS`         | `2`     | Regenerations before the run is parked as `needs_review`             |
| `OPENBLOG_QUALITY_MIN_WORDS`            | `1000`  | Minimum word count                                                   |
| `OPENBLOG_QUALITY_MAX_WORDS`            | `2200`  | Maximum word count                                                   |
| `OPENBLOG_QUALITY_MIN_H2`               | `3`     | Minimum number of `##` sections                                      |
| `OPENBLOG_QUALITY_MIN_OUTLINE_COVERAGE` | `0.6`   | Share of outline sections (0 to 1) the article must cover            |
| `OPENBLOG_QUALITY_MIN_EDIT_RATIO`       | `0.7`   | The edited text must be at least this fraction of the written length |
| `OPENBLOG_QUALITY_MAX_EDIT_RATIO`       | `1.3`   | ...and at most this multiple of it                                   |
