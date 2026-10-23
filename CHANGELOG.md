# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Prompt overrides: `OPENBLOG_PROMPTS_DIR` with optional `planner.md`, `writer.md`, `editor.md`, `seo.md`, `classification.md` and `review.md` replacing each agent's instructions, with a fixed set of `{{placeholders}}` per agent (`{{topic}}`, `{{outline}}`, `{{brief.tone}}`...). Output contracts, language, brief and the writer's gate requirements stay in code. Files are validated at startup. Each step execution stores the SHA-256 of its first prompt (`workflow_steps.prompt_hash`, migration v7; `promptHash` per step in `GET /runs/{id}`). Without the variable the prompts are unchanged.
- Keyword coverage rules in the quality gate: with a brief `targetKeyword`, the SEO title, meta description, an H2 heading and the introduction must contain it, and its density must stay within `OPENBLOG_QUALITY_KEYWORD_MIN_DENSITY`/`MAX_DENSITY` (default 0.5%-3%). Violation codes `keyword_missing_in_title|meta|h2|intro` and `keyword_density_low|high` feed the regeneration feedback. No keyword, no new rules.
- Recovery of runs abandoned by a dead process: new status `interrupted` for `started`/`running` runs with no activity (run row or step) for `OPENBLOG_RUN_STALE_AFTER_MINUTES` (default 60). The server does it at startup and logs how many; the CLI does it with `list --recover-stale`, never silently. Steps are kept and `resume` accepts the run.
- Human review of stored articles: `reject <id> --reason` closes a `needs_review`/`awaiting_approval` run as `rejected` (terminal; it no longer counts as a duplicate), and `revise <id> --feedback` re-runs the writer with the reviewer's feedback and the previous version, then editor, SEO, quality gate, review, classification and publisher under the same policy and budget, updating the remote draft in place. `POST /runs/{id}/reject` and `POST /runs/{id}/revise` (queued); `GET /runs/{id}` returns the `decisions` (reason/feedback, actor, time). Stable error codes: `already_published`, `already_rejected`, `invalid_state`, `not_found`, `invalid_input`. Migration v6 adds `workflow_decisions`.
- Per-step model routing: `OPENBLOG_MODEL_PLANNER`, `_WRITER`, `_EDITOR`, `_SEO`, `_CLASSIFICATION` and `_REVIEW` (unset: the provider's model). The model the provider reports is stored per step execution (`workflow_steps.model`, migration v5) and shown by `list --json` (`models`) and `GET /runs/{id}` (`model` per step). Ollama as a fallback keeps using `OLLAMA_MODEL`.
- `npm run test:live`: opt-in smoke tests against real OpenRouter, Ollama, WordPress and Ghost (drafts only, cleaned up), skipped without `OPENBLOG_LIVE_*` variables, plus a manual-only "Live smoke tests" workflow.
- Ghost publisher using the Admin API (JWT auth, draft by default, idempotent by slug).
- Article brief: `generate` accepts `--brief <file>`, `--audience`, `--tone`, `--keyword`, `--min-words`, `--max-words`, `--notes` and `--language`, and `POST /runs` the same fields. The brief is validated (exit code 64 / HTTP 400), stored with the run, reused by `resume`, shown by `--dry-run`/`--json`, and sent to the planner, writer, editor and SEO prompts.

- Configurable content language: `OPENBLOG_CONTENT_LANGUAGE` (default `en`), overridden by the brief's `language`. The prompts state the output language, the published article carries it, slugs stay ASCII (`ß`, `ø`, `ł`... are transliterated), and the quality gate's AI-disclaimer/placeholder phrase rules apply only to their own language (`en`, `it`).

### Changed

- The writer prompt asks for the quality gate's word range (`OPENBLOG_QUALITY_MIN_WORDS`/`MAX_WORDS`, or the brief's) instead of a hard-coded 1200-1800; planner, writer, editor and SEO prompts are version 3. The language `en` was hard-coded in the published article before. `workflows.metadata_json` of new runs holds `{ "brief": ..., "force"?: true }`.
- Realigned `docs/CURRENT_STATE.md`, `plan/ROADMAP.md` and `CLAUDE.md` with the code on `main`.

## [0.2.0] - 2026-10-21 (MVP)

### Added

- CLI commands `generate`, `resume`, `approve` and `list`, with `--dry-run`, `--publisher`, `--force`, `--json` and documented exit codes (0 ok, 1 failed, 2 needs review, 3 duplicate, 64 usage).
- Persisted step results and resume of a failed run from its last good step.
- Quality gate with deterministic article validation and bounded regeneration (`needs_review`).
- Duplicate topic, slug and title policy.
- Draft-by-default publication policy and an explicit `approve` step; idempotent WordPress publishing and safe Markdown output.
- Typed providers with timeouts, retries and error classification; structured-output helper with re-prompting.
- Run-correlated structured logging (`workflowId`, `step`, `attempt`, durations) with secret redaction; `OPENBLOG_LOG_PRETTY`.
- Runnable Docker image (CLI runner, non-root, volumes) and Compose file; CI builds and smoke-tests it.
- Offline end-to-end and provider contract tests.
- Operator documentation: configuration reference, operations guide, publishing prerequisites; `npm run check:docs`.

### Changed

- The topic is now given as `generate <topic>`; `npm start` no longer rebuilds. Logs go to stderr.
- A failed or rejected publish now fails the run instead of being logged and ignored.
- Environment validation, reproducible installs, lint and format baseline in CI.

### Fixed

- Disabled TLS verification and debug logging in the OpenRouter provider.
- WordPress payload, Markdown rendering and taxonomy resolution.

### Known limitations

See `docs/CURRENT_STATE.md`: no live-service tests.

## [0.1.0] - 2026-07-03

### Added

- Monorepo foundation with apps and packages.
- Fastify server skeleton with `/health` and `/version` endpoints.
- Core contracts, dependency injection scaffold, config validation and logger.
- CI, linting, formatting, commit hooks and baseline docs.
