# Graph Report - .  (2026-07-21)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 790 nodes · 935 edges · 64 communities (52 shown, 12 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `480cb332`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- PublishArticle
- TaxonomyEntry
- dependencies
- devDependencies
- scripts
- server/package.json
- dependencies
- article-generation-workflow.ts
- cli/package.json
- interfaces/index.ts
- publishers/package.json
- compilerOptions
- TextGenerationProvider
- config/package.json
- core/package.json
- storage/src/index.ts
- tools/package.json
- tools/src/index.ts
- app.ts
- agents/package.json
- logger/package.json
- providers/package.json
- storage/package.json
- classification/agent.ts
- editor/agent.ts
- shared/package.json
- agents/src/index.ts
- seo/agent.ts
- dashboard/package.json
- server/tsconfig.json
- compilerOptions
- publishers/tsconfig.json
- types/package.json
- shared/src/index.ts
- cli/tsconfig.json
- dashboard/tsconfig.json
- agents/tsconfig.json
- config/tsconfig.json
- graph/tsconfig.json
- logger/tsconfig.json
- providers/tsconfig.json
- sdk/tsconfig.json
- shared/tsconfig.json
- storage/tsconfig.json
- tools/tsconfig.json
- types/tsconfig.json
- env.ts
- ILogger
- .prettierrc.json
- types/src/index.ts
- cli/src/index.ts
- analytics/index.ts
- editor/index.ts
- agents/src/memory/index.ts
- planner/index.ts
- publisher/index.ts
- research/index.ts
- agents/src/seo/index.ts
- writer/index.ts

## God Nodes (most connected - your core abstractions)
1. `PublishArticle` - 21 edges
2. `compilerOptions` - 18 edges
3. `IPublisher` - 17 edges
4. `TaxonomyEntry` - 16 edges
5. `scripts` - 14 edges
6. `PublishResult` - 12 edges
7. `MarkdownPublisher` - 9 edges
8. `WordPressTaxonomyBase` - 9 edges
9. `ICategoryProvider` - 9 edges
10. `ITagProvider` - 9 edges

## Surprising Connections (you probably didn't know these)
- `MockPublisher` --implements--> `IPublisher`  [EXTRACTED]
  tests/unit/publishing.test.ts → packages/publishers/src/types.ts
- `bootstrap()` --calls--> `buildServer()`  [EXTRACTED]
  apps/server/src/main.ts → apps/server/src/app.ts
- `PublisherFactoryConfig` --references--> `TaxonomyProviderConfig`  [EXTRACTED]
  packages/publishers/src/factory.ts → packages/publishers/src/taxonomy/types.ts
- `WordPressTaxonomyProviderOptions` --references--> `TaxonomyProviderConfig`  [EXTRACTED]
  packages/publishers/src/taxonomy/providers/wordpress-taxonomy-provider.ts → packages/publishers/src/taxonomy/types.ts
- `BuildServerOptions` --references--> `VersionPayload`  [EXTRACTED]
  apps/server/src/app.ts → apps/server/src/routes/version.ts

## Import Cycles
- None detected.

## Communities (64 total, 12 thin omitted)

### Community 0 - "PublishArticle"
Cohesion: 0.09
Nodes (19): logger, pinoLogger, PublisherFactoryConfig, GhostPublisher, GhostPublisherConfig, DefaultPublisherManager, MarkdownPublisher, MarkdownPublisherConfig (+11 more)

### Community 1 - "TaxonomyEntry"
Cohesion: 0.11
Nodes (11): TtlCache, StaticCategoryProvider, StaticTagProvider, WordPressCategoryProvider, WordPressTagProvider, WordPressTaxonomyBase, WordPressTaxonomyProviderOptions, ICategoryProvider (+3 more)

### Community 2 - "dependencies"
Cohesion: 0.06
Nodes (32): @openblog/storage, @openblog/tools, dependencies, @openblog/agents, @openblog/config, @openblog/core, @openblog/graph, @openblog/logger (+24 more)

### Community 3 - "devDependencies"
Cohesion: 0.06
Nodes (31): @commitlint/cli, @commitlint/config-conventional, eslint, eslint-config-prettier, husky, lint-staged, devDependencies, @commitlint/cli (+23 more)

### Community 4 - "scripts"
Cohesion: 0.07
Nodes (28): description, license, lint-staged, *.ts, *.{ts,tsx,js,json,md,yml,yaml}, name, packageManager, private (+20 more)

### Community 5 - "server/package.json"
Cohesion: 0.08
Nodes (25): dependencies, fastify, @fastify/cors, @openblog/config, @openblog/logger, @openblog/shared, devDependencies, tsx (+17 more)

### Community 6 - "dependencies"
Cohesion: 0.08
Nodes (24): dependencies, @langchain/langgraph, @openblog/core, @openblog/logger, @openblog/providers, @openblog/publishers, @openblog/types, zod (+16 more)

### Community 7 - "article-generation-workflow.ts"
Cohesion: 0.11
Nodes (19): Edge, Node, Workflow, WorkflowContext, WorkflowState, ARTICLE_GENERATION_WORKFLOW_NAME, ArticleGenerationWorkflow, ArticleWorkflowResult (+11 more)

### Community 8 - "cli/package.json"
Cohesion: 0.09
Nodes (21): dependencies, @openblog/config, @openblog/graph, @openblog/logger, @openblog/providers, @openblog/publishers, @openblog/config, @openblog/graph (+13 more)

### Community 9 - "interfaces/index.ts"
Cohesion: 0.10
Nodes (11): dependencyContainer, IAgent, IEdge, IExecutionContext, ILogger, INode, IProvider, IPublisher (+3 more)

### Community 10 - "publishers/package.json"
Cohesion: 0.10
Nodes (19): dependencies, @openblog/core, @openblog/logger, @openblog/types, devDependencies, @types/node, @openblog/core, @openblog/logger (+11 more)

### Community 11 - "compilerOptions"
Cohesion: 0.10
Nodes (19): ES2022, compilerOptions, allowSyntheticDefaultImports, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, ignoreDeprecations (+11 more)

### Community 12 - "TextGenerationProvider"
Cohesion: 0.14
Nodes (8): DefaultProviderOptions, TextGenerationProvider, OllamaGenerateResponse, OllamaProvider, OllamaProviderConfig, OpenRouterChatResponse, OpenRouterProvider, OpenRouterProviderConfig

### Community 13 - "config/package.json"
Cohesion: 0.12
Nodes (16): dotenv, dependencies, dotenv, @openblog/types, zod, @openblog/types, zod, main (+8 more)

### Community 14 - "core/package.json"
Cohesion: 0.12
Nodes (16): dependencies, @openblog/types, reflect-metadata, tsyringe, @openblog/types, main, name, private (+8 more)

### Community 15 - "storage/src/index.ts"
Cohesion: 0.12
Nodes (4): ICacheStore, IDatabaseConnection, IMemoryStore, IRepositoryContract

### Community 16 - "tools/package.json"
Cohesion: 0.12
Nodes (16): dependencies, @openblog/agents, @openblog/core, @openblog/types, @openblog/agents, @openblog/core, @openblog/types, main (+8 more)

### Community 17 - "tools/src/index.ts"
Cohesion: 0.12
Nodes (8): IFilesystemTool, IImagesTool, MarkdownAssemblerInput, MarkdownAssemblerResult, IMarkdownTool, IRssTool, ISeoTool, IWebSearchTool

### Community 18 - "app.ts"
Cohesion: 0.26
Nodes (8): buildServer(), BuildServerOptions, bootstrap(), registerCors(), registerErrorHandler(), registerHealthRoute(), registerVersionRoute(), VersionPayload

### Community 19 - "agents/package.json"
Cohesion: 0.13
Nodes (14): dependencies, @openblog/core, @openblog/types, @openblog/core, @openblog/types, main, name, private (+6 more)

### Community 20 - "logger/package.json"
Cohesion: 0.13
Nodes (14): dependencies, @openblog/types, pino, @openblog/types, main, name, private, scripts (+6 more)

### Community 21 - "providers/package.json"
Cohesion: 0.13
Nodes (14): dependencies, @openblog/core, @openblog/types, @openblog/core, @openblog/types, main, name, private (+6 more)

### Community 22 - "storage/package.json"
Cohesion: 0.13
Nodes (14): dependencies, @openblog/core, @openblog/types, @openblog/core, @openblog/types, main, name, private (+6 more)

### Community 23 - "classification/agent.ts"
Cohesion: 0.21
Nodes (9): ClassificationAgent, ClassificationAgentInput, ClassificationOutput, classificationOutputSchema, extractJsonFromFullMarkdownFence(), extractOuterJsonObject(), normalizeClassificationOutput(), normalizeTags() (+1 more)

### Community 24 - "editor/agent.ts"
Cohesion: 0.19
Nodes (9): createEditorAgent(), EditorAgent, EditorAgentInput, EditorOutput, editorOutputSchema, extractJsonFromFullMarkdownFence(), extractOuterJsonObject(), parseEditorOutput() (+1 more)

### Community 25 - "shared/package.json"
Cohesion: 0.15
Nodes (12): dependencies, @openblog/types, @openblog/types, main, name, private, scripts, build (+4 more)

### Community 26 - "agents/src/index.ts"
Cohesion: 0.18
Nodes (9): analytics, editor, memory, planner, publisher, research, seo, writer (+1 more)

### Community 27 - "seo/agent.ts"
Cohesion: 0.27
Nodes (9): extractJsonFromFullMarkdownFence(), extractOuterJsonObject(), normalizeHeadings(), normalizeSeoOutput(), normalizeSlug(), parseSeoOutput(), SeoAgentInput, SeoOutput (+1 more)

### Community 28 - "dashboard/package.json"
Cohesion: 0.20
Nodes (9): main, name, private, scripts, build, clean, typecheck, types (+1 more)

### Community 29 - "server/tsconfig.json"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, types, extends, include, node, src (+1 more)

### Community 30 - "compilerOptions"
Cohesion: 0.20
Nodes (9): compilerOptions, emitDecoratorMetadata, experimentalDecorators, outDir, rootDir, extends, include, src (+1 more)

### Community 31 - "publishers/tsconfig.json"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, types, extends, include, node, src (+1 more)

### Community 32 - "types/package.json"
Cohesion: 0.20
Nodes (9): main, name, private, scripts, build, clean, typecheck, types (+1 more)

### Community 34 - "cli/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 35 - "dashboard/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 36 - "agents/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 37 - "config/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 38 - "graph/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 39 - "logger/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 40 - "providers/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 41 - "sdk/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 42 - "shared/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 43 - "storage/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 44 - "tools/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 45 - "types/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 48 - ".prettierrc.json"
Cohesion: 0.40
Nodes (4): printWidth, semi, singleQuote, trailingComma

### Community 49 - "types/src/index.ts"
Cohesion: 0.50
Nodes (3): Environment, Identifier, VersionInfo

## Knowledge Gaps
- **371 isolated node(s):** `semi`, `singleQuote`, `trailingComma`, `printWidth`, `name` (+366 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createArticleGenerationWorkflow()` connect `article-generation-workflow.ts` to `PublishArticle`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `scripts`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `semi`, `singleQuote`, `trailingComma` to the rest of the system?**
  _371 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `PublishArticle` be split into smaller, more focused modules?**
  _Cohesion score 0.09415584415584416 - nodes in this community are weakly interconnected._
- **Should `TaxonomyEntry` be split into smaller, more focused modules?**
  _Cohesion score 0.10668563300142248 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06060606060606061 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._