import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SeoOutput } from "@openblog/agents";

export interface MarkdownAssemblerInput {
  editedText: string;
  seoOutput: SeoOutput;
}

export interface MarkdownAssemblerResult {
  filePath: string;
}

export function createMarkdownAssembler(outputDir?: string): {
  assemble: (input: MarkdownAssemblerInput) => Promise<MarkdownAssemblerResult>;
} {
  const baseOutputDir = outputDir ?? process.cwd();

  return {
    async assemble(input: MarkdownAssemblerInput): Promise<MarkdownAssemblerResult> {
      const { editedText, seoOutput } = input;
      const outputDirectory = path.resolve(baseOutputDir, "output");
      const outputFilePath = path.join(outputDirectory, `${seoOutput.slug}.md`);

      const frontmatter = [
        "---",
        `title: "${seoOutput.title}"`,
        `description: "${seoOutput.metaDescription}"`,
        `slug: "${seoOutput.slug}"`,
        `date: "${new Date().toISOString()}"`,
        "---",
        "",
        `# ${seoOutput.h1}`,
        "",
        editedText
      ].join("\n");

      await mkdir(outputDirectory, { recursive: true });
      await writeFile(outputFilePath, frontmatter, "utf8");

      return { filePath: outputFilePath };
    }
  };
}