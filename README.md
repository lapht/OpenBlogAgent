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

This repository currently implements this flow:

```text
INPUT (topic)
-> PLANNER (outline)
-> WRITER (markdown article)
-> EDITOR (improved text)
-> SEO AGENT (metadata)
-> CLASSIFICATION (category, tags)
-> PUBLISHER (DefaultPublisherManager -> Markdown by default)
-> OUTPUT (output/articles/{slug}.md)
```

See [Current State](docs/CURRENT_STATE.md) for what is verified and what is not, and [Decisions](docs/DECISIONS.md) for the reasoning behind the current shape.

Included in this phase:

- CLI entrypoint
- LangGraph workflow
- OpenRouter provider
- Ollama fallback provider
- Zod validation for workflow state and planner output
- Pino logging
- Editor Agent for text improvement
- SEO Agent for metadata generation
- Classification agent for category and tags
- SQLite workflow memory (duplicate-topic detection)
- Publishing engine with Markdown and WordPress publishers

Not included in this phase:

- dashboard (removed from the repository; see ADR-009)
- Ghost publishing (not configurable; `GhostPublisher` always fails with `not_implemented`; planned)
- plugin system
- multi-agent orchestration

## Documentation

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

1. Install dependencies:

```bash
npm install
```

2. Configure at least one LLM provider.

OpenRouter is the primary provider. Ollama is used when OpenRouter is not configured, and as a fallback when OpenRouter is temporarily unavailable.

Example `.env` for OpenRouter:

```bash
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_SITE_URL=http://localhost
OPENROUTER_SITE_NAME=OpenBlogAgent
```

Example `.env` for Ollama fallback:

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1
```

Notes:

- `OPENROUTER_API_KEY` is required only if you want to use OpenRouter.
- `OPENROUTER_MODEL` defaults to `openai/gpt-4o-mini`.
- `OLLAMA_BASE_URL` defaults to `http://127.0.0.1:11434`.
- `OLLAMA_MODEL` defaults to `llama3.1`.

Example publishing settings for WordPress (dummy values only):

```bash
OPENBLOG_DEFAULT_PUBLISHER=wordpress
OPENBLOG_OUTPUT_DIR=output/articles
OPENBLOG_WORDPRESS_ENDPOINT=https://example.com/wp-json/wp/v2
OPENBLOG_WORDPRESS_USERNAME=demo_user
OPENBLOG_WORDPRESS_APPLICATION_PASSWORD=dummy_app_password
OPENBLOG_WORDPRESS_STATUS=draft
```

3. Build only the packages needed by the article workflow:

```bash
npm run build
```

4. Run a test article generation:

```bash
npm start -- generate "AI agents in software development"
```

5. Read the generated file:

```bash
output/articles/{slug}.md
```

## Runtime Configuration

The CLI reads these environment variables:

| Variable               | Required | Default                  | Purpose                          |
| ---------------------- | -------- | ------------------------ | -------------------------------- |
| `OPENROUTER_API_KEY`   | No       | none                     | OpenRouter API key               |
| `OPENROUTER_MODEL`     | No       | `openai/gpt-4o-mini`     | OpenRouter model name            |
| `OPENROUTER_SITE_URL`  | No       | none                     | Optional OpenRouter referer      |
| `OPENROUTER_SITE_NAME` | No       | none                     | Optional OpenRouter title header |
| `OLLAMA_BASE_URL`      | No       | `http://127.0.0.1:11434` | Ollama server base URL           |
| `OLLAMA_MODEL`         | No       | `llama3.1`               | Ollama model name                |

Taxonomy (categories and tags offered to the classifier when `OPENBLOG_TAXONOMY_PROVIDER=static`, the default):

| Variable                             | Default         | Purpose                                                                 |
| ------------------------------------ | --------------- | ----------------------------------------------------------------------- |
| `OPENBLOG_TAXONOMY_CATEGORIES`       | none            | Comma-separated category names                                          |
| `OPENBLOG_TAXONOMY_TAGS`             | none            | Comma-separated tag names                                               |
| `OPENBLOG_TAXONOMY_FILE`             | none            | JSON file `{ "categories": [...], "tags": [...] }`; the lists above win |
| `OPENBLOG_TAXONOMY_DEFAULT_CATEGORY` | `Uncategorized` | Only category when none is configured; used when none is chosen         |

With nothing configured the only category is the default one and there are no predefined tags.

Provider behavior:

- OpenRouter is tried first when `OPENROUTER_API_KEY` is set; otherwise Ollama is used directly.
- Every request has a timeout (120s by default). Rate limits (429, honoring `Retry-After`), 5xx, timeouts and network errors are retried with exponential backoff and jitter (2 retries).
- Auth errors (401/402/403) and invalid responses fail immediately and do not fall back to Ollama.
- If OpenRouter is unavailable after retries, the app falls back to Ollama and logs which provider answered.
- If both fail, the CLI exits with a descriptive error message.

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

The workflow produces:

- a publish result object with success/error metadata

1. A returned in-memory result:

   ```ts
   {
     topic: string;
     article: string;
     editedText: string;
     seoOutput: {
       title: string;
       metaDescription: string;
       slug: string;
       h1: string;
       headings: Array<{ level: "H2" | "H3"; text: string }>;
     }
   }
   ```

2. A saved file:

   ```text
   output/articles/{slug}.md
   ```

The file includes YAML frontmatter:

```yaml
---
title: "{seo.title}"
description: "{seo.metaDescription}"
slug: "{seo.slug}"
date: "{ISO date}"
---
```

## Generate Script

Use the `generate` script for a complete end-to-end test:

```bash
npm run build && npm run generate -- generate "AI agents in software development"
```

This command:

1. Uses the packages built by `npm run build` (the scripts no longer rebuild)
2. Runs the full workflow (Planner → Writer → Editor → SEO → Classification → Publisher)
3. Prints the output file path

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

## Example Run

Command:

```bash
npm start -- generate "AI agents in software development"
```

Expected behavior:

1. The required workflow packages are built.
2. The planner generates a JSON outline.
3. The writer generates a complete Markdown article.
4. The article is saved to `output/articles/{slug}.md`.

## Troubleshooting

If you see an error similar to:

```text
No LLM provider available. openrouter failed: openrouter request failed with status 503. ollama failed: ollama request failed: fetch failed.
```

then one of these is true:

- OpenRouter is temporarily unavailable or rate limiting you
- Ollama is not running locally
- `OLLAMA_BASE_URL` points to the wrong host or port

To use Ollama locally, make sure the Ollama server is running before executing `npm start`.

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

## Documentation

See `docs/` for architecture, package boundaries, development and plugin notes.

## Corporate proxies and custom CAs

TLS certificate verification is always enabled. If you are behind a proxy that re-signs HTTPS traffic, point Node at your CA bundle instead of disabling verification:

```bash
NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem npm run dev
```
