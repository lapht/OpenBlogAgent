import type { EnvSchema } from "@openblog/config";
import {
  createArticleGenerationWorkflow,
  type ArticleGenerationWorkflow,
  type LlmPort,
  type MemoryPort
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

import { loadStaticTaxonomy } from "./taxonomy";

export { loadStaticTaxonomy, type StaticTaxonomy } from "./taxonomy";

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
}

export interface Application {
  workflow: ArticleGenerationWorkflow;
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
              status: config.OPENBLOG_WORDPRESS_STATUS
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

  const workflow = createArticleGenerationWorkflow({
    logger,
    llm,
    publisher: new DefaultPublisherManager(logger, publishers, {
      defaultPublisherId: config.OPENBLOG_DEFAULT_PUBLISHER
    }),
    taxonomy: {
      listCategories: async () => (await categories.list()).map((entry) => entry.name),
      listTags: async () => (await tags.list()).map((entry) => entry.name)
    },
    memory: overrides.memory ?? memoryStore?.memoryService,
    defaultCategory: taxonomyConfig.defaultCategory,
    maxTags: taxonomyConfig.maxTags
  });

  logger.info("Application created", {
    publishers: publishers.map((publisher) => publisher.id),
    defaultPublisherId: config.OPENBLOG_DEFAULT_PUBLISHER,
    taxonomyProvider
  });

  return {
    workflow,
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
