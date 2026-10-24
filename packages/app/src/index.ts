import type { EnvSchema } from "@openblog/config";
import {
  createArticleGenerationWorkflow,
  type ArticleGenerationWorkflow,
  type LlmPort,
  type MemoryPort,
  type StoredRunDetails,
  type StoredWorkflowSummary
} from "@openblog/graph";
import { logger as defaultLogger, type ILogger } from "@openblog/logger";
import {
  createDefaultTextGenerationProvider,
  OllamaProvider,
  OpenRouterProvider
} from "@openblog/providers";
import {
  createPublishersFromConfig,
  DefaultPublisherManager,
  StaticCategoryProvider,
  StaticTagProvider,
  WordPressCategoryProvider,
  WordPressTagProvider,
  type ICategoryProvider,
  type IPublisher,
  type ITagProvider,
  type TaxonomyProviderConfig
} from "@openblog/publishers";
import { createSQLiteMemoryService } from "@openblog/storage";

import { createSourceReader, type ContentFetcher } from "@openblog/research";
import { createContentFetcherFromConfig } from "./fetcher";
import { loadPromptOverrides } from "./prompts";
import { createResearchService, type ResearchService } from "./research";
import { loadStaticTaxonomy } from "./taxonomy";

export { loadStaticTaxonomy, type StaticTaxonomy } from "./taxonomy";
export { createContentFetcherFromConfig } from "./fetcher";
export {
  createResearchService,
  loadResearchSources,
  type CollectedCandidate,
  type CollectOutcome,
  type ResearchService
} from "./research";
export {
  BacklogError,
  type BacklogErrorCode,
  type CandidateRecord,
  type CandidateStatus
} from "@openblog/storage";
export {
  ResearchError,
  SourcesConfigError,
  type ResearchErrorCode,
  type SourceReport
} from "@openblog/research";

/** Adapters that replace the ones built from config (tests, embedding). */
export interface ApplicationOverrides {
  logger?: ILogger;
  llm?: LlmPort;
  /** Replaces the SQLite memory store. The caller owns its lifecycle. */
  memory?: MemoryPort;
  /** Replaces the publishers built from config. */
  publishers?: IPublisher[];
  categoryProvider?: ICategoryProvider;
  tagProvider?: ITagProvider;
  /** Replaces the safe content fetcher the research sources are read through (tests). */
  fetcher?: ContentFetcher;
  /** The clock research scoring and decisions use (tests). */
  clock?: () => Date;
}

export interface Application {
  workflow: ArticleGenerationWorkflow;
  /** The most recent stored runs, newest first. */
  listRuns(limit?: number): Promise<StoredWorkflowSummary[]>;
  /** One stored run with its steps; null if the id is unknown. */
  getRun(workflowId: string): Promise<StoredRunDetails | null>;
  /**
   * Marks runs abandoned by a dead process as `interrupted` so `resume` can pick them up.
   * Returns the ids; empty when the store cannot recover runs.
   */
  recoverStaleRuns(now?: Date): Promise<string[]>;
  /**
   * The topic backlog (collect, score, accept, drop). Absent when the store is not the SQLite
   * one, since candidates need a database.
   */
  research?: ResearchService;
  /** What was wired, for diagnostics. */
  info: {
    publisherIds: string[];
    taxonomyProvider: "static" | "wordpress" | "custom";
  };
  dispose(): Promise<void>;
}

/** The single place where adapters are built from validated config and wired into the workflow. */
export async function createApplication(
  config: EnvSchema,
  overrides: ApplicationOverrides = {}
): Promise<Application> {
  const logger = overrides.logger ?? defaultLogger;

  // Before anything is opened: an unusable override must stop the application here, not a run.
  const prompts = config.OPENBLOG_PROMPTS_DIR
    ? loadPromptOverrides(config.OPENBLOG_PROMPTS_DIR)
    : undefined;
  if (prompts) {
    logger.info("Prompt overrides loaded", {
      dir: config.OPENBLOG_PROMPTS_DIR,
      agents: Object.keys(prompts)
    });
  }

  const llm = overrides.llm ?? createLlm(config);

  const taxonomyConfig: TaxonomyProviderConfig = {
    allowCreate: config.OPENBLOG_TAXONOMY_ALLOW_CREATE,
    defaultCategory: config.OPENBLOG_TAXONOMY_DEFAULT_CATEGORY,
    maxTags: config.OPENBLOG_TAXONOMY_MAX_TAGS,
    cacheTtlSeconds: config.OPENBLOG_TAXONOMY_CACHE_TTL_SECONDS
  };

  // WordPress providers are built once and shared by the publisher and the classifier.
  const wordpressTaxonomy = config.OPENBLOG_WORDPRESS_ENDPOINT
    ? createWordPressTaxonomy(config, config.OPENBLOG_WORDPRESS_ENDPOINT, taxonomyConfig, logger)
    : undefined;

  const publishers =
    overrides.publishers ??
    createPublishersFromConfig(
      {
        markdown: {
          outputDir: config.OPENBLOG_OUTPUT_DIR,
          overwrite: config.OPENBLOG_MARKDOWN_OVERWRITE
        },
        wordpress: config.OPENBLOG_WORDPRESS_ENDPOINT
          ? {
              endpoint: config.OPENBLOG_WORDPRESS_ENDPOINT,
              username: config.OPENBLOG_WORDPRESS_USERNAME,
              applicationPassword: config.OPENBLOG_WORDPRESS_APPLICATION_PASSWORD,
              status: config.OPENBLOG_WORDPRESS_STATUS,
              onExisting: config.OPENBLOG_WORDPRESS_ON_EXISTING
            }
          : undefined,
        ghost: config.OPENBLOG_GHOST_ENDPOINT
          ? {
              endpoint: config.OPENBLOG_GHOST_ENDPOINT,
              apiKey: config.OPENBLOG_GHOST_ADMIN_API_KEY,
              status: config.OPENBLOG_GHOST_STATUS
            }
          : undefined,
        defaultPublisherId: config.OPENBLOG_DEFAULT_PUBLISHER,
        taxonomy: taxonomyConfig,
        wordpressTaxonomy
      },
      logger
    );

  let categoryProvider = overrides.categoryProvider;
  let tagProvider = overrides.tagProvider;
  let taxonomyProvider: Application["info"]["taxonomyProvider"] = "custom";

  if (!categoryProvider || !tagProvider) {
    if (config.OPENBLOG_TAXONOMY_PROVIDER === "wordpress" && wordpressTaxonomy) {
      categoryProvider ??= wordpressTaxonomy.categoryProvider;
      tagProvider ??= wordpressTaxonomy.tagProvider;
      taxonomyProvider = "wordpress";
    } else {
      const statics = await loadStaticTaxonomy(config);
      categoryProvider ??= new StaticCategoryProvider(
        statics.categories.map((name, index) => ({ id: index + 1, name })),
        config.OPENBLOG_TAXONOMY_DEFAULT_CATEGORY
      );
      tagProvider ??= new StaticTagProvider(
        statics.tags.map((name, index) => ({ id: index + 1, name })),
        config.OPENBLOG_TAXONOMY_MAX_TAGS
      );
      taxonomyProvider = "static";
    }
  }

  const categories = categoryProvider;
  const tags = tagProvider;

  const memoryStore = overrides.memory
    ? undefined
    : await createSQLiteMemoryService({ filePath: config.OPENBLOG_MEMORY_DB_PATH });

  const memory = overrides.memory ?? memoryStore?.memoryService;

  // One safe fetcher serves both the source pages of a run and the research sources.
  const fetcher = overrides.fetcher ?? createContentFetcherFromConfig(config);

  const workflow = createArticleGenerationWorkflow({
    logger,
    llm,
    models: {
      planner: config.OPENBLOG_MODEL_PLANNER,
      writer: config.OPENBLOG_MODEL_WRITER,
      editor: config.OPENBLOG_MODEL_EDITOR,
      seo: config.OPENBLOG_MODEL_SEO,
      classification: config.OPENBLOG_MODEL_CLASSIFICATION,
      review: config.OPENBLOG_MODEL_REVIEW
    },
    publisher: new DefaultPublisherManager(logger, publishers, {
      defaultPublisherId: config.OPENBLOG_DEFAULT_PUBLISHER
    }),
    taxonomy: {
      listCategories: async () => (await categories.list()).map((entry) => entry.name),
      listTags: async () => (await tags.list()).map((entry) => entry.name)
    },
    memory,
    prompts,
    sources: {
      reader: createSourceReader(fetcher),
      allowPartial: config.OPENBLOG_SOURCES_ALLOW_PARTIAL,
      maxCharsPerSource: config.OPENBLOG_SOURCES_MAX_CHARS_PER_SOURCE,
      maxCharsTotal: config.OPENBLOG_SOURCES_MAX_CHARS_TOTAL
    },
    defaultCategory: taxonomyConfig.defaultCategory,
    maxTags: taxonomyConfig.maxTags,
    allowDuplicates: config.OPENBLOG_ALLOW_DUPLICATES,
    contentLanguage: config.OPENBLOG_CONTENT_LANGUAGE,
    publicationPolicy: config.OPENBLOG_PUBLICATION_POLICY,
    review: {
      enabled: config.OPENBLOG_REVIEW_ENABLED,
      minScore: config.OPENBLOG_REVIEW_MIN_SCORE
    },
    budget: {
      maxTokens: config.OPENBLOG_MAX_TOKENS_PER_RUN,
      maxCostUsd: config.OPENBLOG_MAX_COST_PER_RUN
    },
    quality: {
      maxAttempts: config.OPENBLOG_QUALITY_MAX_ATTEMPTS,
      rules: {
        minWords: config.OPENBLOG_QUALITY_MIN_WORDS,
        maxWords: config.OPENBLOG_QUALITY_MAX_WORDS,
        minH2: config.OPENBLOG_QUALITY_MIN_H2,
        minOutlineCoverage: config.OPENBLOG_QUALITY_MIN_OUTLINE_COVERAGE,
        minEditRatio: config.OPENBLOG_QUALITY_MIN_EDIT_RATIO,
        maxEditRatio: config.OPENBLOG_QUALITY_MAX_EDIT_RATIO,
        minKeywordDensity: config.OPENBLOG_QUALITY_KEYWORD_MIN_DENSITY,
        maxKeywordDensity: config.OPENBLOG_QUALITY_KEYWORD_MAX_DENSITY
      }
    }
  });

  logger.info("Application created", {
    publishers: publishers.map((publisher) => publisher.id),
    defaultPublisherId: config.OPENBLOG_DEFAULT_PUBLISHER,
    taxonomyProvider
  });

  return {
    workflow,
    async listRuns(limit = 20): Promise<StoredWorkflowSummary[]> {
      return (await memory?.listWorkflows?.(limit)) ?? [];
    },
    async getRun(workflowId: string): Promise<StoredRunDetails | null> {
      return (await memory?.getRunDetails?.(workflowId)) ?? null;
    },
    async recoverStaleRuns(now?: Date): Promise<string[]> {
      return (await memory?.recoverStaleRuns?.(config.OPENBLOG_RUN_STALE_AFTER_MINUTES, now)) ?? [];
    },
    research: memoryStore
      ? createResearchService({
          config,
          backlog: memoryStore.backlog,
          fetcher,
          clock: overrides.clock
        })
      : undefined,
    info: { publisherIds: publishers.map((publisher) => publisher.id), taxonomyProvider },
    async dispose(): Promise<void> {
      await memoryStore?.disconnect();
    }
  };
}

function createLlm(config: EnvSchema): LlmPort {
  return createDefaultTextGenerationProvider({
    // Without an API key OpenRouter is skipped on purpose: a missing key is a
    // configuration choice, not an outage, so Ollama becomes the primary provider.
    openRouter: config.OPENROUTER_API_KEY
      ? new OpenRouterProvider({
          apiKey: config.OPENROUTER_API_KEY,
          model: config.OPENROUTER_MODEL,
          siteUrl: config.OPENROUTER_SITE_URL,
          siteName: config.OPENROUTER_SITE_NAME
        })
      : undefined,
    ollama: new OllamaProvider({
      baseUrl: config.OLLAMA_BASE_URL,
      model: config.OLLAMA_MODEL
    })
  });
}

function createWordPressTaxonomy(
  config: EnvSchema,
  endpoint: string,
  taxonomyConfig: TaxonomyProviderConfig,
  logger: ILogger
): { categoryProvider: ICategoryProvider; tagProvider: ITagProvider } {
  const options = {
    endpoint,
    username: config.OPENBLOG_WORDPRESS_USERNAME,
    applicationPassword: config.OPENBLOG_WORDPRESS_APPLICATION_PASSWORD,
    logger,
    config: taxonomyConfig
  };

  return {
    categoryProvider: new WordPressCategoryProvider(options),
    tagProvider: new WordPressTagProvider(options)
  };
}
