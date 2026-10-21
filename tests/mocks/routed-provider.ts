export type Agent = "planner" | "writer" | "editor" | "seo" | "classification";
export type Reply = string | Error;

/** Identifies the agent that built a prompt. Retry prompts embed the original, so they route the same way. */
export function agentOf(prompt: string): Agent {
  if (prompt.includes("blog writer")) return "writer";
  if (prompt.includes("experienced editor")) return "editor";
  if (prompt.includes("outline")) return "planner";
  if (prompt.includes("SEO")) return "seo";
  return "classification";
}

/**
 * Fake provider that replies per agent. Each queue is consumed in order and its last entry repeats;
 * an `Error` entry is thrown instead of returned. Records every prompt, in call order.
 */
export function routedProvider(queues: Record<Agent, Reply[]>) {
  const prompts: Array<{ agent: Agent; prompt: string }> = [];
  const used: Record<Agent, number> = {
    planner: 0,
    writer: 0,
    editor: 0,
    seo: 0,
    classification: 0
  };
  return {
    prompts,
    id: "fake",
    calls: (agent: Agent) => prompts.filter((entry) => entry.agent === agent).length,
    async generate(request: { prompt: string }) {
      const agent = agentOf(request.prompt);
      prompts.push({ agent, prompt: request.prompt });
      const queue = queues[agent];
      const reply = queue[Math.min(used[agent]++, queue.length - 1)]!;
      if (reply instanceof Error) throw reply;
      return { text: reply, model: "fake", usage: { totalTokens: 10 } };
    }
  };
}
