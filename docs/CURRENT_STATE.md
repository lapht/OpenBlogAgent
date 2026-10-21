# Current State

Last reviewed against `main` by static reading of the code plus a local run of build, typecheck, lint, format and the test suite. "Verified" means a test in `tests/` exercises it; "Unverified" means the code exists but nothing automated proves it works (notably anything that needs a live LLM, WordPress site or network).

## Capabilities

| Capability                                                                        | Status                 | Evidence / notes                                                                                                                                    |
| --------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo builds, typechecks, lints                                                | Verified               | CI (`.github/workflows/ci.yml`) on Node 20/22                                                                                                       |
| Env config validation (`loadEnv`)                                                 | Verified               | `tests/unit/config.test.ts`                                                                                                                         |
| LangGraph workflow (planner → writer → editor → seo → classification → publisher) | Verified               | `tests/unit/article-workflow.test.ts` (end-to-end with fake ports)                                                                                  |
| OpenRouter provider with retries                                                  | Verified               | `tests/unit/openrouter-provider.test.ts` (mocked fetch)                                                                                             |
| Ollama fallback provider                                                          | Unverified             | `packages/providers`; no tests                                                                                                                      |
| Structured LLM output (`generateStructured`): extract, validate, retry with error | Verified               | `tests/unit/structured-output.test.ts`                                                                                                              |
| SEO / editor / classification agents, planner outline                             | Verified               | `tests/unit/seo-agent.test.ts`, `planner-writer-agents.test.ts`, `structured-output.test.ts`                                                        |
| SQLite workflow memory, duplicate-topic detection                                 | Verified               | `tests/unit/memory-service.test.ts` (needs better-sqlite3 built for the running Node)                                                               |
| Markdown publisher                                                                | Verified               | `tests/unit/publishing.test.ts` (output path and front matter; file-name safety is not handled yet)                                                 |
| WordPress publisher                                                               | Verified (mocked HTTP) | `tests/integration/publishing-wordpress.test.ts`; never run against a real site                                                                     |
| WordPress taxonomy providers                                                      | Unverified             | no tests; known URL typo in `wordpress-taxonomy-provider.ts`                                                                                        |
| Ghost publisher                                                                   | Not implemented        | `GhostPublisher.publish` makes no HTTP call yet reports success                                                                                     |
| Fastify server (`/health`, `/version`)                                            | Verified               | `tests/integration/health.test.ts` (requires Node ≥ 20)                                                                                             |
| CLI                                                                               | Unverified             | `apps/cli/src/index.ts`; exit code is non-zero unless the run is `published` (`apps/cli/src/report.ts`, tested); no flags beyond the topic argument |
| Dashboard, plugin system, scheduler, research engine                              | Planned                | no code (removed scaffolding, see ADR-009); plan documents only                                                                                     |

## Known limitations

- A failed or rejected publish does not yet fail the workflow run.
- No resume of failed runs; only prompts and workflow lifecycle are stored.
- Local Node 18 cannot run `health.test.ts`; Node 20 cannot load a better-sqlite3 binary built for Node 18. CI runs on a clean install.

See the milestones in the GitHub backlog for the planned fixes.
