# Configuration

All runtime configuration comes from environment variables, validated at start-up by `loadEnv()` in `packages/config` (Zod). A `.env` file in the working directory is loaded automatically; copy [`.env.example`](../.env.example) to start. An invalid value stops the command with a message naming the variable (never its value).

`npm run check:docs` fails if a variable of the schema is missing from this page or from `.env.example`.

Secrets: `OPENROUTER_API_KEY`, `OPENBLOG_WORDPRESS_APPLICATION_PASSWORD`, `OPENBLOG_GHOST_ADMIN_API_KEY` and `OPENBLOG_API_KEY`. They are redacted in logs; never commit `.env`.

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

### Model per step

Each step can use its own model, for example a cheap one for classification and a stronger one for the writer. A variable left unset means the provider's default model (`OPENROUTER_MODEL`, or `OLLAMA_MODEL`), so nothing changes without them. The writer's variable also applies to its regenerations. Usage and the run budget stay shared by all steps.

| Variable                        | Default | Purpose                                                           |
| ------------------------------- | ------- | ----------------------------------------------------------------- |
| `OPENBLOG_MODEL_PLANNER`        | none    | Model of the planner (outline)                                    |
| `OPENBLOG_MODEL_WRITER`         | none    | Model of the writer                                               |
| `OPENBLOG_MODEL_EDITOR`         | none    | Model of the editor                                               |
| `OPENBLOG_MODEL_SEO`            | none    | Model of the SEO agent                                            |
| `OPENBLOG_MODEL_CLASSIFICATION` | none    | Model of the classification step                                  |
| `OPENBLOG_MODEL_REVIEW`         | none    | Model of the optional editorial review                            |
| `OPENBLOG_MODEL_RESEARCH`       | none    | Model that proposes angles for topic candidates (`topics enrich`) |

The values are OpenRouter model ids (`vendor/model`). When OpenRouter is not configured and Ollama is the provider, they are sent to Ollama as its model names. When Ollama is only the fallback for a failed OpenRouter call, the per-step value is **not** sent: Ollama uses `OLLAMA_MODEL`, because an OpenRouter id means nothing to it. The model the provider reports for each step execution is stored (`workflow_steps.model`) and shown by `list --json` (`models`, the latest model of each step) and `GET /runs/{id}` (`model` per step, plus `models`).

## Publishing

| Variable                                  | Default           | Purpose                                                                                        |
| ----------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `OPENBLOG_PUBLICATION_POLICY`             | `draft`           | `draft`, `publish_after_approval` or `publish_if_gate_passes`; see [Publishing](publishing.md) |
| `OPENBLOG_DEFAULT_PUBLISHER`              | none              | `markdown`, `wordpress` or `ghost`; `--publisher` overrides it per command                     |
| `OPENBLOG_OUTPUT_DIR`                     | `output/articles` | Where the Markdown publisher writes `{slug}.md`                                                |
| `OPENBLOG_MARKDOWN_OVERWRITE`             | `false`           | Let the Markdown publisher replace an existing file                                            |
| `OPENBLOG_WORDPRESS_ENDPOINT`             | none              | REST base URL ending in `/wp-json/wp/v2`                                                       |
| `OPENBLOG_WORDPRESS_USERNAME`             | none              | WordPress user that owns the application password                                              |
| `OPENBLOG_WORDPRESS_APPLICATION_PASSWORD` | none              | WordPress application password (secret)                                                        |
| `OPENBLOG_WORDPRESS_STATUS`               | none              | Status for direct publisher use only; the workflow sets the status from the publication policy |
| `OPENBLOG_GHOST_ENDPOINT`                 | none              | Ghost site URL, e.g. `https://blog.example.com`; setting it registers the Ghost publisher      |
| `OPENBLOG_GHOST_ADMIN_API_KEY`            | none              | Admin API key `<id>:<secret>` of a custom integration (secret)                                 |
| `OPENBLOG_GHOST_STATUS`                   | none              | Status for direct publisher use only; the workflow sets the status from the publication policy |
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

## Content language

| Variable                    | Default | Purpose                                                                                                     |
| --------------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `OPENBLOG_CONTENT_LANGUAGE` | `en`    | Language of the generated articles, a code such as `en`, `it` or `pt-BR`; a brief's `language` overrides it |

The planner, writer, editor and SEO prompts name the language explicitly, the article is published with it (`language` in the Markdown front matter), and the quality gate applies its language-specific phrase rules (AI disclaimers, leftover placeholders) only to the languages it knows (`en`, `it`); length, structure, outline and edit-ratio rules apply to every language. Slugs are always lowercase ASCII (accents are dropped). WordPress and Ghost receive no language field: their posts take the site's language. Other languages work, but without the phrase rules.

## Content fetcher

Research features (feeds, sitemaps, source pages) read external URLs only through one fetcher that cannot be turned into a proxy to internal networks (ADR-038).

| Variable                       | Default                                 | Purpose                                                                                                      |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `OPENBLOG_FETCH_ALLOW_PRIVATE` | `false`                                 | Allow loopback, private, link-local, CGNAT and metadata addresses; only for local development                |
| `OPENBLOG_FETCH_ALLOWED_HOSTS` | none                                    | Comma-separated hostnames (exact match, case-insensitive, also checked on redirects); unset: any public host |
| `OPENBLOG_FETCH_TIMEOUT_MS`    | `15000`                                 | Deadline for one fetch, redirects and body included                                                          |
| `OPENBLOG_FETCH_MAX_BYTES`     | `2000000`                               | A larger response is refused (`fetch_too_large`)                                                             |
| `OPENBLOG_FETCH_MAX_REDIRECTS` | `5`                                     | Redirects followed; each one is validated again                                                              |
| `OPENBLOG_FETCH_USER_AGENT`    | `OpenBlogAgent/<version> (+repository)` | `User-Agent` header                                                                                          |

Only `http` and `https` are fetched, never with credentials in the URL. Content types: HTML, XHTML, XML, RSS, Atom and plain text.

## Research sources

| Variable                                  | Default | Purpose                                                                                                                                                   |
| ----------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENBLOG_RESEARCH_SOURCES_FILE`          | none    | YAML or JSON file listing the feeds and sitemaps that `research collect` reads                                                                            |
| `OPENBLOG_RESEARCH_ENRICH`                | `false` | Ask the model for an angle, working title, target keyword and motivation for new candidates when they are collected (one call each)                       |
| `OPENBLOG_RESEARCH_ENRICH_LIMIT`          | `5`     | With `OPENBLOG_RESEARCH_ENRICH`, how many of the best new candidates of a collection are enriched                                                         |
| `OPENBLOG_RESEARCH_MAX_COST`              | none    | Stop enriching in one invocation (a collection, `topics enrich --top`) once the provider-reported cost in USD reaches this; separate from the run budgets |
| `OPENBLOG_RESEARCH_AUTO_ACCEPT_MIN_SCORE` | none    | Candidates scoring at least this (0-100) are accepted without a human when collected; unset: only a person accepts                                        |

```yaml
sources:
  - name: Example Blog # unique, shown in reports and on candidates
    type: feed # RSS 2.0, RSS 1.0 or Atom
    url: https://example.com/feed.xml
    weight: 1 # 0-10, default 1; the heavier source wins when two list the same article
    exclude: [sponsored] # drop entries mentioning any of these (title, summary or URL)
  - name: Docs
    type: sitemap # XML sitemap or sitemap index
    url: https://docs.example.net/sitemap.xml
    include: [guides] # keep only entries mentioning at least one of these
```

Unknown fields, duplicate names and non-http(s) URLs are rejected with the file name and every problem. All requests go through the content fetcher above, so its limits and address rules apply.

Collected candidates are scored from 0 to 100 and stored in the topic backlog (ADR-040): up to 40 points for recency (linear over 30 days, 10 when undated), up to 30 for the source weight (weight 2 or more is the maximum, the default 1 earns half), 10 per matched `include` keyword up to 20 and minus 20 per matched `exclude` keyword up to 40, and minus up to 60 for token overlap (Jaccard of the significant words) of 0.4 or more with an already published or parked article. A title identical to one of those is not stored at all. The breakdown and a one-line motivation are stored with the score. Enrichment (ADR-044) never changes the score or the order: it only adds a proposal to the candidate.

## Notifications

| Variable                      | Default                                                 | Purpose                                                                                                            |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `OPENBLOG_NOTIFY_WEBHOOK_URL` | none                                                    | Webhook posted to when a run needs a person. **A secret**: Slack and Discord put a token in the path; never logged |
| `OPENBLOG_NOTIFY_EVENTS`      | `awaiting_approval,needs_review,failed,budget_exceeded` | Comma-separated events that are sent; also `published`, `duplicate` and `schedule_limit_reached`                   |
| `OPENBLOG_NOTIFY_FORMAT`      | `generic`                                               | `generic` JSON, or a `slack` (`{ "text" }`) or `discord` (`{ "content" }`) message                                 |
| `OPENBLOG_NOTIFY_BASE_URL`    | none                                                    | Public address of the server; when set the message links `GET /runs/{id}`                                          |

Without a webhook nothing is sent. See Notifications in `docs/operations.md` and ADR-043.

## Scheduler

Used by `openblog schedule run-once` (see Scheduling in `docs/operations.md`, ADR-042).

| Variable                             | Default | Purpose                                                                                                     |
| ------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------- |
| `OPENBLOG_SCHEDULE_MAX_RUNS_PER_DAY` | none    | No run is started when this many runs were created in the last 24 hours (every run counts, manual ones too) |
| `OPENBLOG_SCHEDULE_MAX_COST_PER_DAY` | none    | No run is started when the steps finished in the last 24 hours cost this many USD, from the stored usage    |
| `OPENBLOG_SCHEDULE_ALLOWED_WINDOW`   | none    | Local time window `HH:MM-HH:MM` (it may cross midnight, e.g. `22:00-06:00`) in which a run may be started   |
| `OPENBLOG_SCHEDULE_LOCK_TTL_MINUTES` | `120`   | After this long the lock of a `run-once` whose process died is taken over; keep it above the longest run    |

## Grounded generation

| Variable                                | Default | Purpose                                                                                       |
| --------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `OPENBLOG_SOURCES_ALLOW_PARTIAL`        | `false` | A source page that cannot be read is skipped (and logged) instead of failing the run          |
| `OPENBLOG_SOURCES_MAX_CHARS_PER_SOURCE` | `6000`  | Characters of text kept from one page                                                         |
| `OPENBLOG_SOURCES_MAX_CHARS_TOTAL`      | `15000` | Characters shared by all pages of a run; each page gets an equal share, never above the limit |

A brief can name up to 5 `sources` (http or https URLs; `--source <url>`, repeatable, or `sources` in a brief file or the `POST /runs` body). The pages are read through the content fetcher (its address rules and limits apply), their main text is extracted and given to the planner and the writer as untrusted reference material, and the article ends with a references section (`References`, `Fonti`... in the article's language) linking to the sources it used. See ADR-041.

## Prompt overrides

| Variable               | Default | Purpose                                                                                                       |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `OPENBLOG_PROMPTS_DIR` | none    | Directory with optional `planner.md`, `writer.md`, `editor.md`, `seo.md`, `classification.md` and `review.md` |

A file replaces the instructions (role, style, tone) of that agent's prompt; a missing file keeps the built-in text, and without the variable nothing changes. The parts the code depends on are always added after your text and cannot be overridden: the output language, the brief fields, the JSON structure and rules the replies are parsed with, the outline and article text, and for the writer the requirements the quality gate enforces (no H1, H2 sections, the word range). The two ends of the pipeline therefore stay safe, while house style is yours. The reference material of a grounded run and the reference requirements are part of that fixed code too.

Placeholders, written `{{name}}` (unset brief fields render as nothing):

| Agent            | Placeholders                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planner`        | `{{topic}}` (required), `{{brief.language}}`, `{{brief.audience}}`, `{{brief.tone}}`, `{{brief.targetKeyword}}`, `{{brief.secondaryKeywords}}`, `{{brief.notes}}`, `{{brief.minWords}}`, `{{brief.maxWords}}` |
| `writer`         | `{{topic}}` (required), `{{outline}}` and the `brief.*` ones                                                                                                                                                  |
| `editor`         | the `brief.*` ones                                                                                                                                                                                            |
| `seo`            | `{{outline}}` and the `brief.*` ones                                                                                                                                                                          |
| `classification` | `{{maxTags}}`                                                                                                                                                                                                 |
| `review`         | `{{title}}`, `{{metaDescription}}`, `{{outline}}`                                                                                                                                                             |

The files are checked when the application is created (every CLI command and the server start): a missing directory, an unreadable or empty file, an unknown placeholder, a stray `{{` or a planner/writer file without `{{topic}}` stops it with a message naming the file, before any run. Each step execution stores the SHA-256 of the first prompt it sent (`workflow_steps.prompt_hash`, `promptHash` per step in `GET /runs/{id}`), so a run shows which text it used.

## Duplicates

| Variable                    | Default | Purpose                                                                                          |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `OPENBLOG_ALLOW_DUPLICATES` | `false` | Generate even if the topic, slug or title was already published (same as `--force` on every run) |

## HTTP API

`apps/server` serves the run endpoints described in [Operations](operations.md#http-api). They are disabled (503) until `OPENBLOG_API_KEY` is set.

| Variable                   | Default | Purpose                                                                                |
| -------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `OPENBLOG_API_KEY`         | none    | Secret every run request must present; without it the run endpoints answer 503         |
| `OPENBLOG_CORS_ORIGINS`    | none    | Comma-separated browser origins allowed to call the server; none means no CORS headers |
| `OPENBLOG_API_CONCURRENCY` | `1`     | Runs executed at the same time                                                         |
| `OPENBLOG_API_QUEUE_SIZE`  | `10`    | Runs allowed to wait for a free slot; more requests get 429                            |

| Variable                           | Default | Purpose                                                                                                            |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `OPENBLOG_RUN_STALE_AFTER_MINUTES` | `60`    | Minutes without activity (run or step written) after which a `started`/`running` run is recovered as `interrupted` |

## Editorial review

Off by default. When enabled, an article that passed the quality gate gets one more model call that scores SEO, readability, structure, completeness and repetition from 0 to 10. The overall score is the mean of the five (computed by the code, not the model). Below the minimum the run ends as `needs_review` with the violation `editorial_review_below_threshold`; nothing is published. Scores and rationale are stored with the `editorial_review` step, returned in `generate --json` (`review`) and shown by `list`. The extra call counts toward the run budget.

| Variable                    | Default | Purpose                                                  |
| --------------------------- | ------- | -------------------------------------------------------- |
| `OPENBLOG_REVIEW_ENABLED`   | `false` | Turn the editorial review on                             |
| `OPENBLOG_REVIEW_MIN_SCORE` | `7`     | Minimum overall score (0 to 10) for the article to go on |

## Run budget

Token usage (and the cost the provider reports, which OpenRouter does and Ollama does not) is stored for every step execution and summed per run; `list` shows the totals. A run that goes over a limit stops with the error code `budget_exceeded`, is stored as `failed` and exits with code 1. The limits cover the whole run including regenerations and, on `resume`, what earlier attempts already used.

| Variable                      | Default | Purpose                                                     |
| ----------------------------- | ------- | ----------------------------------------------------------- |
| `OPENBLOG_MAX_TOKENS_PER_RUN` | none    | Maximum total tokens (prompt + completion) of one run       |
| `OPENBLOG_MAX_COST_PER_RUN`   | none    | Maximum cost of one run in USD, as reported by the provider |

## Quality gate

The gate checks the finished article and regenerates it up to `OPENBLOG_QUALITY_MAX_ATTEMPTS` times; if it still fails the run ends as `needs_review` and nothing is published.

| Variable                                | Default | Purpose                                                                              |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `OPENBLOG_QUALITY_MAX_ATTEMPTS`         | `2`     | Regenerations before the run is parked as `needs_review`                             |
| `OPENBLOG_QUALITY_MIN_WORDS`            | `1000`  | Minimum word count                                                                   |
| `OPENBLOG_QUALITY_MAX_WORDS`            | `2200`  | Maximum word count                                                                   |
| `OPENBLOG_QUALITY_MIN_H2`               | `3`     | Minimum number of `##` sections                                                      |
| `OPENBLOG_QUALITY_MIN_OUTLINE_COVERAGE` | `0.6`   | Share of outline sections (0 to 1) the article must cover                            |
| `OPENBLOG_QUALITY_MIN_EDIT_RATIO`       | `0.7`   | The edited text must be at least this fraction of the written length                 |
| `OPENBLOG_QUALITY_MAX_EDIT_RATIO`       | `1.3`   | ...and at most this multiple of it                                                   |
| `OPENBLOG_QUALITY_KEYWORD_MIN_DENSITY`  | `0.005` | With a target keyword: its words must be at least this share (0 to 1) of the article |
| `OPENBLOG_QUALITY_KEYWORD_MAX_DENSITY`  | `0.03`  | ...and at most this share, above which the keyword looks stuffed                     |

When the brief has a `targetKeyword` (`--keyword`), the gate also checks that the keyword appears in the SEO title, the meta description, at least one H2 heading and the introduction (the text before the first H2), and that its density stays in that range. Matching is by whole words and ignores case and diacritics. Without a keyword none of these rules run.
