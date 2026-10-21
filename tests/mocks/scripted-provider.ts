/** Fake provider that replays scripted replies (the last one repeats) and records prompts. */
export function scriptedProvider(...replies: string[]) {
  const prompts: string[] = [];
  return {
    prompts,
    id: "fake",
    async generate(request: { prompt: string }) {
      prompts.push(request.prompt);
      const text = replies[Math.min(prompts.length, replies.length) - 1];
      return { text, model: "fake" };
    }
  };
}
