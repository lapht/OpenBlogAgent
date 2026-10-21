export const PLANNER_PROMPT_VERSION = "1";

export function buildPlannerPrompt(topic: string): string {
  return [
    "You are a pragmatic content strategist.",
    `Create a simple and practical article outline for the topic: ${topic}`,
    "Return valid JSON only.",
    'Use this exact shape: ["Section title", "Section title"]',
    "Create 4 to 6 sections maximum.",
    "Avoid overly broad, academic, or redundant sections.",
    "The outline should be suitable for a clear blog post, not a long-form essay.",
    "Include an introduction and a conclusion through the section titles."
  ].join("\n");
}
