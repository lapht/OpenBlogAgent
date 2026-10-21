# Decisions

ADR-style log. Add new entries at the bottom; do not rewrite accepted ones, supersede them.

## ADR-001: Configuration is validated in one place

- Status: accepted
- Context: env vars were read directly from `process.env` in several places and booleans were coerced incorrectly.
- Decision: `packages/config` (`loadEnv`) is the only reader of configuration; apps use the parsed object. Booleans accept only `true`/`false`; taxonomy creation defaults to off.
- Consequence: every new variable must be added to the schema and `.env.example`.

## ADR-002: WordPress endpoint is the REST base URL

- Status: accepted
- Decision: `OPENBLOG_WORDPRESS_ENDPOINT` is `https://site/wp-json/wp/v2` without `/posts`; the publisher appends resource paths.

## ADR-003: Ghost is documented as not implemented

- Status: accepted
- Context: `GhostPublisher` built a payload and returned success without any HTTP call.
- Decision: Ghost is removed from the factory, env schema, `.env.example` and README until it is implemented (Post-MVP). The class stays only as a placeholder whose `publish` fails with `not_implemented`, so no publisher can claim success without doing the work.

## ADR-004: Tests assert real behavior against current contracts

- Status: accepted
- Decision: the suite must be green in CI, must not depend on `console` output, and WordPress tests use injected taxonomy fakes. Coverage is reported in CI without a threshold.

## ADR-005: `graphify-out/` is not tracked in git

- Status: accepted
- Context: `graphify-out/` is 1.5 MB of generated graph data (cache, `graph.json`, `graph.html`, report) committed without explanation. It goes stale on every change.
- Decision: untrack it and add it to `.gitignore`. Anyone who wants it regenerates it locally with `graphify`.

## ADR-006: `.github/copilot-instructions.md` is kept, but Graphify is optional

- Status: accepted
- Context: the file made Graphify mandatory for architecture questions, which no longer works when `graphify-out/` is absent.
- Decision: keep the file for Copilot users and reword the Graphify section as optional ("when `graphify-out/graph.json` exists locally"). `CLAUDE.md` remains the primary instruction file.

## ADR-007: Markdown assembler is not part of the workflow

- Status: accepted
- Decision: the workflow publishes through `DefaultPublisherManager`; `createMarkdownAssembler` is unused scaffolding and is a candidate for removal in the scaffolding cleanup issue.

## ADR-008: LLM JSON replies go through one validated helper with retry

- Status: accepted
- Context: JSON extraction was copy-pasted in three agents plus the planner, malformed replies aborted the run, and normalization (slice, empty-string defaults) hid invalid output.
- Decision: `generateStructured` (`packages/agents/src/structured-output.ts`) extracts JSON, validates with Zod and re-prompts with the validation error (default 3 attempts, `maxAttempts` per agent), then throws `StructuredOutputError` with the truncated last reply. Schemas only do safe normalization (trim, slugify, tag de-dup/cap, category canonicalization) and reject empty slug/title/h1, over-long title/description and categories outside the allowed list.
- Consequence: no silent truncation; a model that keeps violating limits fails the run with a descriptive error. Provider failures (`ProviderError`) are not retried here, ADR for providers covers them.

## ADR-009: Remove unused scaffolding; wire dependencies explicitly

- Status: accepted (2026-10-21)
- Context: the repository carried empty marker interfaces, tool stubs, a tsyringe container nothing imported and duplicate `ILogger`/`IPublisher` contracts.
- Decision: removed `@openblog/core` (interfaces and DI container, plus `tsyringe`/`reflect-metadata`), `@openblog/tools` (stubs and the unused Markdown assembler, which supersedes the note in ADR-007), `@openblog/sdk` (re-export barrel with no consumers), `apps/dashboard` (one-line stub), the empty agent folders (`planner`, `writer`, `research`, `publisher`, `memory`, `analytics`) and the `IAgent` aliases in `seo`/`editor`, the placeholder `Node`/`Edge`/`Workflow` types in `@openblog/graph`, and the unused `OpenBlogError`/`isNonEmptyString`/`KeyValue` in `@openblog/shared`.
- Kept: `@openblog/shared` (only the constants the server uses) and `@openblog/types` (only `Identifier`, used by storage and publishers). A ts-prune pass also removed the unused `VersionInfo`/`Environment` types and the storage `ICacheStore`/`IMemoryStore` stubs. `ILogger` lives only in `@openblog/logger` and `IPublisher` only in `@openblog/publishers`.
- Decision: dependencies are wired with explicit constructors and factory functions; no DI container.
- Consequence: re-introduce a package (plugin SDK, dashboard, research tools) only together with working code that uses it.

## ADR-010: The workflow depends on ports; agents own prompts

- Status: accepted (2026-10-21)
- Context: the workflow file embedded the planner/writer prompts and parser, built `DefaultPublisherManager` itself and redefined the memory contract.
- Decision: `@openblog/graph` only orchestrates. It defines ports in `packages/graph/src/ports.ts` (`LlmPort`, `PublishPort`, `TaxonomyPort`, `MemoryPort`) and `createArticleGenerationWorkflow` receives them (`llm`, `publisher`, `taxonomy`, `memory`). The CLI is the bootstrap: it builds `DefaultPublisherManager`, the taxonomy adapter and the memory service. Planner and writer are agents like the others; all prompts live in `packages/agents/src/prompts/*` with a `*_PROMPT_VERSION` constant.
- Consequence: graph imports only types from adapter packages; the workflow is tested end-to-end with fakes. Bump the version constant when a prompt changes.

## ADR-011: One composition root builds the application from config

- Status: accepted (2026-10-21)
- Context: the CLI built providers, publishers, taxonomy and the workflow itself; WordPress taxonomy providers were created twice and default categories/tags were hard-coded.
- Decision: `createApplication(config, overrides?)` in `packages/app` is the only place adapters are constructed. It returns `{ workflow, info, dispose }`; `overrides` replace adapters in tests. WordPress taxonomy providers are built once and shared by the publisher and the classifier. Static categories/tags come from `OPENBLOG_TAXONOMY_CATEGORIES`/`_TAGS` or `OPENBLOG_TAXONOMY_FILE` (lists win over the file); with nothing configured the only category is `OPENBLOG_TAXONOMY_DEFAULT_CATEGORY`.
- Consequence: the CLI (`runCli`) only handles arguments and exit codes, and the server can build the same application (`buildServer({ application })`). The previous built-in category/tag lists are gone: set the variables to restore a taxonomy.

## ADR-012: A run is `published` only when the publisher confirms

- Status: accepted (2026-10-21)
- Context: the workflow never checked `publishResult.success`, so a failed publish was stored as `completed`, the CLI logged `Article saved` and exited 0.
- Decision: `ArticleWorkflowResult.status` is `published | needs_review | failed` and `failure` carries `{ step, code, message }`. A failed or missing publish result yields `failed` with the publisher's error code. Persisted statuses are `started -> running -> published | needs_review | failed` with `failed_step` and `error_code` columns. `finishWorkflow` stores the article even when publishing failed. A throwing step raises `WorkflowStepError` (step, code) and is stored via `failWorkflow`. The CLI exits non-zero unless the status is `published`.
- Consequence: `needs_review` is only defined, not produced (quality-gate issue). Old `completed` rows are not migrated.

## ADR-013: Workflow state is typed per step and validated where it is produced

- Status: accepted (2026-10-21)
- Context: every node re-parsed the whole state and cast it back, `seoOutput`/`publishResult` were `unknown`, an empty passthrough schema existed only to admit the initial `{}`, and empty strings stood for "not produced yet".
- Decision: the `Annotation` fields are typed (`SeoOutput | undefined`, `PublishResult | undefined`, ...) and a node's return type is checked against the state update. Each node validates its output with the Zod schema of its agent. `currentArticle(state)` returns the edited text once it exists. `run()` takes `{ topic }` and returns `ArticleWorkflowResult`, a union of `published` (with a confirmed `publishResult`) and `failed`.
- Consequence: `articleWorkflowStateSchema` and the empty-object workaround are gone. A missing field after a step is a wiring bug and throws.

## ADR-014: Storage is versioned, transactional and keeps step artifacts

- Status: accepted (2026-10-21)
- Context: the DB directory was never created, multi-statement operations were not atomic, the schema was a single `CREATE TABLE IF NOT EXISTS` block, outputs of intermediate steps were lost, and a failed first run counted as the original of a duplicate.
- Decision: the connection creates the DB directory; `data/` and `*.db*` are git-ignored. Migrations are an ordered list applied under `BEGIN IMMEDIATE` and tracked with `PRAGMA user_version` (v1 is the original schema and adopts unversioned databases; v2 adds `workflow_steps` and `articles.publish_remote_{id,url,status}`). Repositories are synchronous; `MemoryService` wraps `beginWorkflow` and `finishWorkflow` in one transaction. Each workflow step execution is stored in `workflow_steps` (output or error, attempt number) through `MemoryPort.recordStep`; a recording failure only logs a warning. Duplicates are detected against published runs only.
- Consequence: never edit a released migration, append one. `topics.first_workflow_id` is informational. Resuming runs from stored steps is a later issue.

## ADR-015: Resume uses our own `workflow_steps`, not a LangGraph checkpointer

- Status: accepted (2026-10-21)
- Context: a failed run discarded its generated content, so a retry paid for planner and writer again. LangGraph offers checkpointers (e.g. a SQLite saver) that snapshot graph state per super-step.
- Decision: keep `workflow_steps` (ADR-014) as the only checkpoint. Every node stores its output through `MemoryPort.recordStep` before the next one starts. `workflow.resume(workflowId)` loads the run with `MemoryPort.loadWorkflow`, validates the latest successful output of each step with the same Zod schemas the nodes use, seeds the graph state with them and marks those steps as completed so their nodes are skipped. The failed step is executed again with the next attempt number. A publish the publisher rejected is not a completed step, so it is retried. Resuming a `published` run, an unknown id, or without a memory store throws `WorkflowResumeError` and changes nothing.
- Consequence: SQLite stays the single store and the checkpoint format is our own JSON, reviewable in SQL; there is no dependency on a LangGraph checkpoint package. Resume is a workflow API only; the CLI flag is a separate issue. A step whose output schema changes between versions fails validation on resume instead of being silently reused.

## ADR-016: WordPress publisher sends sanitized HTML and supports Application Passwords only

- Context: the publisher posted raw Markdown, dropped the slug, ignored the response and accepted a regular password that the core REST API rejects.
- Decision: Markdown is converted with `marked` and sanitized with `sanitize-html` before it is sent. The endpoint must end in `/wp-json/wp/v2` (trailing slashes and `/posts` are stripped). Authentication is Basic with an Application Password; `OPENBLOG_WORDPRESS_PASSWORD` is removed. The post `id`, `link`, `status` and `slug` are parsed with Zod and returned in `PublishResult.metadata`; requests time out after 15s by default and failures carry a classified error code.

## ADR-017: WordPress taxonomy resolution policy

- Context: term creation hit an invalid URL, the cache "invalidation" returned an empty list, only the first 100 terms were read, and the category fallback/creation order was undocumented.
- Decision: an unknown category resolves to `OPENBLOG_TAXONOMY_DEFAULT_CATEGORY` and is never created (resolution fails if the default does not exist either). An unknown tag is created only when `OPENBLOG_TAXONOMY_ALLOW_CREATE=true`, otherwise it is skipped with a warning. Names are matched trimmed, case-insensitive and HTML-entity-decoded; tags are de-duplicated and capped at `OPENBLOG_TAXONOMY_MAX_TAGS`. Terms are read across all pages (`X-WP-TotalPages`), and a created term is added to the cache so later lookups in the same run neither re-create nor lose it. One provider pair per site is built in `createApplication`.

## ADR-018: Content validation is a pure rule module with configurable thresholds

- Context: nothing checked the length, structure or sanity of generated output before publication.
- Decision: `validateArticle(input, rules)` in `packages/agents/src/quality` returns `{ passed, violations[] }` with no I/O and no LLM calls. Each violation has a `code`, a `severity` (`error` fails the article, `warning` does not) and a message that is reused in regeneration prompts (`formatViolations`). Rules whose input is absent are skipped. Defaults (`DEFAULT_ARTICLE_RULES`): 1000-2200 words (the writer prompt asks 1200-1800; the range tolerates model drift), at least 3 H2 sections, no H1, 60% outline coverage by H2 headings (half of an item's significant words must appear), balanced code fences, no placeholder or AI-disclaimer phrases (`forbiddenPatterns`), edited/draft word ratio between 0.7 and 1.3, title <= 60, meta description <= 155, valid slug, no repeated paragraph of 8+ words. Code blocks are excluded from heading, placeholder and repetition checks.
- Consequence: thresholds are overridden by passing a partial rules object; wiring them to environment variables and to the workflow is a separate issue.

## ADR-019: Quality gate with bounded regeneration

- Context: the graph was a straight line, so any output was published.
- Decision: a `quality` node runs after `seo` and calls `validateArticle` (ADR-018) on the edited text, the writer draft, the outline and the SEO output. If it passes, the run goes on to classification and the publisher. If it fails and fewer than `OPENBLOG_QUALITY_MAX_ATTEMPTS` (default 2) regenerations were done, a `regenerate` node adds the violations to the writer prompt and the writer, editor, seo and quality nodes run again. Otherwise the article is still classified (so it is complete for a later review), stored with status `needs_review`, and the publisher is skipped. `max attempts` counts regenerations, so the worst case is 1 + N writer/editor/seo rounds. LLM calls and tokens are counted per run (AsyncLocalStorage around the tracked provider) and logged with every decision.
- Consequence: `ArticleWorkflowResult` gains `needs_review` (with `violations`); the CLI exits non-zero for it. `resume` re-runs the check of a `needs_review` run (the gate result is not restored). Thresholds are `OPENBLOG_QUALITY_*` environment variables; tests that are not about the gate pass lenient rules.

## ADR-020: Duplicates are blocked by default and allowed with `force`

- Context: a repeated topic only logged a warning and the run spent tokens and published again; different topics could produce the same slug or title.
- Decision: two checks. (1) `run()` stops right after `beginWorkflow` when a _published_ run exists for the normalized topic: outcome `duplicate`, zero provider calls, the run is stored with status `duplicate`, `is_duplicate = 1` and `duplicate_of_workflow_id`. (2) A `duplicate_check` node after `seo` looks the slug and title (case-insensitive) up in the stored articles of published or `needs_review` runs of other workflows, then asks the publisher (`findExisting`: WordPress searches the slug in any status, the markdown publisher looks for the file unless overwriting is enabled). A match ends the run as `duplicate` (`duplicate_slug`, `duplicate_title`, `duplicate_remote`); a lookup failure fails the step. `force` (`run({ force: true })`, CLI `--force`, or `OPENBLOG_ALLOW_DUPLICATES=true`) skips both stops, logs a warning and is stored in the run metadata (`{"force": true}`) and in the `duplicate_check` step output.
- Consequence: the CLI exits 3 for `duplicate` (ADR-023). Failed and parked runs never count as the original topic. `resume(id, { force })` re-runs the slug check. Semantic similarity is out of scope.

## ADR-021: Draft-by-default publication and an explicit `approve` step

- Context: only `OPENBLOG_WORDPRESS_STATUS` stood between model output and a live post, and a stored article could not be reviewed and published later.
- Decision: `OPENBLOG_PUBLICATION_POLICY` is `draft` (default), `publish_after_approval` or `publish_if_gate_passes`. After the quality gate passes: `draft` sends the article to the target with `status: "draft"` (WordPress draft; a markdown file with `status: draft`), `publish_after_approval` sends nothing, and only `publish_if_gate_passes` sends `status: "publish"`. The first two end the run as `awaiting_approval` (exit code 0, the log shows `approve <workflowId>`); a gate failure is `needs_review` under every policy and nothing is sent. `PublishArticle.status` wins over a publisher's own configured status, so `OPENBLOG_WORDPRESS_STATUS` only matters for direct publisher use. Articles carry a `review_state` (`needs_review` -> `approved` -> `published`), `gate_passed`, `approved_by`, `approved_at` and `approval_override_reason` (migration v3). `npm start -- approve <workflowId> [--override "reason"]` (`workflow.approve`) refuses unknown and already published articles, refuses an article that did not pass the gate (or whose gate result is unknown) unless an override reason is given, records the approver (OS user) and time, then publishes with `status: "publish"` through the idempotent publisher. A failed publish leaves the article `approved` so approving again retries it; a published one cannot be approved again. A markdown file is replaced by the live version only when it is the draft this publisher wrote.
- Consequence: `awaiting_approval` runs count as the original of a topic and their articles as slug/title collisions (ADR-020). `publish_if_gate_passes` is the only way a run publishes live on its own and is documented as risky. There is no command to list pending articles yet; the id is logged at the end of the run.

## ADR-022: The Docker image is a CLI runner

- Context: the image ran only the Fastify server (`/health`, `/version`), which cannot generate an article, and was not runnable: the runner stage copied `node_modules` but not `packages/*`, so the `@openblog/*` workspace links dangled. It also ran as root, used `npm install`, shipped dev dependencies and had no volumes.
- Decision: for the MVP the image's job is to run the CLI (`ENTRYPOINT node apps/cli/dist/index.js`); the server stays in the image (`--entrypoint node ... apps/server/dist/main.js`) but is not the default. Two-stage build on `node:20-bookworm-slim` (glibc, so `better-sqlite3` uses its prebuilt binary; Alpine would need a compiler): `npm ci`, `npm run build`, `npm prune --omit=dev`, then `apps/`, `packages/` and `node_modules` are copied so the workspace links resolve. Runs as the unprivileged `node` user. `OPENBLOG_MEMORY_DB_PATH` and `OPENBLOG_OUTPUT_DIR` default to `/app/data` and `/app/output/articles`, declared as volumes. No `HEALTHCHECK`, because a one-shot CLI has nothing to probe; add one when a server container is supported.
- Compose: `docker/docker-compose.yml` defines one `openblog` service with named volumes for data and output, an optional `../.env`, `restart: "no"` (a run ends by itself) and `host.docker.internal` so Ollama on the host is reachable.
- Consequence: CI builds the image and smoke-tests module resolution, the non-root user and volume persistence (`docker` job). Publishing images to a registry and Kubernetes are out of scope.

## ADR-023: CLI commands, flags and exit codes

- Context: the topic came from `process.argv` or the deprecated `npm_config_argv`, `start` rebuilt before every run, and exit codes were ad hoc.
- Decision: `node:util` `parseArgs` (no dependency) with commands `generate <topic>`, `resume <id>`, `approve <id>`, `list` and flags `--dry-run`, `--publisher`, `--force`, `--json`, `--override`, `--help`. Exit codes: 0 ok (published or awaiting approval), 1 failed (including thrown errors), 2 needs review, 3 duplicate, 64 usage. `--json` prints one summary object on stdout (`CliSummary` in `apps/cli/src/report.ts`; fields are only added); the default logger now writes to stderr so stdout carries only the result. `--dry-run` runs against a temporary copy of the SQLite database with a stand-in publisher that accepts everything: earlier runs are visible (duplicates, resume, approve) but nothing is stored, written or sent. `--publisher` overrides `OPENBLOG_DEFAULT_PUBLISHER` for the command. `apps/cli` has a `bin` entry (`openblog`); `start` and `generate` scripts no longer build.
- Consequence: `npm start -- <command>` needs a prior `npm run build`. Dry runs skip the remote duplicate lookup of the publisher. `list` shows the last 20 runs.

## ADR-024: Run-correlated structured logging with redaction

- Context: log lines were not tied to a run or step, failures lost context, Fastify had its own logger configuration, and nothing redacted secrets.
- Decision: the logger package keeps one pino configuration (`createPinoLogger`) with `redact` for known secret keys (top level and two levels down; `headers` is redacted wholesale) and `req`/`res` serializers that omit headers. Correlation uses `AsyncLocalStorage` (`withLogContext`), the same mechanism as LLM usage tracking: the workflow wraps `run`, `resume` and `approve` in a scope with `workflowId` (a throwaway UUID when there is no memory store) and each step in a scope with `step` and `attempt` (continuing the stored attempt count on resume). Everything logged inside, including provider retries that only know the shared logger, carries those fields; `withScope` gives any injected `ILogger` the same behavior, so no `child()` is needed on the interface. Steps log `Step finished` with `outcome` and `durationMs`; LLM calls log `LLM call completed` with provider, model, duration and tokens. Output goes to stderr; the shared logger is built on first use (so `.env` is loaded) and honors `OPENBLOG_LOG_LEVEL` and `OPENBLOG_LOG_PRETTY` (pino-pretty). Fastify receives the shared pino instance (`loggerInstance`).
- Consequence: redaction is key-based: a secret embedded in a free-text message is not caught (providers already sanitize error bodies). Metrics, tracing and log shipping stay out of scope.

## ADR-025: Documentation is checked against the code

- Context: the docs described intended structure, drifted from the code, and listed environment variables nobody could verify.
- Decision: `docs/configuration.md` documents every variable of the Zod env schema and `.env.example` lists each one; `scripts/check-docs.mjs` (`npm run check:docs`, run in CI after the build) reads the built schema and fails when a variable is missing from either, and fails on any broken relative link in `README.md` and `docs/`. The MVP is released as `0.2.0` (root `package.json` and tag `v0.2.0`; workspace packages stay private at `0.1.0`).
- Consequence: adding a variable requires documenting it in the same change. External links are not checked.

## ADR-026: Token usage per step and a per-run budget

- Context: the provider returned token counts but nothing stored them, so operators could not tell what an article cost or cap spending.
- Decision: the tracked LLM (`trackUsage`) adds prompt, completion and total tokens, call count and the provider-reported `cost` (OpenRouter, requested with `usage.include`) to the run's counter. Every step execution stores the difference it caused in new `workflow_steps` columns (migration v4), failed executions included. `list` sums them per run. `OPENBLOG_MAX_TOKENS_PER_RUN` and `OPENBLOG_MAX_COST_PER_RUN` set the budget: it is checked before every call and after every call, and throws `BudgetExceededError` (code `budget_exceeded`), so the step and the run fail with that code. On `resume` the stored usage of earlier executions is the starting point, so the budget covers the whole run.
- Consequence: cost comes only from what the provider reports (no price catalogs); with Ollama only the token limit applies. A call that crosses the limit has already been paid for, and its result is discarded. Steps stored before this change have no usage and count as zero.

## ADR-027: Optional LLM editorial review

- Context: the deterministic gate (ADR-018) only catches objective problems; judging SEO fit, readability or repetition needs a model, which costs money and has to be calibrated.
- Decision: an `editorial_review` node runs after `quality` only when `OPENBLOG_REVIEW_ENABLED=true` and the article passed the gate. The reviewer returns a 0 to 10 score for seo, readability, structure, completeness and repetition plus a rationale (through `generateStructured`); the overall score is the mean, computed in code. Below `OPENBLOG_REVIEW_MIN_SCORE` (default 7) the node sets `qualityPassed=false` and adds the error violation `editorial_review_below_threshold`, so the run ends as `needs_review` through the normal path and is not regenerated. The review is stored as a step output, so `list` and `--json` read it from there and `resume` re-runs a failed review. The node is not named `review` because LangGraph forbids a node with the name of a state channel.
- Consequence: when off, nothing changes and nothing is spent. A low score is not retried: regenerating on a subjective score could loop and spend without bound. The threshold is calibrated against stored fixtures with a fake provider only; tuning it against a real model is left to the operator.
