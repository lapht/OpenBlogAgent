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
