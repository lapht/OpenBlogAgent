import type { FastifyInstance } from "fastify";

export interface VersionPayload {
  name: string;
  version: string;
}

export const registerVersionRoute = (
  app: FastifyInstance,
  versionPayload: VersionPayload
): void => {
  app.get("/version", async () => versionPayload);
};
