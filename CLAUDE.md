# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenBlogAgent is a TypeScript npm-workspaces monorepo (`apps/*`, `packages/*`, scope `@openblog/*`) that generates a blog article from a topic and publishes it. Pipeline: Planner (outline) → Writer (Markdown) → Editor → SEO agent (metadata) → Markdown assembler → publisher. It runs as a LangGraph workflow, `article-generation-workflow`.

## Commands

Use npm (not pnpm, even though `ROADMAP_PLAN.md` mentions it).

```bash
npm install
npm run build                       # builds all workspaces in dependency order
npm start -- generate "topic here"   # run the built CLI (apps/cli/dist/index.js); does not rebuild
npm start -- list                    # also: resume <id>, approve <id>; flags --dry-run --publisher --force --json
npm run build                  # all workspaces
npm run typecheck              # tsc --noEmit per workspace
npm run lint                   # eslint . --ext .ts
npm run format                 # prettier --check (format:write to fix)
npm test                       # vitest run (tests/**/*.test.ts)
npx vitest run tests/unit/seo-agent.test.ts            # single file
npx vitest run tests/unit/publishing.test.ts -t "name" # single test by name
```

Commits must follow Conventional Commits (commitlint via husky; lint-staged runs prettier/eslint).

## Architecture

- **Build order matters.** Workspace packages depend on each other through npm workspace links (`"*"` versions) and resolve via `main: dist/index.js`. After changing a package's source, rebuild it (`npm run build`) before running the CLI. Tests are the exception: they import from `packages/*/src` directly, so no build is needed for `vitest`.
- **`packages/graph/src/workflows/article-generation-workflow.ts`** is the center of the system. It defines the LangGraph `StateGraph` (the `Annotation.Root` state and node wiring) and depends on ports (`packages/graph/src/ports.ts`), never on adapters. The state is typed per field: steps that have not run are `undefined`, each node validates its own output with the agent's Zod schema, and `run()` returns an outcome-aware `ArticleWorkflowResult` (`published` | `awaiting_approval` | `needs_review` | `duplicate` | `failed`); a `quality` node after `seo` validates the article and regenerates or parks it as `needs_review`. Adding a state field means updating the `Annotation` (and the node that produces it).
- **`packages/agents`**: one folder per agent (`planner`, `writer`, `editor`, `seo`, `classification`) with an `agent.ts`; prompts live in `prompts/` and all JSON replies go through `generateStructured` (`structured-output.ts`).
- **`packages/app`**: composition root. `createApplication(env, overrides?)` builds providers, publishers, taxonomy and memory once and returns `{ workflow, dispose }`. CLI and server only call it.
- **`packages/providers`**: `TextGenerationProvider` implementations. OpenRouter is tried first; Ollama is the fallback if OpenRouter is unconfigured or fails. If both fail, the CLI exits with a combined error.
- **`packages/publishers`**: pluggable `IPublisher` implementations (`markdown`, `wordpress`, `ghost`). `factory.ts` builds them from config. `manager.ts` (`DefaultPublisherManager`) selects the one named by `OPENBLOG_DEFAULT_PUBLISHER`. `taxonomy/` holds category and tag providers (WordPress-backed, or static) with a TTL cache. They are used for category and tag resolution.
- **`packages/config`**: env loading and a Zod schema. All runtime config is `OPENBLOG_*`, `OPENROUTER_*` and `OLLAMA_*` environment variables (see `.env.example`).
- **`types`, `logger` (Pino), `shared`, `storage`**: small shared types, logging, constants and SQLite persistence. Wiring is explicit constructor/factory injection; there is no DI container.
- **`apps/cli`** is the real entry point (`run.ts`: arguments, `createApplication`, exit code). `apps/server` is a Fastify app: public `GET /health`, `/version`, `/openapi.json`, plus `/runs` endpoints (start, list, inspect, resume, approve) behind `OPENBLOG_API_KEY` that run workflows in a bounded in-process queue; `main.ts` builds the application with `createApplication` like the CLI, and `buildServer` registers the run routes only when given an `application`.
- The top-level `src/mastra/` is an empty leftover directory. Don't build there.

TypeScript is strict CommonJS (`tsconfig.base.json`) with `noUnusedLocals`/`noUnusedParameters` on, so unused imports fail the build.

## Publication

`OPENBLOG_PUBLICATION_POLICY` defaults to `draft`: a run never produces a live post by itself. `openblog approve <workflowId> [--override "reason"]` publishes a stored article live (see ADR-021).

## Output

The markdown publisher writes `{OPENBLOG_OUTPUT_DIR}/{slug}.md` (default `output/articles/`) with YAML frontmatter (serialized with `yaml`; slug sanitized; fails with `already_exists` unless `OPENBLOG_MARKDOWN_OVERWRITE=true`). The README also mentions `output/article.md`, which is stale from an earlier phase.

## Notes

- `.env` is present locally and holds real credentials. Don't print or commit it. Use `.env.example` for documentation.
- `docs/` (architecture, packages, publishing, plugins) has more detail on package boundaries.

## Local environment

- Local Node is v22 (npm 10) managed by `fnm` (default alias 22, initialised in `~/.zshrc`), matching CI (Node 20/22). In a non-interactive shell run `eval "$(fnm env --shell bash)"; fnm use 22` first, otherwise `/usr/local/bin/node` (v18, too old for Fastify's `diagnostics_channel.tracingChannel`) is picked up.
- npm requests to the registry can stall for ~85s per batch because of broken IPv6 routing, and `npm ci` can fail with `ETIMEDOUT` on an IPv6 address. Prefix npm commands with `NODE_OPTIONS=--dns-result-order=ipv4first` (e.g. `NODE_OPTIONS=--dns-result-order=ipv4first npm ci`), which makes installs take seconds.
- Don't run `npx npm@10 ci --dry-run` here: it wiped `node_modules`. If `node_modules` is empty or `tsc: command not found`, run `npm ci`.

## Issue Workflow

When asked to implement a GitHub issue (`gh issue view <n>`), do the whole flow without asking for further confirmation, as long as there are no errors:

1. Create a branch from `main` (e.g. `ci/short-description`, `feat/...`, `fix/...`).
2. Implement, then run the relevant checks (`npm run build`, `typecheck`, `lint`, `format`, `test`).
3. Commit with a Conventional Commits message that references the issue (`Closes #<n>`).
4. Push and open the PR with `gh pr create --base main`, with `Closes #<n>` in the body.

5. Cleanup, once the PR is open and pushed: switch back to `main`, then delete the local issue branch (`git branch -d <branch>`) and remove any worktree created for it (`git worktree remove <path>`, then `git worktree prune`). Don't delete the remote branch (the PR needs it). If the branch has unpushed or unmerged work, don't force-delete it, and report that instead.

If a step fails (checks, push, PR creation), stop and report the error instead of proceeding. Never commit `.env`.

`npm ci` in CI fails if `package-lock.json` is out of sync with any workspace `package.json`. When you add or change a dependency, regenerate the lockfile (`npm install --package-lock-only --ignore-scripts`) and commit it.
