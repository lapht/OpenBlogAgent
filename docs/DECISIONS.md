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

## ADR-011: A run is `published` only when the publisher confirms

- Status: accepted (2026-10-21)
- Context: the workflow never checked `publishResult.success`, so a failed publish was stored as `completed`, the CLI logged `Article saved` and exited 0.
- Decision: `ArticleWorkflowResult.status` is `published | needs_review | failed` and `failure` carries `{ step, code, message }`. A failed or missing publish result yields `failed` with the publisher's error code. Persisted statuses are `started -> running -> published | needs_review | failed` with `failed_step` and `error_code` columns. `finishWorkflow` stores the article even when publishing failed. A throwing step raises `WorkflowStepError` (step, code) and is stored via `failWorkflow`. The CLI exits non-zero unless the status is `published`.
- Consequence: `needs_review` is only defined, not produced (quality-gate issue). Old `completed` rows are not migrated.
