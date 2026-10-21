# OpenBlogAgent — Origin, Historical Context and Expectations

## 1. How the project originated

OpenBlogAgent was developed iteratively with multiple AI coding tools, including free or low-cost models.

The objective was to build an AI-powered editorial automation system. The implementation evolved through AI-assisted development rather than through a single, fully validated architectural design.

Treat the current repository as an inherited codebase that requires an evidence-based technical assessment.

The quality of the existing code is unknown until it has been inspected and tested. Do not presume that earlier architectural choices, generated code, tests or documentation are correct.

## 2. Previously recorded technology stack

The following technologies have been associated with the project in historical notes:

- Node.js and TypeScript.
- npm Workspaces and a monorepo structure.
- LangGraph.js.
- Fastify.
- Zod.
- Pino.
- tsyringe.
- Vitest.
- Docker.
- OpenRouter.
- WordPress REST API.

Historical package names include:

- `@openblog/types`
- `@openblog/core`
- `@openblog/agents`
- `@openblog/providers`
- `@openblog/publishers`

These names and technologies are clues for repository discovery, not a specification that must be preserved. Verify their presence, implementation, dependency direction and actual usefulness before recommending changes.

## 3. Previously recorded integration context

The known WordPress publishing target is:

`https://blog.lucazanini.io/wp-json/wp/v2`

The project has used or experimented with OpenRouter, including free-model experiments.

These details are historical and must be verified where relevant. Do not assume the endpoint is currently accessible, credentials are configured, a publisher is functional or a particular model is still available.

Never require secrets to be added to project documentation or GitHub issues.

## 4. Historical architectural intentions

The original architectural direction included:

- Clean Architecture and separation of concerns.
- SOLID principles.
- Dependency Injection.
- Adapter and Strategy patterns.
- Replaceable LLM providers.
- Typed contracts and validation.
- Structured logging.
- Testable agent workflows.
- Separation between AI behavior and publishing infrastructure.

Preserve these goals where they remain useful. Evaluate whether the actual implementation achieves them.

The existence of a package or abstraction does not prove that the corresponding separation is effective.

## 5. Historical workflow and feature ideas

Previously considered editorial stages included:

Research → Planner → Writer → SEO → Classification → Quality → Publisher

Previously discussed capabilities included:

- Topic and trend research.
- Keyword research and content planning.
- Article writing, editing and fact-checking.
- SEO optimization.
- Image generation and optimization.
- Internal linking.
- Tag and category management.
- WordPress and Markdown publishing.
- Persistent article data, memory, prompt history and caching.
- Cost tracking, scheduling, retries and human approval.
- Duplicate detection, link checking and structured metadata.
- Additional publishing platforms.
- Analytics, plugins, MCP integration and retrieval over existing content.

An earlier quality-engine note proposed scoring articles for SEO, readability, structure, completeness and repetition, with regeneration when quality is insufficient.

These are historical intentions, not proof of implemented features or mandatory requirements. Reassess their product value, scope and priority. Include an item in the backlog only when the repository audit and product goals justify it.

## 6. Expected outcome of the repository assessment

Produce an evidence-based understanding of:

1. What currently works.
2. What is implemented but unverified.
3. What is incomplete, broken, duplicated or unnecessarily complex.
4. What is missing for a reliable end-to-end editorial workflow.
5. Which existing components should be retained, repaired, replaced or removed.
6. Whether a targeted refactor or a broader rewrite is justified.
7. The safest and most efficient dependency-ordered path to a maintainable product.

Use source files, tests, package metadata, configuration, workflows and reproducible checks as evidence.

Historical notes must never override contradictory evidence from the current repository without explicitly explaining the discrepancy.

## 7. Working relationship

The project owner wants a rigorous technical assessment and is comfortable making substantial changes.

Avoid protecting previous implementation choices for sentimental or sunk-cost reasons.

Do not confuse a large backlog with a good backlog. Prioritize the changes that materially improve correctness, reliability, maintainability and the ability to ship a working product.

The final implementation plan should be explicit enough that a future AI coding session can take one issue, understand its objective and acceptance criteria, implement it, test it and review the result without reconstructing the entire project from scratch.
