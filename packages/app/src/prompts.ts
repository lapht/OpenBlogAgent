import fs from "node:fs";
import path from "node:path";

import {
  PROMPT_AGENTS,
  PromptOverrideError,
  validatePromptTemplate,
  type PromptOverrides
} from "@openblog/agents";

/**
 * Reads `<dir>/<agent>.md` for each agent (`planner`, `writer`, `editor`, `seo`,
 * `classification`, `review`). A missing file keeps the built-in prompt; an unreadable or invalid
 * one throws, so a bad override stops the application at startup instead of a run halfway.
 */
export function loadPromptOverrides(dir: string): PromptOverrides {
  const root = path.resolve(dir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`OPENBLOG_PROMPTS_DIR ${root} is not a directory`);
  }

  const overrides: PromptOverrides = {};
  for (const agent of PROMPT_AGENTS) {
    const file = path.join(root, `${agent}.md`);
    if (!fs.existsSync(file)) {
      continue;
    }

    let text: string;
    try {
      text = fs.readFileSync(file, "utf8").trimEnd();
    } catch (error) {
      throw new Error(
        `Cannot read the prompt override ${file}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    try {
      validatePromptTemplate(agent, text);
    } catch (error) {
      if (error instanceof PromptOverrideError) {
        throw new Error(`${file}: ${error.message}`);
      }
      throw error;
    }
    overrides[agent] = text;
  }

  return overrides;
}
