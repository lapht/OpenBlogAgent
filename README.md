# OpenBlogAgent

OpenBlogAgent is a TypeScript monorepo for AI-assisted article generation.

The current milestone is intentionally narrow: one real end-to-end workflow that takes a topic, generates an outline, writes a Markdown article, and saves it locally.

## Goals

- Real workflow before extra architecture
- Minimal LangGraph-based execution
- OpenRouter as primary provider
- Ollama as optional fallback
- Markdown article output that is easy to inspect locally

## Current Scope

This repository currently implements only this flow:

```text
INPUT (topic)
-> PLANNER (outline)
-> WRITER (markdown article)
-> OUTPUT (output/article.md)
```

Included in this phase:

- CLI entrypoint
- LangGraph workflow
- OpenRouter provider
- Ollama fallback provider
- Zod validation for workflow state and planner output
- Pino logging

Not included in this phase:

- dashboard
- publisher integrations
- database
- memory system
- plugin system
- multi-agent orchestration

## Monorepo Layout

```text
apps/
  server/
  dashboard/
  cli/
packages/
  core/
  graph/
  agents/
  providers/
  storage/
  publishers/
  tools/
  logger/
  shared/
  types/
  config/
  sdk/
docs/
docker/
scripts/
examples/
.github/
```

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
}
```

Execution steps:

1. The CLI receives a topic string.
2. The planner asks the LLM for a valid JSON array of section titles.
3. The writer asks the LLM for a full Markdown article based on that outline.
4. The generated article is written to `output/article.md`.

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure at least one LLM provider.

OpenRouter is the primary provider. Ollama is used as a fallback if OpenRouter is not configured or fails.

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

3. Build only the packages needed by the article workflow:

```bash
npm run build:article
```

4. Run a test article generation:

```bash
npm start "AI agents in software development"
```

5. Read the generated file:

```bash
output/article.md
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

Provider behavior:

- OpenRouter is tried first.
- If OpenRouter is unavailable or not configured, the app tries Ollama.
- If both fail, the CLI exits with a descriptive error message.

## Input

Input is a single topic string passed from the command line.

Example:

```bash
npm start "AI agents in software development"
```

Equivalent examples:

```bash
npm start "Content strategy for developer tools"
npm start "How local LLMs change technical writing workflows"
```

## Output

The workflow produces two outputs:

1. A returned in-memory result:

   ```ts
   {
     topic: string;
     article: string;
   }
   ```

2. A saved file:

   ```text
   output/article.md
   ```

The generated article is expected to include:

- a strong H1 title
- coherent H2 sections
- readable technical prose
- a practical conclusion

## Logging

Logging uses Pino JSON logs.

The workflow logs:

- workflow start
- planner output
- writer output
- workflow completion
- saved output path

Set a custom log level with:

```bash
OPENBLOG_LOG_LEVEL=debug
```

## Example Run

Command:

```bash
npm start "AI agents in software development"
```

Expected behavior:

1. The required workflow packages are built.
2. The planner generates a JSON outline.
3. The writer generates a complete Markdown article.
4. The article is saved to `output/article.md`.

## Troubleshooting

If you see an error similar to:

```text
No LLM provider available. OpenRouter failed: OPENROUTER_API_KEY is required for OpenRouterProvider. Ollama failed: fetch failed.
```

then one of these is true:

- `OPENROUTER_API_KEY` is not configured
- Ollama is not running locally
- `OLLAMA_BASE_URL` points to the wrong host or port

To use Ollama locally, make sure the Ollama server is running before executing `npm start`.

## Development Notes

Useful commands:

```bash
npm install
npm run build:article
npm start "AI agents in software development"
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
- tsyringe
- Vitest
- ESLint + Prettier
- Husky + Commitlint + lint-staged
- GitHub Actions
- Docker

## Documentation

See `docs/` for architecture, package boundaries, development and plugin notes.
