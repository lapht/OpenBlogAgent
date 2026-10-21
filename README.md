# OpenBlogAgent

OpenBlogAgent is a TypeScript monorepo for AI-assisted article generation.

The current milestone is intentionally narrow: one real end-to-end workflow that takes a topic, generates an outline, writes a Markdown article, and publishes it through a modular publishing engine.

## Goals

- Real workflow before extra architecture
- Minimal LangGraph-based execution
- OpenRouter as primary provider
- Ollama as optional fallback
- Markdown article output that is easy to inspect locally
- Modular publishing engine with pluggable publishers

## Current Scope

The MVP implements this flow:

```text
INPUT (topic)
-> PLANNER (outline)
-> WRITER (markdown article)
-> EDITOR (improved text)
-> SEO AGENT (metadata)
-> DUPLICATE CHECK + QUALITY GATE (bounded regeneration, otherwise needs_review)
-> CLASSIFICATION (category, tags)
-> PUBLISHER (draft by default; Markdown file or WordPress)
-> OUTPUT (output/articles/{slug}.md)
```

See [Current State](docs/CURRENT_STATE.md) for what is verified and what is not, and [Decisions](docs/DECISIONS.md) for the reasoning behind the current shape.

Included:

- CLI (`generate`, `resume`, `approve`, `list`) with `--dry-run`, `--json` and stable exit codes
- LangGraph workflow with every step's output stored, so failed runs resume
- OpenRouter provider with Ollama fallback
- Editor, SEO and classification agents; deterministic quality gate
- SQLite workflow memory (duplicate policy, resume, approval)
- Markdown and WordPress publishers; drafts first, explicit approval
- Structured logs correlated by run, with secret redaction
- Docker image and Compose file

Not included:

- dashboard (removed from the repository; see ADR-009)
- Ghost publishing (not configurable; `GhostPublisher` always fails with `not_implemented`; planned)
- plugin system, scheduler, research engine
- multi-agent orchestration

## Documentation

- [Configuration](docs/configuration.md) (every environment variable)
- [Operations](docs/operations.md) (statuses, exit codes, resume, approve, logs, backups)
- [Development Guide](docs/development.md)
- [Architecture Overview](docs/architecture.md)
- [Packages](docs/packages.md)
- [Publishing](docs/publishing.md)
- [Memory and Persistence](docs/memory.md)
- [Current State](docs/CURRENT_STATE.md)
- [Decisions](docs/DECISIONS.md)

## Monorepo Layout

```text
apps/
  server/
  cli/
packages/
  app/
  graph/
  agents/
  providers/
  storage/
  publishers/
  logger/
  shared/
  types/
  config/
docs/
docker/
scripts/
examples/
.github/
```

## Docker

The image runs the CLI (ADR-022). Data and generated articles live in named volumes, and `.env` is read if present:

```bash
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml run --rm openblog generate "Why caching matters"
```

To use the server instead: `docker run --rm -p 3000:3000 --entrypoint node openblogagent:local apps/server/dist/main.js`.

## Server Endpoints

- `GET /health`
- `GET /version`

## Workflow Overview

The workflow name is `article-generation-workflow`.

State shape:

```ts
{
  topic: string;
  outline: string[];
  article: string;
  editedText: string;
  seoOutput: SeoOutput;
  category: string;
  tags: string[];
  publishResult: PublishResult;
  workflowId?: string;
}
```

Execution steps:

1. The CLI receives a topic string.
2. The planner asks the LLM for a valid JSON array of section titles.
3. The writer asks the LLM for a full Markdown article based on that outline.
4. The editor improves the text and the SEO agent produces metadata.
5. The classification agent picks a category and tags.
6. The publisher manager sends the article to the default publisher (Markdown writes `output/articles/{slug}.md`).

## Quick Start

From a clean clone to a first draft. You need Node 20 or 22 and either an [OpenRouter](https://openrouter.ai) API key or a running [Ollama](https://ollama.com).

```bash
git clone https://github.com/lapht/OpenBlogAgent.git && cd OpenBlogAgent
npm ci
npm run build
cp .env.example .env
```

Edit `.env`: set `OPENROUTER_API_KEY` (or point `OLLAMA_BASE_URL` / `OLLAMA_MODEL` at your Ollama and leave the key unset). Everything else has a working default; see [Configuration](docs/configuration.md).

1. **Check the setup** (no LLM call, nothing written):

   ```bash
   npm start -- --help
   npm start -- list        # "No runs stored yet." on a fresh install
   ```

2. **First dry run**: runs the whole workflow with your provider but never publishes and leaves no trace in the database:

   ```bash
   npm start -- generate "Why caching matters" --dry-run
   ```

   It prints a short summary (`status: awaiting_approval`, title, slug). Add `--json` for a machine-readable summary; logs go to stderr.

3. **First draft**: the same command without `--dry-run`. With the default `draft` policy the article is written to `output/articles/{slug}.md` with `status: draft` front matter and the run is stored:

   ```bash
   npm start -- generate "Why caching matters"
   npm start -- list
   ```

4. **Publish it live** when you have read it: `npm start -- approve <workflowId>` (the id is in the summary and in `list`).

If a run ends `needs_review`, `failed` or `duplicate`, see [Operations](docs/operations.md) for what each status means and how to recover. Running in a container: see [Docker](#docker). To publish to WordPress instead of a file, see [Publishing](docs/publishing.md#wordpress-prerequisites).

## Providers

OpenRouter is used first when `OPENROUTER_API_KEY` is set; otherwise Ollama is used directly. All variables are in [Configuration](docs/configuration.md).

Provider behavior:

- Every request has a timeout (120s by default). Rate limits (429, honoring `Retry-After`), 5xx, timeouts and network errors are retried with exponential backoff and jitter (2 retries).
- Auth errors (401/402/403) and invalid responses fail immediately and do not fall back to Ollama.
- If OpenRouter is unavailable after retries, the app falls back to Ollama and logs which provider answered.
- If both fail, the command fails with a descriptive error and exit code 1.

## Command line

`openblog` (`npm start -- <command>` after `npm run build`, or the `bin` of `apps/cli`):

| Command            | What it does                                                           |
| ------------------ | ---------------------------------------------------------------------- |
| `generate <topic>` | Runs the workflow for a topic                                          |
| `resume <id>`      | Continues a failed run from its last good step                         |
| `approve <id>`     | Publishes a stored article live (`--override "reason"` if gate failed) |
| `list`             | Shows the most recent runs                                             |

Options: `--dry-run` (everything except the publish call, on a throwaway copy of the database, so nothing is stored), `--publisher <id>`, `--force`, `--json` (one summary object on stdout; logs always go to stderr), `--help`.

Exit codes: `0` ok (published, or stored and waiting for approval), `1` failed, `2` needs review, `3` duplicate, `64` usage error.

## Input

Input is a single topic string passed from the command line.

Example:

```bash
npm start -- generate "AI agents in software development"
```

Equivalent examples:

```bash
npm start -- generate "Content strategy for developer tools"
npm start -- generate "How local LLMs change technical writing workflows"
```

A topic that was already published, or an article whose slug or title already exists (stored or on the publishing target), is refused with outcome `duplicate` and exit code 3, before any LLM call in the topic case. Pass `--force` (`npm start -- generate "topic" --force`) or set `OPENBLOG_ALLOW_DUPLICATES=true` to generate it anyway; the override is recorded on the run.

### Publication policy and approval

By default (`OPENBLOG_PUBLICATION_POLICY=draft`) nothing goes live on its own: after the quality gate passes, the article is sent to the target as a draft and the run ends as `awaiting_approval` (exit code 0). Publish it live with:

```bash
npm start -- approve <workflowId>
npm start -- approve <workflowId> --override "reason"   # for an article that failed the quality gate
```

`approve` records who approved and when, publishes once, and refuses articles that are already published or did not pass the gate (unless overridden with a recorded reason). `publish_after_approval` sends nothing until `approve`; `publish_if_gate_passes` publishes live as soon as the gate passes and should be used with care.

## Output

The Markdown publisher writes `output/articles/{slug}.md` (see `OPENBLOG_OUTPUT_DIR`): YAML front matter (title, slug, description, status, category, tags, dates, author, language) followed by the article body. `status` is `draft` until the article is approved. The command prints a summary; `--json` makes it machine-readable ([Operations](docs/operations.md#scripting-with---json)).

`npm run generate -- "topic"` is a shortcut for `npm start -- generate "topic"`; both use the packages built by `npm run build`.

## Logging

Logs are Pino JSON lines on **stderr** (stdout carries only a command's result, e.g. `--json`). A failed run can be diagnosed from them alone:

- Every line written during a run carries `workflowId` (the id `resume` and `approve` take); lines inside a step also carry `step` and `attempt`.
- Each step ends with a `Step finished` line: `outcome` (`succeeded` or `failed`), `durationMs` and, on failure, `errorCode` and `error`.
- Each LLM call logs `provider`, `model`, `durationMs` and token usage when the provider reports it.
- Secrets are redacted (`apiKey`, `authorization`, `password`, `applicationPassword`, ...) and request headers are never logged. The Fastify server uses the same logger.

```bash
OPENBLOG_LOG_LEVEL=debug     # fatal | error | warn | info (default) | debug | trace
OPENBLOG_LOG_PRETTY=true     # human-readable output for development
```

## Troubleshooting

If you see an error similar to:

```text
No LLM provider available. openrouter failed: openrouter request failed with status 503. ollama failed: ollama request failed: fetch failed.
```

then one of these is true:

- OpenRouter is temporarily unavailable or rate limiting you
- Ollama is not running locally
- `OLLAMA_BASE_URL` points to the wrong host or port

To use Ollama locally, make sure the Ollama server is running before executing `npm start`. More recovery steps are in [Operations](docs/operations.md).

## Development Notes

Useful commands:

```bash
npm install
npm run build
npm start -- generate "AI agents in software development"
npm run lint
npm run test
```

## Tooling

- Node.js LTS + TypeScript
- LangGraph.js
- npm Workspaces
- Fastify
- Zod + dotenv
- Pino
- Vitest
- ESLint + Prettier
- Husky + Commitlint + lint-staged
- GitHub Actions
- Docker

## Corporate proxies and custom CAs

TLS certificate verification is always enabled. If you are behind a proxy that re-signs HTTPS traffic, point Node at your CA bundle instead of disabling verification:

```bash
NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem npm run dev
```
