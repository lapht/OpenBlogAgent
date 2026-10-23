# Development Guide

## Commands

- `npm ci`
- `npm run build` (tests that use the composition root resolve `@openblog/*` through `dist`, so build before `npm test`)
- `npm run typecheck`
- `npm run lint`
- `npm run format`
- `npm test` (offline: no network or API keys needed; `tests/e2e` runs the whole workflow with fakes)
- `npm run check:deps` and `npm run check:docs` (docs match the env schema, links resolve)

## Live smoke tests

`npm run test:live` runs `tests/live/*.live.ts` against real services with `vitest.live.config.ts`. It is not part of `npm test` or coverage, and with no variable set every suite is skipped and the command exits 0. It only reads `OPENBLOG_LIVE_*` variables (not `.env` or the regular `OPENROUTER_*` ones), so real credentials are never used by accident; use a test site.

| Suite      | Runs when set                                                                                                                      | Cost and cleanup                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| OpenRouter | `OPENBLOG_LIVE_OPENROUTER_API_KEY` (optional `OPENBLOG_LIVE_OPENROUTER_MODEL`, `OPENBLOG_LIVE_MAX_COST_PER_RUN`, default 0.01 USD) | One 16-token call; fails if the reported cost exceeds the ceiling                                            |
| Ollama     | `OPENBLOG_LIVE_OLLAMA_BASE_URL` and a reachable server (optional `OPENBLOG_LIVE_OLLAMA_MODEL`)                                     | Local, free; skipped when the server does not answer                                                         |
| WordPress  | `OPENBLOG_LIVE_WORDPRESS_ENDPOINT`, `OPENBLOG_LIVE_WORDPRESS_USERNAME`, `OPENBLOG_LIVE_WORDPRESS_APPLICATION_PASSWORD`             | Publishes a **draft**, finds it, updates it, then deletes it (by id and by slug); no terms are created       |
| Ghost      | `OPENBLOG_LIVE_GHOST_ENDPOINT`, `OPENBLOG_LIVE_GHOST_ADMIN_API_KEY`                                                                | Publishes a **draft**, finds it, updates it, then deletes it by slug; may leave the tag `openblog-live-test` |

Posts use a `openblog-live-test-<time>` slug and are always drafts. The "Live smoke tests" GitHub Actions workflow (`workflow_dispatch` only, never on pull requests) runs the same command with repository secrets named like the variables above (the optional model, ceiling and Ollama model are repository variables).

## Local API

The server app exposes:

- `GET /health`
- `GET /version`

Run locally with `npm run dev`.

## Further Reading

- [Architecture Overview](architecture.md)
- [Configuration](configuration.md)
- [Operations](operations.md)
- [Packages](packages.md)
- [Publishing](publishing.md)
- [Memory and Persistence](memory.md)
