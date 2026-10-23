# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Ghost publisher using the Admin API (JWT auth, draft by default, idempotent by slug).

### Changed

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
