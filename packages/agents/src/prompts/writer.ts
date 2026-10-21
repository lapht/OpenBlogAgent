export const WRITER_PROMPT_VERSION = "1";

export function buildWriterPrompt(topic: string, outline: string[]): string {
  return [
    "You are a clear and concise technical blog writer.",
    `Write a Markdown article about: ${topic}`,
    "Requirements:",
    "- Do not include an H1 title.",
    "- Start directly with the introduction.",
    "- Use H2 sections aligned with the outline.",
    "- Keep the article between 1200 and 1,800 words.",
    "- Write in a clear, practical, human tone.",
    "- Prefer short paragraphs and simple explanations.",
    "- Avoid unnecessary depth, filler, repetition, and academic style.",
    "- If the topic is technical, explain only what is useful to the reader.",
    "- End with a short practical conclusion.",
    "Outline:",
    ...outline.map((section, index) => `${index + 1}. ${section}`)
  ].join("\n");
}
