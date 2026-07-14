import dotenv from "dotenv";

import { loadEnv } from "@openblog/config";
import { createArticleGenerationWorkflow } from "@openblog/graph";
import { logger } from "@openblog/logger";
import {
  createPublishersFromConfig,
  StaticCategoryProvider,
  StaticTagProvider,
  WordPressCategoryProvider,
  WordPressTagProvider
} from "@openblog/publishers";
import {
  createDefaultTextGenerationProvider,
  OllamaProvider,
  OpenRouterProvider
} from "@openblog/providers";

dotenv.config();

function resolveTopic(): string {
  const directTopic = process.argv.slice(2).join(" ").trim();
  if (directTopic.length > 0) {
    return directTopic;
  }

  const npmArgv = process.env.npm_config_argv;
  if (npmArgv) {
    try {
      const parsed = JSON.parse(npmArgv) as { original?: string[] };
      const originalArgs = parsed.original ?? [];
      const startIndex = originalArgs.findIndex((arg) => arg === "start");
      const topicFromNpm = originalArgs
        .slice(startIndex >= 0 ? startIndex + 1 : 0)
        .filter((arg) => arg !== "--")
        .join(" ")
        .trim();

      if (topicFromNpm.length > 0) {
        return topicFromNpm;
      }
    } catch (error) {
      logger.debug("Unable to parse npm argv", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  throw new Error('Missing article topic. Example: npm start "AI agents in software development"');
}

async function main(): Promise<void> {
  const topic = resolveTopic();
  const env = loadEnv();

  logger.info("CLI starting article generation", {
    topic,
    environment: env.OPENBLOG_ENV,
    defaultPublisher: env.OPENBLOG_DEFAULT_PUBLISHER ?? "markdown"
  });

  logger.debug("Loaded environment configuration", {
    outputDir: env.OPENBLOG_OUTPUT_DIR,
    wordpressConfigured: Boolean(env.OPENBLOG_WORDPRESS_ENDPOINT),
    ghostConfigured: Boolean(env.OPENBLOG_GHOST_ENDPOINT)
  });

  logger.debug("DEBUG: OPENROUTER_API_KEY loaded?", {
    loaded: !!process.env.OPENROUTER_API_KEY,
    value: process.env.OPENROUTER_API_KEY ? "***" : "NOT_FOUND",
    model: process.env.OPENROUTER_MODEL
  });

  logger.info("Initializing text generation provider", {
    providerType: process.env.OPENROUTER_API_KEY ? "openrouter" : "ollama"
  });

  const provider = createDefaultTextGenerationProvider({
    openRouter: new OpenRouterProvider({
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL,
      siteUrl: process.env.OPENROUTER_SITE_URL,
      siteName: process.env.OPENROUTER_SITE_NAME
    }),
    ollama: new OllamaProvider({
      baseUrl: process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL
    })
  });

  logger.info("Configuring publishers", {
    markdown: Boolean(env.OPENBLOG_OUTPUT_DIR),
    wordpress: Boolean(env.OPENBLOG_WORDPRESS_ENDPOINT),
    ghost: Boolean(env.OPENBLOG_GHOST_ENDPOINT)
  });

  const publishers = createPublishersFromConfig(
    {
      markdown: {
        outputDir: env.OPENBLOG_OUTPUT_DIR
      },
      wordpress: env.OPENBLOG_WORDPRESS_ENDPOINT
        ? {
            endpoint: env.OPENBLOG_WORDPRESS_ENDPOINT,
            username: env.OPENBLOG_WORDPRESS_USERNAME,
            password: env.OPENBLOG_WORDPRESS_PASSWORD,
            applicationPassword: env.OPENBLOG_WORDPRESS_APPLICATION_PASSWORD,
            status: env.OPENBLOG_WORDPRESS_STATUS
          }
        : undefined,
      ghost: env.OPENBLOG_GHOST_ENDPOINT
        ? {
            endpoint: env.OPENBLOG_GHOST_ENDPOINT,
            apiKey: env.OPENBLOG_GHOST_API_KEY,
            status: env.OPENBLOG_GHOST_STATUS
          }
        : undefined,
      defaultPublisherId: env.OPENBLOG_DEFAULT_PUBLISHER,
      taxonomy: env.OPENBLOG_TAXONOMY_ALLOW_CREATE
        ? {
            allowCreate: env.OPENBLOG_TAXONOMY_ALLOW_CREATE,
            defaultCategory: env.OPENBLOG_TAXONOMY_DEFAULT_CATEGORY,
            maxTags: env.OPENBLOG_TAXONOMY_MAX_TAGS,
            cacheTtlSeconds: env.OPENBLOG_TAXONOMY_CACHE_TTL_SECONDS
          }
        : undefined
    },
    logger
  );

  const defaultPublisherId = env.OPENBLOG_DEFAULT_PUBLISHER;

  const taxonomyConfig = {
    allowCreate: env.OPENBLOG_TAXONOMY_ALLOW_CREATE,
    defaultCategory: env.OPENBLOG_TAXONOMY_DEFAULT_CATEGORY,
    maxTags: env.OPENBLOG_TAXONOMY_MAX_TAGS,
    cacheTtlSeconds: env.OPENBLOG_TAXONOMY_CACHE_TTL_SECONDS
  };

  const categoryProvider =
    env.OPENBLOG_TAXONOMY_PROVIDER === "wordpress" && env.OPENBLOG_WORDPRESS_ENDPOINT
      ? new WordPressCategoryProvider({
          endpoint: env.OPENBLOG_WORDPRESS_ENDPOINT,
          username: env.OPENBLOG_WORDPRESS_USERNAME,
          password: env.OPENBLOG_WORDPRESS_PASSWORD,
          applicationPassword: env.OPENBLOG_WORDPRESS_APPLICATION_PASSWORD,
          logger,
          config: taxonomyConfig
        })
      : new StaticCategoryProvider(
          [
            { id: 1, name: "Artificial Intelligence" },
            { id: 2, name: "Software Development" },
            { id: 3, name: "DevOps" },
            { id: 4, name: "Programming" },
            { id: 5, name: "Tutorials" },
            { id: 6, name: "News" },
            { id: 7, name: "General" }
          ],
          env.OPENBLOG_TAXONOMY_DEFAULT_CATEGORY
        );

  const tagProvider =
    env.OPENBLOG_TAXONOMY_PROVIDER === "wordpress" && env.OPENBLOG_WORDPRESS_ENDPOINT
      ? new WordPressTagProvider({
          endpoint: env.OPENBLOG_WORDPRESS_ENDPOINT,
          username: env.OPENBLOG_WORDPRESS_USERNAME,
          password: env.OPENBLOG_WORDPRESS_PASSWORD,
          applicationPassword: env.OPENBLOG_WORDPRESS_APPLICATION_PASSWORD,
          logger,
          config: taxonomyConfig
        })
      : new StaticTagProvider(
          [
            { id: 1, name: "AI" },
            { id: 2, name: "Node.js" },
            { id: 3, name: "TypeScript" },
            { id: 4, name: "LangGraph" },
            { id: 5, name: "OpenRouter" },
            { id: 6, name: "Ollama" },
            { id: 7, name: "SEO" },
            { id: 8, name: "Automation" }
          ],
          env.OPENBLOG_TAXONOMY_MAX_TAGS
        );

  logger.info("Creating workflow instance", {
    publisherCount: publishers.length,
    defaultPublisherId: env.OPENBLOG_DEFAULT_PUBLISHER
  });

  const workflow = createArticleGenerationWorkflow({
    logger,
    provider,
    publishers,
    defaultPublisherId,
    categoryProvider,
    tagProvider,
    taxonomyConfig
  });

  try {
    logger.info("Starting workflow execution", {
      topic
    });

    const result = await workflow.run({
      article: "",
      category: "",
      outline: [],
      tags: [],
      topic
    });

    logger.info("Workflow completed successfully", {
      topic,
      title: result.seoOutput?.title,
      slug: result.seoOutput?.slug,
      publishSuccess: result.publishResult?.success,
      publisherId: result.publishResult?.publisherId,
      outputPath: result.publishResult?.outputPath
    });

    logger.info("Article saved", {
      outputFilePath: result.publishResult?.outputPath,
      topic: result.topic,
      slug: result.seoOutput.slug,
      publisherId: result.publishResult?.publisherId
    });
  } catch (error) {
    logger.error("Article generation failed", {
      topic,
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  logger.error("Article generation failed", {
    topic: process.argv.slice(2).join(" ").trim(),
    error: error instanceof Error ? error.message : String(error)
  });

  process.exitCode = 1;
});
