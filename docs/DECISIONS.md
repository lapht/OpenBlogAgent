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
- Context: `GhostPublisher` builds a payload and returns success without any HTTP call.
- Decision: README, roadmap and `.env.example` mark Ghost as unsupported until it is implemented (backlog: Ghost publisher issues).

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
