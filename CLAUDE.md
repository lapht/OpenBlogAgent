# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenBlogAgent is a TypeScript npm-workspaces monorepo (`apps/*`, `packages/*`, scope `@openblog/*`) that generates a blog article from a topic and publishes it. Pipeline: Planner (outline) → Writer (Markdown) → Editor → SEO agent (metadata) → Markdown assembler → publisher. It runs as a LangGraph workflow, `article-generation-workflow`.

## Commands

Use npm (not pnpm, even though `ROADMAP_PLAN.md` mentions it).

```bash
npm install
npm run build                       # builds all workspaces in dependency order
npm start "topic here"         # build + run CLI (apps/cli/dist/index.js)
npm run generate -- "topic"    # same as start
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
- **`packages/graph/src/workflows/article-generation-workflow.ts`** is the center of the system. It defines the LangGraph `StateGraph` (the `Annotation.Root` state, the planner/writer prompts, and node wiring) and a Zod `articleWorkflowStateSchema`. Graph state defaults (e.g. `seoOutput` starting as an empty object) must stay compatible with that Zod schema, which is why it accepts an empty passthrough object. Adding a state field means updating both the `Annotation` and the schema.
- **`packages/agents`**: one folder per agent (`planner`, `writer`, `editor`, `seo`, `classification`, plus scaffolds `research`, `memory`, `analytics`, `publisher`). Real agents have `agent.ts` + `interfaces.ts`. Several of the others are interface-only stubs.
- **`packages/providers`**: `TextGenerationProvider` implementations. OpenRouter is tried first; Ollama is the fallback if OpenRouter is unconfigured or fails. If both fail, the CLI exits with a combined error.
- **`packages/publishers`**: pluggable `IPublisher` implementations (`markdown`, `wordpress`, `ghost`). `factory.ts` builds them from config. `manager.ts` (`DefaultPublisherManager`) selects the one named by `OPENBLOG_DEFAULT_PUBLISHER`. `taxonomy/` holds category and tag providers (WordPress-backed, or static) with a TTL cache. They are used for category and tag resolution.
- **`packages/config`**: env loading and a Zod schema. All runtime config is `OPENBLOG_*`, `OPENROUTER_*` and `OLLAMA_*` environment variables (see `.env.example`).
- **`packages/core`, `sdk`, `types`, `logger` (Pino), `shared`, `tools`, `storage`**: contracts, DI (tsyringe) and utilities.
- **`apps/cli`** is the real entry point. `apps/server` is a Fastify app that only exposes `GET /health` and `GET /version`. `apps/dashboard` is a placeholder.
- The top-level `src/mastra/` is an empty leftover directory. Don't build there.

TypeScript is strict CommonJS (`tsconfig.base.json`) with `noUnusedLocals`/`noUnusedParameters` on, so unused imports fail the build.

## Output

The markdown publisher writes `{OPENBLOG_OUTPUT_DIR}/{slug}.md` (default `output/articles/`) with YAML frontmatter (title, description, slug, date). The README also mentions `output/article.md`, which is stale from an earlier phase.

## Notes

- `.env` is present locally and holds real credentials. Don't print or commit it. Use `.env.example` for documentation.
- `docs/` (architecture, packages, publishing, plugins) has more detail on package boundaries.

## Local environment

- The local Node is v18 and npm 9, while CI uses Node 20/22. `EBADENGINE` warnings are expected.
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
