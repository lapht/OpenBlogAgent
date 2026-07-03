import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";

import { createArticleGenerationWorkflow } from "@openblog/graph";
import { logger } from "@openblog/logger";
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

async function saveArticle(article: string): Promise<string> {
  const outputDirectory = path.resolve(process.cwd(), "output");
  const outputFilePath = path.join(outputDirectory, "article.md");

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputFilePath, article, "utf8");

  return outputFilePath;
}

async function main(): Promise<void> {
  const topic = resolveTopic();

  logger.debug("DEBUG: OPENROUTER_API_KEY loaded?", {
    loaded: !!process.env.OPENROUTER_API_KEY,
    value: process.env.OPENROUTER_API_KEY ? "***" : "NOT_FOUND",
    model: process.env.OPENROUTER_MODEL
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

  const workflow = createArticleGenerationWorkflow({
    logger,
    provider
  });

  const result = await workflow.run({
    article: "",
    outline: [],
    topic
  });

  const outputFilePath = await saveArticle(result.article);
  logger.info("Article saved", {
    outputFilePath,
    topic: result.topic
  });
}

main().catch((error: unknown) => {
  logger.error("Article generation failed", {
    error: error instanceof Error ? error.message : String(error)
  });

  process.exitCode = 1;
});
