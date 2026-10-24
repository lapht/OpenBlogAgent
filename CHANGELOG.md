# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Internal links: with `OPENBLOG_INTERNAL_LINKS_MAX` above 0 (default 0, off), a `find_links` step offers the writer up to that many related, live articles of the same target (word overlap of topic, keywords and outline with their title, tags, slug and category; real addresses from stored publish results), stores them with the run so `resume` and `revise` reuse them, and the quality gate rejects links to other pages of the site (`internal_link_not_offered`). `MemoryPort.listPublishedArticles`; `titleTokens` moved to `@openblog/types`.
- Enrichment of topic candidates: `topics enrich <id>` or `--top N` (and `POST /topics/{id}/enrich`) asks the model for an angle, working title, target keyword and motivation, validated and re-prompted like the other agents, and stores it on the candidate (migration v10) with its tokens and cost. Off unless asked, or `OPENBLOG_RESEARCH_ENRICH=true` for the best `OPENBLOG_RESEARCH_ENRICH_LIMIT` new candidates of a collection; `OPENBLOG_RESEARCH_MAX_COST` bounds a round; `OPENBLOG_MODEL_RESEARCH` picks the model. `topics accept --use-enrichment` (`useEnrichment` in the API) turns the proposal into brief fields. The score is unaffected.
- Webhook notifications: `OPENBLOG_NOTIFY_WEBHOOK_URL` (a secret, never logged), `OPENBLOG_NOTIFY_EVENTS` (default `awaiting_approval,needs_review,failed,budget_exceeded`; also `published`, `duplicate`, `schedule_limit_reached`), `OPENBLOG_NOTIFY_FORMAT` (`generic` JSON, `slack`, `discord`) and `OPENBLOG_NOTIFY_BASE_URL` (links `GET /runs/{id}`). One message per configured event and occurrence, sent after the outcome is stored, with up to 3 attempts; a delivery failure is logged (host and reason only) and never changes the run. New package `@openblog/notify`.
- Scheduler: `openblog schedule run-once [--collect] [--dry-run] [--json]` takes a lock (a row with owner and expiry, migration v9; stale locks are taken over), marks abandoned runs `interrupted`, optionally collects the research sources, checks `OPENBLOG_SCHEDULE_MAX_RUNS_PER_DAY`, `OPENBLOG_SCHEDULE_MAX_COST_PER_DAY` (last 24 hours, from stored runs and usage) and `OPENBLOG_SCHEDULE_ALLOWED_WINDOW`, then runs the best accepted topic candidate and marks it `used`. New exit codes `10` (nothing to do), `11` (limit reached) and `12` (locked). A `scheduler` Compose service (profile `scheduler`) loops it. The publication policy is unchanged.
- Grounded generation: a brief takes up to 5 `sources` (`--source <url>`, repeatable; `sources` in brief files and API bodies). A new `read_sources` step fetches them through the safe fetcher, extracts the main text (no dependency) and stores it, so `resume` and `revise` never fetch again. Planner and writer get it as delimited, untrusted reference material, the writer ends with a references section (`References`, `Fonti`...) and the quality gate adds `references_missing` and `reference_not_provided`. `OPENBLOG_SOURCES_ALLOW_PARTIAL`, `OPENBLOG_SOURCES_MAX_CHARS_PER_SOURCE` and `OPENBLOG_SOURCES_MAX_CHARS_TOTAL`. `topics generate` grounds the article in the candidate's page. Without sources nothing changes.
- Topic candidates from feeds and sitemaps: `openblog research collect [--json]` reads the RSS 2.0/RSS 1.0/Atom feeds and XML sitemaps (with indexes, bounded depth) listed in `OPENBLOG_RESEARCH_SOURCES_FILE` (YAML/JSON: `name`, `type`, `url`, `weight`, `include`, `exclude`) through the safe fetcher and prints normalized candidates (title, canonical URL, source, date, summary), collapses candidates (title, canonical URL, source, date, summary) across sources by URL and title. A failing or malformed source is reported per source, not thrown.
- Topic backlog: `research collect` scores each candidate (0-100: recency, source weight, keyword matches, token overlap with published or parked articles; breakdown and motivation stored) and stores it in the new `topic_candidates` table (migration v8). Collecting again does not duplicate; topics already published, awaiting approval or in review are skipped. `topics list [--status]`, `topics accept <id> [--brief ...]`, `topics drop <id> [--reason]` and `topics generate <id>` (a normal run, the candidate becomes `used`); `GET /topics`, `POST /topics/collect`, `POST /topics/{id}/accept` and `POST /topics/{id}/drop` behind the API key. `OPENBLOG_RESEARCH_AUTO_ACCEPT_MIN_SCORE` (unset: nothing is accepted without a human).
- Safe content fetcher for research (`@openblog/research`, `ContentFetcherPort`): http/https only; DNS is resolved and checked before connecting and after every redirect, and the connection goes to the checked address; loopback, private, link-local, CGNAT, multicast and metadata ranges (IPv4, IPv6, IPv4-mapped, NAT64, 6to4) are refused unless `OPENBLOG_FETCH_ALLOW_PRIVATE=true`; optional `OPENBLOG_FETCH_ALLOWED_HOSTS`; `OPENBLOG_FETCH_TIMEOUT_MS`, `_MAX_BYTES`, `_MAX_REDIRECTS`, `_USER_AGENT`; content-type allowlist; typed errors `fetch_blocked|timeout|too_large|http_error|unsupported_type|network`. Nothing uses it yet; the feed collector builds on it.
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

- `@langchain/langgraph` upgraded from 0.2.x (0.2.74 installed) to 1.5.2 (ADR-037). No behavior change; the workflow keeps its own `workflow_steps` for resume.
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
