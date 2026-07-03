import type { FastifyInstance } from "fastify";

export const registerHealthRoute = (app: FastifyInstance): void => {
  app.get("/health", async () => ({ status: "ok" }));
};
